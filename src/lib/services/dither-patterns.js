/**
 * Dither pattern definitions and SVG generation.
 *
 * Each pattern is a 2D array where 0 = secondary color, 1 = primary color.
 * The array tiles seamlessly when repeated as a CSS background.
 */

export const DITHER_PATTERNS = {
    checkerboard: [
        [0, 1],
        [1, 0]
    ],
    lightdots: [
        [0, 0],
        [0, 1]
    ],
    heavydots: [
        [1, 1],
        [1, 0]
    ],
    vertical: [
        [0, 1]
    ],
    horizontal: [
        [0],
        [1]
    ],
    diagonal: [
        [1, 0, 0, 0],
        [0, 0, 0, 1],
        [0, 0, 1, 0],
        [0, 1, 0, 0]
    ],
    grid: [
        [0, 1, 0, 1],
        [1, 1, 1, 1],
        [0, 1, 0, 1],
        [1, 1, 1, 1]
    ],
    bayer: [
        [1, 0, 1, 0],
        [0, 0, 0, 0],
        [1, 0, 1, 0],
        [0, 0, 0, 1]
    ],
    cross: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 1, 0]
    ],
    diamond: [
        [0, 0, 1, 0, 0],
        [0, 1, 1, 1, 0],
        [1, 1, 1, 1, 1],
        [0, 1, 1, 1, 0],
        [0, 0, 1, 0, 0]
    ]
};

/**
 * Generate an SVG data URI from a 2D pattern matrix.
 * @param {number[][]} matrix - 2D array where 0 = secondaryColor, 1 = primaryColor
 * @param {string} primaryColor - CSS color string for 1 cells
 * @param {string} secondaryColor - CSS color string for 0 cells
 * @returns {string} CSS url() value with encoded SVG data URI
 */
export function generatePatternDataURI(matrix, primaryColor, secondaryColor) {
    const h = matrix.length;
    const w = matrix[0].length;

    let rects = '';
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const color = matrix[y][x] === 1 ? primaryColor : secondaryColor;
            rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
        }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Generate a full CSS background declaration for a pattern.
 * @param {number[][]} matrix - 2D pattern array
 * @param {string} primaryColor - CSS color for 1 cells
 * @param {string} secondaryColor - CSS color for 0 cells
 * @param {number} pixelSize - Screen pixels per matrix cell (default 2)
 * @returns {string} CSS property declarations string
 */
export function generatePatternCSS(matrix, primaryColor, secondaryColor, pixelSize = 2) {
    const dataURI = generatePatternDataURI(matrix, primaryColor, secondaryColor);
    const w = matrix[0].length * pixelSize;
    const h = matrix.length * pixelSize;
    return `background-image: ${dataURI}; background-size: ${w}px ${h}px;`;
}
