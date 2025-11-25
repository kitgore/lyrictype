/**
 * Bulk Null Lyrics Fixer
 * 
 * This script scans the songs collection for songs with null or invalid lyrics
 * and attempts to rescrape them from Genius. It can operate on all songs or
 * filter by specific artists.
 * 
 * Usage:
 *   node fix-null-lyrics.js                          # Scan and fix all songs
 *   node fix-null-lyrics.js --artist baby-jey        # Fix only Baby Jey's songs
 *   node fix-null-lyrics.js --dry-run                # Scan only, don't fix
 *   node fix-null-lyrics.js --check-cached-only      # Only check songs in cachedSongIds
 *   node fix-null-lyrics.js --batch-size 10          # Process 10 songs at a time
 *   node fix-null-lyrics.js --max-songs 50           # Only process first 50 null songs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, arrayRemove, arrayUnion, increment, collection, getDocs, query, where, limit, startAfter } from 'firebase/firestore';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as cheerio from 'cheerio';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

// Note: fetch is built-in for Node.js 18+, no need to import

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration from command line arguments
const args = process.argv.slice(2);

// Helper to get artist argument safely
function getArtistArg() {
    const artistEqualFormat = args.find(arg => arg.startsWith('--artist='));
    if (artistEqualFormat) {
        return artistEqualFormat.split('=')[1];
    }
    
    const artistIndex = args.indexOf('--artist');
    if (artistIndex !== -1 && artistIndex + 1 < args.length) {
        const nextArg = args[artistIndex + 1];
        // Make sure the next arg is not another flag
        if (!nextArg.startsWith('--')) {
            return nextArg;
        }
    }
    
    return null;
}

// Helper to get numeric argument (supports both --flag=value and --flag value formats)
function getNumericArg(flagName, defaultValue) {
    // Try --flag=value format first
    const equalFormat = args.find(arg => arg.startsWith(`--${flagName}=`));
    if (equalFormat) {
        const value = parseInt(equalFormat.split('=')[1]);
        return isNaN(value) ? defaultValue : value;
    }
    
    // Try --flag value format
    const flagIndex = args.indexOf(`--${flagName}`);
    if (flagIndex !== -1 && flagIndex + 1 < args.length) {
        const nextArg = args[flagIndex + 1];
        // Make sure the next arg is not another flag
        if (!nextArg.startsWith('--')) {
            const value = parseInt(nextArg);
            return isNaN(value) ? defaultValue : value;
        }
    }
    
    return defaultValue;
}

const config = {
    dryRun: args.includes('--dry-run'),
    artistUrlKey: getArtistArg(),
    checkCachedOnly: args.includes('--check-cached-only'),
    batchSize: getNumericArg('batch-size', 5),
    maxSongs: getNumericArg('max-songs', Infinity),
    verbose: args.includes('--verbose') || args.includes('-v'),
};

// State tracking
const state = {
    scanned: 0,
    nullLyrics: 0,
    fixed: 0,
    failed: 0,
    skipped: 0,
    permanentlyFailed: 0,
    artistsAffected: new Set(),
    errors: [],
    startTime: Date.now()
};

// Initialize Firebase
let db;

async function initializeFirebase() {
    try {
        console.log('🔧 Initializing Firebase...');
        
        // Initialize Firebase using centralized config (same as other working scripts)
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        
        console.log('✅ Firebase initialized successfully\n');
    } catch (error) {
        console.error('❌ Failed to initialize Firebase:', error.message);
        process.exit(1);
    }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeout);
        return response;
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

/**
 * Scrape lyrics from Genius URL
 * (Updated to match production scraping logic from functions/index.js)
 */
