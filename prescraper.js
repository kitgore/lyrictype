#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Prescraper Configuration
 */
const config = {
    // Number of songs to scrape lyrics for per artist (configurable via CLI)
    maxSongsToScrape: 10,
    
    // Which artists to process
    artistFilters: {
        letters: ['all'], // Specific letters like ['a', 'b'] or 'all'
        types: ['popular', 'regular'], // Include popular, regular, or both
        maxArtistsPerLetter: null, // Limit artists per letter (for testing)
        skipExisting: true // Skip artists already in output files
    },
    
    // Rate limiting to be respectful to Genius
    delays: {
        betweenArtists: 1000, // 1 second
        betweenSongs: 500,    // 0.5 seconds  
        betweenPages: 200     // 0.2 seconds
    },
    
    // Output configuration
    output: {
        directory: `./prescraped-data-${new Date().toISOString().split('T')[0]}/`,
        filePerLetter: true, // One file per letter vs one big file
        resumable: true      // Save progress and allow resuming
    },
    
    // API configuration
    api: {
        timeout: 10000, // 10 second timeout
        maxRetries: 3,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    }
};

/**
 * Global state tracking
 */
const state = {
    processed: {
        artists: 0,
        songs: 0,
        lyrics: 0
    },
    errors: {
        artists: 0,
        songs: 0,
        lyrics: 0
    },
    startTime: null
};

/**
 * Utility function for delays
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Enhanced fetch with timeout and retries
 */
async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || config.api.timeout);
    
    let lastError;
    for (let attempt = 1; attempt <= config.api.maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'User-Agent': config.api.userAgent,
                    ...options.headers
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok && response.status >= 500) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error) {
            lastError = error;
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                console.warn(`⏰ Request timeout (attempt ${attempt}/${config.api.maxRetries}): ${url}`);
            } else {
                console.warn(`🔄 Request failed (attempt ${attempt}/${config.api.maxRetries}): ${error.message}`);
            }
            
            if (attempt < config.api.maxRetries) {
                const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
                console.log(`⏳ Retrying in ${delayMs}ms...`);
                await delay(delayMs);
            }
        }
    }
    
    throw lastError || new Error(`Failed after ${config.api.maxRetries} attempts`);
}

/**
 * Load artist data from genius-artists JSON files
 */
async function loadArtistData() {
    console.log('📂 Loading artist data from genius-artists files...');
    
    const artistsDir = path.join(__dirname, 'genius-artists-2025-07-11');
    const artists = [];
    
    try {
        const files = await fs.readdir(artistsDir);
        const jsonFiles = files.filter(file => file.startsWith('genius-artists-') && file.endsWith('.json') && file !== 'genius-artists-0.json');
        
        console.log(`Found ${jsonFiles.length} artist files`);
        
        for (const file of jsonFiles) {
            const letter = file.replace('genius-artists-', '').replace('.json', '');
            
            // Skip if not in target letters
            if (config.artistFilters.letters[0] !== 'all' && !config.artistFilters.letters.includes(letter)) {
                continue;
            }
            
            const filePath = path.join(artistsDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);
            
            // Combine popular and regular artists based on filter
            let letterArtists = [];
            
            if (config.artistFilters.types.includes('popular')) {
                letterArtists.push(...(data.artists.popular || []));
            }
            
            if (config.artistFilters.types.includes('regular')) {
                letterArtists.push(...(data.artists.regular || []));
            }
            
            // Apply max artists per letter limit if specified
            if (config.artistFilters.maxArtistsPerLetter) {
                letterArtists = letterArtists.slice(0, config.artistFilters.maxArtistsPerLetter);
            }
            
            // Add letter info to each artist
            letterArtists.forEach(artist => {
                artist.letter = letter;
                artist.urlKey = artist.url.split('/').pop(); // Extract URL key for Firebase compatibility
            });
            
            artists.push(...letterArtists);
            console.log(`📄 Loaded ${letterArtists.length} artists from ${file}`);
        }
        
        console.log(`✅ Total artists loaded: ${artists.length}`);
        return artists;
        
    } catch (error) {
        console.error('❌ Error loading artist data:', error);
        throw error;
    }
}

/**
 * Get Genius API key from local config
 */
async function getGeniusApiKey() {
    try {
        const configPath = path.join(__dirname, 'functions', 'local-config.json');
        const localConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
        return localConfig.genius.key;
    } catch (error) {
        console.error('❌ Error loading Genius API key from functions/local-config.json');
        console.error('Please ensure you have a valid local-config.json file with your Genius API key');
        throw error;
    }
}

