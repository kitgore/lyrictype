<script>
    import { searchArtists } from '$lib/services/artistService';
    import { createEventDispatcher } from 'svelte';
    
    export let placeholder = 'Search for an artist...';
    export let tabIndex = 0;
    
    const dispatch = createEventDispatcher();
    
    let searchTerm = '';
    let suggestions = [];
    let isOpen = false;
    let selectedIndex = -1;
    let inputElement;
    let dropdownElement;
    let searching = false;
    let searchTimeout;
    
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
        inputElement?.focus();
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
</script>

<svelte:window on:beforeunload={() => {
    document.removeEventListener('click', handleClickOutside);
}} />

<div class="artist-search-container">
    <div class="search-input-wrapper">
        <input
            bind:this={inputElement}
            bind:value={searchTerm}
            on:input={handleInput}
            on:keydown={handleKeydown}
            {placeholder}
            {tabIndex}
            class="search-input"
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
    }
    
    .search-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }
    
    .search-input {
        width: 100%;
        padding: 4px 8px;
        font-size: inherit;
        border: none;
        border-radius: 0;
        background: transparent;
        color: var(--primary-color, black);
        outline: none;
        font-family: "Geneva", sans-serif;
        box-sizing: border-box;
    }
    
    .search-input:focus {
        background: transparent;
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
        max-height: 200px;
        overflow-y: auto;
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
        font-size: inherit;
        border-bottom: 1px solid var(--primary-color, #f0f0f0);
        transition: background-color 0.1s ease;
        color: var(--primary-color, black);
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