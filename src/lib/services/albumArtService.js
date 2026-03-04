/**
 * Album Art Service - handles 8-bit grayscale album art data
 * Optimized for deduplication across songs from the same album
 */

import { db, functions } from './initFirebase.js';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import pako from 'pako';

// Shared in-memory cache for instant access across components
// This persists for the session, so images loaded in ResultsDisplay
// are instantly available in TrashDisplay
const memoryCache = new Map();

/**
 * Extract the hash/ID from a Genius image URL
 * Example: https://images.genius.com/bda1518357007cbd7ab978c4a6764e26.711x711x1.jpg
 * Returns: bda1518357007cbd7ab978c4a6764e26
 */
export function extractGeniusImageHash(imageUrl) {
    try {
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
        // Ultimate fallback: create a simple hash
        return btoa(imageUrl).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32).toLowerCase();
    }
}

/**
 * Decompress grayscale image data using Pako
 * @param {string} compressedBase64 - Base64 encoded compressed grayscale data
 * @returns {string} - Base64 encoded decompressed grayscale data
 */
function decompressGrayscaleData(compressedBase64) {
    try {
        // Decode from Base64
        const compressedData = Uint8Array.from(atob(compressedBase64), c => c.charCodeAt(0));
        
        // Decompress with Pako
        const decompressedData = pako.inflate(compressedData);
        
        // Re-encode to Base64 for compatibility with existing WebGL code
        // Process in chunks to avoid stack overflow with large arrays
        console.log(`🔧 Converting ${decompressedData.length} bytes to Base64 in chunks...`);
        let binaryString = '';
        const chunkSize = 8192; // Process 8KB at a time
        const totalChunks = Math.ceil(decompressedData.length / chunkSize);
        
        for (let i = 0; i < decompressedData.length; i += chunkSize) {
            const chunk = decompressedData.slice(i, i + chunkSize);
            binaryString += String.fromCharCode(...chunk);
            
            // Log progress for large files
            if (totalChunks > 10 && (i / chunkSize) % 20 === 0) {
                console.log(`🔧 Processed chunk ${Math.floor(i / chunkSize) + 1}/${totalChunks}`);
            }
        }
        
        console.log(`🔧 Converting binary string to Base64...`);
        const decompressedBase64 = btoa(binaryString);
        
        console.log(`🗜️  Pako decompressed album art: ${compressedData.length} → ${decompressedData.length} bytes`);
        
        return decompressedBase64;
    } catch (error) {
        console.error('❌ Error decompressing album art binary data:', error);
        throw error;
    }
}

/**
 * Get binary image data for album art
 * First checks if binary data exists in the albumArt collection
 * If not, triggers processing and returns the result
 * @param {string} songArtImageUrl - The album art URL from song data
 * @returns {Promise<{success: boolean, binaryData?: string, metadata?: object, cached?: boolean, error?: string}>}
 */
export async function getAlbumArtGrayscaleImage(songArtImageUrl) {
    try {
        // Check in-memory cache first (instant, shared across components)
        if (memoryCache.has(songArtImageUrl)) {
            console.log(`⚡ Album art found in memory cache: ${songArtImageUrl.substring(0, 50)}`);
            return memoryCache.get(songArtImageUrl);
        }
        
        console.log(`🔍 Looking for album art grayscale data: ${songArtImageUrl}`);
        
        // Extract the hash from the Genius URL to use as document ID
        const albumArtId = extractGeniusImageHash(songArtImageUrl);
        console.log(`📝 Using album art ID: ${albumArtId}`);
        
        // Check if we already have this album art processed
        const albumArtRef = doc(db, 'albumArt', albumArtId);
        const albumArtDoc = await getDoc(albumArtRef);
        
        if (albumArtDoc.exists()) {
            const albumArtData = albumArtDoc.data();
            
            // Check for corrupted/legacy data first (wrong format stored in grayscaleImageData field)
            if (albumArtData.grayscaleImageData && albumArtData.processingVersion !== '2.0-grayscale') {
                console.log(`🔄 Found corrupted/legacy data in grayscaleImageData field for ${albumArtId}, reprocessing...`);
                const result = await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
                if (result.success) memoryCache.set(songArtImageUrl, result);
                return result;
            }
            
            // Check if we have valid grayscale image data (new format)
            if (albumArtData.grayscaleImageData && albumArtData.imageWidth && albumArtData.imageHeight && albumArtData.processingVersion === '2.0-grayscale') {
                console.log(`✅ Found cached album art grayscale data for ${albumArtId} (${albumArtData.imageWidth}x${albumArtData.imageHeight})`);
                
                let grayscaleData = albumArtData.grayscaleImageData;
                if (albumArtData.compressionMethod === 'pako-deflate') {
                    console.log(`🗜️  Decompressing cached album art grayscale data (${albumArtData.compressionMethod})`);
                    try {
                        grayscaleData = decompressGrayscaleData(albumArtData.grayscaleImageData);
                    } catch (error) {
                        console.warn(`🔄 Failed to decompress cached album art data, reprocessing: ${error.message}`);
                        const result = await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
                        if (result.success) memoryCache.set(songArtImageUrl, result);
                        return result;
                    }
                }
                
                const result = {
                    success: true,
                    cached: true,
                    grayscaleData: grayscaleData,
                    metadata: {
                        albumArtId: albumArtId,
                        width: albumArtData.imageWidth,
                        height: albumArtData.imageHeight,
                        processingVersion: albumArtData.processingVersion,
                        compressionMethod: albumArtData.compressionMethod
                    }
                };
                
                // Store in memory cache for instant access next time
                memoryCache.set(songArtImageUrl, result);
                return result;
            }
            
            // Check for legacy binary data and suggest reprocessing
            if (albumArtData.binaryImageData && albumArtData.imageWidth && albumArtData.imageHeight) {
                console.log(`🔄 Found legacy binary data for ${albumArtId}, reprocessing to grayscale...`);
                const result = await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
                if (result.success) memoryCache.set(songArtImageUrl, result);
                return result;
            }
        }
        
        // If not found, trigger server-side processing
        console.log(`⏳ Album art not in cache, triggering server processing for ${albumArtId}`);
        const result = await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
        if (result.success) memoryCache.set(songArtImageUrl, result);
        return { ...result, cached: false };
        
    } catch (error) {
        console.error(`❌ Error getting album art for ${songArtImageUrl}:`, error);
        console.error(`🔍 Debug info:`, { albumArtId: extractGeniusImageHash(songArtImageUrl), imageUrl: songArtImageUrl });
        return {
            success: false,
            error: error.message,
            cached: false
        };
    }
}

