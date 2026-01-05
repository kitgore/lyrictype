#!/usr/bin/env node

/**
 * Artist Comparison Script
 * Compares scraped artist lists with Firestore to identify new artists
 */

import fs from 'fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, limit, startAfter } from 'firebase/firestore';
import { firebaseConfig } from '../src/lib/services/initFirebase.js';
import * as tui from './utils/tui.js';
import * as paths from './utils/paths.js';
import { generateTimestamp, getCurrentISO, calculateETA, getWorkflowElapsed } from './utils/timestamp.js';
import { createErrorLogger } from './utils/error-logger.js';

class ArtistComparator {
    constructor(options = {}) {
        this.inputTimestamp = options.timestamp || null;
        this.outputDir = options.outputDir || null;
        this.errorLogger = createErrorLogger('artist-comparison');
        this.stats = {
            geniusTotal: 0,
            firestoreTotal: 0,
            newArtists: 0,
            existingArtists: 0,
            popularInGenius: 0,
            popularInFirestore: 0,
            popularToAdd: 0,
            popularToRemove: 0
        };
        this.firestoreArtists = new Map(); // Map of slug -> artist data
    }
    
    /**
     * Extract slug from Genius artist URL
     * @param {string} url - The Genius artist URL
     * @returns {string|null} The artist slug
     */
    extractSlug(url) {
        if (!url) return null;
        const match = url.match(/\/artists\/([^/?#]+)/);
        return match ? match[1].toLowerCase() : null;
    }
    
    /**
     * Load artist lists from scraping-data
     */
    async loadArtistLists() {
        const timestamp = this.inputTimestamp || await paths.findLatestTimestamp('artist-lists');
        
        if (!timestamp) {
            throw new Error('No artist lists found. Run scrape-artists.js first.');
        }
        
        const inputDir = paths.getArtistListsDir(timestamp);
        const isComplete = await paths.isDirectoryComplete(inputDir);
        
        if (!isComplete) {
            tui.printWarning(`Artist list directory not marked complete: ${inputDir}`);
        }
        
        tui.printInfo(`Loading artist lists from: ${timestamp}`);
        
        const allArtists = [];
        const letters = paths.getAllLetters();
        
        for (const letter of letters) {
            const filePath = paths.getLetterFilePath(inputDir, letter, 'artists');
            
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);
                
                // Add artists with letter metadata
                if (data.artists && data.artists.popular) {
                    data.artists.popular.forEach(artist => {
                        allArtists.push({ ...artist, letter, source: 'popular' });
                    });
                }
                
                if (data.artists && data.artists.regular) {
                    data.artists.regular.forEach(artist => {
                        allArtists.push({ ...artist, letter, source: 'regular' });
                    });
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
        
        this.stats.geniusTotal = allArtists.length;
        this.stats.popularInGenius = allArtists.filter(a => a.type === 'popular').length;
        
        tui.printInfo(`Loaded ${tui.formatNumber(allArtists.length)} artists from Genius`);
        
        return { allArtists, timestamp, inputDir };
    }
    
    /**
     * Fetch all artists from Firestore
     */
    async fetchFirestoreArtists() {
        tui.printInfo('Fetching artists from Firestore...');
        
        const app = initializeApp(firebaseConfig);
        const db = getFirestore(app);
        
        const artistsRef = collection(db, 'artists');
        let lastDoc = null;
        let batchCount = 0;
        const batchSize = 1000;
        
        const progressBar = tui.createProgressBar('Fetching from Firestore', 100);
        
        while (true) {
            batchCount++;
            
            let q = query(artistsRef, orderBy('name'), limit(batchSize));
            if (lastDoc) {
                q = query(artistsRef, orderBy('name'), startAfter(lastDoc), limit(batchSize));
            }
            
            try {
                const snapshot = await getDocs(q);
                
                if (snapshot.empty) {
                    break;
                }
                
                snapshot.docs.forEach(doc => {
                    const data = doc.data();
                    // Use document ID (slug) as the key for reliable comparison
                    this.firestoreArtists.set(doc.id.toLowerCase(), {
                        slug: doc.id,
                        name: data.name,
                        geniusId: data.geniusId || null,
                        type: data.type || 'regular',
                        url: data.url || null
                    });
                });
                
                lastDoc = snapshot.docs[snapshot.docs.length - 1];
                
                // Update progress (estimate based on batch count)
                const progress = Math.min(95, batchCount * 5);
                progressBar.update(progress);
                
            } catch (error) {
                this.errorLogger.logError('firestore_fetch_error', {
                    batch: batchCount
                }, error.message);
                break;
            }
        }
        
        progressBar.update(100);
        progressBar.stop();
        
        this.stats.firestoreTotal = this.firestoreArtists.size;
        this.stats.popularInFirestore = Array.from(this.firestoreArtists.values())
            .filter(a => a.type === 'popular').length;
        
        tui.printInfo(`Loaded ${tui.formatNumber(this.firestoreArtists.size)} artists from Firestore`);
    }
    
    /**
     * Compare and identify new artists
     */
    compareArtists(geniusArtists) {
        tui.printInfo('Comparing artist lists...');
        
        const newArtists = [];
        const existingArtists = [];
        const popularUpdates = {
            toAdd: [],
            toRemove: []
        };
        
        // Identify new artists by comparing slugs
        for (const artist of geniusArtists) {
            const slug = this.extractSlug(artist.url);
            
            if (!slug) {
                // Can't extract slug, treat as new
                newArtists.push(artist);
                continue;
            }
            
            if (this.firestoreArtists.has(slug.toLowerCase())) {
                existingArtists.push(artist);
            } else {
                newArtists.push(artist);
            }
        }
        
        // Identify popular status changes by comparing slugs
        // First, find all current popular artists in Firestore (by slug)
        const currentPopularSlugs = new Set(
            Array.from(this.firestoreArtists.entries())
                .filter(([slug, data]) => data.type === 'popular')
                .map(([slug, data]) => slug.toLowerCase())
        );
        
        // Find artists that should be popular (from Genius, by slug)
        const shouldBePopularSlugs = new Set();
        for (const artist of geniusArtists) {
            if (artist.type === 'popular') {
                const slug = this.extractSlug(artist.url);
                if (slug) {
                    shouldBePopularSlugs.add(slug.toLowerCase());
                }
            }
        }
        
        // Artists to add popular flag (in Genius popular but not in Firestore popular)
        for (const artist of geniusArtists) {
            if (artist.type === 'popular') {
                const slug = this.extractSlug(artist.url);
                if (slug) {
                    const slugLower = slug.toLowerCase();
                    if (this.firestoreArtists.has(slugLower) && !currentPopularSlugs.has(slugLower)) {
                        popularUpdates.toAdd.push({
                            name: artist.name,
                            slug: slug,
                            action: 'add_popular',
                            reason: 'now_in_genius_popular_top_20'
                        });
                    }
                }
            }
        }
        
        // Artists to remove popular flag (in Firestore popular but not in Genius popular)
        for (const [slug, firestoreArtist] of this.firestoreArtists.entries()) {
            if (firestoreArtist.type === 'popular' && !shouldBePopularSlugs.has(slug.toLowerCase())) {
                popularUpdates.toRemove.push({
                    name: firestoreArtist.name,
                    slug: slug,
                    action: 'remove_popular',
                    reason: 'no_longer_in_genius_popular_top_20'
                });
            }
        }
        
        this.stats.newArtists = newArtists.length;
        this.stats.existingArtists = existingArtists.length;
        this.stats.popularToAdd = popularUpdates.toAdd.length;
        this.stats.popularToRemove = popularUpdates.toRemove.length;
        
        return { newArtists, popularUpdates };
    }
    
    /**
     * Save new artists by letter
     */
    async saveNewArtistsByLetter(newArtists, outputDir, sourceTimestamp) {
        const artistsByLetter = {};
        
        // Group by letter
        for (const artist of newArtists) {
            const letter = artist.letter || '0';
            if (!artistsByLetter[letter]) {
                artistsByLetter[letter] = [];
            }
            artistsByLetter[letter].push(artist);
        }
        
        // Save each letter file
        const letters = paths.getAllLetters();
        for (const letter of letters) {
            const artists = artistsByLetter[letter] || [];
            const filePath = paths.getLetterFilePath(outputDir, letter, 'new-artists');
            
            const data = {
                letter: letter.toUpperCase(),
                comparisonDate: getCurrentISO(),
                sourceTimestamp,
                newArtists: artists,
                count: artists.length
            };
            
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        }
    }
    
    /**
     * Save comparison report
     */
    async saveComparisonReport(outputDir, sourceTimestamp, popularUpdates) {
        const perLetter = {};
        const newArtistsByLetter = {};
        
        // Calculate per-letter statistics
        const letters = paths.getAllLetters();
        for (const letter of letters) {
            const filePath = paths.getLetterFilePath(outputDir, letter, 'new-artists');
            
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);
                newArtistsByLetter[letter] = data.count;
                perLetter[letter] = {
                    newCount: data.count
                };
            } catch {
                newArtistsByLetter[letter] = 0;
            }
        }
        
        const report = {
            timestamp: getCurrentISO(),
            sourceDirectory: `scraping-data/artist-lists/${sourceTimestamp}`,
            statistics: {
                totalGeniusArtists: this.stats.geniusTotal,
                totalFirestoreArtists: this.stats.firestoreTotal,
                newArtists: this.stats.newArtists,
                existingArtists: this.stats.existingArtists,
                popularChanges: {
                    addedToPopular: this.stats.popularToAdd,
                    removedFromPopular: this.stats.popularToRemove,
                    totalChanges: this.stats.popularToAdd + this.stats.popularToRemove
                }
            },
            newArtistsByLetter,
            popularUpdates,
            errors: this.errorLogger.getSummary()
        };
        
        const reportPath = `${outputDir}/comparison-report.json`;
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    }
    
    /**
     * Run comparison
     */
    async compare() {
        tui.printHeader('ARTIST COMPARISON');
        
        // Load Genius artists
        const { allArtists, timestamp: sourceTimestamp, inputDir } = await this.loadArtistLists();
        
        // Fetch Firestore artists
        await this.fetchFirestoreArtists();
        
        // Compare
        const { newArtists, popularUpdates } = this.compareArtists(allArtists);
        
        // Prepare output directory
        const outputTimestamp = generateTimestamp();
        const outputDir = this.outputDir || await paths.createTimestampedDir('new-artists', outputTimestamp);
        
        tui.printInfo(`Saving results to: ${outputTimestamp}`);
        
        // Save filtered lists
        await this.saveNewArtistsByLetter(newArtists, outputDir, sourceTimestamp);
        
        // Save comparison report
        await this.saveComparisonReport(outputDir, sourceTimestamp, popularUpdates);
        
        // Save errors if any
        await this.errorLogger.saveToFile(outputDir);
        
        // Mark complete
        await paths.markDirectoryComplete(outputDir);
        
        return { outputDir, outputTimestamp };
    }
    
    /**
     * Display results
     */
    displayResults() {
        console.log('');
        tui.printStats('Comparison Results', {
            'Genius Artists': tui.formatNumber(this.stats.geniusTotal),
            'Firestore Artists': tui.formatNumber(this.stats.firestoreTotal),
            'New Artists': tui.formatNumber(this.stats.newArtists),
            'Existing Artists': tui.formatNumber(this.stats.existingArtists)
        });
        
        if (this.stats.popularToAdd > 0 || this.stats.popularToRemove > 0) {
            console.log('');
            tui.printStats('Popular Status Changes', {
                'To Add': tui.formatNumber(this.stats.popularToAdd),
                'To Remove': tui.formatNumber(this.stats.popularToRemove),
                'Total Changes': tui.formatNumber(this.stats.popularToAdd + this.stats.popularToRemove)
            });
        }
        
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
        outputDir: null,
        dryRun: false,
        quiet: false
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--date' && args[i + 1]) {
            options.timestamp = args[i + 1];
            i++;
        } else if (arg === '--output-dir' && args[i + 1]) {
            options.outputDir = args[i + 1];
            i++;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Usage: node scripts/compare-artists.js [options]

Options:
  --date <timestamp>      Use specific artist list timestamp (YYYY-MM-DD-HH-MM)
                         Default: use latest
  --output-dir <path>    Custom output directory
  --dry-run              Preview only, don't save files
  --quiet                Minimal output
  --help, -h             Show this help message

Examples:
  node scripts/compare-artists.js
  node scripts/compare-artists.js --date 2026-01-04-18-30
  node scripts/compare-artists.js --dry-run
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
    
    if (options.dryRun) {
        tui.printWarning('DRY RUN MODE: No files will be saved');
    }
    
    const comparator = new ArtistComparator({
        timestamp: options.timestamp,
        outputDir: options.outputDir
    });
    
    try {
        const { outputDir, outputTimestamp } = await comparator.compare();
        
        comparator.displayResults();
        
        const workflowElapsed = await getWorkflowElapsed();
        if (workflowElapsed !== null) {
            tui.printWorkflowTime(workflowElapsed);
        }
        
        tui.printSuccess('Comparison complete!');
        tui.printInfo(`Output: ${outputDir}`);
        tui.printFooter();
        
    } catch (error) {
        tui.printError(`Comparison failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default ArtistComparator;

