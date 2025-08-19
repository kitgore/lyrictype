import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as cheerio from 'cheerio';
import pako from 'pako';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin SDK
const app = initializeApp();
const db = getFirestore(app);

const geniusApiKeyParam = defineString('GENIUS_KEY');

// Use the global fetch that comes with Node.js 18+ instead of node-fetch
// This is more compatible with Firebase Functions environment
const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${options.timeout || 10000}ms`);
    }
    throw error;
  }
};

// SSR server removed - now using pure static hosting with optimized binary image system
// All image processing is now done via dedicated Firebase Functions with Firestore caching

// Keep existing health check
export const healthCheck = onRequest({
    timeoutSeconds: 10,
    region: 'us-central1'
}, (req, res) => {
    res.status(200).send('OK');
});

/**
 * Server-side Atkinson dithering algorithm
 * @param {object} imageData - Canvas ImageData object
 * @returns {Uint8Array} Binary array (1 bit per pixel, packed into bytes)
 */
function atkinsonDitherToBinary(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = new Uint8ClampedArray(imageData.data);
    
    // Convert to grayscale first
    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        data[i] = data[i + 1] = data[i + 2] = gray;
    }

    // Atkinson dithering matrix
    const matrix = [
        [0, 0, 1/8, 1/8],
        [1/8, 1/8, 1/8, 0],
        [0, 1/8, 0, 0]
    ];

    // Create binary output array (1 bit per pixel, packed into bytes)
    const binarySize = Math.ceil((width * height) / 8);
    const binaryData = new Uint8Array(binarySize);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const oldPixel = data[idx];
            
            // Determine if pixel should be dark or light
            const isDark = oldPixel < 128;
            
            // Store binary result (1 for light, 0 for dark)
            const bitIndex = y * width + x;
            const byteIndex = Math.floor(bitIndex / 8);
            const bitPosition = 7 - (bitIndex % 8);
            
            if (!isDark) { // Light pixel = 1
                binaryData[byteIndex] |= (1 << bitPosition);
            }
            
            const newPixel = isDark ? 0 : 255;
            const error = (oldPixel - newPixel) / 8;

            // Propagate error using Atkinson matrix
            for (let i = 0; i < matrix.length; i++) {
                for (let j = 0; j < matrix[i].length; j++) {
                    if (matrix[i][j] === 0) continue;
                    
                    const ny = y + i;
                    const nx = x + j - 1;
                    
                    if (ny < height && nx >= 0 && nx < width) {
                        const nidx = (ny * width + nx) * 4;
                        data[nidx] += error;
                        data[nidx + 1] += error;
                        data[nidx + 2] += error;
                    }
                }
            }
        }
    }

    return binaryData;
}

/**
 * Analyze binary dithered data for compression and statistics
 */
function analyzeBinaryData(binaryData, width, height) {
    const totalPixels = width * height;
    const totalBytes = binaryData.length;
    const originalSize = totalPixels * 4; // RGBA
    const compressionRatio = totalBytes / originalSize;
    
    // Calculate white pixel count
    let setBits = 0;
    for (let byte of binaryData) {
        setBits += byte.toString(2).split('1').length - 1;
    }
    
    return {
        totalPixels,
        totalBytes,
        originalSize,
        compressionRatio: compressionRatio.toFixed(3),
        compressionPercent: ((1 - compressionRatio) * 100).toFixed(1),
        setBits,
        whiteFraction: (setBits / totalPixels).toFixed(3),
        whitePercent: ((setBits / totalPixels) * 100).toFixed(1),
    };
}

/**
 * Process artist image to binary format and store in database
 * Fast response - client gets binary data ASAP
 */
async function processAndStoreArtistImage(imageUrl, artistUrlKey, targetSize = 200) {
    try {
        console.log(`🚀 FAST processing artist image: ${imageUrl}`);
        const startTime = Date.now();
        
        // Fetch the image
        const imageResponse = await fetchWithTimeout(imageUrl, { timeout: 8000 });
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        console.log(`📦 Downloaded: ${imageBuffer.byteLength} bytes in ${Date.now() - startTime}ms`);

        // Process with canvas
        const { createCanvas, loadImage } = await import('canvas');
        const img = await loadImage(Buffer.from(imageBuffer));
        
        // Create canvas with target size
        const canvas = createCanvas(targetSize, targetSize);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetSize, targetSize);
        
        const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
        
        // Apply dithering and get binary data
        const binaryData = atkinsonDitherToBinary(imageData);
        const analysis = analyzeBinaryData(binaryData, targetSize, targetSize);
        
        console.log(`⚡ Binary processed in ${Date.now() - startTime}ms: ${analysis.totalBytes} bytes (${analysis.compressionPercent}% compression)`);
        
        // Compress with Pako
        const compressedData = pako.deflate(binaryData);
        console.log(`🗜️  Pako compressed: ${binaryData.length} → ${compressedData.length} bytes (${((1 - compressedData.length / binaryData.length) * 100).toFixed(1)}% reduction)`);
        
        // Store in artist document
        const base64Binary = Buffer.from(compressedData).toString('base64');
        const imageMetadata = {
            binaryImageData: base64Binary,
            imageWidth: targetSize,
            imageHeight: targetSize,
            originalImageUrl: imageUrl,
            originalSize: imageBuffer.byteLength,
            binarySize: analysis.totalBytes,
            compressedSize: compressedData.length,
            base64Size: base64Binary.length,
            compressionRatio: analysis.compressionRatio,
            pakoCompressionRatio: compressedData.length / binaryData.length,
            totalCompressionRatio: compressedData.length / imageBuffer.byteLength,
            processedAt: new Date(),
            processingVersion: '1.1-pako',
            compressionMethod: 'pako-deflate'
        };
        
        // Update or create artist document with binary data
        try {
            await db.collection('artists').doc(artistUrlKey).update({
                imageUrl: imageUrl,
                ...imageMetadata
            });
        } catch (updateError) {
            if (updateError.code === 'not-found') {
                // Document doesn't exist, create it
                console.log(`📝 Creating new artist document: ${artistUrlKey}`);
                await db.collection('artists').doc(artistUrlKey).set({
                    imageUrl: imageUrl,
                    ...imageMetadata,
                    createdAt: new Date()
                });
            } else {
                throw updateError;
            }
        }
        
        console.log(`💾 Stored binary data for artist ${artistUrlKey} in ${Date.now() - startTime}ms total`);
        
        return {
            success: true,
            binaryData: base64Binary,
            metadata: {
                width: targetSize,
                height: targetSize,
                originalSize: imageBuffer.byteLength,
                binarySize: analysis.totalBytes,
                compressedSize: compressedData.length,
                base64Size: base64Binary.length,
                compressionRatio: analysis.compressionRatio,
                pakoCompressionRatio: compressedData.length / binaryData.length,
                totalCompressionRatio: compressedData.length / imageBuffer.byteLength,
                compressionPercent: analysis.compressionPercent,
                pakoCompressionPercent: ((1 - compressedData.length / binaryData.length) * 100).toFixed(1),
                totalCompressionPercent: ((1 - compressedData.length / imageBuffer.byteLength) * 100).toFixed(1),
                whitePixelPercent: analysis.whitePercent,
                processingTimeMs: Date.now() - startTime,
                compressionMethod: 'pako-deflate'
            }
        };
        
    } catch (error) {
        console.error(`❌ Error processing artist image:`, error);
        throw error;
    }
}

// Fast Artist Image Processing - prioritizes speed for client response
export const processArtistImageBinary = onRequest({
    timeoutSeconds: 15,
    minInstances: 0,
    maxInstances: 20,
    region: 'us-central1',
    invoker: 'public'
}, async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).send('');
        return;
    }

    const imageUrl = req.query.url || req.body?.url;
    const artistUrlKey = req.query.artistKey || req.body?.artistKey;
    const targetSize = parseInt(req.query.size || req.body?.size || '200');

    if (!imageUrl) {
        res.status(400).json({ error: 'No image URL provided' });
        return;
    }
    
    if (!artistUrlKey) {
        res.status(400).json({ error: 'No artist key provided' });
        return;
    }

    try {
        const result = await processAndStoreArtistImage(imageUrl, artistUrlKey, targetSize);
        res.json(result);
    } catch (error) {
        console.error('❌ Error in processArtistImageBinary:', error);
        res.status(500).json({ 
            error: 'Failed to process artist image', 
            details: error.message 
        });
    }
});

/**
 * Try to convert unsupported image formats to supported ones
 * @param {string} imageUrl - Original image URL
 * @returns {string} Modified URL that might work better
 */
function tryAlternativeImageFormat(imageUrl) {
    // Convert .webp to .jpg - Genius often has both formats
    if (imageUrl.includes('.webp')) {
        const jpgUrl = imageUrl.replace('.webp', '.jpg');
        console.log(`🔄 Trying alternative format: ${jpgUrl}`);
        return jpgUrl;
    }
    
    // For other formats, try to get a .jpg version by removing size specifications
    // e.g., file.464x464x1.png -> file.jpg
    const baseUrl = imageUrl.replace(/\.\d+x\d+x?\d*\.(png|gif|webp)$/i, '.jpg');
    if (baseUrl !== imageUrl) {
        console.log(`🔄 Trying simplified format: ${baseUrl}`);
        return baseUrl;
    }
    
    return imageUrl;
}

/**
 * Process album art to binary format and store in database
 * Similar to artist processing but stores in albumArt collection
 * Uses 800x800 resolution for high quality on results screen
 */
async function processAndStoreAlbumArt(imageUrl, albumArtId, targetSize = 800) {
    const startTime = Date.now();
    let lastError = null;
    
    // Try original URL first, then alternative formats
    const urlsToTry = [imageUrl];
    
    // Add alternative format if original might be problematic
    const altUrl = tryAlternativeImageFormat(imageUrl);
    if (altUrl !== imageUrl) {
        urlsToTry.push(altUrl);
    }
    
    // Also try without size specification for backup
    const simpleUrl = imageUrl.replace(/\.\d+x\d+x?\d*\./g, '.');
    if (simpleUrl !== imageUrl && !urlsToTry.includes(simpleUrl)) {
        urlsToTry.push(simpleUrl);
    }
    
    for (let i = 0; i < urlsToTry.length; i++) {
        const currentUrl = urlsToTry[i];
        
        try {
            console.log(`🚀 FAST processing album art: ${currentUrl} (ID: ${albumArtId})${i > 0 ? ` [attempt ${i + 1}]` : ''}`);
            
            // Fetch the image
            const imageResponse = await fetchWithTimeout(currentUrl, { timeout: 8000 });
            if (!imageResponse.ok) {
                throw new Error(`Failed to fetch image: ${imageResponse.status}`);
            }
            
            const imageBuffer = await imageResponse.arrayBuffer();
            console.log(`📦 Downloaded: ${imageBuffer.byteLength} bytes in ${Date.now() - startTime}ms`);

            // Process with canvas
            const { createCanvas, loadImage } = await import('canvas');
            const img = await loadImage(Buffer.from(imageBuffer));
            
            // Create canvas with target size
            const canvas = createCanvas(targetSize, targetSize);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetSize, targetSize);
            
            const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
            
            // Apply dithering and get binary data
            const binaryData = atkinsonDitherToBinary(imageData);
            const analysis = analyzeBinaryData(binaryData, targetSize, targetSize);
            
            console.log(`⚡ Binary processed in ${Date.now() - startTime}ms: ${analysis.totalBytes} bytes (${analysis.compressionPercent}% compression)`);
            
            // Compress with Pako
            const compressedData = pako.deflate(binaryData);
            console.log(`🗜️  Pako compressed: ${binaryData.length} → ${compressedData.length} bytes (${((1 - compressedData.length / binaryData.length) * 100).toFixed(1)}% reduction)`);
            
            // Store in albumArt collection
            const base64Binary = Buffer.from(compressedData).toString('base64');
            const albumArtMetadata = {
                binaryImageData: base64Binary,
                imageWidth: targetSize,
                imageHeight: targetSize,
                originalImageUrl: imageUrl, // Store original URL for reference
                processedImageUrl: currentUrl, // Store URL that actually worked
                processedAt: new Date(),
                processingVersion: '1.1-pako',
                compressionMethod: 'pako-deflate'
            };
            
            // Store in albumArt collection using the provided ID
            await db.collection('albumArt').doc(albumArtId).set(albumArtMetadata);
            
            console.log(`💾 Stored album art binary data for ${albumArtId} in ${Date.now() - startTime}ms total${i > 0 ? ` (used fallback URL)` : ''}`);
            
            return {
                success: true,
                binaryData: base64Binary,
                metadata: {
                    albumArtId: albumArtId,
                    width: targetSize,
                    height: targetSize,
                    originalSize: imageBuffer.byteLength,
                    binarySize: analysis.totalBytes,
                    compressedSize: compressedData.length,
                    compressionRatio: analysis.compressionRatio,
                    pakoCompressionRatio: compressedData.length / binaryData.length,
                    totalCompressionRatio: compressedData.length / imageBuffer.byteLength,
                    compressionPercent: analysis.compressionPercent,
                    pakoCompressionPercent: ((1 - compressedData.length / binaryData.length) * 100).toFixed(1),
                    totalCompressionPercent: ((1 - compressedData.length / imageBuffer.byteLength) * 100).toFixed(1),
                    whitePixelPercent: analysis.whitePercent,
                    processingTimeMs: Date.now() - startTime,
                    compressionMethod: 'pako-deflate',
                    usedFallbackUrl: i > 0
                }
            };
            
        } catch (error) {
            lastError = error;
            const isUnsupportedFormat = error.message.includes('Unsupported image type');
            const isLastAttempt = i === urlsToTry.length - 1;
            
            if (isUnsupportedFormat && !isLastAttempt) {
                console.log(`⚠️  Format not supported for ${currentUrl}, trying alternative...`);
                continue; // Try next URL
            } else if (isLastAttempt) {
                console.error(`❌ Error processing album art ${albumArtId} (all ${urlsToTry.length} URLs failed):`, error.message);
                break; // Give up after all attempts
            } else {
                console.log(`⚠️  Error with ${currentUrl}, trying alternative:`, error.message);
                continue; // Try next URL
            }
        }
    }
    
    // If we get here, all attempts failed
    throw lastError || new Error('All image format attempts failed');
}

// Fast Album Art Processing - prioritizes speed for client response
export const processAlbumArtBinary = onRequest({
    timeoutSeconds: 15,
    minInstances: 0,
    maxInstances: 20,
    region: 'us-central1',
    invoker: 'public'
}, async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).send('');
        return;
    }

    const imageUrl = req.query.url || req.body?.url;
    const albumArtId = req.query.albumArtId || req.body?.albumArtId;
    const targetSize = parseInt(req.query.size || req.body?.size || '200');

    if (!imageUrl) {
        res.status(400).json({ error: 'No image URL provided' });
        return;
    }
    
    if (!albumArtId) {
        res.status(400).json({ error: 'No album art ID provided' });
        return;
    }

    try {
        const result = await processAndStoreAlbumArt(imageUrl, albumArtId, targetSize);
        res.json(result);
    } catch (error) {
        console.error('❌ Error in processAlbumArtBinary:', error);
        res.status(500).json({ 
            error: 'Failed to process album art', 
            details: error.message 
        });
    }
});

// Binary Image Processing Function
export const processImageBinary = onRequest({
    timeoutSeconds: 30,
    minInstances: 0,
    maxInstances: 10,
    region: 'us-central1',
    invoker: 'public'
}, async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).send('');
        return;
    }

    const imageUrl = req.query.url || req.body?.url;
    const targetSize = parseInt(req.query.size || req.body?.size || '200');
    const returnBinary = req.query.binary === 'true' || req.body?.binary === true;
    const logAnalysis = req.query.log === 'true' || req.body?.log === true;

    if (!imageUrl) {
        res.status(400).json({ error: 'No image URL provided' });
        return;
    }

    try {
        console.log(`🎨 Processing image: ${imageUrl} (size: ${targetSize}, binary: ${returnBinary})`);
        
        // Fetch the image
        const imageResponse = await fetchWithTimeout(imageUrl, { timeout: 10000 });
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        console.log(`📦 Downloaded image: ${imageBuffer.byteLength} bytes`);

        // Process with canvas
        const { createCanvas, loadImage } = await import('canvas');
        const img = await loadImage(Buffer.from(imageBuffer));
        
        // Create canvas with target size
        const canvas = createCanvas(targetSize, targetSize);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetSize, targetSize);
        
        const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
        console.log(`🖼️  Got image data: ${imageData.width}x${imageData.height}`);
        
        if (returnBinary) {
            // Apply dithering and get binary data
            const binaryData = atkinsonDitherToBinary(imageData);
            const analysis = analyzeBinaryData(binaryData, targetSize, targetSize);
            
            if (logAnalysis) {
                console.log('🔍 BINARY IMAGE ANALYSIS:');
                console.log(`📊 Image: ${targetSize}x${targetSize} pixels`);
                console.log(`📦 Original size: ${imageBuffer.byteLength} bytes`);
                console.log(`🗜️  Binary size: ${analysis.totalBytes} bytes`);
                console.log(`📉 Compression: ${analysis.compressionPercent}% reduction (${analysis.compressionRatio}x)`);
                console.log(`⚫ White pixels: ${analysis.whitePercent}% (${analysis.setBits}/${analysis.totalPixels})`);
            }
            
            // Return binary data with metadata
            const base64Binary = Buffer.from(binaryData).toString('base64');
            
            res.json({
                success: true,
                format: 'binary',
                data: base64Binary,
                metadata: {
                    width: targetSize,
                    height: targetSize,
                    originalSize: imageBuffer.byteLength,
                    binarySize: analysis.totalBytes,
                    compressionRatio: analysis.compressionRatio,
                    compressionPercent: analysis.compressionPercent,
                    whitePixelPercent: analysis.whitePercent
                }
            });
        } else {
            // Return original or processed image
            const buffer = canvas.toBuffer('image/png');
            res.set('Content-Type', 'image/png');
            res.send(buffer);
        }
        
    } catch (error) {
        console.error('❌ Error processing image:', error);
        res.status(500).json({ 
            error: 'Failed to process image', 
            details: error.message 
        });
    }
});

// ========================================
// NEW CACHE STRATEGY FUNCTIONS
// ========================================

/**
 * Helper function to get Genius API key with fallback
 * @returns {string} The Genius API key
 */
async function getGeniusApiKey() {
    let geniusApiKey = geniusApiKeyParam.value();
    
    if (!geniusApiKey) {
        try {
            const localConfigPath = path.join(__dirname, 'local-config.json');
            const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
            geniusApiKey = localConfig.genius.key;
        } catch (error) {
            console.error('Error loading local config:', error);
            throw new Error('API key not found. Please configure your API key.');
        }
    }
    
    return geniusApiKey;
}

/**
 * Helper function to check if artist songs need refresh (older than 1 week)
 * @param {Date} songsLastUpdated - Last update timestamp
 * @returns {boolean} Whether refresh is needed
 */
function needsRefresh(songsLastUpdated, isFullyCached) {
    // If we know the artist is NOT fully cached, always continue fetching pages
    if (isFullyCached === false) return true;

    if (!songsLastUpdated) return true;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return new Date(songsLastUpdated) < oneWeekAgo;
}

/**
 * Extract artist image URL from songs data
 * Searches through songs to find a matching artist ID and returns their image_url
 * @param {Object[]} songs - Array of song objects from Genius API
 * @param {number} targetArtistId - The artist ID to search for
 * @param {number} maxSongsToCheck - Maximum number of songs to check (default: 11)
 * @returns {string|null} Artist image URL or null if not found
 */
function extractArtistImageUrl(songs, targetArtistId, maxSongsToCheck = 11) {
    console.log(`Searching for image URL for artist ID ${targetArtistId} in ${Math.min(songs.length, maxSongsToCheck)} songs`);
    
    const songsToCheck = songs.slice(0, maxSongsToCheck);
    // Ensure targetArtistId is a number for comparison with API response
    const targetId = typeof targetArtistId === 'string' ? parseInt(targetArtistId, 10) : targetArtistId;
    
    for (const song of songsToCheck) {
        // Check primary artist first
        if (song.primary_artist && song.primary_artist.id === targetId) {
            const imageUrl = song.primary_artist.image_url;
            if (imageUrl) {
                console.log(`Found artist image URL in primary artist: ${imageUrl}`);
                return imageUrl;
            }
        }
        
        // Check featured artists if primary artist doesn't match
        if (song.featured_artists && Array.isArray(song.featured_artists)) {
            for (const featuredArtist of song.featured_artists) {
                if (featuredArtist.id === targetId) {
                    const imageUrl = featuredArtist.image_url;
                    if (imageUrl) {
                        console.log(`Found artist image URL in featured artists: ${imageUrl}`);
                        return imageUrl;
                    }
                }
            }
        }
    }
    
    console.log(`No image URL found for artist ID ${targetId} in ${songsToCheck.length} songs`);
    return null;
}

/**
 * Fetch song metadata from Genius API for a specific artist page
 * @param {number} artistId - Genius artist ID
 * @param {number} page - Page number (1-based)
 * @returns {Object} { songs: Song[], hasMore: boolean, totalSongs: number }
 */
async function getSongsByArtist(artistId, page = 1) {
    console.log(`Fetching songs for artist ${artistId}, page ${page}`);
    
    try {
        const geniusApiKey = await getGeniusApiKey();
        const headers = { "Authorization": `Bearer ${geniusApiKey}` };
        
        // Fetch 50 songs per page, sorted by popularity
        const response = await fetchWithTimeout(
            `https://api.genius.com/artists/${artistId}/songs?per_page=50&page=${page}&sort=popularity`,
            { headers }
        );
        
        if (!response.ok) {
            throw new Error(`Genius API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.response || !data.response.songs) {
            throw new Error('Invalid API response structure');
        }
        
        const songs = data.response.songs;
        console.log(`Fetched ${songs.length} songs for artist ${artistId}, page ${page}`);
        
        // Transform songs to our schema format
        const transformedSongs = songs.map(song => ({
            id: song.id.toString(), // Use as Firestore document ID
            title: song.title,
            url: song.url,
            songArtImageUrl: song.song_art_image_url,
            artistNames: song.artist_names,
            primaryArtist: {
                id: song.primary_artist.id,
                name: song.primary_artist.name,
                url: song.primary_artist.url
            },
            // Lyrics fields - initially null
            lyrics: null,
            lyricsScrapedAt: null,
            scrapingAttempts: 0,
            scrapingError: null,
            // Metadata
            addedAt: new Date(),
            scrapingStatus: 'pending'
        }));
        
        const hasMore = songs.length === 50; // If we got a full page, there might be more
        
        return {
            songs: transformedSongs,
            rawSongs: songs, // Include raw API response for image URL extraction
            hasMore,
            totalSongs: songs.length, // This is just for current page, will be updated later
            pageNumber: page
        };
        
    } catch (error) {
        console.error(`Error fetching songs for artist ${artistId}, page ${page}:`, error);
        throw error;
    }
}

/**
 * Extract the hash/ID from a Genius image URL for album art deduplication
 * Example: https://images.genius.com/bda1518357007cbd7ab978c4a6764e26.711x711x1.jpg
 * Returns: bda1518357007cbd7ab978c4a6764e26
 */
function extractGeniusImageHash(imageUrl) {
    try {
        if (!imageUrl) return null;
        
        // Extract the filename from the URL
        const filename = imageUrl.split('/').pop();
        
        // Extract the hash (everything before the first dot)
        const hash = filename.split('.')[0];
        
        // Validate it looks like a hash (32 character hex string)
        if (hash && /^[a-f0-9]{32}$/i.test(hash)) {
            return hash.toLowerCase();
        }
        
        // Fallback: use the full filename if it doesn't match expected pattern
        console.warn(`Unexpected Genius URL format: ${imageUrl}, using filename as ID`);
        return filename.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        
    } catch (error) {
        console.error('Error extracting hash from Genius URL:', error);
        return null;
    }
}

/**
 * Store song documents in Firestore songs collection
 * @param {Object[]} songs - Array of song objects
 * @returns {Promise<string[]>} Array of song IDs that were stored
 */
async function storeSongsInFirestore(songs) {
    console.log(`Storing ${songs.length} songs in Firestore`);
    
    try {
        const batch = db.batch();
        const songsCollection = db.collection('songs');
        const storedSongIds = [];
        
        for (const song of songs) {
            const songRef = songsCollection.doc(song.id);
            
            // Check if song already exists to avoid overwriting existing data
            const existingDoc = await songRef.get();
            
            if (!existingDoc.exists) {
                // Extract album art ID for future processing (but don't process yet)
                let albumArtId = null;
                if (song.songArtImageUrl) {
                    albumArtId = extractGeniusImageHash(song.songArtImageUrl);
                }
                
                // Remove the id from the document data since it's used as the document ID
                const { id, ...songData } = song;
                
                // Add album art ID to song data for later processing during lyric scraping
                songData.albumArtId = albumArtId;
                
                batch.set(songRef, songData);
                storedSongIds.push(song.id);
                console.log(`Queued song ${song.id} for storage: ${song.title}${albumArtId ? ` (album art ID: ${albumArtId})` : ''}`);
            } else {
                console.log(`Song ${song.id} already exists, skipping: ${song.title}`);
                storedSongIds.push(song.id); // Still include in list since it's available
            }
        }
        
        if (storedSongIds.length > 0) {
            await batch.commit();
            console.log(`Successfully stored ${storedSongIds.length} songs in Firestore`);
        } else {
            console.log('No new songs to store');
        }
        
        return storedSongIds;
        
    } catch (error) {
        console.error('Error storing songs in Firestore:', error);
        throw error;
    }
}

/**
 * Check if album art exists, process if not
 * @param {string} imageUrl - Original album art URL
 * @param {string} albumArtId - Extracted hash ID
 * @returns {Promise<boolean>} True if processed/exists, false if failed
 */
async function checkAndProcessAlbumArt(imageUrl, albumArtId) {
    try {
        // Check if album art already exists
        const albumArtRef = db.collection('albumArt').doc(albumArtId);
        const albumArtDoc = await albumArtRef.get();
        
        if (albumArtDoc.exists) {
            // Already processed
            return true;
        }
        
        // Process and store the album art
        console.log(`🎨 Processing new album art: ${albumArtId}`);
        await processAndStoreAlbumArt(imageUrl, albumArtId, 800);
        console.log(`✅ Successfully processed album art: ${albumArtId}`);
        return true;
        
    } catch (error) {
        console.error(`❌ Error processing album art ${albumArtId}:`, error);
        return false;
    }
}

/**
 * Update artist document with new song IDs and metadata
 * @param {string} artistUrlKey - Artist document ID (URL slug)
 * @param {string[]} newSongIds - Array of new song IDs to add
 * @param {Object} metadata - Additional metadata to update
 */
async function updateArtistSongList(artistUrlKey, newSongIds, metadata) {
    console.log(`Updating artist ${artistUrlKey} with ${newSongIds.length} new songs`);
    
    try {
        const artistRef = db.collection('artists').doc(artistUrlKey);
        
        // First, get the current artist document to check existing songIds
        const artistDoc = await artistRef.get();
        if (!artistDoc.exists) {
            throw new Error(`Artist document not found: ${artistUrlKey}`);
        }
        
        const artistData = artistDoc.data();
        const existingSongIds = artistData.songIds || [];
        
        // Filter out song IDs that are already in the artist's list
        const trulyNewSongIds = newSongIds.filter(id => !existingSongIds.includes(id));
        
        if (trulyNewSongIds.length === 0) {
            console.log('No new song IDs to add to artist document');
            return;
        }
        
        const updateData = {
            songIds: FieldValue.arrayUnion(...trulyNewSongIds),
            songsFetched: metadata.songsFetched,
            totalSongs: metadata.totalSongs,
            songsLastUpdated: new Date(),
            isFullyCached: metadata.isFullyCached || false,
            cacheVersion: 1
        };   
        
        await updateDoc(artistRef, updateData);
        console.log(`Successfully updated artist ${artistUrlKey} with ${trulyNewSongIds.length} new song IDs`);
        
    } catch (error) {
        console.error(`Error updating artist song list for ${artistUrlKey}:`, error);
        throw error;
    }
}

/**
 * Core logic for populating artist songs (without Firebase Functions wrapper)
 * @param {string} artistUrlKey - Artist document ID
 * @returns {Promise<Object>} Result object
 */
async function populateArtistSongsCore(artistUrlKey, { onlyFirstPage = false } = {}) {
    console.log(`Starting song population for artist: ${artistUrlKey}`);
    
    // Get artist document from Firestore
    const artistDoc = await db.collection('artists').doc(artistUrlKey).get();
    if (!artistDoc.exists) {
        throw new Error('Artist not found');
    }
    
    const artistData = artistDoc.data();
    console.log(`Found artist: ${artistData.name} (Genius ID: ${artistData.geniusId})`);
    
    const artistId = artistData.geniusId;
    if (!artistId) {
        throw new Error('Artist does not have a Genius ID');
    }
    
    // Check if refresh is needed
    if (!needsRefresh(artistData.songsLastUpdated, artistData.isFullyCached)) {
        console.log('Artist songs are up to date, no refresh needed');
        
        // Even if songs are up to date, check if we need to extract image URL
        // Only attempt if imageUrl is undefined (never attempted), not null (already attempted)
        if (artistData.imageUrl === undefined && artistData.songIds && artistData.songIds.length > 0) {
            console.log('Songs up to date but missing image URL - attempting extraction from existing songs...');
            
            try {
                // Try to extract image URL from first few existing songs
                const firstSongIds = artistData.songIds.slice(0, 5); // Check first 5 songs
                let foundImageUrl = null;
                
                for (const songId of firstSongIds) {
                    const songDoc = await db.collection('songs').doc(songId).get();
                    if (songDoc.exists) {
                        const songData = songDoc.data();
                        if (songData.primaryArtist && songData.primaryArtist.id === artistId) {
                            // This is a bit tricky since we don't have the full API response here
                            // We need to make a small API call to get the artist image
                            console.log('Found matching song, need to fetch from API for image URL...');
                            
                            // Make a quick API call to get the artist details
                            const geniusApiKey = await getGeniusApiKey();
                            const headers = { "Authorization": `Bearer ${geniusApiKey}` };
                            
                            const artistResponse = await fetchWithTimeout(
                                `https://api.genius.com/artists/${artistId}`,
                                { headers }
                            );
                            
                            if (artistResponse.ok) {
                                const artistApiData = await artistResponse.json();
                                if (artistApiData.response && artistApiData.response.artist) {
                                    foundImageUrl = artistApiData.response.artist.image_url;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // If no image URL found through songs, try direct artist API call as fallback
                if (!foundImageUrl) {
                    console.log('No matching songs found, trying direct artist API call...');
                    try {
                        const geniusApiKey = await getGeniusApiKey();
                        const headers = { "Authorization": `Bearer ${geniusApiKey}` };
                        
                        const artistResponse = await fetchWithTimeout(
                            `https://api.genius.com/artists/${artistId}`,
                            { headers }
                        );
                        
                        if (artistResponse.ok) {
                            const artistApiData = await artistResponse.json();
                            if (artistApiData.response && artistApiData.response.artist) {
                                foundImageUrl = artistApiData.response.artist.image_url;
                                console.log(`Found image URL via direct artist API call: ${foundImageUrl}`);
                            }
                        }
                    } catch (directApiError) {
                        console.error('Error in direct artist API call:', directApiError);
                    }
                }
                
                // Process and store image if found, otherwise store null
                if (foundImageUrl) {
                    try {
                        console.log(`🖼️  Found artist image via API, processing to binary format...`);
                        await processAndStoreArtistImage(foundImageUrl, artistUrlKey, 200);
                        console.log(`✅ Successfully processed and stored artist image binary data`);
                    } catch (imageUpdateError) {
                        console.error('Error processing/storing artist image:', imageUpdateError);
                        // Fallback: store just the URL if binary processing fails
                        await db.collection('artists').doc(artistUrlKey).update( {
                            imageUrl: foundImageUrl
                        });
                        console.log(`⚠️  Stored URL only due to processing error: ${foundImageUrl}`);
                    }
                } else {
                    await db.collection('artists').doc(artistUrlKey).update( {
                        imageUrl: null
                    });
                    console.log('No image URL found, stored null');
                }
                    
            } catch (imageError) {
                console.error('Error extracting image URL for up-to-date artist:', imageError);
                // Don't fail the entire operation if image extraction fails
            }
        }
        
        return { 
            success: true, 
            message: 'Songs already up to date',
            totalSongs: (artistData.songIds || []).length,
            isUpToDate: true
        };
    }
    
    let page = 1;
    let allSongIds = [...(artistData.songIds || [])];
    let totalFetched = 0;
    const maxSongs = 1000;
    let artistImageUrlExtracted = false; // Track if we've already extracted the image URL
    
    console.log(`Starting with ${allSongIds.length} existing songs`);
    
    // Fetch songs page by page
    while (totalFetched < maxSongs) {
        console.log(`Fetching page ${page}...`);
        
        const result = await getSongsByArtist(artistId, page);
        
        if (result.songs.length === 0) {
            console.log('No more songs available');
            break;
        }
        
        // Extract and store artist image URL (only once, from first few songs)
        if (!artistImageUrlExtracted && artistData.imageUrl === undefined) {
            console.log('Attempting to extract artist image URL from songs data...');
            
            // Calculate how many songs we should check based on which page we're on
            // We want to check up to 11 songs total across pages
            const songsCheckedSoFar = (page - 1) * 50;
            const maxSongsToCheckThisPage = Math.max(0, 11 - songsCheckedSoFar);
            
            if (maxSongsToCheckThisPage > 0) {
                // Use raw songs data from API response for image URL extraction
                const artistImageUrl = extractArtistImageUrl(result.rawSongs, artistId, maxSongsToCheckThisPage);
                
                if (artistImageUrl) {
                    try {
                        // Process image to binary format and store immediately
                        console.log(`🖼️  Found artist image, processing to binary format...`);
                        await processAndStoreArtistImage(artistImageUrl, artistUrlKey, 200);
                        console.log(`✅ Successfully processed and stored artist image binary data`);
                        artistImageUrlExtracted = true;
                    } catch (imageUpdateError) {
                        console.error('Error processing/storing artist image:', imageUpdateError);
                        // Fallback: store just the URL if binary processing fails
                        try {
                            await db.collection('artists').doc(artistUrlKey).update( {
                                imageUrl: artistImageUrl
                            });
                            console.log(`⚠️  Stored URL only due to processing error: ${artistImageUrl}`);
                            artistImageUrlExtracted = true;
                        } catch (urlFallbackError) {
                            console.error('Error storing artist image URL fallback:', urlFallbackError);
                        }
                        // Don't fail the entire operation if image update fails
                    }
                }
            }
            
            // If we've checked 11 songs total and still haven't found an image URL, store null
            const totalSongsChecked = Math.min(songsCheckedSoFar + result.songs.length, 11);
            if (totalSongsChecked >= 11 && !artistImageUrlExtracted) {
                try {
                    await db.collection('artists').doc(artistUrlKey).update( {
                        imageUrl: null
                    });
                    console.log('No artist image URL found after checking 11 songs, stored null');
                } catch (imageUpdateError) {
                    console.error('Error updating artist image URL to null:', imageUpdateError);
                }
                artistImageUrlExtracted = true;
            }
        }
        
        // Store songs in Firestore
        const storedSongIds = await storeSongsInFirestore(result.songs);
        
        // Add new song IDs to our list (filter out duplicates)
        const newSongIds = storedSongIds.filter(id => !allSongIds.includes(id));
        allSongIds.push(...newSongIds);
        
        totalFetched += result.songs.length;
        
        // Update artist document with progress
        await updateArtistSongList(artistUrlKey, storedSongIds, {
            songsFetched: allSongIds.length,
            totalSongs: allSongIds.length,
            isFullyCached: !result.hasMore
        });
        
        console.log(`Page ${page} complete: ${newSongIds.length} new songs, ${allSongIds.length} total`);

        if (page === 1) {
            console.log(`✅ First 50 songs cached for ${artistUrlKey}. Triggering queue build on client...`);
        }
        
        // Early exit after first page if requested
        if (onlyFirstPage) {
            console.log(`⏹️ Early return after first page for ${artistUrlKey}`);
            break;
        }

        // Break if no more pages
        if (!result.hasMore) {
            console.log('Reached end of songs for artist');
            break;
        }
        
        page++;
        
        // Small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`Completed song population for ${artistUrlKey}: ${allSongIds.length} total songs`);
    
    return {
        success: true,
        totalSongs: allSongIds.length,
        newSongs: totalFetched,
        isFullyCached: totalFetched < maxSongs,
        pagesProcessed: page - 1
    };
}