async function scrapeLyricsFromUrl(songUrl) {
    try {
        if (!songUrl || typeof songUrl !== 'string') {
            throw new Error(`Invalid song URL: ${songUrl}`);
        }
        
        if (!songUrl.includes('genius.com')) {
            throw new Error(`URL does not appear to be a Genius URL: ${songUrl}`);
        }
        
        const songPageResponse = await fetchWithTimeout(songUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });
        
        if (!songPageResponse.ok) {
            throw new Error(`HTTP ${songPageResponse.status}: ${songPageResponse.statusText}`);
        }
        
        const songPageHtml = await songPageResponse.text();
        
        if (!songPageHtml || songPageHtml.length < 100) {
            throw new Error('Received empty or invalid HTML response');
        }

        const $ = cheerio.load(songPageHtml);
        const lyricsContainers = $('div[data-lyrics-container="true"]');
        
        if (lyricsContainers.length === 0) {
            throw new Error('No lyrics containers found');
        }

        let allLyricsText = '';
        
        // Process each lyrics container with proper filtering
        lyricsContainers.each((index, container) => {
            const $container = $(container);
            
            // Remove elements that should be excluded from lyrics
            $container.find('[data-exclude-from-selection="true"]').remove();
            
            // Remove headers, footers, and annotation elements
            $container.find('.LyricsHeader__Container, .LyricsFooter__Container').remove();
            $container.find('a[href*="/annotations/"]').remove();
            
            // Get the raw text content, preserving line breaks
            let containerText = $container.html() || '';
            
            // Convert HTML to clean text
            containerText = containerText
                // Convert <br> tags to newlines
                .replace(/<br\s*\/?>/gi, '\n')
                // Remove all HTML tags completely
                .replace(/<[^>]*>/gi, '')
                // Decode HTML entities
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&nbsp;/g, ' ')
                // Clean up whitespace
                .split('\n')
                .map(line => line.trim())
                .filter(line => {
                    // Filter out section headers and empty lines
                    if (!line) return false;
                    if (line.match(/^\[.*\]$/)) return false; // Remove [Intro], [Verse], etc.
                    if (line.match(/^(Intro|Verse|Chorus|Bridge|Outro|Pre-Chorus|Post-Chorus|Hook|Refrain)(\s|\d|$)/i)) return false;
                    return true;
                })
                .join('\n');
            
            if (containerText.trim()) {
                if (allLyricsText) allLyricsText += '\n\n';
                allLyricsText += containerText.trim();
            }
        });

        // Final cleanup
        let lyrics = allLyricsText
            // Remove multiple consecutive newlines
            .replace(/\n{3,}/g, '\n\n')
            // Remove any remaining section markers that might have slipped through
            .replace(/^\[.*\]$/gm, '')
            // Clean up any remaining whitespace issues
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
            .trim();

        if (!lyrics || lyrics.length < 10) {
            throw new Error('Extracted lyrics are too short or empty');
        }

        return lyrics;
        
    } catch (error) {
        throw new Error(`Failed to scrape lyrics: ${error.message}`);
    }
}

/**
 * Check if lyrics are valid
 */
function hasValidLyrics(lyrics) {
    return lyrics && 
           typeof lyrics === 'string' &&
           lyrics.trim().length > 0 && 
           lyrics !== 'null' &&
           lyrics !== 'undefined' &&
           lyrics.toLowerCase() !== 'no lyrics found';
}

/**
 * Find artist by URL key or search by name
 */
async function findArtistByNameOrKey(searchTerm) {
    // First try direct lookup by URL key
    try {
        const artistRef = doc(db, 'artists', searchTerm);
        const artistSnap = await getDoc(artistRef);
        
        if (artistSnap.exists()) {
            return { id: searchTerm, ...artistSnap.data() };
        }
    } catch (error) {
        console.log(`   Direct lookup failed, searching by name...`);
    }
    
    // If not found, try searching by name using searchTokens
    try {
        const artistsCollection = collection(db, 'artists');
        const searchQuery = query(
            artistsCollection,
            where('searchTokens', 'array-contains', searchTerm.toLowerCase())
        );
        
        const querySnapshot = await getDocs(searchQuery);
        
        if (!querySnapshot.empty) {
            const firstMatch = querySnapshot.docs[0];
            console.log(`   Found artist: ${firstMatch.data().name} (${firstMatch.id})`);
            return { id: firstMatch.id, ...firstMatch.data() };
        }
        
        // Try partial name match as fallback
        const allArtistsQuery = query(artistsCollection);
        const allArtistsSnapshot = await getDocs(allArtistsQuery);
        
        const searchLower = searchTerm.toLowerCase().replace(/-/g, ' ');
        
        for (const artistDoc of allArtistsSnapshot.docs) {
            const artistData = artistDoc.data();
            const artistNameLower = artistData.name.toLowerCase();
            
            if (artistNameLower.includes(searchLower) || searchLower.includes(artistNameLower)) {
                console.log(`   Found artist by partial match: ${artistData.name} (${artistDoc.id})`);
                return { id: artistDoc.id, ...artistData };
            }
        }
    } catch (error) {
        console.error(`   Error searching for artist: ${error.message}`);
    }
    
    return null;
}

