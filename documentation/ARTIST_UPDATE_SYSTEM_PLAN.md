# Artist Update System - Implementation Plan

## 📋 Overview

A comprehensive system for periodically updating the artist database by:
1. Scraping the latest artist list from Genius
2. Identifying new artists not in our database
3. Prescraping song data for only new artists
4. Manually uploading new data with popular flag updates

**Run Frequency:** ~Once per month (manual execution)

---

## 🗂️ Data Organization Structure

All scraped data will be stored locally under `scraping-data/` with timestamp-based organization:

```
scraping-data/
├── artist-lists/
│   └── 2026-01-04-18-30/
│       ├── artists-0.json           # Numbers/symbols
│       ├── artists-a.json
│       ├── artists-b.json
│       ├── ...
│       ├── artists-z.json
│       ├── summary.json             # Totals, timestamp, metadata
│       └── .complete                # Marker file indicating completion
│
├── new-artists/
│   └── 2026-01-04-18-30/
│       ├── new-artists-0.json       # Filtered: only new artists
│       ├── new-artists-a.json
│       ├── ...
│       ├── new-artists-z.json
│       ├── comparison-report.json   # Details on what's new vs existing
│       └── .complete
│
└── song-data/
    └── 2026-01-04-18-30/
        ├── songs-0.json             # Prescraped songs for new artists
        ├── songs-a.json
        ├── ...
        ├── songs-z.json
        ├── scraping-summary.json    # Stats on lyrics scraped
        └── .complete
```

---

## 🔄 Complete Workflow

### **Phase 1: Scrape Artist Lists**
Fetch current artist data from Genius for all letters.

**Script:** `scripts/scrape-artists.js`

**Input:** None  
**Output:** `scraping-data/artist-lists/{timestamp}/`

**Data Structure (per file):**
```json
{
  "letter": "a",
  "scrapedAt": "2026-01-04T18:30:00.000Z",
  "totalArtists": 1245,
  "artists": {
    "popular": [
      {
        "name": "Artist Name",
        "url": "https://genius.com/artists/Artist-name",
        "id": "123456",
        "type": "popular"
      }
    ],
    "regular": [
      {
        "name": "Regular Artist",
        "url": "https://genius.com/artists/Regular-artist",
        "id": "789012",
        "type": "regular"
      }
    ]
  }
}
```

### **Phase 2: Compare with Database**
Identify which artists are new vs. already in Firestore.

**Script:** `scripts/compare-artists.js`

**Input:** 
- Latest artist list from Phase 1
- Current Firestore artists collection

**Output:** `scraping-data/new-artists/{timestamp}/`

**Comparison Report Structure:**
```json
{
  "timestamp": "2026-01-04T18:30:00.000Z",
  "sourceDirectory": "scraping-data/artist-lists/2026-01-04-18-30",
  "statistics": {
    "totalGeniusArtists": 50000,
    "totalFirestoreArtists": 48500,
    "newArtists": 1500,
    "existingArtists": 48500,
    "popularChanges": {
      "addedToPopular": 15,
      "removedFromPopular": 12,
      "unchangedPopular": 505
    }
  },
  "perLetter": {
    "a": {
      "geniusTotal": 2000,
      "firestoreTotal": 1950,
      "newCount": 50,
      "popularInGenius": 20,
      "popularInFirestore": 20
    }
  },
  "newArtistsByLetter": {
    "a": 50,
    "b": 45,
    "...": "..."
  }
}
```

**New Artists File Structure (per letter):**
```json
{
  "letter": "a",
  "comparisonDate": "2026-01-04T18:30:00.000Z",
  "newArtists": [
    {
      "name": "New Artist",
      "url": "https://genius.com/artists/New-artist",
      "id": "999999",
      "type": "regular",
      "isNew": true,
      "reason": "not_in_firestore"
    }
  ],
  "popularUpdates": [
    {
      "name": "Existing Artist",
      "id": "111111",
      "action": "add_popular",
      "reason": "now_in_genius_popular_top_20"
    },
    {
      "name": "Another Artist", 
      "id": "222222",
      "action": "remove_popular",
      "reason": "no_longer_in_genius_popular_top_20"
    }
  ]
}
```

### **Phase 3: Prescrape Songs**
Scrape songs and lyrics for ONLY new artists.

**Script:** `scripts/prescrape-new-artists.js`

**Input:** 
- New artist lists from Phase 2
- Configuration (songs per artist, delays, etc.)

