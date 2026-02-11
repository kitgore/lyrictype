#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, updateDoc, query, orderBy, limit, startAfter, getDocs } from 'firebase/firestore';
import unidecode from 'unidecode';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Search Token Updater Configuration
 */
const config = {
    // Processing options
    processing: {
        dryRun: false, // If true, don't actually update documents
        batchSize: 50, // Number of artists to process per batch
        delayBetweenBatches: 1000, // Delay between batches (ms)
        maxTokens: 5000 // Maximum number of search tokens per artist
    },
    
    // Filtering options
    filtering: {
        startLetter: null, // Filter artists starting with this letter (a-z)
        endLetter: null, // Filter artists ending with this letter (a-z)
        maxArtists: null, // Limit number of artists to process (for testing)
        singleArtist: null // Process only this specific artist name (for testing)
    },
    
    // Firebase collection
    collection: 'artists'
};

/**
 * Global state tracking
 */
const state = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
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
 * Sanitize field value for Firestore storage
 */
function sanitizeFieldValue(text) {
    if (!text) return text;
    
    // Remove null bytes and other problematic control characters
    let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // Remove Unicode tag characters and other problematic invisible characters
    sanitized = sanitized.replace(/[\uFE00-\uFE0F]/g, ''); // Variation selectors
    sanitized = sanitized.replace(/[\u200B-\u200F]/g, ''); // Zero-width characters
    sanitized = sanitized.replace(/[\u2060-\u206F]/g, ''); // Additional invisible characters
    sanitized = sanitized.replace(/[\uFEFF]/g, ''); // Byte order mark
    
    // Remove Unicode tag characters (which require surrogate pairs in JavaScript)
    sanitized = sanitized.replace(/\uDB40[\uDC00-\uDC7F]/g, ''); // Tag characters
    
    // Also remove any orphaned high surrogates that might cause encoding issues
    sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, ''); // Orphaned high surrogates
    sanitized = sanitized.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''); // Orphaned low surrogates
    
    try {
        // Normalize Unicode characters to canonical composition
        sanitized = sanitized.normalize('NFC');
        
        // Test if the string can be properly encoded
        encodeURIComponent(sanitized);
    } catch (error) {
        // If normalization or encoding fails, fall back to unidecode
        console.warn(`⚠️  Unicode normalization failed for "${text}", using unidecode fallback`);
        sanitized = unidecode(text);
        // Clean up any remaining problematic characters after unidecode
        sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    }
    
    return sanitized.trim();
}

/**
 * Normalize text for search (remove accents, handle special characters)
 */
function normalizeText(text) {
    let normalized = unidecode(text);
    normalized = normalized
        .replace(/0/g, 'o')
        .replace(/\$/g, 's')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't')
        .replace(/\+/g, 'plus')
        .replace(/&/g, 'and')
        .replace(/@/g, 'at');
    return normalized.toLowerCase();
}

/**
 * Generate search tokens for autocomplete functionality
 */
