# LyricType Prescraper System

A comprehensive bulk scraping and upload system for LyricType that fetches artist songs and lyrics from Genius.com and uploads them to Firebase Firestore.

## Overview

The prescraper system consists of two main components:

1. **`prescraper.js`** - Scrapes artist songs and lyrics from Genius API
2. **`firebase-uploader.js`** - Uploads prescraped data to Firebase Firestore

This system allows you to bulk-populate your database with artist data, song metadata, and lyrics for a better user experience.

## Features

### 🚀 Prescraper (`prescraper.js`)
- ✅ Loads artists from existing `genius-artists-*.json` files
- ✅ Fetches complete song lists for each artist (up to 1000 songs)
- ✅ Scrapes lyrics for configurable number of top songs per artist
- ✅ Extracts artist images and album art metadata
- ✅ Rate limiting to respect Genius.com servers
- ✅ Robust error handling and retry logic
- ✅ Progress tracking and resumable operations
- ✅ Detailed logging and statistics
- ✅ Configurable via CLI arguments

### 🔥 Firebase Uploader (`firebase-uploader.js`)
- ✅ Uploads artists, songs, and lyrics to Firestore
- ✅ Batch operations for efficiency
- ✅ Duplicate detection and skip existing data
- ✅ Dry-run mode for testing
- ✅ Progress tracking and error handling
- ✅ Compatible with existing Firebase Functions structure

## Prerequisites

1. **Node.js 18+** installed
2. **Genius API key** (stored in `functions/local-config.json`)
3. **Firebase project** with Firestore enabled
4. **Firebase credentials** (service account key or authenticated CLI)
5. **Artist data** from `genius-artists-*.json` files

## Installation

```bash
# Clone the repository and navigate to the project
cd lyrictype

# Install dependencies
npm install

# Ensure you have the required files:
# - functions/local-config.json (with Genius API key)
# - genius-artists-2025-07-11/*.json (artist data files)
```

## Configuration

### Genius API Key

Create `functions/local-config.json`:
```json
{
  "genius": {
    "key": "your_genius_api_key_here"
  }
}
```

### Firebase Authentication

Either:
1. Place your Firebase service account key at `functions/serviceAccountKey.json`, or
2. Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable, or
3. Use Firebase CLI authentication: `firebase login`

## Usage

### Step 1: Scrape Data

#### Basic Usage
```bash
# Scrape 10 songs per artist for all letters
node prescraper.js

# Or use npm script
npm start
```

#### Advanced Options
```bash
# Test with limited data
node prescraper.js --test 5 --letters a,b --songs 3

# Scrape specific letters only
node prescraper.js --letters j,k,l --songs 15

# Help
node prescraper.js --help
```

#### CLI Options
- `--songs <number>` - Number of songs to scrape per artist (default: 10)
- `--letters <letters>` - Letters to process, comma-separated (default: all)
- `--test <number>` - Test mode: limit artists per letter
- `--help, -h` - Show help message

### Step 2: Upload to Firebase

#### Basic Usage
```bash
# Upload latest prescraped data
node firebase-uploader.js

# Or use npm script
npm run upload
```

#### Advanced Options
```bash
# Dry run (test without uploading)
node firebase-uploader.js --dry-run
npm run upload-dry

# Upload specific directory
node firebase-uploader.js --dir ./prescraped-data-2025-09-14/

# Force overwrite existing data
node firebase-uploader.js --force

# Help
node firebase-uploader.js --help
```

#### CLI Options
- `--dir <directory>` - Directory containing prescraped JSON files
- `--dry-run` - Don't actually upload, just show what would be done
- `--force` - Upload even if artists already exist
- `--help, -h` - Show help message

## Output Structure

### Prescraped Data Format

The prescraper outputs JSON files with this structure:

```json
{
  "letter": "a",
  "processedAt": "2025-09-14T01:51:49.822Z",
  "artists": [
    {
      "name": "ABBA",
      "geniusId": "33385",
      "url": "https://genius.com/artists/Abba",
      "urlKey": "Abba",
      "letter": "a",
      "type": "popular",
      "imageUrl": "https://images.genius.com/...",
      "totalSongs": 235,
      "allSongs": [
        {
          "id": "396301",
          "title": "Slipping Through My Fingers",
          "url": "https://genius.com/Abba-slipping-through-my-fingers-lyrics",
          "songArtImageUrl": "https://images.genius.com/...",
          "artistNames": "ABBA",
          "primaryArtist": { ... },
          "albumArtId": "aca25cd05cf5853e915f76095b29eed2"
        }
      ],
      "scrapedSongs": [
        {
          "id": "396301",
          "title": "Slipping Through My Fingers",
          "lyrics": "School bag in hand, she leaves home in the early morning...",
          "scrapedAt": "2025-09-14T01:51:49.456Z",
          "scrapingDuration": 345
        }
      ],
      "processingStats": {
        "totalSongsFound": 235,
        "songsScraped": 10,
        "lyricsScraped": 8,
        "scrapingErrors": 2,
        "processingTime": 45000
      }
    }
  ],
  "summary": {
    "totalProcessed": 1,
    "totalFailed": 0,
    "totalSongs": 235,
    "totalLyrics": 8
  }
}
```

### Firebase Collections

Data is uploaded to these Firestore collections:

