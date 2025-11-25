<script>
    import { getArtistBinaryImage } from '$lib/services/grayscaleImageService';
    import GrayscaleImageRenderer from './GrayscaleImageRenderer.svelte';
    import { themeColors, ditherImages, imageColors, windowStore } from '$lib/services/store.js';
    
    export let name;
    export let imageUrl;
    export let urlKey; // Artist's Firestore document key
    export let windowHeight; // Window height for responsive sizing
    export let isLoadingImage = false; // External loading state (for when image is being extracted)
    
    // Debug: Log when props change
    $: if (name) console.log(`🎯 ArtistButton props updated:`, { 
        name, 
        urlKey, 
        imageUrl: imageUrl?.substring(0, 40) + '...',
        isLoadingImage 
    });

    let grayscaleImageData = null;
    let rawGrayscaleBytes = null; // Raw bytes for WebGL
    let imageMetadata = null;
    let isProcessing = true; // Internal processing state
    let currentImageUrl = ''; // Track the current image URL
    let currentUrlKey = ''; // Track the current urlKey to detect artist changes
    let useFallback = false; // Whether to use fallback img tag
    let imageLoadError = false; // Track if the fallback image failed to load

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;

    // Watch for artist identity changes (urlKey) and reset everything
    // Only trigger when urlKey actually changes, not when it's just undefined
    $: if (urlKey && urlKey !== currentUrlKey) {
        console.log(`🔄 ArtistButton: Artist changed from "${currentUrlKey}" to "${urlKey}" (name: ${name})`);
        // Complete reset when artist identity changes
        currentUrlKey = urlKey;
        currentImageUrl = '';
        grayscaleImageData = null;
        rawGrayscaleBytes = null;
        imageMetadata = null;
        useFallback = false;
        imageLoadError = false;
        isProcessing = true;
    }

    async function loadGrayscaleImage() {
        if (!imageUrl || imageUrl === '/default-image.svg' || imageUrl === null || imageUrl === undefined) {
            isProcessing = false;
            grayscaleImageData = null;
            rawGrayscaleBytes = null;
            imageMetadata = null;
            currentImageUrl = '';
            useFallback = false;
            return;
        }

        // If this is a new image, reset state
        if (currentImageUrl !== imageUrl) {
            console.log(`🔄 ArtistButton: Image URL changed for "${name}" (urlKey: ${urlKey})`, { 
                oldUrl: currentImageUrl, 
                newUrl: imageUrl, 
                urlKey 
            });
            isProcessing = true;
            grayscaleImageData = null;
            rawGrayscaleBytes = null;
            imageMetadata = null;
            currentImageUrl = imageUrl;
            useFallback = false;
            imageLoadError = false; // Reset error state for new image
        }

        try {
            console.log('🎨 Loading grayscale image for artist:', name, urlKey);
            
            if (!$ditherImages) {
                // If dithering is disabled, use fallback
                useFallback = true;
                isProcessing = false;
                return;
            }

            // Try to get grayscale image data
            if (urlKey) {
                console.log(`🎨 Attempting to load grayscale image for: ${name} (${urlKey})`);
                console.log(`🔗 Image URL: ${imageUrl}`);
                
                const result = await getArtistBinaryImage(urlKey, imageUrl);
                
                if (result.success) {
                    // Double-check that we're still loading this artist (prevent race conditions)
                    if (urlKey === currentUrlKey && imageUrl === currentImageUrl) {
                        grayscaleImageData = result.grayscaleData || result.binaryData; // Backward compatibility
                        rawGrayscaleBytes = result.rawGrayscaleBytes; // Raw bytes for WebGL
                        imageMetadata = result.metadata;
                        useFallback = false;
                        isProcessing = false; // IMPORTANT: Stop loading state NOW
                        console.log(`✅ Grayscale image loaded for ${name} (${urlKey}):`, result.cached ? 'from cache' : 'processed');
                        console.log(`📊 Render state after load:`, {
                            hasGrayscaleData: !!grayscaleImageData,
                            hasMetadata: !!imageMetadata,
                            useFallback,
                            isProcessing,
                            metadataWidth: imageMetadata?.width,
                            metadataHeight: imageMetadata?.height
                        });
                    } else {
                        console.warn(`⚠️ Stale image data received for ${name} - ignoring (urlKey changed from ${urlKey} to ${currentUrlKey})`);
                        isProcessing = false; // Also stop processing for stale data
                    }
                } else {
                    console.warn(`⚠️  Grayscale image failed for ${name}, using fallback:`, result.error);
                    console.warn(`🔍 Debug info:`, { urlKey, imageUrl, hasImageUrl: !!imageUrl });
                    // Use fallback for unsupported image types or processing errors
                    useFallback = true;
                    isProcessing = false; // Stop showing loading state
                }
            } else {
                console.warn(`⚠️  No urlKey provided for ${name}, using fallback`);
                useFallback = true;
                isProcessing = false; // Stop showing loading state
            }
        } catch (error) {
            console.error('❌ Error loading grayscale image for', name, ':', error.message || error);
            // Fallback to regular image on any error
            useFallback = true;
            isProcessing = false;
        } finally {
            isProcessing = false;
        }
    }

    // Clear image immediately when imageUrl becomes invalid (but preserve urlKey tracking)
    $: if (!imageUrl || imageUrl === '/default-image.svg' || imageUrl === null || imageUrl === undefined) {
        grayscaleImageData = null;
        rawGrayscaleBytes = null;
        imageMetadata = null;
        currentImageUrl = '';
        isProcessing = false;
        useFallback = false;
        imageLoadError = false;
    }
    
    // Clear everything when urlKey becomes invalid (artist removed)
    $: if (!urlKey) {
        currentUrlKey = '';
        grayscaleImageData = null;
        rawGrayscaleBytes = null;
        imageMetadata = null;
        currentImageUrl = '';
        isProcessing = false;
        useFallback = false;
        imageLoadError = false;
    }

    // Handle image load errors for fallback img tag
    function handleImageError(event) {
        console.warn(`⚠️  Image failed to load for ${name}:`, imageUrl);
        imageLoadError = true;
        // Prevent showing broken image icon
        event.target.style.display = 'none';
    }

    // Handle successful image load
    function handleImageLoad() {
        imageLoadError = false;
    }

    // Load grayscale image when imageUrl changes (but only if we have a valid urlKey)
    $: if (imageUrl && imageUrl !== '/default-image.svg' && imageUrl !== null && imageUrl !== undefined && urlKey) {
        console.log(`🖼️ ArtistButton reactive: imageUrl changed for "${name}"`, { imageUrl, urlKey, currentUrlKey });
        loadGrayscaleImage();
    }

    // Reload when dither setting changes
    $: if ($ditherImages !== undefined && imageUrl && imageUrl !== '/default-image.svg' && imageUrl !== null && imageUrl !== undefined) {
        loadGrayscaleImage();
    }
    
    // Retry mechanism for new artists - if we have an imageUrl but failed to load grayscale data
    // This handles the case where imageUrl is available but binary processing isn't complete yet
    $: if (imageUrl && imageUrl !== '/default-image.svg' && imageUrl !== null && imageUrl !== undefined && 
          useFallback && !isProcessing && $ditherImages && urlKey) {
        console.log(`🔄 Retrying grayscale image load for new artist: ${name}`);
        setTimeout(() => {
            if (imageUrl && useFallback && !isProcessing) { // Double-check conditions
                console.log(`⏰ Retry attempt for ${name} after delay`);
                loadGrayscaleImage();
            }
        }, 2000); // Retry after 2 seconds
    }
