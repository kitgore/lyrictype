<script>
    import { searchArtists } from '$lib/services/artistService';
    import { createEventDispatcher } from 'svelte';
    
    export let placeholder = '';
    export let tabIndex = 0;
    export let fontSize = 'inherit';
    
    const dispatch = createEventDispatcher();
    
    let searchTerm = '';
    let suggestions = [];
    let isOpen = false;
    let selectedIndex = -1;
    let inputElement;
    let dropdownElement;
    let searching = false;
    let searchTimeout;
    let blink = false;
    
    // Debounce search to avoid too many queries
    function debounceSearch(term) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            if (term.trim().length > 0) {
                searching = true;
                try {
                    suggestions = await searchArtists(term, 8);
                    isOpen = suggestions.length > 0;
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
            }
        }, 300); // 300ms delay
    }
    
    function handleInput(event) {
        searchTerm = event.target.value;
        selectedIndex = -1;
        console.log('handleInput - searchTerm:', searchTerm, 'blink:', blink);
        debounceSearch(searchTerm);
    }
    
    function handleKeydown(event) {
        if (!isOpen && event.key !== 'Enter') return;
        
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
                scrollToSelected();
                break;
            case 'ArrowUp':
                event.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                scrollToSelected();
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
        searchTerm = artist.name;
        closeDropdown();
        dispatch('artistSelected', artist);
    }
    
    function closeDropdown() {
        isOpen = false;
        selectedIndex = -1;
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
            inputElement.focus();
            blink = true;
            console.log('focusInput - blink set to:', blink);
        }
    }
    
    function blurInput() {
        blink = false;
        console.log('blurInput - blink set to:', blink);
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
    
    // Split search term into characters for display
    $: searchChars = searchTerm.split('');
    
    // Debug cursor visibility
    $: console.log('Cursor should be visible:', blink);
</script>

<svelte:window on:beforeunload={() => {
    document.removeEventListener('click', handleClickOutside);
}} />

<div class="artist-search-container" style="--search-font-size: {fontSize};">
    <div class="search-input-wrapper">
        <!-- Visual text display with cursor (like old TypingTest) -->
        <div class="visual-text">
            {#each searchChars as char, index}
                <span class="char">{char}</span>
            {/each}
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
        <div bind:this={dropdownElement} class="dropdown">
            {#each suggestions as artist, index}
                <button
                    class="dropdown-item"
                    class:selected={index === selectedIndex}
                    on:click={() => selectArtist(artist)}
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
    }
    
    .visual-text {
        position: absolute;
        left: 8px;
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
        width: calc(100% - 16px);
        pointer-events: none;
    }
    
    .char {
        display: inline-block;
        font-family: "Geneva", sans-serif;
        font-weight: 600;
        color: var(--primary-color, black);
    }
    
    .search-cursor {
        display: inline-block;
        width: 2px;
        height: 1.2em;
        margin-left: -4px;
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
        padding: 4px 8px;
        box-sizing: border-box;
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
    }
    
    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--primary-color, #e0e0e0);
        border-top: 2px solid var(--secondary-color, #007acc);
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
        top: calc(100% + 2px);
        left: -2px;
        right: -2px;
        background: var(--secondary-color, white);
        border: 2px solid var(--primary-color, #ccc);
        border-top: none;
        border-radius: 0 0 4px 4px;
        height: auto;
        max-height: none;
        overflow-y: visible;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    
    .dropdown-item {
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        text-align: left;
        font-family: "Geneva", sans-serif;
        font-size: var(--search-font-size, inherit);
        border-bottom: 1px solid var(--primary-color, #f0f0f0);
        transition: background-color 0.1s ease;
        color: var(--primary-color, black);
        font-weight: 600;
    }
    
    .dropdown-item:hover,
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