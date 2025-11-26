<script>
    export let text = '';
    export let visible = false;
    export let x = 0;
    export let y = 0;
</script>

{#if visible && text}
    <div 
        class="tooltip" 
        style="left: {x}px; top: {y}px;"
    >
        <div class="tooltip-lines">
            <svg 
                width="100%" 
                height="100%" 
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
        <div class="tooltip-text">{text}</div>
    </div>
{/if}

<style>
.tooltip {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    background-color: var(--secondary-color);
    border: 2px solid var(--primary-color);
    min-width: 120px;
    max-width: 300px;
    padding: 8px 12px;
    font-family: 'SysFont', sans-serif;
    font-size: 14px;
    line-height: 1.2;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.tooltip-lines {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
}

.lines-svg {
    width: 100%;
    height: 100%;
}

.tooltip-text {
    background-color: var(--secondary-color);
    color: var(--primary-color);
    padding: 2px 6px;
    z-index: 1;
    position: relative;
    text-align: center;
    white-space: nowrap;
    /* White outline effect */
    text-shadow: 
        -1px -1px 0 var(--secondary-color),
        1px -1px 0 var(--secondary-color),
        -1px 1px 0 var(--secondary-color),
        1px 1px 0 var(--secondary-color),
        -2px 0 0 var(--secondary-color),
        2px 0 0 var(--secondary-color),
        0 -2px 0 var(--secondary-color),
        0 2px 0 var(--secondary-color);
    user-select: none;
}

/* Arrow pointing up (tooltip appears below cursor) */
.tooltip::before {
    content: '';
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid var(--primary-color);
    z-index: 2;
}

.tooltip::after {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 4px solid var(--secondary-color);
    z-index: 3;
}
</style>

