#!/usr/bin/env node

/**
 * Prescrape New Artists
 * Scrapes song data for newly identified artists from comparison step
 */

import fs from 'fs/promises';
import * as cheerio from 'cheerio';
import * as tui from './utils/tui.js';
import * as paths from './utils/paths.js';
import { generateTimestamp, getCurrentISO } from './utils/timestamp.js';
import { createErrorLogger } from './utils/error-logger.js';

class NewArtistPrescraper {
    constructor(options = {}) {
        this.inputTimestamp = options.timestamp || null;
        this.outputDir = options.outputDir || null;
        this.maxSongsPerArtist = options.maxSongsPerArtist || 10;
        this.maxArtists = options.maxArtists || null; // Limit total artists for testing
        this.letters = options.letters || paths.getAllLetters();
        this.dryRun = options.dryRun || false;
        this.delays = {
            betweenArtists: options.delayBetweenArtists || 1000,
            betweenSongs: options.delayBetweenSongs || 500,
            betweenPages: options.delayBetweenPages || 200
        };
        this.api = {
            timeout: options.timeout || 10000,
            maxRetries: options.maxRetries || 3,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        };
        this.errorLogger = createErrorLogger('prescraper');
        this.stats = {
            totalArtists: 0,
            processedArtists: 0,
            skippedArtists: 0,
            totalSongs: 0,
            processedSongs: 0,
            scrapedLyrics: 0,
            failedLyrics: 0
        };
        this.currentProgress = {
            letter: '',
            artist: '',
            song: ''
        };
    }