function generateSearchTokens(name) {
    const tokens = new Set();
    const cleanName = name.toLowerCase().trim();
    const normalizedName = normalizeText(name);
    
    // Generate punctuation-free versions
    const removePunctuation = (text) => text.replace(/[.,\-_'"!?&@#$%^*()+=\[\]{};:|<>\/\\`~]/g, '').replace(/\s+/g, ' ').trim();
    const cleanNameNoPunct = removePunctuation(cleanName);
    const normalizedNameNoPunct = removePunctuation(normalizedName);
    
    // Generate tokens for all versions: original, normalized, and punctuation-free
    const versions = [cleanName];
    if (normalizedName !== cleanName) {
        versions.push(normalizedName);
    }
    if (cleanNameNoPunct !== cleanName && cleanNameNoPunct.length > 0) {
        versions.push(cleanNameNoPunct);
    }
    if (normalizedNameNoPunct !== normalizedName && normalizedNameNoPunct !== cleanNameNoPunct && normalizedNameNoPunct.length > 0) {
        versions.push(normalizedNameNoPunct);
    }
    
    for (const version of versions) {
        for (let i = 1; i <= version.length; i++) {
            tokens.add(version.substring(0, i));
        }
        
        const words = version.split(/\s+/);
        for (const word of words) {
            if (word.length > 0) {
                for (let i = 1; i <= word.length; i++) {
                    tokens.add(word.substring(0, i));
                }
            }
        }
        tokens.add(version);
    }
    
    tokens.add(name);
    
    return Array.from(tokens)
        .filter(token => token.length > 0 && token.length <= 100)
        .map(token => sanitizeFieldValue(token))
        .filter(token => token && token.length > 0);
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
 * Check if artist matches filtering criteria
 */
function matchesFilter(artistData) {
    // Single artist filter (for testing)
    if (config.filtering.singleArtist) {
        return artistData.name.toLowerCase().includes(config.filtering.singleArtist.toLowerCase());
    }
    
    // Letter range filter
    if (config.filtering.startLetter || config.filtering.endLetter) {
        const startLetter = config.filtering.startLetter?.toLowerCase() || 'a';
        const endLetter = config.filtering.endLetter?.toLowerCase() || 'z';
        
        const sortingChar = getSortingLetter(artistData.name);
        return sortingChar >= startLetter && sortingChar <= endLetter;
    }
    
    return true;
}

/**
 * Fetch all artists from Firestore with pagination
 */
async function fetchAllArtists() {
    console.log('📂 Fetching artists from Firestore...');
    
    const allArtists = [];
    const artistsRef = collection(db, config.collection);
    let lastDoc = null;
    let batchCount = 0;
    
    while (true) {
        batchCount++;
        console.log(`  📄 Fetching batch ${batchCount}...`);
        
        let q = query(artistsRef, orderBy('name'), limit(1000));
        
        if (lastDoc) {
            q = query(artistsRef, orderBy('name'), startAfter(lastDoc), limit(1000));
        }
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            break;
        }
        
        const batchArtists = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        allArtists.push(...batchArtists);
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        
        console.log(`    ✅ Fetched ${batchArtists.length} artists (total: ${allArtists.length})`);
        
        // Small delay to be gentle on Firestore
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`📊 Total artists fetched: ${allArtists.length}`);
    return allArtists;
}

/**
 * Update search tokens for a single artist
 */
async function updateArtistSearchTokens(artistData) {
    try {
        // Check if artist already has search tokens
        if (artistData.searchTokens && Array.isArray(artistData.searchTokens) && artistData.searchTokens.length > 0) {
            console.log(`  ⏭️  ${artistData.name} already has search tokens (${artistData.searchTokens.length} tokens), skipping`);
            state.skipped++;
            return { skipped: true };
        }
        
        // Generate search tokens
        let searchTokens;
        try {
            searchTokens = generateSearchTokens(artistData.name);
            
            // Limit search tokens to prevent oversized arrays
            if (searchTokens.length > config.processing.maxTokens) {
                console.warn(`⚠️  Too many search tokens for ${artistData.name}, limiting to ${config.processing.maxTokens}`);
                searchTokens = searchTokens.slice(0, config.processing.maxTokens);
            }
        } catch (error) {
            console.warn(`❌ Failed to generate search tokens for ${artistData.name}: ${error.message}`);
            state.errors++;
            return { error: error.message };
        }
        
        if (!config.processing.dryRun) {
            const artistRef = doc(db, config.collection, artistData.id);
            await updateDoc(artistRef, {
                searchTokens: searchTokens
            });
        }
        
        // Show sample tokens in verbose mode or for small batches
        const showTokens = config.filtering.singleArtist || (config.filtering.maxArtists && config.filtering.maxArtists <= 10);
        if (showTokens && searchTokens.length > 0) {
            const sampleTokens = searchTokens.slice(0, 10); // Show first 10 tokens
            const moreTokens = searchTokens.length > 10 ? ` (+${searchTokens.length - 10} more)` : '';
            console.log(`  ✅ Updated search tokens for ${artistData.name} (${searchTokens.length} tokens)`);
            console.log(`     Sample tokens: [${sampleTokens.map(t => `"${t}"`).join(', ')}${moreTokens}]`);
        } else {
            console.log(`  ✅ Updated search tokens for ${artistData.name} (${searchTokens.length} tokens)`);
        }
        state.updated++;
        
        return { updated: true, tokenCount: searchTokens.length };
        
    } catch (error) {
        console.error(`  ❌ Error updating ${artistData.name}:`, error);
        state.errors++;
        return { error: error.message };
    }
}

/**
 * Process artists in batches
 */
async function processArtists(artists) {
    console.log(`\n🎯 Processing ${artists.length} artists...`);
    
    // Apply filters
    let filteredArtists = artists.filter(matchesFilter);
    
    if (config.filtering.singleArtist) {
        console.log(`🔍 Single artist filter: "${config.filtering.singleArtist}" - ${filteredArtists.length} matches found`);
    }
    
    if (config.filtering.startLetter || config.filtering.endLetter) {
        const start = config.filtering.startLetter?.toUpperCase() || 'A';
        const end = config.filtering.endLetter?.toUpperCase() || 'Z';
        console.log(`🔤 Letter filter: ${start}-${end} - ${filteredArtists.length}/${artists.length} artists match`);
    }
    
    // Apply count limit
    if (config.filtering.maxArtists && config.filtering.maxArtists > 0) {
        const originalCount = filteredArtists.length;
        filteredArtists = filteredArtists.slice(0, config.filtering.maxArtists);
        console.log(`🔢 Limited to ${config.filtering.maxArtists} artists: ${filteredArtists.length}/${originalCount} selected`);
    }
    
    if (filteredArtists.length === 0) {
        console.log('⚠️  No artists match the specified filters');
        return;
    }
    
    console.log(`\n📝 Processing ${filteredArtists.length} artists in batches of ${config.processing.batchSize}...`);
    
    const totalBatches = Math.ceil(filteredArtists.length / config.processing.batchSize);
    
    for (let i = 0; i < totalBatches; i++) {
        const startIdx = i * config.processing.batchSize;
        const endIdx = Math.min(startIdx + config.processing.batchSize, filteredArtists.length);
        const batchArtists = filteredArtists.slice(startIdx, endIdx);
        
        console.log(`\n[${i + 1}/${totalBatches}] 🎨 Processing batch: ${batchArtists.length} artists`);
        
        for (const artist of batchArtists) {
            await updateArtistSearchTokens(artist);
            state.processed++;
        }
        
        // Progress update
        const progress = ((i + 1) / totalBatches * 100).toFixed(1);
        console.log(`📈 Progress: ${progress}% (${state.updated} updated, ${state.skipped} skipped, ${state.errors} errors)`);
        
        // Delay between batches
        if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, config.processing.delayBetweenBatches));
        }
    }
}

