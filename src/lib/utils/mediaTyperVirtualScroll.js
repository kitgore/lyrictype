/**
 * Virtual window scrolling — same step size as LyricDisplay (Media Typer) line scrolling.
 * Used for trash list “pages” and lyrics visible-line windows.
 */
export const VIRTUAL_SCROLL_CHUNK = 4;

/**
 * @param {number} currentIndex - First visible item/line index
 * @param {number} totalItems - Total items/lines
 * @param {number} visibleCount - How many fit in the viewport
 * @returns {number} New first-index (unchanged if already at top and not in “short content” reset case)
 */
export function virtualScrollUp(currentIndex, totalItems, visibleCount) {
	if (totalItems <= visibleCount) {
		return 0;
	}
	if (currentIndex <= 0) {
		return currentIndex;
	}
	return Math.max(0, currentIndex - VIRTUAL_SCROLL_CHUNK);
}

/**
 * @returns {number} New first-index
 */
export function virtualScrollDown(currentIndex, totalItems, visibleCount) {
	if (totalItems <= visibleCount) {
		return currentIndex;
	}
	const maxScroll = Math.max(0, totalItems - visibleCount);
	if (currentIndex >= maxScroll) {
		return currentIndex;
	}
	return Math.min(maxScroll, currentIndex + VIRTUAL_SCROLL_CHUNK);
}

/**
 * Clamp first-visible index to valid range.
 */
export function clampVirtualScrollIndex(index, totalItems, visibleCount) {
	const maxScroll = Math.max(0, totalItems - visibleCount);
	return Math.max(0, Math.min(maxScroll, index));
}
