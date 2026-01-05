# Song Caching Strategy Implementation Plan

## **Overview**

This document outlines the comprehensive redesign of the song fetching and caching system for the LyricType application. The new system introduces systematic caching of song metadata and lyrics to improve performance, user experience, and reduce API calls to Genius.

## **Current vs. New System**

### **Current System (Legacy)**
- Random song selection with immediate lyrics scraping
- No systematic caching of songs
- Single song fetching per request
- High API usage and latency

### **New System (Target)**
- Popularity-ordered song lists cached in Firestore
- Systematic song metadata and lyrics caching
- Smart queue management with preloading
- Efficient batch operations and reduced API calls

## **Database Schema Design**

### **Enhanced Artist Document Structure**
```javascript
// Collection: artists
// Document ID: artist-url-slug (existing pattern)
{
  // === EXISTING FIELDS (preserve all) ===
  name: "Artist Name",
  url: "https://genius.com/artists/artist-slug", 
  geniusId: "123456",
  type: "popular" | "regular",
  searchTokens: ["array", "of", "tokens"],
  nameForSorting: "artist name",
  uploadedAt: "2025-01-01T00:00:00.000Z",
  firstLetter: "a",

  // === NEW FIELDS ===
  songIds: [1234567, 2345678, 3456789, ...], // Ordered by popularity (max 1000)
  cachedSongIds: [1234567, 2345678, ...], // Subset of songIds that have lyrics cached
  songsLastUpdated: Date, // When songIds array was last refreshed
  totalSongs: 245, // Total songs available from Genius API
  songsFetched: 50,  // How many song metadata records we've stored
  lyricsScraped: 12, // How many songs have lyrics successfully scraped
  isFullyCached: false, // Whether all available songs have metadata cached
  cacheVersion: 1 // For future schema migrations
}
```

**Key Design Decisions:**
- `songIds`: Maintains popularity order as returned by Genius API
- `cachedSongIds`: Enables client to know which songs have lyrics without checking individual song documents
- Cache refresh trigger: 1 week since `songsLastUpdated`

### **Songs Collection Structure**
```javascript
// Collection: songs  
// Document ID: song-genius-id (e.g., "1234567")
{
  // === SONG METADATA (from Genius API) ===
  title: "Song Title",
  url: "https://genius.com/artist-song-url",
  songArtImageUrl: "https://...",
  artistNames: "Artist Name, Feature Artist",
  primaryArtist: {
    id: 123456,
    name: "Artist Name", 
    url: "https://genius.com/artists/artist-slug"
  },
  
  // === LYRICS DATA (populated separately) ===
  lyrics: "Four lines of lyrics...", // null until scraped
  lyricsScrapedAt: Date, // null until scraped
  scrapingAttempts: 0, // Track retry attempts
  scrapingError: null, // Error message if scraping failed permanently
  
  // === METADATA ===
  addedAt: Date,
  scrapingStatus: "pending" | "scraping" | "completed" | "failed"
}
```

**Multi-Artist Handling:**
- Songs belong to multiple artists but stored once with primary artist
- Popularity ranking stored only in artist documents (not in song)
- Lyrics are shared across all artists featuring the song

## **Backend Function Architecture**

### **1. Song Metadata Population**

#### **`getSongsByArtist(artistId, page, urlKey)`**
```javascript
// Fetches song metadata from Genius API (50 songs per page)
// Stores song documents in Firestore songs collection
// Updates artist document with new songIds
```

