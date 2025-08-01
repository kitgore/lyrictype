import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { getFirestore, doc, getDoc, collection, getDocs, query, limit } from 'firebase/firestore';

// Firebase configuration - same as functions
const firebaseConfig = {
  apiKey: "AIzaSyCX53dpNUbjeJhP_CstO6yOzSe76CLbgc4",
  authDomain: "lyrictype-cdf2c.firebaseapp.com", 
  projectId: "lyrictype-cdf2c",
  storageBucket: "lyrictype-cdf2c.appspot.com",
  messagingSenderId: "835790496614",
  appId: "1:835790496614:web:a87481404a0eb63104dea7",
  measurementId: "G-6N60MSG8SL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app); // This connects to production Firestore
const functions = getFunctions(app);

// Connect to the local Functions emulator
if (process.env.NODE_ENV !== 'production') {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001);
    console.log('🔧 Connected to Functions emulator at localhost:5001');
  } catch (error) {
    console.log('⚠️ Functions emulator not available, using production functions');
  }
}

// Test configuration
const TEST_CONFIG = {
  testArtistUrlKey: '0', // Use the artist we know works
  maxSongsToTest: 3,
  verbose: true
};

class CacheFunctionTester {
  constructor() {
    this.results = {
      timestamp: new Date(),
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      }
    };
    this.usingEmulator = true; // We'll assume emulator unless error
  }

  log(message, level = 'info') {
    if (TEST_CONFIG.verbose || level === 'error') {
      const timestamp = new Date().toISOString();
      const emulatorTag = this.usingEmulator ? '[EMULATOR] ' : '[PRODUCTION] ';
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${emulatorTag}${message}`);
    }
  }

  async addTestResult(testName, success, data, error = null) {
    const result = {
      test: testName,
      success,
      timestamp: new Date(),
      data: success ? data : null,
      error: error ? error.message : null
    };
    
    this.results.tests.push(result);
    this.results.summary.total++;
    
    if (success) {
      this.results.summary.passed++;
      this.log(`✅ ${testName} - PASSED`);
    } else {
      this.results.summary.failed++;
      this.log(`❌ ${testName} - FAILED: ${error?.message || 'Unknown error'}`, 'error');
    }
    
    return result;
  }

  async testGetArtistInfo() {
    this.log('Testing getArtistInfo function...');
    
    try {
      const getArtistInfo = httpsCallable(functions, 'getArtistInfo');
      const result = await getArtistInfo({ artistUrlKey: TEST_CONFIG.testArtistUrlKey });
      
      if (result.data.success) {
        this.log(`Found artist: ${result.data.artist.name}`);
        this.log(`Total songs: ${result.data.artist.totalSongs}`);
        this.log(`Cached songs: ${result.data.artist.cachedSongs}`);
        
        return await this.addTestResult('getArtistInfo', true, result.data);
      } else {
        throw new Error('Function returned success: false');
      }
    } catch (error) {
      if (error.code === 'functions/unavailable') {
        this.usingEmulator = false;
        this.log('Functions emulator not available, falling back to production', 'warn');
      }
      return await this.addTestResult('getArtistInfo', false, null, error);
    }
  }

  async testPopulateArtistSongs() {
    this.log('Testing populateArtistSongs function...');
    
    try {
      const populateArtistSongs = httpsCallable(functions, 'populateArtistSongs');
      const result = await populateArtistSongs({ artistUrlKey: TEST_CONFIG.testArtistUrlKey });
      
      if (result.data.success) {
        this.log(`Population result: ${result.data.totalSongs} total songs`);
        this.log(`New songs: ${result.data.newSongs || 'N/A'}`);
        this.log(`Fully cached: ${result.data.isFullyCached || 'N/A'}`);
        this.log(`Up to date: ${result.data.isUpToDate || false}`);
        
        return await this.addTestResult('populateArtistSongs', true, result.data);
      } else {
        throw new Error('Function returned success: false');
      }
    } catch (error) {
      return await this.addTestResult('populateArtistSongs', false, null, error);
    }
  }

  async testScrapeSongLyrics() {
    this.log('Testing scrapeSongLyrics function...');
    
    try {
      // Get artist info to find song IDs
      const artistDoc = await getDoc(doc(db, 'artists', TEST_CONFIG.testArtistUrlKey));
      if (!artistDoc.exists()) {
        throw new Error('Test artist not found in database');
      }
      
      const artistData = artistDoc.data();
      const songIds = (artistData.songIds || []).slice(0, TEST_CONFIG.maxSongsToTest);
      
      if (songIds.length === 0) {
        this.log('No songs available for testing - skipping lyrics scraping test');
        return await this.addTestResult('scrapeSongLyrics', true, { skipped: true, reason: 'No songs available' });
      }
      
      this.log(`Testing lyrics scraping with ${songIds.length} songs`);
      
      const scrapeSongLyrics = httpsCallable(functions, 'scrapeSongLyrics');
      const result = await scrapeSongLyrics({ 
        songIds: songIds,
        artistUrlKey: TEST_CONFIG.testArtistUrlKey 
      });
      
      if (result.data.success) {
        this.log(`Scraping results: ${result.data.scrapedCount} successful`);
        this.log(`Failed: ${result.data.results.failed.length}`);
        this.log(`Skipped: ${result.data.results.skipped.length}`);
        
        return await this.addTestResult('scrapeSongLyrics', true, result.data);
      } else {
        throw new Error('Function returned success: false');
      }
    } catch (error) {
      return await this.addTestResult('scrapeSongLyrics', false, null, error);
    }
  }

  async testLoadStartingFromId() {
    this.log('Testing loadStartingFromId function...');
    
    try {
      // Get artist info to find a song ID for testing
      const artistDoc = await getDoc(doc(db, 'artists', TEST_CONFIG.testArtistUrlKey));
      if (!artistDoc.exists()) {
        throw new Error('Test artist not found in database');
      }
      
      const artistData = artistDoc.data();
      const songIds = artistData.songIds || [];
      
      if (songIds.length < 5) {
        this.log('Not enough songs for testing smart loading - skipping');
        return await this.addTestResult('loadStartingFromId', true, { skipped: true, reason: 'Not enough songs' });
      }
      
      // Test with a song in the middle of the list
      const testSongId = songIds[Math.floor(songIds.length / 2)];
      this.log(`Testing smart loading from song ID: ${testSongId}`);
      
      const loadStartingFromId = httpsCallable(functions, 'loadStartingFromId');
      const result = await loadStartingFromId({
        songId: testSongId,
        artistUrlKey: TEST_CONFIG.testArtistUrlKey,
        shouldReverse: false
      });
      
      if (result.data.success) {
        this.log(`Smart loading results: position ${result.data.queuePosition}`);
        this.log(`Loaded songs: ${result.data.songsLoaded}`);
        this.log(`Songs scraped: ${result.data.songsScraped}`);
        
        return await this.addTestResult('loadStartingFromId', true, result.data);
      } else {
        throw new Error('Function returned success: false');
      }
    } catch (error) {
      return await this.addTestResult('loadStartingFromId', false, null, error);
    }
  }

  async testComprehensiveFlow() {
    this.log('Testing comprehensive cache system flow...');
    
    try {
      const testCacheSystem = httpsCallable(functions, 'testCacheSystem');
      const result = await testCacheSystem({
        artistUrlKey: TEST_CONFIG.testArtistUrlKey,
        testType: 'full'
      });
      
      if (result.data.success) {
        this.log('Comprehensive test completed successfully');
        if (result.data.testResults && result.data.testResults.steps) {
          result.data.testResults.steps.forEach(step => {
            this.log(`Step ${step.step}: ${step.success ? 'PASSED' : 'FAILED'}`);
            if (!step.success && step.error) {
              this.log(`  Error: ${step.error}`);
            }
          });
        }
        
        return await this.addTestResult('comprehensiveFlow', true, result.data);
      } else {
        // Provide detailed error information from the steps
        let errorDetails = result.data.error || 'Unknown error';
        
        if (result.data.testResults && result.data.testResults.steps) {
          const failedSteps = result.data.testResults.steps.filter(step => !step.success);
          if (failedSteps.length > 0) {
            errorDetails = `Failed steps: ${failedSteps.map(step => `${step.step} (${step.error || 'no error message'})`).join(', ')}`;
          }
          
          // Log all steps for debugging
          this.log('Comprehensive test steps:');
          result.data.testResults.steps.forEach(step => {
            this.log(`  ${step.step}: ${step.success ? 'PASSED' : 'FAILED'}`);
            if (!step.success && step.error) {
              this.log(`    Error: ${step.error}`);
            }
          });
        }
        
        throw new Error(`Comprehensive test failed: ${errorDetails}`);
      }
    } catch (error) {
      return await this.addTestResult('comprehensiveFlow', false, null, error);
    }
  }

  async validateDatabaseState() {
    this.log('Validating database state after tests...');
    
    try {
      // Check artist document
      const artistDoc = await getDoc(doc(db, 'artists', TEST_CONFIG.testArtistUrlKey));
      const artistData = artistDoc.data();
      
      // Check if songs collection has entries
      const songsQuery = query(collection(db, 'songs'), limit(5));
      const songsSnapshot = await getDocs(songsQuery);
      
      const validation = {
        artistExists: artistDoc.exists(),
        artistHasSongs: (artistData?.songIds || []).length > 0,
        artistHasCachedSongs: (artistData?.cachedSongIds || []).length > 0,
        songsCollectionExists: songsSnapshot.docs.length > 0,
        totalSongs: (artistData?.songIds || []).length,
        cachedSongs: (artistData?.cachedSongIds || []).length
      };
      
      this.log(`Artist exists: ${validation.artistExists}`);
      this.log(`Total songs in artist: ${validation.totalSongs}`);
      this.log(`Cached songs in artist: ${validation.cachedSongs}`);
      this.log(`Songs collection has data: ${validation.songsCollectionExists}`);
      
      return await this.addTestResult('databaseValidation', true, validation);
    } catch (error) {
      return await this.addTestResult('databaseValidation', false, null, error);
    }
  }

  async runAllTests() {
    this.log('🚀 Starting Cache Function Tests (with Emulator Support)');
    this.log(`Testing with artist: ${TEST_CONFIG.testArtistUrlKey}`);
    this.log('=' * 50);
    
    // Run tests in logical order
    await this.testGetArtistInfo();
    await this.testPopulateArtistSongs();
    await this.testScrapeSongLyrics();
    await this.testLoadStartingFromId();
    await this.testComprehensiveFlow();
    await this.validateDatabaseState();
    
    // Print summary
    this.log('=' * 50);
    this.log('🏁 Test Summary:');
    this.log(`Total tests: ${this.results.summary.total}`);
    this.log(`Passed: ${this.results.summary.passed}`);
    this.log(`Failed: ${this.results.summary.failed}`);
    this.log(`Success rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);
    this.log(`Using: ${this.usingEmulator ? 'Functions Emulator + Production Firestore' : 'Production Functions + Firestore'}`);
    
    if (this.results.summary.failed > 0) {
      this.log('\n❌ Failed tests:');
      this.results.tests
        .filter(test => !test.success)
        .forEach(test => {
          this.log(`  - ${test.test}: ${test.error}`);
        });
    }
    
    return this.results;
  }
}

// Main execution
async function main() {
  try {
    const tester = new CacheFunctionTester();
    const results = await tester.runAllTests();
    
    // Save results to file
    const resultsJson = JSON.stringify(results, null, 2);
    const fs = await import('fs');
    fs.writeFileSync('test-results-emulator.json', resultsJson);
    console.log('\n📄 Detailed results saved to test-results-emulator.json');
    
    // Exit with appropriate code
    process.exit(results.summary.failed === 0 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CacheFunctionTester }; 