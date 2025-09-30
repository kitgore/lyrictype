#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc, getDoc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Firebase Uploader Configuration
 */
const config = {
    // Input configuration
    input: {
        directory: null, // Will be set via CLI or default to latest
        pattern: 'prescraped-*.json', // File pattern to match
        skipExisting: true // Skip artists that already exist in Firestore
    },
    
    // Upload configuration
    upload: {
        batchSize: 100, // Number of operations per batch
        delayBetweenBatches: 1000, // Delay between batches (ms)
        collections: {
            artists: 'artists',
            songs: 'songs',
            albumArt: 'albumArt'
        }
    },
    
    // Processing options
    processing: {
        uploadArtistImages: false, // Skip artist image processing for now
        uploadAlbumArt: false, // Skip album art processing for now
        dryRun: false // If true, don't actually upload
    },
    
    // Filtering options
    filtering: {
        startLetter: null, // Filter artists starting with this letter (a-z)
        endLetter: null, // Filter artists ending with this letter (a-z)
        maxArtists: null // Limit number of artists to process (for testing)
    }
};

/**
 * Global state tracking
 */
const state = {
    uploaded: {
        artists: 0,
        songs: 0,
        albumArt: 0
    },
    skipped: {
        artists: 0,
        songs: 0,
        albumArt: 0
    },
    errors: {
        artists: 0,
        songs: 0,
        albumArt: 0
    },
    startTime: null
};

// Initialize Firebase
let db = null;

/**
 * Initialize Firebase connection
 */
async function initializeFirebase() {
    try {
        console.log('🔧 Initializing Firebase...');
        
        // Initialize Firebase using centralized config (same as working script)
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        
        // Check if we should use emulator
        if (process.env.FIRESTORE_EMULATOR_HOST) {
            console.log('🧪 Using Firestore emulator at', process.env.FIRESTORE_EMULATOR_HOST);
        }
        
        console.log('✅ Firebase initialized successfully');
        
        return db;
    } catch (error) {
        console.error('❌ Error initializing Firebase:', error);
        throw error;
    }
}

/**
 * Load prescraped data files
 */
async function loadPrescrapedData(inputDir) {
    console.log(`📂 Loading prescraped data from: ${inputDir}`);
    
    try {
        const files = await fs.readdir(inputDir);
        const jsonFiles = files.filter(file => file.match(/^prescraped-.+\.json$/));
        
        if (jsonFiles.length === 0) {
            throw new Error(`No prescraped files found in ${inputDir}`);
        }
        
        console.log(`Found ${jsonFiles.length} prescraped files: ${jsonFiles.join(', ')}`);
        
        const allData = [];
        
        for (const file of jsonFiles) {
            const filePath = path.join(inputDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);
            
            console.log(`📄 Loaded ${file}: ${data.artists.length} artists, ${data.summary.totalSongs} songs, ${data.summary.totalLyrics} lyrics`);
            allData.push(data);
        }
        
        // Flatten all artists from all files
        const allArtists = allData.flatMap(data => data.artists);
        console.log(`✅ Total loaded: ${allArtists.length} artists`);
        
        return allArtists;
        
    } catch (error) {
        console.error('❌ Error loading prescraped data:', error);
        throw error;
    }
}

/**
 * Check if artist already exists in Firestore
 */
async function checkArtistExists(urlKey) {
    try {
        const artistRef = doc(db, config.upload.collections.artists, urlKey);
        const docSnap = await getDoc(artistRef);
        return docSnap.exists();
    } catch (error) {
        console.error(`❌ Error checking if artist exists (${urlKey}):`, error);
        return false; // Assume doesn't exist if we can't check
    }
}

/**
 * Upload artist to Firestore
 */