/**
 * Orchestrates fetching all songs for an artist (up to 1000 songs)
 * Called when client finds empty songIds array or when refresh is needed
 */
export const populateArtistSongs = onCall({
    timeoutSeconds: 300, // 5 minutes for large artists
    minInstances: 0,
    maxInstances: 10,
    region: 'us-central1'
}, async (request, context) => {
    const { artistUrlKey, onlyFirstPage = false } = request.data;
    
    if (!artistUrlKey) {
        throw new HttpsError('invalid-argument', 'Artist URL key is required');
    }
    
    try {
        return await populateArtistSongsCore(artistUrlKey, { onlyFirstPage });
    } catch (error) {
        console.error(`Error populating songs for artist ${artistUrlKey}:`, error);
        throw new HttpsError('internal', `Failed to populate artist songs: ${error.message}`);
    }
});

/**
 * Core logic for scraping song lyrics (without Firebase Functions wrapper)
 * @param {string[]} songIds - Array of song IDs to scrape
 * @param {string} artistUrlKey - Artist document ID
 * @returns {Promise<Object>} Result object
 */
async function scrapeSongLyricsCore(songIds, artistUrlKey) {
    console.log(`Starting lyrics scraping for ${songIds.length} songs`);
    
    const results = {
        successful: [],
        failed: [],
        skipped: []
    };
    
    for (const songId of songIds) {
        try {
            console.log(`Scraping lyrics for song ${songId}`);
            
            // Get song document from Firestore
            const songDoc = await db.collection('songs').doc(songId).get();
            if (!songDoc.exists) {
                results.failed.push({ songId, error: 'Song not found' });
                continue;
            }
            
            const songData = songDoc.data();
            
            // Skip if already has lyrics or failed permanently
            if (songData.lyrics || songData.scrapingStatus === 'failed') {
                console.log(`Skipping song ${songId}: already processed`);
                results.skipped.push(songId);
                continue;
            }
            
            // Check retry limit
            if (songData.scrapingAttempts >= 2) {
                console.log(`Skipping song ${songId}: max retries exceeded`);
                results.failed.push({ songId, error: 'Max retries exceeded' });
                continue;
            }
            
            // Update status to 'scraping'
            await db.collection('songs').doc(songId).update( { 
                scrapingStatus: 'scraping',
                scrapingAttempts: (songData.scrapingAttempts || 0) + 1
            });
            
            // Use existing lyrics scraping logic
            const lyrics = await scrapeLyricsFromUrl(songData.url);
            
            if (lyrics && lyrics.trim().length > 0) {
                // Process album art now that we know this song will be used
                if (songData.albumArtId && songData.songArtImageUrl) {
                    try {
                        console.log(`🎨 Processing album art for scraped song: ${songData.albumArtId}`);
                        await checkAndProcessAlbumArt(songData.songArtImageUrl, songData.albumArtId);
                        console.log(`✅ Album art processed for song ${songId}`);
                    } catch (albumArtError) {
                        console.warn(`⚠️  Album art processing failed for song ${songId}: ${albumArtError.message}`);
                        // Don't fail lyric scraping if album art processing fails
                    }
                }
                
                // Update song document with lyrics
                await db.collection('songs').doc(songId).update( {
                    lyrics: lyrics,
                    lyricsScrapedAt: new Date(),
                    scrapingStatus: 'completed',
                    scrapingError: null
                });
                
                results.successful.push(songId);
                console.log(`Successfully scraped lyrics for song ${songId}: ${songData.title}`);
                
                // Update artist cachedSongIds immediately for real-time access
                await db.collection('artists').doc(artistUrlKey).update( {
                    cachedSongIds: FieldValue.arrayUnion(songId),
                    lyricsScraped: FieldValue.increment(1)
                });
            } else {
                throw new Error('No lyrics found or empty lyrics');
            }
            
        } catch (error) {
            console.error(`Error scraping song ${songId}:`, error);
            
            // Update song document with error
            await db.collection('songs').doc(songId).update( {
                scrapingStatus: 'failed',
                scrapingError: error.message
            });
            
            results.failed.push({ songId, error: error.message });
        }
        
        // Small delay between songs
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Artist cachedSongIds are now updated individually after each successful scrape
    
    console.log(`Lyrics scraping completed: ${results.successful.length} successful, ${results.failed.length} failed, ${results.skipped.length} skipped`);
    
    return {
        success: true,
        results: results,
        scrapedCount: results.successful.length
    };
}

/**
 * Scrape lyrics for specified songs using existing scraping logic
 * Batch operation for efficiency with retry logic
 */
export const scrapeSongLyrics = onCall({
    timeoutSeconds: 300, // 5 minutes for batch scraping
    minInstances: 0,
    maxInstances: 20,
    region: 'us-central1'
}, async (request, context) => {
    const { songIds, artistUrlKey } = request.data;
    
    if (!songIds || !Array.isArray(songIds) || songIds.length === 0) {
        throw new HttpsError('invalid-argument', 'Song IDs array is required');
    }
    
    if (!artistUrlKey) {
        throw new HttpsError('invalid-argument', 'Artist URL key is required');
    }
    
    try {
        return await scrapeSongLyricsCore(songIds, artistUrlKey);
    } catch (error) {
        console.error('Error in scrapeSongLyrics:', error);
        throw new HttpsError('internal', `Failed to scrape lyrics: ${error.message}`);
    }
});

// Note: This function scrapes the complete lyrics for each song

/**
 * Scrape only the actual lyrics from a Genius song URL
 * This function extracts ONLY the actual song lyrics, avoiding annotations,
 * descriptions, and other non-lyrical content from the start.
 * 
 * @param {string} songUrl - The Genius song URL
 * @returns {Promise<string>} The complete extracted lyrics
 */
async function scrapeLyricsFromUrl(songUrl) {
    try {
        console.log(`Attempting to scrape lyrics from: ${songUrl}`);
        
        // Validate URL format
        if (!songUrl || typeof songUrl !== 'string') {
            throw new Error(`Invalid song URL: ${songUrl}`);
        }
        
        if (!songUrl.includes('genius.com')) {
            throw new Error(`URL does not appear to be a Genius URL: ${songUrl}`);
        }
        
        // Fetch the song page with proper error handling
        const songPageResponse = await fetchWithTimeout(songUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });
        
        if (!songPageResponse.ok) {
            throw new Error(`HTTP ${songPageResponse.status}: ${songPageResponse.statusText} for URL: ${songUrl}`);
        }
        
        const songPageHtml = await songPageResponse.text();
        
        if (!songPageHtml || songPageHtml.length < 100) {
            throw new Error('Received empty or invalid HTML response');
        }

        // Parse the page with cheerio
        const $ = cheerio.load(songPageHtml);
        
        // Target ALL lyrics containers - Genius often splits lyrics across multiple divs
        const lyricsContainers = $('div[data-lyrics-container="true"]');
        
        if (lyricsContainers.length === 0) {
            throw new Error('No lyrics containers found');
        }

        console.log(`Found ${lyricsContainers.length} lyrics container(s)`);
        
        let allLyricsText = '';
        
        // Process each lyrics container
        lyricsContainers.each((index, container) => {
            const $container = $(container);
            
            // Remove elements that should be excluded from lyrics
            $container.find('[data-exclude-from-selection="true"]').remove();
            
            // Remove headers, footers, and annotation elements
            $container.find('.LyricsHeader__Container, .LyricsFooter__Container').remove();
            $container.find('a[href*="/annotations/"]').remove();
            
            // Get the raw text content, preserving line breaks
            let containerText = $container.html() || '';
            
            // Convert HTML to clean text
            containerText = containerText
                // Convert <br> tags to newlines
                .replace(/<br\s*\/?>/gi, '\n')
                // Remove all HTML tags completely (including <i>, section headers, etc.)
                .replace(/<[^>]*>/gi, '')
                // Decode HTML entities
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&nbsp;/g, ' ')
                // Clean up whitespace
                .split('\n')
                .map(line => line.trim())
                .filter(line => {
                    // Filter out section headers and empty lines
                    if (!line) return false;
                    if (line.match(/^\[.*\]$/)) return false; // Remove [Intro], [Verse], etc.
                    if (line.match(/^(Intro|Verse|Chorus|Bridge|Outro|Pre-Chorus|Post-Chorus|Hook|Refrain)(\s|\d|$)/i)) return false;
                    return true;
                })
                .join('\n');
            
            if (containerText.trim()) {
                if (allLyricsText) allLyricsText += '\n\n';
                allLyricsText += containerText.trim();
            }
        });
        
        // Final cleanup
        let lyrics = allLyricsText
            // Remove multiple consecutive newlines
            .replace(/\n{3,}/g, '\n\n')
            // Remove any remaining section markers that might have slipped through
            .replace(/^\[.*\]$/gm, '')
            // Clean up any remaining whitespace issues
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
            .trim();

        if (!lyrics || lyrics.length < 10) {
            throw new Error('Extracted lyrics are too short or empty');
        }

        console.log(`Successfully scraped ${lyrics.length} characters of clean lyrics`);
        return lyrics;

    } catch (error) {
        console.error(`Error scraping lyrics from ${songUrl}:`, error);
        // Include more context in the error for debugging
        throw new Error(`Failed to scrape lyrics from ${songUrl}: ${error.message}`);
    }
}

