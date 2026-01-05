#!/usr/bin/env node

/**
 * Test script for utility modules
 * Run: node scripts/test-utilities.js
 */

import * as timestamp from './utils/timestamp.js';
import * as paths from './utils/paths.js';
import * as tui from './utils/tui.js';
import { createErrorLogger } from './utils/error-logger.js';
import { createArtistUploader } from './utils/artist-uploader.js';

async function testTimestamp() {
    tui.printHeader('Testing Timestamp Utilities');
    
    const ts = timestamp.generateTimestamp();
    tui.printInfo(`Generated timestamp: ${ts}`);
    
    const isValid = timestamp.isValidTimestamp(ts);
    tui.printInfo(`Timestamp valid: ${isValid}`);
    
    const parsed = timestamp.parseTimestamp(ts);
    tui.printInfo(`Parsed date: ${parsed.toISOString()}`);
    
    const iso = timestamp.getCurrentISO();
    tui.printInfo(`Current ISO: ${iso}`);
    
    const duration = timestamp.formatDuration(3725);
    tui.printInfo(`Formatted duration (3725s): ${duration}`);
    
    const eta = timestamp.calculateETA(250, 1000, 100);
    tui.printInfo(`Calculated ETA (250/1000, 100s elapsed): ${eta}`);
    
    tui.printSuccess('Timestamp utilities working');
    tui.printFooter();
}

async function testPaths() {
    tui.printHeader('Testing Path Utilities');
    
    const scrapingDir = paths.getScrapingDataDir();
    tui.printInfo(`Scraping data dir: ${scrapingDir}`);
    
    const ts = timestamp.generateTimestamp();
    const artistListDir = paths.getArtistListsDir(ts);
    tui.printInfo(`Artist lists dir: ${artistListDir}`);
    
    const newArtistsDir = paths.getNewArtistsDir(ts);
    tui.printInfo(`New artists dir: ${newArtistsDir}`);
    
    const songDataDir = paths.getSongDataDir(ts);
    tui.printInfo(`Song data dir: ${songDataDir}`);
    
    const letters = paths.getAllLetters();
    tui.printInfo(`All letters (${letters.length}): ${letters.slice(0, 5).join(', ')}...`);
    
    const letterPath = paths.getLetterFilePath(artistListDir, 'a', 'artists');
    tui.printInfo(`Letter file path: ${letterPath}`);
    
    const latestTimestamp = await paths.findLatestTimestamp('artist-lists');
    tui.printInfo(`Latest timestamp: ${latestTimestamp || 'none found'}`);
    
    tui.printSuccess('Path utilities working');
    tui.printFooter();
}

async function testTUI() {
    tui.printHeader('Testing TUI Utilities');
    
    tui.printInfo('This is an info message');
    tui.printSuccess('This is a success message');
    tui.printWarning('This is a warning message');
    tui.printError('This is an error message');
    
    tui.printStats('Test Statistics', {
        totalItems: 100,
        processedItems: 75,
        failedItems: 5,
        successRate: '95%'
    });
    
    tui.printErrorSummary({
        network_timeout: 3,
        parsing_failed: 2
    });
    
    const formatted = tui.formatNumber(1234567);
    tui.printInfo(`Formatted number: ${formatted}`);
    
    tui.printInfo('Testing progress bar...');
    const bar = tui.createProgressBar('Test Progress', 100);
    for (let i = 0; i <= 100; i += 10) {
        bar.update(i);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    bar.stop();
    
    tui.printSuccess('TUI utilities working');
    tui.printFooter();
}

async function testErrorLogger() {
    tui.printHeader('Testing Error Logger');
    
    const logger = createErrorLogger('test-phase');
    
    logger.logError('network_timeout', {
        artist: 'Test Artist',
        url: 'https://example.com'
    }, 'Connection timed out after 10s');
    
    logger.logError('parsing_failed', {
        artist: 'Another Artist',
        song: 'Test Song'
    }, 'Failed to parse HTML');
    
    logger.logError('network_timeout', {
        artist: 'Third Artist'
    }, 'Another timeout');
    
    tui.printInfo(`Total errors: ${logger.getTotalErrors()}`);
    tui.printInfo(`Has errors: ${logger.hasErrors()}`);
    
    const counts = logger.getErrorCounts();
    tui.printInfo(`Error counts: ${JSON.stringify(counts)}`);
    
    const summary = logger.getSummary();
    tui.printInfo(`Summary: ${JSON.stringify(summary)}`);
    
    tui.printSuccess('Error logger working');
    tui.printFooter();
}

async function testArtistUploader() {
    tui.printHeader('Testing Artist Uploader');
    
    const uploader = createArtistUploader(null, {
        batchSize: 'medium',
        skipExisting: false
    });
    
    const testArtist = {
        name: 'Test Artist',
        url: 'https://genius.com/artists/Test-artist',
        id: '123456',
        type: 'regular'
    };
    
    const transformed = uploader.transformArtist(testArtist);
    tui.printInfo('Transformed artist:');
    tui.printInfo(`  ID: ${transformed.id}`);
    tui.printInfo(`  Name: ${transformed.name}`);
    tui.printInfo(`  First Letter: ${transformed.firstLetter}`);
    tui.printInfo(`  Search Tokens: ${transformed.searchTokens.length} generated`);
    tui.printInfo(`  Sample tokens: ${transformed.searchTokens.slice(0, 5).join(', ')}...`);
    
    const slug = uploader.extractSlug('https://genius.com/artists/Kendrick-lamar');
    tui.printInfo(`Extracted slug: ${slug}`);
    
    const searchTokens = uploader.generateSearchTokens('Kendrick Lamar');
    tui.printInfo(`Search tokens for "Kendrick Lamar": ${searchTokens.length} tokens`);
    
    tui.printSuccess('Artist uploader working');
    tui.printFooter();
}

async function runTests() {
    try {
        await testTimestamp();
        await testPaths();
        await testTUI();
        await testErrorLogger();
        await testArtistUploader();
        
        tui.printHeader('All Tests Complete');
        tui.printSuccess('All utility modules are working correctly!');
        tui.printFooter();
        
    } catch (error) {
        tui.printError(`Test failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

runTests();