/**
 * Process album art client-side when server fails (403 errors from Genius)
 * Uses canvas to convert image to grayscale
 */
async function processAlbumArtClientSide(imageUrl, albumArtId) {
    console.log(`🖥️ Processing album art client-side for ${albumArtId}...`);
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Try to load with CORS
        
        img.onload = () => {
            try {
                // Create canvas to process image
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Use original dimensions (capped at 500px for performance)
                const maxSize = 500;
                let width = img.width;
                let height = img.height;
                
                if (width > maxSize || height > maxSize) {
                    const scale = maxSize / Math.max(width, height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw image to canvas
                ctx.drawImage(img, 0, 0, width, height);
                
                // Get image data and convert to grayscale
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                const grayscaleBytes = new Uint8Array(width * height);
                
                for (let i = 0; i < data.length; i += 4) {
                    // Convert to grayscale using luminance formula
                    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                    grayscaleBytes[i / 4] = gray;
                }
                
                // Convert to base64
                let binaryString = '';
                const chunkSize = 8192;
                for (let i = 0; i < grayscaleBytes.length; i += chunkSize) {
                    const chunk = grayscaleBytes.slice(i, i + chunkSize);
                    binaryString += String.fromCharCode(...chunk);
                }
                const grayscaleData = btoa(binaryString);
                
                const processingTime = Date.now() - startTime;
                console.log(`✅ Client-side processing complete in ${processingTime}ms (${width}x${height})`);
                
                resolve({
                    success: true,
                    grayscaleData: grayscaleData,
                    metadata: {
                        albumArtId: albumArtId,
                        width: width,
                        height: height,
                        processingVersion: '2.0-grayscale-client',
                        compressionMethod: 'none'
                    },
                    cached: false,
                    clientProcessingTime: processingTime,
                    processedClientSide: true
                });
            } catch (canvasError) {
                console.error(`❌ Canvas processing failed:`, canvasError);
                reject(canvasError);
            }
        };
        
        img.onerror = (error) => {
            console.error(`❌ Failed to load image for client-side processing:`, imageUrl);
            reject(new Error('Failed to load image for client-side processing'));
        };
        
        img.src = imageUrl;
    });
}

/**
 * Process album art to binary format via Firebase Function
 * Falls back to client-side processing if server fails (403 errors)
 */
async function processAlbumArtToGrayscale(imageUrl, albumArtId) {
    try {
        console.log(`⚡ Processing album art to grayscale format...`);
        const startTime = Date.now();
        
        // Call our optimized Firebase Function (auto-detects environment)
        const functionUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://localhost:5001/lyrictype-cdf2c/us-central1/processAlbumArtBinary'
            : 'https://us-central1-lyrictype-cdf2c.cloudfunctions.net/processAlbumArtBinary';
            
        const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: imageUrl,
                albumArtId: albumArtId
                // No size limit - use native resolution for grayscale
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Firebase function error for album art ${albumArtId}:`, {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                imageUrl: imageUrl
            });
            
            // Check if it's a 403/500 error (server couldn't fetch the image)
            // Try client-side processing as fallback
            if (response.status === 500 && errorText.includes('403')) {
                console.log(`🔄 Server got 403 from Genius, trying client-side processing...`);
                return await processAlbumArtClientSide(imageUrl, albumArtId);
            }
            
            throw new Error(`Processing failed: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        const processingTime = Date.now() - startTime;
        
        console.log(`🚀 Album art processed in ${processingTime}ms (${result.metadata.totalCompressionRatio}% total compression)`);
        
        // Decompress the grayscale data since it's now Pako compressed
        let grayscaleData = result.grayscaleData;
        if (result.metadata.compressionMethod === 'pako-deflate') {
            console.log(`🗜️  Decompressing fresh album art (${result.metadata.compressionMethod})`);
            grayscaleData = decompressGrayscaleData(result.grayscaleData);
        }
        
        return {
            ...result,
            grayscaleData: grayscaleData,
            cached: false,
            clientProcessingTime: processingTime
        };
        
    } catch (error) {
        console.error(`❌ Error processing album art to grayscale for ${albumArtId}:`, error);
        console.error(`🔍 Failed image URL:`, imageUrl);
        
        // Last resort: try client-side processing
        console.log(`🔄 Server processing failed completely, trying client-side as last resort...`);
        try {
            return await processAlbumArtClientSide(imageUrl, albumArtId);
        } catch (clientError) {
            console.error(`❌ Client-side processing also failed:`, clientError);
            throw error; // Throw the original error
        }
    }
}

// Backward compatibility alias
export const getAlbumArtBinaryImage = getAlbumArtGrayscaleImage;
