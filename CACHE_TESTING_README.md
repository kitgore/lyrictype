# Cache System Testing Guide

This guide covers how to test the new song caching system implementation.

## **Prerequisites**

Before testing, ensure you have:

1. **Artist data in Firestore**: Run `upload-to-firestore.js` to populate the artists collection
2. **Firebase Functions deployed**: Deploy the functions to Firebase (or test locally)
3. **Valid Genius API key**: Configured in Firebase Functions environment

## **Quick Testing**

### **Option 1: Automated Test Suite**
```bash
# Run the comprehensive test suite
node test-cache-functions.js
```

The test script will:
- Automatically find a suitable test artist from your database
- Test all cache functions in logical order
- Generate detailed results and save to `test-results.json`
- Provide a comprehensive success/failure report

### **Option 2: Manual Function Testing**

You can also test individual functions using the Firebase Functions emulator or deployed functions:

```bash
# Test with a specific artist
node -e "
import('./test-cache-functions.js').then(({ CacheFunctionTester }) => {
  const tester = new CacheFunctionTester();
  // Configure with your artist
  TEST_CONFIG.testArtistUrlKey = 'your-artist-url-key';
  tester.runAllTests();
});
"
```

## **Test Functions Overview**

### **1. getArtistInfo**
- **Purpose**: Validates artist document exists and retrieves basic info
- **Tests**: Document existence, Genius ID presence, song counts
- **Expected**: Artist metadata with current cache status

### **2. populateArtistSongs** 
- **Purpose**: Tests song metadata fetching and storage
- **Tests**: Genius API integration, Firestore batch writes, artist document updates
- **Expected**: Artist document populated with songIds array, songs collection created

### **3. scrapeSongLyrics**
- **Purpose**: Tests lyrics extraction and caching
- **Tests**: Lyrics scraping, retry logic, status tracking, cachedSongIds updates
- **Expected**: Song documents updated with lyrics, artist cachedSongIds updated

### **4. loadStartingFromId**
- **Purpose**: Tests smart queue loading functionality
- **Tests**: Position finding, range calculation, selective scraping
- **Expected**: Correct song range loaded with lyrics as needed

### **5. testCacheSystem**
- **Purpose**: Comprehensive integration test
- **Tests**: Complete flow from population to scraping to loading
- **Expected**: Full cache system working end-to-end

### **6. databaseValidation**
- **Purpose**: Validates final database state
- **Tests**: Data integrity, collection existence, relationship consistency
- **Expected**: Clean database state with all references intact

## **Test Configuration**

Edit `TEST_CONFIG` in `test-cache-functions.js` to customize testing:

```javascript
const TEST_CONFIG = {
  testArtistUrlKey: 'playboi-carti', // Change to your preferred test artist
  maxSongsToTest: 3,                // Limit lyrics scraping for faster tests  
  verbose: true                     // Enable detailed logging
};
```

## **Understanding Test Results**

### **Success Indicators**
- ✅ All functions return `success: true`
- ✅ Songs collection populated with metadata
- ✅ Artist document has songIds and cachedSongIds arrays
- ✅ Lyrics successfully scraped and stored
- ✅ Smart loading works for queue navigation

### **Common Issues & Solutions**

#### **"Artist not found"**
- **Issue**: Test artist doesn't exist in database
- **Solution**: Run `upload-to-firestore.js` first, or change `testArtistUrlKey`

#### **"Artist does not have a Genius ID"**
- **Issue**: Artist document missing geniusId field
- **Solution**: Use a different artist, or manually add geniusId to test artist

#### **API Rate Limiting**
- **Issue**: Too many requests to Genius API
- **Solution**: Increase delays in functions, or test with fewer songs

#### **"Function timed out"**
- **Issue**: Function exceeded timeout limit
- **Solution**: Increase timeout in function configuration, or test smaller batches

#### **Lyrics scraping failures**
- **Issue**: Songs have invalid URLs or lyrics not found
- **Solution**: Normal behavior - some songs may not have accessible lyrics

## **Production Testing Checklist**

Before deploying to production:

- [ ] **Function Deployment**: All functions deployed successfully
- [ ] **API Key Configuration**: Genius API key properly set in Firebase
- [ ] **Database Indexes**: Firestore indexes created for efficient queries
- [ ] **Rate Limiting**: API delays configured appropriately
- [ ] **Error Handling**: Functions handle errors gracefully
- [ ] **Cache Consistency**: Artist documents and songs collection stay in sync
- [ ] **Performance**: Functions complete within timeout limits

## **Performance Benchmarks**

Expected performance (may vary based on artist and API response times):

| Function | Duration | Notes |
|----------|----------|-------|
| getArtistInfo | < 1s | Simple document read |
| populateArtistSongs | 30s - 5min | Depends on artist song count |
| scrapeSongLyrics (3 songs) | 10-30s | Depends on lyrics complexity |
| loadStartingFromId | 5-20s | Depends on songs needing scraping |
| testCacheSystem | 1-10min | Complete flow test |

## **Debugging Tips**

### **Enable Detailed Logging**
Set `verbose: true` in test config to see detailed function execution logs.

### **Check Firebase Console**
Monitor Firebase Functions logs for detailed error messages and execution traces.

### **Inspect Database State**
Use Firebase Console to manually inspect:
- Artists collection documents
- Songs collection documents  
- Document field values and arrays

### **Test Individual Songs**
Test specific song IDs to debug lyrics scraping issues:

```javascript
// Test individual song scraping
const songId = "123456";
await scrapeSongLyrics({ 
  data: { songIds: [songId], artistUrlKey: "your-artist" } 
});
```

## **Troubleshooting Specific Errors**

### **"Invalid API response structure"**
- Check Genius API key validity
- Verify artist has songs available
- Check API endpoint responses manually

### **"Document not found"**  
- Verify artist URL key matches database
- Check Firestore security rules
- Ensure proper Firebase initialization

### **"Max retries exceeded"**
- Some songs may consistently fail scraping
- This is normal behavior - mark as completed if majority succeed

### **"Permission denied"**
- Check Firestore security rules
- Verify Firebase authentication configuration
- Ensure functions have proper permissions

## **Next Steps After Testing**

Once tests pass successfully:

1. **Deploy to Production**: Deploy functions to Firebase production environment
2. **Update Client**: Modify client-side code to use new cache functions
3. **Monitor Performance**: Set up monitoring for function execution and errors
4. **Gradual Migration**: Implement feature flags for gradual rollout
5. **Documentation**: Update client documentation for new API usage

## **Support & Issues**

If you encounter issues during testing:

1. **Check Logs**: Review Firebase Functions logs for detailed error messages
2. **Verify Setup**: Ensure all prerequisites are met
3. **Test Incrementally**: Run individual test functions to isolate issues
4. **Check Database**: Manually inspect Firestore collections for data integrity

The cache system is designed to be robust and handle various edge cases. Most test failures indicate configuration issues rather than code problems. 