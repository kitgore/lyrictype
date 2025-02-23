<script>
	import { onMount } from 'svelte';
	import ResultsDisplay from './ResultsDisplay.svelte';
	import { applyDitheringToImage } from '$lib/services/dither-utils';
	import { ditherImages, imageColors, correctionColors, windowStore } from '$lib/services/store.js';
	import { normalizeDiacritics } from 'normalize-text';
	export let lyrics;
	export let songTitle;
	export let artistName;
	export let imageUrl;
	export let continueFromQueue;
	export let replaySong;
	export let geniusUrl;
	let userInput = '';
	let startTime = null;
	let endTime = null;
	let testStarted = false;
	let cursorPosition = 0;
	let inputElement;
	let showResults = false;
	let wpm = 0;
	let accuracy = 0;
	let preloadedImage;
	let ditheredImageUrl = '';
	let normalizedLyrics;
  
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

	function focusInput() {
		if(inputElement) inputElement.focus();
	}
	
	$: document.documentElement.style.setProperty('--correct-color', $correctionColors.correct);
	$: document.documentElement.style.setProperty('--incorrect-color', $correctionColors.incorrect);

	onMount(() => {
		focusInput();
		if (imageUrl) preloadAndDitherImage(imageUrl);
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

	// Helper function to apply both normalize-text and our custom mappings
	function customNormalize(text) {
		// Ensure we're working with a string
		let normalized = String(text || '');
		// Apply custom replacements
		Object.entries(customCharMap).forEach(([from, to]) => {
		normalized = normalized.replace(new RegExp(from, 'g'), to);
		});
		// Apply diacritic normalization
		return normalizeDiacritics(normalized);
	}

	$: normalizedLyrics = customNormalize(lyrics);

	function handleInput(event) {
		console.log("Cursor Position: ", cursorPosition)
		const newValue = event.target.value;
		const normalizedNextChar = normalizeDiacritics(String([lyrics[userInput.length]]));
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
  const durationInMinutes = (endTime - startTime) / 60000;
  const charactersTyped = userInput.length;
  wpm = (charactersTyped / 5) / durationInMinutes;

  const incorrectChars = formattedLyrics.reduce((acc, item) => {
    if (item.type === 'word') {
      return acc + item.chars.reduce((wordAcc, char) => 
        wordAcc + (char.class === 'incorrect' ? 1 : 0), 0);
    }
    return acc + (item.class === 'incorrect' ? 1 : 0);
  }, 0);
  
  accuracy = ((charactersTyped - incorrectChars) / lyrics.length) * 100;
  showResults = true;

  console.log(`WPM: ${wpm.toFixed(2)}, Accuracy: ${accuracy.toFixed(2)}%`);
}
  
	$: if (lyrics) {
		// Reset state and focus when lyrics change
		showResults = false;
		userInput = '';
		testStarted = false;
		setTimeout(() => { // Wait for the DOM to update before focusing the input
			focusInput();
		}, 0);
	}
	
// Helper function to get total length (for end cursor)
function getTotalLength(formattedLyrics) {
  return formattedLyrics.reduce((total, item) => {
    if (item.type === 'word') {
      return total + item.chars.length;
    }
    return total + 1; // Space or newline
  }, 0);
}

// First, create a function to format lyrics into words
// Modified formatLyricsIntoWords to log the structure
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
        console.log('Adding word with chars:', wordChars);
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
    console.log('Adding final word with chars:', wordChars);
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
// Update cursor info whenever position changes
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
        cursorInfo = { wordIndex, charIndex: 1 };
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
  
  console.log('Cursor info updated:', cursorInfo, 'Position:', cursorPosition);
}

// Modify getCursorPosition to use cursorInfo
function getCursorPosition(wordIndex, charIndex) {
  return cursorInfo.wordIndex === wordIndex && cursorInfo.charIndex === charIndex;
}

// First, let's make formattedLyrics only depend on lyrics
$: formattedLyrics = lyrics ? formatLyricsIntoWords(lyrics) : [];

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

    if (userInput.length === lyrics.length) endTest();
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
	$: cursorWidth = windowHeight * 0.004;
	$: cursorPadding = windowHeight * 0.000;
	$: cursorHeight = windowHeight * 0.004;

	$: if ($ditherImages || $imageColors) {
		preloadAndDitherImage(imageUrl);
	}
	else{
		ditheredImageUrl = imageUrl;
	}

	$: console.log('ditherImages value:', $ditherImages);

	function replaySongInner() {
		showResults = false;
		userInput = '';
		testStarted = false;
		setTimeout(() => { // Wait for the DOM to update before focusing the input
			focusInput();
		}, 0);
		replaySong();
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
	<div class="quote-display" role="button" tabindex="0" on:click={focusInput} on:keydown={focusInput} 
	style="line-height:{windowHeight*0.06}px; font-size: 0px">
	{#each formattedLyrics as item, wordIndex}
	{#if item.type === 'word'}
	  <span class="word" style="display: inline-block; white-space: nowrap;">
		<!-- Check for cursor at start of word -->

		
		{#each item.chars as charInfo, charIndex}
		{#if cursorInfo.wordIndex === wordIndex && cursorInfo.charIndex === charIndex && cursorInfo.charIndex === 0}
			<span class="blinking-cursor" 
				style:height="{windowHeight*0.04}px"
				style:width="{cursorWidth}px"
				style:margin="0 {cursorPadding}px">
			</span>
		{:else if wordIndex === 0 && charIndex === 0}
			<span class="cursor-placeholder" 
				style:height="{windowHeight*0.04}px"
				style:width="{cursorWidth}px"
				style:margin="0 {cursorPadding}px">
			</span>
		{/if}
		  <span class={typingState.classes[wordIndex]?.chars?.[charIndex] || ''} 
				style="font-size:{windowHeight*0.04}px; 
					   height:{windowHeight*0.04}px;">
			{charInfo.char}
		  </span>
		  <!-- Check for cursor after each character -->
		  {#if cursorInfo.wordIndex === wordIndex && cursorInfo.charIndex === (charIndex + 1)}
			<span class="blinking-cursor" 
				  style:height="{windowHeight*0.04}px"
				  style:width="{cursorWidth}px"
				  style:margin="0 {cursorPadding}px">
			</span>
			{:else}
			<span class="cursor-placeholder" 
				style:height="{windowHeight*0.04}px"
				style:width="{cursorWidth}px"
				style:margin="0 {cursorPadding}px">
			</span>
		  {/if}
		{/each}
	  </span>
	{:else}
	  <!-- Space handling -->
	  {#if cursorInfo.wordIndex === wordIndex && cursorInfo.charIndex === 0}
		<span class="blinking-cursor" 
			  style:height="{windowHeight*0.04}px"
			  style:width="{cursorWidth}px"
			  style:margin="0 {cursorPadding}px">
		</span>
		{:else}
		<span class="cursor-placeholder" 
			style:height="{windowHeight*0.04}px"
			style:width="{cursorWidth}px"
			style:margin="0 {cursorPadding}px">
		</span>
	  {/if}
	  <span class={typingState.classes[wordIndex]?.class || ''} 
			style="font-size:{windowHeight*0.04}px; 
				   height:{windowHeight*0.04}px;">
		{item.char}
	  </span>
	  {#if cursorInfo.wordIndex === wordIndex && cursorInfo.charIndex === 1}
		<span class="blinking-cursor" 
			  style:height="{windowHeight*0.04}px"
			  style:width="{cursorWidth}px"
			  style:margin="0 {cursorPadding}px">
		</span>
		{:else}
		<span class="cursor-placeholder" 
			style:height="{windowHeight*0.04}px"
			style:width="{cursorWidth}px"
			style:margin="0 {cursorPadding}px">
		</span>
	  {/if}
	{/if}
  {/each}
  
  {#if cursorPosition === getTotalLength(formattedLyrics)}
	<span class="blinking-cursor" 
		style:height="{windowHeight*0.04}px"
		style:width="{cursorWidth}px"
		style:margin="0 {cursorPadding}px">
	</span>
  {/if}
		<input 
			bind:this={inputElement} 
			class="quote-input" 
			type="text" 
			on:input={handleInput}
			bind:value={userInput} 
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