/**
 * Print configuration summary
 */
function printConfig() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 LYRICTYPE SEARCH TOKEN UPDATER STARTING');
    console.log('='.repeat(60));
    console.log(`📋 Configuration:`);
    console.log(`   Collection: ${config.collection}`);
    console.log(`   Batch size: ${config.processing.batchSize}`);
    console.log(`   Delay between batches: ${config.processing.delayBetweenBatches}ms`);
    console.log(`   Max tokens per artist: ${config.processing.maxTokens}`);
    console.log(`   Dry run: ${config.processing.dryRun}`);
    
    if (config.filtering.singleArtist) {
        console.log(`   Single artist filter: "${config.filtering.singleArtist}"`);
    }
    
    if (config.filtering.startLetter || config.filtering.endLetter) {
        const start = config.filtering.startLetter?.toUpperCase() || 'A';
        const end = config.filtering.endLetter?.toUpperCase() || 'Z';
        console.log(`   Letter filter: ${start}-${end}`);
    }
    
    if (config.filtering.maxArtists) {
        console.log(`   Max artists: ${config.filtering.maxArtists}`);
    }
    
    if (config.processing.dryRun) {
        console.log('   ⚠️  DRY RUN MODE: No data will be updated');
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
Usage: node add-search-tokens.js [options]

Options:
  --single-artist <name>      Process only this specific artist (for testing)
  --start-letter <letter>     Only process artists starting with this letter (a-z)
  --end-letter <letter>       Only process artists up to this letter (a-z)
  --max-artists <number>      Limit number of artists to process (for testing)
  --dry-run                   Don't actually update, just show what would be done
  --emulator                  Use local Firestore emulator (requires firebase emulators:start)
  --help, -h                  Show this help message

Examples:
  node add-search-tokens.js --single-artist "kendrick lamar"  # Test with one artist
  node add-search-tokens.js --max-artists 10 --dry-run        # Test with 10 artists
  node add-search-tokens.js --start-letter n --end-letter z   # Update artists N-Z
  node add-search-tokens.js --dry-run                         # Preview all updates
            `);
            return;
        }
        
        // Parse CLI arguments
        const singleArtistIndex = process.argv.indexOf('--single-artist');
        if (singleArtistIndex !== -1 && process.argv[singleArtistIndex + 1]) {
            config.filtering.singleArtist = process.argv[singleArtistIndex + 1];
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
            console.log('🧪 DRY RUN MODE: No data will be updated');
        }
        
        if (process.argv.includes('--emulator')) {
            process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
            console.log('🧪 EMULATOR MODE: Using local Firestore emulator');
        }
        
        // Initialize Firebase
        await initializeFirebase();
        
        // Fetch all artists
        const artists = await fetchAllArtists();
        
        if (artists.length === 0) {
            console.log('⚠️  No artists found in Firestore');
            return;
        }
        
        // Process artists
        await processArtists(artists);
        
        // Final summary
        const totalTime = Date.now() - state.startTime;
        console.log(`\n${'='.repeat(60)}`);
        console.log('🎉 SEARCH TOKEN UPDATE COMPLETED!');
        console.log('='.repeat(60));
        console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`);
        console.log(`📊 Final stats:`);
        console.log(`   Artists processed: ${state.processed}`);
        console.log(`   Artists updated: ${state.updated}`);
        console.log(`   Artists skipped: ${state.skipped} (already had tokens)`);
        console.log(`   Errors: ${state.errors}`);
        if (config.processing.dryRun) {
            console.log(`   ⚠️  DRY RUN: No actual data was updated`);
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
    console.log(`   Artists processed: ${state.processed}`);
    console.log(`   Artists updated: ${state.updated}`);
    console.log(`   Artists skipped: ${state.skipped}`);
    console.log(`   Errors: ${state.errors}`);
    process.exit(0);
});

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
