<script>
    import { getArtistLyrics, searchByArtistId } from '$lib/services/artistService';
    import TextInput from '$lib/components/TextInput.svelte';
    import LyricDisplay from '$lib/components/LyricDisplay.svelte';
    import ArtistButton from './ArtistButton.svelte';
    import { onMount, getContext } from 'svelte';
    import { recentArtists } from '$lib/services/store'
    import LoadingAnimation from '$lib/components/LoadingAnimation.svelte';
    import { themeColors, getElementTabIndex, windowStore, punctuation, capitalization } from '$lib/services/store.js';
    import ToggleButton from './ToggleButton.svelte'
    
    export let id; //window id

    $: inputTabIndex = getElementTabIndex(id, 10);
    $: buttonTabIndex = getElementTabIndex(id, 2);

    let artistInput = '';
    let songTitle = '';
    let artistName = '';
    let imageUrl = '';
    let geniusUrl = '';
    let primaryArtist = '';
    let artistImg = '';
    let lyrics = '';
    let artistId = '';
    let songId = '';
    let blink = false;
    let inputElement;
    let displayedArtist = 'Artist';
    let loading = false;
    let currentSong;

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;

    function handleKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            focusInput();
        }
        console.log(inputTabIndex)
    }

    // Set the artist input to whats in the input field
    async function handleArtistInput(event) {
        artistInput = event.target.value;
    }

    async function handleEnter(event){
        if (event.key === 'Enter') {
            blurInput(); // Remove focus from the input field
            event.preventDefault(); // Prevent form submission
            lyrics = '';
            loading = true;
            currentSong = await getArtistLyrics(artistInput)
            console.log("HANDLE ENTER DATA:", currentSong);
            // const test = await searchByArtistId(1421, [], 2);
            setDisplayFromData(currentSong);
            setNewRecentArtist({name: currentSong.initialArtist, imageUrl: currentSong.initialArtistImg, seenSongs: [currentSong.songIndex], artistId: currentSong.initialArtistId, songQueue: {}});
            loading = false; 
            // set song queue of current artist
            prepareQueue(currentSong.initialArtistId);
        }
    }

    function requeueArtist(artistId) {
        const artist = $recentArtists.find(artist => artist.artistId === artistId);
        recentArtists.set([artist, ...$recentArtists.filter(artist => artist.artistId !== artistId)]);
        displayedArtist = artist.name;
        continueFromQueue();
        prepareQueue(artistId);
    }

    async function prepareQueue(artistId) {
        // Find existing artist to preserve their current data
        const existingArtist = $recentArtists.find(artist => artist.artistId === artistId);
        console.log("EXISTING ARTIST", existingArtist)
        const songQueue = await searchByArtistId(artistId, existingArtist.seenSongs);

        setNewRecentArtist({
            name: existingArtist.name, 
            imageUrl: existingArtist.imageUrl, 
            seenSongs: [...existingArtist.seenSongs, songQueue.songIndex], 
            artistId: existingArtist.artistId, 
            songQueue: songQueue
        });
    }

    function continueFromQueue(){
        const currentArtistId = $recentArtists[0].artistId;
        playNextFromQueue(currentArtistId);
    }

    function replaySong(){
        setDisplayFromData(currentSong);
        loading = false;
    }

    function playNextFromQueue(artistId) {
        const artist = $recentArtists.find(artist => artist.artistId === artistId);
        console.log("ARTIST AFTER PLAY NEXT", artist, $recentArtists)
        if (artist && Object.keys(artist.songQueue).length > 0) {
            console.log("recentArtists", $recentArtists);
            
            console.log("NEXT SONG ", artist.songQueue);
            currentSong = artist.songQueue;
            setDisplayFromData(artist.songQueue);
            prepareQueue(artistId);
            
            return artist.songQueue;
        }
        
        return null;
    }

    function setNewRecentArtist({ name, imageUrl, seenSongs, artistId, songQueue }){
        displayedArtist = name;
        recentArtists.set([{ name: name, imageUrl: imageUrl, seenSongs: seenSongs, artistId: artistId, songQueue: songQueue }, 
        ...$recentArtists.filter(artist => artist.artistId !== artistId)]);
    }

    function setDisplayFromData(data){
        console.log("DISPLAYING DATA:" , data)
        if (data && data.lyrics) {
            console.log("SET DISPLAY FROM DATA:", data)
            lyrics = data.lyrics;
            songTitle = data.title;
            artistName = data.artist;
            imageUrl = data.image;
            primaryArtist = data.primaryArtist;
            artistImg = data.artistImg;
            artistId = data.artistId;
            songId = data.songId;
            geniusUrl = data.url;
        } else {
            lyrics = "Lyrics not found.";
        }
        console.log($recentArtists);
    }

    function focusInput() {
        inputElement.focus();
        blink = true;
    }
    function blurInput() {
        console.log("blur");
        inputElement.blur();
        blink = false;
        console.log(document.activeElement)
        console.log(blink)
    }

    onMount(() => {
        focusInput();
        inputElement.addEventListener('input', handleArtistInput);
        inputElement.addEventListener('keydown', handleEnter);
        inputElement.addEventListener('blur', blurInput);
    });

    $: fullArtistList = [...$recentArtists, ...Array(7 - $recentArtists.length).fill({ name: null, imageUrl: null, artistId: null })];

