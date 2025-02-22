<script>
    import { onMount, afterUpdate, onDestroy } from 'svelte';
    import { themeColors } from '$lib/services/store.js';

    export let content; // The content element that will be scrolled
    let contentHeight;
    let contentWidth;
  
    // Function to scroll the content up
    function scrollUp() {
      content.scrollTop -= 20; // Adjust the scroll step size as needed
    }
  
    // Function to scroll the content down
    function scrollDown() {
      content.scrollTop += 20; // Adjust the scroll step size as needed
    }

    onMount(() => {
        // Wait until the next frame to ensure all DOM updates and CSS have been applied
        requestAnimationFrame(() => {
            calculateContentDimensions();
        });
        window.addEventListener('resize', calculateContentDimensions);
    });

    // Cleanup resize listener on component destruction
    onDestroy(() => {
        window.removeEventListener('resize', calculateContentDimensions);
    });

    afterUpdate(calculateContentDimensions);


    // Function to calculate scrollbar width based on the content height
    function calculateContentDimensions() {
        contentHeight = content.clientHeight;
        contentWidth = content.clientWidth;
        console.log(contentWidth, " ", contentHeight)
    }
  </script>
  
  <div class="scrollbar" style="width: {contentHeight * 0.08}px;">
    <button class="scroll-arrow" on:click={scrollUp}>
        <!-- Inline SVG for the up arrow -->
        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="{$themeColors.primary}" stroke-width="1"/>
        </svg>
    </button>
    <button class="track">
    <!-- The track in between the arrows -->
    </button>
    <button class="scroll-arrow" on:click={scrollDown}>
        <!-- Inline SVG for the down arrow, use the same SVG as the up arrow and rotate it -->
        <svg width="100%" height="100%" viewBox="0 0 23 18" fill="none" xmlns="http://www.w3.org/2000/svg" class="arrow down">
            <path d="M21 10.6L11.2222 1L1.44444 10.6L6.33333 10.6L6.33333 17L16.1111 17L16.1111 10.6L21 10.6Z" stroke="{$themeColors.primary}" stroke-width="1"/>
        </svg>
    </button>
</div>
  
  <style>
    .scrollbar {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        height: 85%;
        margin: 3% 0;
        margin-bottom: 25%;
    }
  
    .scroll-arrow {
        width: 100%;
        border: 2px solid var(--primary-color);;
        background-color: var(--secondary-color);
        aspect-ratio: 1; /* Makes the button square */
        padding: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        user-select: none;
        border-radius: .2em;
    }
  
    .track {
      width: 100%; /* Full width of the scrollbar container */
      background-color: var(--secondary-color);
      border: 2px solid var(--primary-color);;
      flex-grow: 1; /* Take up remaining space */
      margin: 70% 0;
      border-radius: .2em;
    }

    .scroll-arrow svg {
        width: 80%;
        height: auto; /* Maintain aspect ratio of SVG */
    }
    
    .arrow.down {
      transform: rotate(180deg); /* Rotate the arrow for the down direction */
    }
  </style>
  