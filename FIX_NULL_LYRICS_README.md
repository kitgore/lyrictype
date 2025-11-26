# Fix Null Lyrics Bulk Scraper

This utility script scans your songs collection for songs with null or invalid lyrics and attempts to rescrape them from Genius.

## Installation

Make sure you have the required dependencies:

```bash
npm install
```

The script requires:
- `firebase` (already installed)
- `cheerio` (already installed)
- Node.js 18+ (for built-in `fetch`)

**Note:** The script uses the same Firebase configuration as your other scripts, so no additional Firebase setup is needed!

## Usage

### NPM Scripts (Recommended)

```bash
# Dry run to see what would be fixed
npm run fix-lyrics-dry

# Fix all songs with null lyrics
npm run fix-lyrics

# Fix only cached songs
npm run fix-lyrics-cached
```

### Direct Command Line Usage

**⚠️ WARNING:** Scanning ALL songs without filters is very slow!

**Recommended approaches (in order of speed):**

1. **Fix songs for a specific artist** (FASTEST):
```bash
node fix-null-lyrics.js --artist grace-petrie --dry-run
```

2. **Fix only cached songs** (FAST):
```bash
node fix-null-lyrics.js --check-cached-only --dry-run
```

3. **Scan limited songs** (SLOW):
```bash
node fix-null-lyrics.js --max-songs 100 --dry-run
```

### Filter by Artist (Recommended)

Fix only songs from a specific artist - this is the fastest method:
```bash
# Dry run - the script will search for the artist automatically
node fix-null-lyrics.js --artist "grace petrie" --dry-run
node fix-null-lyrics.js --artist "Grace Petrie" --dry-run
node fix-null-lyrics.js --artist grace-petrie --dry-run

# Actually fix
node fix-null-lyrics.js --artist "kendrick lamar"
```

**The script now smartly searches for artists!** You can use:
- Full name with spaces: `"Grace Petrie"` or `"Kendrick Lamar"`
- Lowercase: `"grace petrie"` or `"kendrick lamar"`
- URL slug format: `grace-petrie` or `kendrick-lamar`
- Partial names will be matched automatically

This method:
- Gets songs directly from the artist document
- No database scanning needed
- Works instantly even with large databases
- Can combine with `--check-cached-only` for cached songs only

### Check Only Cached Songs (Recommended)

Only process songs that are in artists' `cachedSongIds` arrays:
```bash
node fix-null-lyrics.js --check-cached-only
```

**This is the recommended approach** as it:
- Only checks songs that should already have lyrics
- Much faster than scanning all songs
- Avoids timeout issues on large databases
- Targets the most important songs first

### Control Processing Speed

Process songs in smaller batches:
```bash
node fix-null-lyrics.js --batch-size 5
```

Limit total number of songs to process:
```bash
node fix-null-lyrics.js --max-songs 50
```

**Note:** When scanning ALL songs (without `--artist` or `--check-cached-only`), the script defaults to a maximum of 10,000 songs to prevent runaway scans. Use `--max-songs` to adjust this limit.

### Verbose Output

See detailed information about each song:
```bash
node fix-null-lyrics.js --verbose
```

### Combine Options

```bash
node fix-null-lyrics.js --artist baby-jey --dry-run --verbose
node fix-null-lyrics.js --check-cached-only --batch-size 3 --max-songs 20
```

## What It Does

1. **Scans** the songs collection for songs with null/invalid lyrics
2. **Identifies** which songs need to be rescraped
3. **Attempts** to scrape lyrics from Genius for each song
4. **Updates** the database with successfully scraped lyrics
5. **Removes** permanently failed songs from the cached lists
6. **Reports** detailed statistics about the operation

## Null Lyrics Detection

The script considers lyrics null/invalid if they are:
- Actually `null` or `undefined`
- Empty strings or only whitespace
- The literal string `"null"` or `"undefined"`
- The string `"no lyrics found"`

## Retry Logic

- Songs are attempted up to **3 times** total
- After 3 failed attempts, songs are marked as `permanently_failed`
- Permanently failed songs are **removed from `cachedSongIds`** arrays
- Already permanently failed songs are skipped

## Rate Limiting

The script includes built-in delays:
- **1 second** between individual songs
- **2 seconds** between batches
- This prevents overwhelming the Genius servers

## Output Example

