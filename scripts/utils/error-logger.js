/**
 * Error Logger
 * Handles error collection and logging to errors.json
 */

import fs from 'fs/promises';
import path from 'path';
import { getCurrentISO } from './timestamp.js';

/**
 * Error Logger class
 */
export class ErrorLogger {
    constructor(phase) {
        this.phase = phase;
        this.errors = [];
        this.errorCounts = {};
    }
    
    /**
     * Log an error
     * @param {string} type - Error type (e.g., 'network_timeout', 'parsing_failed')
     * @param {object} context - Error context (artist, song, url, etc.)
     * @param {string} message - Error message
     */
    logError(type, context, message) {
        const error = {
            type,
            timestamp: getCurrentISO(),
            message,
            ...context
        };
        
        this.errors.push(error);
        
        // Update counts
        this.errorCounts[type] = (this.errorCounts[type] || 0) + 1;
    }
    
    /**
     * Get total error count
     * @returns {number} Total errors
     */
    getTotalErrors() {
        return this.errors.length;
    }
    
    /**
     * Get error counts by type
     * @returns {object} Error counts
     */
    getErrorCounts() {
        return { ...this.errorCounts };
    }
    
    /**
     * Get all errors
     * @returns {array} All error objects
     */
    getAllErrors() {
        return [...this.errors];
    }
    
    /**
     * Check if there are any errors
     * @returns {boolean} True if errors exist
     */
    hasErrors() {
        return this.errors.length > 0;
    }
    
    /**
     * Save errors to errors.json file
     * @param {string} outputDir - Directory to save errors.json
     * @returns {Promise<void>}
     */
    async saveToFile(outputDir) {
        if (!this.hasErrors()) {
            return;
        }
        
        const errorData = {
            phase: this.phase,
            timestamp: getCurrentISO(),
            totalErrors: this.getTotalErrors(),
            errorsByType: this.getErrorCounts(),
            errors: this.getAllErrors()
        };
        
        const filePath = path.join(outputDir, 'errors.json');
        await fs.writeFile(filePath, JSON.stringify(errorData, null, 2));
    }
    
    /**
     * Create a summary object
     * @returns {object} Error summary
     */
    getSummary() {
        return {
            totalErrors: this.getTotalErrors(),
            errorsByType: this.getErrorCounts()
        };
    }
    
    /**
     * Clear all errors
     */
    clear() {
        this.errors = [];
        this.errorCounts = {};
    }
}

/**
 * Create a new error logger
 * @param {string} phase - Phase name (e.g., 'scraping', 'prescraping', 'uploading')
 * @returns {ErrorLogger} Error logger instance
 */
export function createErrorLogger(phase) {
    return new ErrorLogger(phase);
}

