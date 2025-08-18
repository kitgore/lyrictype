import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import unidecode from 'unidecode';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

// Initialize Firebase using centralized config
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

class RemainingArtistUploader {
    constructor() {
        this.batchSize = 50; // Much smaller batches to avoid rate limits
        this.collectionName = 'artists';
        this.delayBetweenBatches = 5000; // 5 seconds between batches
        this.maxRetries = 5;
        this.uploadStats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            retried: 0,
            startTime: new Date()
        };
    }

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
        
        try {
            // Normalize Unicode characters to canonical composition
            sanitized = sanitized.normalize('NFC');
            
            // Test if the string can be properly encoded
            encodeURIComponent(sanitized);
        } catch (error) {
            // If normalization or encoding fails, fall back to unidecode
            console.warn(`⚠️  Unicode normalization failed for "${text}", using unidecode fallback`);
            sanitized = unidecode(text);
            // Clean up any remaining problematic characters after unidecode
            sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
        }
        
        return sanitized.trim();
    }

    normalizeText(text) {
        let normalized = unidecode(text);
        normalized = normalized
            .replace(/0/g, 'o')
            .replace(/\$/g, 's')
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/4/g, 'a')
            .replace(/5/g, 's')
            .replace(/7/g, 't')
            .replace(/\+/g, 'plus')
            .replace(/&/g, 'and')
            .replace(/@/g, 'at');
        return normalized.toLowerCase();
    }

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
            for (let i = 1; i <= version.length; i++) {
                tokens.add(version.substring(0, i));
            }
            
            const words = version.split(/\s+/);
            for (const word of words) {
                if (word.length > 0) {
                    for (let i = 1; i <= word.length; i++) {
                        tokens.add(word.substring(0, i));
                    }
                }
            }
            tokens.add(version);
        }
        
        tokens.add(name);
        
        return Array.from(tokens)
            .filter(token => token.length > 0 && token.length <= 100)
            .map(token => this.sanitizeFieldValue(token))
            .filter(token => token && token.length > 0);
    }

    extractSlug(url) {
        const match = url.match(/\/artists\/(.+)$/);
        if (!match) return null;
        
        let slug = match[1];
        slug = unidecode(slug);
        slug = slug.replace(/[\/]/g, '-');
        slug = slug.replace(/[.#$\[\]]/g, '-');
        slug = slug.replace(/[^\w\-_.~]/g, '-');
        slug = slug.replace(/-+/g, '-');
        slug = slug.replace(/^-+|-+$/g, '');
        
        if (slug.length > 800) {
            slug = slug.substring(0, 800).replace(/-+$/, '');
        }
        
        if (!slug || slug.trim() === '') {
            return null;
        }
        
        return slug;
    }

    validateFirestoreData(data, path = '') {
        const issues = [];
        
        if (data === null || data === undefined) {
            return issues;
        }
        
        if (typeof data === 'string') {
            // Check for invalid UTF-8 sequences
            try {
                encodeURIComponent(data);
            } catch (e) {
                issues.push(`Invalid UTF-8 in string at ${path}`);
            }
            
            // Check for control characters
            if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(data)) {
                issues.push(`Control characters in string at ${path}`);
            }
            
            // Check for extremely long strings
            if (data.length > 1048487) { // Firestore's 1MB limit for strings
                issues.push(`String too long at ${path}: ${data.length} characters`);
            }
        } else if (Array.isArray(data)) {
            // Check array size
            if (data.length > 20000) { // Firestore has array size limits
                issues.push(`Array too large at ${path}: ${data.length} items`);
            }
            
            data.forEach((item, index) => {
                issues.push(...this.validateFirestoreData(item, `${path}[${index}]`));
            });
        } else if (typeof data === 'object') {
            Object.entries(data).forEach(([key, value]) => {
                // Check field name validity
                if (key.includes('.') || key.includes('/') || key.startsWith('__')) {
                    issues.push(`Invalid field name: "${key}"`);
                }
                
                issues.push(...this.validateFirestoreData(value, path ? `${path}.${key}` : key));
            });
        }
        
        return issues;
    }

    transformArtist(artist) {
        if (!artist.name || !artist.url) {
            return null;
        }

        const slug = this.extractSlug(artist.url);
        if (!slug) {
            return null;
        }

        const sanitizedName = this.sanitizeFieldValue(artist.name);
        const sanitizedUrl = this.sanitizeFieldValue(artist.url);
        
        // Additional validation for problematic cases
        if (!sanitizedName || sanitizedName.trim() === '' || !sanitizedUrl || sanitizedUrl.trim() === '') {
            console.warn(`❌ Failed to sanitize artist: ${artist.name} - ${artist.url}`);
            return null;
        }
        
        const nameForSorting = sanitizedName.toLowerCase().replace(/^(the |a |an )/, '');
        const firstLetter = nameForSorting.charAt(0).toLowerCase();
        
        // Generate search tokens with extra validation
        let searchTokens;
        try {
            searchTokens = this.generateSearchTokens(sanitizedName);
            
            // Limit search tokens to prevent oversized arrays
            if (searchTokens.length > 5000) {
                console.warn(`⚠️  Too many search tokens for ${sanitizedName}, limiting to 5000`);
                searchTokens = searchTokens.slice(0, 5000);
            }
        } catch (error) {
            console.warn(`❌ Failed to generate search tokens for ${sanitizedName}: ${error.message}`);
            searchTokens = [sanitizedName.toLowerCase()];
        }

        const transformedArtist = {
            id: slug,
            name: sanitizedName,
            url: sanitizedUrl,
            geniusId: artist.id || null,
            type: artist.type || 'regular',
            searchTokens: searchTokens,
            nameForSorting: nameForSorting,
            uploadedAt: new Date().toISOString(),
            firstLetter: firstLetter
        };

        // Final validation check
        const validationIssues = this.validateFirestoreData(transformedArtist);
        if (validationIssues.length > 0) {
            console.warn(`❌ Validation failed for ${sanitizedName}: ${validationIssues.join(', ')}`);
            return null;
        }

        return transformedArtist;
    }

    getRemainingArtists(dataDir) {
        const allArtists = [];
        const fileKeys = ['0', ...('abcdefghijklmnopqrstuvwxyz'.split(''))];
        
        for (const key of fileKeys) {
            const filename = `genius-artists-${key}.json`;
            const filepath = path.join(dataDir, filename);
            
            if (fs.existsSync(filepath)) {
                try {
                    const fileContent = fs.readFileSync(filepath, 'utf8');
                    const letterData = JSON.parse(fileContent);
                    
                    if (letterData.artists?.popular) {
                        allArtists.push(...letterData.artists.popular);
                    }
                    
                    if (letterData.artists?.regular) {
                        allArtists.push(...letterData.artists.regular);
                    }
                } catch (error) {
                    console.error(`❌ Error reading ${filename}:`, error.message);
                }
            }
        }
        
        const transformedArtists = allArtists
            .map(artist => this.transformArtist(artist))
            .filter(artist => artist !== null);
        
        // Get artists from the problematic batches (8 and 33)
        const problematicBatches = [8, 33];
        const problematicArtists = [];
        
        for (const batchNum of problematicBatches) {
            const startIdx = (batchNum - 1) * 500; // Original batch size was 500
            const endIdx = Math.min(startIdx + 500, transformedArtists.length);
            const batchArtists = transformedArtists.slice(startIdx, endIdx);
            problematicArtists.push(...batchArtists);
        }
        
        console.log(`📊 Found ${problematicArtists.length} artists from problematic batches`);
        return problematicArtists;
    }

    async uploadBatchWithRateLimit(batchArtists, batchNum, totalBatches, attempt = 1) {
        try {
            const batch = writeBatch(db);
            const artistsCollection = collection(db, this.collectionName);
            
            for (const artist of batchArtists) {
                const docRef = doc(artistsCollection, artist.id);
                const { id, ...documentData } = artist;
                batch.set(docRef, documentData);
            }
            
            await batch.commit();
            
            const retryText = attempt > 1 ? ` (retry ${attempt})` : '';
            console.log(`✅ Batch ${batchNum}/${totalBatches} uploaded (${batchArtists.length} artists)${retryText}`);
            
            return { success: true, uploaded: batchArtists.length, failed: 0 };
        } catch (error) {
            // If batch fails, try uploading documents individually to identify problematic ones
            if (attempt === 1) {
                console.warn(`⚠️  Batch ${batchNum} failed, trying individual uploads...`);
                return await this.uploadIndividually(batchArtists, batchNum, totalBatches);
            }
            throw error;
        }
    }

    async uploadIndividually(batchArtists, batchNum, totalBatches) {
        const artistsCollection = collection(db, this.collectionName);
        let uploaded = 0;
        let failed = 0;
        
        for (const artist of batchArtists) {
            try {
                const docRef = doc(artistsCollection, artist.id);
                const { id, ...documentData } = artist;
                
                const batch = writeBatch(db);
                batch.set(docRef, documentData);
                await batch.commit();
                
                uploaded++;
            } catch (error) {
                console.warn(`❌ Failed to upload individual artist: ${artist.name} - ${error.message}`);
                failed++;
                
                // Log problematic artist for analysis
                fs.appendFileSync('failed_artists.json', JSON.stringify({
                    name: artist.name,
                    url: artist.url,
                    error: error.message,
                    timestamp: new Date().toISOString()
                }) + '\n');
            }
        }
        
        if (uploaded > 0) {
            console.log(`✅ Batch ${batchNum}/${totalBatches} individual upload: ${uploaded} successful, ${failed} failed`);
        }
        
        return { success: uploaded > 0, uploaded, failed };
    }

    async uploadRemainingArtists(dataDir) {
        console.log('🚀 Rate-Limited Upload of Remaining Artists...\n');
        
        const remainingArtists = this.getRemainingArtists(dataDir);
        const totalBatches = Math.ceil(remainingArtists.length / this.batchSize);
        
        console.log(`📦 Uploading ${remainingArtists.length} artists in ${totalBatches} small batches`);
        console.log(`⏱️  Batch size: ${this.batchSize} (reduced from 500)`);
        console.log(`⏰ Delay between batches: ${this.delayBetweenBatches}ms`);
        console.log('');
        
        for (let i = 0; i < totalBatches; i++) {
            const startIdx = i * this.batchSize;
            const endIdx = Math.min(startIdx + this.batchSize, remainingArtists.length);
            const batchArtists = remainingArtists.slice(startIdx, endIdx);
            
            let success = false;
            let lastError = null;
            
            // Retry logic with exponential backoff
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    const result = await this.uploadBatchWithRateLimit(batchArtists, i + 1, totalBatches, attempt);
                    
                    if (result.success) {
                        this.uploadStats.successful += result.uploaded;
                        this.uploadStats.failed += result.failed;
                        success = true;
                        break;
                    } else {
                        throw new Error('Upload failed');
                    }
                } catch (error) {
                    lastError = error;
                    
                    if (attempt < this.maxRetries) {
                        const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
                        console.warn(`⚠️  Batch ${i + 1} attempt ${attempt} failed, retrying in ${backoffDelay}ms... (${error.message})`);
                        this.uploadStats.retried++;
                        await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    }
                }
            }
            
            if (!success) {
                console.error(`❌ Batch ${i + 1} failed after ${this.maxRetries} attempts:`, lastError.message);
                this.uploadStats.failed += batchArtists.length;
            }
            
            this.uploadStats.totalProcessed += batchArtists.length;
            
            // Progress update
            const progress = ((i + 1) / totalBatches * 100).toFixed(1);
            console.log(`📈 Progress: ${progress}% (${this.uploadStats.successful}/${remainingArtists.length} successful)`);
            
            // Rate limiting delay between batches (except for the last batch)
            if (i < totalBatches - 1) {
                console.log(`⏸️  Waiting ${this.delayBetweenBatches}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
            }
        }
        
        this.uploadStats.endTime = new Date();
        this.displaySummary(remainingArtists.length);
    }

    displaySummary(totalArtists) {
        const duration = Math.round((this.uploadStats.endTime - this.uploadStats.startTime) / 1000);
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 RATE-LIMITED UPLOAD COMPLETE');
        console.log('='.repeat(60));
        console.log(`📊 Upload Statistics:`);
        console.log(`   • Total processed: ${this.uploadStats.totalProcessed.toLocaleString()}`);
        console.log(`   • Successful: ${this.uploadStats.successful.toLocaleString()}`);
        console.log(`   • Failed: ${this.uploadStats.failed.toLocaleString()}`);
        console.log(`   • Retried: ${this.uploadStats.retried.toLocaleString()}`);
        console.log(`   • Success rate: ${((this.uploadStats.successful / totalArtists) * 100).toFixed(1)}%`);
        console.log(`   • Duration: ${duration} seconds`);
        console.log(`   • Collection: ${this.collectionName}`);
        
        if (this.uploadStats.successful > 0) {
            console.log(`\n✅ Successfully uploaded ${this.uploadStats.successful} remaining artists!`);
        }
        
        if (this.uploadStats.failed > 0) {
            console.log(`\n⚠️  ${this.uploadStats.failed} artists still failed due to rate limits.`);
            console.log(`💡 Consider running this script again later or upgrading Firebase plan.`);
        }
    }
}

// Run the uploader
const uploader = new RemainingArtistUploader();
const dataDir = process.argv[2] || 'genius-artists-2025-07-11';

uploader.uploadRemainingArtists(dataDir)
    .then(() => {
        console.log('\n🏁 Rate-limited upload complete!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Upload failed:', error);
        process.exit(1);
    }); 