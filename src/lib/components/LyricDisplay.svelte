<script>
	import { onMount, afterUpdate, tick } from 'svelte';
	import ResultsDisplay from './ResultsDisplay.svelte';

	import { themeColors, ditherImages, imageColors, correctionColors, windowStore, maxDisplayedLines } from '$lib/services/store.js';
	import { trashStore, formatTestResultsForTrash } from '$lib/services/trashService.js';
	import { normalizeDiacritics } from 'normalize-text';
	import { parseLyricSections, pickStartAnchor } from '$lib/utils/lyricSections.js';
	export let lyrics;
	export let songTitle;
	export let artistName;
	export let imageUrl;
	export let albumArtId = null; // Album art ID for binary rendering
	export let preloadedAlbumArt = null; // Preloaded binary album art data for instant results
	export let continueFromQueue;
	export let replaySong;
	export let geniusUrl;
	export let songId = null; // Song ID for trash functionality
	export let artistUrlKey = null; // Artist URL key for trash replay functionality
	export let isPaused = false;
	export let capitalization = true;
	export let punctuation = true;
	export let fullLyrics = null; // Raw lyrics including section markers, if available
	export let contentLyrics = null; // Marker-stripped lyrics from queueManager
	export let startContentLineIndex = 0; // Section-anchored starting line

	// Lyrics scrolling functionality
	export let onScrollUp = null;
	export let onScrollDown = null;
	let lyricsLines = []; // Content lines (markers stripped) — full song scope
	let visibleLines = []; // The content-line window for this test (fixed by anchor + maxDisplayedLines)
	let contentStartLine = 0; // First content-line of the test scope

	// visual-line scroll state — driven by measurement of rendered DOM
	let viewportEl;
	let innerEl;
	let viewportHeight = 0;
	let visualLineTops = []; // unique offsetTop per visual line, sorted
	let visualLineHeight = 0;
	let totalVisualLines = 0;
	let fitsCount = 1;
	let cursorVisualLine = 0;
	let currentScrollLine = 0; // top visible visual line
	let scrollOffsetPx = 0;
	// per-content-line first visual-line index — maps content-line index in
	// visibleLines (the test window) to its first visual line. used for
	// song-relative scrollbar coordinates and for drag-target conversion.
	let contentLineVisualStarts = [];
	const CURSOR_TARGET_LINE = 3; // keep cursor at the 4th visible line (zero-indexed) once scrolling kicks in
	const DEBUG_LAYOUT = true; // temporary: log layout values to console on every measure
	let debugLogged = 0;
	
	let userInput = '';
	let startTime = null;
	let endTime = null;
	export let testStarted = false;
	let pauseStartTime = null;
	let totalPauseTime = 0;

	// let lastCapitalization = $capitalization;
	// let lastPunctuation = $punctuation;
	let cursorPosition = 0;
	let inputElement;
	export let showResults = false; // Export so parent can bind and pass to scrollbar
	let wpm = 0;
	let accuracy = 0;
	let preloadedImage;
	let normalizedLyrics;
	let blink = false;
	
	// Frozen results - captured when test ends and never recalculated
	let frozenWpm = 0;
	let frozenAccuracy = 0;
	let frozenTypingState = { classes: [] };
	
	// Live WPM tracking
	export let liveWpm = 0;
	let liveWpmInterval = null;
  
	$: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;

	// Process lyrics into lines and manage scrolling
	function processLyricsIntoLines(lyricsText) {
		if (!lyricsText) return [];
		return lyricsText.split('\n').filter(line => line.trim() !== '');
	}

	// clamp visual-line scroll to its valid range given current measurements
	function clampVisualScrollLine(idx) {
		const maxScroll = Math.max(0, totalVisualLines - fitsCount);
		return Math.max(0, Math.min(maxScroll, idx));
	}

	// arrow-key/scrollbar scrolling — disabled once user starts typing (until results clear)
	function canScroll() {
		return !testStarted && !showResults;
	}

	function scrollLyricsUp() {
		if (!canScroll()) return;
		const next = clampVisualScrollLine(currentScrollLine - 1);
		if (next === currentScrollLine) return;
		currentScrollLine = next;
		scrollOffsetPx = currentScrollLine * visualLineHeight;
	}

	function scrollLyricsDown() {
		if (!canScroll()) return;
		const next = clampVisualScrollLine(currentScrollLine + 1);
		if (next === currentScrollLine) return;
		currentScrollLine = next;
		scrollOffsetPx = currentScrollLine * visualLineHeight;
	}

	// scrollbar thumb drag — target is a song-relative content line. convert
	// to the corresponding visual line within the current test window, then
	// clamp into the scrollable visual range.
	function scrollToLine(songLine) {
		console.log('[LyricDisplay scrollToLine]', { songLine, canScroll: canScroll(), contentStartLine, contentLineVisualStartsLen: contentLineVisualStarts.length });
		if (!canScroll()) return;
		if (contentLineVisualStarts.length === 0) return;
		const contentInWindow = songLine - contentStartLine;
		const clampedContent = Math.max(0, Math.min(contentLineVisualStarts.length - 1, contentInWindow));
		const targetVisual = contentLineVisualStarts[clampedContent] ?? 0;
		const next = clampVisualScrollLine(targetVisual);
		if (next === currentScrollLine) return;
		currentScrollLine = next;
		scrollOffsetPx = currentScrollLine * visualLineHeight;
	}

	// Build the fixed content-line window for this test from the section
	// anchor + maxDisplayedLines. Called once per song/setting change; visual
	// scroll within the rendered output is separate.
	function rebuildVisibleLines() {
		if (lyricsLines.length === 0) {
			visibleLines = [];
			return;
		}
		if ($maxDisplayedLines === 'full') {
			contentStartLine = 0;
			visibleLines = lyricsLines.slice();
			return;
		}
		const start = Math.max(0, Math.min(lyricsLines.length - 1, contentStartLine));
		const end = Math.min(lyricsLines.length, start + $maxDisplayedLines);
		visibleLines = lyricsLines.slice(start, end);
	}

	// Measure visual line layout from the rendered word elements. Run after
	// every DOM update; this also tracks cursor position so we can auto-scroll.
	function measureVisualLayout() {
		if (!innerEl || !viewportEl) return;

		const words = innerEl.querySelectorAll('.word');
		const fallbackLineHeight = windowHeight ? windowHeight * 0.06 : 24;

		if (words.length === 0) {
			visualLineTops = [];
			visualLineHeight = fallbackLineHeight;
			totalVisualLines = 0;
			cursorVisualLine = 0;
			contentLineVisualStarts = [];
		} else {
			const seen = new Set();
			const tops = [];
			words.forEach(w => {
				const t = w.offsetTop;
				if (!seen.has(t)) {
					seen.add(t);
					tops.push(t);
				}
			});
			tops.sort((a, b) => a - b);
			visualLineTops = tops;
			totalVisualLines = tops.length;
			visualLineHeight = tops.length >= 2 ? (tops[1] - tops[0]) : fallbackLineHeight;

			// cursorInfo.wordIndex indexes into formattedLyrics (words + spaces);
			// querySelectorAll('.word') only returns word items — translate the index
			let wordDomIndex = 0;
			for (let i = 0; i < cursorInfo.wordIndex && i < formattedLyrics.length; i++) {
				if (formattedLyrics[i].type === 'word') wordDomIndex++;
			}
			const cw = words[wordDomIndex] || words[words.length - 1];
			if (cw) {
				const top = cw.offsetTop;
				const idx = visualLineTops.indexOf(top);
				cursorVisualLine = idx >= 0 ? idx : 0;
			}

			// content-line → first-visual-line map. each newline in formattedLyrics
			// advances the content-line index; we record the visual-line of the
			// first word in each content line. used for song-relative thumb pos.
			const starts = [];
			const assigned = new Set();
			let curContent = 0;
			let domIdx = 0;
			for (let i = 0; i < formattedLyrics.length; i++) {
				const item = formattedLyrics[i];
				if (item.type === 'space' && item.char === '\n') {
					curContent++;
					continue;
				}
				if (item.type === 'word') {
					if (!assigned.has(curContent)) {
						const w = words[domIdx];
						if (w) {
							const t = w.offsetTop;
							const vIdx = visualLineTops.indexOf(t);
							starts[curContent] = vIdx >= 0 ? vIdx : 0;
							assigned.add(curContent);
						}
					}
					domIdx++;
				}
			}
			// content lines with no rendered words inherit the previous start
			for (let i = 0; i < visibleLines.length; i++) {
				if (starts[i] === undefined) {
					starts[i] = i > 0 ? starts[i - 1] : 0;
				}
			}
			contentLineVisualStarts = starts;
		}

		viewportHeight = viewportEl.clientHeight;
		fitsCount = Math.max(1, Math.floor(viewportHeight / Math.max(1, visualLineHeight)));

		// when fewer than CURSOR_TARGET_LINE+1 lines fit, clamp the target slot
		// to the last visible line so cursor never falls off the bottom
		const targetSlot = Math.min(CURSOR_TARGET_LINE, fitsCount - 1);
		const target = testStarted
			? clampVisualScrollLine(cursorVisualLine - targetSlot)
			: clampVisualScrollLine(currentScrollLine);
		if (target !== currentScrollLine) {
			currentScrollLine = target;
		}
		const newOffset = currentScrollLine * visualLineHeight;
		if (newOffset !== scrollOffsetPx) {
			scrollOffsetPx = newOffset;
		}

		if (DEBUG_LAYOUT) debugLayout();
	}

	// walk up from .lyrics-inner and print every ancestor's box metrics +
	// resolved CSS so we can see where the height chain breaks
	function debugLayout() {
		// throttle: log every ~30 measures to avoid spam during typing
		debugLogged++;
		if (debugLogged % 30 !== 1) return;

		const fmt = (el) => {
			const cs = window.getComputedStyle(el);
			return {
				tag: el.tagName.toLowerCase(),
				cls: el.className && typeof el.className === 'string' ? el.className : '',
				clientH: el.clientHeight,
				offsetH: el.offsetHeight,
				scrollH: el.scrollHeight,
				cssH: cs.height,
				maxH: cs.maxHeight,
				display: cs.display,
				position: cs.position,
				overflow: `${cs.overflowX}/${cs.overflowY}`,
				flex: cs.flex,
				padding: cs.padding,
				boxSizing: cs.boxSizing
			};
		};

		const chain = [];
		let cur = innerEl;
		for (let i = 0; i < 12 && cur; i++) {
			chain.push(fmt(cur));
			cur = cur.parentElement;
		}

		console.groupCollapsed(`[LyricDisplay debug #${debugLogged}]`);
		console.log('windowHeight prop:', windowHeight);
		console.log('viewport.clientHeight:', viewportEl.clientHeight, 'scrollHeight:', viewportEl.scrollHeight);
		console.log('inner.clientHeight:', innerEl.clientHeight, 'scrollHeight:', innerEl.scrollHeight);
		console.log('measured visualLineHeight:', visualLineHeight, '(fallback would be', windowHeight * 0.06, ')');
		console.log('totalVisualLines:', totalVisualLines, 'fitsCount:', fitsCount);
		console.log('currentScrollLine:', currentScrollLine, 'scrollOffsetPx:', scrollOffsetPx);
		console.log('cursorVisualLine:', cursorVisualLine, 'cursorInfo:', { ...cursorInfo });
		console.log('visualLineTops (first 6):', visualLineTops.slice(0, 6));
		console.log('--- ancestor chain (inner → up) ---');
		chain.forEach((row, i) => console.log(i, row));
		console.groupEnd();
	}

	afterUpdate(() => {
		measureVisualLayout();
	});


	// build content lines for the current song. legacy paths (setDisplayFromData*)
	// pass raw lyrics without prior section parsing, so parse defensively here
	// when contentLyrics isn't provided.
	$: {
		let newLines = [];
		let defaultStart = 0;
		if (contentLyrics) {
			newLines = processLyricsIntoLines(contentLyrics);
			defaultStart = startContentLineIndex ?? 0;
		} else {
			const raw = fullLyrics ?? lyrics;
			if (raw) {
				const { contentLines, anchors } = parseLyricSections(raw);
				newLines = contentLines;
				defaultStart = pickStartAnchor(contentLines.length, anchors, $maxDisplayedLines);
			}
		}
		if (newLines.length > 0) {
			const sourceChanged = newLines.join('\n') !== lyricsLines.join('\n');
			lyricsLines = newLines;
			if (sourceChanged) {
				contentStartLine = Math.max(0, Math.min(newLines.length - 1, defaultStart));
				currentScrollLine = 0;
				rebuildVisibleLines();
				console.log('[LyricDisplay source-change]', {
					path: contentLyrics ? 'contentLyrics' : 'fallback',
					totalContentLines: newLines.length,
					defaultStart,
					contentStartLine,
					maxDisplayedLines: $maxDisplayedLines,
					visibleLinesLen: visibleLines.length,
					startContentLineIndexProp: startContentLineIndex
				});
			}
		}
	}

	// rebuild content window when max line setting changes (anchor stays)
	$: if ($maxDisplayedLines !== undefined && lyricsLines.length > 0) {
		rebuildVisibleLines();
	}

	// Expose scroll functions to parent components
	export let onScrollToLine = null;

	$: {
		onScrollUp = scrollLyricsUp;
		onScrollDown = scrollLyricsDown;
		onScrollToLine = scrollToLine;
	}

	// Export scroll position for scrollbar thumb
	export let scrollPosition = { currentLine: 0, totalLines: 0, visibleLines: 4 };

	// song-relative scrollbar coords: position and size reflect the entire
	// song, not just the rendered test window. as the user scrolls visually
	// within the window, currentLine slides through the song accordingly.
	$: {
		const totalSongLines = lyricsLines.length;
		let topContentInWindow = 0;
		for (let i = 0; i < contentLineVisualStarts.length; i++) {
			if (contentLineVisualStarts[i] <= currentScrollLine) {
				topContentInWindow = i;
			} else {
				break;
			}
		}
		const bottomVisualLine = currentScrollLine + fitsCount;
		let visibleContentCount = 0;
		for (let i = 0; i < contentLineVisualStarts.length; i++) {
			const start = contentLineVisualStarts[i];
			if (start >= currentScrollLine && start < bottomVisualLine) {
				visibleContentCount++;
			}
		}
		if (visibleContentCount === 0) visibleContentCount = 1;
		scrollPosition = {
			currentLine: contentStartLine + topContentInWindow,
			totalLines: totalSongLines,
			visibleLines: visibleContentCount
		};
		if (DEBUG_LAYOUT && debugLogged % 30 === 1) {
			console.log('[LyricDisplay scrollPosition]', {
				contentStartLine,
				topContentInWindow,
				currentScrollLine,
				fitsCount,
				contentLineVisualStartsLen: contentLineVisualStarts.length,
				firstStarts: contentLineVisualStarts.slice(0, 6),
				totalSongLines,
				visibleContentCount,
				scrollPosition_out: { currentLine: contentStartLine + topContentInWindow, totalLines: totalSongLines, visibleLines: visibleContentCount }
			});
		}
	}

	async function preloadImage(src) {
		try {
			const img = new Image();
			img.src = src;
			img.onload = () => {
				preloadedImage = img;
			};
		} catch (error) {
			console.error('Error preloading image:', error);
		}
	}

	function startTest() {
		if (!testStarted) {
			startTime = new Date();
			testStarted = true;
			// Start image preload when test starts
			if (imageUrl) preloadImage(imageUrl);
			// Start live WPM tracking
			startLiveWpmTracking();
		}
	}

	// Calculate live WPM based on current progress
	function calculateLiveWpm() {
		if (!testStarted || !startTime) {
			liveWpm = 0;
			return;
		}
		
		const currentTime = new Date();
		// Calculate actual typing time by subtracting pause time
		const currentPauseTime = pauseStartTime ? (currentTime - pauseStartTime) : 0;
		const actualDuration = (currentTime - startTime) - totalPauseTime - currentPauseTime;
		const durationInMinutes = actualDuration / 60000;
		
		if (durationInMinutes <= 0) {
			liveWpm = 0;
			return;
		}
		
		const charactersTyped = userInput.length;
		const rawWpm = (charactersTyped / 5) / durationInMinutes;
		
		// Calculate errors for penalty
		let incorrectChars = 0;
		if (typingState.classes) {
			typingState.classes.forEach(item => {
				if (item.type === 'word') {
					item.chars.forEach(charClass => {
						if (charClass === 'incorrect') {
							incorrectChars++;
						}
					});
				} else if (item.class === 'incorrect') {
					incorrectChars++;
				}
			});
		}
		
		// Apply error penalty (same as final calculation)
		liveWpm = Math.max(rawWpm - (incorrectChars * 3), 0);
	}

	// Start live WPM tracking interval
	function startLiveWpmTracking() {
		if (liveWpmInterval) {
			clearInterval(liveWpmInterval);
		}
		
		liveWpmInterval = setInterval(() => {
			if (testStarted && !isPaused) {
				calculateLiveWpm();
			}
		}, 500); // Update every 500ms
	}

	// Stop live WPM tracking
	function stopLiveWpmTracking() {
		if (liveWpmInterval) {
			clearInterval(liveWpmInterval);
			liveWpmInterval = null;
		}
	}

	function replaySongInner() {
		showResults = false;
		userInput = '';
		testStarted = false;
		liveWpm = 0;
		frozenWpm = 0;
		frozenAccuracy = 0;
		frozenTypingState = { classes: [] };
		stopLiveWpmTracking();
		setTimeout(() => { // Wait for the DOM to update before focusing the input
			focusInput();
		}, 0);
		replaySong();
	}

	function focusInput() {
		if(inputElement) inputElement.focus();
		blink = true;
	}

	function blurInput() {
		if(inputElement) inputElement.blur();
		console.log("BLURRING")
		blink = false;
	}
	
	$: document.documentElement.style.setProperty('--correct-color', $correctionColors.correct);
	$: document.documentElement.style.setProperty('--incorrect-color', $correctionColors.incorrect);

	onMount(() => {
		focusInput();
		if (imageUrl) preloadImage(imageUrl);
		
		// Listen for restart test events
		const handleRestartTest = async (event) => {
			// Reset all typing test state
			showResults = false;
			userInput = '';
			testStarted = false;
			startTime = null;
			endTime = null;
			cursorPosition = 0;
			totalPauseTime = 0;
			pauseStartTime = null;
			liveWpm = 0;
			frozenWpm = 0;
			frozenAccuracy = 0;
			frozenTypingState = { classes: [] };
			
			// Stop live WPM tracking
			stopLiveWpmTracking();
			
			// Reset typing state classes
			typingState.classes = [];
			
			// wait for prop updates; the source-change reactive block then
			// re-anchors scroll to startContentLineIndex for the new song
			await tick();

			focusInput();
		};
		
		// Listen for unpause events
		const handleUnpauseTest = () => {
			// Restore focus and make cursor blink when unpausing
			setTimeout(() => {
				focusInput();
			}, 0);
		};
		
		window.addEventListener('restartTest', handleRestartTest);
		window.addEventListener('unpauseTest', handleUnpauseTest);
		
		// Cleanup on unmount
		return () => {
			window.removeEventListener('restartTest', handleRestartTest);
			window.removeEventListener('unpauseTest', handleUnpauseTest);
			stopLiveWpmTracking();
		};
	});

	// Mappings for characters that aren't handled by normalize-text
	const customCharMap = {
		'¿': '?',
		'¡': '!',
		'\n': ' ',
		'ı': 'i',
		'İ': 'I',
		'Ł': 'L',
		'ł': 'l',
		'’': "'",
		'‘': "'",
		"—": "-",
	};

	function lyricsToPreferences(text){
		let normalized = text;
		// Handle capitalization based on store value
		if (!capitalization) {
			console.log("lowercasing lyrics");
			normalized = normalized.toLowerCase();
		}
		
		// Handle punctuation based on store value
		if (!punctuation) {
			console.log("removing punctuation from lyrics");
			// Remove all punctuation - keep only letters, numbers, and spaces
			normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, '');
		}
		console.log("Original lyrics:", text?.substring(0, 100));
		console.log("Modified lyrics:", normalized?.substring(0, 100));
		return normalized;
	}

	// Helper function to apply both normalize-text and our custom mappings
	function customNormalize(text) {
		// Ensure we're working with a string
		let normalized = String(text || '');
		
		// Apply custom replacements
		Object.entries(customCharMap).forEach(([from, to]) => {
			normalized = normalized.replace(new RegExp(from, 'g'), to);
		});
		
		// Apply diacritic normalization
		normalized = normalizeDiacritics(normalized);
		
		return normalized;
	}

	// Derived lyrics based on toggles and scrolling
	$: transformedLyrics = (() => {
		// Use visible lines if scrolling is active, otherwise use full lyrics
		const lyricsToUse = visibleLines.length > 0 ? visibleLines.join('\n') : lyrics;
		let out = lyricsToUse ? (capitalization ? lyricsToUse : lyricsToUse.toLowerCase()) : '';
		if (!punctuation) out = out.replace(/[^\p{L}\p{N}\s]/gu, '');
		return out;
	})();

