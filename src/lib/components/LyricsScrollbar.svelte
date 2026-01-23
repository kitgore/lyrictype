<script>
    import { onMount, onDestroy } from 'svelte';
    
    export let onScrollUp = null;
    export let onScrollDown = null;
    export let onScrollToLine = null;
    export let containerHeight = 400;
    export let scrollPosition = { currentLine: 0, totalLines: 0, visibleLines: 4 };
    export let disabled = false; // Disable scrollbar interactions (e.g., on results page)
    
    // Calculate responsive dimensions based on container height
    $: scrollbarWidth = containerHeight * 0.07;
    $: scrollArrowSize = containerHeight * 0.07;
    
    // Calculate thumb size and position
    const MIN_THUMB_HEIGHT_PERCENT = 15; // Minimum thumb height as percentage of track
    
    $: showThumb = scrollPosition.totalLines > scrollPosition.visibleLines;
    $: calculatedThumbHeight = showThumb 
        ? (scrollPosition.visibleLines / scrollPosition.totalLines) * 100 
        : 0;
    $: thumbHeightPercent = Math.max(MIN_THUMB_HEIGHT_PERCENT, calculatedThumbHeight);
    $: maxScrollLines = Math.max(0, scrollPosition.totalLines - scrollPosition.visibleLines);
    $: thumbTopPercent = (maxScrollLines > 0 && showThumb)
        ? (scrollPosition.currentLine / maxScrollLines) * (100 - thumbHeightPercent)
        : 0;
    
    // Drag state
    let isDragging = false;
    let trackElement = null;
    
    function handleScrollUp() {
        if (disabled) return;
        if (onScrollUp && typeof onScrollUp === 'function') {
            onScrollUp();
        }
    }
    
    function handleScrollDown() {
        if (disabled) return;
        if (onScrollDown && typeof onScrollDown === 'function') {
            onScrollDown();
        }
    }
    
    function handleThumbMouseDown(event) {
        if (disabled) return;
        event.preventDefault();
        isDragging = true;
    }
    
    function handleMouseMove(event) {
        if (!isDragging || !trackElement || !onScrollToLine) return;
        
        // Get track dimensions and position
        const trackRect = trackElement.getBoundingClientRect();
        const trackHeight = trackRect.height;
        
        // Calculate mouse Y position relative to track
        const mouseY = event.clientY - trackRect.top;
        
        // Clamp to track bounds
        const clampedY = Math.max(0, Math.min(trackHeight, mouseY));
        
        // Convert to percentage (0-100)
        const percentY = (clampedY / trackHeight) * 100;
        
        // Account for thumb height - map the available range to line numbers
        // The thumb can travel from 0% to (100 - thumbHeightPercent)%
        const availableRange = 100 - thumbHeightPercent;
        const normalizedPercent = Math.max(0, Math.min(100, (percentY / availableRange) * 100));
        
        // Convert percentage to line number
        const targetLine = Math.round((normalizedPercent / 100) * maxScrollLines);
        
        // Call scrollToLine with the calculated line
        onScrollToLine(targetLine);
    }
    
    function handleMouseUp() {
        isDragging = false;
    }
    
    onMount(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    });
    
    onDestroy(() => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    });
</script>

<div class="lyrics-scrollbar" 
     class:disabled
     style="--scrollbar-width: {scrollbarWidth}px; 
            --scroll-arrow-size: {scrollArrowSize}px;">
    <div class="scroll-arrow scroll-up" 
         class:disabled
         role="button" 
         tabindex={disabled ? -1 : 0}
         on:click={handleScrollUp}
         on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleScrollUp()}>
        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="var(--primary-color)"/>
        </svg>
    </div>
    <div class="scrollbar-track" bind:this={trackElement}>
        {#if showThumb}
            <div class="scrollbar-thumb" 
                 class:disabled
                 role="slider"
                 tabindex={disabled ? -1 : 0}
                 aria-label="Scroll position"
                 aria-valuemin="0"
                 aria-valuemax={scrollPosition.totalLines - scrollPosition.visibleLines}
                 aria-valuenow={scrollPosition.currentLine}
                 class:dragging={isDragging}
                 on:mousedown={handleThumbMouseDown}
                 style="height: {thumbHeightPercent}%; top: calc({thumbTopPercent}% - var(--border-width));"></div>
        {/if}
    </div>
    <div class="scroll-arrow scroll-down" 
         class:disabled
         role="button" 
         tabindex={disabled ? -1 : 0}
         on:click={handleScrollDown}
         on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleScrollDown()}>
        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(180deg);">
            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="var(--primary-color)"/>
        </svg>
    </div>
</div>

<style>
    .lyrics-scrollbar {
        width: var(--scrollbar-width);
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--secondary-color);
        border-left: var(--border-width) solid var(--primary-color);
        margin: 0;
        padding: 0;
    }
    
    .scrollbar-track {
        flex: 1;
        background-color: var(--secondary-color);
        position: relative;
    }
    
    .scrollbar-thumb {
        width: 100%;
        border-top: var(--border-width) solid var(--primary-color);
        border-bottom: var(--border-width) solid var(--primary-color);
        background-size: 4px 4px;
        background-image:
            linear-gradient(45deg, var(--background-primary-color) 25%, transparent 25%, transparent 75%, var(--background-primary-color) 75%, var(--background-primary-color)),
            linear-gradient(45deg, var(--background-primary-color) 25%, var(--background-secondary-color) 25%, var(--background-secondary-color) 75%, var(--background-primary-color) 75%, var(--background-primary-color));
        background-position: 0 0, 2px 2px;
        background-attachment: fixed;
        image-rendering: pixelated;
        position: absolute;
        cursor: grab;
    }
    
    .scrollbar-thumb:active,
    .scrollbar-thumb.dragging {
        cursor: grabbing;
    }
    
    .scrollbar-thumb.disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }
    
    .scroll-arrow {
        height: var(--scroll-arrow-size);
        width: 100%;
        background-color: var(--secondary-color);
        border: var(--border-width) solid var(--primary-color);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        padding: 0;
        margin: 0;
    }
    
    .scroll-arrow svg {
        width: calc(var(--scroll-arrow-size) * 0.7);
        height: calc(var(--scroll-arrow-size) * 0.7);
    }
    
    .scroll-arrow svg path {
        stroke-width: calc(var(--border-width) * 0.8);
    }
    
    .scroll-up {
        border-left: none;
        border-right: none;
        border-top: none;
    }
    
    .scroll-down {
        border-left: none;
        border-right: none;
        border-bottom: none;
    }
    
    .scroll-arrow:hover {
        background-color: var(--primary-color);
    }
    
    .scroll-arrow:hover svg path {
        stroke: var(--secondary-color);
    }
    
    .scroll-arrow:active {
        opacity: 0.8;
    }
    
    .scroll-arrow.disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }
    
    .scroll-arrow.disabled:hover {
        background-color: var(--secondary-color);
    }
    
    .scroll-arrow.disabled:hover svg path {
        stroke: var(--primary-color);
    }
    
    .scroll-arrow.disabled:active {
        opacity: 0.5;
    }
</style>

