<script>
    export let label = ''; // The label text for the icon
    export let onClick; // Event handler for when the icon is clicked
    export let position = { x: 0, y: 0 };
    import { windowStore } from '$lib/services/store.js';

    $: screenDimensions = $windowStore.screenDimensions;
    
    // Calculate responsive icon dimensions
    $: aspectRatio = screenDimensions.width / screenDimensions.height;
    $: iconSize = aspectRatio > 1.65 ? 
        screenDimensions.height * 0.10 : 
        screenDimensions.width * 0.06; // Smaller factor for width to prevent jump
    $: iconLabelSize = aspectRatio > 1.65 ? 
        screenDimensions.height * 0.024 : 
        screenDimensions.width * 0.014; // Smaller factor for width to prevent jump
    $: iconContainerWidth = aspectRatio > 1.65 ? 
        screenDimensions.height * 0.2 : 
        screenDimensions.width * 0.12; // Smaller factor for width to prevent jump
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- TODO: Add keyboard navigation and focus styles -->
<div class="desktop-icon" on:click={onClick} style="top: {position.y}vh; right: 0; width:{iconContainerWidth}px">
    <div class="icon-svg" style:height="{iconSize}px" style:width="{iconSize}px">
        <slot width={iconSize} height={iconSize} name="icon"></slot> <!-- Slot for SVG content -->
    </div>
    <div class="icon-label" style:font-size="{iconLabelSize}px" >{label}</div>
</div>
<style>
    .desktop-icon {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        cursor: pointer;
    }
    .icon-label {
        background-color: var(--secondary-color); 
        color: var(--primary-color);
        text-align: center;
        padding: 2px 3px; 
        margin-top: 8px; 
        border: var(--border-width) solid var(--primary-color);
        width: max-content;
        font-size: 1em;
    }
</style>
