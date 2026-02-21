// src/lib/services/artistService.js
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import app, { functions, db } from './initFirebase'; // Import the configured instances

// NEW CACHING SYSTEM FUNCTIONS

/**
 * Get basic artist info (useful for getting updated imageUrl after population)
 * @param {string} artistUrlKey - Artist document ID (URL slug)
 * @param {boolean} bypassCache - If true, reads directly from Firestore to avoid caching
 * @returns {Promise<Object>} Basic artist data including imageUrl
 */
export async function getArtistInfo(artistUrlKey, bypassCache = false) {
    try {
        if (bypassCache) {
            // Direct Firestore read to bypass any Firebase Functions caching
            console.log('🔧 Reading artist info directly from Firestore to bypass cache');
            const artistRef = doc(db, 'artists', artistUrlKey);
            const snapshot = await getDoc(artistRef);
            
            if (snapshot.exists()) {
                const data = snapshot.data();
                return {
                    name: data.name,
                    geniusId: data.geniusId,
                    imageUrl: data.imageUrl,
                    urlKey: artistUrlKey,
                    totalSongs: data.songIds?.length || 0,
                    cachedSongs: data.cachedSongIds?.length || 0
                };
            }
            return null;
        } else {
            // Normal Firebase Functions call
            const getArtistInfoCallable = httpsCallable(functions, 'getArtistInfo');
            const result = await getArtistInfoCallable({ artistUrlKey });
            return result.data?.artist || null;
        }
    } catch (error) {
        console.error('Error getting artist info:', error);
        return null;
    }
}

/**
 * Get artist with cached songs, populating cache if needed
 * @param {string} artistUrlKey - Artist document ID (URL slug)
 * @returns {Promise<Object>} Artist data with songIds array
 */
export async function getArtistWithSongs(artistUrlKey) {
    try {
        console.log('🔍 Getting artist with songs for URL key:', artistUrlKey);
        
        // First get artist info to check cache status
        const getArtistInfo = httpsCallable(functions, 'getArtistInfo');
        const artistInfo = await getArtistInfo({ artistUrlKey });
        let artist = artistInfo.data?.artist || {};

        // Prefer the authoritative urlKey from the server if it differs in casing/format
        const authoritativeUrlKey = artist.urlKey || artistUrlKey;
        
        // If the callable doesn't include songIds/urlKey, fetch directly from Firestore as a fallback
        if (!artist.songIds || !Array.isArray(artist.songIds) || artist.songIds.length === 0 || !artist.urlKey) {
            try {
                // Re-fetch using the authoritative urlKey if available to avoid casing mismatches
                const artistRef = doc(db, 'artists', authoritativeUrlKey);
                const snapshot = await getDoc(artistRef);
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    artist = {
                        ...artist,
                        urlKey: artist.urlKey || authoritativeUrlKey,
                        songIds: data.songIds || [],
                        totalSongs: artist.totalSongs ?? (data.songIds ? data.songIds.length : 0),
                        cachedSongs: artist.cachedSongs ?? (data.cachedSongIds ? data.cachedSongIds.length : 0)
                    };
                }
            } catch (fallbackError) {
                console.warn('Fallback Firestore fetch for artist failed:', fallbackError);
            }
        }
        
        // If no songs cached or cache is stale, populate just the first page and continue in background
        if (!artist.totalSongs || artist.totalSongs === 0) {
            console.log(`Populating FIRST PAGE for artist: ${artistUrlKey}`);
            const populateArtistSongs = httpsCallable(functions, 'populateArtistSongs');

            // Fetch just the first 50 quickly so the queue can be built immediately
            const t0 = Date.now();
            await populateArtistSongs({ artistUrlKey: authoritativeUrlKey, onlyFirstPage: true });
            const t1 = Date.now();
            console.log(`⏱️ First 50 cached in ${t1 - t0} ms for ${authoritativeUrlKey}`);

            // Fire-and-forget: continue full pagination in the background without blocking UI
            setTimeout(() => {
                console.log('📡 Continuing background pagination for', authoritativeUrlKey);
                populateArtistSongs({ artistUrlKey: authoritativeUrlKey }).catch(() => {});
            }, 0);

            // Get updated artist info (now has at least the first page of songIds)
            const updatedInfo = await getArtistInfo({ artistUrlKey: authoritativeUrlKey });
            return updatedInfo.data.artist;
        }
        
        return artist;
    } catch (error) {
        console.error("Error getting artist with songs:", error);
        throw error;
    }
}

