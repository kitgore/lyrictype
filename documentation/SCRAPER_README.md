# Genius Artist Scraper

A Node.js script to scrape artist links from Genius.com artist index pages.

## Features

- ✅ Scrapes both **popular** and **regular** artists
- ✅ Distinguishes between artist types with clear labeling
- ✅ **Extracts Genius artist IDs from individual artist pages**
- ✅ **Bulk scraping for all letters A-Z at once**
- ✅ **Organized output folders with timestamps**
- ✅ Rate limiting to be respectful to Genius.com servers
- ✅ Progress tracking for long-running operations
- ✅ Saves results to JSON files with timestamps and metadata
- ✅ Comprehensive summary statistics and error handling
- ✅ Prepared for future Firebase Firestore integration
- ✅ Command-line interface for different letters
- ✅ Fast mode option to skip ID extraction
- ✅ Clean, structured output format

## Usage

### Basic Usage

#### Single Letter Scraping
```bash
# Scrape artists for letter 'j' with IDs (default, slower)
node scripts/genius-scraper.js

# Scrape artists for a specific letter with IDs
node scripts/genius-scraper.js a
node scripts/genius-scraper.js k
node scripts/genius-scraper.js z

# Fast mode: Skip ID extraction for quicker results
node scripts/genius-scraper.js j --no-ids
node scripts/genius-scraper.js a --no-ids
```

#### Bulk Scraping (All Letters A-Z)
```bash
# Scrape ALL letters with IDs (very slow - several hours!)
node scripts/genius-scraper.js all

# Bulk scrape ALL letters without IDs (much faster - ~30 minutes)
node scripts/genius-scraper.js all --no-ids
```

### Example Output (with ID extraction)
```
🎵 Genius Artist Scraper Starting...

Scraping artists for letter: Q
Extracting popular artists...
Extracting regular artists...
Found 20 popular artists
Found 213 regular artists

🔍 Extracting artist IDs from individual pages...
⚠️  This may take several minutes due to rate limiting

Fetching popular artist IDs:
Popular Artists: [████████████████████] 100.0% (20/20)

Fetching regular artist IDs:
Regular Artists: [████████████████████] 100.0% (213/213)

✅ Successfully extracted 20/20 popular artist IDs
✅ Successfully extracted 209/213 regular artist IDs

=== SCRAPING SUMMARY ===
Popular Artists: 20
Regular Artists: 213
Total Artists: 233

Artist IDs Extracted: 229/233 (98.3%)

First 5 Popular Artists:
  1. Qadir Khan (ID: 1272287) - https://genius.com/artists/Qadir-khan
  2. Qimp (ID: 3068429) - https://genius.com/artists/Qimp
  3. Qing Madi (ID: 3464652) - https://genius.com/artists/Qing-madi
  4. Qry (ID: 1163579) - https://genius.com/artists/Qry
  5. Quadeca (ID: 683879) - https://genius.com/artists/Quadeca

First 5 Regular Artists:
  1. Q (ID: 2980) - https://genius.com/artists/Q
  2. Q2 (ID: 4225117) - https://genius.com/artists/Q2
  3. Q50WLil50 (ID: 4161919) - https://genius.com/artists/Q50wlil50
  4. Qaab (ID: 1806923) - https://genius.com/artists/Qaab
  5. Qaayel (ID: 1357455) - https://genius.com/artists/Qaayel

✅ Scraping completed successfully!
📁 Data saved to: genius-artists-q.json

💡 Tip: Use --no-ids flag for faster scraping without artist IDs
```

### Bulk Scraping Output Example
```
🎵 Starting bulk scraping for all letters (A-Z)...

📁 Results will be saved to: genius-artists-2025-07-11/

[1/26] 🔄 Processing letter: A
Extracting popular artists...
Extracting regular artists...
Found 20 popular artists
Found 891 regular artists
✅ Letter A: 911 artists processed

[2/26] 🔄 Processing letter: B
...

============================================================
🎯 BULK SCRAPING COMPLETE
============================================================
📊 Overall Statistics:
   • Letters processed: 26/26
   • Total artists: 19,547
   • Popular artists: 520
   • Regular artists: 19,027
   • Artists with IDs: 18,891 (96.6%)
   • Duration: 127 minutes
   • Output directory: genius-artists-2025-07-11/

✅ Results saved to: genius-artists-2025-07-11/
📄 Summary saved to: genius-artists-2025-07-11/scraping-summary.json
```

