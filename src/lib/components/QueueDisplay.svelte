<script>
    import { songQueue, queueActions } from '$lib/services/store.js';
    import { createEventDispatcher } from 'svelte';
    
    export let windowHeight = 600;
    export let isVisible = false;
    
    const dispatch = createEventDispatcher();
    
    // Calculate responsive sizing
    $: itemHeight = windowHeight * 0.06; // 6% of window height
    $: fontSize = windowHeight * 0.025; // 2.5% of window height
    $: maxHeight = windowHeight * 0.4; // 40% of window height
    
    function handleSongClick(futureIndex) {
        // Convert future index to actual queue index
        const actualIndex = $songQueue.currentIndex + 1 + futureIndex;
        const song = queueActions.jumpToSong(actualIndex);
        if (song) {
            dispatch('songSelected', song);
        }
    }
    
    function truncateText(text, maxLength = 30) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }
    
    function formatSongTitle(song) {
        return `${truncateText(song.artist)} - ${truncateText(song.title)}`;
    }
    
    // Get only future songs
    $: futureSongs = $songQueue.songs.slice($songQueue.currentIndex + 1);
</script>

{#if isVisible}
    <div class="queue-overlay" on:click={() => dispatch('close')}>
        <div class="queue-container" style="--max-height: {maxHeight}px; --item-height: {itemHeight}px; --font-size: {fontSize}px;" on:click|stopPropagation>
            <div class="queue-header">
                <h3>Up Next</h3>
                <button class="close-button" on:click={() => dispatch('close')}>×</button>
            </div>
            
            <div class="queue-list">
                {#each futureSongs as song, index}
                    <div 
                        class="queue-item future"
                        on:click={() => handleSongClick(index)}
                    >
                        <div class="song-info">
                            <div class="song-title">{formatSongTitle(song)}</div>
                            <div class="song-artist">{truncateText(song.artist)}</div>
                        </div>
                        <div class="queue-position">
                            <div class="position-number">{$songQueue.currentIndex + 2 + index}</div>
                        </div>
                    </div>
                {/each}
                
                {#if futureSongs.length === 0}
                    <div class="empty-queue">
                        <p>No upcoming songs</p>
                        <p>Continue playing to add more songs to your queue!</p>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .queue-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        /* background: rgba(0, 0, 0, 0.5); */
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }
    
    .queue-container {
        background: var(--secondary-color);
        border: 2px solid var(--primary-color);
        border-radius: 8px;
        width: 80%;
        max-width: 600px;
        max-height: var(--max-height);
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    
    .queue-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 2px solid var(--primary-color);
        background: var(--primary-color);
        color: var(--secondary-color);
    }
    
    .queue-header h3 {
        margin: 0;
        font-family: "Geneva", sans-serif;
        font-size: calc(var(--font-size) * 1.2);
        font-weight: 600;
    }
    
    .close-button {
        background: none;
        border: none;
        color: var(--secondary-color);
        font-size: calc(var(--font-size) * 1.8);
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
    }
    
    .close-button:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    
    .queue-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }
    
    .queue-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        margin: 4px 0;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        min-height: var(--item-height);
        border: 1px solid transparent;
    }
    
    .queue-item:hover {
        background: rgba(128, 128, 128, 0.1);
    }
    
    .queue-item.future {
        opacity: 0.9;
    }
    
    .song-info {
        flex: 1;
        min-width: 0;
    }
    
    .song-title {
        font-family: "Geneva", sans-serif;
        font-size: var(--font-size);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    
    .song-artist {
        font-family: "Geneva", sans-serif;
        font-size: calc(var(--font-size) * 0.9);
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    
    .queue-position {
        display: flex;
        align-items: center;
        margin-left: 12px;
    }
    
    .position-number {
        font-family: "Geneva", sans-serif;
        font-size: calc(var(--font-size) * 0.8);
        opacity: 0.7;
        min-width: 24px;
        text-align: center;
    }
    
    .empty-queue {
        text-align: center;
        padding: 40px 20px;
        color: var(--primary-color);
        opacity: 0.6;
    }
    
    .empty-queue p {
        margin: 8px 0;
        font-family: "Geneva", sans-serif;
        font-size: var(--font-size);
    }
</style> 