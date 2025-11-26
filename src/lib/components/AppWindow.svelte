<script>
    export let id;
    export let title = 'Window';
    export let position = { x: 0, y: 0 };
    export let onClose;
    export let dimensions = { width: 80, height: 78 };
    export let showScrollbar = true;
    export let onScrollUp = null;
    export let onScrollDown = null;
    export let lyricsMode = false;
    export let showCustomScrollbars = false;
    export let displayScrollThumb = false;
    export let showTopbar = false;
    
    import { windowStore, windowActions } from '$lib/services/store.js';
    import CustomScrollbar from './CustomScrollbar.svelte';
    import { onMount, onDestroy, setContext } from 'svelte';

    $: screenDimensions = $windowStore.screenDimensions;
    $: padding = screenDimensions.height * 0.01;
    
    // Calculate responsive title bar dimensions based on window height, not screen height
    $: titleBarHeight = dimensions.height * 0.06; // 6% of window height
    $: closeButtonSize = dimensions.height * 0.045; // 4.5% of window height
    $: titleBarPadding = dimensions.height * 0.006; // 0.6% of window height
    $: closeButtonOutlineWidth = Math.max(2, dimensions.height * 0.006); // 1% of window height, minimum 2px
    
    // Custom scrollbar sizing (from TrashDisplay)
    $: customScrollbarWidth = dimensions.height * 0.07;
    $: customScrollArrowSize = dimensions.height * 0.07;
    $: customScrollThumbSize = dimensions.height * 0.16;
    $: customScrollArrowFontSize = dimensions.height * 0.036;
    
    // Topbar sizing
    $: topbarHeight = dimensions.height * 0.07; // 7% of window height
    // $: topbarPadding = dimensions.height * 0.01; // 1% of window height
    $: topbarFontSize = dimensions.height * 0.025; // 2.5% of window height
    
    let contentElement;
    let isDragging = false;
    let startPos = { x: 0, y: 0 };
    let originalPos = { x: 0, y: 0 };
    let appWindow;
    let mounted = false;

    // Subscribe to the window store
    let windowState = {};
    const unsubscribe = windowStore.subscribe(state => {
        windowState = state.windowStates.find(w => w.id === id) || {};
    });

    $: setContext('windowHeight', dimensions.height);

    onMount(() => {
        mounted = true;
        // Ensure window is in store when mounted
        if (!windowState.id) {
            windowActions.addWindow({
                id,
                title,
                position,
                dimensions
            });
        }
    });
    
    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });
    
    function onWindowClick() {
        if (mounted && id) {
            windowActions.activateWindow(id);
        }
    }
    function onDragStart(event) {
        if (!mounted || !appWindow) return;
        
        isDragging = true;
        windowActions.activateWindow(id);
        
        startPos = {
            x: event.clientX,
            y: event.clientY
        };
        
        originalPos = {
            x: appWindow.offsetLeft,
            y: appWindow.offsetTop
        };
        
        window.addEventListener('mousemove', onDrag);
        window.addEventListener('mouseup', onDragEnd);
        window.addEventListener('mouseleave', onDragEnd); // Add this line
    }

    function onDrag(event) {
        if (!isDragging || !appWindow) return;
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Get element dimensions
        const rect = appWindow.getBoundingClientRect();
        
        // Calculate new position
        let newX = event.clientX - startPos.x + originalPos.x;
        let newY = event.clientY - startPos.y + originalPos.y;
        
        // Constrain to viewport boundaries
        newX = Math.max(0, Math.min(newX, viewportWidth - rect.width));
        newY = Math.max(0, Math.min(newY, viewportHeight - rect.height));
        
        appWindow.style.left = `${newX}px`;
        appWindow.style.top = `${newY}px`;
    }

    function onDragEnd() {
        isDragging = false;
        window.removeEventListener('mousemove', onDrag);
        window.removeEventListener('mouseup', onDragEnd);
        window.removeEventListener('mouseleave', onDragEnd); // Add this line
        
        // Update the stored position when dragging ends
        if (appWindow) {
            const newPosition = {
                x: appWindow.style.left,
                y: appWindow.style.top
            };
            windowActions.updatePosition(id, newPosition);
        }
    }
</script>
  
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="app-window {windowState.isActive ? 'active' : ''}"
    bind:this={appWindow}
    on:mousedown={onWindowClick}
    style="
        top: {windowState.position?.y || position.y}vh;
        left: {windowState.position?.x || position.x}vw;
        width: {dimensions.width}px;
        height: {dimensions.height}px;
        z-index: {windowState.zIndex || 1};
        --border-width: 4px;
    "