```
============================================================
🔧 BULK NULL LYRICS FIXER
============================================================

Configuration:
  Dry Run: false
  Artist Filter: All artists
  Check Cached Only: false
  Batch Size: 5
  Max Songs: Unlimited
  Verbose: false

✅ Firebase initialized successfully

🔍 Scanning for songs with null/invalid lyrics...
📊 Total songs in database: 1247

   Scanned: 1247 songs

📊 Songs with null lyrics by artist:

   Baby Jey: 12 song(s)
   Drake: 8 song(s)
   Taylor Swift: 5 song(s)

============================================================
🔧 FIXING NULL LYRICS
============================================================

Processing 25 songs in 5 batch(es) of 5

📦 Batch 1/5:

   🎤 Artist: baby-jey (3 song(s))

      🎵 Top
      ✅ Successfully scraped lyrics (1247 chars)
      
      🎵 Fantasias
      ✅ Successfully scraped lyrics (2156 chars)
      
      🎵 Another Song
      ⚠️  Failed (attempt 1/3): No lyrics containers found

...

============================================================
📊 FINAL REPORT
============================================================

⏱️  Duration: 45.2s
📊 Songs Scanned: 1247
❌ Null Lyrics Found: 25
🎤 Artists Affected: 3
⚠️  Already Permanently Failed: 2

🔧 Fixing Results:
   ✅ Fixed: 20
   ❌ Failed: 3
   ⏭️  Skipped: 0

============================================================

✅ Done!
```

## Safety Features

- **Dry Run Mode**: Test before making changes
- **Retry Tracking**: Prevents infinite retry loops
- **Error Handling**: Graceful failure without crashing
- **Progress Reporting**: Know what's happening in real-time
- **Batch Processing**: Avoid overwhelming the system

## Database Changes

### Songs Collection

For successfully scraped songs:
```javascript
{
  lyrics: "actual lyrics text...",
  lyricsScrapedAt: Date,
  scrapingStatus: "completed",
  scrapingError: null,
  scrapingAttempts: 1
}
```

For failed songs (< 3 attempts):
```javascript
{
  scrapingStatus: "failed",
  scrapingError: "error message",
  scrapingAttempts: 2
}
```

For permanently failed songs (≥ 3 attempts):
```javascript
{
  scrapingStatus: "permanently_failed",
  scrapingError: "error message",
  scrapingAttempts: 3
}
```

### Artists Collection

For successfully scraped songs:
- Song ID added to `cachedSongIds` array
- `lyricsScraped` counter incremented

For permanently failed songs:
- Song ID removed from `cachedSongIds` array
- `lyricsScraped` counter decremented

## Troubleshooting

### "Artist not found"

**Cause:** The artist doesn't exist in your database, or the search term doesn't match.

**Solutions:**
1. Try different name formats:
   ```bash
   node fix-null-lyrics.js --artist "grace petrie" --dry-run
   node fix-null-lyrics.js --artist "Grace Petrie" --dry-run
   node fix-null-lyrics.js --artist grace-petrie --dry-run
   ```

2. The script will search using:
   - Exact document ID match
   - Search tokens (for flexible name matching)
   - Partial name matches

3. Check if the artist exists in Firebase Console → Firestore → artists collection

4. Make sure you've uploaded the artist data first using the uploader scripts

### "The datastore operation timed out" (deadline-exceeded)

**Cause:** The script tried to fetch too many songs at once from Firestore.

**Solution:** Use the `--check-cached-only` flag:
```bash
node fix-null-lyrics.js --check-cached-only --dry-run
```

This targets only songs in `cachedSongIds` arrays (songs that should have lyrics) and fetches them one at a time instead of all at once, avoiding timeouts.

### "No lyrics containers found"

This usually means:
1. The song is instrumental (no lyrics)
2. Genius changed their HTML structure
3. The song page structure is unusual

These songs will retry up to 3 times, then be marked as permanently failed.

### "Max retries exceeded"

The song has failed 3 times and is now marked as permanently failed. It will be removed from cached lists automatically.

### Rate Limiting Errors

If you see HTTP 429 errors, the script is hitting Genius too fast. Try:
- Reducing `--batch-size` to 3 or less
- Increasing delays in the script code
- Running in smaller chunks with `--max-songs`

### Firebase Connection Issues

The script uses the same Firebase configuration as your other scripts (`firebase-uploader.js`, etc.). If those work, this will too!

If you encounter connection issues:
1. Check that your Firebase config in `src/lib/services/initFirebase.js` is correct
2. Verify your network connection is stable
3. Ensure you have proper Firestore permissions

## Monitoring the System

After running the script, you can verify the results:

1. Check Firebase Console → Firestore → songs collection
2. Look for updated `lyricsScrapedAt` timestamps
3. Verify `scrapingStatus` fields are set correctly
4. Check artists' `cachedSongIds` arrays have been updated

## Best Practices

1. **Always do a dry run first** to see what will be affected
2. **Start with a single artist** to test the process
3. **Use --check-cached-only** to prioritize songs that should already be cached
4. **Monitor the logs** for unusual patterns or errors
5. **Run during off-peak hours** if processing many songs

## Integration with Main System

This script works seamlessly with the automatic null lyrics handling system. After running this script:

- Songs with valid lyrics will load normally
- Failed songs won't appear in cached lists
- The system will self-heal any newly discovered null lyrics
- Users won't encounter broken songs

## Future Enhancements

Potential improvements:
- Parallel processing with concurrency limits
- Resume functionality for interrupted runs
- Export detailed reports to CSV/JSON
- Integration with monitoring/alerting systems
- Automatic scheduling (cron job)

