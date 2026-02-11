# Null Lyrics Handling Implementation

## Problem
Some songs that were prescraped have null or empty lyrics in the database but were still added to the artist's `cachedSongIds` array. This caused them to be treated as "cached" when they actually had no lyrics, leading to failed song loads and poor user experience.

## Solution Implemented

### 1. Backend Changes (functions/index.js)

#### A. Added `removeSongFromCachedList()` Helper Function
- Removes songs from an artist's `cachedSongIds` array
- Decrements the `lyricsScraped` counter
- Called automatically when songs permanently fail scraping

#### B. Enhanced `scrapeSongLyricsCore()` Function
**Changes:**
- **Null Lyrics Detection**: Now checks if lyrics are truly valid, not just truthy
  - Checks for `null`, empty strings, and literal strings "null" or "undefined"
  - Songs with invalid lyrics are no longer skipped - they're rescraped
  
- **Retry Logic**: Increased max attempts from 2 to 3
  - Songs that exceed 3 attempts are marked as `permanently_failed`
  - Permanently failed songs are automatically removed from `cachedSongIds`
  
- **Better Error Handling**:
  - Tracks attempt counts accurately
  - Differentiates between retryable failures and permanent failures
  - Provides detailed error logging with artist mismatch detection

#### C. Enhanced `loadStartingFromIdCore()` Function
**Changes:**
- **Validates "Cached" Songs**: No longer trusts the `cachedSongIds` array blindly
  - Checks each "cached" song to verify it actually has valid lyrics
  - Songs in `cachedSongIds` with null lyrics are added to `songsNeedingLyrics`
  - These songs will be automatically rescraped when loaded

### 2. Frontend Changes (src/lib/services/queueManager.js)

#### A. Enhanced `tryLoadSongDirectly()` Method
**Changes:**
- Added comprehensive lyrics validation before returning a song
- Checks for null, empty strings, and literal "null"/"undefined" strings
- Forces fallback to navigation loader (which triggers scraping) if lyrics are invalid
- Provides warning logs when null lyrics are detected

#### B. Enhanced `loadSongAtIndex()` Method
**Changes:**
- Validates lyrics quality for all loaded songs
- Updates song metadata to reflect actual lyrics status
- Sets `hasValidLyrics` flag accurately
- Prevents songs with null lyrics from being treated as "cached"

## How It Works

### Flow for Songs with Null Lyrics:

1. **User navigates to a song** that's in `cachedSongIds` but has null lyrics

2. **tryLoadSongDirectly()** detects the null lyrics and returns `null`

3. **System falls back to loadSongsForNavigation()** which calls the backend

4. **loadStartingFromIdCore()** checks the song and finds null lyrics

5. **Song is added to songsNeedingLyrics** and sent to `scrapeSongLyricsCore()`

6. **Scraping attempt**:
   - **Success**: Lyrics are scraped, saved, and song is added to `cachedSongIds`
   - **Failure (< 3 attempts)**: Marked as `failed`, can be retried later
   - **Failure (≥ 3 attempts)**: Marked as `permanently_failed` and removed from `cachedSongIds`

7. **Song is returned to user** with valid lyrics or error message

### Automatic Cleanup

Songs that fail scraping 3 times are automatically:
1. Marked with `scrapingStatus: 'permanently_failed'`
2. Removed from the artist's `cachedSongIds` array
3. Have their `lyricsScraped` count decremented on the artist document

This prevents them from being treated as "cached" in the future and cluttering the cache.

## Key Benefits

1. **Self-Healing**: Songs with null lyrics are automatically detected and rescraped
2. **No More Stuck Songs**: Songs that can't be scraped are removed from cache after 3 attempts
3. **Accurate Cache Status**: The `cachedSongIds` array now truly represents songs with valid lyrics
4. **Better User Experience**: Users won't encounter blank/null lyrics for "cached" songs
5. **Detailed Logging**: Better visibility into scraping issues and null lyrics detection

## Configuration

- **Max Scraping Attempts**: 3 (can be adjusted in `scrapeSongLyricsCore`)
- **Lyrics Validation**: Checks for null, empty, "null", and "undefined" strings
- **Automatic Cleanup**: Enabled by default

## Bulk Scraper Utility

A bulk scraper utility has been created to proactively fix all songs with null lyrics across your entire database!

### Location
- **Script**: `fix-null-lyrics.js`
- **Documentation**: `FIX_NULL_LYRICS_README.md`

### Quick Start

```bash
# Dry run to see what would be fixed
node fix-null-lyrics.js --dry-run

# Fix all songs with null lyrics
node fix-null-lyrics.js

# Fix only songs from a specific artist
node fix-null-lyrics.js --artist baby-jey

# Fix only songs that are supposed to be cached
node fix-null-lyrics.js --check-cached-only
```

### Features

- ✅ Scans entire songs collection for null/invalid lyrics
- ✅ Automatically scrapes lyrics from Genius
- ✅ Updates database with valid lyrics
- ✅ Removes permanently failed songs from cached lists
- ✅ Detailed progress reporting and statistics
- ✅ Dry-run mode for safe testing
- ✅ Filter by artist or cached songs only
- ✅ Rate limiting to avoid overwhelming Genius
- ✅ Batch processing for efficiency

### How It Works

1. Scans all songs (or filtered subset) for null/invalid lyrics
2. Groups songs by artist for efficient processing
3. Attempts to scrape lyrics from Genius for each song
4. Updates songs with scraped lyrics or marks as permanently failed
5. Updates artists' `cachedSongIds` arrays accordingly
6. Generates detailed report with statistics

See `FIX_NULL_LYRICS_README.md` for complete documentation.

## Testing Recommendations

1. **Test with Known Null Songs**: Find a song with null lyrics and try to play it
2. **Test Retry Logic**: Temporarily set max attempts to 1 and verify cleanup works
3. **Monitor Logs**: Check Firebase Functions logs for null lyrics detection messages
4. **Verify Cache Cleanup**: Check that `cachedSongIds` array shrinks after permanent failures

## Monitoring

Look for these log messages:
- `⚠️ Song {id} is in cached list but has null/invalid lyrics, will rescrape`
- `🔄 Song {id} has null/invalid lyrics, attempting to rescrape`
- `⚠️ Song {id} failed after {n} attempts, removing from cached list`
- `🗑️ Removing song {id} from {artist}'s cached songs list`

