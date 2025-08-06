// Test the completely rewritten scraping function by re-scraping the problematic songs
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, deleteField, getDoc } from 'firebase/firestore';
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

// The songs that had issues from your Firestore screenshots
const problematicSongs = [
  {
    id: 'test-jpegmafia-1',
    title: '1539 N. Calvert',
    artist: 'JPEGMAFIA',
    artistUrlKey: 'Jpegmafia',
    expectedContent: 'Should have full lyrics starting from the beginning, no <i> tags, no section headers'
  },
  {
    id: 'test-kendrick-1', 
    title: 'HUMBLE.',
    artist: 'Kendrick Lamar',
    artistUrlKey: 'Kendrick-lamar',
    expectedContent: 'Should have complete HUMBLE. lyrics, not just partial'
  },
  {
    id: 'test-drake-1',
    title: 'God\'s Plan',
    artist: 'Drake', 
    artistUrlKey: 'Drake',
    expectedContent: 'Should have full lyrics without [Intro], [Verse 1], [Chorus] headers'
  }
];

async function testFixedScrapingFinal() {
  console.log('🔧 TESTING COMPLETELY REWRITTEN SCRAPING FUNCTION');
  console.log('='.repeat(60));
  
  const scrapeSongLyrics = httpsCallable(functions, 'scrapeSongLyrics');
  
  for (const song of problematicSongs) {
    console.log(`\n🎵 RE-TESTING: ${song.artist} - "${song.title}"`);
    console.log('='.repeat(45));
    console.log(`Expected: ${song.expectedContent}`);
    console.log('-'.repeat(45));
    
    try {
      // Step 1: Clear existing lyrics data to force fresh scraping
      console.log('🗑️  Step 1: Clearing old lyrics data...');
      const songRef = doc(db, 'songs', song.id);
      
      await updateDoc(songRef, {
        lyrics: deleteField(),
        lyricsScrapedAt: deleteField(),
        scrapingStatus: 'pending',
        scrapingError: deleteField()
      });
      
      console.log('✅ Old lyrics data cleared');
      
      // Step 2: Trigger fresh scraping with updated function
      console.log('🔍 Step 2: Triggering fresh scraping with new function...');
      const result = await scrapeSongLyrics({
        artistUrlKey: song.artistUrlKey,
        songIds: [song.id]
      });
      
      console.log('✅ Scraping completed');
      console.log(`Result: ${JSON.stringify(result.data, null, 2)}`);
      
      // Step 3: Verify the improved lyrics
      console.log('🔍 Step 3: Verifying improved lyrics...');
      const updatedSongSnap = await getDoc(songRef);
      
      if (updatedSongSnap.exists()) {
        const songData = updatedSongSnap.data();
        
        if (songData.lyrics) {
          console.log('✅ SUCCESS: Lyrics scraped with new function!');
          console.log(`📊 Lyrics length: ${songData.lyrics.length} characters`);
          console.log(`📊 Lines: ${songData.lyrics.split('\n').length}`);
          
          // Quality checks
          const hasHtmlTags = songData.lyrics.includes('<i>') || songData.lyrics.includes('<em>');
          const hasSectionHeaders = songData.lyrics.match(/^\[.*\]$/m) || 
                                   songData.lyrics.match(/^(Intro|Verse|Chorus|Bridge)/m);
          const hasAnnotations = songData.lyrics.includes('Read More') || 
                                songData.lyrics.includes('interview') ||
                                songData.lyrics.includes('described how');
          
          console.log('\n🔍 QUALITY CHECKS:');
          console.log(`   HTML tags (should be NO): ${hasHtmlTags ? '❌ FOUND' : '✅ CLEAN'}`);
          console.log(`   Section headers (should be NO): ${hasSectionHeaders ? '❌ FOUND' : '✅ CLEAN'}`);
          console.log(`   Annotation text (should be NO): ${hasAnnotations ? '❌ FOUND' : '✅ CLEAN'}`);
          
          // Show first 300 characters
          console.log('\n📄 FIRST 300 CHARACTERS:');
          console.log('─'.repeat(50));
          console.log(songData.lyrics.substring(0, 300) + (songData.lyrics.length > 300 ? '...' : ''));
          console.log('─'.repeat(50));
          
          // Overall assessment
          if (!hasHtmlTags && !hasSectionHeaders && !hasAnnotations) {
            console.log('🎉 PERFECT: All quality checks passed!');
          } else {
            console.log('⚠️  ISSUES: Some quality checks failed');
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
  
  console.log('\n🎉 All re-scraping tests completed!');
  console.log('\n💡 Check the results above to see if the issues have been fixed.');
}

// Run the test
testFixedScrapingFinal().catch(console.error);