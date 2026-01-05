# Artist Update System

A comprehensive, automated system for scraping, comparing, and uploading artist and song data from Genius to Firestore.

## Quick Start

### Test the System (2 minutes)
```bash
npm run test:all
```

### Full Update (30-60 minutes)
```bash
# Scrape and prepare data
npm run scrape

# Review data in scraping-data/, then upload
npm run upload
```

## Overview

This system provides a complete workflow for:
1. **Scraping** artist lists from Genius
2. **Comparing** with existing Firestore data
3. **Prescraping** songs for new artists
4. **Uploading** new artists and songs to Firestore
5. **Updating** popular artist flags

### Key Features

- ✅ **Incremental Updates**: Only processes new/changed artists
- ✅ **Safe by Default**: Dry-run mode, skip existing data
- ✅ **Testing Built-In**: `--limit` option on all scripts
- ✅ **Progress Tracking**: TUI with progress bars and ETAs
- ✅ **Workflow Timer**: Cumulative elapsed time tracked across all scripts
- ✅ **Error Handling**: Comprehensive error logging
- ✅ **Manual Control**: Each step is a separate command
- ✅ **Timestamped Data**: All data saved with timestamps
- ✅ **Search Tokens**: Automatic generation for autocomplete

### Two-Phase Workflow

The system is split into two main commands for safety:

1. **`npm run scrape`** - Data gathering phase (20-45 min)
   - Scrapes artist lists from Genius
   - Compares with Firestore to find new artists
   - Scrapes songs for new artists
   - Uploads new artist documents (with search tokens)
   - **Stops and prompts you to review data**

2. **`npm run upload`** - Data upload phase (2-6 min)
   - Uploads songs to Firestore
   - Updates popular artist flags
   
This separation allows you to:
- Review scraped data before committing to Firestore
- Catch any issues before modifying song data
- Re-run the upload phase if needed without re-scraping

## Scripts

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `scrape-artists.js` | Scrape Genius artist lists | Genius website | `artist-lists/` |
| `compare-artists.js` | Identify new artists | `artist-lists/` + Firestore | `new-artists/` |
| `prescrape-new-artists.js` | Scrape songs for new artists | `new-artists/` | `song-data/` |
| `upload-artists.js` | Upload artists to Firestore | `new-artists/` | Firestore `artists` |
| `upload-songs.js` | Upload songs to Firestore | `song-data/` | Firestore `songs` |
| `update-popular-flags.js` | Update popular flags | `new-artists/` | Firestore `artists` |

## NPM Commands

### Production Workflow

```bash
# Recommended: Two-phase workflow
npm run scrape                 # 20-45 min: Scrape, compare, prescrape, upload artists
npm run upload                 # 2-6 min: Upload songs and update flags

# Individual steps (for debugging/manual control)
npm run update:scrape          # 15-30 min: Scrape all letters
npm run update:compare         # ~1 min: Compare with Firestore
npm run update:prescrape       # 5-15 min: Scrape songs
npm run update:upload-artists  # ~1 min: Upload artists
npm run update:upload-songs    # 1-5 min: Upload songs
npm run update:update-popular  # ~1 min: Update flags
```

### Test Workflow

```bash
# Individual tests
npm run test:scrape            # 30 sec: 10 artists from letter J
npm run test:compare           # 15 sec: Compare
npm run test:prescrape         # 10 sec: 5 artists, 2 songs each
npm run test:upload-artists    # 5 sec: Dry-run 5 artists
npm run test:upload-songs      # 3 sec: Dry-run 5 songs
npm run test:update-popular    # 2 sec: Dry-run flag updates

# Full test
npm run test:all               # ~2 min: Complete workflow test
```

## Workflow Details

### Step 1: Scrape Artists

**Command**: `npm run update:scrape`  
**Script**: `scripts/scrape-artists.js`  
**Time**: 15-30 minutes (all letters)

Scrapes artist lists from Genius by letter (0, a-z), including:
- Popular artists (top 20 per letter)
- Regular artists (all others)
- Genius IDs (extracted from iOS app links)

**Output**:
```
scraping-data/artist-lists/2026-01-04-20-22/
├── artists-0.json
├── artists-a.json
├── ...
├── artists-z.json
├── summary.json
├── errors.json
└── .complete
```

**Options**:
```bash
# Specific letters
node scripts/scrape-artists.js --letters a,b,c

# Test with limited data
node scripts/scrape-artists.js --letters j --limit 10

# Skip ID extraction (faster)
node scripts/scrape-artists.js --no-ids
```

### Step 2: Compare with Firestore

**Command**: `npm run update:compare`  
**Script**: `scripts/compare-artists.js`  
**Time**: ~1 minute

Compares scraped artists with existing Firestore data to identify:
- New artists (not in Firestore)
- Popular status changes (add/remove)

**Output**:
```
scraping-data/new-artists/2026-01-04-21-01/
├── new-artists-0.json
├── new-artists-a.json
├── ...
├── new-artists-z.json
├── comparison-report.json  ← Summary of changes
├── errors.json
└── .complete
```