**Output:** `scraping-data/song-data/{timestamp}/`

**Song Data Structure (matches current prescraper format):**
```json
{
  "letter": "a",
  "scrapedAt": "2026-01-04T19:15:00.000Z",
  "artists": [
    {
      "name": "New Artist",
      "urlKey": "new-artist",
      "url": "https://genius.com/artists/New-artist",
      "geniusId": "999999",
      "totalSongs": 25,
      "allSongs": [...],
      "scrapedSongs": [...],
      "processingStats": {
        "totalSongs": 25,
        "songsAttempted": 10,
        "lyricsScraped": 8,
        "lyricsFailed": 2
      }
    }
  ],
  "summary": {
    "totalArtists": 50,
    "totalSongs": 1250,
    "totalLyrics": 890
  }
}
```

### **Phase 4: Upload to Database**
Manual step to upload new data after inspection.

**Script:** `scripts/upload-update.js`

**Input:** 
- Song data from Phase 3
- Comparison report from Phase 2

**Actions:**
1. **Clear all popular flags** from Firestore artists
2. **Upload new artists** with songs, lyrics, and search tokens
3. **Update popular flags** for exactly 20 artists per letter (from Genius)
4. **Update metadata** (lastUpdated timestamps)

**Output:** Updated Firestore database

---

## 🛠️ Script Details

### **1. scripts/scrape-artists.js**

**Purpose:** Scrape all artist lists from Genius

**Features:**
- Scrapes all 27 letters (0, a-z)
- Saves to timestamped directory
- Includes artist IDs (via iOS app link extraction)
- Separates popular vs regular artists
- Creates summary.json with totals
- Creates .complete marker when done
- **TUI with progress bar and real-time statistics**
- Error handling: continues on failures, logs to errors.json

**CLI Options:**
```bash
node scripts/scrape-artists.js                    # Full scrape
node scripts/scrape-artists.js --letters j,k      # Specific letters only
node scripts/scrape-artists.js --no-ids           # Skip ID extraction (faster)
node scripts/scrape-artists.js --output-dir ./custom/path  # Custom output
node scripts/scrape-artists.js --quiet            # Minimal output (no TUI)
```

**Based on:** Current `genius-scraper.js` (refactored)

**TUI Display:**
- Current letter being scraped
- Artists processed / total artists
- Current artist being processed
- Error counts by type
- Estimated time remaining

---

### **2. scripts/compare-artists.js**

**Purpose:** Compare Genius artists with Firestore to identify new artists

**Features:**
- Reads latest (or specified) artist list
- Queries Firestore for existing artists
- Identifies new artists not in database
- Detects popular status changes
- Generates filtered lists of only new artists
- Creates detailed comparison report
- **TUI with progress bar for Firestore queries**
- Error handling: continues on failures, logs to errors.json

**CLI Options:**
```bash
node scripts/compare-artists.js                           # Use latest artist list
node scripts/compare-artists.js --date 2026-01-04-18-30   # Specific timestamp
node scripts/compare-artists.js --dry-run                 # Preview only
node scripts/compare-artists.js --quiet                   # Minimal output
```

**Logic:**
```javascript
// Pseudo-code
const geniusArtists = loadArtistLists(timestamp);
const firestoreArtists = await fetchAllFirestoreArtists();

const newArtists = geniusArtists.filter(artist => 
  !firestoreArtists.some(fa => fa.geniusId === artist.id)
);

const popularUpdates = calculatePopularChanges(
  geniusArtists.popular,
  firestoreArtists.filter(fa => fa.type === 'popular')
);
```

**TUI Display:**
- Loading progress for Firestore queries
- Artists compared / total artists
- Current letter being compared
- New artists found count
- Popular changes detected

---

### **3. scripts/prescrape-new-artists.js**

**Purpose:** Scrape songs and lyrics for only new artists

**Features:**
- Reads new-artists lists from Phase 2
- Uses same scraping logic as current prescraper
- Configurable songs per artist (default: 10)
- Rate limiting and retries
- Progress tracking per letter
- Saves results in timestamp-matching directory
- **TUI with detailed progress and error tracking**
- Error handling: continues on failures, logs to errors.json

**CLI Options:**
```bash
node scripts/prescrape-new-artists.js                     # Use latest comparison
node scripts/prescrape-new-artists.js --date 2026-01-04-18-30
node scripts/prescrape-new-artists.js --songs 15          # Scrape 15 songs per artist
node scripts/prescrape-new-artists.js --letters j,k       # Only specific letters
node scripts/prescrape-new-artists.js --quiet             # Minimal output
```

