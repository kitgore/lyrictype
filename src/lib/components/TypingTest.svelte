<script>
    import { getArtistLyrics, searchByArtistId, fetchMultipleSongs, loadArtistForQueue } from '$lib/services/artistService';
    import { queueManager } from '$lib/services/queueManager.js';
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

    // SVG Paths
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
    
    // Track which artists are currently loading their images
    let loadingImageArtists = new Set();

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;
    $: bottomButtonGap = windowHeight * 0.0075;

    // Reactive statements for NEW queue functionality
    let queueStatus = queueManager.getQueueStatus();
    $: canGoPrevious = queueStatus.canGoPrevious;
    $: canGoNext = queueStatus.canGoNext;
    $: futureSongsCount = Math.min(5, queueStatus.totalSongs - queueStatus.currentIndex - 1);
    
    // Update queue status reactively
    $: if (currentSong) {
        queueStatus = queueManager.getQueueStatus();
    }

    function handleKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            focusInput();
        }
        console.log(inputTabIndex)
    }

    // Handle artist selection from dropdown - NEW CACHING SYSTEM
    async function handleArtistSelected(event) {
        const artist = event.detail;
        console.log('🎵 Artist selected (NEW SYSTEM):', artist);
        
        // Close queue display when new artist is selected
        showQueue = false;
        lyrics = '';
        loading = true;

        try {
            // STEP 1: Initialize queue with new caching system
            console.log('🚀 Initializing artist with caching system...');
            const firstSong = await queueManager.initializeWithArtist(artist);
            
            if (!firstSong) {
                lyrics = "No songs found for this artist.";
                return;
            }

            console.log("✅ FIRST SONG LOADED:", firstSong);

            // Set currentSong and display as soon as the first song resolves
            currentSong = firstSong;
            console.log('✅ FIRST SONG LOADED:', firstSong);
            setDisplayFromDataWithoutQueue(firstSong);
            
            // Get the updated artist info (including newly extracted imageUrl) after song population
            // Use a delayed check to allow background image extraction to complete
            const checkForUpdatedImageUrl = async (attempt = 1, maxAttempts = 3) => {
                try {
                    const { getArtistInfo } = await import('$lib/services/artistService');
                    // Use cache bypass for attempts 2 and beyond to get fresh data
                    const bypassCache = attempt > 1;
                    const updatedArtistInfo = await getArtistInfo(queueManager.artistUrlKey, bypassCache);
                    
                    console.log(`🔍 Attempt ${attempt} ${bypassCache ? '(bypassing cache)' : ''} - Retrieved artist info:`, {
                        name: updatedArtistInfo?.name,
                        imageUrl: updatedArtistInfo?.imageUrl,
                        originalImageUrl: artist.imageUrl,
                        urlKey: queueManager.artistUrlKey
                    });
                    
                    // Check if we found a new imageUrl (comparing against null/undefined original)
                    const hasNewImageUrl = updatedArtistInfo?.imageUrl && 
                                          updatedArtistInfo.imageUrl !== artist.imageUrl &&
                                          updatedArtistInfo.imageUrl !== null &&
                                          updatedArtistInfo.imageUrl !== undefined;
                    
                    if (hasNewImageUrl) {
                        console.log(`🖼️ Found updated imageUrl (attempt ${attempt}):`, updatedArtistInfo.imageUrl);
                        
                        // Remove from loading set since we found the image
                        loadingImageArtists.delete(artist.geniusId);
                        loadingImageArtists = loadingImageArtists; // Trigger reactivity
                        
                        // Update the recent artist with the newly extracted imageUrl
                        setNewRecentArtist({
                            name: artist.name, 
                            imageUrl: updatedArtistInfo.imageUrl,
                            artistId: artist.geniusId,
                            urlKey: queueManager.artistUrlKey,
                            songQueue: {}
                        });
                        return true; // Success
                    } else if (attempt < maxAttempts) {
                        // Try again if we haven't reached max attempts
                        console.log(`🖼️ No imageUrl yet (attempt ${attempt}) - current: ${updatedArtistInfo?.imageUrl}, original: ${artist.imageUrl}`);
                        setTimeout(() => checkForUpdatedImageUrl(attempt + 1, maxAttempts), 1500);
                    } else {
                        console.log('🖼️ No new imageUrl found after all attempts');
                        console.log('Final check - imageUrl in DB:', updatedArtistInfo?.imageUrl);
                        
                        // Remove from loading set since we're done trying
                        loadingImageArtists.delete(artist.geniusId);
                        loadingImageArtists = loadingImageArtists; // Trigger reactivity
                    }
                } catch (imageUpdateError) {
                    console.warn(`Could not fetch updated artist imageUrl (attempt ${attempt}):`, imageUpdateError);
                }
                return false;
            };
            
            // Start checking after a short delay
            setTimeout(() => checkForUpdatedImageUrl(), 1000);
            
            // Set initial recent artist data immediately (without waiting for imageUrl)
            // Mark this artist as loading an image if they don't have one yet
            if (!artist.imageUrl) {
                loadingImageArtists.add(artist.geniusId);
                loadingImageArtists = loadingImageArtists; // Trigger reactivity
            }
            
            setNewRecentArtist({
                name: artist.name, 
                imageUrl: artist.imageUrl, // Use original for now
                artistId: artist.geniusId,
                urlKey: queueManager.artistUrlKey,
                songQueue: {}
            });

            // Update queue status for reactive UI updates
            queueStatus = queueManager.getQueueStatus();
            console.log('📊 Queue initialized:', queueStatus.totalSongs, 'songs,', queueStatus.cachedSongs, 'cached');
            
            console.log(`📊 Queue initialized: ${queueStatus.totalSongs} songs, ${queueStatus.cachedSongs} cached`);
            
        } catch (error) {
            console.error('❌ Error loading artist (NEW SYSTEM):', error);
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
            
            try {
                currentSong = await getArtistLyrics(artistInput);
                console.log("HANDLE ENTER DATA:", currentSong);
                
                // Clear queue and add current song
                queueActions.clearQueue();
                queueActions.addSong(currentSong);
                
                setDisplayFromDataWithoutQueue(currentSong);
                setNewRecentArtist({
                    name: currentSong.initialArtist, 
                    imageUrl: currentSong.initialArtistImg, 
                    seenSongs: [currentSong.songIndex], 
                    artistId: currentSong.initialArtistId, 
                    songQueue: {}
                });
                
                // Load queue songs in the background
                if (currentSong.initialArtistId) {
                    loadQueueInBackground(currentSong.initialArtistId, [currentSong.songIndex]);
                }
            } catch (error) {
                console.error('Error loading artist lyrics:', error);
                lyrics = "Error loading artist. Please try again.";
            } finally {
                loading = false;
            }
        }
    }

    async function requeueArtist(artistId) {
        const artist = $recentArtists.find(artist => artist.artistId === artistId);
        if (!artist) return;
        
        console.log('🔄 Requeueing artist (NEW SYSTEM):', artist.name);
        
        recentArtists.set([artist, ...$recentArtists.filter(artist => artist.artistId !== artistId)]);
        displayedArtist = artist.name;
        showQueue = false; // Close queue display
        
        try {
            loading = true;
            lyrics = '';
            
            // Use the new queue system
            const firstSong = await queueManager.initializeWithArtist({
                name: artist.name,
                geniusId: artist.artistId,
                id: artist.urlKey || artist.name, // Use stored urlKey for Firestore doc id
                urlKey: artist.urlKey,
                imageUrl: artist.imageUrl
            });
            
            if (firstSong) {
                currentSong = firstSong;
                setDisplayFromDataWithoutQueue(firstSong);
                
                // Update queue status
                queueStatus = queueManager.getQueueStatus();
                
                // Reset typing test
                const restartEvent = new CustomEvent('restartTest', {
                    detail: { songData: firstSong }
                });
                window.dispatchEvent(restartEvent);
                
                console.log(`✅ Artist requeued: ${queueStatus.totalSongs} songs available`);
            } else {
                lyrics = "No songs found for this artist.";
            }
        } catch (error) {
            console.error('❌ Error requeueing artist (NEW SYSTEM):', error);
            lyrics = "Error loading artist songs.";
        } finally {
            loading = false;
        }
    }

    // LEGACY FUNCTIONS - Kept for compatibility but no longer used with new caching system
    // These will be removed once we confirm the new system is working properly

    function replaySong(){
        showQueue = false; // Close queue display
        setDisplayFromDataWithoutQueue(currentSong);
        loading = false;
    }



    function setNewRecentArtist({ name, imageUrl, seenSongs, artistId, songQueue, urlKey }){
        displayedArtist = name;
        // Persist the artist's Firestore URL key so we can requeue quickly later
        recentArtists.set([
            { name, imageUrl, seenSongs, artistId, songQueue, urlKey },
            ...$recentArtists.filter(artist => artist.artistId !== artistId)
        ]);
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

    async function playPreviousSong() {
        isPaused = false;
        showQueue = false; // Close queue display
        
        try {
            console.log('⏮️ Going to previous song (NEW SYSTEM)...');
            const previousSong = await queueManager.goToPrevious();
            
            if (previousSong) {
                currentSong = previousSong;
                setDisplayFromDataWithoutQueue(previousSong);
                
                // Update queue status
                queueStatus = queueManager.getQueueStatus();
                
                // Reset typing test state
                const restartEvent = new CustomEvent('restartTest', {
                    detail: { songData: previousSong }
                });
                window.dispatchEvent(restartEvent);
                
                console.log(`✅ Previous song loaded: ${previousSong.title}`);
            } else {
                console.log('📭 No previous song available');
            }
        } catch (error) {
            console.error('❌ Error loading previous song:', error);
            lyrics = "Error loading previous song.";
        }
    }

    async function playNextSong() {
        isPaused = false;
        showQueue = false; // Close queue display
        
        try {
            console.log('⏭️ Going to next song (NEW SYSTEM)...');
            const nextSong = await queueManager.goToNext();
            
            if (nextSong) {
                currentSong = nextSong;
                setDisplayFromDataWithoutQueue(nextSong);
                
                // Update queue status
                queueStatus = queueManager.getQueueStatus();
                
                // Reset typing test state
                const restartEvent = new CustomEvent('restartTest', {
                    detail: { songData: nextSong }
                });
                window.dispatchEvent(restartEvent);
                
                console.log(`✅ Next song loaded: ${nextSong.title}`);
            } else {
                console.log('📭 No next song available');
                lyrics = "No more songs available for this artist.";
            }
        } catch (error) {
            console.error('❌ Error loading next song:', error);
            lyrics = "Error loading next song.";
        }
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

    async function handleQueueSongSelected(event) {
        const songSelection = event.detail;
        if (songSelection && songSelection.index !== undefined) {
            try {
                console.log('🎯 Jumping to queue song at index:', songSelection.index);
                
                isPaused = false;
                const selectedSong = await queueManager.goToIndex(songSelection.index);
                
                if (selectedSong) {
                    currentSong = selectedSong;
                    setDisplayFromDataWithoutQueue(selectedSong);
                    
                    // Update queue status
                    queueStatus = queueManager.getQueueStatus();
                    
                    // Reset typing test state
                    const restartEvent = new CustomEvent('restartTest', {
                        detail: { songData: selectedSong }
                    });
                    window.dispatchEvent(restartEvent);
                    
                    console.log(`✅ Jumped to song: ${selectedSong.title}`);
                }
            } catch (error) {
                console.error('❌ Error jumping to queue song:', error);
                lyrics = "Error loading selected song.";
            }
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
                        isLoadingImage={loadingImageArtists.has(artist.artistId)}
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
                            songs={queueManager.getUpcomingSongs(5)}
                            currentIndex={queueStatus.currentIndex}
                            totalSongs={queueStatus.totalSongs}
                        />
                    {:else if lyrics}
                        <LyricDisplay 
                            {lyrics} 
                            {songTitle} 
                            {artistName} 
                            {imageUrl}
                            continueFromQueue={playNextSong}
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
                <button class="controlButton" class:paused={isPaused} on:click={togglePause} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d={controlPath}/>
                    </svg>
                </button>
                <button class="controlButton" on:click={playNextSong} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                </button>
                <button class="controlButton queueButton" class:queue-active={showQueue} on:click={toggleQueue} style:width="{windowHeight*0.06}px" style:height="{windowHeight*0.06}px">
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
    .controlButton:focus,
    .controlButton.paused,
    .controlButton.queue-active {
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
    .controlButton:disabled:focus,
    .controlButton:disabled.paused,
    .controlButton:disabled.queue-active {
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
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        overflow: hidden;
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