/**
 * Get all songs with null lyrics
 * Returns { nullSongs, artistUrlKey } where artistUrlKey is the resolved artist ID if one was provided
 */
async function findSongsWithNullLyrics(artistUrlKey = null, cachedOnly = false) {
    console.log('🔍 Scanning for songs with null/invalid lyrics...');
    
    const nullSongs = [];
    let resolvedArtistUrlKey = null;
    
    // If filtering by specific artist, get that artist's songs first
    let targetSongIds = null;
    let cachedSongsMap = null; // Will store song-to-artist mapping for cached-only mode
    
    if (artistUrlKey) {
        console.log(`🎤 Searching for artist: ${artistUrlKey}...`);
        const artistData = await findArtistByNameOrKey(artistUrlKey);
        
        if (!artistData) {
            console.error(`\n❌ Artist not found: ${artistUrlKey}`);
            console.error(`\n💡 Tips:`);
            console.error(`   - Try the artist's name: "Grace Petrie" or "Kendrick Lamar"`);
            console.error(`   - Try lowercase: "grace petrie" or "kendrick lamar"`);
            console.error(`   - Try the URL slug: "grace-petrie" or "kendrick-lamar"`);
            console.error(`   - Check Firebase Console to see exact artist document IDs\n`);
            return { nullSongs, artistUrlKey: null };
        }
        
        resolvedArtistUrlKey = artistData.id; // Store the resolved artist ID
        artistUrlKey = artistData.id; // Use the actual document ID
        console.log(`   ✅ Found artist: ${artistData.name}`);
        console.log(`   Document ID: ${artistUrlKey}\n`);
        
        if (cachedOnly) {
            // Only check cached songs for this artist
            targetSongIds = (artistData.cachedSongIds || []).map(id => id.toString());
            console.log(`   📚 Found ${targetSongIds.length} cached songs for this artist\n`);
        } else {
            // Check all songs for this artist
            targetSongIds = (artistData.songIds || []).map(id => id.toString());
            console.log(`   📚 Found ${targetSongIds.length} total songs for this artist\n`);
        }
        
        if (targetSongIds.length === 0) {
            console.log('⚠️  No songs found for this artist');
            return { nullSongs, artistUrlKey: resolvedArtistUrlKey };
        }
    } else if (cachedOnly) {
        // Get all cached songs from all artists
        console.log('📋 Building cached songs index from artists...');
        const artistsCollection = collection(db, 'artists');
        const artistsSnapshot = await getDocs(artistsCollection);
        
        const maxToCollect = config.maxSongs || Infinity;
        cachedSongsMap = new Map(); // Map songId -> artistUrlKey
        
        for (const artistDoc of artistsSnapshot.docs) {
            const artistData = artistDoc.data();
            const cachedIds = artistData.cachedSongIds || [];
            const artistUrlKey = artistDoc.id;
            
            for (const id of cachedIds) {
                if (cachedSongsMap.size >= maxToCollect) {
                    break; // Stop collecting once we hit the limit
                }
                const idStr = id.toString();
                // Store the first artist we find for each song (in case of duplicates)
                if (!cachedSongsMap.has(idStr)) {
                    cachedSongsMap.set(idStr, artistUrlKey);
                }
            }
            
            if (cachedSongsMap.size >= maxToCollect) {
                break; // Stop iterating through artists once we hit the limit
            }
        }
        
        targetSongIds = Array.from(cachedSongsMap.keys());
        console.log(`   Found ${targetSongIds.length} cached songs to check\n`);
    }
    
    // Group songs by artist for better reporting
    const songsByArtist = new Map();
    let totalScanned = 0;
    
    // Store the song-to-artist mapping for later use when fixing songs
    const songToArtistMap = cachedSongsMap; // Will be populated if cachedOnly mode without specific artist
    
    // If we have a specific list of songs to check (artist filter or cached-only)
    if (targetSongIds && targetSongIds.length > 0) {
        const totalToCheck = Math.min(targetSongIds.length, config.maxSongs || Infinity);
        const songsToCheck = targetSongIds.slice(0, config.maxSongs || targetSongIds.length);
        
        console.log(`📊 Checking ${songsToCheck.length} song(s) for null lyrics...\n`);
        
        // Process songs one at a time to avoid timeout issues
        for (const songId of songsToCheck) {
            totalScanned++;
            
            if (totalScanned % 50 === 0) {
                process.stdout.write(`\r   Scanned: ${totalScanned}/${songsToCheck.length} songs...`);
            }
            
            try {
                const songRef = doc(db, 'songs', songId);
                const songSnap = await getDoc(songRef);
                
                if (!songSnap.exists()) {
                    continue;
                }
                
                const songData = songSnap.data();
                
                // Check if lyrics are invalid
                if (!hasValidLyrics(songData.lyrics)) {
                    // Skip permanently failed songs
                    if (songData.scrapingStatus === 'permanently_failed') {
                        state.permanentlyFailed++;
                        continue;
                    }
                    
                    state.nullLyrics++;
                    
                    const primaryArtistName = songData.primaryArtist?.name || songData.artistNames || 'Unknown';
                    
                    if (!songsByArtist.has(primaryArtistName)) {
                        songsByArtist.set(primaryArtistName, []);
                    }
                    
                    songsByArtist.get(primaryArtistName).push({
                        id: songId,
                        title: songData.title || 'Unknown Title',
                        url: songData.url,
                        attempts: songData.scrapingAttempts || 0,
                        status: songData.scrapingStatus || 'pending',
                        error: songData.scrapingError || null,
                        inCache: artistUrlKey ? null : true // null when filtering by artist
                    });
                    
                    nullSongs.push({
                        id: songId,
                        title: songData.title || 'Unknown Title',
                        artist: primaryArtistName,
                        url: songData.url,
                        attempts: songData.scrapingAttempts || 0,
                        status: songData.scrapingStatus || 'pending',
                        inCache: artistUrlKey ? null : true,
                        cachedByArtist: songToArtistMap ? songToArtistMap.get(songId) : null // Track which artist has this in their cache
                    });
                    
                    state.artistsAffected.add(primaryArtistName);
                }
            } catch (error) {
                console.warn(`\n   ⚠️  Error checking song ${songId}: ${error.message}`);
            }
            
            // Small delay to avoid rate limits
            if (totalScanned % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        console.log(`\n   Scanned: ${totalScanned} songs\n`);
        state.scanned = totalScanned;
    } else {
        // Scanning all songs without filter (not recommended for large databases)
        console.log('⚠️  WARNING: Scanning ALL songs in database');
        console.log('⚠️  This will be VERY slow and may timeout!');
        console.log('💡 Consider using --check-cached-only or --artist flags\n');
        
        if (!config.maxSongs) {
            console.log('⚠️  No --max-songs limit set. This could take hours!');
            console.log('   Press Ctrl+C to cancel if this is not what you want.\n');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Give user time to cancel
        }
        
        // Get songs in smaller batches using limit and startAfter
        const songsCollection = collection(db, 'songs');
        let lastDoc = null;
        const fetchBatchSize = 100; // Smaller batches for full scans
        let hasMore = true;
        const maxToScan = config.maxSongs || 10000; // Default cap at 10k songs
        
        console.log(`   Will scan up to ${maxToScan.toLocaleString()} songs\n`);
        
        while (hasMore && totalScanned < maxToScan) {
            let songsQuery;
            if (lastDoc) {
                songsQuery = query(songsCollection, startAfter(lastDoc), limit(Math.min(fetchBatchSize, maxToScan - totalScanned)));
            } else {
                songsQuery = query(songsCollection, limit(Math.min(fetchBatchSize, maxToScan)));
            }
            
            const songsSnapshot = await getDocs(songsQuery);
            
            if (songsSnapshot.empty) {
                hasMore = false;
                break;
            }
            
            lastDoc = songsSnapshot.docs[songsSnapshot.docs.length - 1];
            
            for (const songDoc of songsSnapshot.docs) {
                totalScanned++;
                
                if (totalScanned % 100 === 0) {
                    process.stdout.write(`\r   Scanned: ${totalScanned.toLocaleString()} / ${maxToScan.toLocaleString()} songs...`);
                }
                
                const songData = songDoc.data();
                const songId = songDoc.id;
                
                // Check if lyrics are invalid
                if (!hasValidLyrics(songData.lyrics)) {
                    // Skip permanently failed songs
                    if (songData.scrapingStatus === 'permanently_failed') {
                        state.permanentlyFailed++;
                        continue;
                    }
                    
                    state.nullLyrics++;
                    
                    const primaryArtistName = songData.primaryArtist?.name || songData.artistNames || 'Unknown';
                    
                    if (!songsByArtist.has(primaryArtistName)) {
                        songsByArtist.set(primaryArtistName, []);
                    }
                    
                    songsByArtist.get(primaryArtistName).push({
                        id: songId,
                        title: songData.title || 'Unknown Title',
                        url: songData.url,
                        attempts: songData.scrapingAttempts || 0,
                        status: songData.scrapingStatus || 'pending',
                        error: songData.scrapingError || null,
                        inCache: false
                    });
                    
                    nullSongs.push({
                        id: songId,
                        title: songData.title || 'Unknown Title',
                        artist: primaryArtistName,
                        url: songData.url,
                        attempts: songData.scrapingAttempts || 0,
                        status: songData.scrapingStatus || 'pending',
                        inCache: false,
                        cachedByArtist: null // Not applicable for full database scans
                    });
                    
                    state.artistsAffected.add(primaryArtistName);
                }
                
                // Check if we've hit the max songs limit
                if (totalScanned >= maxToScan) {
                    hasMore = false;
                    break;
                }
            }
            
            // Check if we got fewer docs than the batch size (last page)
            if (songsSnapshot.docs.length < fetchBatchSize) {
                hasMore = false;
            }
            
            // Small delay between fetches
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`\n   Scanned: ${totalScanned.toLocaleString()} songs\n`);
        state.scanned = totalScanned;
    }
    
    // Print summary by artist
    if (songsByArtist.size > 0) {
        console.log('📊 Songs with null lyrics by artist:\n');
        const sortedArtists = Array.from(songsByArtist.entries())
            .sort((a, b) => b[1].length - a[1].length);
        
        for (const [artist, songs] of sortedArtists) {
            console.log(`   ${artist}: ${songs.length} song(s)`);
            if (config.verbose) {
                songs.forEach(song => {
                    const cacheStatus = song.inCache ? '📦 cached' : '📭 uncached';
                    console.log(`      - ${song.title} (${cacheStatus}, ${song.attempts} attempts)`);
                });
            }
        }
        console.log();
    }
    
    return { nullSongs, artistUrlKey: resolvedArtistUrlKey };
}

/**
 * Find the artist URL key for a song
 */
async function findArtistForSong(songId) {
    const artistsCollection = collection(db, 'artists');
    const artistsQuery = query(artistsCollection, where('songIds', 'array-contains', parseInt(songId)));
    const artistsSnapshot = await getDocs(artistsQuery);
    
    if (artistsSnapshot.empty) {
        return null;
    }
    
    return artistsSnapshot.docs[0].id;
}

/**
 * Remove song from artist's cachedSongIds array
 */
async function removeSongFromCachedList(artistUrlKey, songId) {
    try {
        const artistRef = doc(db, 'artists', artistUrlKey);
        const songIdInt = parseInt(songId); // Convert to integer for array operations
        await updateDoc(artistRef, {
            cachedSongIds: arrayRemove(songIdInt),
            lyricsScraped: increment(-1)
        });
    } catch (error) {
        console.error(`      ⚠️  Could not remove from cached list: ${error.message}`);
    }
}

/**
 * Scrape lyrics for a single song
 */
async function scrapeSingleSong(songId, artistUrlKey) {
    try {
        // Get song document
        const songRef = doc(db, 'songs', songId);
        const songSnap = await getDoc(songRef);
        
        if (!songSnap.exists()) {
            return { success: false, error: 'Song not found' };
        }
        
        const songData = songSnap.data();
        const currentAttempts = (songData.scrapingAttempts || 0);
        
        // Check retry limit
        if (currentAttempts >= 3) {
            console.log(`      ⚠️  Max retries exceeded, marking as permanently failed`);
            
            await updateDoc(songRef, {
                scrapingStatus: 'permanently_failed',
                scrapingError: 'Max retry attempts exceeded'
            });
            
            await removeSongFromCachedList(artistUrlKey, songId);
            
            return { success: false, error: 'Max retries exceeded', permanentlyFailed: true };
        }
        
        // Update status to scraping
        await updateDoc(songRef, {
            scrapingStatus: 'scraping',
            scrapingAttempts: currentAttempts + 1
        });
        
        // Attempt to scrape lyrics
        try {
            const lyrics = await scrapeLyricsFromUrl(songData.url);
            
            if (lyrics && lyrics.trim().length > 0) {
                // Successfully scraped lyrics
                await updateDoc(songRef, {
                    lyrics: lyrics,
                    lyricsScrapedAt: new Date(),
                    scrapingStatus: 'completed',
                    scrapingError: null
                });
                
                // Add to artist's cached songs list if not already there
                const artistRef = doc(db, 'artists', artistUrlKey);
                const songIdInt = parseInt(songId); // Convert to integer for array operations
                await updateDoc(artistRef, {
                    cachedSongIds: arrayUnion(songIdInt),
                    lyricsScraped: increment(1)
                });
                
                console.log(`      ✅ Successfully scraped lyrics (${lyrics.length} chars)`);
                
                // Show snippet in verbose mode
                if (config.verbose) {
                    const snippet = lyrics.substring(0, 150).replace(/\n/g, ' ');
                    console.log(`         Preview: "${snippet}${lyrics.length > 150 ? '...' : ''}"`);
                }
                
                return { success: true };
            } else {
                throw new Error('No lyrics found or empty lyrics');
            }
            
        } catch (scrapingError) {
            // Scraping failed
            const newAttempts = currentAttempts + 1;
            
            if (newAttempts >= 3) {
                // Permanently failed
                console.log(`      ❌ Failed after ${newAttempts} attempts: ${scrapingError.message}`);
                
                await updateDoc(songRef, {
                    scrapingStatus: 'permanently_failed',
                    scrapingError: scrapingError.message,
                    scrapingAttempts: newAttempts
                });
                
                await removeSongFromCachedList(artistUrlKey, songId);
                
                return { success: false, error: scrapingError.message, permanentlyFailed: true };
            } else {
                // Can retry
                console.log(`      ⚠️  Failed (attempt ${newAttempts}/3): ${scrapingError.message}`);
                
                await updateDoc(songRef, {
                    scrapingStatus: 'failed',
                    scrapingError: scrapingError.message,
                    scrapingAttempts: newAttempts
                });
                
                return { success: false, error: scrapingError.message, canRetry: true };
            }
        }
        
    } catch (error) {
        console.error(`      ❌ Error processing song ${songId}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Fix songs with null lyrics by scraping them from Genius
 */
async function fixNullLyrics(nullSongs, contextArtistUrlKey = null) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔧 FIXING NULL LYRICS`);
    console.log(`${'='.repeat(60)}\n`);
    
    if (config.dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
        console.log(`Would attempt to fix ${Math.min(nullSongs.length, config.maxSongs)} song(s)\n`);
        return;
    }
    
    // Process in batches
    const songsToProcess = nullSongs.slice(0, config.maxSongs);
    const batches = [];
    
    for (let i = 0; i < songsToProcess.length; i += config.batchSize) {
        batches.push(songsToProcess.slice(i, i + config.batchSize));
    }
    
    console.log(`Processing ${songsToProcess.length} songs in ${batches.length} batch(es) of ${config.batchSize}\n`);
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`\n📦 Batch ${batchIndex + 1}/${batches.length}:`);
        
        // Group songs by artist for efficient scraping
        const songsByArtist = new Map();
        
        for (const song of batch) {
            // If we have a context artist (from --artist flag), use that for cached songs
            // Otherwise, try the cachedByArtist field, or look up the artist from the song's songIds array
            let artistUrlKey = contextArtistUrlKey;
            
            if (!artistUrlKey && song.cachedByArtist) {
                // Use the artist that has this song in their cache
                artistUrlKey = song.cachedByArtist;
            }
            
            if (!artistUrlKey) {
                // Last resort: try to find the artist by searching songIds arrays
                artistUrlKey = await findArtistForSong(song.id);
            }
            
            if (!artistUrlKey) {
                console.log(`   ⚠️  Could not find artist for song: ${song.title}`);
                state.skipped++;
                continue;
            }
            
            if (!songsByArtist.has(artistUrlKey)) {
                songsByArtist.set(artistUrlKey, []);
            }
            
            songsByArtist.get(artistUrlKey).push(song);
        }
        
        // Process each artist's songs
        for (const [artistUrlKey, songs] of songsByArtist.entries()) {
            console.log(`\n   🎤 Artist: ${artistUrlKey} (${songs.length} song(s))`);
            
            const songIds = songs.map(s => s.id);
            
            // Call the scrapeSongLyrics Firebase Function
            // Since we're running server-side, we can call it directly
            try {
                // Import the scraping function from functions/index.js
                // For simplicity, we'll use a direct approach here
                
                for (const song of songs) {
                    console.log(`      🎵 ${song.title}`);
                    const result = await scrapeSingleSong(song.id, artistUrlKey);
                    
                    if (result.success) {
                        state.fixed++;
                    } else if (result.permanentlyFailed) {
                        state.permanentlyFailed++;
                    } else {
                        state.failed++;
                        state.errors.push({
                            song: song.title,
                            error: result.error
                        });
                    }
                    
                    // Delay between songs to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                console.error(`   ❌ Error processing artist ${artistUrlKey}:`, error.message);
                state.failed += songs.length;
            }
        }
        
        // Delay between batches
        if (batchIndex < batches.length - 1) {
            console.log(`\n   ⏸️  Waiting 2 seconds before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

/**
 * Generate and display final report
 */
function generateReport() {
    const duration = ((Date.now() - state.startTime) / 1000).toFixed(1);
    
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`📊 FINAL REPORT`);
    console.log(`${'='.repeat(60)}\n`);
    
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📊 Songs Scanned: ${state.scanned}`);
    console.log(`❌ Null Lyrics Found: ${state.nullLyrics}`);
    console.log(`🎤 Artists Affected: ${state.artistsAffected.size}`);
    console.log(`⚠️  Already Permanently Failed: ${state.permanentlyFailed}`);
    
    if (!config.dryRun) {
        console.log(`\n🔧 Fixing Results:`);
        console.log(`   ✅ Fixed: ${state.fixed}`);
        console.log(`   ❌ Failed: ${state.failed}`);
        console.log(`   ⏭️  Skipped: ${state.skipped}`);
        
        if (state.errors.length > 0) {
            console.log(`\n⚠️  Errors encountered:`);
            state.errors.slice(0, 10).forEach(err => {
                console.log(`   - ${err.song}: ${err.error}`);
            });
            
            if (state.errors.length > 10) {
                console.log(`   ... and ${state.errors.length - 10} more`);
            }
        }
    }
    
    console.log(`\n${'='.repeat(60)}\n`);
}

/**
 * Main execution
 */
async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔧 BULK NULL LYRICS FIXER`);
    console.log(`${'='.repeat(60)}\n`);
    
    console.log('Configuration:');
    console.log(`  Dry Run: ${config.dryRun}`);
    console.log(`  Artist Filter: ${config.artistUrlKey || 'All artists'}`);
    console.log(`  Check Cached Only: ${config.checkCachedOnly}`);
    console.log(`  Batch Size: ${config.batchSize}`);
    console.log(`  Max Songs: ${config.maxSongs === Infinity ? 'Unlimited' : config.maxSongs}`);
    console.log(`  Verbose: ${config.verbose}\n`);
    
    // Initialize Firebase
    await initializeFirebase();
    
    // Find songs with null lyrics
    const { nullSongs, artistUrlKey } = await findSongsWithNullLyrics(config.artistUrlKey, config.checkCachedOnly);
    
    if (nullSongs.length === 0) {
        console.log('✅ No songs with null lyrics found!\n');
        return;
    }
    
    // Fix null lyrics
    await fixNullLyrics(nullSongs, artistUrlKey);
    
    // Generate report
    generateReport();
    
    console.log('✅ Done!\n');
}

// Run the script
main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});

