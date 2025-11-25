/**
 * Quick Song Lookup by ID
 * Usage: node lookup-song.js <song-id> [song-id2] [song-id3] ...
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function lookupSong(songId) {
    try {
        const songIdStr = songId.toString().trim();
        
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
        
        // Check lyrics
        const hasLyrics = songData.lyrics && 
                         songData.lyrics !== 'null' && 
                         songData.lyrics !== null &&
                         typeof songData.lyrics === 'string' &&
                         songData.lyrics.trim().length > 0;
        
        console.log(`\n🎵 Lyrics:`);
        if (hasLyrics) {
            const lyricsLength = songData.lyrics.length;
            const wordCount = songData.lyrics.split(/\s+/).length;
            
            console.log(`   ✅ HAS LYRICS (${lyricsLength.toLocaleString()} chars, ~${wordCount} words)`);
            
            // Show first few lines
            const lines = songData.lyrics.split('\n').filter(l => l.trim()).slice(0, 3);
            console.log(`   First lines:`);
            lines.forEach(line => console.log(`     ${line}`));
            if (songData.lyrics.split('\n').length > 3) {
                console.log(`     ...`);
            }
        } else {
            console.log(`   ❌ NO LYRICS`);
        }
        
        console.log(`\n🔧 Status: ${songData.scrapingStatus || 'none'} (${songData.scrapingAttempts || 0} attempts)`);
        
        if (songData.scrapingError) {
            console.log(`⚠️  Error: ${songData.scrapingError}`);
        }
        
        console.log(`\n${'='.repeat(80)}\n`);
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
    }
}

async function main() {
    const songIds = process.argv.slice(2);
    
    if (songIds.length === 0) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 FIRESTORE SONG LOOKUP`);
        console.log(`${'='.repeat(80)}\n`);
        console.log(`Usage: node lookup-song.js <song-id> [song-id2] [song-id3] ...\n`);
        console.log(`Examples:`);
        console.log(`  node lookup-song.js 10000344`);
        console.log(`  node lookup-song.js 10000344 9592352 7470207\n`);
        process.exit(0);
    }
    
    console.log(`\n🔍 Searching for ${songIds.length} song(s)...`);
    
    for (let i = 0; i < songIds.length; i++) {
        await lookupSong(songIds[i]);
        
        if (i < songIds.length - 1) {
            console.log(`${'─'.repeat(80)}\n`);
        }
    }
    
    console.log(`✅ Done!\n`);
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