#### `artists` Collection
```javascript
{
  name: "ABBA",
  geniusId: 33385,
  url: "https://genius.com/artists/Abba",
  imageUrl: "https://images.genius.com/...",
  totalSongs: 235,
  songIds: ["396301", "395791", ...], // All songs
  cachedSongIds: ["396301", "395791"], // Songs with lyrics
  songsLastUpdated: Date,
  lyricsScraped: 8,
  isFullyCached: true,
  prescrapedAt: Date,
  prescrapedStats: { ... }
}
```

#### `songs` Collection
```javascript
{
  title: "Dancing Queen",
  url: "https://genius.com/Abba-dancing-queen-lyrics",
  songArtImageUrl: "https://images.genius.com/...",
  artistNames: "ABBA",
  primaryArtist: { ... },
  albumArtId: "ca44cb452ad50cf3e47a1c3ad30ebb15",
  lyrics: "You can dance, you can jive...", // If scraped
  lyricsScrapedAt: Date, // If scraped
  scrapingStatus: "completed|failed|pending",
  addedAt: Date
}
```

## Performance & Estimates

### Scraping Performance
- **Small test** (10 artists, 10 songs each): ~5-10 minutes
- **One letter** (750 artists avg, 10 songs each): ~2-4 hours
- **All letters** (27K artists, 10 songs each): ~36-72 hours

### Rate Limiting
- 1 second between artists
- 0.5 seconds between songs
- 0.2 seconds between API pages
- 3 retries with exponential backoff

### Upload Performance
- Batch size: 100 operations per batch
- 1 second delay between batches
- Auto-detects and skips existing data

## Error Handling

### Prescraper Errors
- **Network errors**: Automatic retry with exponential backoff
- **Rate limiting**: Respects delays and backs off appropriately
- **Individual song failures**: Continue with other songs
- **Artist failures**: Continue with other artists
- **Graceful shutdown**: Ctrl+C saves progress

### Uploader Errors
- **Firebase errors**: Detailed logging and error tracking
- **Batch failures**: Individual operation tracking
- **Duplicate detection**: Skips existing data by default
- **Dry run mode**: Test uploads without actual database changes

## Monitoring & Logs

### Real-time Progress
Both scripts provide detailed console output:
- 📊 Statistics and progress bars
- ⏱️ Time estimates and durations
- ✅ Success indicators
- ❌ Error details and counts
- 💾 File save confirmations

### Example Output
```
[1/3] 🎨 Processing: ABBA
  🔗 URL: https://genius.com/artists/Abba
  🆔 Genius ID: 33385
  🎵 Fetching all songs for: ABBA
    📄 Page 1: 50 songs (50 total)
    📄 Page 2: 50 songs (100 total)
  📚 Found 235 songs total
  🎤 Scraping lyrics for top 10 songs...
    📝 [1/10] Slipping Through My Fingers
    ✅ Success (345ms, 1508 chars)
  ✅ Completed: 8/10 lyrics scraped (10324ms)
```

## Troubleshooting

### Common Issues

#### "No API key found"
```bash
# Ensure functions/local-config.json exists with valid Genius API key
cat functions/local-config.json
```

#### "Firebase authentication error"
```bash
# Install Firebase CLI and login
npm install -g firebase-tools
firebase login

# Or set service account key path
export GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"
```

#### "No artist files found"
```bash
# Ensure you have the genius-artists directory
ls -la genius-artists-2025-07-11/
```

#### Rate limiting / 429 errors
- The system already includes rate limiting
- If you get consistent 429 errors, increase delays in `config.delays`

### Recovery

#### Resume Interrupted Scraping
The prescraper creates partial files as it works. To resume:
1. Check what was completed in the output directory
2. Use `--letters` to skip completed letters
3. Or delete partial files and restart

#### Rerun Failed Uploads
The uploader skips existing artists by default:
```bash
# Skip existing data (default)
node firebase-uploader.js

# Or force overwrite
node firebase-uploader.js --force
```

## Advanced Configuration

### Custom Rate Limits
Edit `prescraper.js` config:
```javascript
delays: {
    betweenArtists: 2000, // 2 seconds
    betweenSongs: 1000,   // 1 second
    betweenPages: 500     // 0.5 seconds
}
```

### Custom Batch Sizes
Edit `firebase-uploader.js` config:
```javascript
upload: {
    batchSize: 50, // Smaller batches
    delayBetweenBatches: 2000 // 2 second delays
}
```

## Integration with Existing System

This prescraper system is designed to work seamlessly with your existing Firebase Functions:

1. **Data Format**: Matches existing Firestore schema exactly
2. **Collections**: Uses same collection names (`artists`, `songs`, `albumArt`)
3. **Compatibility**: Existing functions can read prescraped data immediately
4. **Migration**: Can gradually replace real-time scraping with bulk data

## Best Practices

1. **Start Small**: Use `--test` mode first
2. **Monitor Resources**: Watch API quotas and Firebase usage
3. **Backup Data**: Keep prescraped JSON files as backups
4. **Gradual Upload**: Upload letter by letter to monitor
5. **Dry Run**: Always test uploads with `--dry-run` first
6. **Error Review**: Check logs for patterns in failed scrapes

## Contributing

The prescraper system is modular and extensible:

- **Add new data sources**: Extend artist loading functions
- **Custom processing**: Add new scraped data fields
- **Enhanced filtering**: Improve artist selection logic
- **Performance optimization**: Parallelize operations
- **Additional exports**: Add different output formats

## License

Part of the LyricType project. See main project LICENSE for details.
