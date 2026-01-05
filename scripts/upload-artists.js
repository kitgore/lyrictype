#!/usr/bin/env node

/**
 * Upload Artists to Firestore
 * Uploads new artists with search tokens to Firestore
 */

import fs from 'fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc, getDoc } from 'firebase/firestore';
import unidecode from 'unidecode';
import { firebaseConfig } from '../src/lib/services/initFirebase.js';
import * as tui from './utils/tui.js';
import * as paths from './utils/paths.js';
import { generateTimestamp, getCurrentISO, getWorkflowElapsed } from './utils/timestamp.js';
import { createErrorLogger } from './utils/error-logger.js';

class ArtistUploader {
    constructor(options = {}) {
        this.inputTimestamp = options.timestamp || null;
        this.maxArtists = options.maxArtists || null; // Limit for testing
        this.dryRun = options.dryRun || false;
        this.batchSize = options.batchSize || 500;
        this.skipExisting = options.skipExisting !== false;
        this.errorLogger = createErrorLogger('artist-upload');
        this.db = null;
        this.stats = {
            totalArtists: 0,
            processedArtists: 0,
            uploadedArtists: 0,
            skippedArtists: 0,
            failedArtists: 0
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
     * Extract slug from Genius artist URL
     */
    extractSlug(url) {
        if (!url) return null;
        const match = url.match(/\/artists\/([^/?#]+)/);
        if (!match) return null;

        let slug = match[1];
        slug = unidecode(slug);
        slug = slug.replace(/[\/]/g, '-');
        slug = slug.replace(/[.#$\[\]]/g, '-');
        slug = slug.replace(/[^\w\-_.~]/g, '-');
        slug = slug.replace(/-+/g, '-');
        slug = slug.replace(/^-+|-+$/g, '');

        if (slug.length > 800) {
            slug = slug.substring(0, 800).replace(/-+$/, '');
        }

        if (!slug || slug.trim() === '') {
            return null;
        }
        return slug.toLowerCase();
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
     * Normalize text for search
     */
    normalizeText(text) {
        let normalized = unidecode(text);
        normalized = normalized
            .replace(/0/g, 'o')
            .replace(/\$/g, 's')
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/4/g, 'a')
            .replace(/5/g, 's')
            .replace(/7/g, 't')
            .replace(/\+/g, 'plus')
            .replace(/&/g, 'and')
            .replace(/@/g, 'at');
        return normalized.toLowerCase();
    }

    /**
     * Generate search tokens for autocomplete
     */
    generateSearchTokens(name) {
        const tokens = new Set();
        const cleanName = name.toLowerCase().trim();
        const normalizedName = this.normalizeText(name);

        const removePunctuation = (text) => text.replace(/[.,\-_'"!?&@#$%^*()+=\[\]{};:|<>\/\\`~]/g, '').replace(/\s+/g, ' ').trim();
        const cleanNameNoPunct = removePunctuation(cleanName);
        const normalizedNameNoPunct = removePunctuation(normalizedName);

        const versions = [cleanName];
        if (normalizedName !== cleanName) {
            versions.push(normalizedName);
        }
        if (cleanNameNoPunct !== cleanName && cleanNameNoPunct.length > 0) {
            versions.push(cleanNameNoPunct);
        }
        if (normalizedNameNoPunct !== normalizedName && normalizedNameNoPunct !== cleanNameNoPunct && normalizedNameNoPunct.length > 0) {
            versions.push(normalizedNameNoPunct);
        }

        for (const version of versions) {
            for (let i = 1; i <= version.length; i++) {
                tokens.add(version.substring(0, i));
            }
            const words = version.split(/\s+/);
            for (const word of words) {
                if (word.length > 0) {
                    for (let i = 1; i <= word.length; i++) {
                        tokens.add(word.substring(0, i));
                    }
                }
            }
            tokens.add(version);
        }
        tokens.add(name);

        return Array.from(tokens)
            .filter(token => token.length > 0 && token.length <= 100)
            .map(token => this.sanitizeFieldValue(token))
            .filter(token => token && token.length > 0);
    }

    /**
     * Transform artist data for Firestore
     */
    transformArtist(artist) {
        if (!artist.name || !artist.url) {
            this.errorLogger.logError('invalid_artist_data', {
                artist: artist
            }, 'Missing name or URL');
            return null;
        }

        const slug = this.extractSlug(artist.url);
        if (!slug) {
            this.errorLogger.logError('invalid_slug', {
                artist: artist.name,
                url: artist.url
            }, 'Could not extract valid slug');
            return null;
        }

        const sanitizedName = this.sanitizeFieldValue(artist.name);
        const sanitizedUrl = this.sanitizeFieldValue(artist.url);

        if (!sanitizedName || !sanitizedUrl) {
            this.errorLogger.logError('sanitization_failed', {
                artist: artist.name
            }, 'Failed to sanitize data');
            return null;
        }

        const nameForSorting = sanitizedName.toLowerCase().replace(/^(the |a |an )/, '');
        const firstLetter = nameForSorting.charAt(0).toLowerCase();
        const searchTokens = this.generateSearchTokens(sanitizedName);

        return {
            slug: slug,
            name: sanitizedName,
            url: sanitizedUrl,
            geniusId: artist.id ? parseInt(artist.id, 10) : null,
            type: artist.type || 'regular',
            searchTokens: searchTokens,
            nameForSorting: nameForSorting,
            uploadedAt: getCurrentISO(),
            firstLetter: firstLetter,
            isPopular: artist.type === 'popular'
        };
    }

    /**
     * Check if artist exists in Firestore
     */
    async checkArtistExists(slug) {
        try {
            const artistRef = doc(this.db, 'artists', slug);
            const docSnap = await getDoc(artistRef);
            return docSnap.exists();
        } catch (error) {
            this.errorLogger.logError('firestore_check_failed', {
                slug
            }, error.message);
            return false;
        }
    }

    /**
     * Load new artists
     */
    async loadNewArtists() {
        const timestamp = this.inputTimestamp || await paths.findLatestTimestamp('new-artists');

        if (!timestamp) {
            throw new Error('No new-artists data found. Run compare-artists.js first.');
        }

        const inputDir = paths.getNewArtistsDir(timestamp);
        const isComplete = await paths.isDirectoryComplete(inputDir);

        if (!isComplete) {
            tui.printWarning(`New-artists directory not marked complete: ${inputDir}`);
        }

        tui.printInfo(`Loading new artists from: ${timestamp}`);

        const allArtists = [];
        const letters = paths.getAllLetters();

        for (const letter of letters) {
            const filePath = paths.getLetterFilePath(inputDir, letter, 'new-artists');

            try {
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);

                if (data.newArtists && data.newArtists.length > 0) {
                    allArtists.push(...data.newArtists);
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
        if (this.maxArtists && this.maxArtists < allArtists.length) {
            tui.printWarning(`Limiting to first ${this.maxArtists} artists for testing`);
            allArtists.splice(this.maxArtists);
        }

        this.stats.totalArtists = allArtists.length;
        tui.printInfo(`Loaded ${tui.formatNumber(allArtists.length)} new artists`);

        return { allArtists, timestamp };
    }

    /**
     * Upload batch of artists
     */
    async uploadBatch(artists, batchNum, totalBatches) {
        const batch = writeBatch(this.db);
        const artistsCollection = collection(this.db, 'artists');
        let uploadedInBatch = 0;
        let skippedInBatch = 0;
        let failedInBatch = 0;

        for (const rawArtist of artists) {
            try {
                const artist = this.transformArtist(rawArtist);
                if (!artist) {
                    failedInBatch++;
                    continue;
                }

                if (this.skipExisting && await this.checkArtistExists(artist.slug)) {
                    skippedInBatch++;
                    continue;
                }

                if (!this.dryRun) {
                    const docRef = doc(artistsCollection, artist.slug);
                    const { slug, ...documentData } = artist;
                    batch.set(docRef, documentData, { merge: true });
                }
                uploadedInBatch++;
            } catch (error) {
                this.errorLogger.logError('batch_preparation_failed', {
                    artist: rawArtist.name
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
        tui.printHeader('UPLOAD ARTISTS TO FIRESTORE');

        if (this.dryRun) {
            tui.printWarning('DRY RUN MODE: No data will be uploaded');
        }

        // Initialize Firebase
        this.initFirebase();

        // Load new artists
        const { allArtists, timestamp: sourceTimestamp } = await this.loadNewArtists();

        if (allArtists.length === 0) {
            tui.printInfo('No new artists to upload!');
            return null;
        }

        // Process in batches
        const totalBatches = Math.ceil(allArtists.length / this.batchSize);
        tui.printInfo(`Uploading in ${totalBatches} batches of ${this.batchSize}`);

        const progressBar = tui.createProgressBar(
            'Uploading Artists',
            allArtists.length,
            'Initializing...'
        );

        for (let i = 0; i < totalBatches; i++) {
            const startIdx = i * this.batchSize;
            const endIdx = Math.min(startIdx + this.batchSize, allArtists.length);
            const batchArtists = allArtists.slice(startIdx, endIdx);

            const result = await this.uploadBatch(batchArtists, i + 1, totalBatches);

            this.stats.processedArtists += batchArtists.length;
            this.stats.uploadedArtists += result.uploaded;
            this.stats.skippedArtists += result.skipped;
            this.stats.failedArtists += result.failed;

            progressBar.update(this.stats.processedArtists, {
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
            const summaryPath = `${outputDir}/artist-upload-summary.json`;
            const summary = {
                timestamp: getCurrentISO(),
                sourceDirectory: `scraping-data/new-artists/${sourceTimestamp}`,
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
            'Total Artists': tui.formatNumber(this.stats.totalArtists),
            'Processed': tui.formatNumber(this.stats.processedArtists),
            'Uploaded': tui.formatNumber(this.stats.uploadedArtists),
            'Skipped': tui.formatNumber(this.stats.skippedArtists),
            'Failed': tui.formatNumber(this.stats.failedArtists),
            'Success Rate': `${((this.stats.uploadedArtists / this.stats.totalArtists) * 100).toFixed(1)}%`
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
        maxArtists: null,
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
            options.maxArtists = parseInt(args[i + 1], 10);
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
Usage: node scripts/upload-artists.js [options]

Options:
  --date <timestamp>      Use specific new-artists data (YYYY-MM-DD-HH-MM)
                         Default: use latest
  --limit <number>       Max artists to upload (for testing)
  --batch-size <number>  Artists per batch (default: 500)
  --no-skip              Upload even if artist exists (overwrite)
  --dry-run              Preview only, don't upload
  --help, -h             Show this help message

Examples:
  node scripts/upload-artists.js --dry-run
  node scripts/upload-artists.js --limit 10
  node scripts/upload-artists.js --date 2026-01-04-21-01
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

    const uploader = new ArtistUploader({
        timestamp: options.timestamp,
        maxArtists: options.maxArtists,
        dryRun: options.dryRun,
        skipExisting: options.skipExisting,
        batchSize: options.batchSize
    });

    try {
        const result = await uploader.upload();

        if (result) {
            uploader.displayResults();
            tui.printSuccess('Artist upload complete!');
            
            // Display total workflow time
            const totalElapsed = await getWorkflowElapsed();
            if (totalElapsed !== null) {
                await tui.printTotalWorkflowTime(totalElapsed);
            }
            
            if (!options.dryRun) {
                tui.printInfo('Data gathering phase complete!');
                tui.printInfo('Review the scraped data, then run:');
                console.log('');
                console.log('  npm run upload');
                console.log('');
                tui.printInfo('This will upload songs and update popular flags.');
            }
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

export default ArtistUploader;