// Reset test when toggles change
let lastCap = capitalization;
let lastPunct = punctuation;

$: if (capitalization !== lastCap || punctuation !== lastPunct) {
    // Only reset test if we're actively typing (not on results page)
    if ((userInput.length > 0 || testStarted) && !showResults) {
        // Reset test state
        showResults = false;
        userInput = '';
        testStarted = false;
        startTime = null;
        endTime = null;
        totalPauseTime = 0;
        pauseStartTime = null;
        cursorPosition = 0;
        liveWpm = 0;
        typingState.classes = [];

        // Stop live WPM tracking
        stopLiveWpmTracking();

        setTimeout(() => {
            focusInput();
        }, 0);
    }
    
    // Always update last known values (even on results page)
    lastCap = capitalization;
    lastPunct = punctuation;
}

// Use transformedLyrics everywhere instead of lyrics
$: modifiedLyrics = transformedLyrics;
$: normalizedLyrics = customNormalize(modifiedLyrics);

function handleKeydown(event) {
		// Handle arrow keys for scrolling
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (onScrollUp && typeof onScrollUp === 'function') {
				onScrollUp();
			}
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (onScrollDown && typeof onScrollDown === 'function') {
				onScrollDown();
			}
		}
	}

	function handleInput(event) {
		const newValue = event.target.value;
		const normalizedNextChar = normalizeDiacritics(String([modifiedLyrics[userInput.length]]));
		const normalizedLastChar = normalizeDiacritics(String([newValue[newValue.length - 1]]));
		
		if (newValue.length > userInput.length) {
			const lastTypedChar = newValue[newValue.length - 1];

			if(lastTypedChar === '~'){ // Escape test
				endTest();
				return;
			}
			
			// Prevent user from typing non-space characters when the next character is a space or newline
			if ((normalizedNextChar === ' ' || normalizedNextChar === '\n') && normalizedLastChar !== ' ') {
				event.target.value = userInput;
				return;
			}
			
			// Prevent user from typing a space when the next character is not a space or newline
			if (normalizedNextChar !== ' ' && normalizedNextChar !== '\n' && normalizedLastChar === ' ') {
				event.target.value = userInput;
				return;
			}
		}
		userInput = event.target.value;
	}

  	// Function to end the test and calculate WPM and accuracy
	function endTest() {
		stopLiveWpmTracking();
		endTime = new Date();
		// Calculate actual typing time by subtracting pause time
		const actualDuration = (endTime - startTime) - totalPauseTime;
		const durationInMinutes = actualDuration / 60000;
		const charactersTyped = userInput.length;
		wpm = (charactersTyped / 5) / durationInMinutes;

		let incorrectChars = 0;
		
		// Go through each item in classes
		typingState.classes.forEach(item => {
			if (item.type === 'word') {
			// For words, check each character's class
			item.chars.forEach(charClass => {
				if (charClass === 'incorrect') {
				incorrectChars++;
				}
			});
			} else if (item.class === 'incorrect') {
			// For spaces, check the class directly
			incorrectChars++;
			}
		});
		
		// Calculate accuracy
		accuracy = ((charactersTyped - incorrectChars) / charactersTyped) * 100;
		
		// Ensure accuracy is between 0 and 100 
		accuracy = Math.max(0, Math.min(100, accuracy));

		wpm = Math.max(wpm - (incorrectChars * 3), 0);

		// sync bottom-bar live wpm to final value so it matches results screen
		liveWpm = wpm;

		// Freeze the results so toggle changes don't affect them
		frozenWpm = wpm;
		frozenAccuracy = accuracy;
		frozenTypingState = JSON.parse(JSON.stringify(typingState)); // Deep copy
		
		showResults = true;

		console.log(`WPM: ${wpm.toFixed(2)}, Accuracy: ${accuracy.toFixed(2)}%`);
		console.log('Typed characters:', charactersTyped);
		console.log('Incorrect characters:', incorrectChars);

		// Save completed test to trash
		if (songId && songTitle && artistName) {
			const testResults = formatTestResultsForTrash({
				songId,
				songTitle,
				artistName,
				artistUrlKey, // Include artistUrlKey for trash replay functionality
				imageUrl,
				albumArtId,
				geniusUrl,
				wpm,
				accuracy,
				charactersTyped,
				incorrectChars,
				testDuration: durationInMinutes,
				lyricsLength: lyrics?.length || 0,
			});
			
			trashStore.addCompletedSong(testResults);
			console.log('Song saved to trash:', testResults.fileName, 'artistUrlKey:', artistUrlKey);
		}
	}
  
	$: if (lyrics && !userInput && !testStarted) {
		// Only reset when lyrics change and there's no active test
		showResults = false;
		userInput = '';
		testStarted = false;
		totalPauseTime = 0;
		pauseStartTime = null;
		frozenWpm = 0;
		frozenAccuracy = 0;
		frozenTypingState = { classes: [] };
		setTimeout(() => { // Wait for the DOM to update before focusing the input
			focusInput();
		}, 0);
	}

	// Handle pause state changes
	$: if (isPaused && testStarted && !pauseStartTime) {
		// Pause started
		pauseStartTime = new Date();
	} else if (!isPaused && pauseStartTime) {
		// Pause ended
		const pauseEndTime = new Date();
		totalPauseTime += (pauseEndTime - pauseStartTime);
		pauseStartTime = null;
	}
	