/**
 * NEW QUEUE SYSTEM - Load artist and create queue
 * This replaces the legacy artist loading flow
 * @param {Object} artist - Artist object with id/name/urlKey
 * @returns {Promise<Object>} Initial song and queue setup info
 */
export async function loadArtistForQueue(artist) {
    try {
        console.log('🎵 Loading artist for new queue system:', artist.name);
        console.log('🔍 Full artist object:', JSON.stringify(artist, null, 2));
        
        // Step 1: Get or populate artist songs
        const artistUrlKey = artist.id || artist.urlKey || artist.name; // Flexible key handling
        console.log('🎵 Artist URL Key being used:', artistUrlKey);
        console.log('🎵 Artist.id:', artist.id);
        console.log('🎵 Artist.urlKey:', artist.urlKey);
        console.log('🎵 Artist.name:', artist.name);
        let artistData = await getArtistWithSongs(artistUrlKey);
        
        console.log(`📋 Artist has ${artistData.totalSongs} total songs, ${artistData.cachedSongs} cached`);

        // Ensure we have songIds even if the callable omitted them for any reason
        const resolvedUrlKey = artistData.urlKey || artistUrlKey;
        if (!artistData.songIds || !Array.isArray(artistData.songIds) || artistData.songIds.length === 0) {
            try {
                const artistRef = doc(db, 'artists', resolvedUrlKey);
                const snapshot = await getDoc(artistRef);
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    artistData = {
                        ...artistData,
                        songIds: data.songIds || [],
                        totalSongs: artistData.totalSongs ?? (data.songIds ? data.songIds.length : 0),
                        cachedSongs: artistData.cachedSongs ?? (data.cachedSongIds ? data.cachedSongIds.length : 0)
                    };
                }
            } catch (e) {
                console.warn('Direct Firestore fetch for songIds failed:', e);
            }
        }
        
        // Step 2: Get first song to start immediately
        if (artistData.totalSongs === 0) {
            throw new Error('No songs found for this artist');
        }
        
        // Use loadStartingFromId to get the first song (position 0)
        const songIds = Array.isArray(artistData.songIds) ? artistData.songIds : [];
        if (songIds.length === 0) {
            throw new Error('No song IDs available for artist');
        }
        
        // Find the first song with lyrics if possible, otherwise use first song
        const cachedSongIds = artistData.cachedSongIds || [];
        let firstSongId = songIds[0];
        let firstSongIndex = 0;
        
        // Try to find first cached song for better UX
        if (cachedSongIds.length > 0) {
            for (let i = 0; i < Math.min(songIds.length, 5); i++) { // Check first 5 songs
                if (cachedSongIds.includes(songIds[i])) {
                    firstSongId = songIds[i];
                    firstSongIndex = i;
                    console.log(`🎯 Using cached song at position ${i} as first song`);
                    break;
                }
            }
        }
        
        // Request the first song (preferably cached) so lyrics can show immediately
        const initialLoadResult = await loadSongsFromPosition(firstSongId, false, resolvedUrlKey, 1);
        
        // Extract first song from loaded songs
        const firstSong = initialLoadResult.loadedSongs[firstSongId];
        if (!firstSong) {
            throw new Error('Failed to load first song');
        }
        
        // Transform to expected format for UI compatibility
        const transformedSong = {
            id: firstSong.id,
            title: firstSong.title,
            artist: firstSong.primaryArtist?.name || artistData.name,
            lyrics: firstSong.lyrics || '',
            image: firstSong.songArtImageUrl,
            albumArtId: firstSong.albumArtId, // Add album art ID for binary rendering
            url: firstSong.url,
            artistId: artistData.geniusId,
            songId: firstSong.id,
            primaryArtist: firstSong.primaryArtist?.name || artistData.name,
            artistImg: artist.imageUrl || '',
            songIndex: firstSongIndex // Position in queue
        };

        // Also transform any additional songs that were loaded by the backend call
        // so the queue can immediately use them without waiting for background preload.
        const preloadedSongs = {};
        if (initialLoadResult && initialLoadResult.loadedSongs) {
            Object.entries(initialLoadResult.loadedSongs).forEach(([id, songData]) => {
                preloadedSongs[id] = {
                    id: songData.id,
                    title: songData.title,
                    artist: songData.primaryArtist?.name || songData.artistNames || artistData.name,
                    lyrics: songData.lyrics || '',
                    image: songData.songArtImageUrl,
                    albumArtId: songData.albumArtId, // Add album art ID for binary rendering
                    url: songData.url,
                    songId: songData.id,
                    primaryArtist: songData.primaryArtist?.name || artistData.name
                };
            });
        }

        // Background: kick off loading of the rest of the initial window (e.g., next 9)
        // This will help populate the queue faster for new artists
        setTimeout(() => {
            console.log('🔄 Background loading initial song window for new artist...');
            loadSongsFromPosition(firstSongId, false, resolvedUrlKey, 10)
                .then(backgroundResult => {
                    if (backgroundResult.loadedSongs) {
                        console.log(`✅ Background loaded ${Object.keys(backgroundResult.loadedSongs).length} additional songs`);
                    }
                })
                .catch(error => {
                    console.warn('Background loading failed:', error);
                });
        }, 0);
        
        return {
            song: transformedSong,
            artistData: artistData,
            preloadedSongs: preloadedSongs,
            queueInfo: {
                totalSongs: artistData.totalSongs,
                cachedSongs: artistData.cachedSongs,
                songIds: songIds,
                artistUrlKey: artistUrlKey
            }
        };
        
    } catch (error) {
        console.error('Error loading artist for queue:', error);
        throw error;
    }
}

