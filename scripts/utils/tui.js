/**
 * TUI (Terminal User Interface) Utilities
 * Provides progress bars and formatted output
 * NO EMOJIS - Clean professional output only
 */

import cliProgress from 'cli-progress';
import chalk from 'chalk';

/**
 * Create a new progress bar
 * @param {string} title - Title for the progress bar
 * @param {number} total - Total items
 * @returns {object} Progress bar instance
 */
export function createProgressBar(title, total) {
    const bar = new cliProgress.SingleBar({
        format: `${title}: [{bar}] {percentage}% | {value}/{total} | ETA: {eta_formatted}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: true
    });
    
    bar.start(total, 0, {
        eta_formatted: 'Calculating...'
    });
    
    return bar;
}

/**
 * Create a multi-bar progress container
 * @returns {object} MultiBar instance
 */
export function createMultiBar() {
    return new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{title}: [{bar}] {percentage}% | {value}/{total} | {info}'
    });
}

/**
 * Print section header
 * @param {string} title - Header title
 */
export function printHeader(title) {
    const width = 80;
    const line = '='.repeat(width);
    console.log('\n' + line);
    console.log(title);
    console.log(line + '\n');
}

/**
 * Print section footer
 */
export function printFooter() {
    const width = 80;
    console.log('='.repeat(width) + '\n');
}

/**
 * Print info message
 * @param {string} message - Message to print
 */
export function printInfo(message) {
    console.log(`[INFO] ${message}`);
}

/**
 * Print success message
 * @param {string} message - Message to print
 */
export function printSuccess(message) {
    console.log(chalk.green(`[SUCCESS] ${message}`));
}

/**
 * Print warning message
 * @param {string} message - Message to print
 */
export function printWarning(message) {
    console.log(chalk.yellow(`[WARN] ${message}`));
}

/**
 * Print error message
 * @param {string} message - Message to print
 */
export function printError(message) {
    console.log(chalk.red(`[ERROR] ${message}`));
}

/**
 * Print statistics table
 * @param {string} title - Table title
 * @param {object} stats - Statistics object
 */
export function printStats(title, stats) {
    console.log(`\n${title}:`);
    for (const [key, value] of Object.entries(stats)) {
        const formattedKey = key.replace(/([A-Z])/g, ' $1').trim();
        const capitalizedKey = formattedKey.charAt(0).toUpperCase() + formattedKey.slice(1);
        console.log(`  ${capitalizedKey}: ${value}`);
    }
}

/**
 * Print error summary
 * @param {object} errorCounts - Error counts by type
 */
export function printErrorSummary(errorCounts) {
    if (Object.keys(errorCounts).length === 0) {
        return;
    }
    
    console.log('\nErrors:');
    for (const [type, count] of Object.entries(errorCounts)) {
        if (count > 0) {
            const formattedType = type.replace(/_/g, ' ');
            console.log(`  ${formattedType}: ${count}`);
        }
    }
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
export function formatNumber(num) {
    return num.toLocaleString();
}

/**
 * Create a status display that updates in place
 * @returns {object} Status display object
 */
export function createStatusDisplay() {
    let lastLine = '';
    
    return {
        /**
         * Update the status line
         * @param {string} message - Status message
         */
        update(message) {
            if (lastLine) {
                process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r');
            }
            process.stdout.write(message);
            lastLine = message;
        },
        
        /**
         * Clear the status line
         */
        clear() {
            if (lastLine) {
                process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r');
                lastLine = '';
            }
        },
        
        /**
         * Finish with a newline
         */
        finish() {
            if (lastLine) {
                process.stdout.write('\n');
                lastLine = '';
            }
        }
    };
}

/**
 * Ask for user confirmation
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>} True if user confirms
 */
export async function confirm(question) {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(`${question} (Y/n): `, (answer) => {
            rl.close();
            const normalized = answer.toLowerCase().trim();
            resolve(normalized === 'y' || normalized === 'yes' || normalized === '');
        });
    });
}

/**
 * Print progress info (current item being processed)
 * @param {string} label - Label (e.g., "Current Letter")
 * @param {string} value - Value to display
 */
export function printProgressInfo(label, value) {
    console.log(`${label}: ${value}`);
}

/**
 * Clear console (use sparingly)
 */
export function clearConsole() {
    console.clear();
}