async function uploadArtist(artistData) {
    const urlKey = artistData.urlKey;
    
    try {
        // Check if already exists and skip if configured to do so
        if (config.input.skipExisting) {
            const exists = await checkArtistExists(urlKey);
            if (exists) {
                console.log(`  ⏭️  Artist ${artistData.name} already exists, skipping`);
                state.skipped.artists++;
                return { skipped: true };
            }
        }
        
        // Prepare artist document data (matching your Firebase Functions structure)
        const artistDoc = {
            name: artistData.name,
            geniusId: parseInt(artistData.geniusId, 10),
            url: artistData.url,
            imageUrl: artistData.imageUrl || null,
            totalSongs: artistData.totalSongs,
            songIds: artistData.allSongs.map(song => song.id),
            cachedSongIds: artistData.scrapedSongs.filter(song => song.lyrics).map(song => song.id),
            songsLastUpdated: new Date(),
            lyricsScraped: artistData.processingStats.lyricsScraped,
            isFullyCached: true, // We've fetched all available songs
            cacheVersion: 1,
            createdAt: new Date(),
            // Prescraped metadata
            prescrapedAt: new Date(artistData.processedAt),
            prescrapedStats: artistData.processingStats
        };
        
        if (!config.processing.dryRun) {
            const artistRef = doc(db, config.upload.collections.artists, urlKey);
            await setDoc(artistRef, artistDoc);
        }
        
        console.log(`  ✅ Uploaded artist: ${artistData.name} (${artistData.totalSongs} songs, ${artistData.processingStats.lyricsScraped} lyrics)`);
        state.uploaded.artists++;
        
        return { uploaded: true, songIds: artistDoc.songIds, cachedSongIds: artistDoc.cachedSongIds };
        
    } catch (error) {
        console.error(`  ❌ Error uploading artist ${artistData.name}:`, error);
        state.errors.artists++;
        return { error: error.message };
    }
}

/**
 * Upload songs to Firestore in batches
 */
async function uploadSongs(artistData) {
    console.log(`  📚 Uploading ${artistData.allSongs.length} songs...`);
    
    try {
        // Prepare all songs (both with and without lyrics)
        const songsToUpload = [];
        
        // Create a map of scraped songs for quick lookup
        const scrapedSongsMap = new Map();
        artistData.scrapedSongs.forEach(song => {
            scrapedSongsMap.set(song.id, song);
        });
        
        // Process all songs
        for (const song of artistData.allSongs) {
            const scrapedSong = scrapedSongsMap.get(song.id);
            
            const songDoc = {
                title: song.title,
                url: song.url,
                songArtImageUrl: song.songArtImageUrl,
                artistNames: song.artistNames,
                primaryArtist: song.primaryArtist,
                albumArtId: song.albumArtId,
                addedAt: new Date(),
                // Lyrics data (if available)
                lyrics: scrapedSong?.lyrics || null,
                lyricsScrapedAt: scrapedSong?.lyrics ? new Date(scrapedSong.scrapedAt) : null,
                scrapingAttempts: scrapedSong?.lyrics ? 1 : 0,
                scrapingError: scrapedSong?.scrapingError || null,
                scrapingStatus: scrapedSong?.lyrics ? 'completed' : (scrapedSong?.scrapingError ? 'failed' : 'pending'),
                scrapingDuration: scrapedSong?.scrapingDuration || null
            };
            
            songsToUpload.push({ id: song.id, data: songDoc });
        }
        
        // Upload in batches
        const batchSize = config.upload.batchSize;
        let uploaded = 0;
        
        for (let i = 0; i < songsToUpload.length; i += batchSize) {
            const batch = writeBatch(db);
            const batchSongs = songsToUpload.slice(i, i + batchSize);
            
            for (const song of batchSongs) {
                if (!config.processing.dryRun) {
                    const songRef = doc(db, config.upload.collections.songs, song.id);
                    batch.set(songRef, song.data);
                }
            }
            
            if (!config.processing.dryRun) {
                await batch.commit();
            }
            
            uploaded += batchSongs.length;
            console.log(`    📄 Uploaded batch: ${uploaded}/${songsToUpload.length} songs`);
            
            // Delay between batches
            if (i + batchSize < songsToUpload.length) {
                await new Promise(resolve => setTimeout(resolve, config.upload.delayBetweenBatches));
            }
        }
        
        state.uploaded.songs += uploaded;
        console.log(`  ✅ Completed song upload: ${uploaded} songs`);
        
        return { uploaded: uploaded };
        
    } catch (error) {
        console.error(`  ❌ Error uploading songs for ${artistData.name}:`, error);
        state.errors.songs += artistData.allSongs.length;
        return { error: error.message };
    }
}

/**
 * Process a single artist: upload artist and songs
 */
