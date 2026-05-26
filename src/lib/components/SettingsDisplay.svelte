<script>
    import { onMount } from "svelte";
    import { themeColors, ditherImages, themeChoices, currentTheme, cookiesAccepted, windowStore, maxDisplayedLines } from "$lib/services/store.js";
    import Checkbox from "./Checkbox.svelte";
    import ArrowSelector from "./ArrowSelector.svelte";
    let themeIndex = 0; // Initialize with 0

    const maxLineChoices = [4, 8, 16, 32, 'full'];
    const maxLineLabels = { 4: '4', 8: '8', 16: '16', 32: '32', full: 'Full' };
    $: maxLinesIndex = Math.max(0, maxLineChoices.indexOf($maxDisplayedLines));

    function cycleMaxLines(direction) {
        const next = (maxLinesIndex + direction + maxLineChoices.length) % maxLineChoices.length;
        maxDisplayedLines.set(maxLineChoices[next]);
    }
    
    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'settingsWindow')?.dimensions?.height;

    $: headingSize = windowHeight * 0.036;
    $: checkboxSize = windowHeight * 0.036;
    $: themeHeight = windowHeight * 0.03;

    // Get initial index when component mounts
    onMount(() => {
        themeIndex = themeChoices.findIndex((theme) => 
            theme.primary === $currentTheme.primary && 
            theme.secondary === $currentTheme.secondary
        );
    });

    function cycleTheme(direction) {
        themeIndex = (themeIndex + direction + themeChoices.length) % themeChoices.length;
        currentTheme.set(themeChoices[themeIndex]);
    }
</script>

<div class="container">
    <div class="settingInline">
        <h3 style:font-size="{headingSize}px">Remember Preferences<br>(Cookies)</h3>
        <Checkbox bind:checked={$cookiesAccepted} boxSize={checkboxSize}/>
    </div>
    <div class="settingInline">
        <h3 style:font-size="{headingSize}px">Theme</h3>
        <ArrowSelector leftFunction={() => cycleTheme(-1)} rightFunction={() => cycleTheme(+1)}
            height={themeHeight} width={8} displayText={themeChoices[themeIndex].name}/>
    </div>
    <div class="settingInline">
        <h3 style:font-size="{headingSize}px">Recolor Images</h3>
        <Checkbox bind:checked={$ditherImages} boxSize={checkboxSize}/>
    </div>
    <div class="settingInline">
        <h3 style:font-size="{headingSize}px">Line Length</h3>
        <ArrowSelector leftFunction={() => cycleMaxLines(-1)} rightFunction={() => cycleMaxLines(+1)}
            height={themeHeight} width={8} displayText={maxLineLabels[maxLineChoices[maxLinesIndex]]}/>
    </div>
    <br/>
    <br/>
</div>

<style>
    * {
        font-family: "Geneva", sans-serif;
        color: var(--primary-color);
    }
    .settingInline {
        display: flex;
        align-items: center;
    }

    h2 {
        margin: 2% 0%;
        text-decoration: underline;
    }
    h3{
        margin: 2% 0%;
        font-family: 'SysFont', sans-serif;
        font-size: 1.6em;
        padding-right: 5%;
        font-weight: 100;
    }
    .container {
        padding: 0% 4%;
    }

    .arrow-btn:hover {
        background-color: var(--secondary-color); 
        color: var(--primary-color); 
    }
</style>