function formatLyricsIntoWords(text) {
	const chars = text.split('');
	const result = [];
	let currentWord = [];
	
	chars.forEach((char, index) => {
		if (char === ' ' || char === '\n') {
		// If we have a current word, add it to result
		if (currentWord.length > 0) {
			const wordChars = currentWord.map(char => ({
			char: char,
			class: ''
			}));
			result.push({
			type: 'word',
			chars: wordChars
			});
			currentWord = [];
		}
		// Add the space/newline as its own item
		result.push({
			type: 'space',
			char,
			class: ''
		});
		} else {
		// Add character to current word
		currentWord.push(char);
		}
	});
	
	// Don't forget to add the last word if it exists
	if (currentWord.length > 0) {
		const wordChars = currentWord.map(char => ({
		char: char,
		class: ''
		}));
		result.push({
		type: 'word',
		chars: wordChars
		});
	}
	
	return result;
}

// Add this to store cursor position information
let cursorInfo = { wordIndex: 0, charIndex: 0 };

// Update cursor info whenever position changes
$: {
	let totalChars = 0;
	let found = false;
	
	for (let wordIndex = 0; wordIndex < formattedLyrics.length && !found; wordIndex++) {
		const item = formattedLyrics[wordIndex];
		
		if (item.type === 'word') {
		// Important: Check BEFORE the first character of the word
		if (totalChars === cursorPosition) {
			cursorInfo = { wordIndex, charIndex: 0 };
			found = true;
			break;
		}
		
		// Then check rest of characters
		for (let charIndex = 0; charIndex < item.chars.length; charIndex++) {
			totalChars++;
			if (totalChars === cursorPosition) {
				cursorInfo = { wordIndex, charIndex: charIndex + 1 };
			found = true;
			break;
			}
		}
		} else { // space
		if (totalChars === cursorPosition) {
			cursorInfo = { wordIndex, charIndex: 0 };
			found = true;
		}
		totalChars++; // Count the space
		if (totalChars === cursorPosition && !found) {
			cursorInfo = { wordIndex, charIndex: 0 };
			found = true;
		}
		}
	}
	
	// Handle cursor at very end
	if (!found && cursorPosition === totalChars) {
		const lastIndex = formattedLyrics.length - 1;
		cursorInfo = {
		wordIndex: lastIndex,
		charIndex: formattedLyrics[lastIndex].type === 'word' ? 
			formattedLyrics[lastIndex].chars.length : 1
		};
	}
}

