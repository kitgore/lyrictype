import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp();
const db = getFirestore(app);

// Check a few songs to see their structure
async function checkSongs() {
  try {
    // Get the artist document for Demi Lovato first
    const artistDoc = await db.collection('artists').doc('Demi-lovato').get();
    if (!artistDoc.exists) {
      console.log('❌ Artist Demi-lovato not found');
      return;
    }
    
    const artistData = artistDoc.data();
    const songIds = artistData.songIds || [];
    console.log(`✅ Artist Demi-lovato has ${songIds.length} songs`);
    
    // Check the first 3 songs
    for (let i = 0; i < Math.min(3, songIds.length); i++) {
      const songId = songIds[i];
      console.log(`\n📝 Checking song ${i + 1}: ${songId}`);
      
      const songDoc = await db.collection('songs').doc(songId).get();
      if (songDoc.exists) {
        const songData = songDoc.data();
        console.log(`  Title: ${songData.title || 'N/A'}`);
        console.log(`  Has lyrics: ${!!songData.lyrics}`);
        console.log(`  Lyrics length: ${songData.lyrics ? songData.lyrics.length : 0}`);
        if (songData.lyrics) {
          console.log(`  First 100 chars: ${songData.lyrics.substring(0, 100)}`);
        } else {
          console.log(`  No lyrics found!`);
        }
      } else {
        console.log(`  ❌ Song document not found!`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSongs();
