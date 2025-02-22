<script>
    export let wpm;
    export let accuracy;
    export let songTitle;
    export let artistName;
    export let imageUrl;
    export let continueFromQueue;
    export let replaySong;
    export let geniusUrl;
    import textFit from 'textfit'
    import { onMount, afterUpdate } from 'svelte';
    let songContainer;
    let artistContainer;
    import { themeColors, windowStore } from '$lib/services/store.js';

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;
    
    let isLoading = false;


    function handleResize() {
        fitText();
    }

    onMount(() => {
        // Initial text fitting
        fitText();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    });
    
    afterUpdate(() => {
        // Re-fit text whenever component updates
        fitText();
    });

    function fitText() {
        if (songContainer) {
        textFit(songContainer, {
            multiLine: false,
            detectMultiLine: false,
            alignHoriz: false,
            alignVert: true,
            reProcess: true,
            minFontSize: 5,
            maxFontSize: 90,
            multiLine: true

        });
        }
        
        if (artistContainer) {
        textFit(artistContainer, {
            multiLine: false,
            detectMultiLine: false,
            alignHoriz: false,
            alignVert: true,
            reProcess: true,
            minFontSize: 5,
            maxFontSize: 50,
            multiLine: true
        });
        }
    }

</script>

<div class="resultsContainer">
    <div class="topSection">
        <div class="songDetails">
            <div class="albumCover">
                {#if isLoading || !imageUrl}
                    <div class="loading-placeholder"></div>
                {:else}
                    <img src={imageUrl} class="albumArt" alt="album art">
                {/if}                
            </div>
            <div class="songText">
                <div class="songTextContainer" bind:this={songContainer}>{songTitle}</div>
                <div class="artistTextContainer" bind:this={artistContainer} >{artistName}</div>
                <!-- <div class="songTitle"></div>
                <div class="artistName"></div> -->
            </div>
        </div>
        <div class="statsContainer"  >
            <p class="statLabel" style:font-size="{windowHeight*0.045}px">wpm:</p>
            <p class="statValue" style:font-size="{windowHeight*0.075}px">{wpm.toFixed(1)}</p>
            <p class="statLabel" style:font-size="{windowHeight*0.045}px">acc:</p>
            <p class="statValue" style:font-size="{windowHeight*0.075}px">{accuracy === 100 ? "100%" : accuracy.toFixed(1) + "%"}</p>
        </div>
    </div>
    <div class="bottomSection">
        <div class="controlsContainer">
            <button class="controlButton" on:click={continueFromQueue} tabindex=1>
                <svg class="controlIcon" viewBox="0 0 34 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13.7429 16.8075H14.7429C14.7429 16.4488 14.5508 16.1176 14.2394 15.9395C13.928 15.7614 13.5451 15.7637 13.2359 15.9456L13.7429 16.8075ZM3.07794 23.0811L2.57092 22.2191H2.57092L3.07794 23.0811ZM3.07794 2.03152L3.58496 1.16959H3.58496L3.07794 2.03152ZM13.7429 8.30505L13.2359 9.16698C13.5451 9.34886 13.928 9.35119 14.2394 9.1731C14.5508 8.995 14.7429 8.66377 14.7429 8.30505H13.7429ZM15.25 2.03152L14.7429 2.89345L15.25 2.03152ZM31.6768 11.6944L32.1838 10.8324L31.6768 11.6944ZM31.6768 13.4182L32.1838 14.2802L31.6768 13.4182ZM15.25 23.0811L14.7429 22.2191L15.25 23.0811ZM13.2359 15.9456L2.57092 22.2191L3.58496 23.943L14.25 17.6695L13.2359 15.9456ZM2.57092 22.2191H2.57092H0.570923C0.570923 23.766 2.2517 24.7273 3.58496 23.943L2.57092 22.2191ZM2.57092 22.2191V2.89346H0.570923V22.2191H2.57092ZM2.57092 2.89346L2.57092 2.89345L3.58496 1.16959C2.25169 0.385311 0.570923 1.34662 0.570923 2.89346H2.57092ZM2.57092 2.89345L13.2359 9.16698L14.25 7.44311L3.58496 1.16959L2.57092 2.89345ZM14.7429 8.30505V2.89346H12.7429V8.30505H14.7429ZM14.7429 2.89346V2.89345L15.757 1.16959C14.4237 0.385311 12.7429 1.34663 12.7429 2.89346H14.7429ZM14.7429 2.89345L31.1698 12.5563L32.1838 10.8324L15.757 1.16959L14.7429 2.89345ZM31.1698 12.5563L32.1838 14.2802C33.4984 13.5069 33.4984 11.6057 32.1838 10.8324L31.1698 12.5563ZM31.1698 12.5563L14.7429 22.2191L15.757 23.943L32.1838 14.2802L31.1698 12.5563ZM14.7429 22.2191H12.7429C12.7429 23.766 14.4237 24.7273 15.757 23.943L14.7429 22.2191ZM14.7429 22.2191V16.8075H12.7429V22.2191H14.7429Z" fill="{$themeColors.primary}"/>
                </svg>                    
            </button>
            <button class="controlButton" on:click={replaySong} tabindex=2>
                <svg class="controlIcon" viewBox="0 0 35 35" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.91669 19.0166V16.0417C2.91669 11.2092 6.8342 7.29167 11.6667 7.29167H30.625V7.29167" stroke="{$themeColors.primary}" stroke-width="2" stroke-linecap="round"/>
                    <path d="M27.7084 2.91667L32.0834 7.29167L27.7084 11.6667" stroke="{$themeColors.primary}" stroke-width="2" stroke-linecap="round"/>
                    <path d="M32.0833 14.5542V17.5291C32.0833 22.3616 28.1658 26.2791 23.3333 26.2791H4.375" stroke="{$themeColors.primary}" stroke-width="2" stroke-linecap="round"/>
                    <path d="M7.29169 30.625L2.91669 26.25L7.29169 21.875" stroke="{$themeColors.primary}" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </button>
            <button class="controlButton" tabindex=3 on:click={() => {window.open(geniusUrl, '_blank')}}>
                <svg class="controlIconLarge" viewBox="0 0 52 54" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14.5599 20.52H20.7999M23.9199 14.04V39.96M14.5599 27H20.7999M27.0399 20.52H37.4399M14.5599 33.48H20.7999M11.4399 14.04H40.5599V39.96H11.4399V14.04Z" stroke="{$themeColors.primary}" stroke-width="2"/>
                </svg>
            </button>
        </div>
    </div>
</div>

<style>
    *, *::before, *::after {
        box-sizing: border-box;
    }
    .songText {
        width: 60%;
        /* padding-right: 5%; */
        /* display: flex;
        flex-direction: column;
        gap: 0.5rem; */
    }
  
    .songTextContainer, .artistTextContainer {
        width: 100%;
        min-height: 1.5em;
        color: var(--primary-color);
    }

    .songTextContainer{
        margin-top: 5%;
        height: 60%;
    }

    .artistTextContainer{
        height: 20%;
        font-family: "Geneva", sans-serif;
        padding-left: 1%;
    }

    /* Main Layout */
    .resultsContainer {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
    }

    .topSection {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 75%;
        margin-top: 3%;
        margin-bottom: -3%;
    }

    .bottomSection {
        display: flex;
        flex-direction: row;
        justify-content: center;
        width: 100%;
        height: 25%;
    }

    /* Song Information */
    .songDetails {
        display: flex;
        flex-direction: row;
        width: 80%;
        height: 80%;
    }

    .albumCover {
        display: flex;
        width: 35%;
        height: 100%;
        justify-content: center;
        align-items: center;
        position: relative;  /* Add this */
        aspect-ratio: 1/1;  /* Add this */
    }

    .loading-placeholder {
        margin: 0;
        width: 90%;        /* Change from height to width */
        aspect-ratio: 1/1; /* Add this */
        object-fit: contain;
        display: block;
        border: 2px solid var(--primary-color);
        background-color: var(--primary-color);
        opacity: 0.2;
        animation: pulse 1.5s infinite;
    }

    .albumArt {
        margin: 0;
        width: 85%;        /* Change from height to width */
        aspect-ratio: 1/1; /* Add this */
        object-fit: cover;  /* Change from contain to cover */
        display: block;
        border: 2px solid var(--primary-color);
    }

    .songText {
        display: flex;
        flex-direction: column;
    }

    /* Stats Section */
    .statsContainer {
        display: flex;
        flex-direction: column;
        width: 20%;
        height: 80%;
        justify-content: center;
        margin-top: -1.5%;
        color: var(--primary-color);
    }

    .statLabel {
        font-size: 3vh;
        margin: 0;
    }

    .statValue {
        font-size: 5vh;
        margin-top: 5%;
        margin-bottom: 3%;
    }

    /* Controls */
    .controlsContainer {
        display: flex;
        justify-content: space-around;
        width: 100%;
        height: 75%;
    }

    .controlButton {
        font-size: 2em;
        /* padding: 0.5em 1em; */
        border: 2px solid var(--primary-color);
        background-color: var(--secondary-color);
        cursor: pointer;
        border-radius: 10px;
        height: 100%;
        width: 13%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .controlButton:hover,
    .controlButton:active,
    .controlButton:focus {
        background-size: 2px 2px; /* Size of the checker squares */
        background-image:
            linear-gradient(45deg, var(--primary-color), 25%, transparent 25%, transparent 75%, var(--primary-color) 75%, var(--primary-color)),
            linear-gradient(45deg, var(--primary-color) 25%, var(--secondary-color), 25%, var(--secondary-color) 75%, var(--primary-color) 75%, var(--primary-color));
        outline: none
    }

    .controlIcon {
        height: 50%;
        aspect-ratio: 1/1;
    }

    .controlIconLarge {
        height: 75%;
        aspect-ratio: 1/1;
    }
</style>