</script>

{#if name}
    <!-- svelte-ignore a11y-interactive-supports-focus -->
    <div class="artist-button" role="button" on:click on:keydown  aria-label="Artist Button" tabindex=4 style:border-radius="{windowHeight*0.019}px" style:height="{windowHeight*0.0897}px" data-artist-id="{urlKey || 'unknown'}">
        <div class="image-container">
            {#if isLoadingImage || isProcessing}
                <div class="loading-placeholder"></div>
            {:else if grayscaleImageData && imageMetadata && !useFallback}
                <GrayscaleImageRenderer
                    grayscaleData={grayscaleImageData}
                    rawGrayscaleBytes={rawGrayscaleBytes}
                    width={imageMetadata.width}
                    height={imageMetadata.height}
                    alt={name || 'Artist image'}
                    class="artist-image"
                />
            {:else if imageUrl && useFallback && !imageLoadError}
                <img 
                    src={imageUrl} 
                    alt={name || ''} 
                    class="artist-image"
                    on:error={handleImageError}
                    on:load={handleImageLoad}
                />
            {:else if imageLoadError}
                <div class="error-placeholder" title="Image failed to load"></div>
            {:else}
                <!-- Debug: Why are we showing placeholder? -->
                {#if typeof console !== 'undefined'}
                    {console.log(`⚠️ RENDER ISSUE for ${name}:`, {
                        hasGrayscaleData: !!grayscaleImageData,
                        hasMetadata: !!imageMetadata,
                        useFallback,
                        isProcessing,
                        isLoadingImage,
                        hasImageUrl: !!imageUrl,
                        imageLoadError,
                        urlKey
                    })}
                {/if}
                <div class="loading-placeholder"></div>
            {/if}
        </div>
        <span style:font-size="{windowHeight*0.026}px">{name}</span>
    </div>
{:else}
    <div class="artist-button-empty" style:border-radius="{windowHeight*0.019}px" style:height="{windowHeight*0.0897}px">
        <div class="artist-placeholder-image"></div>
        <div class="artist-placeholder-text"></div>
    </div>
{/if}

<style>
    .artist-button, .artist-button-empty {
        border: 2px solid var(--primary-color);
        border-radius: .8rem;
        /* height: 3vh; Responsive height that scales with viewport */
        flex-shrink: 0; /* Prevent shrinking when using gap */
        display: flex;
        align-items: center;
        justify-content: left;
        text-align: left;
        padding: 2%;
        outline: none;
        width: 100%; /* Ensure full width */
        min-width: 0; /* Allow content to shrink if needed */
        box-sizing: border-box; /* Include padding and border in size calculations */
    }
    .artist-button {
        cursor: pointer;
    }
    .artist-button:hover,
    .artist-button:focus {
        background-color: var(--primary-color);
    }
    .artist-button:hover span,
    .artist-button:focus span {
        color: var(--secondary-color);
    }
    .artist-placeholder-image {
        height: calc(100%);
        aspect-ratio: 1/1;
        background-size: 2px 2px;
        background-image:
            linear-gradient(45deg, var(--primary-color), 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color)),
            linear-gradient(45deg, var(--primary-color) 25%, var(--secondary-color), 25%, var(--secondary-color) 75%, var(--primary-color) 75%, var(--primary-color));
        border-radius: 35%;
        margin-right: 10px;
    }
    .image-container {
        height: 100%;
        aspect-ratio: 1/1;
        margin-right: 10px;
        position: relative;
        flex-shrink: 0; /* Prevent container from being compressed */
        width: auto; /* Let aspect-ratio determine width */
        max-width: 100%; /* Prevent overflow */
        overflow: hidden; /* Clip any overflow */
    }
    .artist-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 25%;
        object-fit: cover; /* Crop to fill the container */
        object-position: center; /* Ensure centered positioning */
        max-width: 100%;
        max-height: 100%;
    }
    .loading-placeholder {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 25%;
        background-color: var(--primary-color);
        opacity: 0.2;
        animation: pulse 1.5s infinite;
    }
    .error-placeholder {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 25%;
        background-color: var(--primary-color);
        opacity: 0.1;
        /* Show a subtle pattern to indicate error state */
        background-image: 
            repeating-linear-gradient(45deg, transparent, transparent 2px, var(--primary-color) 2px, var(--primary-color) 4px);
    }
    .artist-placeholder-text {
        width: calc(70% );
        height: calc(50% );
        background-size: 2px 2px;
        background-image:
            linear-gradient(45deg, var(--primary-color), 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color)),
            linear-gradient(45deg, var(--primary-color) 25%, var(--secondary-color), 25%, var(--secondary-color) 75%, var(--primary-color) 75%, var(--primary-color));
        border-radius: .5em;
    }
    span {
        color: var(--primary-color);
        font-size: 2.3vh;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }

    @keyframes pulse {
        0% { opacity: 0.2; }
        50% { opacity: 0.3; }
        100% { opacity: 0.2; }
    }
</style>