**Based on:** Current `prescraper.js` (adapted for artist list input)

**TUI Display:**
- Overall progress (artists processed / total)
- Current letter being processed
- Current artist and song being scraped
- Songs scraped / lyrics found counts
- Error counts by type (network, parsing, rate limit)
- Processing speed (songs/second)
- Estimated time remaining

---

### **4. scripts/upload-update.js**

**Purpose:** Upload new data to Firestore (manual inspection step)

**Features:**
- Reads song data and comparison report
- Shows preview of changes before upload
- Clears all popular flags first
- Uploads new artists with search tokens
- Sets popular flags for top 20 per letter
- Batch uploads with smart rate limiting
- **TUI with upload progress tracking**
- Error handling: continues with partial, logs to errors.json

**CLI Options:**
```bash
node scripts/upload-update.js                           # Use latest data
node scripts/upload-update.js --date 2026-01-04-18-30   # Specific timestamp
node scripts/upload-update.js --dry-run                 # Preview changes only
node scripts/upload-update.js --skip-popular            # Don't update popular flags
node scripts/upload-update.js --letters j,k             # Only specific letters
node scripts/upload-update.js --batch-size 50           # Slower batching
node scripts/upload-update.js --quiet                   # Minimal output
node scripts/upload-update.js --yes                     # Skip confirmation prompt
```

**Upload Steps:**
1. Load comparison report and song data
2. **Preview Mode** - Show what will be uploaded:
   - X new artists to add
   - Y popular flags to add
   - Z popular flags to remove
3. Confirm with user (Y/n) - unless --yes flag
4. Clear all popular flags in Firestore
5. Upload new artists (with search tokens)
6. Upload new songs
7. Set popular flags (exactly 20 per letter)
8. Display summary

**TUI Display:**
- Current upload phase (artists / songs / flags)
- Items uploaded / total items
- Current batch being uploaded
- Upload speed (items/second)
- Error counts by type
- Estimated time remaining

---

### **5. scripts/artist-uploader.js** (Consolidated Utility)

**Purpose:** Core upload functionality (used by upload-update.js)

**Features:**
- Merges `upload-to-firestore.js` + `upload-remaining-artists.js`
- Generates search tokens automatically
- Smart batching (auto-adjusts on rate limits)
- Skip existing artists option
- Update vs create modes
- Validation and sanitization

**Exports functions used by other scripts**

---

## 📝 NPM Scripts (package.json)

```json
{
  "scripts": {
    "update:scrape-artists": "node scripts/scrape-artists.js",
    "update:compare": "node scripts/compare-artists.js",
    "update:prescrape": "node scripts/prescrape-new-artists.js",
    "update:upload": "node scripts/upload-update.js",
    "update:all": "npm run update:scrape-artists && npm run update:compare && npm run update:prescrape",
    "update:latest": "node scripts/upload-update.js"
  }
}
```

**Typical Monthly Workflow:**
```bash
# Step 1: Scrape latest artists from Genius (~10 minutes)
npm run update:scrape-artists
# TUI shows real-time progress, no emojis

# Step 2: Compare with database and identify new artists (~2 minutes)
npm run update:compare
# TUI shows comparison progress and results

# Step 3: Prescrape songs for new artists only (~2 hours)
npm run update:prescrape
# TUI shows detailed progress: current artist, song, errors

# Step 4: Inspect data in scraping-data/ directories (manual)
# Review comparison-report.json and errors.json files

# Step 5: Upload to database (after manual inspection, ~5 minutes)
npm run update:upload
# Shows preview, asks for confirmation, then uploads with TUI

# Or run all scraping steps at once (Steps 1-3):
npm run update:all
# Then inspect and upload separately
```

---

## 🔧 Implementation Order

### **Week 1: Data Structure & Core Utilities**
- [ ] Create `scraping-data/` directory structure
- [ ] Create timestamp utility functions
- [ ] Set up TUI libraries (`cli-progress`, `chalk` for subtle colors)
- [ ] Create shared TUI module for progress bars
- [ ] Create shared error logging module (errors.json)
- [ ] Refactor `artist-uploader.js` (merge upload scripts)
- [ ] Add search token generation to upload process
- [ ] Test upload with rate limiting

