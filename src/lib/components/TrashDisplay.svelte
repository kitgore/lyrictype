<script>
    import { windowStore, ditherImages } from '$lib/services/store.js';
    import { themeColors } from '$lib/services/store.js';
    import { trashStore, getFileIcon, formatDuration, getPerformanceGrade } from '$lib/services/trashService.js';
    import { getAlbumArtBinaryImage } from '$lib/services/albumArtService.js';
    import GrayscaleImageRenderer from './GrayscaleImageRenderer.svelte';

    // Album art recoloring state
    let grayscaleImageData = null;
    let imageMetadata = null;
    let isLoadingAlbumArt = false;
    let currentAlbumArtId = null;

    // Load album art for recoloring when selection changes
    async function loadAlbumArt(imageUrl) {
        if (!imageUrl || !$ditherImages) {
            grayscaleImageData = null;
            imageMetadata = null;
            currentAlbumArtId = null;
            return;
        }

        // Skip if we already have this image URL loaded
        if (imageUrl === currentAlbumArtId && grayscaleImageData) {
            return;
        }

        // Clear old data before loading new to prevent dimension mismatch
        grayscaleImageData = null;
        imageMetadata = null;
        isLoadingAlbumArt = true;
        currentAlbumArtId = imageUrl;

        try {
            const result = await getAlbumArtBinaryImage(imageUrl);
            // Verify we're still loading this URL (might have changed during async)
            if (imageUrl !== currentAlbumArtId) {
                return;
            }
            
            if (result && result.success && result.grayscaleData && result.metadata) {
                grayscaleImageData = result.grayscaleData;
                imageMetadata = result.metadata;
                console.log('Album art loaded for trash:', imageMetadata.width, 'x', imageMetadata.height);
            } else {
                console.warn('Album art loading failed:', result?.error);
                grayscaleImageData = null;
                imageMetadata = null;
            }
        } catch (error) {
            console.warn('Failed to load album art for recoloring:', error);
            grayscaleImageData = null;
            imageMetadata = null;
        }

        isLoadingAlbumArt = false;
    }

    // Reactive: load album art when selection or dither setting changes
    $: if (selectedSong?.imageUrl && $ditherImages) {
        loadAlbumArt(selectedSong.imageUrl);
    } else if (!$ditherImages || !selectedSong?.imageUrl) {
        grayscaleImageData = null;
        imageMetadata = null;
        currentAlbumArtId = null;
    }

    // Get trash window dimensions for proportional sizing
    $: trashWindowState = $windowStore.windowStates.find(w => w.id === 'trashWindow');
    $: windowWidth = trashWindowState?.dimensions?.width;
    $: windowHeight = trashWindowState?.dimensions?.height;
    
    // Calculate icon dimensions based on trash window size
    $: iconSize = windowHeight * 0.16; // 16% of window height
    $: iconLabelSize = windowHeight * 0.025; // 2.5% of window height
    
    // Calculate spacing based on window dimensions
    $: fileGap = windowWidth * 0.014; // 2% of window width
    $: containerPadding = windowHeight * 0.02; // 2% of window height, minimum 8px
    
    // List view specific sizing
    $: listIconSize = windowHeight * 0.08; // 8% of window height
    $: listGap = windowHeight * 0.01; // 1% of window height
    $: outisdePadding = windowHeight * 0.02; // 2% of window height
    
    // View mode state
    let viewMode = 'list'; // 'grid' or 'list'
    
    // Export functions to be called from parent
    export function setGridView() {
        viewMode = 'grid';
    }
    
    export function setListView() {
        viewMode = 'list';
    }

    // Get completed songs from trash store
    $: completedSongs = $trashStore;
    
    // Grade colors map
    const gradeColors = {
        legendary: '#aa14ef',
        gold: '#FFD700',
        silver: '#C0C0C0',
        bronze: '#CD7F32'
    };
    
    // Helper function to get screen color based on grade
    function getScreenColor(song, fallbackColor) {
        const grade = getFileIcon(song);
        return gradeColors[grade] || fallbackColor;
    }
    
    // Scrolling and selection state
    let scrollPosition = 0;
    let selectedSong = null;
    const maxVisibleItems = 7;
    
    // Calculate visible items for list view
    $: visibleSongs = completedSongs.slice(scrollPosition, scrollPosition + maxVisibleItems);
    $: canScrollUp = scrollPosition > 0;
    $: canScrollDown = scrollPosition + maxVisibleItems < completedSongs.length;
    
    // Handle file actions
    function handleFileClick(song) {
        selectedSong = song;
        console.log('Selected song for details:', song.title);
    }
    
    function handleFileDoubleClick(song) {
        console.log('Double-clicked on song:', song.title);
        // Dispatch event to parent to load song in TypingTest
        const event = new CustomEvent('replaySong', {
            detail: { songData: song },
            bubbles: true
        });
        document.dispatchEvent(event);
    }
    
    // Scrolling functions
    function scrollUp() {
        if (canScrollUp) {
            scrollPosition = Math.max(0, scrollPosition - 1);
        }
    }
    
    function scrollDown() {
        if (canScrollDown) {
            scrollPosition = Math.min(completedSongs.length - maxVisibleItems, scrollPosition + 1);
        }
    }
    
    // Export scroll functions to be called by parent (AppWindow scrollbar arrows)
    export function handleScrollUp() {
        if (viewMode === 'list') {
            scrollUp();
        }
    }
    
    export function handleScrollDown() {
        if (viewMode === 'list') {
            scrollDown();
        }
    }
    
    // Reset scroll position when switching view modes or when songs change
    $: if (viewMode === 'grid') {
        scrollPosition = 0;
        selectedSong = null;
    }
    
    $: if (completedSongs.length === 0) {
        selectedSong = null;
    }
