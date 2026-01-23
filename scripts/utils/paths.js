/**
 * Path Utilities
 * Handles path resolution for scraping-data directories
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { generateTimestamp, isValidTimestamp } from './timestamp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for all scraping data
const SCRAPING_DATA_BASE = path.join(__dirname, '../../scraping-data');

/**
 * Get the base scraping data directory
 * @returns {string} Absolute path to scraping-data/
 */
export function getScrapingDataDir() {
    return SCRAPING_DATA_BASE;
}

/**
 * Get path for artist lists directory with timestamp
 * @param {string} timestamp - Optional timestamp, generates new one if not provided
 * @returns {string} Absolute path
 */
export function getArtistListsDir(timestamp = null) {
    const ts = timestamp || generateTimestamp();
    return path.join(SCRAPING_DATA_BASE, 'artist-lists', ts);
}

/**
 * Get path for new artists directory with timestamp
 * @param {string} timestamp - Optional timestamp, generates new one if not provided
 * @returns {string} Absolute path
 */
export function getNewArtistsDir(timestamp = null) {
    const ts = timestamp || generateTimestamp();
    return path.join(SCRAPING_DATA_BASE, 'new-artists', ts);
}

/**
 * Get path for song data directory with timestamp
 * @param {string} timestamp - Optional timestamp, generates new one if not provided
 * @returns {string} Absolute path
 */
export function getSongDataDir(timestamp = null) {
    const ts = timestamp || generateTimestamp();
    return path.join(SCRAPING_DATA_BASE, 'song-data', ts);
}

/**
 * Get path for upload results directory with timestamp
 * @param {string} timestamp - Optional timestamp, generates new one if not provided
 * @returns {string} Absolute path
 */
export function getUploadDataDir(timestamp = null) {
    const ts = timestamp || generateTimestamp();
    return path.join(SCRAPING_DATA_BASE, 'upload-results', ts);
}

/**
 * Find the most recent timestamp directory for a given type
 * @param {string} type - Type: 'artist-lists', 'new-artists', or 'song-data'
 * @returns {Promise<string|null>} Most recent timestamp or null if none found
 */
export async function findLatestTimestamp(type) {
    const baseDir = path.join(SCRAPING_DATA_BASE, type);
    
    try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        const timestamps = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .filter(isValidTimestamp)
            .sort()
            .reverse();
        
        return timestamps.length > 0 ? timestamps[0] : null;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * Get path to latest directory of a given type
 * @param {string} type - Type: 'artist-lists', 'new-artists', or 'song-data'
 * @returns {Promise<string|null>} Path to latest directory or null
 */
export async function getLatestDir(type) {
    const timestamp = await findLatestTimestamp(type);
    if (!timestamp) return null;
    
    return path.join(SCRAPING_DATA_BASE, type, timestamp);
}

/**
 * Create directory with timestamp
 * @param {string} type - Type: 'artist-lists', 'new-artists', or 'song-data'
 * @param {string} timestamp - Optional timestamp
 * @returns {Promise<string>} Created directory path
 */
export async function createTimestampedDir(type, timestamp = null) {
    const ts = timestamp || generateTimestamp();
    const dir = path.join(SCRAPING_DATA_BASE, type, ts);
    
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/**
 * Check if directory is complete (has .complete marker)
 * @param {string} dirPath - Directory to check
 * @returns {Promise<boolean>} True if complete
 */
export async function isDirectoryComplete(dirPath) {
    const completePath = path.join(dirPath, '.complete');
    try {
        await fs.access(completePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Mark directory as complete
 * @param {string} dirPath - Directory to mark
 * @returns {Promise<void>}
 */
export async function markDirectoryComplete(dirPath) {
    const completePath = path.join(dirPath, '.complete');
    await fs.writeFile(completePath, new Date().toISOString());
}

/**
 * Get all file paths for a letter in a directory
 * @param {string} dirPath - Directory path
 * @param {string} letter - Letter (0, a-z)
 * @param {string} prefix - File prefix (e.g., 'artists', 'new-artists', 'songs')
 * @returns {string} File path
 */
export function getLetterFilePath(dirPath, letter, prefix) {
    return path.join(dirPath, `${prefix}-${letter}.json`);
}

/**
 * Get all letters (0, a-z)
 * @returns {string[]} Array of letters
 */
export function getAllLetters() {
    return ['0', ...'abcdefghijklmnopqrstuvwxyz'.split('')];
}