//TODO: Push songs to db when they are scraped instead of waiting for all songs to be scraped
/**
 * Core logic for loading songs around a specific position (without Firebase Functions wrapper)
 * @param {string} songId - The song ID to start from
 * @param {boolean} shouldReverse - Whether to load previous songs
 * @param {string} artistUrlKey - Artist document ID
 * @returns {Promise<Object>} Result object
 */
async function loadStartingFromIdCore(songId, shouldReverse = false, artistUrlKey, rangeSize = 10) {
    console.log(`Loading songs starting from ${songId} for artist ${artistUrlKey}, reverse: ${shouldReverse}, rangeSize: ${rangeSize}`);
    
    // Get artist document to find songIds array
    const artistDoc = await db.collection('artists').doc(artistUrlKey).get();
    if (!artistDoc.exists) {
        throw new Error('Artist not found');
    }
    
    const artistData = artistDoc.data();
    const songIds = artistData.songIds || [];
    const cachedSongIds = artistData.cachedSongIds || [];
    
    console.log(`Artist has ${songIds.length} total songs, ${cachedSongIds.length} cached`);
    
    // Find position of songId in the songIds array
    const currentPosition = songIds.indexOf(songId.toString());
    if (currentPosition === -1) {
        throw new Error('Song not found in artist song list');
    }
    
    console.log(`Found song at position ${currentPosition}`);
    
    // Determine target range (configurable number of songs in the specified direction)
    const windowSize = Math.max(1, Number(rangeSize) || 10);
    let startPos, endPos;
    if (shouldReverse) {
        // Load the current song and up to (windowSize-1) previous songs
        startPos = Math.max(0, currentPosition - (windowSize - 1));
        endPos = currentPosition + 1; // end is non-inclusive, so +1 to include current
    } else {
        // Load the current song and up to (windowSize-1) next songs
        startPos = currentPosition;
        endPos = Math.min(songIds.length, currentPosition + windowSize);
    }
    
    const targetSongIds = songIds.slice(startPos, endPos);
    
    // Filter out songs that already have lyrics cached
    const songsNeedingLyrics = targetSongIds.filter(id => !cachedSongIds.includes(id));
    
    console.log(`Found ${songsNeedingLyrics.length} songs needing lyrics out of ${targetSongIds.length} target songs`);
    
    // Scrape missing lyrics if any
    let scrapingResults = null;
    if (songsNeedingLyrics.length > 0) {
        try {
            console.log(`Attempting to scrape lyrics for ${songsNeedingLyrics.length} songs`);
            
            // Call core scraping function directly
            const scrapingResponse = await scrapeSongLyricsCore(songsNeedingLyrics, artistUrlKey);
            scrapingResults = scrapingResponse.results;
            
            console.log(`Scraping completed: ${scrapingResults.successful.length} successful, ${scrapingResults.failed.length} failed`);
            
        } catch (scrapingError) {
            console.error('Error during lyrics scraping:', scrapingError);
            // Don't fail the entire function if scraping fails
            // Just log the error and continue with what we have
            scrapingResults = {
                successful: [],
                failed: songsNeedingLyrics.map(id => ({ songId: id, error: scrapingError.message })),
                skipped: []
            };
        }
    } else {
        console.log('All target songs already have cached lyrics');
    }
    
    // Fetch and return the loaded songs
    const loadedSongs = {};
    let songsLoadedCount = 0;
    
    for (const songId of targetSongIds) {
        try {
            const songDoc = await db.collection('songs').doc(songId).get();
            if (songDoc.exists) {
                loadedSongs[songId] = { id: songId, ...songDoc.data() };
                songsLoadedCount++;
            } else {
                console.warn(`Song document not found for ID: ${songId}`);
            }
        } catch (songError) {
            console.error(`Error loading song ${songId}:`, songError);
            // Continue with other songs even if one fails
        }
    }
    
    console.log(`Successfully loaded ${songsLoadedCount} songs`);
    
    return {
        success: true,
        queuePosition: currentPosition,
        loadedSongs: loadedSongs,
        scrapingResults: scrapingResults,
        targetRange: { start: startPos, end: endPos },
        songsScraped: scrapingResults ? scrapingResults.successful.length : 0,
        songsLoaded: songsLoadedCount,
        totalTargetSongs: targetSongIds.length
    };
}

