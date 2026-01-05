/**
 * Timestamp Utilities
 * Handles timestamp generation and parsing for directory naming
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');

/**
 * Generate a timestamp string for directory naming
 * Format: YYYY-MM-DD-HH-MM
 * @returns {string} Timestamp string
 */
export function generateTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}-${hours}-${minutes}`;
}

/**
 * Parse a timestamp string into a Date object
 * @param {string} timestamp - Timestamp in format YYYY-MM-DD-HH-MM
 * @returns {Date} Date object
 */
export function parseTimestamp(timestamp) {
    const parts = timestamp.split('-');
    if (parts.length !== 5) {
        throw new Error(`Invalid timestamp format: ${timestamp}. Expected YYYY-MM-DD-HH-MM`);
    }
    
    const [year, month, day, hours, minutes] = parts.map(Number);
    return new Date(year, month - 1, day, hours, minutes);
}

/**
 * Validate a timestamp string
 * @param {string} timestamp - Timestamp to validate
 * @returns {boolean} True if valid
 */
export function isValidTimestamp(timestamp) {
    try {
        const parts = timestamp.split('-');
        if (parts.length !== 5) return false;
        
        const date = parseTimestamp(timestamp);
        return !isNaN(date.getTime());
    } catch {
        return false;
    }
}

/**
 * Format a Date object as ISO string
 * @param {Date} date - Date to format
 * @returns {string} ISO string
 */
export function toISOString(date) {
    return date.toISOString();
}

/**
 * Get current ISO timestamp
 * @returns {string} Current time as ISO string
 */
export function getCurrentISO() {
    return new Date().toISOString();
}

/**
 * Format duration in seconds to human readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2h 15m 30s")
 */
export function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

/**
 * Calculate estimated time remaining
 * @param {number} completed - Items completed
 * @param {number} total - Total items
 * @param {number} elapsedSeconds - Elapsed time in seconds
 * @returns {string} Formatted ETA
 */
export function calculateETA(completed, total, elapsedSeconds) {
    if (completed === 0) return 'Calculating...';
    if (completed >= total) return '0s';
    
    const rate = completed / elapsedSeconds;
    const remaining = total - completed;
    const etaSeconds = remaining / rate;
    
    return formatDuration(etaSeconds);
}

/**
 * Get elapsed time from a directory's creation timestamp
 * @param {string} dirPath - Path to the directory
 * @returns {Promise<number|null>} Elapsed seconds, or null if directory doesn't exist
 */
export async function getWorkflowElapsedFromDir(dirPath) {
    try {
        const stats = await fs.stat(dirPath);
        const elapsed = (Date.now() - stats.birthtimeMs) / 1000;
        return elapsed;
    } catch (error) {
        return null;
    }
}

/**
 * Get elapsed time from the latest artist-lists directory
 * @returns {Promise<number|null>} Elapsed seconds, or null if no directory exists
 */
export async function getWorkflowElapsed() {
    try {
        const artistListsBase = path.join(WORKSPACE_ROOT, 'scraping-data', 'artist-lists');
        const entries = await fs.readdir(artistListsBase, { withFileTypes: true });
        
        // Find all timestamp directories
        const timestampDirs = entries
            .filter(entry => entry.isDirectory() && isValidTimestamp(entry.name))
            .map(entry => ({
                name: entry.name,
                path: path.join(artistListsBase, entry.name)
            }))
            .sort((a, b) => b.name.localeCompare(a.name)); // Most recent first
        
        if (timestampDirs.length === 0) {
            return null;
        }
        
        // Use the most recent directory
        const latestDir = timestampDirs[0];
        return await getWorkflowElapsedFromDir(latestDir.path);
    } catch (error) {
        return null;
    }
}

