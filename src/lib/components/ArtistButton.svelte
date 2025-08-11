<script>
    import { applyDitheringToImage } from '$lib/services/dither-utils';
    import { themeColors, ditherImages, imageColors, windowStore } from '$lib/services/store.js';
    export let name;
    export let imageUrl;
    export let isLoadingImage = false; // External loading state (for when image is being extracted)

    let ditheredImageUrl = '';
    let isProcessing = true; // Internal processing state (for dithering)
    let currentImageUrl = ''; // Track the current image URL

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;

    async function processDithering() {
        if (!imageUrl || imageUrl === '/default-image.svg') {
            isProcessing = false;
            ditheredImageUrl = '';
            return;
        }

        // If this is a new image, reset state
        if (currentImageUrl !== imageUrl) {
            isProcessing = true;
            ditheredImageUrl = '';
            currentImageUrl = imageUrl;
        }

        try {
            console.log('Applying dithering to image:', imageUrl, $imageColors.primary, $imageColors.secondary, $ditherImages, 200)
            ditheredImageUrl = $ditherImages ? await applyDitheringToImage(
                imageUrl,
                $imageColors.primary,
                $imageColors.secondary,
                $ditherImages,
                200
            ) : imageUrl;
        } catch (error) {
            console.error('Error processing image:', error);
            ditheredImageUrl = imageUrl;
        } finally {
            isProcessing = false;
        }
    }

    $: if (imageUrl && imageUrl !== '/default-image.svg') {
        processDithering();
    }

    // Watch for changes in the dither setting
    $: if ($ditherImages !== undefined && imageUrl && imageUrl !== '/default-image.svg' && $imageColors) {
        processDithering();
    }
</script>

{#if name}
    <!-- svelte-ignore a11y-interactive-supports-focus -->
    <div class="artist-button" role="button" on:click on:keydown  aria-label="Artist Button" tabindex=4 style:border-radius="{windowHeight*0.019}px">
        <div class="image-container">
            {#if isLoadingImage || isProcessing || !ditheredImageUrl}
                <div class="loading-placeholder"></div>
            {:else}
                <img src={ditheredImageUrl} alt={""} class="artist-image"/>
            {/if}
        </div>
        <span style:font-size="{windowHeight*0.026}px">{name}</span>
    </div>
{:else}
    <div class="artist-button-empty" style:border-radius="{windowHeight*0.019}px">
        <div class="artist-placeholder-image"></div>
        <div class="artist-placeholder-text"></div>
    </div>
{/if}

<style>
    .artist-button, .artist-button-empty {
        border: 2px solid var(--primary-color);
        border-radius: .8rem;
        height: calc(80% / 9);
        display: flex;
        align-items: center;
        justify-content: left;
        text-align: left;
        padding: 2%;
        outline: none
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
    }
    .artist-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 25%;
        object-fit: cover;
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