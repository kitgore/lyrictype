<script>
    import { searchArtists } from '$lib/services/artistService';
    import { createEventDispatcher } from 'svelte';
    
    export let tabIndex = 0;
    export let fontSize = 'inherit';
    export let windowHeight = 600; // Default fallback value
    
    const dispatch = createEventDispatcher();
    const maxSuggestions = 10;
    
    // Calculate responsive dropdown offset - using very small fixed value 
    $: dropdownOffset = windowHeight * 0.028; // Very small fixed offset
    // Use itemMinHeight directly as it's closer to actual rendered height
    $: dropdownMaxHeight = windowHeight * 0.65;
    
    // Calculate responsive dropdown item dimensions
    $: itemPaddingVertical = windowHeight ? windowHeight * 0.008 : 8; // 0.8% of window height, fallback 8px
    $: itemPaddingHorizontal = windowHeight ? windowHeight * 0.012 : 12; // 1.2% of window height, fallback 12px
    $: itemBorderWidth = windowHeight ? Math.max(1, windowHeight * 0.001) : 1; // 0.1% of window height, minimum 1px
    $: itemMinHeight = windowHeight ? windowHeight * 0.045 : 36; // 4.5% of window height, fallback 36px
    
    // Calculate responsive text positioning and cursor gap
    $: textLeftOffset = windowHeight ? windowHeight * 0.004 : 4; // 0.4% of window height, fallback 4px
    $: cursorGap = windowHeight ? windowHeight * 0.002 : 2; // 0.2% of window height, fallback 2px
    
	let searchTerm = '';
	// Text to show when input is not focused (e.g., last selected artist)
	let persistedText = '';
	let isFocused = false;
    let suggestions = [];
    let isOpen = false;
    let selectedIndex = -1;
    let inputElement;
    let dropdownElement;
    let searching = false;
    let searchTimeout;
    let blink = false;
    let navigationMode = 'none'; // 'mouse', 'keyboard', or 'none'
    let mouseTimeout;
    let keyboardLocked = false; // Prevents mouse interference during keyboard navigation
    let keyboardLockTimeout;
    
    // Debounce search to avoid too many queries
    function debounceSearch(term) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            if (term.trim().length > 0) {
                searching = true;
                try {
                    suggestions = await searchArtists(term, maxSuggestions);
                    isOpen = suggestions.length > 0;
                    if (isOpen) {
                        // Reset navigation mode when dropdown opens
                        navigationMode = 'none';
                        selectedIndex = -1;
                        keyboardLocked = false;
                        clearTimeout(keyboardLockTimeout);
                        console.log('Dropdown opened, reset navigation mode');
                    }
                } catch (error) {
                    console.error('Search error:', error);
                    suggestions = [];
                    isOpen = false;
                } finally {
                    searching = false;
                }
            } else {
                suggestions = [];
                isOpen = false;
                searching = false;
                navigationMode = 'none';
            }
        }, 300); // 300ms delay
    }
    
    function handleInput(event) {
        searchTerm = event.target.value;
        selectedIndex = -1;
        navigationMode = 'none';
        clearTimeout(mouseTimeout);
        console.log('handleInput - searchTerm:', searchTerm, 'reset navigation mode');
        debounceSearch(searchTerm);
    }
    
    function handleKeydown(event) {
        if (!isOpen && event.key !== 'Enter') return;
        
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (suggestions.length === 0) break;
                
                // Switch to keyboard navigation mode and lock out mouse
                navigationMode = 'keyboard';
                keyboardLocked = true;
                clearTimeout(mouseTimeout);
                clearTimeout(keyboardLockTimeout);
                console.log('Keyboard navigation: ArrowDown, previous index:', selectedIndex);
                
                if (selectedIndex === -1) {
                    // No item selected, start from the first item
                    selectedIndex = 0;
                } else if (selectedIndex >= suggestions.length - 1) {
                    // At the last item, loop back to the first
                    selectedIndex = 0;
                } else {
                    // Move to next item
                    selectedIndex = selectedIndex + 1;
                }
                console.log('Keyboard navigation: new index:', selectedIndex);
                scrollToSelected();
                
                // Release keyboard lock after a short delay
                keyboardLockTimeout = setTimeout(() => {
                    keyboardLocked = false;
                    console.log('Keyboard lock released');
                }, 300); // 300ms lock period
                break;
                
            case 'ArrowUp':
                event.preventDefault();
                if (suggestions.length === 0) break;
                
                // Switch to keyboard navigation mode and lock out mouse
                navigationMode = 'keyboard';
                keyboardLocked = true;
                clearTimeout(mouseTimeout);
                clearTimeout(keyboardLockTimeout);
                console.log('Keyboard navigation: ArrowUp, previous index:', selectedIndex);
                
                if (selectedIndex === -1) {
                    // No item selected, start from the last item
                    selectedIndex = suggestions.length - 1;
                } else if (selectedIndex <= 0) {
                    // At the first item, loop back to the last
                    selectedIndex = suggestions.length - 1;
                } else {
                    // Move to previous item
                    selectedIndex = selectedIndex - 1;
                }
                console.log('Keyboard navigation: new index:', selectedIndex);
                scrollToSelected();
                
                // Release keyboard lock after a short delay
                keyboardLockTimeout = setTimeout(() => {
                    keyboardLocked = false;
                    console.log('Keyboard lock released');
                }, 100); // 100ms lock period
                break;
                
            case 'Enter':
                event.preventDefault();
                if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                    selectArtist(suggestions[selectedIndex]);
                } else if (searchTerm.trim()) {
                    // If no suggestion is selected but there's text, search for it directly
                    dispatch('artistSelected', { name: searchTerm.trim() });
                }
                break;
            case 'Escape':
                closeDropdown();
                break;
        }
    }
    
	function selectArtist(artist) {
		// Keep the selected artist text visible when not focused
		persistedText = artist.name;
		// Clear the editable value so next focus starts fresh
		searchTerm = '';
		closeDropdown();
		dispatch('artistSelected', artist);
	}
    
    function closeDropdown() {
        isOpen = false;
        selectedIndex = -1;
        keyboardLocked = false;
        clearTimeout(keyboardLockTimeout);
        inputElement?.blur();
    }
    
    function handleClickOutside(event) {
        if (!dropdownElement?.contains(event.target) && !inputElement?.contains(event.target)) {
            closeDropdown();
        }
    }
    
    function scrollToSelected() {
        if (selectedIndex >= 0 && dropdownElement) {
            const selectedElement = dropdownElement.children[selectedIndex];
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
            }
        }
    }
    
	function focusInput() {
        console.log('focusInput called');
        if (inputElement) {
            console.log('inputElement exists, attempting to focus');
            inputElement.focus();
			blink = true;
			isFocused = true;
			// Clear any previous display text when user returns to search
			persistedText = '';
			searchTerm = '';
            console.log('focusInput - blink set to:', blink);
            console.log('activeElement after focus:', document.activeElement);
        } else {
            console.log('inputElement is null or undefined');
        }
    }
    
	function blurInput() {
		blink = false;
		isFocused = false;
		// Keep what the user last typed visible when leaving the field
		if (searchTerm && searchTerm.trim().length > 0) {
			persistedText = searchTerm;
		}
		console.log('blurInput - blink set to:', blink);
	}
    
    function handleMouseEnter(index) {
        // Ignore mouse hover if keyboard navigation is locked
        if (keyboardLocked) {
            console.log('Mouse hover ignored - keyboard locked');
            return;
        }
        
        // Always update selection when mouse enters, regardless of navigation mode
        selectedIndex = index;
        navigationMode = 'mouse';
        clearTimeout(mouseTimeout);
        console.log('Mouse navigation: selected index', index);
    }
    
    function handleMouseLeave() {
        // Clear mouse timeout when leaving dropdown area
        clearTimeout(mouseTimeout);
        
        // Set timeout to switch to keyboard mode after leaving
        mouseTimeout = setTimeout(() => {
            navigationMode = 'keyboard';
            console.log('Switched to keyboard mode after mouse leave');
        }, 100);
    }
    
    function handleMouseMove() {
        // Reset the timeout whenever mouse moves
        clearTimeout(mouseTimeout);
        navigationMode = 'mouse';
        
        // Set timeout to switch back to keyboard mode after mouse stops moving
        mouseTimeout = setTimeout(() => {
            navigationMode = 'keyboard';
            console.log('Switched to keyboard mode after mouse idle');
        }, 150);
    }
    
    function handleWrapperClick(event) {
        console.log('Wrapper clicked!', event.target);
        console.log('Current searchTerm:', searchTerm);
        console.log('searchChars length:', searchChars.length);
        focusInput();
    }
    
    // Export focus function for parent component
    export { focusInput };
    
    // Handle clicks outside the component
    $: if (typeof window !== 'undefined') {
        if (isOpen) {
            document.addEventListener('click', handleClickOutside);
        } else {
            document.removeEventListener('click', handleClickOutside);
        }
    }
    
	// Show persisted text when not focused; live input when focused
	$: searchChars = (isFocused ? searchTerm : persistedText).split('');
    
    // Debug cursor visibility
    $: console.log('Cursor should be visible:', blink);
