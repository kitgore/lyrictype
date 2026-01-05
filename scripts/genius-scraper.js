import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

class GeniusArtistScraper {
    constructor() {
        this.baseUrl = 'https://genius.com/artists-index/';
        this.results = {
            popularArtists: [],
            regularArtists: []
        };
        this.requestDelay = 500; // 500ms delay between requests to be respectful
    }

    /**
     * Extract artist ID from iOS app link on artist page
     * @param {string} artistUrl - The URL of the artist page
     * @returns {string|null} The artist ID or null if not found
     */
    async extractArtistId(artistUrl) {
        try {
            // Add delay to be respectful
            await new Promise(resolve => setTimeout(resolve, this.requestDelay));
            
            const response = await axios.get(artistUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            
            // Look for iOS app link: <link href="ios-app://709482991/genius/artists/673285" rel="alternate">
            const iosAppLink = $('link[rel="alternate"][href*="ios-app://"]').attr('href');
            
            if (iosAppLink) {
                // Extract the ID from the end of the URL: ios-app://709482991/genius/artists/673285
                const match = iosAppLink.match(/\/artists\/(\d+)$/);
                if (match) {
                    return match[1];
                }
            }
            
            return null;
        } catch (error) {
            console.warn(`Failed to extract ID for ${artistUrl}:`, error.message);
            return null;
        }
    }

    /**
     * Add progress indicator for long-running operations
     */
    logProgress(current, total, type) {
        const percentage = ((current / total) * 100).toFixed(1);
        const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
        process.stdout.write(`\r${type}: [${progressBar}] ${percentage}% (${current}/${total})`);
        if (current === total) console.log(); // New line when complete
    }

    /**
     * Scrape artist links from a specific letter page
     * @param {string} letter - The letter to scrape (e.g., 'j', 'a', 'b')
     * @param {boolean} includeIds - Whether to fetch artist IDs (slower)
     * @returns {Object} Object containing popularArtists and regularArtists arrays
     */
    async scrapeArtistsByLetter(letter, includeIds = true) {
        try {
            console.log(`Scraping artists for letter: ${letter.toUpperCase()}`);
            
            const url = `${this.baseUrl}${letter.toLowerCase()}`;
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            
            // Reset results for this letter
            this.results = {
                popularArtists: [],
                regularArtists: []
            };

            // Extract popular artists
            console.log('Extracting popular artists...');
            $('li.artists_index_list-popular_artist').each((index, element) => {
                const artistLink = $(element).find('a.artists_index_list-artist_name');
                const name = artistLink.text().trim();
                const url = artistLink.attr('href');
                
                if (name && url) {
                    this.results.popularArtists.push({
                        name: name,
                        url: url,
                        type: 'popular',
                        id: null // Will be populated later if includeIds is true
                    });
                }
            });

            // Extract regular artists
            console.log('Extracting regular artists...');
            // Look for ul.artists_index_list that comes after popular artists
            const regularArtistLists = $('ul.artists_index_list').not(':has(.artists_index_list-popular_artist)');
            
            regularArtistLists.each((listIndex, listElement) => {
                $(listElement).find('li').each((index, element) => {
                    const artistLink = $(element).find('a').first();
                    const name = artistLink.text().trim();
                    const url = artistLink.attr('href');
                    
                    // Only include links that point to artist pages
                    if (name && url && url.includes('/artists/')) {
                        this.results.regularArtists.push({
                            name: name,
                            url: url,
                            type: 'regular',
                            id: null // Will be populated later if includeIds is true
                        });
                    }
                });
            });

            console.log(`Found ${this.results.popularArtists.length} popular artists`);
            console.log(`Found ${this.results.regularArtists.length} regular artists`);
            
            // Extract artist IDs if requested
            if (includeIds) {
                console.log('\n🔍 Extracting artist IDs from individual pages...');
                console.log('⚠️  This may take several minutes due to rate limiting');
                
                // Process popular artists
                if (this.results.popularArtists.length > 0) {
                    console.log('\nFetching popular artist IDs:');
                    for (let i = 0; i < this.results.popularArtists.length; i++) {
                        const artist = this.results.popularArtists[i];
                        this.logProgress(i + 1, this.results.popularArtists.length, 'Popular Artists');
                        artist.id = await this.extractArtistId(artist.url);
                    }
                }
                
                // Process regular artists
                if (this.results.regularArtists.length > 0) {
                    console.log('\nFetching regular artist IDs:');
                    for (let i = 0; i < this.results.regularArtists.length; i++) {
                        const artist = this.results.regularArtists[i];
                        this.logProgress(i + 1, this.results.regularArtists.length, 'Regular Artists');
                        artist.id = await this.extractArtistId(artist.url);
                    }
                }
                
                // Count successful ID extractions
                const popularWithIds = this.results.popularArtists.filter(a => a.id !== null).length;
                const regularWithIds = this.results.regularArtists.filter(a => a.id !== null).length;
                
                console.log(`\n✅ Successfully extracted ${popularWithIds}/${this.results.popularArtists.length} popular artist IDs`);
                console.log(`✅ Successfully extracted ${regularWithIds}/${this.results.regularArtists.length} regular artist IDs`);
            }
            
            return this.results;

        } catch (error) {
            console.error(`Error scraping letter ${letter}:`, error.message);
            throw error;
        }
    }

    /**
     * Save results to JSON file
     * @param {string} letter - The letter that was scraped
     * @param {Object} data - The scraped data
     * @param {string} outputDir - Directory to save the file (optional)
     */
    saveToFile(letter, data, outputDir = '.') {
        const filename = `genius-artists-${letter.toLowerCase()}.json`;
        const filepath = path.join(outputDir, filename);
        const output = {
            letter: letter.toUpperCase(),
            timestamp: new Date().toISOString(),
            totalArtists: data.popularArtists.length + data.regularArtists.length,
            popularCount: data.popularArtists.length,
            regularCount: data.regularArtists.length,
            artists: {
                popular: data.popularArtists,
                regular: data.regularArtists
            }
        };

        fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
        console.log(`Results saved to ${filepath}`);
        return filepath;
    }

    /**
     * Display summary of scraped data
     */
    displaySummary(data) {
        console.log('\n=== SCRAPING SUMMARY ===');
        console.log(`Popular Artists: ${data.popularArtists.length}`);
        console.log(`Regular Artists: ${data.regularArtists.length}`);
        console.log(`Total Artists: ${data.popularArtists.length + data.regularArtists.length}`);
        
        // Show ID extraction summary if IDs were fetched
        const popularWithIds = data.popularArtists.filter(a => a.id !== null).length;
        const regularWithIds = data.regularArtists.filter(a => a.id !== null).length;
        const totalWithIds = popularWithIds + regularWithIds;
        
        if (data.popularArtists.length > 0 && data.popularArtists[0].id !== undefined) {
            console.log(`\nArtist IDs Extracted: ${totalWithIds}/${data.popularArtists.length + data.regularArtists.length} (${((totalWithIds / (data.popularArtists.length + data.regularArtists.length)) * 100).toFixed(1)}%)`);
        }
        
        if (data.popularArtists.length > 0) {
            console.log('\nFirst 5 Popular Artists:');
            data.popularArtists.slice(0, 5).forEach((artist, index) => {
                const idDisplay = artist.id ? ` (ID: ${artist.id})` : '';
                console.log(`  ${index + 1}. ${artist.name}${idDisplay} - ${artist.url}`);
            });
        }
        
        if (data.regularArtists.length > 0) {
            console.log('\nFirst 5 Regular Artists:');
            data.regularArtists.slice(0, 5).forEach((artist, index) => {
                const idDisplay = artist.id ? ` (ID: ${artist.id})` : '';
                console.log(`  ${index + 1}. ${artist.name}${idDisplay} - ${artist.url}`);
            });
        }
    }

    /**
     * Prepare data for Firebase Firestore (for future use)
     * @param {string} letter - The letter that was scraped
     * @param {Object} data - The scraped data
     * @returns {Array} Array of artist documents ready for Firestore
     */
    /**
     * Create output directory with timestamp
     * @returns {string} The created directory path
     */
    createOutputDirectory() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const dirname = `genius-artists-${timestamp}`;
        
        if (!fs.existsSync(dirname)) {
            fs.mkdirSync(dirname, { recursive: true });
        }
        
        return dirname;
    }