// First, let's make formattedLyrics only depend on lyrics
$: formattedLyrics = modifiedLyrics ? formatLyricsIntoWords(modifiedLyrics) : [];

// Then, let's create a separate reactive statement for classes
$: typingState = {
	formattedLyrics,
	userInput,
	cursorPosition,
	classes: []
};

// Handle all typing-related updates in one place
$: {
	// Don't recalculate typing state when showing results (frozen state is used instead)
	if (!showResults) {
		if (userInput && formattedLyrics.length > 0) {
			if (!testStarted) startTest();
			
			const normalizedUserInput = customNormalize(userInput);
			const normalizedLyricsChars = normalizedLyrics.split('');
			const normalizedInputChars = normalizedUserInput.split('');
			let inputIndex = 0;

			// Update classes without modifying formattedLyrics structure
			typingState.classes = formattedLyrics.map(item => {
			if (item.type === 'word') {
				return {
				type: 'word',
				chars: item.chars.map(charInfo => {
					const currentClass = inputIndex < normalizedUserInput.length 
					? (normalizedInputChars[inputIndex] === normalizedLyricsChars[inputIndex] ? 'correct' : 'incorrect')
					: '';
					inputIndex++;
					return currentClass;
				})
				};
			} else {
				const currentClass = inputIndex < normalizedUserInput.length 
				? (normalizedInputChars[inputIndex] === normalizedLyricsChars[inputIndex] ? 'correct' : 'incorrect')
				: '';
				inputIndex++;
				return {
				type: 'space',
				class: currentClass
				};
			}
			});

			if (userInput.length === modifiedLyrics.length) endTest();
		} else {
			typingState.classes = formattedLyrics.map(item => {
			if (item.type === 'word') {
				return {
				type: 'word',
				chars: item.chars.map(() => '')
				};
			}
			return {
				type: 'space',
				class: ''
			};
			});
		}
	}
}


	$: cursorPosition = userInput.length;
	$: cursorWidth = windowHeight * 0.002;
	$: cursorPadding = windowHeight * -0.0005;
	$: cursorHeight = windowHeight * 0.040;
	$: cursorYOffset = windowHeight * .004;

	$: if (imageUrl) {
		preloadImage(imageUrl);
	}
