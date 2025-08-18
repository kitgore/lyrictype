<script>
    export let wpm;
    export let accuracy;
    export let songTitle;
    export let artistName;
    export let imageUrl;
    export let continueFromQueue;
    export let replaySong;
    export let geniusUrl;
    export let albumArtId = null; // Album art ID for binary rendering
    export let preloadedAlbumArt = null; // Preloaded binary album art data for instant display
    import textFit from 'textfit'
    import { onMount, afterUpdate } from 'svelte';
    import { getAlbumArtBinaryImage } from '$lib/services/albumArtService.js';
    import BinaryImageRenderer from './BinaryImageRenderer.svelte';
    import { themeColors, ditherImages, windowStore } from '$lib/services/store.js';
    
    let songContainer;
    let artistContainer;

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;
    
    // Album art state
    let binaryImageData = null;
    let imageMetadata = null;
    let isLoading = false;
    let isProcessingAlbumArt = true;
    let currentImageUrl = '';
    let useFallback = false;

    async function loadAlbumArt() {
        if (!imageUrl || imageUrl === '/default-image.svg' || !albumArtId) {
            isProcessingAlbumArt = false;
            binaryImageData = null;
            imageMetadata = null;
            currentImageUrl = '';
            useFallback = true;
            return;
        }

        // If this is a new image, reset state
        if (currentImageUrl !== imageUrl) {
            isProcessingAlbumArt = true;
            binaryImageData = null;
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
            if (preloadedAlbumArt && preloadedAlbumArt.binaryData && preloadedAlbumArt.metadata) {
                console.log('⚡ Using preloaded album art for instant results display');
                binaryImageData = preloadedAlbumArt.binaryData;
                imageMetadata = preloadedAlbumArt.metadata;
                useFallback = false;
                isProcessingAlbumArt = false;
                return;
            }

            // Fallback: load if not preloaded (shouldn't happen in normal flow)
            console.log('🎨 Preload not available, loading album art binary image:', albumArtId);
            const result = await getAlbumArtBinaryImage(imageUrl);
            
            if (result.success) {
                binaryImageData = result.binaryData;
                imageMetadata = result.metadata;
                useFallback = false;
                console.log('✅ Album art binary image loaded for results:', result.cached ? 'from cache' : 'processed');
            } else {
                console.warn('⚠️  Album art binary loading failed, using fallback:', result.error);
                useFallback = true;
            }
        } catch (error) {
            console.error('❌ Error loading album art binary image:', error);
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
        binaryImageData = null;
        imageMetadata = null;
        currentImageUrl = '';
        isProcessingAlbumArt = false;
        useFallback = true;
    }

    function handleResize() {
        fitText();
    }

    onMount(() => {
        // Initial text fitting
        fitText();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    });
    
    afterUpdate(() => {
        // Re-fit text whenever component updates
        fitText();
    });

    function fitText() {
        if (songContainer) {
        textFit(songContainer, {
            multiLine: false,
            detectMultiLine: false,
            alignHoriz: false,
            alignVert: true,
            reProcess: true,
            minFontSize: 5,
            maxFontSize: 90,
            multiLine: true

        });
        }
        
        if (artistContainer) {
        textFit(artistContainer, {
            multiLine: false,
            detectMultiLine: false,
            alignHoriz: false,
            alignVert: true,
            reProcess: true,
            minFontSize: 5,
            maxFontSize: 50,
            multiLine: true
        });
        }
    }

</script>

<div class="resultsContainer">
    <div class="topSection">
        <div class="songDetails">
            <div class="albumCover">
                {#if isLoading || isProcessingAlbumArt}
                    <div class="loading-placeholder"></div>
                {:else if binaryImageData && imageMetadata && !useFallback}
                    <BinaryImageRenderer
                        binaryData={binaryImageData}
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
        min-height: 1.5em;
        color: var(--primary-color);
    }

    .songTextContainer{
        margin-top: 5%;
        height: 60%;
    }

    .artistTextContainer{
        height: 20%;
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

    .albumArt {
        margin: 0;
        width: 90%; /* Match loading placeholder size */
        aspect-ratio: 1/1;
        object-fit: cover;
        display: block;
        border: 2px solid var(--primary-color);
        /* Remove border-radius for album art */
    }

    /* Additional styles for BinaryImageRenderer when used as album art */
    :global(.albumArt .canvas-wrapper) {
        border: 2px solid var(--primary-color);
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
        border: 2px solid var(--primary-color);
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
</style>