/**
 * Interactive Song Search by ID
 * Search for songs in Firestore by their ID
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { firebaseConfig } from './src/lib/services/initFirebase.js';
import * as readline from 'readline';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Create readline interface for interactive input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function searchSongById(songId) {
    try {
        const songIdStr = songId.toString().trim();
        
        if (!songIdStr) {
            console.log('❌ Invalid song ID\n');
            return;
        }
        
        console.log(`\n🔍 Looking up song ID: ${songIdStr}...`);
        
        const songRef = doc(db, 'songs', songIdStr);
        const songSnap = await getDoc(songRef);
        
        if (!songSnap.exists()) {
            console.log(`❌ Song not found in database\n`);
            return;
        }
        
        const songData = songSnap.data();
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`✅ SONG FOUND`);
        console.log(`${'='.repeat(80)}\n`);
        
        console.log(`ID: ${songIdStr}`);
        console.log(`Title: "${songData.title || 'Unknown'}"`);
        console.log(`Artist: ${songData.artistNames || songData.primaryArtist?.name || 'Unknown'}`);
        console.log(`URL: ${songData.url || 'N/A'}`);
        
        if (songData.albumName) {
            console.log(`Album: ${songData.albumName}`);
        }
        
        if (songData.releaseDate) {
            console.log(`Release Date: ${songData.releaseDate}`);
        }
        
        console.log(`\n📊 Metadata:`);
        console.log(`   Added: ${songData.addedAt ? (songData.addedAt.toDate ? songData.addedAt.toDate().toISOString() : songData.addedAt) : 'Unknown'}`);
        console.log(`   Views: ${songData.pageviews?.toLocaleString() || 'N/A'}`);
        
        // Check lyrics
        const hasLyrics = songData.lyrics && 
                         songData.lyrics !== 'null' && 
                         songData.lyrics !== null &&
                         typeof songData.lyrics === 'string' &&
                         songData.lyrics.trim().length > 0;
        
        console.log(`\n🎵 Lyrics Status:`);
        if (hasLyrics) {
            const lyricsLength = songData.lyrics.length;
            const wordCount = songData.lyrics.split(/\s+/).length;
            const lines = songData.lyrics.split('\n').filter(l => l.trim()).length;
            
            console.log(`   ✅ HAS LYRICS`);
            console.log(`   Length: ${lyricsLength.toLocaleString()} characters`);
            console.log(`   Words: ~${wordCount.toLocaleString()}`);
            console.log(`   Lines: ~${lines}`);
            
            if (songData.lyricsScrapedAt) {
                console.log(`   Scraped: ${songData.lyricsScrapedAt.toDate ? songData.lyricsScrapedAt.toDate().toISOString() : songData.lyricsScrapedAt}`);
            }
            
            // Show preview
            const preview = songData.lyrics.substring(0, 200).replace(/\n/g, ' ').trim();
            console.log(`\n   Preview: "${preview}${preview.length < songData.lyrics.length ? '...' : ''}"`);
        } else {
            console.log(`   ❌ NO LYRICS`);
            console.log(`   Value: ${songData.lyrics === null ? 'null' : songData.lyrics === undefined ? 'undefined' : `"${songData.lyrics}"`}`);
        }
        
        // Scraping info
        console.log(`\n🔧 Scraping Info:`);
        console.log(`   Status: ${songData.scrapingStatus || 'none'}`);
        console.log(`   Attempts: ${songData.scrapingAttempts || 0}`);
        
        if (songData.scrapingError) {
            console.log(`   Error: ${songData.scrapingError}`);
        }
        
        if (songData.scrapingDuration) {
            console.log(`   Duration: ${songData.scrapingDuration}ms`);
        }
        
        // Primary artist info
        if (songData.primaryArtist) {
            console.log(`\n👤 Primary Artist:`);
            console.log(`   Name: ${songData.primaryArtist.name}`);
            console.log(`   ID: ${songData.primaryArtist.id}`);
            console.log(`   URL: ${songData.primaryArtist.url || 'N/A'}`);
        }
        
        // Featured artists
        if (songData.featuredArtists && songData.featuredArtists.length > 0) {
            console.log(`\n🎤 Featured Artists:`);
            songData.featuredArtists.forEach((artist, index) => {
                console.log(`   ${index + 1}. ${artist.name} (ID: ${artist.id})`);
            });
        }
        
        console.log(`\n${'='.repeat(80)}\n`);
        
    } catch (error) {
        console.error(`❌ Error looking up song: ${error.message}\n`);
    }
}

async function searchMultipleSongs(songIds) {
    const ids = songIds.split(',').map(id => id.trim()).filter(id => id);
    
    if (ids.length === 0) {
        console.log('❌ No valid IDs provided\n');
        return;
    }
    
    console.log(`\n🔍 Searching for ${ids.length} song(s)...\n`);
    
    for (let i = 0; i < ids.length; i++) {
        await searchSongById(ids[i]);
        
        // Add a separator between multiple results
        if (i < ids.length - 1) {
            console.log(`\n${'─'.repeat(80)}\n`);
        }
    }
}

async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 FIRESTORE SONG SEARCH BY ID`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Enter one or more song IDs (comma-separated) to search.`);
    console.log(`Type 'exit' or 'quit' to exit.\n`);
    
    while (true) {
        try {
            const input = await question('Song ID(s): ');
            const trimmedInput = input.trim().toLowerCase();
            
            if (trimmedInput === 'exit' || trimmedInput === 'quit' || trimmedInput === 'q') {
                console.log('\n👋 Goodbye!\n');
                break;
            }
            
            if (!trimmedInput) {
                console.log('⚠️  Please enter at least one song ID\n');
                continue;
            }
            
            await searchMultipleSongs(input);
            
        } catch (error) {
            console.error(`❌ Error: ${error.message}\n`);
        }
    }
    
    rl.close();
    process.exit(0);
}

// Handle cleanup on exit
process.on('SIGINT', () => {
    console.log('\n\n👋 Goodbye!\n');
    rl.close();
    process.exit(0);
});

main().catch(error => {
    console.error('❌ Fatal error:', error);
    rl.close();
    process.exit(1);
});

