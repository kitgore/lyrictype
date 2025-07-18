<script>
    import { getArtistLyrics, searchByArtistId } from '$lib/services/artistService';
    import TextInput from '$lib/components/TextInput.svelte';
    import LyricDisplay from '$lib/components/LyricDisplay.svelte';
    import ArtistButton from './ArtistButton.svelte';
    import ArtistSearchDropdown from './ArtistSearchDropdown.svelte';
    import { onMount, getContext } from 'svelte';
    import { recentArtists } from '$lib/services/store'
    import LoadingAnimation from '$lib/components/LoadingAnimation.svelte';
    import { themeColors, getElementTabIndex, windowStore, punctuation, capitalization, songQueue, queueActions } from '$lib/services/store.js';
    import ToggleButton from './ToggleButton.svelte'
    import QueueDisplay from './QueueDisplay.svelte'
    
    export let id; //window id

    $: inputTabIndex = getElementTabIndex(id, 10);
    $: buttonTabIndex = getElementTabIndex(id, 2);

    const PLAY_D  = "M8 5V19L19 12L8 5Z";
    const PAUSE_D = "M6 4H10V20H6V4ZM14 4H18V20H14V4Z";

    // reactive declaration: whenever `isPaused` flips,
    // re-compute `controlPath`
    $: controlPath = isPaused ? PLAY_D : PAUSE_D;

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
    let searchDropdown;
    let displayedArtist = 'Artist';
    let loading = false;
    let currentSong;
    let isPaused = false;
    let showQueue = false;

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;
    $: bottomButtonGap = windowHeight * 0.0075;

    // Reactive statements for queue functionality
    $: canGoPrevious = $songQueue.currentIndex > 0;
    $: canGoNext = $songQueue.currentIndex < $songQueue.songs.length - 1;
    $: futureSongsCount = $songQueue.songs.length - $songQueue.currentIndex - 1;

    function handleKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            focusInput();
        }
        console.log(inputTabIndex)
    }

    // Handle artist selection from dropdown
    async function handleArtistSelected(event) {
        const artist = event.detail;
        console.log('Artist selected:', artist);
        
        // Use artist name for the search
        const artistName = artist.name || artist;
        
        // Close queue display when new artist is selected
        showQueue = false;
        
        lyrics = '';
        loading = true;
        
        try {
            currentSong = await getArtistLyrics(artistName);
            console.log("HANDLE ARTIST SELECTED DATA:", currentSong);
            setDisplayFromData(currentSong);
            setNewRecentArtist({
                name: currentSong.initialArtist, 
                imageUrl: currentSong.initialArtistImg, 
                seenSongs: [currentSong.songIndex], 
                artistId: currentSong.initialArtistId, 
                songQueue: {}
            });
            // set song queue of current artist
            prepareQueue(currentSong.initialArtistId);
        } catch (error) {
            console.error('Error loading artist:', error);
            lyrics = "Error loading artist. Please try again.";
        } finally {
            loading = false;
        }
    }

    // Legacy function for backward compatibility
    async function handleArtistInput(event) {
        artistInput = event.target.value;
    }

    async function handleEnter(event){
        if (event.key === 'Enter') {
            blurInput(); // Remove focus from the input field
            event.preventDefault(); // Prevent form submission
            showQueue = false; // Close queue display
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
        showQueue = false; // Close queue display
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
        isPaused = false;
        showQueue = false; // Close queue display
        const currentArtistId = $recentArtists[0].artistId;
        playNextFromQueue(currentArtistId);

        // Add this to reset the test in LyricDisplay
        const restartEvent = new CustomEvent('restartTest', {
            detail: { songData: currentSong }
        });
        window.dispatchEvent(restartEvent);
    }

    function replaySong(){
        showQueue = false; // Close queue display
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
            
            // Add song to queue
            queueActions.addSong({
                title: data.title,
                artist: data.artist,
                image: data.image,
                lyrics: data.lyrics,
                artistId: data.artistId,
                songId: data.songId,
                url: data.url,
                primaryArtist: data.primaryArtist,
                artistImg: data.artistImg
            });
        } else {
            lyrics = "Lyrics not found.";
        }
        console.log($recentArtists);
    }

    // Helper function to set display without adding to queue (for navigation)
    function setDisplayFromDataWithoutQueue(data){
        console.log("DISPLAYING DATA (NO QUEUE):" , data)
        if (data && data.lyrics) {
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
    }

    function playPreviousSong() {
        isPaused = false;
        showQueue = false; // Close queue display
        
        const previousSong = queueActions.goToPrevious();
        if (previousSong) {
            currentSong = previousSong;
            setDisplayFromDataWithoutQueue(previousSong);
            
            // Reset typing test state
            const restartEvent = new CustomEvent('restartTest', {
                detail: { songData: previousSong }
            });
            window.dispatchEvent(restartEvent);
        }
        console.log("Previous song clicked");
    }

    function playNextSong() {
        isPaused = false;
        showQueue = false; // Close queue display
        
        // Try to get next song from queue first
        const nextSong = queueActions.goToNext();
        if (nextSong) {
            currentSong = nextSong;
            setDisplayFromDataWithoutQueue(nextSong);
        } else {
            // If no next song in queue, use the existing continueFromQueue function
            continueFromQueue();
        }

        const restartEvent = new CustomEvent('restartTest', {
            detail: { songData: currentSong }
        });
        window.dispatchEvent(restartEvent);
    }

    function restartSong() {
        isPaused = false;
        showQueue = false; // Close queue display
        
        // Reset the current song by calling the existing replaySong function
        replaySong();
        
        // Reset typing test state by dispatching a custom event
        // This will be handled by LyricDisplay to reset the test
        const restartEvent = new CustomEvent('restartTest', {
            detail: { songData: currentSong }
        });
        window.dispatchEvent(restartEvent);
    }

    function togglePause() {
        isPaused = !isPaused;
        showQueue = false; // Close queue display
        
        // When unpausing, restore focus to lyrics and make cursor blink
        if (!isPaused) {
            const unpauseEvent = new CustomEvent('unpauseTest');
            window.dispatchEvent(unpauseEvent);
        }
        
        console.log("Pause toggled:", isPaused);
    }

    function toggleQueue() {
        showQueue = !showQueue;
    }

    function handleQueueSongSelected(event) {
        const song = event.detail;
        if (song) {
            isPaused = false;
            currentSong = song;
            setDisplayFromDataWithoutQueue(song);
            
            // Reset typing test state
            const restartEvent = new CustomEvent('restartTest', {
                detail: { songData: song }
            });
            window.dispatchEvent(restartEvent);
        }
        showQueue = false; // Close queue after selection
    }

    function handleQueueClose() {
        showQueue = false;
    }

    function focusInput() {
        if (searchDropdown) {
            searchDropdown.focusInput();
        } else if (inputElement) {
            inputElement.focus();
            blink = true;
        }
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
        // Legacy input element event listeners (if using fallback input)
        if (inputElement) {
            inputElement.addEventListener('input', handleArtistInput);
            inputElement.addEventListener('keydown', handleEnter);
            inputElement.addEventListener('blur', blurInput);
        }
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
            <div class="headerInputSection">
                <div class="headerInputLabel" style:font-size="{windowHeight*0.035}px">Artist:</div>
                <div class="headerInputContainer">
                    <div class="searchDropdownWrapper">
                        <ArtistSearchDropdown 
                            bind:this={searchDropdown}
                            tabIndex={inputTabIndex}
                            fontSize="{windowHeight*0.035}px"
                            windowHeight={windowHeight}
                            on:artistSelected={handleArtistSelected}
                        />
                    </div>
                </div>
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
                    {#if showQueue}
                        <QueueDisplay 
                            {windowHeight}
                            isVisible={true}
                            on:songSelected={handleQueueSongSelected}
                            on:close={handleQueueClose}
                            embedded={true}
                        />
                    {:else if lyrics}
                        <LyricDisplay 
                            {lyrics} 
                            {songTitle} 
                            {artistName} 
                            {imageUrl}
                            {continueFromQueue}
                            {replaySong} 
                            {geniusUrl}
                            {isPaused}
                            capitalization={$capitalization}
                            punctuation={$punctuation}
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
            <div class="musicControls" style="--bottom-button-gap: {bottomButtonGap}px;">
                <button class="controlButton" on:click={playPreviousSong} disabled={!canGoPrevious} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                    </svg>
                </button>
                <button class="controlButton" on:click={restartSong} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 4h2v12H6zm8-2v16l6-8z"/>
                    </svg>
                </button>
                <button class="controlButton" on:click={togglePause} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d={controlPath}/>
                    </svg>
                </button>
                <button class="controlButton" on:click={playNextSong} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                </button>
                <button class="controlButton queueButton" on:click={toggleQueue} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/>
                    </svg>
                    {#if futureSongsCount > 0}
                        <span class="queue-indicator">{futureSongsCount}</span>
                    {/if}
                </button>
            </div>
            <div class="currentArtistContainer">
                <div class="musicIconContainer" style:width="{windowHeight*0.05}px" style:height="{windowHeight*0.040}px">
                    <svg class="musicIcon"  viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18.6779 0.220394C18.4735 0.0457943 18.2035 -0.0307252 17.9372 0.0112826L6.29208 1.84998C5.84528 1.92052 5.51616 2.30568 5.51616 2.75804V6.43547V12.258H3.67743C1.6497 12.2581 0 13.7703 0 15.629C0 17.4878 1.6497 19 3.67743 19C5.70516 19 7.35485 17.4878 7.35485 15.629V13.1774V7.22104L17.1613 5.67265V10.7258H15.3226C13.2949 10.7258 11.6452 12.238 11.6452 14.0968C11.6452 15.9555 13.2949 17.4678 15.3226 17.4678C17.3503 17.4678 19 15.9555 19 14.0968V11.6451V4.59678V0.919349C19 0.650492 18.8822 0.395068 18.6779 0.220394Z" fill="{$themeColors.primary}"/>
                    </svg>      
                </div>
                <div class="currentArtist" style:font-size="{windowHeight*0.038}px">{displayedArtist}</div>
                {#if songTitle}
                    <div class="songTitle" style:font-size="{windowHeight*0.034}px"> - {songTitle}</div>
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
        /* padding-left: 1%; */
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
         justify-content: flex-start;

         height: 13%;
         padding: 0 1.8%;
     }

     .musicControls {
         display: flex;
         align-items: center;
         gap: var(--bottom-button-gap);
         flex-shrink: 0;
     }

     .controlButton {
        font-size: 2em;
        /* padding: 0.5em 1em; */
        border: 2px solid var(--primary-color);
        background-color: var(--secondary-color);
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        justify-content: center;
        align-items: center;
        transition: background-color 0.2s ease;
        flex-shrink: 0;
        box-sizing: border-box;
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

    .controlButton:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .controlButton:disabled:hover,
    .controlButton:disabled:active,
    .controlButton:disabled:focus {
        background-image: none;
        background-color: var(--secondary-color);
    }


     .controlIcon {
        height: 75%;
        aspect-ratio: 1/1;
    }

    .queueButton {
        position: relative;
    }

    .queueButton::after {
        content: '';
        position: absolute;
        top: 4px;
        right: 4px;
        width: 8px;
        height: 8px;
        background: var(--primary-color);
        border-radius: 50%;
        opacity: 0;
        transition: opacity 0.2s ease;
    }

    .queueButton:hover::after {
        opacity: 0.6;
    }

    .queue-indicator {
        position: absolute;
        top: -4px;
        right: -4px;
        background: var(--primary-color);
        color: var(--secondary-color);
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "Geneva", sans-serif;
        font-size: 12px;
        font-weight: bold;
        border: 2px solid var(--secondary-color);
        min-width: 20px;
        pointer-events: none;
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
         padding-left: 5%;
         gap: .5em;
         font-size: 2vh;
         flex: 1;
         min-width: 0;
     }
         .musicIconContainer {
         display: flex;
         justify-content: center;
         align-items: center;
         padding-left: 1%;
     }

     /* Header Input Styles */
     .headerInputSection {
         display: flex;
         align-items: center;
         margin-left: 2%;
         height: 60%;
         flex: 1;
         margin-right: 2%;
         gap: 12px;
     }

     .headerInputLabel {
         font-family: "Geneva", sans-serif;
         color: var(--primary-color);
         white-space: nowrap;
         font-weight: 600;
     }

     .headerInputContainer {
         display: flex;
         align-items: center;
         height: 100%;
         border: 2px solid var(--primary-color);
         background-color: var(--secondary-color);
         border-radius: 4px;
         /* padding: 0 12px; */
         flex: 1;
     }

     .searchDropdownWrapper {
         flex: 1;
         position: relative;
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