</script>

<!-- Updated HTML structure -->
<div class="appContainer">
    <div class="mainSection">
        <div class="headerRow">
            <div class="sidebarTitle">
                <h3 style:font-size="{windowHeight*0.03}px">Recently Played</h3>
            </div>
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="headerInputContainer" on:click={focusInput} on:keydown={handleKeydown}>
                <div class="headerInputLabel" style:font-size="{windowHeight*0.025}px">Artist:</div>
                <div class="headerInputField" on:click={focusInput} on:keydown={handleKeydown} style:font-size="{windowHeight*0.02}px">
                    {#each artistInput.split('') as char, i}
                        <span class="headerInputChar">{char}</span>
                    {/each}
                    {#if blink}
                        <span class="headerCursor"></span>
                    {/if}
                </div>
                <input  
                    bind:this={inputElement} 
                    class="headerHiddenInput" 
                    type="textbox"
                    bind:value={artistInput}
                    on:focus={focusInput}
                    on:blur={blurInput}
                    tabindex={inputTabIndex}
                />
            </div>
            <div class="typingToggleButtons" style:gap={windowHeight * 0.007 + 'px'}>
                <ToggleButton bind:isToggled={$capitalization} displayText="Aa" buttonSize={windowHeight*.05}/>
                <ToggleButton bind:isToggled={$punctuation} displayText="!?" buttonSize={windowHeight*.05}/>
            </div>
        </div>
        <div class="contentLayout">
            <div class="sidebar">
                <div class="artistList">
                    {#each fullArtistList as artist, index}
                    <ArtistButton 
                        name={artist.name} 
                        imageUrl={artist.imageUrl || '/default-image.svg'} 
                        on:click={() => requeueArtist(artist.artistId)} 
                        on:keydown={(e) => {
                        if (e.key === 'Enter') {
                            requeueArtist(artist.artistId);
                        }
                        }} 
                    />
                    {/each}
                </div>
            </div>
            <div class="mainContent">
                <div class="lyricsContainer">
                    {#if lyrics}
                        <LyricDisplay 
                            {lyrics} 
                            {songTitle} 
                            {artistName} 
                            {imageUrl}
                            {continueFromQueue}
                            {replaySong} 
                            {geniusUrl}
                        />
                    {:else}
                        {#if loading}
                            <div class="loadingAnimationContainer">
                                <div style="height:{windowHeight*.15}px; width: 100%; justify-content:center; display: flex;">
                                    <LoadingAnimation className={"loadingAnimation"}/>
                                </div>
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        </div>
        <div class="bottomArtistRow">
            <div class="currentArtistContainer">
                <div class="musicIconContainer" style:width="{windowHeight*0.05}px" style:height="{windowHeight*0.040}px">
                    <svg class="musicIcon"  viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18.6779 0.220394C18.4735 0.0457943 18.2035 -0.0307252 17.9372 0.0112826L6.29208 1.84998C5.84528 1.92052 5.51616 2.30568 5.51616 2.75804V6.43547V12.258H3.67743C1.6497 12.2581 0 13.7703 0 15.629C0 17.4878 1.6497 19 3.67743 19C5.70516 19 7.35485 17.4878 7.35485 15.629V13.1774V7.22104L17.1613 5.67265V10.7258H15.3226C13.2949 10.7258 11.6452 12.238 11.6452 14.0968C11.6452 15.9555 13.2949 17.4678 15.3226 17.4678C17.3503 17.4678 19 15.9555 19 14.0968V11.6451V4.59678V0.919349C19 0.650492 18.8822 0.395068 18.6779 0.220394Z" fill="{$themeColors.primary}"/>
                    </svg>      
                </div>
                <div class="currentArtist" style:font-size="{windowHeight*0.038}px">{displayedArtist}</div>
                {#if songTitle}
                    <div class="songTitle" style:font-size="{windowHeight*0.032}px"> - {songTitle}</div>
                {/if}
            </div>
        </div>
     </div>
 </div>

<style>
    * {
        box-sizing: border-box;
        --sidebar-width: 21%;
    }

    /* Layout Containers */

    .typingToggleButtons {
        display: flex;
        flex-direction: row;
        align-items: center;
        padding-left: 3%;
        font-size: 2vh;
        max-width: 60%;  /* Maximum allowed width */

    }
    .appContainer {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
    }

    .mainSection {
        display: flex;
        height: 100%;
        width: 100%;
        flex-direction: column;
    }

    .contentLayout {
        display: flex;
        flex-direction: row;
        flex: 1;
    }

         .loadingAnimationContainer {
         display: flex;
         justify-content: center;
         align-items: center;
         height: 100%;
     }

     /* Bottom Artist Row */
     .bottomArtistRow {
         display: flex;
         flex-direction: row;
         align-items: center;
         justify-content: center;
         height: 13%;
         padding: 0 3%;
     }

    /* Header Section */
    .headerRow {
        display: flex;
        flex-direction: row;
        justify-content: left;
        align-items: center;
        height: 13%;
    }

    .sidebarTitle {
        width: var(--sidebar-width);
        display: flex;
        justify-content: center;
        align-items: center;
        padding-left: 1%;
        color: var(--primary-color);
    }

         .currentArtist {
         font-family: "Geneva", sans-serif;
         line-height: 150%;
         overflow: hidden;
         text-overflow: ellipsis;
         white-space: nowrap;
         width: fit-content;  /* Only take up as much space as needed */
         min-width: 0;  /* Allow text truncation */
         font-size: 3vh;
         font-weight: 600;
         color: var(--primary-color);
     }

     .songTitle {
         font-family: "Geneva", sans-serif;
         line-height: 150%;
         overflow: hidden;
         text-overflow: ellipsis;
         white-space: nowrap;
         width: fit-content;
         min-width: 0;
         font-weight: 400;
         color: var(--primary-color);
         opacity: 0.8;
     }
         .currentArtistContainer {
         display: flex;
         flex-direction: row;
         align-items: center;
         padding-left: 20%;
         gap: .5em;
         font-size: 2vh;
         max-width: 60%;  /* Maximum allowed width */
     }
         .musicIconContainer {
         display: flex;
         justify-content: center;
         align-items: center;
         padding-left: 1%;
     }

     /* Header Input Styles */
     .headerInputContainer {
         display: flex;
         align-items: center;
         margin-left: 2%;
         height: 60%;
         border: 2px solid var(--primary-color);
         background-color: var(--secondary-color);
         border-radius: 4px;
         padding: 0 8px;
         flex: 1;
         margin-right: 2%;
     }

     .headerInputLabel {
         font-family: "Geneva", sans-serif;
         color: var(--primary-color);
         margin-right: 8px;
         white-space: nowrap;
     }

     .headerInputField {
         flex: 1;
         white-space: pre-wrap;
         letter-spacing: -.05em;
         font-family: "Geneva", sans-serif;
         line-height: 130%;
         font-weight: 400;
         color: var(--primary-color);
         min-width: 120px;
         position: relative;
     }

     .headerInputChar {
         display: inline-block;
         font-family: "Geneva", sans-serif;
         font-weight: 200;
         color: var(--primary-color);
     }

     .headerCursor {
         display: inline-block;
         width: 2px;
         height: 80%;
         margin-left: -2px;
         position: absolute;
         top: 10%;
         background-color: currentColor;
         animation: blink-animation 1s steps(1) infinite;
         color: var(--primary-color);
     }

     .headerHiddenInput {
         position: absolute;
         top: 0;
         left: 0;
         opacity: 0;
         height: 0;
         width: 0;
         pointer-events: none;
     }

    /* Sidebar */
    .sidebar {
        width: var(--sidebar-width);
        height: 100%;
        display: flex;
        flex-direction: column;
    }

    .artistList {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        padding: 0 6% 0 10%;
        justify-content: space-between;
    }

    /* Main Content */
    .mainContent {
        width: 80%;
        height: 100%;
    }

    .lyricsContainer {
        border: 2px solid var(--primary-color);
        background-color: var(--secondary-color);
        height: 100%;
        border-radius: .2em;
    }

    

    /* Typography */
    h3 {
        display: flex;
        justify-content: end;
        line-height: 110%;
        text-align: center;
        font-size: 2.5vh;
    }

    /* Animations */
    @keyframes blink-animation {
        50% {
            opacity: 0;
        }
    }
</style>