## Bulk Scraping Benefits

- 📁 **Organized Output**: All results saved to timestamped folder
- 📊 **Comprehensive Stats**: Total counts across all letters
- 🛡️ **Error Resilience**: Continues if one letter fails
- 📄 **Summary Report**: Detailed JSON summary of entire operation
- ⏱️ **Time Estimates**: Clear duration tracking

### Bulk Output Structure
```
genius-artists-2025-07-11/
├── genius-artists-a.json
├── genius-artists-b.json
├── genius-artists-c.json
...
├── genius-artists-z.json
└── scraping-summary.json
```

## Output Format

The scraper generates JSON files with the following structure:

```json
{
  "letter": "Q",
  "timestamp": "2025-07-11T05:36:00.714Z",
  "totalArtists": 233,
  "popularCount": 20,
  "regularCount": 213,
  "artists": {
    "popular": [
      {
        "name": "Qadir Khan",
        "url": "https://genius.com/artists/Qadir-khan",
        "type": "popular",
        "id": "1272287"
      }
    ],
    "regular": [
      {
        "name": "Q",
        "url": "https://genius.com/artists/Q",
        "type": "regular",
        "id": "2980"
      }
    ]
  }
}
```

**Note**: The `id` field contains the Genius artist ID extracted from the iOS app link on each artist's page. If ID extraction fails for an artist, the `id` field will be `null`.

## Artist Types

- **Popular Artists**: Featured artists with higher prominence on the index page
- **Regular Artists**: Standard alphabetical listing of all other artists

## Firebase Integration (Future)

The scraper includes a `prepareForFirestore()` method that formats data for Firebase Firestore:

```javascript
{
  name: "Artist Name",
  url: "https://genius.com/artists/artist-name",
  id: "673285", // Genius artist ID from iOS app link
  type: "popular" | "regular",
  letter: "j",
  scrapedAt: Date
}
```

## Dependencies

- `axios` - HTTP client for web requests
- `cheerio` - Server-side jQuery implementation for HTML parsing
- `fs` - Node.js file system (built-in)

## Files Generated

### Single Letter Mode
- `genius-artists-{letter}.json` - Main output file with all scraped data

### Bulk Mode (`all`)
- `genius-artists-{date}/` - Timestamped folder containing:
  - `genius-artists-a.json` through `genius-artists-z.json` - Individual letter files
  - `scraping-summary.json` - Complete statistics and metadata

## Artist ID Extraction

The scraper extracts Genius artist IDs from iOS app links found in the `<head>` section of each artist page:

```html
<link href="ios-app://709482991/genius/artists/673285" rel="alternate">
```

From this link, the ID `673285` is extracted and stored with the artist data.

### Performance Considerations

#### Single Letter Mode
- **With ID extraction**: ~500ms delay between requests (respectful rate limiting)
  - Letter 'J' (~750 artists): ~6-7 minutes
  - Letter 'Q' (~233 artists): ~2-3 minutes
- **Without ID extraction** (`--no-ids` flag): Very fast (~30 seconds for any letter)

#### Bulk Mode (All Letters A-Z)
- **With ID extraction**: ~3-6 hours (depending on total artist count ~15k-20k)
- **Without ID extraction** (`--no-ids` flag): ~20-30 minutes

### Success Rate

Typically achieves 95-99% success rate for ID extraction. Some artists may not have iOS app links, resulting in `null` ID values.

## Notes

- Uses appropriate User-Agent headers to avoid blocking
- Respects Genius.com's structure and only scrapes publicly available data
- Implements rate limiting (500ms delays) to be respectful to servers
- Progress tracking with visual progress bars for long operations
- Designed to be easily extensible for additional letters or bulk scraping
- Ready for integration with Firebase Firestore database 