// Test the improved lyrics scraping by adding fresh songs to Firestore
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyCX53dpNUbjeJhP_CstO6yOzSe76CLbgc4",
  authDomain: "lyrictype-cdf2c.firebaseapp.com",
  projectId: "lyrictype-cdf2c",
  storageBucket: "lyrictype-cdf2c.appspot.com",
  messagingSenderId: "835790496614",
  appId: "1:835790496614:web:a87481404a0eb63104dea7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);

// Test songs from different artists to verify scraping works across various page structures
const testSongs = [
  {
    id: 'test-jpegmafia-1',
    title: '1539 N. Calvert',
    artist: 'JPEGMAFIA',
    artistUrlKey: 'Jpegmafia',
    url: 'https://genius.com/Jpegmafia-1539-n-calvert-lyrics',
    imageUrl: 'https://images.genius.com/3d9c1b1f5b9d8e6c7a2b3e4f5g6h7i8j9k0l1m2n.300x300x1.jpg'
  },
  {
    id: 'test-kendrick-1',
    title: 'HUMBLE.',
    artist: 'Kendrick Lamar',
    artistUrlKey: 'Kendrick-lamar',
    url: 'https://genius.com/Kendrick-lamar-humble-lyrics',
    imageUrl: 'https://images.genius.com/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t.300x300x1.jpg'
  },
  {
    id: 'test-drake-1',
    title: 'God\'s Plan',
    artist: 'Drake',
    artistUrlKey: 'Drake',
    url: 'https://genius.com/Drake-gods-plan-lyrics',
    imageUrl: 'https://images.genius.com/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u.300x300x1.jpg'
  }
];

async function testImprovedScrapingProduction() {
  console.log('🧪 TESTING IMPROVED LYRICS SCRAPING - PRODUCTION TEST');
  console.log('='.repeat(60));

  const scrapeSongLyrics = httpsCallable(functions, 'scrapeSongLyrics');
  
  for (const song of testSongs) {
    console.log(`\n🎵 TESTING: ${song.artist} - "${song.title}"`);
    console.log('='.repeat(40));
    
    try {
      // Step 1: Create the song document in Firestore
      console.log('📝 Step 1: Creating song document...');
      const songRef = doc(db, 'songs', song.id);
      
      await setDoc(songRef, {
        title: song.title,
        artist: song.artist,
        artistUrlKey: song.artistUrlKey,
        url: song.url,
        imageUrl: song.imageUrl,
        createdAt: new Date(),
        scrapingStatus: 'pending'
      });
      
      console.log('✅ Song document created successfully');
      
      // Step 2: Trigger the scraping function
      console.log('🔍 Step 2: Triggering lyrics scraping...');
      const result = await scrapeSongLyrics({
        artistUrlKey: song.artistUrlKey,
        songIds: [song.id]
      });
      
      console.log('✅ Scraping function completed');
      console.log(`Result: ${JSON.stringify(result.data, null, 2)}`);
      
      // Step 3: Verify the scraped lyrics
      console.log('🔍 Step 3: Verifying scraped lyrics...');
      const updatedSongSnap = await getDoc(songRef);
      
      if (updatedSongSnap.exists()) {
        const songData = updatedSongSnap.data();
        
        if (songData.lyrics) {
          console.log('✅ SUCCESS: Lyrics scraped and saved!');
          console.log(`📊 Lyrics length: ${songData.lyrics.length} characters`);
          console.log(`📊 Lines: ${songData.lyrics.split('\n').length}`);
          console.log('📄 First 200 characters:');
          console.log('─'.repeat(40));
          console.log(songData.lyrics.substring(0, 200) + '...');
          console.log('─'.repeat(40));
          
          // Check for annotation text (should be clean now)
          const hasAnnotations = songData.lyrics.includes('Read More') || 
                                songData.lyrics.includes('interview') ||
                                songData.lyrics.includes('described how') ||
                                songData.lyrics.includes('teams up with');
          
          if (hasAnnotations) {
            console.log('⚠️  WARNING: Possible annotation text detected');
          } else {
            console.log('🎉 PERFECT: Clean lyrics with no annotation text!');
          }
        } else {
          console.log('❌ FAILED: No lyrics found in the document');
        }
      } else {
        console.log('❌ FAILED: Song document not found after scraping');
      }
      
    } catch (error) {
      console.log('❌ ERROR during test:', error.message);
    }
    
    console.log('\n' + '='.repeat(60));
  }
  
  console.log('\n🎉 All scraping tests completed!');
  console.log('\n💡 To clean up test songs, you can delete them from Firestore console:');
  testSongs.forEach(song => {
    console.log(`   - /songs/${song.id}`);
  });
}

// Run the test
testImprovedScrapingProduction().catch(console.error);