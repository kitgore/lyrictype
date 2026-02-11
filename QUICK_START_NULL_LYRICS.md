# Quick Start: Null Lyrics Handling

This guide shows you how to use the new null lyrics handling system that was just implemented.

## What Was Implemented

✅ **Automatic Detection** - System detects songs with null/invalid lyrics  
✅ **Auto-Rescraping** - Attempts to rescrape null lyrics from Genius (up to 3 times)  
✅ **Smart Cleanup** - Removes permanently failed songs from cached lists  
✅ **Bulk Scraper** - Utility to fix all null lyrics in your database  
✅ **Self-Healing** - System fixes null lyrics as users encounter them  

## For Immediate Use: Bulk Fix All Null Lyrics

### Step 1: Dry Run on Cached Songs (Recommended)

```bash
npm run fix-lyrics-cached -- --dry-run
```

This will quickly scan only your cached songs and show you:
- How many cached songs have null lyrics
- Which artists are affected
- What would be fixed

**Why cached-only first?** It's much faster (checks only songs that should have lyrics) and avoids timeouts on large databases.

### Step 2: Fix Cached Songs with Null Lyrics

```bash
npm run fix-lyrics-cached
```

This will:
- Check only songs in your `cachedSongIds` arrays (much faster!)
- Scrape lyrics from Genius for songs with null lyrics
- Update the database with valid lyrics
- Remove songs that can't be scraped after 3 attempts
- Show detailed progress and statistics

### Step 3: (Optional) Fix All Songs

If you need to scan ALL songs (not just cached ones), use:

```bash
npm run fix-lyrics
```

**Note:** This can be slow for large databases and may timeout. The `--check-cached-only` approach is recommended.

## For Specific Artists (Recommended)

Fix null lyrics for a single artist (much faster than scanning all songs):

```bash
# Dry run for specific artist - try any of these formats!
node fix-null-lyrics.js --artist "grace petrie" --dry-run
node fix-null-lyrics.js --artist "Grace Petrie" --dry-run  
node fix-null-lyrics.js --artist grace-petrie --dry-run

# Fix for specific artist
node fix-null-lyrics.js --artist "kendrick lamar"
node fix-null-lyrics.js --artist "Kendrick Lamar"
```

**Smart artist search!** The script will find artists using:
- Full name with spaces: `"Grace Petrie"` 
- Lowercase names: `"grace petrie"`
- URL slug format: `grace-petrie`
- Partial matches work too!

The artist filter:
- ✅ Gets the artist's songs directly (no scanning needed!)
- ✅ Works even without `--check-cached-only`
- ✅ Much faster and more efficient
- ✅ No timeout issues

## Advanced Options

Process songs in smaller batches (slower but safer):
```bash
node fix-null-lyrics.js --batch-size 3
```

Limit how many songs to process:
```bash
node fix-null-lyrics.js --max-songs 20
```

See detailed info about each song:
```bash
node fix-null-lyrics.js --verbose
```

Combine options:
```bash
node fix-null-lyrics.js --artist drake --batch-size 5 --verbose
```

## How the Automatic System Works

Once you've run the bulk fixer, the system will also handle null lyrics automatically:

### When a User Encounters a Song with Null Lyrics:

1. **Detection**: Frontend/backend detects the null lyrics
2. **Automatic Rescrape**: System attempts to scrape from Genius
3. **Success**: Lyrics are saved and added to cache
4. **Failure**: After 3 attempts, song is removed from cached list

### No Manual Intervention Needed!

The system is now self-healing. Any null lyrics discovered will be:
- Automatically detected
- Attempted to be rescraped
- Removed from cache if permanently failed

## Monitoring

### Check Firebase Console

1. Go to Firestore → `songs` collection
2. Look for songs with:
   - `scrapingStatus: 'completed'` ✅ Good
   - `scrapingStatus: 'failed'` ⚠️ Will retry
   - `scrapingStatus: 'permanently_failed'` ❌ Can't be fixed

### Check Logs

Look for these messages in your logs:
- `⚠️ Song {id} has null/invalid lyrics, will rescrape`
- `✅ Successfully scraped lyrics`
- `🗑️ Removing song from cached list`

## What Gets Fixed

The system considers lyrics null/invalid if they are:
- Actually `null` or `undefined`
- Empty strings
- The literal string `"null"` or `"undefined"`
- Too short (< 10 characters)

## Safety Features

- **Dry Run Mode**: Test before making changes
- **Retry Limits**: Max 3 attempts per song
- **Rate Limiting**: Delays between requests to avoid overloading Genius
- **Batch Processing**: Processes in manageable chunks
- **Error Handling**: Graceful failures without crashing

## Results You Can Expect

After running the bulk fixer:

```
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
```

## Troubleshooting

### "No lyrics containers found"
Song is likely instrumental or Genius structure changed. Will be marked as permanently failed after 3 attempts.

### "Max retries exceeded"
Song has failed 3 times and is removed from cache. This is expected for instrumental tracks.

### Rate limiting errors
Reduce batch size: `--batch-size 3`

## Next Steps

1. **Run the bulk fixer** to clean up existing null lyrics
2. **Monitor your logs** for any new null lyrics detected
3. **Check Firebase** occasionally to verify the system is working
4. **Enjoy** knowing your lyrics database is self-healing!

## Documentation

- **Implementation Details**: `NULL_LYRICS_HANDLING.md`
- **Bulk Scraper Guide**: `FIX_NULL_LYRICS_README.md`
- **This Guide**: `QUICK_START_NULL_LYRICS.md`

## Summary

You now have a complete null lyrics handling system:

1. ✅ Automatic detection in frontend and backend
2. ✅ Auto-rescraping when null lyrics are encountered
3. ✅ Smart cleanup of permanently failed songs
4. ✅ Bulk utility to fix all existing null lyrics
5. ✅ Self-healing system for future issues

Run `npm run fix-lyrics-dry` to get started!