/**
 * Load songs for queue navigation (next/previous)
 * @param {string} songId - Current song ID
 * @param {boolean} goingBackward - True for previous, false for next
 * @param {string} artistUrlKey - Artist document ID
 * @returns {Promise<Object>} Loaded songs and navigation info
 */
export async function loadSongsForNavigation(songId, goingBackward, artistUrlKey) {
    try {
        console.log(`🎵 Loading songs for navigation: ${goingBackward ? 'previous' : 'next'} from ${songId}`);
        
        const result = await loadSongsFromPosition(songId, goingBackward, artistUrlKey);
        
        // Transform loaded songs to UI format
        const transformedSongs = {};
        Object.entries(result.loadedSongs).forEach(([id, songData]) => {
            transformedSongs[id] = {
                id: songData.id,
                title: songData.title,
                artist: songData.primaryArtist?.name || songData.artistNames,
                lyrics: songData.lyrics || '',
                image: songData.songArtImageUrl,
                albumArtId: songData.albumArtId, // Add album art ID for binary rendering
                url: songData.url,
                songId: songData.id,
                primaryArtist: songData.primaryArtist?.name,
                songIndex: result.queuePosition // This will be updated by queue manager
            };
        });
        
        return {
            songs: transformedSongs,
            scrapingResults: result.scrapingResults,
            queuePosition: result.queuePosition,
            songsLoaded: result.songsLoaded,
            songsScraped: result.songsScraped
        };
        
    } catch (error) {
        console.error('Error loading songs for navigation:', error);
        throw error;
    }
}

/**
 * Load songs starting from a specific position with smart caching
 * @param {string} songId - Song ID to start from
 * @param {boolean} shouldReverse - Load previous songs instead of next
 * @param {string} artistUrlKey - Artist document ID
 * @returns {Promise<Object>} Loaded songs and queue info
 */
export async function loadSongsFromPosition(songId, shouldReverse = false, artistUrlKey, rangeSize = 10) {
    const loadStartingFromId = httpsCallable(functions, 'loadStartingFromId');
    
    try {
        const result = await loadStartingFromId({ songId, shouldReverse, artistUrlKey, rangeSize });
        return result.data;
    } catch (error) {
        console.error("Error loading songs from position:", error);
        throw error;
    }
}

// LEGACY FUNCTION - Consider migrating to getArtistWithSongs
export async function getArtistLyrics(artistName) {
    const callGetArtistLyrics = httpsCallable(functions, 'initialArtistSearch');
  
    try {
      console.log("Artist Name: ", artistName)
      const result = await callGetArtistLyrics({ artistName });
      return result.data; // The response from your Firebase Function is accessed via result.data
    } catch (error) {
      console.error("Error calling getArtistLyrics Firebase Function:", error);
      throw error; // Rethrow or handle the error as you see fit
    }
  }