/**
 * Intelligently loads songs around a specific position in the queue
 * Handles forward/backward navigation efficiently
 */
export const loadStartingFromId = onCall({
    timeoutSeconds: 120,
    minInstances: 0,
    maxInstances: 20,
    region: 'us-central1'
}, async (request, context) => {
    const { songId, shouldReverse = false, artistUrlKey, rangeSize = 10 } = request.data;
    
    if (!songId || !artistUrlKey) {
        throw new HttpsError('invalid-argument', 'Song ID and artist URL key are required');
    }
    
    try {
        return await loadStartingFromIdCore(songId, shouldReverse, artistUrlKey, rangeSize);
    } catch (error) {
        console.error(`Error in loadStartingFromId for song ${songId}:`, error);
        
        // Provide more detailed error information
        if (error instanceof HttpsError) {
            throw error; // Re-throw HttpsError as-is
        } else {
            throw new HttpsError('internal', `Failed to load songs: ${error.message}`, {
                songId,
                artistUrlKey,
                shouldReverse,
                originalError: error.message
            });
        }
    }
});

// ========================================
// LEGACY FUNCTIONS (Keep for backward compatibility during transition)
// ========================================

/**
 * Legacy function - keep for backward compatibility
 * TODO: Gradually migrate clients to use new system
 */