async function processArtist(artistData, artistIndex, totalArtists) {
    console.log(`\n[${artistIndex + 1}/${totalArtists}] 🎨 Processing: ${artistData.name}`);
    
    try {
        // Upload artist document
        const artistResult = await uploadArtist(artistData);
        
        if (artistResult.skipped) {
            console.log(`  ⏭️  Skipped artist and songs`);
            return;
        }
        
        if (artistResult.error) {
            console.log(`  ❌ Skipping songs due to artist upload error`);
            return;
        }
        
        // Upload songs
        const songsResult = await uploadSongs(artistData);
        
        if (songsResult.error) {
            console.log(`  ⚠️  Artist uploaded but songs failed`);
        }
        
    } catch (error) {
        console.error(`  💥 Critical error processing ${artistData.name}:`, error);
        state.errors.artists++;
    }
}

/**
 * Get the sorting letter for an artist name (ignores common articles)
 */
function getSortingLetter(artistName) {
    const name = artistName.toLowerCase();
    const articles = ['the ', 'a ', 'an '];
    
    for (const article of articles) {
        if (name.startsWith(article)) {
            return name.charAt(article.length);
        }
    }
    
    return name.charAt(0);
}

/**
 * Filter artists by letter range and/or limit count
 */
function filterArtists(artists) {
    let filtered = [...artists];
    
    // Apply letter filtering
    if (config.filtering.startLetter || config.filtering.endLetter) {
        const startLetter = config.filtering.startLetter?.toLowerCase() || 'a';
        const endLetter = config.filtering.endLetter?.toLowerCase() || 'z';
        
        filtered = filtered.filter(artist => {
            const sortingChar = getSortingLetter(artist.name);
            return sortingChar >= startLetter && sortingChar <= endLetter;
        });
        
        console.log(`🔤 Filtered by letters ${startLetter.toUpperCase()}-${endLetter.toUpperCase()}: ${filtered.length}/${artists.length} artists`);
    }
    
    // Apply count limit
    if (config.filtering.maxArtists && config.filtering.maxArtists > 0) {
        const originalCount = filtered.length;
        filtered = filtered.slice(0, config.filtering.maxArtists);
        console.log(`🔢 Limited to ${config.filtering.maxArtists} artists: ${filtered.length}/${originalCount} selected`);
    }
    
    return filtered;
}

/**
 * Find the latest prescraped directory
 */
async function findLatestPrescrapedDir() {
    try {
        const entries = await fs.readdir(__dirname, { withFileTypes: true });
        const prescrapedDirs = entries
            .filter(entry => entry.isDirectory() && entry.name.startsWith('prescraped-data-'))
            .map(entry => entry.name)
            .sort()
            .reverse(); // Latest first
        
        if (prescrapedDirs.length === 0) {
            throw new Error('No prescraped data directories found');
        }
        
        return path.join(__dirname, prescrapedDirs[0]);
    } catch (error) {
        console.error('❌ Error finding prescraped directories:', error);
        throw error;
    }
}

/**
 * Print configuration summary
 */
function printConfig() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 LYRICTYPE FIREBASE UPLOADER STARTING');
    console.log('='.repeat(60));
    console.log(`📋 Configuration:`);
    console.log(`   Input directory: ${config.input.directory || 'auto-detect latest'}`);
    console.log(`   Skip existing: ${config.input.skipExisting}`);
    console.log(`   Batch size: ${config.upload.batchSize}`);
    console.log(`   Dry run: ${config.processing.dryRun}`);
    if (config.filtering.startLetter || config.filtering.endLetter) {
        const start = config.filtering.startLetter?.toUpperCase() || 'A';
        const end = config.filtering.endLetter?.toUpperCase() || 'Z';
        console.log(`   Letter filter: ${start}-${end}`);
    }
    if (config.filtering.maxArtists) {
        console.log(`   Max artists: ${config.filtering.maxArtists}`);
    }
    if (config.processing.dryRun) {
        console.log('   ⚠️  DRY RUN MODE: No data will be uploaded');
    }
    console.log('='.repeat(60) + '\n');
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
Usage: node firebase-uploader.js [options]

Options:
  --dir <directory>       Directory containing prescraped JSON files
  --start-letter <letter> Only process artists starting with this letter (a-z)
  --end-letter <letter>   Only process artists up to this letter (a-z)
  --max-artists <number>  Limit number of artists to process (for testing)
  --dry-run              Don't actually upload, just show what would be done
  --force                Upload even if artists already exist
  --emulator             Use local Firestore emulator (requires firebase emulators:start)
  --help, -h             Show this help message