>
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="title-bar" style:height="{titleBarHeight}px" on:mousedown|preventDefault={onDragStart}>
            <div style="padding:0 {titleBarPadding}px; display:flex; height: 100%; width: 100%;">
                <div class="lines-container" >
                    <svg 
                        width="100%" 
                        height="60%" 
                        viewBox="0 0 100 24" 
                        preserveAspectRatio="none"
                        xmlns="http://www.w3.org/2000/svg"
                        class="lines-svg"
                        >
                        <line x1="0" y1="2" x2="100%" y2="2" stroke="var(--primary-color)" stroke-width="1.5"/>
                        <line x1="0" y1="6" x2="100%" y2="6" stroke="var(--primary-color)" stroke-width="1.5"/>
                        <line x1="0" y1="10" x2="100%" y2="10" stroke="var(--primary-color)" stroke-width="1.5"/>
                        <line x1="0" y1="14" x2="100%" y2="14" stroke="var(--primary-color)" stroke-width="1.5"/>
                        <line x1="0" y1="18" x2="100%" y2="18" stroke="var(--primary-color)" stroke-width="1.5"/>
                        <line x1="0" y1="22" x2="100%" y2="22" stroke="var(--primary-color)" stroke-width="1.5"/>
                    </svg>
                </div>
            </div>
            

        <div class="title-text" style:font-size="{dimensions.height*0.042}px">{title}</div>
        <button class="close-button" style="width:{closeButtonSize}px; height:{closeButtonSize}px; outline-width:{closeButtonOutlineWidth}px;" on:click={onClose} style:left="{titleBarPadding * 5.2}px"></button>
    </div>
    
    {#if showTopbar}
        <div class="topbar" style:height="{topbarHeight}px" style:font-size="{topbarFontSize}px">
            <slot name="topbar" {id}></slot>
        </div>
    {/if}
    
    <div class="window-content" bind:this={contentElement}>
        {#if showCustomScrollbars}
            <div class="custom-scrollbar-wrapper" 
                 style="--custom-scrollbar-width: {customScrollbarWidth}px; 
                        --custom-scroll-arrow-size: {customScrollArrowSize}px; 
                        --custom-scroll-thumb-size: {customScrollThumbSize}px; 
                        --custom-scroll-arrow-font-size: {customScrollArrowFontSize}px;">
                <div class="custom-content-area">
                    <slot {id}></slot>
                </div>
                
                <!-- Right scrollbar -->
                <div class="custom-scrollbar-right">
                    <div class="custom-scroll-arrow custom-scroll-up" 
                         role="button" 
                         tabindex="0"
                         on:click={onScrollUp}
                         on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && onScrollUp && onScrollUp()}>
                        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="var(--primary-color)" stroke-width="1"/>
                        </svg>
                    </div>
                    <div class="custom-scrollbar-track">
                        {#if displayScrollThumb}
                            <div class="custom-scrollbar-thumb"></div>
                        {/if}
                    </div>
                    <div class="custom-scroll-arrow custom-scroll-down" 
                         role="button" 
                         tabindex="0"
                         on:click={onScrollDown}
                         on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && onScrollDown && onScrollDown()}>
                        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(180deg);">
                            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="var(--primary-color)" stroke-width="1"/>
                        </svg>
                    </div>
                </div>
                
                <!-- Bottom scrollbar -->
                <div class="custom-scrollbar-bottom">
                    <div class="custom-scroll-arrow custom-scroll-left">
                        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(-90deg);">
                            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="var(--primary-color)" stroke-width="1"/>
                        </svg>
                    </div>
                    <div class="custom-scrollbar-track-horizontal">
                        {#if displayScrollThumb}
                            <div class="custom-scrollbar-thumb-horizontal"></div>
                        {/if}
                    </div>
                    <div class="custom-scroll-arrow custom-scroll-right">
                        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(90deg);">
                            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="var(--primary-color)" stroke-width="1"/>
                        </svg>
                    </div>
                </div>
                
                <!-- Corner element -->
                <div class="custom-scrollbar-corner"></div>
            </div>
        {:else}
            <div class="content-area" class:full-width={!showScrollbar}>
                <slot {id}></slot>
            </div>
            {#if showScrollbar}
                <div class="scrollbar-container">
                    <CustomScrollbar 
                        content={contentElement} 
                        {onScrollUp}
                        {onScrollDown}
                        {lyricsMode}
                    />
                </div>
            {/if}
        {/if}
    </div>
</div>
<style>
.app-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    background-color: var(--secondary-color);
    transition: box-shadow 0.2s ease;
}

.app-window.active {
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
}

.title-bar {
    position: relative;
    background-color: var(--secondary-color);
    border: var(--border-width) solid var(--primary-color);
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    color: var(--primary-color);
}

.lines-container {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    /* padding: 0 10px; */
    /* position: absolute; */
}

.lines-svg {
    max-height: 70%;
}


.title-text {
    background-color: var(--secondary-color);
    padding: 0 .5vw;
    z-index: 1;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    user-select: none;
    color: var(--primary-color);
    line-height: .9;
}
/* {dimensions.height}px */
.close-button {
    position: absolute;
    right: 1.5vw;
    top: 50%;
    transform: translateY(-50%);
    width: 2.6vh; 
    height: 2.6vh;
    background-color: var(--secondary-color);
    border: solid var(--primary-color) var(--border-width);
    font-size: 1.5vh;
    color: var(--primary-color);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    outline: solid var(--secondary-color);
    padding: 0;
    line-height: 1;
}

.topbar {
    background-color: var(--secondary-color);
    border-left: var(--border-width) solid var(--primary-color);
    border-right: var(--border-width) solid var(--primary-color);
    border-bottom: var(--border-width) solid var(--primary-color);
    display: flex;
    align-items: center;
    box-sizing: border-box;
    color: var(--primary-color);
}

.window-content {
    display: flex;
    flex-direction: row;
    flex-grow: 1;
    border: var(--border-width) solid var(--primary-color);
    border-top: none;
}

.content-area {
    width: 92%;
    overflow-y: auto;
    height: 100%;
}

.content-area.full-width {
    width: 100%;
}
.scrollbar-container {
    width: 8%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
}

/* Custom scrollbars styles (from TrashDisplay) */
.custom-scrollbar-wrapper {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 1fr var(--custom-scrollbar-width);
    grid-template-rows: 1fr var(--custom-scrollbar-width);
    position: relative;
    overflow: hidden;
}

.custom-content-area {
    grid-column: 1;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
}

/* Right scrollbar */
.custom-scrollbar-right {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    background-color: var(--secondary-color);
    border-left: var(--border-width) solid var(--primary-color);
    margin: 0;
    padding: 0;
}

.custom-scrollbar-track {
    flex: 1;
    background-color: var(--secondary-color);
    position: relative;
}

.custom-scrollbar-thumb {
    width: 100%;
    height: var(--custom-scroll-thumb-size);
    background-color: var(--secondary-color);
    border-top: var(--border-width) solid var(--primary-color);
    border-bottom: var(--border-width) solid var(--primary-color);
    background-size: 2px 2px;
        background-image:
            linear-gradient(45deg, var(--primary-color), 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color)),
            linear-gradient(45deg, var(--primary-color) 25%, var(--secondary-color), 25%, var(--secondary-color) 75%, var(--primary-color) 75%, var(--primary-color));
    position: absolute;
    top: 20%;
}


.custom-scroll-arrow {
    height: var(--custom-scroll-arrow-size);
    background-color: var(--secondary-color);
    border: var(--border-width) solid var(--primary-color);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--custom-scroll-arrow-font-size);
    cursor: pointer;
    user-select: none;
}