export async function searchByArtistId(artistId, seenSongs) {
  const callSearch = httpsCallable(functions, 'searchByArtistId');

  try {
    const result = await callSearch({ artistId, seenSongs });
    console.log(result.data);
    return result.data; // The response from your Firebase Function is accessed via result.data
  } catch (error) {
    console.error("Error calling searchByArtistId Firebase Function:", error);
    throw error; // Rethrow or handle the error as you see fit
  }
}

/**
 * Efficiently fetch multiple songs for an artist sequentially
 * @param {number} artistId - The artist's Genius ID
 * @param {Array} seenSongs - Array of already seen song indices
 * @param {number} count - Number of songs to fetch (default: 5)
 * @returns {Promise<Array>} Array of song objects
 */
export async function fetchMultipleSongs(artistId, seenSongs = [], count = 5) {
  const callSearch = httpsCallable(functions, 'searchByArtistId');
  
  try {
    const fetchedSongs = [];
    let currentSeenSongs = [...seenSongs];
    
    for (let i = 0; i < count; i++) {
      try {
        const result = await callSearch({ 
          artistId, 
          seenSongs: currentSeenSongs 
        });
        
        if (result.data && result.data.songIndex) {
          fetchedSongs.push(result.data);
          // Add this song index to seen songs for next request
          currentSeenSongs.push(result.data.songIndex);
        } else {
          // If we get no valid song, we might have exhausted the artist's songs
          console.log(`No more songs available for artist ${artistId} after ${i} songs`);
          break;
        }
      } catch (error) {
        console.warn(`Error fetching song ${i + 1} for artist ${artistId}:`, error);
        // Continue trying to fetch remaining songs even if one fails
      }
      
      // Small delay to be respectful to the server
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Successfully fetched ${fetchedSongs.length}/${count} songs for artist ${artistId}`);
    return fetchedSongs;
    
  } catch (error) {
    console.error("Error in fetchMultipleSongs:", error);
    return [];
  }
}

/**
 * Search for artists using Firestore search tokens
 * @param {string} searchTerm - The search term entered by the user
 * @param {number} maxResults - Maximum number of results to return (default: 10)
 * @returns {Promise<Array>} Array of artist objects matching the search
 */
export async function searchArtists(searchTerm, maxResults = 10) {
  if (!searchTerm || searchTerm.trim().length < 1) {
    return [];
  }

  try {
    // Normalize the search term to match how search tokens were created
    const normalizedSearch = searchTerm.toLowerCase().trim();
    
    const artistsRef = collection(db, 'artists');
    // Fetch more results than needed to ensure we don't miss popular artists
    // due to Firestore's query ordering before our custom sorting
    const fetchLimit = Math.max(maxResults * 3, 30); // Fetch at least 30 results
    const q = query(
      artistsRef,
      where('searchTokens', 'array-contains', normalizedSearch),
      limit(fetchLimit)
    );
    
    const snapshot = await getDocs(q);
    const results = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Sort by relevance with popular artists prioritized
    const sortedResults = results.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      
      // First priority: artist type (popular before regular)
      const aIsPopular = a.type === 'popular';
      const bIsPopular = b.type === 'popular';
      
      if (aIsPopular && !bIsPopular) {
        return -1;
      }
      if (bIsPopular && !aIsPopular) {
        return 1;
      }
      
      // Second priority: exact matches
      if (aName === normalizedSearch && bName !== normalizedSearch) {
        return -1;
      }
      if (bName === normalizedSearch && aName !== normalizedSearch) {
        return 1;
      }
      
      // Third priority: names that start with the search term
      const aStarts = aName.startsWith(normalizedSearch);
      const bStarts = bName.startsWith(normalizedSearch);
      if (aStarts && !bStarts) {
        return -1;
      }
      if (bStarts && !aStarts) {
        return 1;
      }
      
      // Fourth priority: by length (shorter names first)
      if (aName.length !== bName.length) {
        return aName.length - bName.length;
      }
      
      // Finally alphabetically
      return aName.localeCompare(bName);
    });

    // Limit results after sorting to ensure popular artists are prioritized
    const finalResults = sortedResults.slice(0, maxResults);

    console.log(`🔍 Search for "${searchTerm}" returned ${finalResults.length} results, popular artists first`);
    
    return finalResults;
    
  } catch (error) {
    console.error('Error searching artists:', error);
    return [];
  }
}