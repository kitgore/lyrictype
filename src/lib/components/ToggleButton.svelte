<script>
    export let isToggled = false;
    export let buttonSize = 40; // Default size in pixels
    export let displayText = "";
    export let square = true; // Add a square parameter
</script>

<button 
    class={isToggled ? "toggledButton" : "untoggledButton"} 
    on:click={() => isToggled = !isToggled}
    style="
        font-size: {buttonSize * 0.6}px;
        padding: {Math.ceil(buttonSize * 0.12) + (isToggled ? 2 : 0)}px;
        border-radius: {Math.ceil(buttonSize * 0.2)}px;
        margin: {buttonSize * 0.05}px;
        {square ? `width: ${buttonSize * 1.1}px; height: ${buttonSize * 1.1}px;` : ''}">
    {displayText}
</button>

<style>
    button {
        border: none;
        cursor: pointer;
        font-family: 'SysFont', sans-serif;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
    }

    .toggledButton {
        background-color: var(--primary-color);
        color: var(--secondary-color);
    }

    .untoggledButton {
        background-color: var(--secondary-color);
        color: var(--primary-color);
        border: var(--primary-color) 2px solid;
    }
</style>