    /**
     * Delay utility
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Fetch with timeout and retries
     */
    async fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.api.timeout);

        let lastError;
        for (let attempt = 1; attempt <= this.api.maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        'User-Agent': this.api.userAgent,
                        ...options.headers
                    }
                });

                clearTimeout(timeoutId);

                if (!response.ok && response.status >= 500) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return response;
            } catch (error) {
                lastError = error;
                clearTimeout(timeoutId);

                if (attempt < this.api.maxRetries) {
                    const delayMs = Math.pow(2, attempt) * 1000;
                    await this.delay(delayMs);
                }
            }
        }

        throw lastError || new Error(`Failed after ${this.api.maxRetries} attempts`);
    }

    /**
     * Load new artists from comparison output
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

        const artistsByLetter = {};
        let totalArtists = 0;

        for (const letter of this.letters) {
            const filePath = paths.getLetterFilePath(inputDir, letter, 'new-artists');

            try {
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);

                if (data.newArtists && data.newArtists.length > 0) {
                    artistsByLetter[letter] = data.newArtists;
                    totalArtists += data.newArtists.length;
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

        this.stats.totalArtists = totalArtists;
        // Apply limit if specified
        if (this.maxArtists && this.maxArtists < totalArtists) {
            tui.printWarning(`Limiting to first ${this.maxArtists} artists for testing`);
            let remainingLimit = this.maxArtists;
            
            for (const letter of Object.keys(artistsByLetter)) {
                if (remainingLimit <= 0) {
                    delete artistsByLetter[letter];
                } else if (artistsByLetter[letter].length > remainingLimit) {
                    artistsByLetter[letter] = artistsByLetter[letter].slice(0, remainingLimit);
                    remainingLimit = 0;
                } else {
                    remainingLimit -= artistsByLetter[letter].length;
                }
            }
            
            // Recalculate total
            totalArtists = Object.values(artistsByLetter).reduce((sum, arr) => sum + arr.length, 0);
            this.stats.totalArtists = totalArtists;
        }
        
        tui.printInfo(`Loaded ${tui.formatNumber(totalArtists)} new artists across ${Object.keys(artistsByLetter).length} letters`);

        return { artistsByLetter, timestamp };
    }

    /**
     * Scrape songs for a single artist
     */
    async scrapeArtistSongs(artist) {
        this.currentProgress.artist = artist.name;

        try {
            const response = await this.fetchWithTimeout(artist.url);
            const html = await response.text();
            const $ = cheerio.load(html);

            const songs = [];
            const seenUrls = new Set();
            
            // Find all links containing "-lyrics" in the href
            $('a[href*="-lyrics"]').each((i, el) => {
                if (songs.length >= this.maxSongsPerArtist) return false; // Stop when we have enough
                
                const songUrl = $(el).attr('href');
                if (!songUrl) return;

                // Build full URL
                const fullUrl = songUrl.startsWith('http') ? songUrl : `https://genius.com${songUrl}`;
                
                // Skip if we've already seen this URL
                if (seenUrls.has(fullUrl)) return;
                seenUrls.add(fullUrl);
                
                // Extract title - try multiple methods
                let title = $(el).text().trim();
                
                // If no text, try getting it from the URL
                if (!title || title.length === 0) {
                    const urlMatch = fullUrl.match(/genius\.com\/(.+)-lyrics/);
                    if (urlMatch) {
                        title = urlMatch[1].replace(/-/g, ' ');
                    }
                }
                
                // Only add if we have a valid title and URL looks like a song page
                if (title && title.length > 0 && fullUrl.includes('genius.com/') && fullUrl.includes('-lyrics')) {
                    songs.push({
                        title,
                        url: fullUrl,
                        artist: artist.name,
                        artistUrl: artist.url
                    });
                }
            });

            return songs;
        } catch (error) {
            this.errorLogger.logError('artist_scrape_failed', {
                artist: artist.name,
                url: artist.url
            }, error.message);
            return [];
        }
    }

    /**
     * Scrape lyrics for a single song
     */
    async scrapeSongLyrics(song) {
        this.currentProgress.song = song.title;

        try {
            await this.delay(this.delays.betweenSongs);
            const response = await this.fetchWithTimeout(song.url);
            const html = await response.text();
            const $ = cheerio.load(html);

            let lyrics = '';
            const lyricsContainers = $('[data-lyrics-container="true"]');

            if (lyricsContainers.length > 0) {
                lyricsContainers.each((i, container) => {
                    const text = $(container).text().trim();
                    if (text) {
                        lyrics += text + '\n\n';
                    }
                });
                lyrics = lyrics.trim();
            }

            if (!lyrics || lyrics.length === 0) {
                this.errorLogger.logError('empty_lyrics', {
                    song: song.title,
                    artist: song.artist,
                    url: song.url
                }, 'No lyrics found');
                this.stats.failedLyrics++;
                return null;
            }

            this.stats.scrapedLyrics++;
            return lyrics;
        } catch (error) {
            this.errorLogger.logError('lyrics_scrape_failed', {
                song: song.title,
                artist: song.artist,
                url: song.url
            }, error.message);
            this.stats.failedLyrics++;
            return null;
        }
    }

    /**
     * Process a single letter
     */
    async processLetter(letter, artists, outputDir, progressBar) {
        this.currentProgress.letter = letter.toUpperCase();
        const processedSongs = [];

        for (const artist of artists) {
            this.currentProgress.artist = artist.name;
            this.currentProgress.song = '';

            // Update progress
            progressBar.increment({
                status: `Letter ${letter.toUpperCase()}: ${artist.name}`
            });

            // Scrape artist's songs
            const songs = await this.scrapeArtistSongs(artist);
            this.stats.processedArtists++;

            if (songs.length === 0) {
                this.stats.skippedArtists++;
                await this.delay(this.delays.betweenArtists);
                continue;
            }

            this.stats.totalSongs += songs.length;

            // Scrape lyrics for each song
            for (const song of songs) {
                const lyrics = await this.scrapeSongLyrics(song);

                if (lyrics) {
                    processedSongs.push({
                        ...song,
                        lyrics,
                        scrapedAt: getCurrentISO()
                    });
                }

                this.stats.processedSongs++;

                // Update progress with song info
                progressBar.update({
                    status: `Letter ${letter.toUpperCase()}: ${artist.name} - ${song.title}`
                });
            }

            await this.delay(this.delays.betweenArtists);
        }

        // Save letter file
        if (!this.dryRun) {
            const filePath = paths.getLetterFilePath(outputDir, letter, 'songs');
            const data = {
                letter: letter.toUpperCase(),
                scrapedAt: getCurrentISO(),
                totalSongs: processedSongs.length,
                songs: processedSongs
            };

            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        }

        return processedSongs.length;
    }

    /**
     * Run prescraping
     */
    async prescrape() {
        tui.printHeader('PRESCRAPE NEW ARTISTS');

        if (this.dryRun) {
            tui.printWarning('DRY RUN MODE: No files will be saved');
        }

        // Load new artists
        const { artistsByLetter, timestamp: sourceTimestamp } = await this.loadNewArtists();

        if (this.stats.totalArtists === 0) {
            tui.printInfo('No new artists to prescrape!');
            return null;
        }

        // Prepare output directory
        const outputTimestamp = generateTimestamp();
        const outputDir = this.outputDir || await paths.createTimestampedDir('song-data', outputTimestamp);

        tui.printInfo(`Saving results to: ${outputTimestamp}`);
        tui.printInfo(`Max songs per artist: ${this.maxSongsPerArtist}`);

        // Create progress bar
        const progressBar = tui.createProgressBar(
            'Prescraping',
            this.stats.totalArtists,
            'Initializing...'
        );

        // Process each letter
        for (const letter of this.letters) {
            const artists = artistsByLetter[letter];
            if (!artists || artists.length === 0) continue;

            await this.processLetter(letter, artists, outputDir, progressBar);
        }

        progressBar.stop();

        // Save summary
        if (!this.dryRun) {
            const summaryPath = `${outputDir}/prescrape-summary.json`;
            const summary = {
                timestamp: getCurrentISO(),
                sourceDirectory: `scraping-data/new-artists/${sourceTimestamp}`,
                configuration: {
                    maxSongsPerArtist: this.maxSongsPerArtist,
                    letters: this.letters
                },
                statistics: {
                    totalArtists: this.stats.totalArtists,
                    processedArtists: this.stats.processedArtists,
                    skippedArtists: this.stats.skippedArtists,
                    totalSongs: this.stats.totalSongs,
                    processedSongs: this.stats.processedSongs,
                    scrapedLyrics: this.stats.scrapedLyrics,
                    failedLyrics: this.stats.failedLyrics
                },
                errors: this.errorLogger.getSummary()
            };

            await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

            // Save errors
            await this.errorLogger.saveToFile(outputDir);

            // Mark complete
            await paths.markDirectoryComplete(outputDir);
        }

        return { outputDir, outputTimestamp };
    }

    /**
     * Display results
     */
    displayResults() {
        console.log('');
        tui.printStats('Prescraping Results', {
            'Total Artists': tui.formatNumber(this.stats.totalArtists),
            'Processed Artists': tui.formatNumber(this.stats.processedArtists),
            'Skipped Artists': tui.formatNumber(this.stats.skippedArtists),
            'Total Songs': tui.formatNumber(this.stats.totalSongs),
            'Scraped Lyrics': tui.formatNumber(this.stats.scrapedLyrics),
            'Failed Lyrics': tui.formatNumber(this.stats.failedLyrics),
            'Success Rate': `${((this.stats.scrapedLyrics / this.stats.totalSongs) * 100).toFixed(1)}%`
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
        outputDir: null,
        maxSongsPerArtist: 10,
        maxArtists: null,
        letters: null,
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
        } else if (arg === '--max-songs' && args[i + 1]) {
            options.maxSongsPerArtist = parseInt(args[i + 1], 10);
            i++;
        } else if (arg === '--limit' && args[i + 1]) {
            options.maxArtists = parseInt(args[i + 1], 10);
            i++;
        } else if (arg === '--letters' && args[i + 1]) {
            options.letters = args[i + 1].split(',').map(l => l.trim().toLowerCase());
            i++;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--quiet') {
            options.quiet = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Usage: node scripts/prescrape-new-artists.js [options]

Options:
  --date <timestamp>      Use specific new-artists data (YYYY-MM-DD-HH-MM)
                         Default: use latest
  --output-dir <path>    Custom output directory
  --max-songs <number>   Max songs per artist (default: 10)
  --limit <number>       Max artists to process (for testing)
  --letters <letters>    Comma-separated letters to process (e.g., 'a,b,c')
                         Default: all letters
  --dry-run              Preview only, don't save files
  --quiet                Minimal output
  --help, -h             Show this help message

Examples:
  node scripts/prescrape-new-artists.js
  node scripts/prescrape-new-artists.js --limit 10 --max-songs 2
  node scripts/prescrape-new-artists.js --max-songs 20
  node scripts/prescrape-new-artists.js --letters a,b,c
  node scripts/prescrape-new-artists.js --date 2026-01-04-20-26
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

    const prescraper = new NewArtistPrescraper({
        timestamp: options.timestamp,
        outputDir: options.outputDir,
        maxSongsPerArtist: options.maxSongsPerArtist,
        maxArtists: options.maxArtists,
        letters: options.letters,
        dryRun: options.dryRun
    });

    try {
        const result = await prescraper.prescrape();

        if (result) {
            prescraper.displayResults();
            tui.printSuccess('Prescraping complete!');
            tui.printInfo(`Output: ${result.outputDir}`);
        } else {
            tui.printInfo('No work to do.');
        }

        tui.printFooter();
    } catch (error) {
        tui.printError(`Prescraping failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default NewArtistPrescraper;