**Process:**
1. Fetch songs from Genius API: `/artists/{artistId}/songs?per_page=50&page={page}&sort=popularity`
2. For each song, create document in `songs` collection (if doesn't exist)
3. Update artist document:
   - Append new song IDs to `songIds` array
   - Update `songsFetched`, `totalSongs`, `songsLastUpdated`
   - Set `isFullyCached` if no more songs available

#### **`populateArtistSongs(artistUrlKey)`**
```javascript
// Orchestrates fetching all songs for an artist (max 1000)
// Called when client finds empty songIds array
```

**Process:**
1. Get artist document by URL key
2. Check if refresh needed (songsLastUpdated > 1 week ago)
3. Iteratively call `getSongsByArtist` until all songs fetched or 1000 limit reached
4. Return progress updates to client

### **2. Lyrics Scraping**

#### **`scrapeSongLyrics(songIds)`**
```javascript
// Scrapes lyrics for specified songs using existing scraping logic
// Batch operation for efficiency
```

**Process:**
1. For each songId:
   - Get song document from Firestore
   - Skip if already has lyrics or failed permanently
   - Set status to "scraping"
   - Use existing lyrics scraping logic from `getSongsById`
   - Update song document with lyrics or error status
   - Update artist's `cachedSongIds` and `lyricsScraped` count

**Error Handling:**
- Retry failed scraping up to 2 times
- After 2 failures, mark as `scrapingStatus: "failed"`
- Store error message for debugging

### **3. Smart Queue Loading**

#### **`loadStartingFromId(songId, shouldReverse, artistUrlKey)`**
```javascript
// Intelligently loads songs around a specific position in the queue
// Handles forward/backward navigation efficiently
```

**Process:**
1. Get artist document and find position of `songId` in `songIds` array
2. Determine target range:
   - Forward: next 10 songs from position
   - Reverse: previous 10 songs from position
3. Check which songs in range need lyrics (not in `cachedSongIds`)
4. Call `scrapeSongLyrics` for missing songs
5. Return loaded songs and queue position

## **Client-Side Integration**

### **Enhanced Artist Service Functions**

#### **`getArtistWithSongs(artistUrlKey)`**
```javascript
// Primary function for initializing artist with song queue
export async function getArtistWithSongs(artistUrlKey) {
  // 1. Get artist document from Firestore
  // 2. Check if songIds populated and current (< 1 week old)
  // 3. If empty/stale, call populateArtistSongs function
  // 4. Return artist data with songIds array
}
```

#### **`getSongsByIds(songIds)`**
```javascript
// Batch fetch song documents by their IDs
export async function getSongsByIds(songIds) {
  // 1. Query songs collection with 'in' filter for songIds
  // 2. Return map of songId -> song data
  // 3. Handle Firestore 'in' query limit (10 items) with batching
}
```

#### **`ensureSongsLoaded(songIds, artistUrlKey)`**
```javascript
// Ensures specified songs have lyrics cached
export async function ensureSongsLoaded(songIds, artistUrlKey) {
  // 1. Get artist document to check cachedSongIds
  // 2. Filter out already cached songs
  // 3. Call scrapeSongLyrics for remaining songs
  // 4. Wait for completion and return updated songs
}
```

### **Queue Management**

#### **Queue Creation Process**
1. **Artist Selection**: Call `getArtistWithSongs(artistUrlKey)`
2. **Queue Generation**: Create queue from `songIds` array (shuffle if needed)
3. **Initial Load**: Check if first 5 songs in queue have lyrics
4. **Preload**: If any missing, load first 10 unscraped songs

#### **Playback Navigation**
1. **Next Song**: 
   - Move to next in queue
   - Check next 5 songs for lyrics
   - If any missing, load next 10 unscraped songs in background
2. **Previous Song**:
   - Move to previous in queue  
   - If not loaded, call `loadStartingFromId` with `shouldReverse: true`
3. **Jump in Queue**:
   - Update queue position
   - Call `loadStartingFromId` for new position
   - Keep existing scraper running for original position

## **Implementation Phases**

### **Phase 1: Backend Foundation**
**Target: Core caching infrastructure**

1. **Database Schema Updates**
   - Add new fields to artist documents
   - Create songs collection with proper indexes
   - Test with a few artists manually

2. **Core Functions**
   - Implement `getSongsByArtist` function
   - Create `populateArtistSongs` function  
   - Test song metadata population

3. **Validation**
   - Verify song documents created correctly
   - Test artist document updates
   - Confirm pagination works for large artists

### **Phase 2: Lyrics Caching System**
**Target: Efficient lyrics scraping and storage**

1. **Scraping Function**
   - Refactor existing lyrics logic into `scrapeSongLyrics`
   - Add error handling and retry logic
   - Test with various song types

2. **Smart Loading**
   - Implement `loadStartingFromId` function
   - Test forward/backward loading
   - Verify queue position tracking

3. **Integration Testing**
   - Test complete flow: metadata → lyrics → client access
   - Verify multi-artist song handling
   - Test error scenarios

### **Phase 3: Client Integration**
**Target: Seamless client experience**

1. **Service Layer**
   - Update `artistService.js` with new functions
   - Create queue management utilities
   - Add loading state management

2. **Component Updates**
   - Modify artist search to use new system
   - Update queue display for cached songs
   - Add loading indicators for scraping

3. **User Experience**
   - Implement smart preloading
   - Add queue position jumping
   - Handle edge cases gracefully

### **Phase 4: Optimization & Migration**
**Target: Production readiness**

1. **Performance Optimization**
   - Add indexes for efficient queries
   - Optimize batch operations
   - Implement connection pooling

2. **Migration Strategy**
   - Feature flag for old/new system
   - Gradual rollout to users
   - Monitor performance metrics

3. **Error Monitoring**
   - Add comprehensive logging
   - Monitor scraping success rates
   - Track API rate limiting

## **Technical Considerations**

### **Firestore Optimization**
- **Batch Operations**: Use `writeBatch` for multiple song updates
- **Indexes**: Create composite indexes for efficient queries
- **Document Size**: Monitor artist document size (1MB Firestore limit)
- **Read Optimization**: Client reads directly from Firestore (no function calls)

### **API Rate Limiting Strategy**
- **Starting Approach**: Aggressive scraping with built-in delays
- **Monitoring**: Track 429 responses from Genius API
- **Adaptive Strategy**: Increase delays if rate limited
- **Fallback**: Queue failed requests for later retry

### **Concurrent Access Handling**
- **Song Scraping**: Use document transactions for status updates
- **Artist Updates**: Handle concurrent `populateArtistSongs` calls gracefully
- **Client Coordination**: Multiple clients can trigger same scraping safely

### **Error Recovery**
- **Scraping Failures**: Retry twice, then mark as failed
- **API Outages**: Queue requests for later processing
- **Partial Failures**: Continue with available songs, retry failures

### **Cache Invalidation**
- **Artist Songs**: Refresh if `songsLastUpdated` > 1 week
- **Manual Refresh**: Admin function to force refresh popular artists
- **Version Control**: Use `cacheVersion` for future schema migrations

## **Monitoring & Metrics**

### **Key Performance Indicators**
- Song cache hit rate (lyrics available immediately)
- Average time to first song play
- API calls per user session
- Scraping success rate
- Queue loading performance

### **Operational Metrics**
- Total songs cached
- Artists with complete metadata
- Failed scraping attempts
- API rate limit encounters
- Database read/write operations

## **Migration & Rollback Plan**

### **Rollout Strategy**
1. **Internal Testing**: Deploy to staging with test artists
2. **Limited Beta**: Enable for 10% of users with feature flag
3. **Gradual Expansion**: Increase to 50%, then 100% based on metrics
4. **Fallback**: Keep old system available for quick rollback

### **Data Migration**
- **No Breaking Changes**: All existing artist data preserved
- **Additive Approach**: Only add new fields to artist documents
- **Backward Compatibility**: Old client code continues working

## **Future Enhancements**

### **Advanced Features**
- **Predictive Caching**: Pre-cache songs for trending artists
- **User Preferences**: Cache songs based on user listening patterns
- **Offline Support**: Download lyrics for offline use
- **Analytics Integration**: Track popular songs across all users

### **Scalability Improvements**
- **CDN Integration**: Cache album art and static assets
- **Database Sharding**: Partition songs collection by artist popularity
- **Microservices**: Separate scraping service for better scaling
- **Real-time Updates**: WebSocket connections for live scraping status 