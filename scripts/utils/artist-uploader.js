/**
 * Artist Uploader Utility
 * Consolidated upload functionality with search token generation
 * Merges functionality from upload-to-firestore.js and upload-remaining-artists.js
 */

import { getFirestore, collection, writeBatch, doc, getDoc } from 'firebase/firestore';
import unidecode from 'unidecode';

/**
 * ArtistUploader class
 * Handles uploading artists to Firestore with smart batching and search tokens
 */
export class ArtistUploader {
    constructor(db, options = {}) {
        this.db = db;
        this.collectionName = options.collection || 'artists';
        this.batchSize = options.batchSize || 100; // Default: medium
        this.delayBetweenBatches = options.delay || 1000;
        this.maxRetries = options.maxRetries || 3;
        this.skipExisting = options.skipExisting !== false; // Default: true
        
        // Batch size presets
        if (options.batchSize === 'small') this.batchSize = 50;
        if (options.batchSize === 'medium') this.batchSize = 100;
        if (options.batchSize === 'large') this.batchSize = 500;
    }
    
    /**
     * Sanitize field value for Firestore storage
     */
    sanitizeFieldValue(text) {
        if (!text) return text;
        
        let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        sanitized = sanitized.replace(/[\uFE00-\uFE0F]/g, '');
        sanitized = sanitized.replace(/[\u200B-\u200F]/g, '');
        sanitized = sanitized.replace(/[\u2060-\u206F]/g, '');
        sanitized = sanitized.replace(/[\uFEFF]/g, '');
        sanitized = sanitized.replace(/\uDB40[\uDC00-\uDC7F]/g, '');
        sanitized = sanitized.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');
        sanitized = sanitized.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
        
        try {
            sanitized = sanitized.normalize('NFC');
            encodeURIComponent(sanitized);
        } catch (error) {
            sanitized = unidecode(text);
            sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
        }
        
        return sanitized.trim();
    }
    
    /**
     * Normalize text for search token generation
     */
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
    
    /**
     * Generate search tokens for autocomplete
     */
    generateSearchTokens(name) {
        const tokens = new Set();
        const cleanName = name.toLowerCase().trim();
        const normalizedName = this.normalizeText(name);
        
        const removePunctuation = (text) => 
            text.replace(/[.,\-_'"!?&@#$%^*()+=\[\]{};:|<>\/\\`~]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        
        const cleanNameNoPunct = removePunctuation(cleanName);
        const normalizedNameNoPunct = removePunctuation(normalizedName);
        
        const versions = [cleanName];
        if (normalizedName !== cleanName) {
            versions.push(normalizedName);
        }
        if (cleanNameNoPunct !== cleanName && cleanNameNoPunct.length > 0) {
            versions.push(cleanNameNoPunct);
        }
        if (normalizedNameNoPunct !== normalizedName && 
            normalizedNameNoPunct !== cleanNameNoPunct && 
            normalizedNameNoPunct.length > 0) {
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
    
    /**
     * Extract artist slug from Genius URL
     */
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
    
    /**
     * Transform artist for Firestore
     */
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
        
        if (!sanitizedName || !sanitizedUrl) {
            return null;
        }
        
        const nameForSorting = sanitizedName.toLowerCase().replace(/^(the |a |an )/, '');
        const firstLetter = nameForSorting.charAt(0).toLowerCase();
        
        let searchTokens;
        try {
            searchTokens = this.generateSearchTokens(sanitizedName);
            if (searchTokens.length > 5000) {
                searchTokens = searchTokens.slice(0, 5000);
            }
        } catch (error) {
            searchTokens = [sanitizedName.toLowerCase()];
        }
        
        return {
            id: slug,
            name: sanitizedName,
            url: sanitizedUrl,
            geniusId: artist.id || null,
            type: artist.type || 'regular',
            searchTokens: searchTokens,
            nameForSorting: nameForSorting,
            uploadedAt: new Date(),
            firstLetter: firstLetter
        };
    }
    
    /**
     * Check if artist exists in Firestore
     */
    async artistExists(artistId) {
        if (!this.skipExisting) return false;
        
        try {
            const artistRef = doc(this.db, this.collectionName, artistId);
            const docSnap = await getDoc(artistRef);
            return docSnap.exists();
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Upload a batch of artists
     */
    async uploadBatch(artists, onProgress = null) {
        const batch = writeBatch(this.db);
        const artistsCollection = collection(this.db, this.collectionName);
        const skipped = [];
        const uploaded = [];
        
        for (const artist of artists) {
            const transformed = this.transformArtist(artist);
            if (!transformed) {
                skipped.push({ artist, reason: 'transformation_failed' });
                continue;
            }
            
            if (await this.artistExists(transformed.id)) {
                skipped.push({ artist, reason: 'already_exists' });
                if (onProgress) onProgress({ skipped: true });
                continue;
            }
            
            const { id, ...documentData } = transformed;
            const docRef = doc(artistsCollection, id);
            batch.set(docRef, documentData);
            uploaded.push(id);
            
            if (onProgress) onProgress({ uploaded: true });
        }
        
        if (uploaded.length > 0) {
            await batch.commit();
        }
        
        return { uploaded, skipped };
    }
    
    /**
     * Upload artists with automatic batching and retries
     */
    async uploadArtists(artists, onProgress = null, onBatchComplete = null) {
        const results = {
            successful: 0,
            failed: 0,
            skipped: 0,
            errors: []
        };
        
        const totalBatches = Math.ceil(artists.length / this.batchSize);
        
        for (let i = 0; i < totalBatches; i++) {
            const startIdx = i * this.batchSize;
            const endIdx = Math.min(startIdx + this.batchSize, artists.length);
            const batchArtists = artists.slice(startIdx, endIdx);
            
            let success = false;
            let lastError = null;
            
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    const batchResult = await this.uploadBatch(batchArtists, onProgress);
                    results.successful += batchResult.uploaded.length;
                    results.skipped += batchResult.skipped.length;
                    success = true;
                    break;
                } catch (error) {
                    lastError = error;
                    if (attempt < this.maxRetries) {
                        const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
                        await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    }
                }
            }
            
            if (!success) {
                results.failed += batchArtists.length;
                results.errors.push({
                    batch: i + 1,
                    error: lastError.message
                });
            }
            
            if (onBatchComplete) {
                onBatchComplete(i + 1, totalBatches);
            }
            
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
            }
        }
        
        return results;
    }
}

/**
 * Create an artist uploader instance
 */
export function createArtistUploader(db, options = {}) {
    return new ArtistUploader(db, options);
}

