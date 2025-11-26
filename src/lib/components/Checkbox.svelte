<script>
    export let checked = false;
    export let boxSize
    import { themeColors } from '$lib/services/store.js';
</script>
   
   <label class="checkbox">
    <input type="checkbox" bind:checked>
    <div class="box" style="width: {boxSize}px; height: {boxSize}px; border-radius: {Math.ceil(boxSize*(1/6))}px">
        {#if checked}
        <svg viewBox="0 0 13 12" class="checkmark" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: {boxSize*(2/3)}px; height: {boxSize*(2/3)}px;">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M13 0V3.5216L4.06094 12H3.60973H3.15853L0 8.99369V5.36216L3.66794 8.83457L13 0Z" fill="{$themeColors.primary}"/>
        </svg>
        {/if}
    </div>
   </label>
   
<style>
    .checkbox {
        position: relative;
        display: inline-block;
        cursor: pointer;
    }

    input {
        position: absolute;
        opacity: 0;
        cursor: pointer;
    }

    .box {
        width: 24px;
        height: 24px;
        border: var(--border-width) solid var(--primary-color);
        border-radius: 4px;
        display: grid;
        place-items: center;
    }

    .checkmark {
        width: 16px;
        height: 16px;
    }

    input:checked + .box .checkmark {
        color: white;
    }
</style>