export const initialArtistSearch = onCall({
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 100,
    region: 'us-central1'
}, async (request, context) => {
    // TODO: Implement legacy compatibility or redirect to new system
    console.log('Legacy initialArtistSearch called - consider migrating to new system');
    throw new HttpsError('unimplemented', 'This function is being migrated to the new caching system');
});

/**
 * Legacy function - keep for backward compatibility
 * TODO: Gradually migrate clients to use new system
 */
export const searchByArtistId = onCall({
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 100,
    region: 'us-central1'
}, async (request, context) => {
    // TODO: Implement legacy compatibility or redirect to new system
    console.log('Legacy searchByArtistId called - consider migrating to new system');
    throw new HttpsError('unimplemented', 'This function is being migrated to the new caching system');
});

// ========================================
// UTILITY FUNCTIONS FOR TESTING
// ========================================

/**
 * Test function to validate the new caching system
 */
export const testCacheSystem = onCall({
    timeoutSeconds: 120,
    region: 'us-central1'
}, async (request, context) => {
    const { artistUrlKey, testType = 'populate' } = request.data;
    
    if (!artistUrlKey) {
        throw new HttpsError('invalid-argument', 'Artist URL key is required for testing');
    }
    
    // Initialize results at the beginning to avoid reference errors
    const results = {
        testType: testType,
        artistUrlKey: artistUrlKey,
        timestamp: new Date(),
        steps: []
    };
    
    try {
        console.log(`Running cache system test for artist: ${artistUrlKey}`);
        
        // Test song population
        if (testType === 'full' || testType === 'populate') {
            console.log('Testing song population...');
            try {
                const populateResult = await populateArtistSongsCore(artistUrlKey);
                results.steps.push({
                    step: 'populate',
                    success: populateResult.success,
                    data: populateResult
                });
            } catch (error) {
                console.error('Error in populate step:', error);
                results.steps.push({
                    step: 'populate',
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Test lyrics scraping
        if (testType === 'full' || testType === 'scrape') {
            console.log('Testing lyrics scraping...');
            
            try {
                // Get first few song IDs from artist for testing
                const artistDoc = await db.collection('artists').doc(artistUrlKey).get();
                if (artistDoc.exists) {
                    const artistData = artistDoc.data();
                    const testSongIds = (artistData.songIds || []).slice(0, 2); // Test with first 2 songs
                    
                    if (testSongIds.length > 0) {
                        const scrapeResult = await scrapeSongLyricsCore(testSongIds, artistUrlKey);
                        results.steps.push({
                            step: 'scrape',
                            success: scrapeResult.success,
                            data: scrapeResult
                        });
                    } else {
                        results.steps.push({
                            step: 'scrape',
                            success: false,
                            error: 'No songs available for testing'
                        });
                    }
                } else {
                    results.steps.push({
                        step: 'scrape',
                        success: false,
                        error: 'Artist not found'
                    });
                }
            } catch (error) {
                console.error('Error in scrape step:', error);
                results.steps.push({
                    step: 'scrape',
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Test smart loading
        if (testType === 'full' || testType === 'load') {
            console.log('Testing smart loading...');
            
            try {
                const artistDoc = await db.collection('artists').doc(artistUrlKey).get();
                if (artistDoc.exists) {
                    const artistData = artistDoc.data();
                    const songIds = artistData.songIds || [];
                    
                    if (songIds.length > 5) {
                        const testSongId = songIds[2]; // Test with 3rd song
                        const loadResult = await loadStartingFromIdCore(testSongId, false, artistUrlKey);
                        results.steps.push({
                            step: 'load',
                            success: loadResult.success,
                            data: loadResult
                        });
                    } else {
                        results.steps.push({
                            step: 'load',
                            success: false,
                            error: 'Not enough songs for testing smart loading'
                        });
                    }
                } else {
                    results.steps.push({
                        step: 'load',
                        success: false,
                        error: 'Artist not found'
                    });
                }
            } catch (error) {
                console.error('Error in load step:', error);
                results.steps.push({
                    step: 'load',
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Determine overall success
        const allStepsSuccessful = results.steps.every(step => step.success);
        
        return {
            success: allStepsSuccessful,
            testResults: results,
            summary: {
                totalSteps: results.steps.length,
                successfulSteps: results.steps.filter(step => step.success).length,
                failedSteps: results.steps.filter(step => !step.success).length
            }
        };
        
    } catch (error) {
        console.error('Error in cache system test:', error);
        
        // Add the error as a failed step
        results.steps.push({
            step: 'error',
            success: false,
            error: error.message
        });
        
        return {
            success: false,
            error: error.message,
            testResults: results,
            summary: {
                totalSteps: results.steps.length,
                successfulSteps: results.steps.filter(step => step.success).length,
                failedSteps: results.steps.filter(step => !step.success).length
            }
        };
    }
});

/**
 * Helper function to get artist information for testing
 */
export const getArtistInfo = onCall({
    timeoutSeconds: 30,
    region: 'us-central1'
}, async (request, context) => {
    const { artistUrlKey } = request.data;
    
    if (!artistUrlKey) {
        throw new HttpsError('invalid-argument', 'Artist URL key is required');
    }
    
    try {
        const artistDoc = await db.collection('artists').doc(artistUrlKey).get();
        if (!artistDoc.exists) {
            throw new HttpsError('not-found', 'Artist not found');
        }
        
        const artistData = artistDoc.data();
        
        return {
            success: true,
            artist: {
                name: artistData.name,
                geniusId: artistData.geniusId,
                urlKey: artistUrlKey, // Add the URL key to the response
                totalSongs: (artistData.songIds || []).length,
                cachedSongs: (artistData.cachedSongIds || []).length,
                songIds: artistData.songIds || [], // Include songIds array
                lastUpdated: artistData.songsLastUpdated,
                isFullyCached: artistData.isFullyCached || false
            }
        };
        
    } catch (error) {
        console.error(`Error getting artist info for ${artistUrlKey}:`, error);
        throw new HttpsError('internal', `Failed to get artist info: ${error.message}`);
    }
});

/**
 * Diagnostic function to inspect song data and URLs
 */
export const diagnoseSongData = onCall({
    timeoutSeconds: 60,
    region: 'us-central1'
}, async (request, context) => {
    const { artistUrlKey, songId } = request.data;
    
    if (!artistUrlKey) {
        throw new HttpsError('invalid-argument', 'Artist URL key is required');
    }
    
    try {
        const results = {
            timestamp: new Date(),
            artistUrlKey: artistUrlKey,
            diagnostics: {}
        };
        
        // Get artist info
        const artistDoc = await db.collection('artists').doc(artistUrlKey).get();
        if (!artistDoc.exists) {
            throw new HttpsError('not-found', 'Artist not found');
        }
        
        const artistData = artistDoc.data();
        results.diagnostics.artist = {
            name: artistData.name,
            totalSongs: (artistData.songIds || []).length,
            cachedSongs: (artistData.cachedSongIds || []).length,
            firstFewSongIds: (artistData.songIds || []).slice(0, 5)
        };
        
        // If specific song ID provided, examine it
        if (songId) {
            const songDoc = await db.collection('songs').doc(songId).get();
            if (songDoc.exists) {
                const songData = songDoc.data();
                results.diagnostics.specificSong = {
                    id: songId,
                    title: songData.title,
                    url: songData.url,
                    urlValid: songData.url && songData.url.includes('genius.com'),
                    hasLyrics: !!songData.lyrics,
                    scrapingStatus: songData.scrapingStatus,
                    scrapingAttempts: songData.scrapingAttempts,
                    scrapingError: songData.scrapingError
                };
            } else {
                results.diagnostics.specificSong = {
                    id: songId,
                    exists: false
                };
            }
        } else {
            // Examine first few songs
            const songIds = (artistData.songIds || []).slice(0, 3);
            results.diagnostics.sampleSongs = [];
            
            for (const id of songIds) {
                const songDoc = await db.collection('songs').doc(id).get();
                if (songDoc.exists) {
                    const songData = songDoc.data();
                    results.diagnostics.sampleSongs.push({
                        id: id,
                        title: songData.title,
                        url: songData.url,
                        urlValid: songData.url && songData.url.includes('genius.com'),
                        hasLyrics: !!songData.lyrics,
                        scrapingStatus: songData.scrapingStatus
                    });
                } else {
                    results.diagnostics.sampleSongs.push({
                        id: id,
                        exists: false
                    });
                }
            }
        }
        
        return {
            success: true,
            diagnostics: results
        };
        
    } catch (error) {
        console.error(`Error in diagnoseSongData:`, error);
        throw new HttpsError('internal', `Failed to diagnose song data: ${error.message}`);
    }
});

/**
 * Test lyrics scraping for a specific song URL
 */
export const testLyricsScraping = onCall({
    timeoutSeconds: 60,
    region: 'us-central1'
}, async (request, context) => {
    const { songUrl, songId } = request.data;
    
    if (!songUrl && !songId) {
        throw new HttpsError('invalid-argument', 'Either songUrl or songId is required');
    }
    
    try {
        let testUrl = songUrl;
        
        // If songId provided, get URL from database
        if (songId && !songUrl) {
            const songDoc = await db.collection('songs').doc(songId).get();
            if (!songDoc.exists) {
                throw new HttpsError('not-found', 'Song not found');
            }
            testUrl = songDoc.data().url;
        }
        
        console.log(`Testing lyrics scraping for URL: ${testUrl}`);
        
        const startTime = Date.now();
        const lyrics = await scrapeLyricsFromUrl(testUrl);
        const duration = Date.now() - startTime;
        
        return {
            success: true,
            url: testUrl,
            lyrics: lyrics,
            lyricsLength: lyrics.length,
            lyricsLines: lyrics.split('\n').length,
            scrapingDuration: duration
        };
        
    } catch (error) {
        console.error(`Error testing lyrics scraping:`, error);
        return {
            success: false,
            url: songUrl || 'unknown',
            error: error.message,
            errorType: error.constructor.name
        };
    }
});