.custom-scroll-arrow svg {
    width: calc(var(--custom-scroll-arrow-size) * 0.65);
    height: calc(var(--custom-scroll-arrow-size) * 0.65);
}

/* Vertical arrows can be slightly larger */
.custom-scroll-up svg,
.custom-scroll-down svg {
    width: calc(var(--custom-scroll-arrow-size) * 0.7);
    height: calc(var(--custom-scroll-arrow-size) * 0.7);
}

.custom-scroll-up {
    border-left: none;
    border-right: none;
    border-top: none;
}

.custom-scroll-down {
    border-left: none;
    border-right: none;
    border-bottom: none;
}

/* Bottom scrollbar */
.custom-scrollbar-bottom {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    flex-direction: row;
    background-color: var(--secondary-color);
    border-top: var(--border-width) solid var(--primary-color);
    margin: 0;
    padding: 0;
}

.custom-scrollbar-track-horizontal {
    flex: 1;
    background-color: var(--secondary-color);
    position: relative;
}

.custom-scrollbar-thumb-horizontal {
    height: 100%;
    width: var(--custom-scroll-thumb-size);
    background-color: var(--secondary-color);
    background-size: 2px 2px;
        background-image:
            linear-gradient(45deg, var(--primary-color), 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color)),
            linear-gradient(45deg, var(--primary-color) 25%, var(--secondary-color), 25%, var(--secondary-color) 75%, var(--primary-color) 75%, var(--primary-color));
    border-left: var(--border-width) solid var(--primary-color);
    border-right: var(--border-width) solid var(--primary-color);
    position: absolute;
    left: 30%;
}


.custom-scroll-left {
    width: var(--custom-scroll-arrow-size);
    height: var(--custom-scroll-arrow-size);
    border-top: none;
    border-bottom: none;
    border-left: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--secondary-color);
    cursor: pointer;
    user-select: none;
}

.custom-scroll-right {
    width: var(--custom-scroll-arrow-size);
    height: var(--custom-scroll-arrow-size);
    border-top: none;
    border-bottom: none;
    border-right: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--secondary-color);
    cursor: pointer;
    user-select: none;
}

/* Corner element */
.custom-scrollbar-corner {
    grid-column: 2;
    grid-row: 2;
    background-color: var(--secondary-color);
    border-left: var(--border-width) solid var(--primary-color);
    border-top: var(--border-width) solid var(--primary-color);
    margin: 0;
    padding: 0;
}



/* .app-window.active .title-bar {
    background-color: var(--secondary-color);
    border-color: var(--primary-color);
    border-width: 3px;
} */
</style>
  