### **Week 2: Artist Scraping**
- [ ] Refactor `genius-scraper.js` → `scrape-artists.js`
- [ ] Add TUI with progress bar and statistics
- [ ] Update to save in new directory structure
- [ ] Add summary.json generation
- [ ] Add errors.json generation
- [ ] Add .complete marker creation
- [ ] Remove all emojis from output
- [ ] Test full artist scraping workflow

### **Week 3: Comparison Logic**
- [ ] Create `compare-artists.js`
- [ ] Add TUI with progress tracking
- [ ] Implement Firestore artist fetching
- [ ] Build comparison logic (new vs existing)
- [ ] Implement popular status change detection
- [ ] Generate filtered new-artists lists
- [ ] Create detailed comparison report
- [ ] Add error handling and logging
- [ ] Remove all emojis from output
- [ ] Test with real data

### **Week 4: Prescraper Adaptation**
- [ ] Create `prescrape-new-artists.js`
- [ ] Add comprehensive TUI with detailed progress
- [ ] Adapt prescraper to read artist lists
- [ ] Update to use new directory structure
- [ ] Add error handling (continue on failures)
- [ ] Add errors.json generation
- [ ] Remove all emojis from output
- [ ] Test with small artist list
- [ ] Test with full new artists list

### **Week 5: Upload System**
- [ ] Create `upload-update.js`
- [ ] Add TUI with upload progress
- [ ] Implement preview mode
- [ ] Add popular flag clearing logic
- [ ] Add popular flag setting (top 20 per letter)
- [ ] Implement confirmation prompts
- [ ] Add error handling (continue with partial)
- [ ] Add errors.json generation
- [ ] Remove all emojis from output
- [ ] Test with dry-run mode
- [ ] Test full upload workflow

### **Week 6: Integration & Testing**
- [ ] End-to-end testing of full workflow
- [ ] Verify all TUIs work correctly
- [ ] Verify no emojis in any output
- [ ] Test error handling (graceful degradation)
- [ ] Test errors.json generation
- [ ] Create comprehensive documentation
- [ ] Update README with new workflow
- [ ] Archive old scripts to `scripts/archived/`
- [ ] Create migration guide
- [ ] Document TUI libraries and dependencies

---

## 🎯 Key Features

### **1. Incremental Updates**
- Only process new artists (saves hours of scraping)
- Preserves existing data (no overwriting)
- Only updates popular flags (no re-uploads)

### **2. Data Safety**
- Everything saved locally first
- Manual inspection before upload
- Dry-run modes for all scripts
- Rollback capability

### **3. Transparency**
- Detailed comparison reports
- Clear summary of changes
- Progress tracking throughout
- Comprehensive logs

### **4. Flexibility**
- Can run full workflow or individual steps
- Can target specific letters
- Can reprocess data from any timestamp
- Configurable batch sizes for rate limiting

### **5. Popular Artists Management**
- Clear all flags before update (ensures exactly 20 per letter)
- Based on Genius's current popular list
- Automatic detection of status changes
- Detailed logging of changes

---

## Example Complete Run

```bash
# January 4, 2026 - Monthly update

# 1. Scrape latest artist lists from Genius
$ npm run update:scrape-artists

================================================================================
ARTIST LIST SCRAPER
================================================================================

Progress: [████████████████████████] 100% (27/27 letters) | Time: 8m 42s

Statistics:
  Popular Artists: 540
  Regular Artists: 49,460
  Total Artists: 50,000
  
Errors:
  Network errors: 2
  ID extraction failed: 18

Output: scraping-data/artist-lists/2026-01-04-18-30/
[SUCCESS] Artist scraping complete
================================================================================

# 2. Compare with database
$ npm run update:compare

================================================================================
ARTIST COMPARISON
================================================================================

Progress: [████████████████████████] 100% | Time: 1m 23s

Results:
  Genius artists: 50,000
  Firestore artists: 48,753
  New artists found: 1,247
  Popular changes: 23

Output: scraping-data/new-artists/2026-01-04-18-30/
[SUCCESS] Comparison complete
================================================================================

# 3. Prescrape songs for new artists only
$ npm run update:prescrape

================================================================================
SONG PRESCRAPER - New Artists Only
================================================================================

Progress: [████████████████████████] 100% (1247/1247) | Time: 1h 47m

Current: Letter J - Artist: John Doe - Song: Example Song

Statistics:
  Artists processed: 1,247
  Songs scraped: 12,470
  Lyrics found: 9,856
  Processing speed: 1.9 songs/sec
  
Errors:
  Network timeout: 45
  Lyrics not found: 2,569
  Parsing failed: 12

Output: scraping-data/song-data/2026-01-04-18-30/
[SUCCESS] Prescraping complete
================================================================================

# 4. Inspect data (manual step)
$ cat scraping-data/new-artists/2026-01-04-18-30/comparison-report.json
# Review: New artists look good, popular changes make sense

# 5. Upload to database
$ npm run update:upload

================================================================================
UPLOAD PREVIEW
================================================================================

Data Source: scraping-data/song-data/2026-01-04-18-30/

Changes to be made:
  New artists: 1,247
  New songs: 12,470
  Popular flags to add: 540 (20 per letter x 27)
  Popular flags to remove: 540

Proceed with upload? (Y/n): y

================================================================================
UPLOADING TO FIRESTORE
================================================================================

Progress: [████████████████████████] 100% | Time: 4m 12s

Phase: Uploading Songs (Batch 125/125)

Statistics:
  Artists uploaded: 1,247
  Songs uploaded: 12,470
  Popular flags set: 540
  Upload speed: 3.2 items/sec
  
Errors:
  Rate limit (retried): 3
  Write failed: 0

[SUCCESS] Database update complete
================================================================================
```

