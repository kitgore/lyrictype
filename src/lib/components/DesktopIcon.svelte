<script>
    export let label = ''; // The label text for the icon
    export let onClick; // Event handler for when the icon is clicked
    export let position = { x: 0, y: 0 };
    import { windowStore } from '$lib/services/store.js';

    $: screenDimensions = $windowStore.screenDimensions;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- TODO: Add keyboard navigation and focus styles -->
<div class="desktop-icon" on:click={onClick} style="top: {position.y}vh; right: 0; width:{screenDimensions.height*.2}px">
    <div class="icon-svg" style:height="{screenDimensions.height*.10}px" style:width="{screenDimensions.height*.10}px">
        <slot width={screenDimensions.height*.10} height={screenDimensions.height*.10} name="icon"></slot> <!-- Slot for SVG content -->
    </div>
    <div class="icon-label" style:font-size="{screenDimensions.height* .024}px" >{label}</div>
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
        color: var(--primary-color);; 
        text-align: center;
        padding: 2px 3px; 
        margin-top: 8px; 
        border: 1px solid var(--primary-color);;
        width: max-content;
        font-size: 1em;
    }
</style>
