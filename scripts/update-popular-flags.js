#!/usr/bin/env node

/**
 * Update Popular Flags in Firestore
 * Updates popular artist flags based on comparison report
 */

import fs from 'fs/promises';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, deleteField } from 'firebase/firestore';
import { firebaseConfig } from '../src/lib/services/initFirebase.js';
import * as tui from './utils/tui.js';
import * as paths from './utils/paths.js';
import { generateTimestamp, getCurrentISO, getWorkflowElapsed } from './utils/timestamp.js';
import { createErrorLogger } from './utils/error-logger.js';

class PopularFlagsUpdater {
    constructor(options = {}) {
        this.inputTimestamp = options.timestamp || null;
        this.dryRun = options.dryRun || false;
        this.errorLogger = createErrorLogger('popular-flags-update');
        this.db = null;
        this.stats = {
            totalChanges: 0,
            toAdd: 0,
            toRemove: 0,
            addedSuccessfully: 0,
            removedSuccessfully: 0,
            failed: 0
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
     * Load comparison report
     */
    async loadComparisonReport() {
        const timestamp = this.inputTimestamp || await paths.findLatestTimestamp('new-artists');

        if (!timestamp) {
            throw new Error('No comparison data found. Run compare-artists.js first.');
        }

        const inputDir = paths.getNewArtistsDir(timestamp);
        const reportPath = `${inputDir}/comparison-report.json`;

        tui.printInfo(`Loading comparison report from: ${timestamp}`);

        try {
            const content = await fs.readFile(reportPath, 'utf8');
            const report = JSON.parse(content);

            const popularUpdates = report.popularUpdates || { toAdd: [], toRemove: [] };
            
            this.stats.toAdd = popularUpdates.toAdd.length;
            this.stats.toRemove = popularUpdates.toRemove.length;
            this.stats.totalChanges = this.stats.toAdd + this.stats.toRemove;

            tui.printInfo(`Found ${this.stats.toAdd} artists to add popular flag`);
            tui.printInfo(`Found ${this.stats.toRemove} artists to remove popular flag`);

            return { popularUpdates, timestamp };
        } catch (error) {
            throw new Error(`Failed to load comparison report: ${error.message}`);
        }
    }

    /**
     * Add popular flag to an artist
     */
    async addPopularFlag(slug, name) {
        try {
            if (this.dryRun) {
                return true;
            }

            const artistRef = doc(this.db, 'artists', slug);
            await updateDoc(artistRef, {
                isPopular: true,
                type: 'popular',
                updatedAt: getCurrentISO()
            });

            return true;
        } catch (error) {
            this.errorLogger.logError('add_popular_failed', {
                slug,
                name
            }, error.message);
            return false;
        }
    }

    /**
     * Remove popular flag from an artist
     */
    async removePopularFlag(slug, name) {
        try {
            if (this.dryRun) {
                return true;
            }

            const artistRef = doc(this.db, 'artists', slug);
            await updateDoc(artistRef, {
                isPopular: false,
                type: 'regular',
                updatedAt: getCurrentISO()
            });

            return true;
        } catch (error) {
            this.errorLogger.logError('remove_popular_failed', {
                slug,
                name
            }, error.message);
            return false;
        }
    }

    /**
     * Run update
     */
    async update() {
        tui.printHeader('UPDATE POPULAR FLAGS IN FIRESTORE');

        if (this.dryRun) {
            tui.printWarning('DRY RUN MODE: No data will be updated');
        }

        // Initialize Firebase
        this.initFirebase();

        // Load comparison report
        const { popularUpdates, timestamp: sourceTimestamp } = await this.loadComparisonReport();

        if (this.stats.totalChanges === 0) {
            tui.printInfo('No popular flag changes needed!');
            return null;
        }

        const progressBar = tui.createProgressBar(
            'Updating Popular Flags',
            this.stats.totalChanges,
            'Initializing...'
        );

        let processed = 0;

        // Add popular flags
        for (const artist of popularUpdates.toAdd) {
            const success = await this.addPopularFlag(artist.slug, artist.name);
            if (success) {
                this.stats.addedSuccessfully++;
            } else {
                this.stats.failed++;
            }
            processed++;
            progressBar.update(processed, {
                info: `Adding popular: ${artist.name}`
            });

            // Small delay
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Remove popular flags
        for (const artist of popularUpdates.toRemove) {
            const success = await this.removePopularFlag(artist.slug, artist.name);
            if (success) {
                this.stats.removedSuccessfully++;
            } else {
                this.stats.failed++;
            }
            processed++;
            progressBar.update(processed, {
                info: `Removing popular: ${artist.name}`
            });

            // Small delay
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        progressBar.stop();

        // Save summary
        if (!this.dryRun) {
            const outputDir = await paths.createTimestampedDir('upload-results', generateTimestamp());
            const summaryPath = `${outputDir}/popular-flags-update-summary.json`;
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
        tui.printStats('Update Results', {
            'Total Changes': tui.formatNumber(this.stats.totalChanges),
            'Added Popular': tui.formatNumber(this.stats.addedSuccessfully),
            'Removed Popular': tui.formatNumber(this.stats.removedSuccessfully),
            'Failed': tui.formatNumber(this.stats.failed),
            'Success Rate': `${(((this.stats.addedSuccessfully + this.stats.removedSuccessfully) / this.stats.totalChanges) * 100).toFixed(1)}%`
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
        dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--date' && args[i + 1]) {
            options.timestamp = args[i + 1];
            i++;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Usage: node scripts/update-popular-flags.js [options]

Options:
  --date <timestamp>      Use specific comparison data (YYYY-MM-DD-HH-MM)
                         Default: use latest
  --dry-run              Preview only, don't update
  --help, -h             Show this help message

Examples:
  node scripts/update-popular-flags.js --dry-run
  node scripts/update-popular-flags.js --date 2026-01-04-21-01
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

    const updater = new PopularFlagsUpdater({
        timestamp: options.timestamp,
        dryRun: options.dryRun
    });

    try {
        const result = await updater.update();

        if (result) {
            updater.displayResults();
            
            const workflowElapsed = await getWorkflowElapsed();
            if (workflowElapsed !== null) {
                tui.printWorkflowTime(workflowElapsed);
            }
            
            tui.printSuccess('Popular flags update complete!');
        } else {
            tui.printInfo('No work to do.');
        }

        tui.printFooter();
    } catch (error) {
        tui.printError(`Update failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default PopularFlagsUpdater;


