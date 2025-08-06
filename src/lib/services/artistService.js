// src/lib/services/artistService.js
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, collection, query, where, limit, getDocs } from 'firebase/firestore';
import app from './initFirebase'; // Adjust the path as necessary to import your Firebase app instance

// Initialize Firestore
const db = getFirestore(app);

// NEW CACHING SYSTEM FUNCTIONS

/**
 * Get artist with cached songs, populating cache if needed
 * @param {string} artistUrlKey - Artist document ID (URL slug)
 * @returns {Promise<Object>} Artist data with songIds array
 */
export async function getArtistWithSongs(artistUrlKey) {
    const functions = getFunctions(app);
    
    try {
        // First get artist info to check cache status
        const getArtistInfo = httpsCallable(functions, 'getArtistInfo');
        const artistInfo = await getArtistInfo({ artistUrlKey });
        
        // If no songs cached or cache is stale, populate
        if (!artistInfo.data.artist.totalSongs || artistInfo.data.artist.totalSongs === 0) {
            console.log(`Populating songs for artist: ${artistUrlKey}`);
            const populateArtistSongs = httpsCallable(functions, 'populateArtistSongs');
            await populateArtistSongs({ artistUrlKey });
            
            // Get updated artist info
            const updatedInfo = await getArtistInfo({ artistUrlKey });
            return updatedInfo.data.artist;
        }
        
        return artistInfo.data.artist;
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
    const functions = getFunctions(app);
    
    try {
        console.log('🎵 Loading artist for new queue system:', artist.name);
        
        // Step 1: Get or populate artist songs
        const artistUrlKey = artist.id || artist.urlKey || artist.name; // Flexible key handling
        const artistData = await getArtistWithSongs(artistUrlKey);
        
        console.log(`📋 Artist has ${artistData.totalSongs} total songs, ${artistData.cachedSongs} cached`);
        
        // Step 2: Get first song to start immediately
        if (artistData.totalSongs === 0) {
            throw new Error('No songs found for this artist');
        }
        
        // Use loadStartingFromId to get the first song (position 0)
        const songIds = artistData.songIds || [];
        if (songIds.length === 0) {
            throw new Error('No song IDs available for artist');
        }
        
        const firstSongId = songIds[0];
        const loadResult = await loadSongsFromPosition(firstSongId, false, artistUrlKey);
        
        // Extract first song from loaded songs
        const firstSong = loadResult.loadedSongs[firstSongId];
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
            url: firstSong.url,
            artistId: artistData.geniusId,
            songId: firstSong.id,
            primaryArtist: firstSong.primaryArtist?.name || artistData.name,
            artistImg: artist.imageUrl || '',
            songIndex: 0 // Position in queue
        };
        
        return {
            song: transformedSong,
            artistData: artistData,
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
export async function loadSongsFromPosition(songId, shouldReverse = false, artistUrlKey) {
    const functions = getFunctions(app);
    const loadStartingFromId = httpsCallable(functions, 'loadStartingFromId');
    
    try {
        const result = await loadStartingFromId({ songId, shouldReverse, artistUrlKey });
        return result.data;
    } catch (error) {
        console.error("Error loading songs from position:", error);
        throw error;
    }
}

// LEGACY FUNCTION - Consider migrating to getArtistWithSongs
export async function getArtistLyrics(artistName) {
    const functions = getFunctions(app);
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
  const functions = getFunctions(app);
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
  const functions = getFunctions(app);
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