</script>

<div class="trash-container"
     style="--icon-size: {iconSize}px;  
            --list-icon-size: {listIconSize}px; 
            --list-gap: {listGap}px;" >
    
    {#if viewMode === 'grid'}
        <div class="files-area">
            <div class="bottom-row" style:gap="{fileGap}px" style:padding="{containerPadding}px">
            {#each completedSongs as song}
                <div class="trash-file" 
                     role="button"
                     tabindex="0"
                     on:click={() => handleFileClick(song)} 
                     on:dblclick={() => handleFileDoubleClick(song)}
                     on:keydown={(e) => e.key === 'Enter' && handleFileClick(song)}
                     title="{song.title} by {song.artist} - WPM: {song.wpm}, Accuracy: {song.accuracy}%">
                    <div class="file-icon {getFileIcon(song)}" style:height="{iconSize}px" style:width="{iconSize}px">
                        <!-- MP3 file icon SVG -->
                        <svg viewBox="-4 0 45 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="1" y="0.5" width="35" height="39" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                            <!-- Screen filled with grade color -->
                            <rect x="5" y="4.5" width="27" height="20" rx="1.5" fill="{getScreenColor(song, $themeColors.secondary)}" stroke="{$themeColors.primary}"/>
                            <rect x="3" y="39.5" width="31" height="6" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                            <!-- MP3 text -->
                            <text x="18" y="34" font-family="monospace" font-size="6" text-anchor="middle" fill="{$themeColors.primary}">MP3</text>
                        </svg>
                    </div>
                    <div class="file-label" style:font-size="{iconLabelSize}px">
                        <div class="file-name">{song.fileName}</div>
                        <div class="file-stats">{song.wpm} WPM • {song.accuracy}% • {getPerformanceGrade(song.wpm, song.accuracy)}</div>
                    </div>
                </div>
            {:else}
                <div class="empty-trash" style:font-size="{iconLabelSize * 1.2}px">
                    <p>No completed songs yet</p>
                    <p style="opacity: 0.7; font-size: {iconLabelSize}px;">Complete a typing test to see files here</p>
                </div>
            {/each}
            </div>
        </div>
    {:else}
        <div class="list-container">
            <div class="list-view" style="--outside-padding: {outisdePadding}px;">
                {#each visibleSongs as song}
                <div class="list-item {selectedSong?.id === song.id ? 'selected' : ''}" 
                     role="button"
                     tabindex="0"
                     on:click={() => handleFileClick(song)} 
                     on:dblclick={() => handleFileDoubleClick(song)}
                     on:keydown={(e) => e.key === 'Enter' && handleFileClick(song)}
                     title="{song.title} by {song.artist} - WPM: {song.wpm}, Accuracy: {song.accuracy}%">
                    <div class="list-icon {getFileIcon(song)}" style:height="{listIconSize}px" style:width="{listIconSize}px">
                        <!-- MP3 file icon SVG (smaller version) -->
                        <svg viewBox="-4 0 45 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="1" y="0.5" width="35" height="39" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                            <!-- Screen filled with grade color -->
                            <rect x="5" y="4.5" width="27" height="20" rx="1.5" fill="{getScreenColor(song, $themeColors.secondary)}" stroke="{$themeColors.primary}"/>
                            <rect x="3" y="39.5" width="31" height="6" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                            <!-- MP3 text -->
                            <text x="18" y="34" font-family="monospace" font-size="6" text-anchor="middle" fill="{$themeColors.primary}">MP3</text>
                        </svg>
                    </div>
                    <div class="list-label" style:font-size="{iconLabelSize}px">
                        <div class="list-file-name">{song.fileName}</div>
                        <div class="file-stats">{song.wpm} WPM • {song.accuracy}% • {getPerformanceGrade(song.wpm, song.accuracy)}</div>
                        <!-- <div class="list-file-details">
                            {song.fileSize} • {formatDuration(song.testDuration)} • {getPerformanceGrade(song.wpm, song.accuracy)} grade
                        </div> -->
                    </div>
                </div>
                {:else}
                <div class="empty-trash-list" style:font-size="{iconLabelSize * 1.2}px">
                    <p>No completed songs yet</p>
                    <p style="opacity: 0.7; font-size: {iconLabelSize}px;">Complete a typing test to see files here</p>
                </div>
            {/each}
            </div>
            
            <!-- Info Panel -->
            <div class="info-panel" style="--outside-padding: {outisdePadding}px;">
                {#if selectedSong}
                    <div class="info-content">
                        <!-- Album Artwork -->
                        <div class="album-art" style:height="{iconSize * 1.5}px" style:width="{iconSize * 1.5}px">
                            {#if isLoadingAlbumArt}
                                <div class="loading-placeholder"></div>
                            {:else if $ditherImages && grayscaleImageData && imageMetadata && imageMetadata.width && imageMetadata.height}
                                {#key `${currentAlbumArtId}-${imageMetadata.width}x${imageMetadata.height}`}
                                    <GrayscaleImageRenderer
                                        grayscaleData={grayscaleImageData}
                                        width={imageMetadata.width}
                                        height={imageMetadata.height}
                                        alt={selectedSong.title || 'Album art'}
                                        borderRadius="0"
                                        class="album-art-image"
                                    />
                                {/key}
                            {:else if selectedSong.imageUrl}
                                <img src="{selectedSong.imageUrl}" alt="{selectedSong.title}" />
                            {:else}
                                <!-- Default album art -->
                                <div class="default-album-art">
                                    <svg viewBox="-4 0 45 46" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="1" y="0.5" width="35" height="39" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                                        <rect x="5" y="4.5" width="27" height="20" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                                        <rect x="3" y="39.5" width="31" height="6" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>
                                        <text x="18" y="34" font-family="monospace" font-size="6" text-anchor="middle" fill="{$themeColors.primary}">MP3</text>
                                    </svg>
                                </div>
                            {/if}
                        </div>
                        
                        <!-- Song Info -->
                        <div class="song-info" style:font-size="{iconLabelSize}px">
                            <div class="song-filename">{selectedSong.fileName}</div>
                        </div>
                        
                        <!-- Performance Stats -->
                        <div class="performance-stats" style:font-size="{iconLabelSize * 0.9}px">
                            <div class="stat-row">
                                <span class="stat-label">WPM:</span>
                                <span class="stat-value">{selectedSong.wpm}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Accuracy:</span>
                                <span class="stat-value">{selectedSong.accuracy}%</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Grade:</span>
                                <span class="stat-value grade-{getFileIcon(selectedSong)}">{getPerformanceGrade(selectedSong.wpm, selectedSong.accuracy)}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Duration:</span>
                                <span class="stat-value">{formatDuration(selectedSong.testDuration)}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">File Size:</span>
                                <span class="stat-value">{selectedSong.fileSize}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Characters:</span>
                                <span class="stat-value">{selectedSong.charactersTyped}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Errors:</span>
                                <span class="stat-value">{selectedSong.incorrectChars}</span>
                            </div>
                        </div>
                        
                        <!-- Completion Date -->
                        <div class="completion-date" style:font-size="{iconLabelSize * 0.8}px">
                            Completed: {new Date(selectedSong.completedAt).toLocaleDateString()}
                        </div>
                        
                        <!-- Replay Button -->
                        <button 
                            class="replay-button" 
                            style:font-size="{iconLabelSize * 0.9}px"
                            on:click={() => handleFileDoubleClick(selectedSong)}
                            title="Replay this song"
                        >
                            <svg class="replay-icon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                            </svg>
                            Replay
                        </button>
                    </div>
                {:else}
                    <div class="no-selection" style:font-size="{iconLabelSize}px">
                        <p>Select a song to view details</p>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .trash-container {
        flex: 1;
        display: flex;
        flex-direction: column;
    }

    .files-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    }

    .list-container {
        flex: 1;
        display: flex;
        flex-direction: row;
        gap: calc(var(--list-item-padding) * 2);
    }

    .bottom-row {
        display: flex;
        justify-content: flex-start;
        align-items: flex-end;
    }

    .trash-file {
        display: flex;
        flex-direction: column;
        align-items: center;
        cursor: pointer;
    }

    .file-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: calc(var(--icon-size, 40px) * 0.1);
    }

    .file-icon svg {
        width: 100%;
        height: 100%;
    }

    .file-label {
        background-color: var(--secondary-color);
        color: var(--primary-color);
        text-align: center;
        padding: 2px 4px;
        white-space: nowrap;
        font-size: 0.8em;
        max-width: 100%;
    }

    .file-name {
        font-weight: bold;
        margin-bottom: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-stats {
        font-size: 0.8em;
        opacity: 0.8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .empty-trash {
        grid-column: 1 / -1;
        text-align: center;
        color: var(--primary-color);
        opacity: 0.6;
        padding: calc(var(--icon-size) * 0.5) 0;
    }

    .empty-trash p {
        margin: 0.5em 0;
    }

    .trash-file:hover .file-label {
        background-color: var(--primary-color);
        color: var(--secondary-color);
    }

    /* List view styles */
    .list-view {
        flex: 2;
        display: flex;
        flex-direction: column;
        gap: var(--list-gap, 4px);
        padding: var(--outside-padding);
        overflow: hidden;
    }

    .list-item {
        display: flex;
        align-items: center;
        cursor: pointer;
        padding: var(--list-item-padding, 3px) calc(var(--list-item-padding, 3px) * 2);
        border-radius: 2px;
    }

    .list-item:hover {
        background-color: var(--primary-color);
    }

    .list-item:hover .list-label {
        background-color: var(--primary-color);
        color: var(--secondary-color);
    }

    .list-item.selected {
        background-color: var(--primary-color);
        opacity: 0.9;
    }

    .list-item.selected .list-label {
        color: var(--secondary-color);
    }

    .list-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: calc(var(--list-icon-size, 32px) * 0.2);
        flex-shrink: 0;
    }

    .list-icon svg {
        width: 100%;
        height: 100%;
    }

    .list-label {
        background-color: transparent;
        color: var(--primary-color);
        font-size: 0.8em;
        flex: 1;
        overflow: hidden;
    }

    .list-file-name {
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 2px;
    }

    .list-file-details {
        font-size: 0.9em;
        opacity: 0.7;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .empty-trash-list {
        text-align: center;
        color: var(--primary-color);
        opacity: 0.6;
        padding: calc(var(--list-top-padding, 10px) * 2) 0;
    }

    .empty-trash-list p {
        margin: 0.5em 0;
    }

    /* Performance indicator styles */
    .file-icon.legendary {
        filter: brightness(1.2) saturate(1.2);
    }

    .file-icon.gold {
        filter: brightness(1.1);
    }

    .file-icon.silver {
        filter: brightness(1.05);
    }

    .file-icon.bronze {
        filter: brightness(0.95);
    }

    /* Info Panel Styles */
    .info-panel {
        flex: 1;
        background-color: var(--secondary-color);
        border-left: var(--border-width) solid var(--primary-color);
        padding: var(--outside-padding);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .info-content {
        display: flex;
        flex-direction: column;
        gap: calc(var(--list-gap, 4px) * 2);
        height: 100%;
    }

    .album-art {
        align-self: center;
        overflow: hidden;
    }

    .album-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .album-art .loading-placeholder {
        width: 100%;
        height: 100%;
        background: var(--secondary-color);
        border: var(--border-width) solid var(--primary-color);
    }

    .album-art :global(.canvas-wrapper) {
        width: 100%;
        height: 100%;
    }

    .default-album-art {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .default-album-art svg {
        width: 80%;
        height: 80%;
    }

    .song-info {
        text-align: center;
    }

    .song-title {
        font-weight: bold;
        margin-bottom: 2px;
        color: var(--primary-color);
    }

    .song-artist {
        opacity: 0.8;
        margin-bottom: 4px;
        color: var(--primary-color);
    }

    .song-filename {
        font-size: 0.9em;
        font-weight: bold;
        word-break: break-all;
        color: var(--primary-color);
    }

    .performance-stats {
        flex: 1;
    }

    .stat-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
        padding: 1px 0;
    }

    .stat-label {
        opacity: 0.8;
        color: var(--primary-color);
    }

    .stat-value {
        font-weight: bold;
        color: var(--primary-color);
    }

    .stat-value.grade-legendary {
        color: #aa14ef;
        text-shadow: 
            -1px -1px 0 #000,
            1px -1px 0 #000,
            -1px 1px 0 #000,
            1px 1px 0 #000;
    }

    .stat-value.grade-gold {
        color: #FFD700;
        text-shadow: 
            -1px -1px 0 #000,
            1px -1px 0 #000,
            -1px 1px 0 #000,
            1px 1px 0 #000;
    }

    .stat-value.grade-silver {
        color: #C0C0C0;
        text-shadow: 
            -1px -1px 0 #000,
            1px -1px 0 #000,
            -1px 1px 0 #000,
            1px 1px 0 #000;
    }

    .stat-value.grade-bronze {
        color: #CD7F32;
        text-shadow: 
            -1px -1px 0 #000,
            1px -1px 0 #000,
            -1px 1px 0 #000,
            1px 1px 0 #000;
    }

    .completion-date {
        text-align: center;
        opacity: 0.6;
        color: var(--primary-color);
    }

    .replay-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-top: auto;
        padding: 8px 16px;
        background-color: transparent;
        color: var(--primary-color);
        border: var(--border-width, 2px) solid var(--primary-color);
        cursor: pointer;
        font-family: inherit;
        font-weight: bold;
        transition: background-color 0.15s ease, color 0.15s ease;
    }

    .replay-button:hover {
        background-color: var(--primary-color);
        color: var(--secondary-color);
    }

    .replay-button:hover .replay-icon {
        fill: var(--secondary-color);
    }

    .replay-button:active {
        opacity: 0.8;
    }

    .replay-icon {
        width: 1.2em;
        height: 1.2em;
    }

    .no-selection {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        text-align: center;
        opacity: 0.6;
        color: var(--primary-color);
    }

    .no-selection p {
        margin: 0;
    }
</style>
