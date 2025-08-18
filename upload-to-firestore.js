import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import unidecode from 'unidecode';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

// Initialize Firebase using centralized config
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

class FirestoreUploader {
    constructor() {
        this.batchSize = 500; // Firestore batch limit
        this.collectionName = 'artists';
        this.maxRetries = 3; // Maximum retry attempts for failed batches
        this.uploadStats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            retried: 0,
            startTime: new Date()
        };
    }

    /**
     * Extract artist slug from Genius URL and validate for Firestore
     * @param {string} url - The full Genius artist URL
     * @returns {string} The artist slug (validated for Firestore)
     */
    extractSlug(url) {
        // Extract everything after "/artists/"
        const match = url.match(/\/artists\/(.+)$/);
        if (!match) return null;
        
        let slug = match[1];
        
        // CRITICAL: Apply Unicode normalization first to handle non-ASCII characters
        // This is the main fix for the batch failure issue
        slug = unidecode(slug);
        
        // Firestore document ID validation and sanitization
        // Document IDs must be valid UTF-8 characters
        // Cannot contain forward slashes, and must be <= 1500 bytes
        
        // Replace invalid characters for Firestore document IDs
        slug = slug.replace(/[\/]/g, '-'); // Replace forward slashes
        slug = slug.replace(/[.#$\[\]]/g, '-'); // Replace other problematic characters
        slug = slug.replace(/[^\w\-_.~]/g, '-'); // Replace any other non-URL-safe characters
        
        // Clean up multiple consecutive dashes
        slug = slug.replace(/-+/g, '-');
        
        // Remove leading/trailing dashes
        slug = slug.replace(/^-+|-+$/g, '');
        
        // Ensure it's not too long (Firestore limit is 1500 bytes)
        if (slug.length > 800) { // More conservative limit
            slug = slug.substring(0, 800).replace(/-+$/, ''); // Remove trailing dash if cut mid-word
        }
        
        // Ensure it's not empty after sanitization
        if (!slug || slug.trim() === '') {
            return null;
        }
        
        return slug;
    }

    /**
     * Sanitize field value for Firestore storage
     * @param {string} text - Text to sanitize
     * @returns {string} Sanitized text safe for Firestore
     */
    sanitizeFieldValue(text) {
        if (!text) return text;
        
        // Remove null bytes and other problematic control characters
        let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        // Remove Unicode tag characters and other problematic invisible characters
        // Use proper Unicode regex patterns for JavaScript
        sanitized = sanitized.replace(/[\uFE00-\uFE0F]/g, ''); // Variation selectors
        sanitized = sanitized.replace(/[\u200B-\u200F]/g, ''); // Zero-width characters
        sanitized = sanitized.replace(/[\u2060-\u206F]/g, ''); // Additional invisible characters
        sanitized = sanitized.replace(/[\uFEFF]/g, ''); // Byte order mark
        
        // Remove Unicode tag characters (which require surrogate pairs in JavaScript)
        // Tag characters are in the range U+E0000-U+E007F, represented as surrogate pairs
        sanitized = sanitized.replace(/\uDB40[\uDC00-\uDC7F]/g, ''); // Tag characters
        
        // Also remove any orphaned high surrogates that might cause encoding issues
        sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, ''); // Orphaned high surrogates
        sanitized = sanitized.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''); // Orphaned low surrogates
        
        // Normalize Unicode characters to avoid Firestore encoding issues
        // Keep original characters but ensure proper UTF-8 encoding
        try {
            sanitized = sanitized.normalize('NFC'); // Canonical composition
            
            // Test if the string can be properly encoded
            encodeURIComponent(sanitized);
        } catch (error) {
            // Fallback to unidecode if normalization fails
            console.warn(`⚠️  Unicode normalization failed for "${text}", using unidecode fallback`);
            sanitized = unidecode(text);
            // Clean up any remaining problematic characters after unidecode
            sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
        }
        
        return sanitized.trim();
    }

    /**
     * Normalize text for search (remove accents, handle special characters)
     * @param {string} text - Text to normalize
     * @returns {string} Normalized text
     */
    normalizeText(text) {
        // First pass: use unidecode to handle accented characters
        let normalized = unidecode(text);
        
        // Second pass: custom replacements for common artist name patterns
        normalized = normalized
            .replace(/0/g, 'o')     // Replace '0' with 'o'
            .replace(/\$/g, 's')    // Replace '$' with 's'
            .replace(/1/g, 'i')     // Replace '1' with 'i'
            .replace(/3/g, 'e')     // Replace '3' with 'e'
            .replace(/4/g, 'a')     // Replace '4' with 'a'
            .replace(/5/g, 's')     // Replace '5' with 's'
            .replace(/7/g, 't')     // Replace '7' with 't'
            .replace(/\+/g, 'plus') // Replace '+' with 'plus'
            .replace(/&/g, 'and')   // Replace '&' with 'and'
            .replace(/@/g, 'at');   // Replace '@' with 'at'
            
        return normalized.toLowerCase();
    }

    /**
     * Generate search tokens for autocomplete functionality with normalization and punctuation removal
     * @param {string} name - The artist name
     * @returns {string[]} Array of search tokens
     */
    generateSearchTokens(name) {
        const tokens = new Set();
        const cleanName = name.toLowerCase().trim();
        const normalizedName = this.normalizeText(name);
        
        // Generate punctuation-free versions
        const removePunctuation = (text) => text.replace(/[.,\-_'"!?&@#$%^*()+=\[\]{};:|<>\/\\`~]/g, '').replace(/\s+/g, ' ').trim();
        const cleanNameNoPunct = removePunctuation(cleanName);
        const normalizedNameNoPunct = removePunctuation(normalizedName);
        
        // Generate tokens for all versions: original, normalized, and punctuation-free
        const versions = [cleanName];
        if (normalizedName !== cleanName) {
            versions.push(normalizedName);
        }
        if (cleanNameNoPunct !== cleanName && cleanNameNoPunct.length > 0) {
            versions.push(cleanNameNoPunct);
        }
        if (normalizedNameNoPunct !== normalizedName && normalizedNameNoPunct !== cleanNameNoPunct && normalizedNameNoPunct.length > 0) {
            versions.push(normalizedNameNoPunct);
        }
        
        for (const version of versions) {
            // Add progressively longer substrings starting from the beginning
            for (let i = 1; i <= version.length; i++) {
                tokens.add(version.substring(0, i));
            }
            
            // Add tokens for each word (useful for multi-word artists)
            const words = version.split(/\s+/);
            for (const word of words) {
                if (word.length > 0) {
                    for (let i = 1; i <= word.length; i++) {
                        tokens.add(word.substring(0, i));
                    }
                }
            }
            
            // Add the full name
            tokens.add(version);
        }
        
        // Add original case version
        tokens.add(name);
        
        // Filter and sanitize tokens to ensure Firestore compatibility
        return Array.from(tokens)
            .filter(token => token.length > 0 && token.length <= 100) // Limit token length
            .map(token => this.sanitizeFieldValue(token)) // Sanitize each token
            .filter(token => token && token.length > 0); // Remove any tokens that became empty after sanitization
    }

    /**
     * Transform artist data for Firestore
     * @param {Object} artist - Artist data from scraped JSON
     * @returns {Object|null} Transformed artist document or null if invalid
     */
    transformArtist(artist) {
        if (!artist.name || !artist.url) {
            return null;
        }

        const slug = this.extractSlug(artist.url);
        if (!slug) {
            console.warn(`Could not extract slug from URL: ${artist.url}`);
            return null;
        }

        // Sanitize all string fields for Firestore compatibility
        const sanitizedName = this.sanitizeFieldValue(artist.name);
        const sanitizedUrl = this.sanitizeFieldValue(artist.url);
        
        const nameForSorting = sanitizedName.toLowerCase().replace(/^(the |a |an )/, '');
        const firstLetter = nameForSorting.charAt(0).toLowerCase();
        const searchTokens = this.generateSearchTokens(sanitizedName);

        return {
            id: slug,
            name: sanitizedName,
            url: sanitizedUrl,
            geniusId: artist.id || null,
            type: artist.type || 'regular',
            searchTokens: searchTokens,
            nameForSorting: nameForSorting,
            uploadedAt: new Date().toISOString(), // Use ISO string for consistency
            firstLetter: firstLetter
        };
    }

    /**
     * Read all JSON files from the scraped data directory
     * @param {string} dataDir - Path to the directory containing scraped JSON files
     * @returns {Array} Array of all artists from all files
     */
    readAllArtistFiles(dataDir) {
        console.log(`📁 Reading artist data from: ${dataDir}`);
        
        const allArtists = [];
        // Include numbers/symbols file (0) and all letters (a-z)
        const fileKeys = ['0', ...('abcdefghijklmnopqrstuvwxyz'.split(''))];
        
        for (const key of fileKeys) {
            const filename = `genius-artists-${key}.json`;
            const filepath = path.join(dataDir, filename);
            
            if (fs.existsSync(filepath)) {
                try {
                    const fileContent = fs.readFileSync(filepath, 'utf8');
                    const letterData = JSON.parse(fileContent);
                    
                    // Add popular artists
                    if (letterData.artists?.popular) {
                        allArtists.push(...letterData.artists.popular);
                    }
                    
                    // Add regular artists
                    if (letterData.artists?.regular) {
                        allArtists.push(...letterData.artists.regular);
                    }
                    
                    const displayKey = key === '0' ? 'Numbers/Symbols' : key.toUpperCase();
                    console.log(`✅ ${displayKey}: ${letterData.totalArtists || 0} artists loaded`);
                    
                } catch (error) {
                    console.error(`❌ Error reading ${filename}:`, error.message);
                }
            } else {
                const displayKey = key === '0' ? 'Numbers/Symbols' : key.toUpperCase();
                console.warn(`⚠️  File not found: ${filename} (${displayKey})`);
            }
        }
        
        console.log(`\n📊 Total artists loaded: ${allArtists.length}`);
        return allArtists;
    }

    /**
     * Upload artists to Firestore in batches
     * @param {Array} artists - Array of artist objects
     */
    async uploadToFirestore(artists) {
        console.log(`\n🔥 Starting Firestore upload...`);
        console.log(`📝 Collection: ${this.collectionName}`);
        console.log(`📦 Batch size: ${this.batchSize}`);
        
        const transformedArtists = [];
        const duplicateSlugs = new Set();
        const slugCounts = new Map();
        
        // Transform and deduplicate artists
        console.log('\n🔄 Transforming artist data...');
        for (const artist of artists) {
            const transformed = this.transformArtist(artist);
            if (transformed) {
                // Check for duplicate slugs
                const slug = transformed.id;
                if (slugCounts.has(slug)) {
                    slugCounts.set(slug, slugCounts.get(slug) + 1);
                    duplicateSlugs.add(slug);
                    
                    // Modify slug to make it unique
                    transformed.id = `${slug}-${slugCounts.get(slug)}`;
                    console.warn(`⚠️  Duplicate slug detected: ${slug} -> ${transformed.id}`);
                } else {
                    slugCounts.set(slug, 1);
                }
                
                transformedArtists.push(transformed);
            } else {
                this.uploadStats.skipped++;
            }
        }
        
        console.log(`\n📊 Transformation complete:`);
        console.log(`   • Valid artists: ${transformedArtists.length}`);
        console.log(`   • Skipped: ${this.uploadStats.skipped}`);
        console.log(`   • Duplicate slugs found: ${duplicateSlugs.size}`);
        
        // Upload in batches
        const totalBatches = Math.ceil(transformedArtists.length / this.batchSize);
        console.log(`\n📤 Uploading ${transformedArtists.length} artists in ${totalBatches} batches...`);
        
                 for (let i = 0; i < totalBatches; i++) {
            const startIdx = i * this.batchSize;
            const endIdx = Math.min(startIdx + this.batchSize, transformedArtists.length);
            const batchArtists = transformedArtists.slice(startIdx, endIdx);
            
            let success = false;
            let lastError = null;
            
            // Retry logic for failed batches
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    await this.uploadBatch(batchArtists, i + 1, totalBatches, attempt);
                    this.uploadStats.successful += batchArtists.length;
                    success = true;
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < this.maxRetries) {
                        console.warn(`⚠️  Batch ${i + 1} attempt ${attempt} failed, retrying... (${error.message})`);
                        this.uploadStats.retried++;
                        // Wait longer between retry attempts
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }
            
            if (!success) {
                console.error(`❌ Batch ${i + 1} failed after ${this.maxRetries} attempts:`, lastError.message);
                
                // Try to identify problematic documents
                await this.diagnoseBatchFailure(batchArtists, i + 1);
                
                this.uploadStats.failed += batchArtists.length;
            }
            
            this.uploadStats.totalProcessed += batchArtists.length;
            
            // Small delay between batches to be respectful
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        this.uploadStats.endTime = new Date();
        this.displayUploadSummary();
    }

    /**
     * Diagnose batch failure by testing individual documents
     * @param {Array} batchArtists - Artists that failed to upload
     * @param {number} batchNum - Batch number for logging
     */
    async diagnoseBatchFailure(batchArtists, batchNum) {
        console.log(`🔍 Diagnosing batch ${batchNum} failure...`);
        const problematicDocs = [];
        
        // Test a few documents individually to identify issues
        const sampleSize = Math.min(5, batchArtists.length);
        for (let i = 0; i < sampleSize; i++) {
            const artist = batchArtists[i];
            try {
                // Validate document ID
                if (!artist.id || artist.id.includes('/') || artist.id.includes('.')) {
                    problematicDocs.push(`Invalid ID: "${artist.id}" for artist "${artist.name}"`);
                    continue;
                }
                
                // Check for field validation issues
                const { id, ...documentData } = artist;
                
                // Check for overly large fields
                const dataSize = JSON.stringify(documentData).length;
                if (dataSize > 1000000) { // 1MB limit
                    problematicDocs.push(`Document too large: ${artist.name} (${dataSize} bytes)`);
                }
                
                // Check search tokens array size
                if (documentData.searchTokens && documentData.searchTokens.length > 1000) {
                    problematicDocs.push(`Too many search tokens: ${artist.name} (${documentData.searchTokens.length} tokens)`);
                }
                
            } catch (error) {
                problematicDocs.push(`Validation error for "${artist.name}": ${error.message}`);
            }
        }
        
        if (problematicDocs.length > 0) {
            console.log(`🚨 Found potential issues:`);
            problematicDocs.forEach(issue => console.log(`   • ${issue}`));
        } else {
            console.log(`🤔 No obvious issues found in sample. May be a temporary network error.`);
        }
    }

    /**
     * Upload a single batch to Firestore
     * @param {Array} batchArtists - Artists for this batch
     * @param {number} batchNum - Current batch number
     * @param {number} totalBatches - Total number of batches
     * @param {number} attempt - Current attempt number (for retry logic)
     */
    async uploadBatch(batchArtists, batchNum, totalBatches, attempt = 1) {
        const batch = writeBatch(db);
        const artistsCollection = collection(db, this.collectionName);
        
        for (const artist of batchArtists) {
            const docRef = doc(artistsCollection, artist.id);
            // Remove the id from the document data since it's used as the document ID
            const { id, ...documentData } = artist;
            batch.set(docRef, documentData);
        }
        
        await batch.commit();
        
        const retryText = attempt > 1 ? ` (retry ${attempt})` : '';
        const progress = ((this.uploadStats.totalProcessed + batchArtists.length) / (this.uploadStats.totalProcessed + this.uploadStats.successful + this.uploadStats.failed + (totalBatches - batchNum) * this.batchSize)) * 100;
        console.log(`✅ Batch ${batchNum}/${totalBatches} uploaded (${batchArtists.length} artists)${retryText} - ${progress.toFixed(1)}%`);
    }

    /**
     * Display upload summary statistics
     */
    displayUploadSummary() {
        const duration = Math.round((this.uploadStats.endTime - this.uploadStats.startTime) / 1000);
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 FIRESTORE UPLOAD COMPLETE');
        console.log('='.repeat(60));
        
        console.log(`📊 Upload Statistics:`);
        console.log(`   • Total processed: ${this.uploadStats.totalProcessed.toLocaleString()}`);
        console.log(`   • Successful: ${this.uploadStats.successful.toLocaleString()}`);
        console.log(`   • Failed: ${this.uploadStats.failed.toLocaleString()}`);
        console.log(`   • Skipped: ${this.uploadStats.skipped.toLocaleString()}`);
        console.log(`   • Retried: ${this.uploadStats.retried.toLocaleString()}`);
        console.log(`   • Duration: ${duration} seconds`);
        console.log(`   • Collection: ${this.collectionName}`);
        
        if (this.uploadStats.failed > 0) {
            console.log(`\n⚠️  ${this.uploadStats.failed} artists failed to upload. Check logs above for details.`);
        }
        
        if (this.uploadStats.successful > 0) {
            console.log(`\n✅ Successfully uploaded ${this.uploadStats.successful} artists to Firestore!`);
            console.log(`🔍 Search tokens generated for efficient autocomplete`);
            console.log(`🔑 Document IDs use artist URL slugs for direct access`);
        }
    }

    /**
     * Main execution method
     * @param {string} dataDir - Directory containing scraped artist JSON files
     */
    async run(dataDir) {
        try {
            console.log('🚀 Firestore Artist Uploader Starting...\n');
            
            // Validate data directory
            if (!fs.existsSync(dataDir)) {
                throw new Error(`Data directory not found: ${dataDir}`);
            }
            
            // Read all artist data
            const allArtists = this.readAllArtistFiles(dataDir);
            
            if (allArtists.length === 0) {
                throw new Error('No artist data found in the specified directory');
            }
            
            // Upload to Firestore
            await this.uploadToFirestore(allArtists);
            
            console.log('\n🎉 Upload process completed successfully!');
            
        } catch (error) {
            console.error('\n❌ Upload failed:', error.message);
            process.exit(1);
        }
    }
}

// Main execution
async function main() {
    const uploader = new FirestoreUploader();
    
    // Get data directory from command line arguments
    const dataDir = process.argv[2] || 'genius-artists-2025-07-11';
    
    console.log(`📁 Using data directory: ${dataDir}`);
    console.log(`🔍 Looking for files like: genius-artists-a.json, genius-artists-b.json, etc.\n`);
    
    await uploader.run(dataDir);
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default FirestoreUploader; 