</script>

{#if showResults && preloadedImage}
    <ResultsDisplay
        wpm={frozenWpm}
        accuracy={frozenAccuracy}
        {songTitle}
        {artistName}
        imageUrl={imageUrl}
        {albumArtId}
        {preloadedAlbumArt}
        {continueFromQueue}
        replaySong={replaySongInner}
        {geniusUrl}
    />
{:else}
    <div
        class="quote-display"
        bind:this={viewportEl}
        role="button"
        tabindex="0"
        on:click={focusInput}
        on:keydown={focusInput}
		on:blur={blurInput}
        style="line-height:{windowHeight*0.06}px; font-size: 0px"
    >
        {#if isPaused}
            <div class="pause-overlay">
                <div class="pause-message" style="width: {windowHeight * 0.20}px; height: {windowHeight * 0.20}px; font-size: {windowHeight * 0.03}px; padding: {windowHeight * 0.02}px; border-width: {windowHeight * 0.015}px; border-radius: {windowHeight * 0.008}px;">
                    <svg class="pause-icon" viewBox="0 0 24 24" style="width: 90%; height: 90%;">
                        <path d="M6 4H10V20H6V4ZM14 4H18V20H14V4Z"/>
                    </svg>
                </div>
            </div>
        {/if}
		<div class="lyrics-inner" bind:this={innerEl} style="transform: translateY(-{scrollOffsetPx}px);">
		{#each formattedLyrics as item, wordIndex}
			{@const cursorAtBeginning = (cursorInfo.wordIndex === 0 && wordIndex === 0) && cursorInfo.charIndex === 0}
			{@const cursorAtWordStart = cursorInfo.wordIndex + 1 === wordIndex}
			{@const cursorStyle = `height:${cursorHeight}px; width:${Math.ceil(cursorWidth)}px;
				margin:0 ${cursorPadding}px; transform: translateY(${cursorYOffset}px);`}
			{@const textStyle = `font-size:${windowHeight*0.04}px; height:${windowHeight*0.04}px`}
			
			<!-- Handle words (spaces handled within words (attached to end)) -->
			{#if item.type === 'word'}
				<span class="word" style="margin-bottom: {windowHeight * 0.025}px;">
					<!-- Add cursor to beginning of word -->
					{#if cursorAtWordStart || cursorAtBeginning && blink}			
						<span class="blinking-cursor" style={cursorStyle}></span>
					{:else}
						<span class="cursor-placeholder" style={cursorStyle}></span>
					{/if}
					<!-- Render characters of word -->
					{#each item.chars as charInfo, charIndex}
						<span
							class={typingState.classes[wordIndex]?.chars?.[charIndex] || ''}
							style={textStyle}
						>
							{charInfo.char}
						</span>
						<!-- Add cursor after each character -->
						{#if cursorInfo.wordIndex === wordIndex && cursorInfo.charIndex === (charIndex + 1) && blink}
							<span class="blinking-cursor" style={cursorStyle}></span>
						{:else}
							<span class="cursor-placeholder" style={cursorStyle}></span>
						{/if}
					{/each}

									<!-- Check if this is followed by a space, and if so, include it -->
				{#if wordIndex < formattedLyrics.length - 1 && formattedLyrics[wordIndex + 1].type === 'space'}
					<!-- Include trailing space in the same word span -->
					<span
						class={typingState.classes[wordIndex + 1]?.class || ''}
						style={textStyle}
					>
						{formattedLyrics[wordIndex + 1].char === ' ' ? '\u00A0' : formattedLyrics[wordIndex + 1].char}
					</span>
				{/if}
				</span>
			<!-- Handle only newlines separately -->
			{:else if item.type === 'space' && item.char === '\n'}
				<span class="newline" style="flex-basis: 100%; height: 0; width: 0;">
					{"\n"}
				</span>
			{/if}
		{/each}
		</div>

		<input
			bind:this={inputElement}
			class="quote-input"
			type="text"
			on:input={handleInput}
			on:keydown={handleKeydown}
			bind:value={userInput}
			on:blur={blurInput}
			disabled={isPaused}
		/>
    </div>
{/if}

<style>
	* {
		box-sizing: border-box;
	}
	.container {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.hidden {
		display: none;
	}

	.visible {
		display: block;
	}

	.results-container {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}

	.quote-display{
		padding: 1.5%;
		font-family: "Geneva", sans-serif;
		font-weight: 500;
		color: var(--primary-color);
		position: relative;
		max-width: 100%;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.lyrics-inner {
		position: absolute;
		top: 1.5%;
		left: 1.5%;
		right: 1.5%;
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		align-items: baseline;
		will-change: transform;
		/* Safari-specific fixes */
		-webkit-flex-wrap: wrap;
		-webkit-align-content: flex-start;
	}

	.pause-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 10;
		display: flex;
		justify-content: center;
		align-items: center;
		background-size: 2px 2px;
		background-image:
			linear-gradient(45deg, var(--primary-color) 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color));
		outline: none;
	}

	.pause-message {
		font-family: "Geneva", sans-serif;
		font-size: 2em;
		font-weight: bold;
		color: var(--seconday-color);
		padding: 20px;
		border: 10px solid var(--secondary-color);
		border-radius: 8px;
		aspect-ratio: 1/1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 15vh;
		height: 15vh;
	}

	.quote-input {
		position: absolute;
		opacity: 0;
		background-color: transparent;
	}
	.correct {
		color: var(--correct-color);
	}

	.incorrect {
		color: var(--incorrect-color);
	}

	.word {
		/* Ensure words behave as flex items */
		display: inline-flex;
		flex: none;
		align-items: baseline;
		white-space: pre;
		/* Add bottom margin for line spacing */
		margin-bottom: 1em;
		margin-right: 0;
		/* Safari-specific flexbox fixes */
		-webkit-flex: none;
		-webkit-align-items: baseline;
	}

	.newline {
		/* Force line breaks in flexbox */
		flex-basis: 100%;
		height: 0;
		width: 0;
		/* Safari-specific */
		-webkit-flex-basis: 100%;
	}

	.pause-icon {
		fill: var(--secondary-color);
	}

	.blinking-cursor {
		display: inline-block;
		margin-right: -.15em;
		margin-left: .15em;
		background-color: currentColor;
		animation: blink-animation 1s steps(1) infinite;
		transition: transform 0.1s cubic-bezier(0.4, 0, 0.2, 1);
		color: var(--primary-color);
	}
	.cursor-placeholder {
		display: inline-block;
		margin-right: -.15em;
		margin-left: .15em;
	}

	@keyframes blink-animation {
		50% {
			opacity: 0;
		}
	}
</style>