**Options**:
```bash
# Use specific timestamp
node scripts/compare-artists.js --date 2026-01-04-20-22

# Preview only
node scripts/compare-artists.js --dry-run
```

### Step 3: Prescrape Songs

**Command**: `npm run update:prescrape`  
**Script**: `scripts/prescrape-new-artists.js`  
**Time**: 5-15 minutes (depends on new artist count)

Scrapes songs and lyrics for newly identified artists:
- Up to 10 songs per artist (configurable)
- Full lyrics extraction
- Robust error handling with retries

**Output**:
```
scraping-data/song-data/2026-01-04-20-48/
├── songs-0.json
├── songs-a.json
├── ...
├── songs-z.json
├── prescrape-summary.json
├── errors.json
└── .complete
```

**Options**:
```bash
# Test with limited data
node scripts/prescrape-new-artists.js --limit 5 --max-songs 2

# Specific letters
node scripts/prescrape-new-artists.js --letters a,b,c

# More songs per artist
node scripts/prescrape-new-artists.js --max-songs 20
```

### Step 4: Upload Artists

**Command**: `npm run update:upload-artists`  
**Script**: `scripts/upload-artists.js`  
**Time**: ~1 minute

Uploads new artists to Firestore with:
- Search tokens for autocomplete
- Sanitized field values
- Validated slugs
- Batch processing (500 per batch)

**Options**:
```bash
# Dry run (recommended first)
node scripts/upload-artists.js --dry-run

# Test with limited data
node scripts/upload-artists.js --limit 10 --dry-run

# Overwrite existing (careful!)
node scripts/upload-artists.js --no-skip
```

### Step 5: Upload Songs

**Command**: `npm run update:upload-songs`  
**Script**: `scripts/upload-songs.js`  
**Time**: 1-5 minutes (depends on song count)

Uploads songs to Firestore with:
- Song ID extraction
- Artist slug linking
- Sanitized lyrics
- Batch processing (500 per batch)

**Options**:
```bash
# Dry run
node scripts/upload-songs.js --dry-run

# Test with limited data
node scripts/upload-songs.js --limit 10 --dry-run

# Overwrite existing
node scripts/upload-songs.js --no-skip
```

### Step 6: Update Popular Flags

**Command**: `npm run update:update-popular`  
**Script**: `scripts/update-popular-flags.js`  
**Time**: ~1 minute

Updates popular artist flags based on comparison:
- Adds popular flag to new popular artists
- Removes popular flag from artists no longer popular
- Maintains exactly 20 popular artists per letter

**Options**:
```bash
# Dry run
node scripts/update-popular-flags.js --dry-run

# Use specific comparison
node scripts/update-popular-flags.js --date 2026-01-04-21-01
```

## Data Structure

### Directory Layout

```
scraping-data/
├── artist-lists/          ← Step 1: Scraped artist lists
│   └── YYYY-MM-DD-HH-MM/
├── new-artists/           ← Step 2: Comparison results
│   └── YYYY-MM-DD-HH-MM/
├── song-data/             ← Step 3: Prescraped songs
│   └── YYYY-MM-DD-HH-MM/
└── upload-data/           ← Steps 4-6: Upload summaries
    └── YYYY-MM-DD-HH-MM/
```

### Firestore Collections

#### `artists` Collection

```javascript
// Document ID: artist-slug (e.g., "kendrick-lamar")
{
  name: "Kendrick Lamar",
  url: "https://genius.com/artists/Kendrick-lamar",
  geniusId: 1421,
  type: "popular",  // or "regular"
  isPopular: true,
  searchTokens: ["k", "ke", "ken", "kend", ...],
  nameForSorting: "kendrick lamar",
  firstLetter: "k",
  uploadedAt: "2026-01-04T21:10:00.000Z",
  updatedAt: "2026-01-04T21:20:00.000Z"
}
```

#### `songs` Collection

```javascript
// Document ID: song-slug (e.g., "kendrick-lamar-humble-lyrics")
{
  title: "HUMBLE.",
  url: "https://genius.com/Kendrick-lamar-humble-lyrics",
  artist: "Kendrick Lamar",
  artistSlug: "kendrick-lamar",
  lyrics: "Nobody pray for me...",
  uploadedAt: "2026-01-04T21:15:00.000Z",
  scrapedAt: "2026-01-04T20:48:00.000Z"
}
```

## Common Workflows

### Monthly Update

```bash
# 1. Scrape latest data (30 min)
npm run update:scrape

# 2. Compare with database (1 min)
npm run update:compare

# 3. Review comparison-report.json
cat scraping-data/new-artists/$(ls -t scraping-data/new-artists | head -1)/comparison-report.json

# 4. Prescrape songs (10 min)
npm run update:prescrape

# 5. Upload everything (5 min)
npm run update:upload-artists
npm run update:upload-songs
npm run update:update-popular
```

### Quick Test Before Production

```bash
# Test entire workflow with limited data
npm run test:all

# If successful, run production
npm run update:all
```

### Scrape Specific Letters Only

