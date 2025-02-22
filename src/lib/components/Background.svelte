<script>
    import { themeColors } from '$lib/services/store.js';
    import { onMount } from 'svelte';
    import { windowStore } from '$lib/services/store.js';

    $: screenDimensions = $windowStore.screenDimensions;

    let backgroundSize = 4;

    export let currentPattern = 'checkerboard';

    $: pattern = {
        // 2x2 checkerboard
        checkerboard: `
            linear-gradient(45deg, var(--background-primary-color) 25%, transparent 25%, transparent 75%, var(--background-primary-color) 75%, var(--background-primary-color)),
            linear-gradient(45deg, var(--background-primary-color) 25%, var(--background-secondary-color) 25%, var(--background-secondary-color) 75%, var(--background-primary-color) 75%, var(--background-primary-color))
        `,
        // Cross pattern with proper secondary color
        cross: `
            linear-gradient(to right,
                var(--background-secondary-color) 25%,
                var(--background-primary-color) 25% 75%,
                var(--background-secondary-color) 75%
            ),
            linear-gradient(to bottom,
                var(--background-secondary-color) 25%,
                var(--background-primary-color) 25% 75%,
                var(--background-secondary-color) 75%
            ),
            linear-gradient(var(--background-secondary-color) 100%, var(--background-secondary-color) 100%)
        `,
        // 2x2 diagonal halftone (only corner pixels)
        corners: `
            linear-gradient(45deg, 
                var(--background-primary-color) 25%, 
                var(--background-secondary-color) 25% 75%, 
                var(--background-primary-color) 75%
            )
        `,
        // Alternating dots (like inverted checkerboard)
        dots: `
            linear-gradient(to right, var(--background-primary-color), var(--background-secondary-color)),
            linear-gradient(to bottom, var(--background-primary-color), var(--background-secondary-color));
            linear-gradient(to bottom, var(--background-primary-color), var(--background-secondary-color));
            background-size: var(--bg-size) var(calc(--bg-size * 2));
        `
    }[currentPattern];
</script>

<div class="container">
<div class="hotbar" style="height:{screenDimensions.height*.04}px; font-size: {screenDimensions.height*.022}px;">
    <svg class="icon" width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.8474 4.1044C12.7506 4.02169 12.6227 3.98545 12.4966 4.00534L6.98046 4.87631C6.76882 4.90972 6.61292 5.09216 6.61292 5.30644V7.04838V9.80644H5.74194C4.78144 9.80646 4 10.5228 4 11.4032C4 12.2837 4.78144 13 5.74194 13C6.70244 13 7.48388 12.2837 7.48388 11.4032V10.2419V7.42049L12.129 6.68705V9.08064H11.2581C10.2976 9.08064 9.51614 9.79695 9.51614 10.6774C9.51614 11.5579 10.2976 12.2742 11.2581 12.2742C12.2186 12.2742 13 11.5579 13 10.6774V9.51612V6.17742V4.43548C13 4.30813 12.9442 4.18714 12.8474 4.1044Z" fill="{$themeColors.primary}"/>
        <rect x="0.5" y="0.5" width="16" height="16" rx="3.5" stroke="{$themeColors.primary}"/>
        </svg>
    lyrictype.com
</div>
<div
class="background"
style="--bg-size: {backgroundSize}px; background-image: {pattern}"
>
</div>
</div>

<style>
    .container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        position: fixed;
        top: 0;
        left: 0;
    }
    .icon{
        height: 1.4em;
        width: 1.4em;
        margin-right: 1%;
    }
    .hotbar {
        top: 0;
        left: 0;
        width: 100vw;
        height: 2em;
        background-color: var(--secondary-color);
        z-index: 2;
        font-size: 1em;
        font-weight: 500;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        padding-left: 1.5%;

        display: flex;
        justify-content: left; 
        align-items: center;
        color: var(--primary-color);;
        border-bottom: 2px solid var(--primary-color);;
    }
    .background {
        flex: 1;
        width: 100%;
        background-size: var(--bg-size) var(--bg-size);
        background-image:
            linear-gradient(45deg, var(--background-primary-color) 25%, transparent 25%, transparent 75%, var(--background-primary-color) 75%, var(--background-primary-color)),
            linear-gradient(45deg, var(--background-primary-color) 25%, var(--background-secondary-color) 25%, var(--background-secondary-color) 75%, var(--background-primary-color) 75%, var(--background-primary-color));
        background-position: 0 0, calc(var(--bg-size) / 2) calc(var(--bg-size) / 2);
        z-index: -2;
    }
</style>