</script>

<svelte:window on:beforeunload={() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('resize', handleResize);
    clearTimeout(mouseTimeout);
    clearTimeout(keyboardLockTimeout);
}} />

<div class="artist-search-container" style="--search-font-size: {fontSize}; --text-left-offset: {textLeftOffset}px; --cursor-gap: {cursorGap}px;">
    <div class="search-input-wrapper" on:click={handleWrapperClick}>
        <!-- Visual text display with cursor (like old TypingTest) -->
        <div class="visual-text" on:click={focusInput}>
            {#each searchChars as char, index}
                <span class="char">{char}</span>
            {/each}
            {#if searchChars.length === 0}
                <!-- Invisible placeholder to ensure clickable area when empty -->
                <span class="placeholder"></span>
            {/if}
            {#if blink}
                <span class="search-cursor"></span>
            {/if}
        </div>
        
        <!-- Hidden input that captures typing -->
        <input
            bind:this={inputElement}
            bind:value={searchTerm}
            on:input={handleInput}
            on:keydown={handleKeydown}
            on:focus={focusInput}
            on:blur={blurInput}
            on:click={focusInput}
            {tabIndex}
            class="hidden-input"
            autocomplete="off"
            spellcheck="false"
        />
        
        {#if searching}
            <div class="search-loading">
                <div class="spinner"></div>
            </div>
        {/if}
    </div>
    
    {#if isOpen && suggestions.length > 0}
        <div bind:this={dropdownElement} class="dropdown" style="--dropdown-offset: {dropdownOffset}px; --dropdown-max-height: {dropdownMaxHeight}px; --item-padding-vertical: {itemPaddingVertical}px; --item-padding-horizontal: {itemPaddingHorizontal}px; --item-border-width: {itemBorderWidth}px;">
            {#each suggestions as artist, index}
                <button
                    class="dropdown-item"
                    style="--item-padding-vertical: {itemPaddingVertical}px; --item-padding-horizontal: {itemPaddingHorizontal}px; --item-border-width: {itemBorderWidth}px; --item-min-height: {itemMinHeight}px;"
                    class:selected={index === selectedIndex}
                    on:click={() => selectArtist(artist)}
                    on:mouseenter={() => handleMouseEnter(index)}
                    on:mouseleave={handleMouseLeave}
                    on:mousemove={handleMouseMove}
                    type="button"
                >
                    <span class="artist-name">{artist.name}</span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .artist-search-container {
        position: relative;
        width: 100%;
        height: 100%;
    }
    
    .search-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        height: 100%;
        width: 100%;
        cursor: text;
    }
    
    .visual-text {
        position: absolute;
        left: var(--item-padding-horizontal, 4px);
        top: 50%;
        transform: translateY(-50%);
        font-size: var(--search-font-size, inherit);
        font-family: "Geneva", sans-serif;
        font-weight: 600;
        color: var(--primary-color, black);
        white-space: pre-wrap;
        letter-spacing: -.05em;
        cursor: text;
        display: flex;
        align-items: center;
        min-height: 70%;
        min-width: calc(100% - calc(var(--text-left-offset, 4px) * 2));
        width: calc(100% - calc(var(--text-left-offset, 4px) * 2));
        background: transparent;
        z-index: 1;
    }
    
    .char {
        display: inline-block;
        font-family: "Geneva", sans-serif;
        font-weight: 600;
        color: var(--primary-color, black);
    }
    
    .placeholder {
        display: inline-block;
        font-family: "Geneva", sans-serif;
        font-weight: 600;
        color: transparent;
        min-width: 1px;
        height: 1em;
    }
    
    .search-cursor {
        display: inline-block;
        width: 2px;
        height: 1.2em;
        margin-left: var(--cursor-gap, 2px);
        background-color: var(--primary-color, black);
        animation: blink-animation 1s steps(1) infinite;
        vertical-align: text-bottom;
    }
    
    .hidden-input {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        border: none;
        background: transparent;
        outline: none;
        font-size: var(--search-font-size, inherit);
        padding: 0;
        margin: 0;
        box-sizing: border-box;
        cursor: text;
    }
    
    @keyframes blink-animation {
        50% {
            opacity: 0;
        }
    }
    
    .search-loading {
        position: absolute;
        right: 12px;
        display: flex;
        align-items: center;
        z-index: 3;
        pointer-events: none;
    }
    
    .spinner {
        width: 16px;
        height: 16px;
        border: var(--border-width) solid var(--primary-color, #e0e0e0);
        border-top: var(--border-width) solid var(--secondary-color, #007acc);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        opacity: 0.6;
    }
    
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    .dropdown {
        position: absolute;
        top: calc(100% + var(--dropdown-offset, 12px));
        left: -2px;
        right: -2px;
        background: var(--secondary-color, white);
        border: var(--border-width) solid var(--primary-color, #ccc);
        border-radius: 4px;
        height: auto;
        max-height: var(--dropdown-max-height, 200px);
        overflow-y: hidden;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    
    .dropdown-item {
        width: 100%;
        min-height: var(--item-min-height, 36px);
        padding: var(--item-padding-vertical, 8px) var(--item-padding-horizontal, 12px);
        border: none;
        background: transparent;
        cursor: pointer;
        text-align: left;
        font-family: "Geneva", sans-serif;
        font-size: var(--search-font-size, inherit);
        border-bottom: var(--item-border-width, 1px) solid var(--primary-color, #f0f0f0);
        transition: background-color 0.1s ease;
        color: var(--primary-color, black);
        font-weight: 600;
        display: flex;
        align-items: center;
        box-sizing: border-box;
    }
    
    .dropdown-item.selected {
        background-color: var(--primary-color, #f0f8ff);
        color: var(--secondary-color, black);
    }
    
    .dropdown-item:last-child {
        border-bottom: none;
    }
    
    .artist-name {
        font-weight: normal;
        width: 100%;
        text-align: left;
    }
</style> 