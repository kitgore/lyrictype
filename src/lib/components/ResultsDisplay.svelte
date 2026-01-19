<script>
    export let wpm;
    export let accuracy;
    export let songTitle;
    export let artistName;
    export let imageUrl;
    export let continueFromQueue;
    export let replaySong;
    export let geniusUrl;
    export let albumArtId = null; // Album art ID for grayscale rendering
    export let preloadedAlbumArt = null; // Preloaded grayscale album art data for instant display
    import { onMount, afterUpdate } from 'svelte';
    import { getAlbumArtBinaryImage } from '$lib/services/albumArtService.js';
    import GrayscaleImageRenderer from './GrayscaleImageRenderer.svelte';
    import { themeColors, ditherImages, windowStore } from '$lib/services/store.js';
    
    let songContainer;
    let artistContainer;

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;
    
    // Album art state
    let grayscaleImageData = null;
    let imageMetadata = null;
    let isLoading = false;
    let isProcessingAlbumArt = true;
    let currentImageUrl = '';
    let useFallback = false;

    async function loadAlbumArt() {
        if (!imageUrl || imageUrl === '/default-image.svg' || !albumArtId) {
            isProcessingAlbumArt = false;
            grayscaleImageData = null;
            imageMetadata = null;
            currentImageUrl = '';
            useFallback = true;
            return;
        }

        // If this is a new image, reset state
        if (currentImageUrl !== imageUrl) {
            isProcessingAlbumArt = true;
            grayscaleImageData = null;
            imageMetadata = null;
            currentImageUrl = imageUrl;
            useFallback = false;
        }

        try {
            if (!$ditherImages) {
                // If dithering is disabled, use fallback
                useFallback = true;
                isProcessingAlbumArt = false;
                return;
            }

            // First try to use preloaded album art for instant display
            if (preloadedAlbumArt && (preloadedAlbumArt.grayscaleData || preloadedAlbumArt.binaryData) && preloadedAlbumArt.metadata) {
                console.log('⚡ Using preloaded album art for instant results display');
                grayscaleImageData = preloadedAlbumArt.grayscaleData || preloadedAlbumArt.binaryData; // Backward compatibility
                imageMetadata = preloadedAlbumArt.metadata;
                useFallback = false;
                isProcessingAlbumArt = false;
                return;
            }

            // Fallback: load if not preloaded (shouldn't happen in normal flow)
            console.log('🎨 Preload not available, loading album art grayscale image:', albumArtId);
            const result = await getAlbumArtBinaryImage(imageUrl);
            
            if (result.success) {
                grayscaleImageData = result.grayscaleData || result.binaryData; // Backward compatibility
                imageMetadata = result.metadata;
                useFallback = false;
                console.log('✅ Album art grayscale image loaded for results:', result.cached ? 'from cache' : 'processed');
            } else {
                console.warn('⚠️  Album art grayscale loading failed, using fallback:', result.error);
                useFallback = true;
            }
        } catch (error) {
            console.error('❌ Error loading album art grayscale image:', error);
            useFallback = true;
        } finally {
            isProcessingAlbumArt = false;
        }
    }

    // Reactive statements for album art loading
    $: if (imageUrl && albumArtId && imageUrl !== '/default-image.svg') {
        loadAlbumArt();
    }

    // Reload when dither setting changes
    $: if ($ditherImages !== undefined && imageUrl && albumArtId && imageUrl !== '/default-image.svg') {
        loadAlbumArt();
    }

    // Reload when preloaded album art changes (for instant display)
    $: if (preloadedAlbumArt && imageUrl && albumArtId && imageUrl !== '/default-image.svg') {
        loadAlbumArt();
    }

    // Clear image immediately when imageUrl becomes invalid
    $: if (!imageUrl || imageUrl === '/default-image.svg' || !albumArtId) {
        grayscaleImageData = null;
        imageMetadata = null;
        currentImageUrl = '';
        isProcessingAlbumArt = false;
        useFallback = true;
    }

    let resizeTimeout;
    function handleResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            fitText();
        }, 100);
    }

    onMount(() => {
        // Initial text fitting
        fitText();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(resizeTimeout);
        };
    });
    
    afterUpdate(() => {
        // Re-fit text whenever component updates
        fitText();
    });

    function fitText() {
        const songTextArea = songContainer?.parentElement;
        
        if (!songContainer || !artistContainer || !songTextArea) return;
        
        // Get parent container dimensions
        const containerHeight = songTextArea.clientHeight;
        const containerWidth = songTextArea.clientWidth;
        
        // Allocate heights: 60% for song, 20% for artist
        const songTargetHeight = containerHeight * 0.6;
        const artistTargetHeight = containerHeight * 0.2;
        
        // Clear any existing margins
        songContainer.style.marginTop = '0';
        songContainer.style.marginBottom = '0';
        artistContainer.style.marginTop = '0';
        artistContainer.style.marginBottom = '0';
        
        // Fit song title
        const songFontSize = findOptimalFontSize(
            songContainer,
            songTitle,
            containerWidth,
            songTargetHeight,
            5,
            90
        );
        
        // Fit artist name
        const artistFontSize = findOptimalFontSize(
            artistContainer,
            artistName,
            containerWidth,
            artistTargetHeight,
            5,
            50
        );
        
        // Apply font sizes in pixels
        songContainer.style.fontSize = `${songFontSize}px`;
        artistContainer.style.fontSize = `${artistFontSize}px`;
        
        // Ensure text content is set correctly
        songContainer.textContent = songTitle;
        artistContainer.textContent = artistName;
        
        // Force reflow to get accurate measurements
        void songTextArea.offsetHeight;
        
        // Measure actual text heights
        const songActualHeight = songContainer.scrollHeight;
        const artistActualHeight = artistContainer.scrollHeight;
        const totalTextHeight = songActualHeight + artistActualHeight;
        
        // Calculate remaining space and distribute margins: 2/5 top, 1/5 middle, 2/5 bottom
        const remainingHeight = containerHeight - totalTextHeight;
        
        if (remainingHeight > 0) {
            const topMargin = (remainingHeight * 2) / 5;
            const middleMargin = remainingHeight / 5;
            const bottomMargin = (remainingHeight * 2) / 5;
            
            songContainer.style.marginTop = `${topMargin}px`;
            songContainer.style.marginBottom = `${middleMargin}px`;
            artistContainer.style.marginBottom = `${bottomMargin}px`;
        } else {
            // If no space remaining, reset margins
            songContainer.style.marginTop = '0';
            songContainer.style.marginBottom = '0';
            artistContainer.style.marginBottom = '0';
        }
    }
    
    function findOptimalFontSize(container, text, maxWidth, maxHeight, minSize, maxSize) {
        if (!container || !text) return minSize;
        
        // Store original content
        const originalContent = container.textContent;
        
        let low = minSize;
        let high = maxSize;
        let optimalSize = minSize;
        
        // Binary search for largest font size that fits
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            container.style.fontSize = `${mid}px`;
            container.textContent = text;
            
            const fitsWidth = container.scrollWidth <= maxWidth;
            const fitsHeight = container.scrollHeight <= maxHeight;
            
            if (fitsWidth && fitsHeight) {
                optimalSize = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        
        // Restore original content
        container.textContent = originalContent;
        
        return optimalSize;
    }

</script>

<div class="resultsContainer">
    <div class="topSection">
        <div class="songDetails">
            <div class="albumCover">
                {#if isLoading || isProcessingAlbumArt}
                    <div class="loading-placeholder"></div>
                {:else if grayscaleImageData && imageMetadata && !useFallback}
                    <GrayscaleImageRenderer
                        grayscaleData={grayscaleImageData}
                        width={imageMetadata.width}
                        height={imageMetadata.height}
                        alt={songTitle || 'Album art'}
                        class="albumArt"
                        borderRadius="0"
                    />
                {:else if imageUrl && useFallback}
                    <img src={imageUrl} class="albumArt" alt="album art">
                {:else}
                    <div class="loading-placeholder"></div>
                {/if}                
            </div>
            <div class="songText">
                <div class="songTextContainer" bind:this={songContainer}>{songTitle}</div>
                <div class="artistTextContainer" bind:this={artistContainer} >{artistName}</div>
                <!-- <div class="songTitle"></div>
                <div class="artistName"></div> -->
            </div>
        </div>
        <div class="statsContainer"  >
            <p class="statLabel" style:font-size="{windowHeight*0.045}px">wpm:</p>
            <p class="statValue" style:font-size="{windowHeight*0.075}px">{wpm.toFixed(1)}</p>
            <p class="statLabel" style:font-size="{windowHeight*0.045}px">acc:</p>
            <p class="statValue" style:font-size="{windowHeight*0.075}px">{accuracy === 100 ? "100%" : accuracy.toFixed(1) + "%"}</p>
        </div>
    </div>
    <div class="bottomSection">
        <div class="controlsContainer">
            <button class="controlButton" on:click={continueFromQueue} tabindex=1>
                <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                </svg>                    
            </button>
            <button class="controlButton" on:click={replaySong} tabindex=2>
                <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                </svg>
            </button>
            <button class="controlButton" tabindex=3 on:click={() => {window.open(geniusUrl, '_blank')}}>
                <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                </svg>
            </button>
        </div>
    </div>
</div>

<style>
    *, *::before, *::after {
        box-sizing: border-box;
    }
    .songText {
        width: 60%;
        /* padding-right: 5%; */
        /* display: flex;
        flex-direction: column;
        gap: 0.5rem; */
    }
  
    .songTextContainer, .artistTextContainer {
        width: 100%;
        color: var(--primary-color);
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .songTextContainer{
        font-family: "SysFont", sans-serif;
    }

    .artistTextContainer{
        font-family: "Geneva", sans-serif;
        padding-left: 1%;
    }

    /* Main Layout */
    .resultsContainer {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
    }

    .topSection {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 75%;
        margin-top: 3%;
        margin-bottom: -3%;
    }

    .bottomSection {
        display: flex;
        flex-direction: row;
        justify-content: center;
        width: 100%;
        height: 25%;
    }

    /* Song Information */
    .songDetails {
        display: flex;
        flex-direction: row;
        width: 80%;
        height: 80%;
    }

    .albumCover {
        display: flex;
        width: 35%;
        height: 100%;
        justify-content: center;
        align-items: center;
        position: relative;
        aspect-ratio: 1/1;
        padding: 2%;
    }

    .loading-placeholder {
        margin: 0;
        width: 90%;        /* Change from height to width */
        aspect-ratio: 1/1; /* Add this */
        object-fit: contain;
        display: block;
        border: 2px solid var(--primary-color);
        background-color: var(--primary-color);
        opacity: 0.2;
        animation: pulse 1.5s infinite;
    }

    .songText {
        display: flex;
        flex-direction: column;
    }

    /* Stats Section */
    .statsContainer {
        display: flex;
        flex-direction: column;
        width: 20%;
        height: 80%;
        justify-content: center;
        margin-top: -1.5%;
        color: var(--primary-color);
    }

    .statLabel {
        font-size: 3vh;
        margin: 0;
    }

    .statValue {
        font-size: 5vh;
        margin-top: 5%;
        margin-bottom: 3%;
    }

    /* Controls */
    .controlsContainer {
        display: flex;
        justify-content: space-around;
        width: 100%;
        height: 75%;
    }

    .controlButton {
        font-size: 2em;
        /* padding: 0.5em 1em; */
        border: var(--border-width) solid var(--primary-color);
        background-color: var(--secondary-color);
        cursor: pointer;
        border-radius: 10px;
        height: 100%;
        width: 13%;
        display: flex;
        justify-content: center;
        align-items: center;

    }

    .controlButton:hover,
    .controlButton:active,
    .controlButton:focus {
        background-size: 2px 2px; /* Size of the checker squares */
        background-image:
            linear-gradient(45deg, var(--primary-color), 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color)),
            linear-gradient(45deg, var(--primary-color) 25%, var(--secondary-color), 25%, var(--secondary-color) 75%, var(--primary-color) 75%, var(--primary-color));
        outline: none
    }

    .controlIcon {
        height: 50%;
        aspect-ratio: 1/1;
    }

    .controlIconLarge {
        height: 75%;
        aspect-ratio: 1/1;
    }

    .albumArt {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
    }
</style>