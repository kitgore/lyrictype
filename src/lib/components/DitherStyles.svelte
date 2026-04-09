<script>
    import { backgroundColors } from '$lib/services/store.js';
    import { DITHER_PATTERNS, generatePatternDataURI } from '$lib/services/dither-patterns.js';

    const PIXEL_SIZE = 2;

    $: styles = Object.entries(DITHER_PATTERNS).map(([name, matrix]) => {
        const dataURI = generatePatternDataURI(matrix, $backgroundColors.primary, $backgroundColors.secondary);
        const w = matrix[0].length * PIXEL_SIZE;
        const h = matrix.length * PIXEL_SIZE;
        return `.dither-${name} { background-image: ${dataURI} !important; background-size: ${w}px ${h}px !important; background-repeat: repeat !important; image-rendering: pixelated !important; }`;
    }).join('\n');
</script>

<svelte:head>
    {@html `<style id="dither-patterns">${styles}</style>`}
</svelte:head>