Examples:
  node firebase-uploader.js --start-letter n --end-letter z  # Upload artists N-Z
  node firebase-uploader.js --start-letter n --max-artists 5 --dry-run  # Test with 5 artists starting with N
  node firebase-uploader.js --dir ./prescraped-data-2025-09-14/
  node firebase-uploader.js --dry-run  # Test run without uploading
  node firebase-uploader.js --force    # Overwrite existing artists
  node firebase-uploader.js --emulator # Use local emulator for testing
            `);
            return;
        }
        
        // Parse CLI arguments
        const dirIndex = process.argv.indexOf('--dir');
        if (dirIndex !== -1 && process.argv[dirIndex + 1]) {
            config.input.directory = process.argv[dirIndex + 1];
        }
        
        const startLetterIndex = process.argv.indexOf('--start-letter');
        if (startLetterIndex !== -1 && process.argv[startLetterIndex + 1]) {
            const letter = process.argv[startLetterIndex + 1].toLowerCase();
            if (letter.match(/^[a-z]$/)) {
                config.filtering.startLetter = letter;
            } else {
                console.error('❌ --start-letter must be a single letter (a-z)');
                process.exit(1);
            }
        }
        
        const endLetterIndex = process.argv.indexOf('--end-letter');
        if (endLetterIndex !== -1 && process.argv[endLetterIndex + 1]) {
            const letter = process.argv[endLetterIndex + 1].toLowerCase();
            if (letter.match(/^[a-z]$/)) {
                config.filtering.endLetter = letter;
            } else {
                console.error('❌ --end-letter must be a single letter (a-z)');
                process.exit(1);
            }
        }
        
        const maxArtistsIndex = process.argv.indexOf('--max-artists');
        if (maxArtistsIndex !== -1 && process.argv[maxArtistsIndex + 1]) {
            const count = parseInt(process.argv[maxArtistsIndex + 1], 10);
            if (count > 0) {
                config.filtering.maxArtists = count;
            } else {
                console.error('❌ --max-artists must be a positive number');
                process.exit(1);
            }
        }
        
        if (process.argv.includes('--dry-run')) {
            config.processing.dryRun = true;
            console.log('🧪 DRY RUN MODE: No data will be uploaded');
        }
        
        if (process.argv.includes('--force')) {
            config.input.skipExisting = false;
            console.log('💪 FORCE MODE: Will overwrite existing artists');
        }
        
        if (process.argv.includes('--emulator')) {
            process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
            console.log('🧪 EMULATOR MODE: Using local Firestore emulator');
        }
        
        // Determine input directory
        if (!config.input.directory) {
            config.input.directory = await findLatestPrescrapedDir();
            console.log(`📁 Auto-detected input directory: ${config.input.directory}`);
        }
        
        // Initialize Firebase
        await initializeFirebase();
        
        // Load prescraped data
        const allArtists = await loadPrescrapedData(config.input.directory);
        
        if (allArtists.length === 0) {
            console.log('⚠️  No artists found in prescraped data');
            return;
        }
        
        // Apply filtering
        const artists = filterArtists(allArtists);
        
        if (artists.length === 0) {
            console.log('⚠️  No artists match the specified filters');
            return;
        }
        
        console.log(`\n🎯 Uploading ${artists.length} artists to Firestore...`);
        console.log('Press Ctrl+C to stop gracefully\n');
        
        // Process each artist
        for (let i = 0; i < artists.length; i++) {
            const artist = artists[i];
            await processArtist(artist, i, artists.length);
            
            // Small delay between artists to be gentle on Firestore
            if (i < artists.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Final summary
        const totalTime = Date.now() - state.startTime;
        console.log(`\n${'='.repeat(60)}`);
        console.log('🎉 FIREBASE UPLOAD COMPLETED!');
        console.log('='.repeat(60));
        console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`);
        console.log(`📊 Final stats:`);
        console.log(`   Artists uploaded: ${state.uploaded.artists}, skipped: ${state.skipped.artists}, errors: ${state.errors.artists}`);
        console.log(`   Songs uploaded: ${state.uploaded.songs}, errors: ${state.errors.songs}`);
        console.log(`   Total operations: ${state.uploaded.artists + state.uploaded.songs}`);
        if (config.processing.dryRun) {
            console.log(`   ⚠️  DRY RUN: No actual data was uploaded`);
        }
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
    console.log(`   Artists uploaded: ${state.uploaded.artists}`);
    console.log(`   Songs uploaded: ${state.uploaded.songs}`);
    console.log(`   Total errors: ${state.errors.artists + state.errors.songs}`);
    process.exit(0);
});

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
