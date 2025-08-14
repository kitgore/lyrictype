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
    
    import { windowStore, windowActions } from '$lib/services/store.js';
    import CustomScrollbar from './CustomScrollbar.svelte';
    import { onMount, onDestroy, setContext } from 'svelte';

    $: screenDimensions = $windowStore.screenDimensions;
    $: padding = screenDimensions.height * 0.01;
    
    // Calculate responsive title bar dimensions based on window height, not screen height
    $: titleBarHeight = dimensions.height * 0.06; // 6% of window height
    $: closeButtonSize = dimensions.height * 0.045; // 4.5% of window height
    $: titleBarPadding = dimensions.height * 0.016; // 1.6% of window height
    
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
        <button class="close-button" style="width:{closeButtonSize}px; height:{closeButtonSize}px;" on:click={onClose} style:left="{titleBarPadding * 2.5}px"></button>
    </div>
    <div class="window-content" bind:this={contentElement}>
        <div class="content-area">
            <slot {id}></slot>
        </div>
        <div class="scrollbar-container">
            {#if contentElement && showScrollbar}
                <CustomScrollbar 
                    content={contentElement} 
                    {onScrollUp}
                    {onScrollDown}
                    {lyricsMode}
                />
            {/if}
        </div>
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
    border: 2px solid var(--primary-color);;
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
    border: 2px solid var(--primary-color);;
    font-size: 1.5vh;
    color: var(--primary-color);;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    outline: none;
    padding: 0;
}

.window-content {
    display: flex;
    flex-direction: row;
    flex-grow: 1;
    border: 2px solid var(--primary-color);;
    border-top: none;
}

.content-area {
    width: 92%;
    overflow-y: auto;
    height: 100%;
}
.scrollbar-container {
    width: 8%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
}

/* .app-window.active .title-bar {
    background-color: var(--secondary-color);
    border-color: var(--primary-color);
    border-width: 3px;
} */
</style>
  