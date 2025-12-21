<script>
    export let width;
    export let height;
    export let leftFunction;
    export let rightFunction;
    export let displayText;
</script>

<!-- () => cycleTheme(-1) -->
  <!-- {themeChoices[themeIndex].name} -->

  <div class="container">
    <button class="arrow-btn" on:click={leftFunction} style="font-size:{height * 1.2}px">&lt;</button>
    <div class="text-display" style="font-size:{height}px; width: {height*width}px">
        {displayText}
    </div>
    <button class="arrow-btn" on:click={rightFunction} style="font-size:{height * 1.2}px">&gt;</button>
</div>

<style>
    .container {
        display: flex;
        align-items: stretch;
        gap: 0;
    }

    .text-display {
       border: var(--border-width) solid var(--primary-color);
       min-width: 8em;
       text-align: center;
       font-size: 1.3em;
       font-family: 'Geneva', sans-serif;
       display: flex;
       align-items: center;
       justify-content: center;
   }
    .arrow-btn {
        font-family: 'SysFont', sans-serif;
        background-color: var(--secondary-color);
        color: var(--primary-color);
        border: var(--border-width) solid var(--primary-color);
        border-radius: 5px;
        font-size: 1.5em; 
        width: max-content;
        text-align: center;
        cursor: pointer;
        height: 100%;     
        display: flex; 
        align-items: center; 
    }

    .arrow-btn:first-child {
        border-right: none;
        border-radius: 4px 0 0 4px;
    }

    .arrow-btn:last-child {
        border-left: none;
        border-radius: 0 4px 4px 0;
    }
</style>