---

## 📊 Data Flow Diagram

```
┌─────────────────────┐
│   Genius Website    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Step 1: scrape-artists.js                      │
│  Output: scraping-data/artist-lists/{timestamp} │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Step 2: compare-artists.js                     │
│  Input:  Artist lists + Firestore artists       │
│  Output: scraping-data/new-artists/{timestamp}  │
│          (filtered: only new + popular changes) │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Step 3: prescrape-new-artists.js               │
│  Input:  New artist lists                       │
│  Output: scraping-data/song-data/{timestamp}    │
│          (songs + lyrics for new artists only)  │
└──────────┬──────────────────────────────────────┘
           │
           ▼
    [Manual Inspection]
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Step 4: upload-update.js                       │
│  Input:  Song data + Comparison report          │
│  Actions:                                       │
│    1. Clear all popular flags                   │
│    2. Upload new artists (with search tokens)   │
│    3. Upload new songs                          │
│    4. Set popular flags (top 20 per letter)     │
│  Output: Updated Firestore database             │
└─────────────────────────────────────────────────┘
```

---

## 🗑️ Script Cleanup Plan

### **Scripts to Keep (Maintain/Refactor)**
- `genius-scraper.js` → refactor to `scrape-artists.js`
- `prescraper.js` → adapt to `prescrape-new-artists.js`
- `firebase-uploader.js` → keep for backward compatibility with manual prescraping
- `fix-null-lyrics.js` → keep (unrelated to update system)
- `search-songs-by-id.js` → keep (utility)
- `check-database.js` → keep (utility)

### **Scripts to Consolidate**
- `upload-to-firestore.js` + `upload-remaining-artists.js` → merge into `artist-uploader.js`
- `add-search-tokens.js` → integrate into upload process (no separate step)

### **Scripts to Archive**
Move to `scripts/archived/` for reference:
- `upload-to-firestore.js` (after merging)
- `upload-remaining-artists.js` (after merging)
- `add-search-tokens.js` (after integration)

---

## Documentation Updates Needed