```bash
# Scrape only letters J and K
node scripts/scrape-artists.js --letters j,k

# Compare (will only process these letters)
npm run update:compare

# Prescrape only these letters
node scripts/prescrape-new-artists.js --letters j,k

# Upload
npm run update:upload-artists
npm run update:upload-songs
npm run update:update-popular
```

### Re-upload from Existing Data

```bash
# Upload from specific timestamp (no re-scraping)
node scripts/upload-artists.js --date 2026-01-04-21-01 --dry-run
node scripts/upload-songs.js --date 2026-01-04-20-48 --dry-run

# If looks good, remove --dry-run
node scripts/upload-artists.js --date 2026-01-04-21-01
node scripts/upload-songs.js --date 2026-01-04-20-48
```

## Error Handling

### Error Logging

All scripts log errors to `errors.json` files:

```json
{
  "totalErrors": 15,
  "errorsByType": {
    "network_timeout": 8,
    "invalid_slug": 5,
    "sanitization_failed": 2
  },
  "detailedErrors": [
    {
      "timestamp": "2026-01-04T20:22:15.123Z",
      "type": "network_timeout",
      "message": "Request timeout",
      "details": {
        "artist": "Artist Name",
        "url": "https://..."
      }
    }
  ]
}
```

### Handling Errors

1. **Check error counts** in summary files
2. **Review errors.json** for details
3. **Re-run specific letters** if needed
4. **Most errors are graceful** - process continues

### Common Issues

**Too many network timeouts?**
- Increase delays in script config
- Run specific letters separately
- Use `--no-ids` to skip ID extraction

**Slug extraction failures?**
- Review invalid URLs in errors.json
- Usually rare, won't affect most artists

**Upload failures?**
- Check Firestore permissions
- Verify Firebase config
- Check network connection

## Best Practices

### Safety

1. **Always test first**: `npm run test:all`
2. **Use dry-run**: `--dry-run` on upload commands
3. **Review reports**: Check comparison-report.json
4. **Check errors**: Review error counts in summaries
5. **Manual steps**: Upload is separate from scraping

### Performance

1. **Batch processing**: Default 500 items per batch
2. **Rate limiting**: Built-in delays between requests
3. **Skip existing**: Default behavior, use `--no-skip` carefully
4. **Parallel testing**: Test multiple letters at once

### Monitoring

1. **Progress bars**: Real-time status during execution
2. **Summary files**: Statistics for each run
3. **Error logs**: Categorized error tracking
4. **Timestamps**: Easy to track runs over time

## Troubleshooting

### Script fails to find latest timestamp

**Problem**: "No new-artists data found"  
**Solution**: Run the previous step first or specify `--date`

### Firestore permission denied

**Problem**: Upload fails with permission error  
**Solution**: Check Firebase config and Firestore rules

### Rate limited by Genius

**Problem**: Many 429 errors  
**Solution**: Increase delays or run specific letters

### Out of memory

**Problem**: Node runs out of memory  
**Solution**: Reduce batch size or process fewer letters

## Development

### Adding New Features

1. **Utility modules**: Add to `scripts/utils/`
2. **Error types**: Use `errorLogger.logError(type, details, message)`
3. **TUI**: Use `tui.printInfo`, `tui.createProgressBar`, etc.
4. **Testing**: Add `--limit` and `--dry-run` options

### Code Style

- No emojis in logs or comments
- Categorized error logging
- Progress bars for long operations
- Helpful CLI help messages
- Timestamped output directories

## Workflow Timer

The system tracks elapsed time across all scripts using the `artist-lists` directory timestamp:

- **Automatic Tracking**: Uses directory creation time from first script
- **No Extra Files**: Leverages existing timestamped directories
- **Live Display**: Progress bars show "Total: 2m 34s" that updates every second
- **Per-Script Summary**: Each script displays current elapsed time upon completion
- **Final Total**: `upload-artists.js` (last script) shows the total workflow time

Example output:
```
Workflow Elapsed Time: 2m 34s
────────────────────────────────────────────────────────
TOTAL WORKFLOW TIME: 23m 47s
────────────────────────────────────────────────────────
```

The timer helps you:
- Track actual processing time across multiple scripts
- Estimate how long future runs will take
- Identify bottlenecks in the workflow

## Implementation Timeline

- **Week 1**: Utility modules (timestamp, paths, TUI, error logging)
- **Week 2-3**: Scraping scripts (scrape, compare, prescrape)
- **Week 4**: Upload scripts (artists, songs, popular flags)
- **Total**: 4 weeks of implementation

## System Requirements

- Node.js >= 18
- Firebase project with Firestore
- Network access to Genius.com
- ~1GB disk space for cached data

## Dependencies

- `firebase`: Firestore integration
- `cheerio`: HTML parsing
- `axios`: HTTP requests
- `unidecode`: Text normalization
- `cli-progress`: Progress bars
- `chalk`: Colored terminal output

## License

MIT

## Support

For issues, questions, or contributions, please refer to the implementation plan and week-specific completion documents:
- `ARTIST_UPDATE_SYSTEM_PLAN.md`
- `WEEK_1_COMPLETE.md`
- `WEEK_2_3_COMPLETE.md`
- `WEEK_4_COMPLETE.md`

