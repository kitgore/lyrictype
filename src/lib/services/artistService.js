// src/lib/services/artistService.js
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, collection, query, where, limit, getDocs } from 'firebase/firestore';
import app from './initFirebase'; // Adjust the path as necessary to import your Firebase app instance

// Initialize Firestore
const db = getFirestore(app);

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