    /**
     * Scrape all letters (a-z) and save results to a folder
     * @param {boolean} includeIds - Whether to fetch artist IDs
     * @returns {Object} Summary of bulk scraping results
     */
    async scrapeAllLetters(includeIds = true) {
        console.log('🎵 Starting bulk scraping for all letters (A-Z)...\n');
        
        const outputDir = this.createOutputDirectory();
        console.log(`📁 Results will be saved to: ${outputDir}/\n`);
        
        const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
        const results = {
            successful: [],
            failed: [],
            totalArtists: 0,
            totalPopular: 0,
            totalRegular: 0,
            totalWithIds: 0,
            startTime: new Date(),
            outputDirectory: outputDir
        };
        
        for (let i = 0; i < letters.length; i++) {
            const letter = letters[i];
            const progress = `[${i + 1}/${letters.length}]`;
            
            try {
                console.log(`\n${progress} 🔄 Processing letter: ${letter.toUpperCase()}`);
                
                const letterResults = await this.scrapeArtistsByLetter(letter, includeIds);
                
                // Save to file
                const filepath = this.saveToFile(letter, letterResults, outputDir);
                
                // Update summary stats
                const letterTotal = letterResults.popularArtists.length + letterResults.regularArtists.length;
                const letterWithIds = includeIds ? 
                    letterResults.popularArtists.filter(a => a.id !== null).length +
                    letterResults.regularArtists.filter(a => a.id !== null).length : 0;
                
                results.successful.push({
                    letter: letter.toUpperCase(),
                    popular: letterResults.popularArtists.length,
                    regular: letterResults.regularArtists.length,
                    total: letterTotal,
                    withIds: letterWithIds,
                    filepath: filepath
                });
                
                results.totalArtists += letterTotal;
                results.totalPopular += letterResults.popularArtists.length;
                results.totalRegular += letterResults.regularArtists.length;
                results.totalWithIds += letterWithIds;
                
                console.log(`✅ Letter ${letter.toUpperCase()}: ${letterTotal} artists processed`);
                
            } catch (error) {
                console.error(`❌ Failed to process letter ${letter.toUpperCase()}:`, error.message);
                results.failed.push({
                    letter: letter.toUpperCase(),
                    error: error.message
                });
            }
            
            // Small delay between letters to be extra respectful
            if (i < letters.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        results.endTime = new Date();
        results.duration = Math.round((results.endTime - results.startTime) / 1000 / 60); // minutes
        
        // Save summary file
        const summaryPath = path.join(outputDir, 'scraping-summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
        
        return results;
    }

    /**
     * Display bulk scraping summary
     */
    displayBulkSummary(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🎯 BULK SCRAPING COMPLETE');
        console.log('='.repeat(60));
        
        console.log(`📊 Overall Statistics:`);
        console.log(`   • Letters processed: ${results.successful.length}/${results.successful.length + results.failed.length}`);
        console.log(`   • Total artists: ${results.totalArtists.toLocaleString()}`);
        console.log(`   • Popular artists: ${results.totalPopular.toLocaleString()}`);
        console.log(`   • Regular artists: ${results.totalRegular.toLocaleString()}`);
        
        if (results.totalWithIds > 0) {
            const idSuccessRate = ((results.totalWithIds / results.totalArtists) * 100).toFixed(1);
            console.log(`   • Artists with IDs: ${results.totalWithIds.toLocaleString()} (${idSuccessRate}%)`);
        }
        
        console.log(`   • Duration: ${results.duration} minutes`);
        console.log(`   • Output directory: ${results.outputDirectory}/`);
        
        if (results.failed.length > 0) {
            console.log(`\n❌ Failed letters (${results.failed.length}):`);
            results.failed.forEach(fail => {
                console.log(`   • ${fail.letter}: ${fail.error}`);
            });
        }
        
        console.log(`\n✅ Results saved to: ${results.outputDirectory}/`);
        console.log(`📄 Summary saved to: ${path.join(results.outputDirectory, 'scraping-summary.json')}`);
    }

    prepareForFirestore(letter, data) {
        const firestoreData = [];
        
        // Add popular artists
        data.popularArtists.forEach(artist => {
            firestoreData.push({
                name: artist.name,
                url: artist.url,
                id: artist.id,
                type: 'popular',
                letter: letter.toLowerCase(),
                scrapedAt: new Date()
            });
        });
        
        // Add regular artists
        data.regularArtists.forEach(artist => {
            firestoreData.push({
                name: artist.name,
                url: artist.url,
                id: artist.id,
                type: 'regular',
                letter: letter.toLowerCase(),
                scrapedAt: new Date()
            });
        });
        
        return firestoreData;
    }
}

// Main execution function
async function main() {
    const scraper = new GeniusArtistScraper();
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const firstArg = args[0] || 'j';
    const includeIds = !args.includes('--no-ids'); // Include IDs by default, unless --no-ids flag is passed
    
    try {
        console.log('🎵 Genius Artist Scraper Starting...\n');
        
        if (!includeIds) {
            console.log('⚡ Fast mode: Skipping artist ID extraction\n');
        }
        
        // Check if bulk scraping all letters
        if (firstArg.toLowerCase() === 'all') {
            console.log('🌟 Bulk mode: Scraping all letters A-Z');
            
            if (includeIds) {
                console.log('⚠️  This will take several hours with ID extraction enabled');
                console.log('💡 Consider using --no-ids flag for much faster bulk scraping\n');
            }
            
            // Perform bulk scraping
            const bulkResults = await scraper.scrapeAllLetters(includeIds);
            
            // Display bulk summary
            scraper.displayBulkSummary(bulkResults);
            
            console.log('\n🎉 Bulk scraping completed successfully!');
            
        } else {
            // Single letter scraping (original functionality)
            const letter = firstArg;
            
            // Scrape the specified letter
            const results = await scraper.scrapeArtistsByLetter(letter, includeIds);
            
            // Display summary
            scraper.displaySummary(results);
            
            // Save to file
            const filename = scraper.saveToFile(letter, results);
            
            // Prepare for Firestore (just showing the structure for now)
            const firestoreData = scraper.prepareForFirestore(letter, results);
            console.log(`\nPrepared ${firestoreData.length} documents for Firestore`);
            
            console.log('\n✅ Scraping completed successfully!');
            console.log(`📁 Data saved to: ${filename}`);
            
            if (includeIds) {
                console.log('\n💡 Tip: Use --no-ids flag for faster scraping without artist IDs');
                console.log('💡 Tip: Use "all" to scrape all letters A-Z at once');
            }
        }
        
    } catch (error) {
        console.error('❌ Scraping failed:', error.message);
        process.exit(1);
    }
}

// Run the scraper if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default GeniusArtistScraper; 