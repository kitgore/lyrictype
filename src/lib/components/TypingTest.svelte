<script>
    import { getArtistLyrics, searchByArtistId, fetchMultipleSongs, loadArtistForQueue, loadSpecificSong } from '$lib/services/artistService';
    import { queueManager, queueSongs, queueUpcomingSongs, queueIndex } from '$lib/services/queueManager.js';
    import { getAlbumArtBinaryImage } from '$lib/services/albumArtService.js';
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
    import LyricsScrollbar from './LyricsScrollbar.svelte'
    
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
    let albumArtId = null; // Album art ID for binary rendering
    let preloadedAlbumArt = null; // Preloaded album art binary data for instant results
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
    
    // Lyrics scrolling functionality
    let lyricsScrollUp = null;
    let lyricsScrollDown = null;
    let lyricsScrollToLine = null;
    let lyricsScrollPosition = { currentLine: 0, totalLines: 0, visibleLines: 4 };
    
    // Live WPM from LyricDisplay component
    let liveWpm = 0;
    
    // Results state from LyricDisplay (to disable scrollbar on results page)
    let showResults = false;
    
    // Debug reactive statement to monitor scroll function binding
    $: {
        console.log('TypingTest: Scroll functions updated', {
            hasScrollUp: !!lyricsScrollUp,
            hasScrollDown: !!lyricsScrollDown,
            scrollUpType: typeof lyricsScrollUp,
            scrollDownType: typeof lyricsScrollDown
        });
    }

    $: windowHeight = $windowStore.windowStates.find(w => w.id === 'typingTestWindow')?.dimensions?.height;
    $: bottomButtonGap = windowHeight * 0.0075;
    
    // Pure responsive button sizing that scales with window size without limits
    $: buttonSize = windowHeight * 0.06;

    // Reactive statements for NEW queue functionality
    // Update queue status reactively whenever queue songs or index change
    $: queueStatus = ($queueSongs && $queueIndex !== undefined) ? queueManager.getQueueStatus() : { canGoPrevious: false, canGoNext: false, totalSongs: 0, currentIndex: 0 };
    $: canGoPrevious = queueStatus.canGoPrevious;
    $: canGoNext = queueStatus.canGoNext;
    $: futureSongsCount = Math.min(5, queueStatus.totalSongs - queueStatus.currentIndex - 1);

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
        console.log('🔍 Artist details - geniusId:', artist.geniusId, 'name:', artist.name, 'imageUrl:', artist.imageUrl);
        
        // IMPORTANT: Capture the artist name from the dropdown selection BEFORE any async operations
        // This ensures we use the name the user actually clicked on, not any potentially
        // incorrect data from Firestore that might be loaded later
        const selectedArtistName = artist.name;
        
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
            
            // Validate: Check if loaded artist data has a different name than what user selected
            // This can happen if the Firestore document has incorrect data
            if (queueManager.artistData?.name && queueManager.artistData.name !== selectedArtistName) {
                console.warn('⚠️ ARTIST NAME MISMATCH DETECTED!');
                console.warn(`   User selected: "${selectedArtistName}"`);
                console.warn(`   Firestore has: "${queueManager.artistData.name}"`);
                console.warn('   Using the user-selected name for recently played list');
            }

            // Set currentSong and display as soon as the first song resolves
            currentSong = firstSong;
            console.log('✅ FIRST SONG LOADED:', firstSong);
            setDisplayFromDataWithoutQueue(firstSong);
            
            // Get the updated artist info (including newly extracted imageUrl) after song population
            // Use a delayed check to allow background image extraction to complete
            // IMPORTANT: Use selectedArtistName (from dropdown) not artist.name (could be stale reference)
            const capturedUrlKey = queueManager.artistUrlKey;
            const capturedArtistId = artist.geniusId;
            const capturedArtistName = selectedArtistName;
            
            const checkForUpdatedImageUrl = async (attempt = 1, maxAttempts = 5) => {
                try {
                    const { getArtistInfo } = await import('$lib/services/artistService');
                    // Always bypass cache for fresh data
                    const bypassCache = true;
                    const updatedArtistInfo = await getArtistInfo(capturedUrlKey, bypassCache);
                    
                    console.log(`🔍 Attempt ${attempt} ${bypassCache ? '(bypassing cache)' : ''} - Retrieved artist info:`, {
                        name: updatedArtistInfo?.name,
                        imageUrl: updatedArtistInfo?.imageUrl,
                        originalImageUrl: artist.imageUrl,
                        capturedUrlKey: capturedUrlKey,
                        currentUrlKey: queueManager.artistUrlKey
                    });
                    
                    // Check if we found a new imageUrl (comparing against null/undefined original)
                    const hasNewImageUrl = updatedArtistInfo?.imageUrl && 
                                          updatedArtistInfo.imageUrl !== artist.imageUrl &&
                                          updatedArtistInfo.imageUrl !== null &&
                                          updatedArtistInfo.imageUrl !== undefined;
                    
                    if (hasNewImageUrl) {
                        console.log(`🖼️ Found updated imageUrl (attempt ${attempt}):`, updatedArtistInfo.imageUrl.substring(0, 50));
                        console.log(`🔍 About to update artist "${capturedArtistName}" with:`, {
                            artistId: capturedArtistId,
                            urlKey: capturedUrlKey,
                            currentQueueUrlKey: queueManager.artistUrlKey
                        });
                        console.log('📋 Current list before image update:', $recentArtists.map(a => a.name));
                        
                        // Remove from loading set since we found the image
                        loadingImageArtists.delete(capturedArtistId);
                        loadingImageArtists = loadingImageArtists; // Trigger reactivity
                        
                        // Update the recent artist with the newly extracted imageUrl
                        // USE CAPTURED VALUES to avoid race conditions
                        console.log('📞 Calling setNewRecentArtist with updated imageUrl (using captured urlKey)');
                        setNewRecentArtist({
                            name: capturedArtistName, 
                            imageUrl: updatedArtistInfo.imageUrl,
                            artistId: capturedArtistId,
                            urlKey: capturedUrlKey, // Use captured value, not current queueManager value!
                            songQueue: {}
                        });
                        
                        console.log('✅ After image update, list:', $recentArtists.map(a => a.name));
                        return true; // Success
                    } else if (attempt < maxAttempts) {
                        // Try again if we haven't reached max attempts
                        console.log(`🖼️ No imageUrl yet (attempt ${attempt}) - current: ${updatedArtistInfo?.imageUrl}, original: ${artist.imageUrl}`);
                        setTimeout(() => checkForUpdatedImageUrl(attempt + 1, maxAttempts), 1500);
                    } else {
                        console.log('🖼️ No new imageUrl found after all attempts');
                        console.log('Final check - imageUrl in DB:', updatedArtistInfo?.imageUrl);
                        console.log('⚠️ Artist will remain in list without image:', capturedArtistName);
                        
                        // Remove from loading set since we're done trying
                        loadingImageArtists.delete(capturedArtistId);
                        loadingImageArtists = loadingImageArtists; // Trigger reactivity
                        
                        // Ensure artist is still in the list (shouldn't need this but being defensive)
                        const artistInList = $recentArtists.find(a => 
                            (a.artistId && a.artistId === capturedArtistId) || 
                            (a.urlKey && a.urlKey === capturedUrlKey) ||
                            (a.name && a.name === capturedArtistName)
                        );
                        if (!artistInList) {
                            console.error('🚨 Artist missing from list after imageUrl check failed! Re-adding:', capturedArtistName);
                            setNewRecentArtist({
                                name: capturedArtistName,
                                imageUrl: null,
                                artistId: capturedArtistId,
                                urlKey: capturedUrlKey, // Use captured value!
                                songQueue: {}
                            });
                        }
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
                console.log('📸 Artist has no imageUrl, marking as loading:', selectedArtistName);
                loadingImageArtists.add(artist.geniusId);
                loadingImageArtists = loadingImageArtists; // Trigger reactivity
            }
            
            console.log('📞 Calling setNewRecentArtist with initial artist data');
            console.log('🔍 Initial artist data:', {
                name: selectedArtistName,
                artistId: artist.geniusId, 
                imageUrl: artist.imageUrl, 
                urlKey: queueManager.artistUrlKey,
                hasImage: !!artist.imageUrl
            });
            
            // IMPORTANT: Use selectedArtistName (captured at start) to ensure we use
            // the name the user clicked on, not any potentially incorrect Firestore data
            setNewRecentArtist({
                name: selectedArtistName, 
                imageUrl: artist.imageUrl || null, // Use null instead of undefined
                artistId: artist.geniusId,
                urlKey: queueManager.artistUrlKey,
                songQueue: {}
            });
            
            console.log('✅ After setNewRecentArtist, list length:', $recentArtists.length);
            console.log('✅ First artist in list:', $recentArtists[0]?.name);

            // Queue status will update reactively via $: statement
            console.log(`📊 Queue initialized: ${queueManager.getQueueStatus().totalSongs} songs, ${queueManager.getQueueStatus().cachedSongs} cached`);
            
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
        const artist = $recentArtists.find(a => a.artistId === artistId);
        if (!artist) {
            console.warn('⚠️ Artist not found in recent list:', artistId);
            return;
        }
        
        console.log('🔄 Requeueing artist (NEW SYSTEM):', artist.name, { artistId, urlKey: artist.urlKey });
        console.log('📋 Current recentArtists before requeue:', $recentArtists.map(a => ({ name: a.name, artistId: a.artistId, urlKey: a.urlKey, imageUrl: a.imageUrl })));
        
        // Filter more robustly using both artistId and urlKey, with proper undefined handling
        const filteredArtists = $recentArtists.filter(a => {
            const matchesId = artistId && a.artistId && a.artistId === artistId;
            const matchesKey = artist.urlKey && a.urlKey && a.urlKey === artist.urlKey;
            const matchesName = artist.name && a.name && a.name === artist.name;
            return !(matchesId || matchesKey || matchesName);
        });
        
        const newList = [artist, ...filteredArtists];
        
        console.log('📋 New recentArtists after requeue:', newList.map(a => ({ name: a.name, artistId: a.artistId, urlKey: a.urlKey, imageUrl: a.imageUrl })));
        
        recentArtists.set(newList);
        displayedArtist = artist.name;
        showQueue = false; // Close queue display
        
        try {
            loading = true;
            lyrics = '';
            
            // If artist doesn't have an imageUrl, try to fetch it from database
            let artistImageUrl = artist.imageUrl;
            if (!artistImageUrl || artistImageUrl === null || artistImageUrl === undefined) {
                try {
                    console.log('🖼️ Artist missing imageUrl, fetching from database...');
                    const { getArtistInfo } = await import('$lib/services/artistService');
                    const artistInfo = await getArtistInfo(artist.urlKey, true); // Bypass cache
                    artistImageUrl = artistInfo?.imageUrl;
                    console.log('🖼️ Retrieved imageUrl:', artistImageUrl);
                    
                    // Update recent artist with the imageUrl
                    if (artistImageUrl) {
                        setNewRecentArtist({
                            name: artist.name,
                            imageUrl: artistImageUrl,
                            artistId: artist.artistId,
                            urlKey: artist.urlKey,
                            songQueue: artist.songQueue
                        });
                    }
                } catch (error) {
                    console.warn('⚠️ Could not fetch artist imageUrl:', error);
                }
            }
            
            // Use the new queue system
            const firstSong = await queueManager.initializeWithArtist({
                name: artist.name,
                geniusId: artist.artistId,
                id: artist.urlKey || artist.name, // Use stored urlKey for Firestore doc id
                urlKey: artist.urlKey,
                imageUrl: artistImageUrl
            });
            
            if (firstSong) {
                currentSong = firstSong;
                setDisplayFromDataWithoutQueue(firstSong);
                
                // Queue status will update reactively via $: statement
                
                // Reset typing test
                const restartEvent = new CustomEvent('restartTest', {
                    detail: { songData: firstSong }
                });
                window.dispatchEvent(restartEvent);
                
                console.log(`✅ Artist requeued: ${queueManager.getQueueStatus().totalSongs} songs available`);
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
        console.log('🔧 setNewRecentArtist called:', { name, artistId, imageUrl, urlKey });
        console.log('📋 Current recentArtists before update:', $recentArtists.map(a => ({ name: a.name, artistId: a.artistId, urlKey: a.urlKey, imageUrl: a.imageUrl?.substring(0, 30) })));
        
        displayedArtist = name;
        
        // Filter out any existing entry with the same artist
        // Match if ANY identifier matches (more lenient to catch all duplicates)
        const filteredArtists = $recentArtists.filter(a => {
            // Check each identifier separately - match if ANY match (even if one is undefined)
            let matchReason = null;
            
            // Match by artistId if either has it and they're equal
            if (artistId && a.artistId) {
                if (a.artistId === artistId) {
                    matchReason = 'artistId';
                }
            }
            
            // Match by urlKey if either has it and they're equal
            if (!matchReason && urlKey && a.urlKey) {
                if (a.urlKey === urlKey) {
                    matchReason = 'urlKey';
                }
            }
            
            // Match by name as last resort (case-insensitive)
            if (!matchReason && name && a.name) {
                if (a.name.toLowerCase() === name.toLowerCase()) {
                    matchReason = 'name';
                }
            }
            
            if (matchReason) {
                console.log(`🗑️ Removing existing entry for: ${a.name} at position ${$recentArtists.indexOf(a)} (matched by ${matchReason})`);
                return false; // Remove this entry
            }
            
            return true; // Keep this entry
        });
        
        console.log('📋 Filtered artists (removed duplicates):', filteredArtists.map(a => ({ name: a.name, artistId: a.artistId, urlKey: a.urlKey })));
        console.log(`📊 Removed ${$recentArtists.length - filteredArtists.length} duplicate(s)`);
        
        // Create new artist entry and add to front
        const newArtist = { name, imageUrl, seenSongs, artistId, songQueue, urlKey };
        const newList = [newArtist, ...filteredArtists];
        
        console.log('📋 New recentArtists after update:', newList.map((a, i) => ({ 
            position: i, 
            name: a.name, 
            artistId: a.artistId, 
            urlKey: a.urlKey, 
            hasImage: !!a.imageUrl 
        })));
        console.log('✅ Artist at position 0:', newList[0]?.name, '(expected:', name, ')');
        
        // Persist the artist's Firestore URL key so we can requeue quickly later
        recentArtists.set(newList);
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

    /**
     * Preload album art binary data in the background
     * This runs immediately when lyrics are loaded so the image is ready for results
     */
    let currentPreloadRequestId = 0; // Track which preload request is current
    
    async function preloadAlbumArt(targetImageUrl, targetAlbumArtId) {
        // Generate a unique ID for this preload request
        const requestId = ++currentPreloadRequestId;
        
        // Clear previous preload immediately to prevent showing stale data
        preloadedAlbumArt = null;
        
        if (!targetImageUrl || !targetAlbumArtId || targetImageUrl === '/default-image.svg') {
            return;
        }

        try {
            console.log('🖼️ Preloading album art for results screen:', targetAlbumArtId);
            const result = await getAlbumArtBinaryImage(targetImageUrl);
            
            // Only update if this is still the current request (prevents race conditions)
            if (requestId !== currentPreloadRequestId) {
                console.log('🚫 Preload completed but a newer request exists, discarding');
                return;
            }
            
            if (result.success) {
                preloadedAlbumArt = {
                    binaryData: result.binaryData,
                    grayscaleData: result.grayscaleData, // Add grayscale data for new format
                    metadata: result.metadata,
                    cached: result.cached
                };
                console.log('✅ Album art preloaded:', result.cached ? 'from cache' : 'processed');
            } else {
                console.warn('⚠️  Album art preload failed:', result.error);
                preloadedAlbumArt = null;
            }
        } catch (error) {
            // Only update if this is still the current request
            if (requestId !== currentPreloadRequestId) {
                return;
            }
            console.error('❌ Error preloading album art:', error);
            console.warn('⚠️  Album art preload failed, but song will still work with fallback image');
            preloadedAlbumArt = null;
            // Don't throw the error - album art failure shouldn't break song loading
        }
    }

    // Helper function to set display without adding to queue (for navigation)
    function setDisplayFromDataWithoutQueue(data){
        console.log("DISPLAYING DATA (NO QUEUE):" , data)
        if (data && data.lyrics) {
            lyrics = data.lyrics;
            songTitle = data.title;
            artistName = data.artist;
            imageUrl = data.image;
            albumArtId = data.albumArtId; // Add album art ID for binary rendering
            primaryArtist = data.primaryArtist;
            artistImg = data.artistImg;
            artistId = data.artistId;
            songId = data.songId;
            geniusUrl = data.url;
            
            // Preload album art immediately when lyrics are set
            // This happens while user is typing, so image is ready for results
            preloadAlbumArt(data.image, data.albumArtId);
        } else {
            lyrics = "Lyrics not found.";
            preloadedAlbumArt = null; // Clear any previous preload
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
                
                // Queue status will update reactively via $: statement
                
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
                
                // Queue status will update reactively via $: statement
                
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

    // Export function to load a song from trash (replay functionality)
    export async function loadSongFromTrash(songData) {
        try {
            isPaused = false;
            showQueue = false;
            loading = true;
            
            console.log('🔄 Loading song from trash:', songData.title, 'by', songData.artist);
            console.log('📋 Trash data:', { songId: songData.songId, artistUrlKey: songData.artistUrlKey });
            
            // Check if we have the artistUrlKey needed to load from discography
            if (!songData.artistUrlKey) {
                console.warn('⚠️ No artistUrlKey in trash data - this song was saved before the feature was implemented');
                // Fallback: show message asking user to search for artist
                lyrics = `Unable to load "${songData.title}" - please search for "${songData.artist}" to replay this song.`;
                songTitle = songData.title;
                artistName = songData.artist;
                imageUrl = songData.imageUrl;
                albumArtId = songData.albumArtId;
                geniusUrl = songData.geniusUrl;
                songId = songData.songId;
                // Clear currentSong so fullLyrics doesn't show stale data
                currentSong = null;
                loading = false;
                
                // Still need to reset the results display
                const restartEvent = new CustomEvent('restartTest', { detail: { songData } });
                window.dispatchEvent(restartEvent);
                return;
            }
            
            // Load the specific song from the artist's discography
            const result = await loadSpecificSong(songData.songId, songData.artistUrlKey);
            
            if (!result || !result.song) {
                throw new Error('Failed to load song data');
            }
            
            const loadedSong = result.song;
            
            // Check if we got lyrics
            if (!loadedSong.lyrics || loadedSong.lyrics.trim().length === 0) {
                console.warn('⚠️ Song loaded but has no lyrics');
                lyrics = `Lyrics not available for "${songData.title}". The song may need to be re-cached.`;
                songTitle = songData.title;
                artistName = songData.artist;
                imageUrl = songData.imageUrl;
                albumArtId = songData.albumArtId;
                geniusUrl = songData.geniusUrl;
                songId = songData.songId;
                // Clear currentSong so fullLyrics doesn't show stale data
                currentSong = null;
                loading = false;
                
                // Still need to reset the results display
                const restartEvent = new CustomEvent('restartTest', { detail: { songData: loadedSong } });
                window.dispatchEvent(restartEvent);
                return;
            }
            
            // Initialize the queue with this artist, starting at this song
            console.log('🎵 Initializing queue with song at index:', loadedSong.songIndex);
            
            // Reset the queue manager with the artist data
            queueManager.artistUrlKey = songData.artistUrlKey;
            queueManager.artistData = result.artistData;
            queueManager.songIds = result.queueInfo.songIds;
            queueManager.currentIndex = loadedSong.songIndex;
            
            // Clear and rebuild the queue
            queueManager.songs = [];
            queueManager.loadedSongs.clear();
            
            // Initialize songs array with placeholders
            for (let i = 0; i < result.queueInfo.songIds.length; i++) {
                queueManager.songs.push({
                    id: result.queueInfo.songIds[i],
                    title: 'Loading...',
                    artist: result.artistData.name,
                    lyrics: null,
                    isPlaceholder: true
                });
            }
            
            // Add the loaded song to the cache and queue
            queueManager.loadedSongs.set(loadedSong.id, loadedSong);
            queueManager.songs[loadedSong.songIndex] = queueManager.ensureExcerptForSong(loadedSong);
            
            // Broadcast queue update
            queueManager.broadcast();
            
            // Update UI state
            currentSong = loadedSong;
            songTitle = loadedSong.title;
            artistName = loadedSong.artist;
            lyrics = loadedSong.lyrics;
            imageUrl = loadedSong.image || songData.imageUrl;
            albumArtId = loadedSong.albumArtId || songData.albumArtId;
            geniusUrl = loadedSong.url || songData.geniusUrl;
            songId = loadedSong.songId || loadedSong.id;
            displayedArtist = songData.artist;
            
            // Update artist input to show the artist name
            artistInput = songData.artist;
            
            // Move artist to top of recently played list
            setNewRecentArtist({
                name: songData.artist,
                imageUrl: result.artistData?.imageUrl || songData.imageUrl,
                artistId: result.artistData?.geniusId,
                urlKey: songData.artistUrlKey,
                songQueue: {}
            });
            
            console.log('✅ Song loaded from trash successfully:', songTitle);
            
            // Dispatch restart event to reset the LyricDisplay (hide results, show lyrics)
            const restartEvent = new CustomEvent('restartTest', {
                detail: { songData: loadedSong }
            });
            window.dispatchEvent(restartEvent);
            
            // Trigger background preloading of nearby songs
            setTimeout(() => {
                queueManager.preloadAroundCurrentPosition().catch(err => {
                    console.warn('Background preload failed:', err);
                });
            }, 100);
            
            loading = false;

        } catch (error) {
            console.error('❌ Error loading song from trash:', error);
            lyrics = `Error loading "${songData.title}": ${error.message}. Please try searching for the artist.`;
            songTitle = songData.title;
            artistName = songData.artist;
            imageUrl = songData.imageUrl;
            // Clear currentSong so fullLyrics doesn't show stale data
            currentSong = null;
            loading = false;
            
            // Still need to reset the results display
            const restartEvent = new CustomEvent('restartTest', { detail: { songData } });
            window.dispatchEvent(restartEvent);
        }
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
                    
                    // Queue status will update reactively via $: statement
                    
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
        
        // Add event listeners for lyrics scrolling
        const handleScrollUp = () => {
            console.log('TypingTest received lyricsScrollUp event');
            if (lyricsScrollUp && typeof lyricsScrollUp === 'function') {
                lyricsScrollUp();
            }
        };
        
        const handleScrollDown = () => {
            console.log('TypingTest received lyricsScrollDown event');
            if (lyricsScrollDown && typeof lyricsScrollDown === 'function') {
                lyricsScrollDown();
            }
        };
        
        window.addEventListener('lyricsScrollUp', handleScrollUp);
        window.addEventListener('lyricsScrollDown', handleScrollDown);
        
        // Cleanup function
        return () => {
            window.removeEventListener('lyricsScrollUp', handleScrollUp);
            window.removeEventListener('lyricsScrollDown', handleScrollDown);
        };
    });

    $: fullArtistList = [...$recentArtists, ...Array(7 - $recentArtists.length).fill({ name: null, imageUrl: null, artistId: null })];
    
    // Debug logging for fullArtistList updates
    $: if (fullArtistList && fullArtistList.length > 0) {
        console.log('🎨 fullArtistList updated (', fullArtistList.filter(a => a.name).length, 'artists ):');
        fullArtistList.slice(0, 7).forEach((a, i) => {
            if (a.name) {
                console.log(`  ${i}: ${a.name} - artistId: ${a.artistId}, urlKey: ${a.urlKey}, hasImage: ${!!a.imageUrl}`);
            }
        });
    }

</script>

<!-- Updated HTML structure -->
<div class="appContainer typing-test-component">
    <div class="mainSection">
        <div class="headerRow">
            <div class="sidebarTitle">
                <h3 style:font-size="{windowHeight*0.03}px">Recently Played</h3>
            </div>
            <div class="headerContentWrapper">
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
        </div>
        <div class="contentLayout">
            <div class="sidebar">
                <div class="artistList" style:gap="{windowHeight*0.01}px">
                    {#each fullArtistList as artist, index (artist.urlKey || artist.artistId || `empty-${index}`)}
                    <ArtistButton 
                        name={artist.name} 
                        imageUrl={artist.imageUrl} 
                        urlKey={artist.urlKey}
                        {windowHeight}
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
                <div class="lyricsWrapper">
                    <div class="lyricsContainer">
                        {#if showQueue}
                            <QueueDisplay 
                                {windowHeight}
                                isVisible={true}
                                on:songSelected={handleQueueSongSelected}
                                on:close={handleQueueClose}
                                embedded={true}
                                songs={$queueUpcomingSongs}
                                currentIndex={queueStatus.currentIndex}
                                totalSongs={queueStatus.totalSongs}
                            />
                        {:else if lyrics}
                            <LyricDisplay 
                                {lyrics} 
                                {songTitle} 
                                {artistName} 
                                {imageUrl}
                                {albumArtId}
                                {preloadedAlbumArt}
                                continueFromQueue={playNextSong}
                                {replaySong} 
                                {geniusUrl}
                                {songId}
                                artistUrlKey={queueManager.artistUrlKey}
                                {isPaused}
                                capitalization={$capitalization}
                                punctuation={$punctuation}
                                fullLyrics={currentSong?.fullLyrics}
                                bind:onScrollUp={lyricsScrollUp}
                                bind:onScrollDown={lyricsScrollDown}
                                bind:onScrollToLine={lyricsScrollToLine}
                                bind:scrollPosition={lyricsScrollPosition}
                                bind:liveWpm={liveWpm}
                                bind:showResults={showResults}
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
                    <LyricsScrollbar 
                        onScrollUp={lyricsScrollUp}
                        onScrollDown={lyricsScrollDown}
                        onScrollToLine={lyricsScrollToLine}
                        containerHeight={windowHeight}
                        scrollPosition={lyricsScrollPosition}
                        disabled={showResults}
                    />
                </div>
            </div>
        </div>
        <div class="bottomArtistRow">
            <div class="musicControls" style="--bottom-button-gap: {bottomButtonGap}px;" style:gap="{windowHeight*0.007}px">
                <button class="controlButton" on:click={playPreviousSong} disabled={!canGoPrevious} style:width="{buttonSize}px" style:height="{buttonSize}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                    </svg>
                </button>
                <button class="controlButton" on:click={restartSong} style:width="{buttonSize}px" style:height="{buttonSize}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 4h2v12H6zm8-2v16l6-8z"/>
                    </svg>
                </button>
                <button class="controlButton" class:paused={isPaused} on:click={togglePause} style:width="{buttonSize}px" style:height="{buttonSize}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d={controlPath}/>
                    </svg>
                </button>
                <button class="controlButton" on:click={playNextSong} style:width="{buttonSize}px" style:height="{buttonSize}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                </button>
                <button class="controlButton queueButton" class:queue-active={showQueue} on:click={toggleQueue} style:width="{buttonSize}px" style:height="{buttonSize}px">
                    <svg class="controlIcon" viewBox="0 0 24 24" fill="{$themeColors.primary}" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/>
                    </svg>
                    {#if futureSongsCount > 0}
                        <span class="queue-indicator">{futureSongsCount}</span>
                    {/if}
                </button>
            </div>
            <div class="currentArtistContainer">
                <div class="musicIconContainer" style:width="{windowHeight*0.0425}px" style:height="{windowHeight*0.034}px" style:margin-top="-{windowHeight*0.008}px">
                    <svg class="musicIcon"  viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18.6779 0.220394C18.4735 0.0457943 18.2035 -0.0307252 17.9372 0.0112826L6.29208 1.84998C5.84528 1.92052 5.51616 2.30568 5.51616 2.75804V6.43547V12.258H3.67743C1.6497 12.2581 0 13.7703 0 15.629C0 17.4878 1.6497 19 3.67743 19C5.70516 19 7.35485 17.4878 7.35485 15.629V13.1774V7.22104L17.1613 5.67265V10.7258H15.3226C13.2949 10.7258 11.6452 12.238 11.6452 14.0968C11.6452 15.9555 13.2949 17.4678 15.3226 17.4678C17.3503 17.4678 19 15.9555 19 14.0968V11.6451V4.59678V0.919349C19 0.650492 18.8822 0.395068 18.6779 0.220394Z" fill="{$themeColors.primary}"/>
                    </svg>      
                </div>
                <div class="currentArtist" style:font-size="{windowHeight*0.038}px">{primaryArtist}</div>
                {#if songTitle}
                    <div class="songTitle" style:font-size="{windowHeight*0.034}px"> - {songTitle}</div>
                {/if}
            </div>
            <div class="liveWpmContainer">
                <p class="statLabel" style:font-size="{windowHeight*0.03}px">wpm:</p>
                <p class="statValue" style:font-size="{windowHeight*0.045}px">{liveWpm.toFixed(1)}</p>
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
        /* gap: var(--bottom-button-gap); */
        flex-shrink: 0;
    }

     .controlButton {
        font-size: 2em;
        border: var(--border-width) solid var(--primary-color);
        background-color: var(--secondary-color);
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-shrink: 0;
        box-sizing: border-box;
        /* Enforce square aspect ratio - scales with window size without limits */
        aspect-ratio: 1 / 1;
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
        top: -6.5px;
        right: -6.5px;
        background: var(--primary-color);
        color: var(--secondary-color);
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "Geneva", sans-serif;
        font-size: 11px;
        font-weight: bold;
        border: var(--border-width) solid var(--secondary-color);
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

    .headerContentWrapper {
        width: 75.5%;
        display: flex;
        flex-direction: row;
        align-items: center;
        height: 100%;
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

    .liveWpmContainer {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding-right: 2%;
        min-width: 120px;
    }

    .statLabel {
        font-size: 3vh;
        margin: 0;
        color: var(--primary-color);
    }

    .statValue {
        font-size: 5vh;
        margin: 0;
        color: var(--primary-color);
    }

    .musicIconContainer {
        display: flex;
        justify-content: center;
        align-items: center;
        /* padding-left: 1%; */
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
        border: var(--border-width) solid var(--primary-color);
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
        justify-content: flex-start;
    }

    /* Main Content */
    .mainContent {
        width: 80%;
        height: 100%;
    }

    .lyricsWrapper {
        display: flex;
        flex-direction: row;
        height: 100%;
        width: 97%;
        border: var(--border-width) solid var(--primary-color);
        border-radius: .2em;
        overflow: hidden;
        box-sizing: border-box;
    }

    .lyricsContainer {
        background-color: var(--secondary-color);
        height: 100%;
        flex: 1;
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