/**
 * Fetch song metadata from Genius API for a specific artist page
 * (Ported from Firebase Functions)
 */
async function getSongsByArtist(artistId, geniusApiKey, page = 1) {
    console.log(`  📀 Fetching songs for artist ${artistId}, page ${page}`);
    
    try {
        const headers = { "Authorization": `Bearer ${geniusApiKey}` };
        
        // Fetch 50 songs per page, sorted by popularity
        const response = await fetchWithTimeout(
            `https://api.genius.com/artists/${artistId}/songs?per_page=50&page=${page}&sort=popularity`,
            { headers }
        );
        
        if (!response.ok) {
            throw new Error(`Genius API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.response || !data.response.songs) {
            throw new Error('Invalid API response structure');
        }
        
        const songs = data.response.songs;
        
        // Transform songs to our schema format
        const transformedSongs = songs.map(song => ({
            id: song.id.toString(),
            title: song.title,
            url: song.url,
            songArtImageUrl: song.song_art_image_url,
            artistNames: song.artist_names,
            primaryArtist: {
                id: song.primary_artist.id,
                name: song.primary_artist.name,
                url: song.primary_artist.url
            },
            // Album art ID extraction (same logic as Firebase Functions)
            albumArtId: extractGeniusImageHash(song.song_art_image_url)
        }));
        
        const hasMore = songs.length === 50; // If we got a full page, there might be more
        
        return {
            songs: transformedSongs,
            rawSongs: songs, // Include raw API response for image URL extraction
            hasMore,
            pageNumber: page
        };
        
    } catch (error) {
        console.error(`❌ Error fetching songs for artist ${artistId}, page ${page}:`, error);
        throw error;
    }
}

/**
 * Extract the hash/ID from a Genius image URL for album art deduplication
 * (Ported from Firebase Functions)
 */
function extractGeniusImageHash(imageUrl) {
    try {
        if (!imageUrl) return null;
        
        // Extract the filename from the URL
        const filename = imageUrl.split('/').pop();
        
        // Extract the hash (everything before the first dot)
        const hash = filename.split('.')[0];
        
        // Validate it looks like a hash (32 character hex string)
        if (hash && /^[a-f0-9]{32}$/i.test(hash)) {
            return hash.toLowerCase();
        }
        
        // Fallback: use the full filename if it doesn't match expected pattern
        console.warn(`Unexpected Genius URL format: ${imageUrl}, using filename as ID`);
        return filename.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        
    } catch (error) {
        console.error('Error extracting hash from Genius URL:', error);
        return null;
    }
}

/**
 * Extract artist image URL from songs data
 * (Ported from Firebase Functions)
 */
function extractArtistImageUrl(songs, targetArtistId, maxSongsToCheck = 11) {
    const targetId = typeof targetArtistId === 'string' ? parseInt(targetArtistId, 10) : targetArtistId;
    
    for (const song of songs.slice(0, maxSongsToCheck)) {
        // Check primary artist first
        if (song.primary_artist && song.primary_artist.id === targetId) {
            const imageUrl = song.primary_artist.image_url;
            if (imageUrl) {
                return imageUrl;
            }
        }
        
        // Check featured artists if primary artist doesn't match
        if (song.featured_artists && Array.isArray(song.featured_artists)) {
            for (const featuredArtist of song.featured_artists) {
                if (featuredArtist.id === targetId) {
                    const imageUrl = featuredArtist.image_url;
                    if (imageUrl) {
                        return imageUrl;
                    }
                }
            }
        }
    }
    
    return null;
}

/**
 * Get all songs for an artist (up to 1000 songs)
 * (Ported from Firebase Functions populateArtistSongsCore logic)
 */
async function getAllSongsForArtist(artist, geniusApiKey) {
    console.log(`🎵 Fetching all songs for: ${artist.name}`);
    
    let page = 1;
    let allSongs = [];
    const maxSongs = 1000;
    let artistImageUrl = null;
    
    while (allSongs.length < maxSongs) {
        try {
            const result = await getSongsByArtist(artist.id, geniusApiKey, page);
            
            if (result.songs.length === 0) {
                console.log(`  ✅ No more songs available (${allSongs.length} total)`);
                break;
            }
            
            // Extract artist image URL from first page if not found yet
            if (!artistImageUrl && page === 1) {
                artistImageUrl = extractArtistImageUrl(result.rawSongs, artist.id);
            }
            
            allSongs.push(...result.songs);
            console.log(`  📄 Page ${page}: ${result.songs.length} songs (${allSongs.length} total)`);
            
            // Break if no more pages
            if (!result.hasMore) {
                console.log(`  ✅ Reached end of songs (${allSongs.length} total)`);
                break;
            }
            
            page++;
            
            // Rate limiting
            await delay(config.delays.betweenPages);
            
        } catch (error) {
            console.error(`  ❌ Error fetching page ${page}:`, error);
            state.errors.songs++;
            break;
        }
    }
    
    return {
        songs: allSongs,
        artistImageUrl: artistImageUrl
    };
}

/**
 * Print configuration summary
 */
function printConfig() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 LYRICTYPE PRESCRAPER STARTING');
    console.log('='.repeat(60));
    console.log(`📋 Configuration:`);
    console.log(`   Max songs to scrape per artist: ${config.maxSongsToScrape}`);
    console.log(`   Target letters: ${config.artistFilters.letters.join(', ')}`);
    console.log(`   Artist types: ${config.artistFilters.types.join(', ')}`);
    if (config.artistFilters.maxArtistsPerLetter) {
        console.log(`   Max artists per letter: ${config.artistFilters.maxArtistsPerLetter}`);
    }
    console.log(`   Output directory: ${config.output.directory}`);
    console.log(`   Resumable: ${config.output.resumable}`);
    console.log('='.repeat(60) + '\n');
}

/**
 * Scrape lyrics from a Genius song URL
 * (Ported from Firebase Functions scrapeLyricsFromUrl)
 */
async function scrapeLyricsFromUrl(songUrl) {
    try {
        // Validate URL format
        if (!songUrl || typeof songUrl !== 'string') {
            throw new Error(`Invalid song URL: ${songUrl}`);
        }
        
        if (!songUrl.includes('genius.com')) {
            throw new Error(`URL does not appear to be a Genius URL: ${songUrl}`);
        }
        
        // Fetch the song page with proper error handling
        const songPageResponse = await fetchWithTimeout(songUrl);
        
        if (!songPageResponse.ok) {
            throw new Error(`HTTP ${songPageResponse.status}: ${songPageResponse.statusText} for URL: ${songUrl}`);
        }
        
        const songPageHtml = await songPageResponse.text();
        
        if (!songPageHtml || songPageHtml.length < 100) {
            throw new Error('Received empty or invalid HTML response');
        }

        // Parse the page with cheerio
        const $ = cheerio.load(songPageHtml);
        
        // Target ALL lyrics containers - Genius often splits lyrics across multiple divs
        const lyricsContainers = $('div[data-lyrics-container="true"]');
        
        if (lyricsContainers.length === 0) {
            throw new Error('No lyrics containers found');
        }
        
        let allLyricsText = '';
        
        // Process each lyrics container
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
                // Remove all HTML tags completely (including <i>, section headers, etc.)
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
        console.error(`    ❌ Error scraping lyrics from ${songUrl}:`, error.message);
        throw error;
    }
}

/**
 * Scrape lyrics for selected songs of an artist
 */
async function scrapeLyricsForArtist(artist, songs, maxSongs) {
    console.log(`  🎤 Scraping lyrics for top ${Math.min(maxSongs, songs.length)} songs...`);
    
    const songsToScrape = songs.slice(0, maxSongs);
    const scrapedSongs = [];
    
    for (let i = 0; i < songsToScrape.length; i++) {
        const song = songsToScrape[i];
        
        try {
            console.log(`    📝 [${i + 1}/${songsToScrape.length}] ${song.title}`);
            const startTime = Date.now();
            
            const lyrics = await scrapeLyricsFromUrl(song.url);
            const scrapingDuration = Date.now() - startTime;
            
            scrapedSongs.push({
                ...song,
                lyrics: lyrics,
                scrapedAt: new Date().toISOString(),
                scrapingDuration: scrapingDuration
            });
            
            state.processed.lyrics++;
            console.log(`    ✅ Success (${scrapingDuration}ms, ${lyrics.length} chars)`);
            
            // Rate limiting between songs
            if (i < songsToScrape.length - 1) {
                await delay(config.delays.betweenSongs);
            }
            
        } catch (error) {
            console.error(`    ❌ Failed to scrape "${song.title}": ${error.message}`);
            state.errors.lyrics++;
            
            // Still add the song without lyrics for metadata completeness
            scrapedSongs.push({
                ...song,
                lyrics: null,
                scrapingError: error.message,
                scrapedAt: new Date().toISOString()
            });
        }
    }
    
    return scrapedSongs;
}

/**
 * Process a single artist: fetch songs and scrape lyrics
 */
async function processArtist(artist, geniusApiKey, artistIndex, totalArtists) {
    const startTime = Date.now();
    
    console.log(`\n[${artistIndex + 1}/${totalArtists}] 🎨 Processing: ${artist.name}`);
    console.log(`  🔗 URL: ${artist.url}`);
    console.log(`  🆔 Genius ID: ${artist.id}`);
    
    try {
        // Get all songs for the artist
        const { songs, artistImageUrl } = await getAllSongsForArtist(artist, geniusApiKey);
        
        if (songs.length === 0) {
            console.log(`  ⚠️  No songs found for ${artist.name}`);
            state.errors.artists++;
            return null;
        }
        
        console.log(`  📚 Found ${songs.length} songs total`);
        state.processed.songs += songs.length;
        
        // Scrape lyrics for top N songs
        const scrapedSongs = await scrapeLyricsForArtist(artist, songs, config.maxSongsToScrape);
        
        const processingTime = Date.now() - startTime;
        const successfulScrapes = scrapedSongs.filter(s => s.lyrics).length;
        
        console.log(`  ✅ Completed: ${successfulScrapes}/${scrapedSongs.length} lyrics scraped (${processingTime}ms)`);
        state.processed.artists++;
        
        // Return structured data
        return {
            // Original artist data
            name: artist.name,
            geniusId: artist.id,
            url: artist.url,
            urlKey: artist.urlKey,
            letter: artist.letter,
            type: artist.type,
            
            // Scraped metadata
            imageUrl: artistImageUrl,
            totalSongs: songs.length,
            
            // Complete song list (metadata only)
            allSongs: songs,
            
            // Songs with scraped lyrics
            scrapedSongs: scrapedSongs,
            
            // Processing metadata
            processingStats: {
                totalSongsFound: songs.length,
                songsScraped: scrapedSongs.length,
                lyricsScraped: successfulScrapes,
                scrapingErrors: scrapedSongs.length - successfulScrapes,
                processingTime: processingTime
            },
            
            processedAt: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`  💥 Failed to process ${artist.name}: ${error.message}`);
        state.errors.artists++;
        return null;
    }
}

/**
 * Save processed data to JSON file
 */
async function saveToFile(data, letter) {
    const filename = `prescraped-${letter}.json`;
    const filepath = path.join(config.output.directory, filename);
    
    const output = {
        letter: letter,
        processedAt: new Date().toISOString(),
        artists: data.filter(item => item !== null), // Remove failed artists
        summary: {
            totalProcessed: data.filter(item => item !== null).length,
            totalFailed: data.filter(item => item === null).length,
            totalSongs: data.reduce((sum, item) => sum + (item?.totalSongs || 0), 0),
            totalLyrics: data.reduce((sum, item) => sum + (item?.processingStats?.lyricsScraped || 0), 0)
        }
    };
    
    await fs.writeFile(filepath, JSON.stringify(output, null, 2));
    console.log(`💾 Saved results to: ${filename}`);
    
    return output;
}

/**
 * Main execution function
 */
async function main() {
    try {
        state.startTime = Date.now();
        
        printConfig();
        
        // Parse command line arguments
        if (process.argv.includes('--help') || process.argv.includes('-h')) {
            console.log(`
Usage: node prescraper.js [options]

Options:
  --songs <number>     Number of songs to scrape per artist (default: ${config.maxSongsToScrape})
  --letters <letters>  Letters to process, comma-separated (default: all)
  --test <number>      Test mode: limit artists per letter
  --help, -h           Show this help message

Examples:
  node prescraper.js --songs 5 --letters a,b,c
  node prescraper.js --test 2  # Process only 2 artists per letter
            `);
            return;
        }
        
        // Parse CLI arguments
        const argsIndex = process.argv.indexOf('--songs');
        if (argsIndex !== -1 && process.argv[argsIndex + 1]) {
            config.maxSongsToScrape = parseInt(process.argv[argsIndex + 1], 10);
        }
        
        const lettersIndex = process.argv.indexOf('--letters');
        if (lettersIndex !== -1 && process.argv[lettersIndex + 1]) {
            config.artistFilters.letters = process.argv[lettersIndex + 1].split(',');
        }
        
        const testIndex = process.argv.indexOf('--test');
        if (testIndex !== -1 && process.argv[testIndex + 1]) {
            config.artistFilters.maxArtistsPerLetter = parseInt(process.argv[testIndex + 1], 10);
            console.log(`🧪 TEST MODE: Processing max ${config.artistFilters.maxArtistsPerLetter} artists per letter`);
        }
        
        // Load Genius API key
        console.log('🔑 Loading Genius API key...');
        const geniusApiKey = await getGeniusApiKey();
        console.log('✅ API key loaded');
        
        // Load artist data
        const artists = await loadArtistData();
        
        if (artists.length === 0) {
            console.log('⚠️  No artists found matching criteria');
            return;
        }
        
        // Create output directory
        await fs.mkdir(config.output.directory, { recursive: true });
        console.log(`📁 Created output directory: ${config.output.directory}`);
        
        console.log(`\n🎯 Processing ${artists.length} artists...`);
        console.log('Press Ctrl+C to stop gracefully\n');
        
        // Group artists by letter for organized processing
        const artistsByLetter = artists.reduce((acc, artist) => {
            if (!acc[artist.letter]) acc[artist.letter] = [];
            acc[artist.letter].push(artist);
            return acc;
        }, {});
        
        const letters = Object.keys(artistsByLetter).sort();
        console.log(`📋 Processing ${letters.length} letters: ${letters.join(', ')}`);
        
        // Process each letter
        for (const letter of letters) {
            const letterArtists = artistsByLetter[letter];
            console.log(`\n${'='.repeat(50)}`);
            console.log(`📖 LETTER: ${letter.toUpperCase()} (${letterArtists.length} artists)`);
            console.log('='.repeat(50));
            
            const letterResults = [];
            
            // Process each artist in the letter
            for (let i = 0; i < letterArtists.length; i++) {
                const artist = letterArtists[i];
                
                try {
                    const result = await processArtist(artist, geniusApiKey, i, letterArtists.length);
                    letterResults.push(result);
                    
                    // Rate limiting between artists
                    if (i < letterArtists.length - 1) {
                        await delay(config.delays.betweenArtists);
                    }
                    
                } catch (error) {
                    console.error(`💥 Critical error processing ${artist.name}:`, error);
                    letterResults.push(null);
                    state.errors.artists++;
                }
            }
            
            // Save results for this letter
            try {
                await saveToFile(letterResults, letter);
                
                const successful = letterResults.filter(r => r !== null).length;
                const failed = letterResults.filter(r => r === null).length;
                const totalLyrics = letterResults.reduce((sum, r) => sum + (r?.processingStats?.lyricsScraped || 0), 0);
                
                console.log(`\n✅ Letter ${letter.toUpperCase()} completed:`);
                console.log(`   Artists: ${successful} successful, ${failed} failed`);
                console.log(`   Lyrics scraped: ${totalLyrics}`);
                
            } catch (saveError) {
                console.error(`❌ Error saving results for letter ${letter}:`, saveError);
            }
        }
        
        // Final summary
        const totalTime = Date.now() - state.startTime;
        console.log(`\n${'='.repeat(60)}`);
        console.log('🎉 PRESCRAPING COMPLETED!');
        console.log('='.repeat(60));
        console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`);
        console.log(`📊 Final stats:`);
        console.log(`   Artists processed: ${state.processed.artists}`);
        console.log(`   Songs fetched: ${state.processed.songs}`);
        console.log(`   Lyrics scraped: ${state.processed.lyrics}`);
        console.log(`   Total errors: ${state.errors.artists + state.errors.songs + state.errors.lyrics}`);
        console.log(`📁 Output saved to: ${config.output.directory}`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
    console.log(`📊 Final stats:`);
    console.log(`   Artists processed: ${state.processed.artists}`);
    console.log(`   Songs processed: ${state.processed.songs}`);
    console.log(`   Lyrics scraped: ${state.processed.lyrics}`);
    console.log(`   Errors: ${state.errors.artists + state.errors.songs + state.errors.lyrics}`);
    process.exit(0);
});

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export {
    config,
    loadArtistData,
    getAllSongsForArtist,
    extractGeniusImageHash,
    extractArtistImageUrl
};
