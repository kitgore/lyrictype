#!/usr/bin/env node

/**
 * Upload Songs to Firestore
 * Uploads prescraped song data to Firestore
 */

import fs from 'fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc, getDoc } from 'firebase/firestore';
import unidecode from 'unidecode';
import { firebaseConfig } from '../src/lib/services/initFirebase.js';
import * as tui from './utils/tui.js';
import * as paths from './utils/paths.js';
import { generateTimestamp, getCurrentISO } from './utils/timestamp.js';
import { createErrorLogger } from './utils/error-logger.js';

class SongUploader {
    constructor(options = {}) {
        this.inputTimestamp = options.timestamp || null;
        this.maxSongs = options.maxSongs || null; // Limit for testing
        this.dryRun = options.dryRun || false;
        this.batchSize = options.batchSize || 500;
        this.skipExisting = options.skipExisting !== false;
        this.errorLogger = createErrorLogger('song-upload');
        this.db = null;
        this.stats = {
            totalSongs: 0,
            processedSongs: 0,
            uploadedSongs: 0,
            skippedSongs: 0,
            failedSongs: 0
        };
    }

    /**
     * Initialize Firebase
     */
    initFirebase() {
        const app = initializeApp(firebaseConfig);
        this.db = getFirestore(app);
    }

    /**
     * Extract song ID from Genius URL
     */
    extractSongId(url) {
        if (!url) return null;
        const match = url.match(/genius\.com\/([^?#]+)-lyrics/);
        if (!match) return null;

        let songId = match[1];
        songId = unidecode(songId);
        songId = songId.replace(/[\/]/g, '-');
        songId = songId.replace(/[.#$\[\]]/g, '-');
        songId = songId.replace(/[^\w\-_.~]/g, '-');
        songId = songId.replace(/-+/g, '-');
        songId = songId.replace(/^-+|-+$/g, '');

        if (songId.length > 800) {
            songId = songId.substring(0, 800).replace(/-+$/, '');
        }

        if (!songId || songId.trim() === '') {
            return null;
        }
        return songId.toLowerCase();
    }

    /**
     * Extract artist slug from URL
     */
    extractArtistSlug(url) {
        if (!url) return null;
        const match = url.match(/\/artists\/([^/?#]+)/);
        if (!match) return null;
        return match[1].toLowerCase();
    }

    /**
     * Sanitize field value for Firestore
     */
    sanitizeFieldValue(text) {
        if (!text) return text;

        let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        sanitized = sanitized.replace(/[\uFE00-\uFE0F]/g, '');
        sanitized = sanitized.replace(/[\u200B-\u200F]/g, '');
        sanitized = sanitized.replace(/[\u2060-\u206F]/g, '');
        sanitized = sanitized.replace(/[\uFEFF]/g, '');
        sanitized = sanitized.replace(/\uDB40[\uDC00-\uDC7F]/g, '');
        sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');
        sanitized = sanitized.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

        try {
            sanitized = sanitized.normalize('NFC');
            encodeURIComponent(sanitized);
        } catch (error) {
            sanitized = unidecode(text);
            sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
        }
        return sanitized.trim();
    }

    /**
     * Transform song data for Firestore
     */
    transformSong(song) {
        if (!song.title || !song.url || !song.lyrics) {
            this.errorLogger.logError('invalid_song_data', {
                song: song.title || 'unknown'
            }, 'Missing title, URL, or lyrics');
            return null;
        }

        const songId = this.extractSongId(song.url);
        if (!songId) {
            this.errorLogger.logError('invalid_song_id', {
                song: song.title,
                url: song.url
            }, 'Could not extract valid song ID');
            return null;
        }

        const artistSlug = this.extractArtistSlug(song.artistUrl);
        if (!artistSlug) {
            this.errorLogger.logError('invalid_artist_slug', {
                song: song.title,
                artistUrl: song.artistUrl
            }, 'Could not extract artist slug');
            return null;
        }

        const sanitizedTitle = this.sanitizeFieldValue(song.title);
        const sanitizedUrl = this.sanitizeFieldValue(song.url);
        const sanitizedArtist = this.sanitizeFieldValue(song.artist);
        const sanitizedLyrics = this.sanitizeFieldValue(song.lyrics);

        if (!sanitizedTitle || !sanitizedUrl || !sanitizedArtist || !sanitizedLyrics) {
            this.errorLogger.logError('sanitization_failed', {
                song: song.title
            }, 'Failed to sanitize data');
            return null;
        }

        return {
            songId: songId,
            title: sanitizedTitle,
            url: sanitizedUrl,
            artist: sanitizedArtist,
            artistSlug: artistSlug,
            lyrics: sanitizedLyrics,
            uploadedAt: getCurrentISO(),
            scrapedAt: song.scrapedAt || getCurrentISO()
        };
    }

    /**
     * Check if song exists in Firestore
     */
    async checkSongExists(songId) {
        try {
            const songRef = doc(this.db, 'songs', songId);
            const docSnap = await getDoc(songRef);
            return docSnap.exists();
        } catch (error) {
            this.errorLogger.logError('firestore_check_failed', {
                songId
            }, error.message);
            return false;
        }
    }

    /**
     * Load song data
     */
    async loadSongs() {
        const timestamp = this.inputTimestamp || await paths.findLatestTimestamp('song-data');

        if (!timestamp) {
            throw new Error('No song-data found. Run prescrape-new-artists.js first.');
        }

        const inputDir = paths.getSongDataDir(timestamp);
        const isComplete = await paths.isDirectoryComplete(inputDir);

        if (!isComplete) {
            tui.printWarning(`Song-data directory not marked complete: ${inputDir}`);
        }

        tui.printInfo(`Loading songs from: ${timestamp}`);

        const allSongs = [];
        const letters = paths.getAllLetters();

        for (const letter of letters) {
            const filePath = paths.getLetterFilePath(inputDir, letter, 'songs');

            try {
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);

                if (data.songs && data.songs.length > 0) {
                    allSongs.push(...data.songs);
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    this.errorLogger.logError('file_read_error', {
                        file: filePath,
                        letter
                    }, error.message);
                }
            }
        }

        // Apply limit if specified
        if (this.maxSongs && this.maxSongs < allSongs.length) {
            tui.printWarning(`Limiting to first ${this.maxSongs} songs for testing`);
            allSongs.splice(this.maxSongs);
        }

        this.stats.totalSongs = allSongs.length;
        tui.printInfo(`Loaded ${tui.formatNumber(allSongs.length)} songs`);

        return { allSongs, timestamp };
    }

    /**
     * Upload batch of songs
     */
    async uploadBatch(songs, batchNum, totalBatches) {
        const batch = writeBatch(this.db);
        const songsCollection = collection(this.db, 'songs');
        let uploadedInBatch = 0;
        let skippedInBatch = 0;
        let failedInBatch = 0;

        for (const rawSong of songs) {
            try {
                const song = this.transformSong(rawSong);
                if (!song) {
                    failedInBatch++;
                    continue;
                }

                if (this.skipExisting && await this.checkSongExists(song.songId)) {
                    skippedInBatch++;
                    continue;
                }

                if (!this.dryRun) {
                    const docRef = doc(songsCollection, song.songId);
                    const { songId, ...documentData } = song;
                    batch.set(docRef, documentData, { merge: true });
                }
                uploadedInBatch++;
            } catch (error) {
                this.errorLogger.logError('batch_preparation_failed', {
                    song: rawSong.title
                }, error.message);
                failedInBatch++;
            }
        }

        if (!this.dryRun && uploadedInBatch > 0) {
            try {
                await batch.commit();
            } catch (error) {
                this.errorLogger.logError('batch_commit_failed', {
                    batchNum
                }, error.message);
                failedInBatch += uploadedInBatch;
                uploadedInBatch = 0;
            }
        }

        return { uploaded: uploadedInBatch, skipped: skippedInBatch, failed: failedInBatch };
    }

    /**
     * Run upload
     */
    async upload() {
        tui.printHeader('UPLOAD SONGS TO FIRESTORE');

        if (this.dryRun) {
            tui.printWarning('DRY RUN MODE: No data will be uploaded');
        }

        // Initialize Firebase
        this.initFirebase();

        // Load songs
        const { allSongs, timestamp: sourceTimestamp } = await this.loadSongs();

        if (allSongs.length === 0) {
            tui.printInfo('No songs to upload!');
            return null;
        }

        // Process in batches
        const totalBatches = Math.ceil(allSongs.length / this.batchSize);
        tui.printInfo(`Uploading in ${totalBatches} batches of ${this.batchSize}`);

        const progressBar = tui.createProgressBar(
            'Uploading Songs',
            allSongs.length,
            'Initializing...'
        );

        for (let i = 0; i < totalBatches; i++) {
            const startIdx = i * this.batchSize;
            const endIdx = Math.min(startIdx + this.batchSize, allSongs.length);
            const batchSongs = allSongs.slice(startIdx, endIdx);

            const result = await this.uploadBatch(batchSongs, i + 1, totalBatches);

            this.stats.processedSongs += batchSongs.length;
            this.stats.uploadedSongs += result.uploaded;
            this.stats.skippedSongs += result.skipped;
            this.stats.failedSongs += result.failed;

            progressBar.update(this.stats.processedSongs, {
                info: `Batch ${i + 1}/${totalBatches} | Uploaded: ${result.uploaded} | Skipped: ${result.skipped}`
            });

            // Small delay between batches
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        progressBar.stop();

        // Save summary
        if (!this.dryRun) {
            const outputDir = paths.getUploadDataDir(generateTimestamp());
            const summaryPath = `${outputDir}/song-upload-summary.json`;
            const summary = {
                timestamp: getCurrentISO(),
                sourceDirectory: `scraping-data/song-data/${sourceTimestamp}`,
                statistics: this.stats,
                errors: this.errorLogger.getSummary()
            };

            await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
            await this.errorLogger.saveToFile(outputDir);
            await paths.markDirectoryComplete(outputDir);
        }

        return { stats: this.stats };
    }

    /**
     * Display results
     */
    displayResults() {
        console.log('');
        tui.printStats('Upload Results', {
            'Total Songs': tui.formatNumber(this.stats.totalSongs),
            'Processed': tui.formatNumber(this.stats.processedSongs),
            'Uploaded': tui.formatNumber(this.stats.uploadedSongs),
            'Skipped': tui.formatNumber(this.stats.skippedSongs),
            'Failed': tui.formatNumber(this.stats.failedSongs),
            'Success Rate': `${((this.stats.uploadedSongs / this.stats.totalSongs) * 100).toFixed(1)}%`
        });

        if (this.errorLogger.hasErrors()) {
            tui.printErrorSummary(this.errorLogger.getErrorCounts());
        }
    }
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        timestamp: null,
        maxSongs: null,
        dryRun: false,
        skipExisting: true,
        batchSize: 500
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--date' && args[i + 1]) {
            options.timestamp = args[i + 1];
            i++;
        } else if (arg === '--limit' && args[i + 1]) {
            options.maxSongs = parseInt(args[i + 1], 10);
            i++;
        } else if (arg === '--batch-size' && args[i + 1]) {
            options.batchSize = parseInt(args[i + 1], 10);
            i++;
        } else if (arg === '--no-skip') {
            options.skipExisting = false;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Usage: node scripts/upload-songs.js [options]

Options:
  --date <timestamp>      Use specific song-data (YYYY-MM-DD-HH-MM)
                         Default: use latest
  --limit <number>       Max songs to upload (for testing)
  --batch-size <number>  Songs per batch (default: 500)
  --no-skip              Upload even if song exists (overwrite)
  --dry-run              Preview only, don't upload
  --help, -h             Show this help message

Examples:
  node scripts/upload-songs.js --dry-run
  node scripts/upload-songs.js --limit 10
  node scripts/upload-songs.js --date 2026-01-04-20-48
`);
            process.exit(0);
        }
    }

    return options;
}

/**
 * Main execution
 */
async function main() {
    const options = parseArgs();

    const uploader = new SongUploader({
        timestamp: options.timestamp,
        maxSongs: options.maxSongs,
        dryRun: options.dryRun,
        skipExisting: options.skipExisting,
        batchSize: options.batchSize
    });

    try {
        const result = await uploader.upload();

        if (result) {
            uploader.displayResults();
            tui.printSuccess('Song upload complete!');
        } else {
            tui.printInfo('No work to do.');
        }

        tui.printFooter();
    } catch (error) {
        tui.printError(`Upload failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default SongUploader;