1. **Update README.md** - Add new workflow section
2. **Create ARTIST_UPDATE_GUIDE.md** - User guide for monthly updates
3. **Update documentation/** - Update references to old scripts
4. **Create migration guide** - For transitioning from old to new system
5. **Document TUI usage** - How to interpret progress displays
6. **Document error handling** - Where to find errors.json files

## Dependencies to Add

Add to package.json:
```json
{
  "dependencies": {
    "cli-progress": "^3.12.0",
    "chalk": "^5.3.0"
  }
}
```

---

## Success Criteria

- [ ] Can scrape all artists from Genius in <15 minutes
- [ ] Can identify new artists in <5 minutes
- [ ] Can prescrape only new artists (saves 90%+ time vs full scrape)
- [ ] Can upload with manual inspection step
- [ ] Popular flags maintained at exactly 20 per letter
- [ ] Search tokens automatically included
- [ ] All data preserved locally with timestamps
- [ ] Can rerun any step independently
- [ ] TUI shows real-time progress and statistics
- [ ] No emojis in any script output or logs
- [ ] Errors logged to errors.json with clean console output
- [ ] Handles rate limits gracefully (continues with partial results)
- [ ] All phases show estimated time remaining
- [ ] Error counts displayed by type during execution


---

## 📋 Implementation Decisions

### **Configuration Settings**
- **Songs per artist:** 10 (configurable via CLI)
- **Old data archival:** Manual deletion only (no automated cleanup)
- **Error handling:** Continue with partial results, document in summary.json
- **Rollback support:** Not needed
- **Logging style:** NO EMOJIS in any scripts or logs

### **TUI Requirements**

All main scraping scripts must include a Terminal User Interface (TUI) with:

#### **Progress Tracking**
- Progress bar showing % completion of current phase
- Estimated time remaining for current phase
- Current letter being processed (e.g., "Processing: Letter J")
- Current item being processed (artist name or song title)

#### **Statistics Display**
- Items processed / total items (e.g., "Artists: 45/1247")
- Success count
- Error count by type:
  - Network errors
  - Parsing errors
  - Rate limit errors
  - Other errors
- Items per second (processing speed)

#### **Real-time Updates**
- Updates every 100ms for smooth progress bar
- Current action description (e.g., "Scraping: Artist Name - Song Title")
- No emoji characters in any output
- Clean, professional terminal output

#### **Example TUI Layout**
```
================================================================================
ARTIST LIST SCRAPER - Phase 1/3
================================================================================

Progress: [████████████████░░░░░░░░] 65.3% (17/26 letters) | ETA: 3m 15s

Current Letter: Q
Current Artist: Queen
Action: Extracting artist ID from page

Statistics:
  Popular Artists: 340 | Regular Artists: 12,450
  Total Artists: 12,790
  
Errors:
  Network errors: 3
  ID extraction failed: 12
  Other errors: 0

Processing Speed: 2.3 artists/sec
================================================================================
```

#### **TUI Libraries**
Consider using:
- `cli-progress` - Progress bars
- `ora` - Spinners (if needed)
- `chalk` - Colors (optional, subtle use)
- `boxen` - Bordered boxes (optional)

---

## 🎨 Code Style Guidelines

### **Logging Standards**
- **NO EMOJIS** in any script output or logs
- Use simple prefixes: `[INFO]`, `[WARN]`, `[ERROR]`, `[SUCCESS]`
- Keep logs concise and machine-readable
- Timestamps in ISO format: `2026-01-04T18:30:00.000Z`
- Errors logged to summary.json, not verbose console output

### **Error Handling**
- Scripts must continue on errors (graceful degradation)
- Collect all errors during processing
- Write error summary to `errors.json` in output directory
- Console shows error counts only, not full error messages
- Critical errors only halt execution

### **Example Error Summary (errors.json)**
```json
{
  "phase": "prescraping",
  "timestamp": "2026-01-04T19:15:00.000Z",
  "totalErrors": 15,
  "errorsByType": {
    "network_timeout": 3,
    "parsing_failed": 7,
    "rate_limit": 2,
    "lyrics_not_found": 3
  },
  "errors": [
    {
      "type": "network_timeout",
      "artist": "Artist Name",
      "song": "Song Title",
      "url": "https://genius.com/...",
      "timestamp": "2026-01-04T19:15:23.000Z",
      "message": "Request timeout after 10000ms"
    }
  ]
}
```

---

## Summary of Key Requirements

### **User Experience**
- Terminal User Interface (TUI) with progress bars on all main scripts
- Real-time statistics and error tracking
- Estimated time remaining for all operations
- Clean, professional output with NO EMOJIS
- Simple log prefixes: [INFO], [WARN], [ERROR], [SUCCESS]

### **Error Handling**
- Continue processing on errors (graceful degradation)
- Errors logged to `errors.json` in each output directory
- Console shows only error counts, not verbose messages
- Summary includes error breakdown by type

### **Data Management**
- 10 songs per artist (configurable)
- All data saved locally in `scraping-data/` with timestamps
- No automated archival (manual deletion when needed)
- Timestamped directories for tracking and re-processing

### **Popular Artists**
- Determined by Genius's current popular list
- Exactly 20 popular artists per letter
- Clear all flags before update to ensure accuracy
- Changes tracked in comparison report

### **Workflow**
- 4 separate phases: Scrape → Compare → Prescrape → Upload
- Manual inspection before upload
- Can process specific letters only
- Can reprocess from any timestamp

---

**Last Updated:** 2026-01-04  
**Status:** Planning Phase - Requirements Finalized  
**Next Step:** Begin Week 1 implementation (TUI setup and core utilities)

