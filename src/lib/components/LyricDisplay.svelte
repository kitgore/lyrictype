<script>
	import { onMount } from 'svelte';
	import ResultsDisplay from './ResultsDisplay.svelte';
	import { applyDitheringToImage } from '$lib/services/dither-utils';
	import { themeColors, ditherImages, imageColors, correctionColors, windowStore } from '$lib/services/store.js';
	import { normalizeDiacritics } from 'normalize-text';
	export let lyrics;
	export let songTitle;
	export let artistName;
	export let imageUrl;
	export let continueFromQueue;
	export let replaySong;
	export let geniusUrl;
	export let isPaused = false;
	export let capitalization = true;
	export let punctuation = true;
	let userInput = '';
	let startTime = null;
	let endTime = null;
	let testStarted = false;
	let pauseStartTime = null;
	let totalPauseTime = 0;

	// let lastCapitalization = $capitalization;
	// let lastPunctuation = $punctuation;
	let cursorPosition = 0;
	let inputElement;
	let showResults = false;
	let wpm = 0;
	let accuracy = 0;
	let preloadedImage;
	let ditheredImageUrl = '';
	let normalizedLyrics;
	let blink = false;
  
	$: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;

	
	async function preloadAndDitherImage(src) {
		try {
		// First dither the image
		const dithered = await applyDitheringToImage(src, $imageColors.primary, $imageColors.secondary, $ditherImages);
		ditheredImageUrl = dithered;
		
		// Then preload it
		const img = new Image();
		img.src = ditheredImageUrl;
		img.onload = () => {
			preloadedImage = img;
		};
		} catch (error) {
		console.error('Error in preload and dither:', error);
		// Fallback to original image
		const img = new Image();
		img.src = src;
		img.onload = () => {
			preloadedImage = img;
			ditheredImageUrl = src;
		};
		}
	}

	function startTest() {
		if (!testStarted) {
			startTime = new Date();
			testStarted = true;
			// Start dithering process when test starts
			if (imageUrl) preloadAndDitherImage(imageUrl);
		}
	}

	function replaySongInner() {
		showResults = false;
		userInput = '';
		testStarted = false;
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
		if (imageUrl) preloadAndDitherImage(imageUrl);
		
		// Listen for restart test events
		const handleRestartTest = (event) => {
			// Reset all typing test state
			showResults = false;
			userInput = '';
			testStarted = false;
			startTime = null;
			endTime = null;
			cursorPosition = 0;
			totalPauseTime = 0;
			pauseStartTime = null;
			
			// Reset typing state classes
			typingState.classes = [];
			
			// Focus the input after a short delay to ensure DOM is updated
			setTimeout(() => {
				focusInput();
			}, 0);
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
		};
	});

	// Mappings for characters that aren't handled by normalize-text
	const customCharMap = {
		'¿': '?',
		'¡': '!',
		'\n': ' ',
		'ı': 'i',
		'İ': 'I',
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

	// Derived lyrics based on toggles
	$: transformedLyrics = (() => {
    let out = lyrics ? (capitalization ? lyrics : lyrics.toLowerCase()) : '';
    if (!punctuation) out = out.replace(/[^\p{L}\p{N}\s]/gu, '');
    return out;
})();

// Reset test when toggles change
let lastCap = capitalization;
let lastPunct = punctuation;

$: if ((capitalization !== lastCap || punctuation !== lastPunct) && (userInput.length > 0 || testStarted)) {
    // Reset test state
    showResults = false;
    userInput = '';
    testStarted = false;
    startTime = null;
    endTime = null;
    totalPauseTime = 0;
    pauseStartTime = null;
    cursorPosition = 0;
    typingState.classes = [];

    // Update last known values
    lastCap = capitalization;
    lastPunct = punctuation;

    setTimeout(() => {
        focusInput();
    }, 0);
}

// Use transformedLyrics everywhere instead of lyrics
$: modifiedLyrics = transformedLyrics;
$: normalizedLyrics = customNormalize(modifiedLyrics);

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
		
		showResults = true;

		console.log(`WPM: ${wpm.toFixed(2)}, Accuracy: ${accuracy.toFixed(2)}%`);
		console.log('Typed characters:', charactersTyped);
		console.log('Incorrect characters:', incorrectChars);
	}
  
	$: if (lyrics && !userInput && !testStarted) {
		// Only reset when lyrics change and there's no active test
		showResults = false;
		userInput = '';
		testStarted = false;
		totalPauseTime = 0;
		pauseStartTime = null;
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


	$: cursorPosition = userInput.length;
	$: cursorWidth = windowHeight * 0.002;
	$: cursorPadding = windowHeight * -0.0005;
	$: cursorHeight = windowHeight * 0.038;
	$: cursorYOffset = -windowHeight * 0.002;

	$: if ($ditherImages || $imageColors) {
		preloadAndDitherImage(imageUrl);
	}
	else{
		ditheredImageUrl = imageUrl;
	}
</script>

{#if showResults && preloadedImage}
    <ResultsDisplay
        {wpm}
        {accuracy}
        {songTitle}
        {artistName}
        imageUrl={ditheredImageUrl}
        {continueFromQueue}
        replaySong={replaySongInner}
        {geniusUrl}
    />
{:else}
    <div 
        class="quote-display" 
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
		{#each formattedLyrics as item, wordIndex}
			{@const cursorAtBeginning = (cursorInfo.wordIndex === 0 && wordIndex === 0) && cursorInfo.charIndex === 0}
			{@const cursorAtWordStart = cursorInfo.wordIndex + 1 === wordIndex}
			{@const cursorStyle = `height:${cursorHeight}px; width:${Math.ceil(cursorWidth)}px;
				margin:0 ${cursorPadding}px; margin-bottom: ${cursorYOffset}px`}
			{@const textStyle = `font-size:${windowHeight*0.04}px; height:${windowHeight*0.04}px`}
			
			<!-- Handle words (spaces handled within words (attached to end)) -->
			{#if item.type === 'word'}
				<span class="word" style="display: inline-block; white-space: prewrap;">
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
							{formattedLyrics[wordIndex + 1].char === ' ' ? ' ' : formattedLyrics[wordIndex + 1].char}
						</span>
					{/if}
				</span>
			<!-- Handle only newlines separately -->
			{:else if item.type === 'space' && item.char === '\n'}
				<span class="newline">
					{"\n"}
				</span>
			{/if}
		{/each}
			
		<input
			bind:this={inputElement}
			class="quote-input"
			type="text"
			on:input={handleInput}
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
		white-space: pre-wrap;
		padding: 1.5%;
		font-family: "Geneva", sans-serif;
		font-weight: 500;
		color: var(--primary-color);
		position: relative;
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

	.pause-icon {
		fill: var(--secondary-color);
	}

	.blinking-cursor {
		display: inline-block;
		width: 2px; 
		height: 1.2em;
		/* margin: 0; */
		margin-right: -.15em;
		margin-left: .15em;
		background-color: currentColor;
		animation: blink-animation 1s steps(1) infinite;
		transition: transform 0.1s cubic-bezier(0.4, 0, 0.2, 1);
		color: var(--primary-color);
	}
	.cursor-placeholder {
		display: inline-block;
		width: 2px; 
		height: 1.2em;
		margin-right: -.15em;
		margin-left: .15em;
		/* margin: 0; */
	}

	@keyframes blink-animation {
		50% {
			opacity: 0;
		}
	}
</style>

