#!/usr/bin/env node

/**
 * Artist List Scraper
 * Scrapes artist lists from Genius and saves to timestamped directories
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import * as tui from './utils/tui.js';
import * as paths from './utils/paths.js';
import { generateTimestamp, getCurrentISO, calculateETA } from './utils/timestamp.js';
import { createErrorLogger } from './utils/error-logger.js';

class ArtistScraper {
    constructor(options = {}) {
        this.baseUrl = 'https://genius.com/artists-index/';
        this.requestDelay = options.requestDelay || 500;
        this.includeIds = options.includeIds !== false;
        this.maxArtistsPerLetter = options.maxArtistsPerLetter || null; // Limit for testing
        this.outputDir = options.outputDir || null;
        this.errorLogger = createErrorLogger('artist-scraping');
        this.stats = {
            totalArtists: 0,
            popularArtists: 0,
            regularArtists: 0,
            artistsWithIds: 0,
            idExtractionFailed: 0,
            networkErrors: 0
        };
    }
    
    /**
     * Extract artist ID from iOS app link
     */
    async extractArtistId(artistUrl, artistName) {
        try {
            await new Promise(resolve => setTimeout(resolve, this.requestDelay));
            
            const response = await axios.get(artistUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                },
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const iosAppLink = $('link[rel="alternate"][href*="ios-app://"]').attr('href');
            
            if (iosAppLink) {
                const match = iosAppLink.match(/\/artists\/(\d+)$/);
                if (match) {
                    this.stats.artistsWithIds++;
                    return match[1];
                }
            }
            
            this.stats.idExtractionFailed++;
            this.errorLogger.logError('id_extraction_failed', {
                artist: artistName,
                url: artistUrl
            }, 'iOS app link not found');
            
            return null;
        } catch (error) {
            this.stats.idExtractionFailed++;
            
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                this.errorLogger.logError('network_timeout', {
                    artist: artistName,
                    url: artistUrl
                }, `Request timeout: ${error.message}`);
            } else {
                this.errorLogger.logError('network_error', {
                    artist: artistName,
                    url: artistUrl
                }, error.message);
            }
            
            return null;
        }
    }
    
    /**
     * Scrape artists for a specific letter
     */
    async scrapeArtistsByLetter(letter) {
        const url = `${this.baseUrl}${letter.toLowerCase()}`;
        
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });
            
            const $ = cheerio.load(response.data);
            const results = {
                popular: [],
                regular: []
            };
            
            // Extract popular artists
            $('li.artists_index_list-popular_artist').each((index, element) => {
                const artistLink = $(element).find('a.artists_index_list-artist_name');
                const name = artistLink.text().trim();
                const url = artistLink.attr('href');
                
                if (name && url) {
                    results.popular.push({
                        name,
                        url,
                        type: 'popular',
                        id: null
                    });
                }
            });
            
            // Extract regular artists
            const regularArtistLists = $('ul.artists_index_list').not(':has(.artists_index_list-popular_artist)');
            regularArtistLists.each((listIndex, listElement) => {
                $(listElement).find('li').each((index, element) => {
                    const artistLink = $(element).find('a').first();
                    const name = artistLink.text().trim();
                    const url = artistLink.attr('href');
                    
                    if (name && url && url.includes('/artists/')) {
                        results.regular.push({
                            name,
                            url,
                            type: 'regular',
                            id: null
                        });
                    }
                });
            });
            
            // Apply limit if specified (for testing)
            if (this.maxArtistsPerLetter) {
                const totalArtists = results.popular.length + results.regular.length;
                if (totalArtists > this.maxArtistsPerLetter) {
                    // Prioritize popular artists, then regular
                    if (results.popular.length >= this.maxArtistsPerLetter) {
                        results.popular = results.popular.slice(0, this.maxArtistsPerLetter);
                        results.regular = [];
                    } else {
                        const remainingSlots = this.maxArtistsPerLetter - results.popular.length;
                        results.regular = results.regular.slice(0, remainingSlots);
                    }
                }
            }
            
            this.stats.popularArtists += results.popular.length;
            this.stats.regularArtists += results.regular.length;
            this.stats.totalArtists += results.popular.length + results.regular.length;
            
            return results;
            
        } catch (error) {
            this.stats.networkErrors++;
            this.errorLogger.logError('network_error', {
                letter,
                url
            }, error.message);
            
            return { popular: [], regular: [] };
        }
    }
    
    /**
     * Extract IDs for all artists in results
     */
    async extractIds(results, letter, progressBar) {
        const allArtists = [...results.popular, ...results.regular];
        const total = allArtists.length;
        
        for (let i = 0; i < total; i++) {
            const artist = allArtists[i];
            artist.id = await this.extractArtistId(artist.url, artist.name);
            
            if (progressBar) {
                progressBar.update(i + 1, {
                    info: `Letter ${letter.toUpperCase()} - ${artist.name.substring(0, 30)}`
                });
            }
        }
    }
    
    /**
     * Save letter results to file
     */
    async saveLetterFile(letter, results, outputDir) {
        const filePath = paths.getLetterFilePath(outputDir, letter, 'artists');
        const data = {
            letter: letter.toUpperCase(),
            scrapedAt: getCurrentISO(),
            totalArtists: results.popular.length + results.regular.length,
            popularCount: results.popular.length,
            regularCount: results.regular.length,
            artists: results
        };
        
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    }
    
    /**
     * Scrape all letters
     */
    async scrapeAll(lettersToScrape = null) {
        const timestamp = generateTimestamp();
        const outputDir = this.outputDir || await paths.createTimestampedDir('artist-lists', timestamp);
        
        tui.printHeader('ARTIST LIST SCRAPER');
        tui.printInfo(`Output directory: ${outputDir}`);
        tui.printInfo(`Include IDs: ${this.includeIds ? 'Yes' : 'No (faster)'}`);
        
        if (this.maxArtistsPerLetter) {
            tui.printWarning(`Limiting to ${this.maxArtistsPerLetter} artists per letter (testing mode)`);
        }
        
        const allLetters = paths.getAllLetters();
        const letters = lettersToScrape || allLetters;
        
        tui.printInfo(`Letters to scrape: ${letters.length} (${letters.join(', ')})`);
        console.log('');
        
        const startTime = Date.now();
        const progressBar = tui.createProgressBar('Scraping Progress', letters.length);
        
        for (let i = 0; i < letters.length; i++) {
            const letter = letters[i];
            const displayLetter = letter === '0' ? 'Numbers' : letter.toUpperCase();
            
            progressBar.update(i, {
                info: `Current: Letter ${displayLetter}`
            });
            
            // Scrape artists for this letter
            const results = await this.scrapeArtistsByLetter(letter);
            
            // Extract IDs if requested
            if (this.includeIds && (results.popular.length > 0 || results.regular.length > 0)) {
                const idBar = tui.createProgressBar(`  Extracting IDs (${displayLetter})`, 
                    results.popular.length + results.regular.length);
                await this.extractIds(results, letter, idBar);
                idBar.stop();
            }
            
            // Save to file
            await this.saveLetterFile(letter, results, outputDir);
            
            // Update progress
            const elapsed = (Date.now() - startTime) / 1000;
            const eta = calculateETA(i + 1, letters.length, elapsed);
            progressBar.update(i + 1, {
                info: `Completed: ${displayLetter} | ETA: ${eta}`
            });
            
            // Delay between letters
            if (i < letters.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        progressBar.stop();
        
        // Save summary and errors
        await this.saveSummary(outputDir, timestamp, letters);
        await this.errorLogger.saveToFile(outputDir);
        await paths.markDirectoryComplete(outputDir);
        
        return { outputDir, timestamp };
    }
    
    /**
     * Save summary.json
     */
    async saveSummary(outputDir, timestamp, letters) {
        const summary = {
            timestamp: getCurrentISO(),
            timestampDir: timestamp,
            lettersScraped: letters,
            statistics: {
                totalArtists: this.stats.totalArtists,
                popularArtists: this.stats.popularArtists,
                regularArtists: this.stats.regularArtists,
                artistsWithIds: this.stats.artistsWithIds,
                idExtractionFailed: this.stats.idExtractionFailed
            },
            errors: this.errorLogger.getSummary()
        };
        
        const summaryPath = `${outputDir}/summary.json`;
        await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    }
    
    /**
     * Display final results
     */
    displayResults() {
        console.log('');
        tui.printStats('Statistics', {
            'Total Artists': tui.formatNumber(this.stats.totalArtists),
            'Popular Artists': tui.formatNumber(this.stats.popularArtists),
            'Regular Artists': tui.formatNumber(this.stats.regularArtists),
            'Artists with IDs': tui.formatNumber(this.stats.artistsWithIds),
            'ID Extraction Failed': tui.formatNumber(this.stats.idExtractionFailed)
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
        letters: null,
        includeIds: true,
        maxArtistsPerLetter: null,
        outputDir: null,
        quiet: false
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--letters' && args[i + 1]) {
            const letterArg = args[i + 1];
            options.letters = letterArg.split(',').map(l => l.trim().toLowerCase());
            i++;
        } else if (arg === '--no-ids') {
            options.includeIds = false;
        } else if (arg === '--limit' && args[i + 1]) {
            options.maxArtistsPerLetter = parseInt(args[i + 1], 10);
            i++;
        } else if (arg === '--output-dir' && args[i + 1]) {
            options.outputDir = args[i + 1];
            i++;
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Usage: node scripts/scrape-artists.js [options]

Options:
  --letters <letters>     Comma-separated letters to scrape (e.g., "a,b,c" or "j,k")
                         Default: all letters (0, a-z)
  --no-ids               Skip artist ID extraction (much faster)
  --limit <number>       Max artists per letter (for testing)
  --output-dir <path>    Custom output directory
  --quiet                Minimal output (no TUI)
  --help, -h             Show this help message

Examples:
  node scripts/scrape-artists.js
  node scripts/scrape-artists.js --letters j --limit 10
  node scripts/scrape-artists.js --letters j,k
  node scripts/scrape-artists.js --no-ids
  node scripts/scrape-artists.js --letters a,b,c --no-ids
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
    
    const scraper = new ArtistScraper({
        includeIds: options.includeIds,
        maxArtistsPerLetter: options.maxArtistsPerLetter,
        outputDir: options.outputDir
    });
    
    try {
        const { outputDir, timestamp } = await scraper.scrapeAll(options.letters);
        
        scraper.displayResults();
        
        tui.printSuccess(`Scraping complete!`);
        tui.printInfo(`Output: ${outputDir}`);
        tui.printFooter();
        
    } catch (error) {
        tui.printError(`Scraping failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default ArtistScraper;

