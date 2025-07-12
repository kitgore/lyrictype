import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import unidecode from 'unidecode';
import { firebaseConfig } from './src/lib/services/initFirebase.js';

// Initialize Firebase using centralized config
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

class ArtistDiagnostic {
    constructor() {
        this.batchSize = 500;
        this.problematicBatches = [8, 33];
    }

    sanitizeFieldValue(text) {
        if (!text) return text;
        
        let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        try {
            sanitized = sanitized.normalize('NFC');
        } catch (error) {
            sanitized = unidecode(sanitized);
        }
        
        return sanitized;
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
        
        const versions = [cleanName];
        if (normalizedName !== cleanName) {
            versions.push(normalizedName);
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
            uploadedAt: new Date().toISOString(),
            firstLetter: firstLetter
        };
    }

    readAllArtistFiles(dataDir) {
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
        
        return allArtists;
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
                issues.push(`Invalid UTF-8 in string at ${path}: "${data.substring(0, 50)}..."`);
            }
            
            // Check for control characters
            if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(data)) {
                issues.push(`Control characters in string at ${path}: "${data.substring(0, 50)}..."`);
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

    async testSingleDocument(artistDoc) {
        try {
            const testCollection = collection(db, 'test_validation');
            const batch = writeBatch(db);
            const docRef = doc(testCollection, `test_${Date.now()}`);
            
            batch.set(docRef, artistDoc);
            await batch.commit();
            
            // Clean up test document
            batch.delete(docRef);
            await batch.commit();
            
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async diagnoseProblematicBatches(dataDir) {
        console.log('🔍 Diagnosing problematic batches 8 and 33...\n');
        
        const allArtists = this.readAllArtistFiles(dataDir);
        console.log(`📊 Total artists loaded: ${allArtists.length}`);
        
        const transformedArtists = allArtists
            .map(artist => this.transformArtist(artist))
            .filter(artist => artist !== null);
        
        console.log(`📊 Valid transformed artists: ${transformedArtists.length}\n`);
        
        for (const batchNum of this.problematicBatches) {
            console.log(`\n🔍 Analyzing Batch ${batchNum}:`);
            
            const startIdx = (batchNum - 1) * this.batchSize;
            const endIdx = Math.min(startIdx + this.batchSize, transformedArtists.length);
            const batchArtists = transformedArtists.slice(startIdx, endIdx);
            
            console.log(`   Range: ${startIdx} - ${endIdx - 1} (${batchArtists.length} artists)`);
            
            const problematicArtists = [];
            
            for (let i = 0; i < batchArtists.length; i++) {
                const artist = batchArtists[i];
                const artistIndex = startIdx + i;
                
                // Validate data structure
                const validationIssues = this.validateFirestoreData(artist);
                
                if (validationIssues.length > 0) {
                    console.log(`\n❌ Artist ${artistIndex}: ${artist.name}`);
                    console.log(`   URL: ${artist.url}`);
                    console.log(`   Issues: ${validationIssues.join(', ')}`);
                    problematicArtists.push({ index: artistIndex, artist, issues: validationIssues });
                    continue;
                }
                
                // Test actual Firestore upload for suspicious cases
                const docData = { ...artist };
                delete docData.id; // Remove id for document data
                
                if (artist.name.length > 100 || 
                    artist.searchTokens.length > 1000 ||
                    JSON.stringify(docData).length > 500000) {
                    
                    console.log(`\n🧪 Testing potentially problematic artist: ${artist.name}`);
                    const testResult = await this.testSingleDocument(docData);
                    
                    if (!testResult.success) {
                        console.log(`❌ Failed: ${testResult.error}`);
                        problematicArtists.push({ 
                            index: artistIndex, 
                            artist, 
                            issues: [testResult.error] 
                        });
                    } else {
                        console.log(`✅ Passed`);
                    }
                }
            }
            
            if (problematicArtists.length === 0) {
                console.log(`✅ No obvious problems found in batch ${batchNum}`);
            } else {
                console.log(`\n❌ Found ${problematicArtists.length} problematic artists in batch ${batchNum}:`);
                
                // Save problematic artists to file for analysis
                const outputFile = `problematic_batch_${batchNum}.json`;
                fs.writeFileSync(outputFile, JSON.stringify(problematicArtists, null, 2));
                console.log(`📁 Saved details to: ${outputFile}`);
            }
        }
    }
}

// Run the diagnostic
const diagnostic = new ArtistDiagnostic();
const dataDir = process.argv[2] || 'genius-artists-2025-07-11';

diagnostic.diagnoseProblematicBatches(dataDir)
    .then(() => {
        console.log('\n🏁 Diagnostic complete!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Diagnostic failed:', error);
        process.exit(1);
    }); 