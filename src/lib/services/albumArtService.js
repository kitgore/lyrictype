/**
 * Album Art Service - handles 8-bit grayscale album art data
 * Optimized for deduplication across songs from the same album
 */

import { db, functions } from './initFirebase.js';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import pako from 'pako';

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
                return await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
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
                        return await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
                    }
                }
                
                return {
                    success: true,
                    cached: true,
                    grayscaleData: grayscaleData,
                    metadata: {
                        albumArtId: albumArtId,
                        width: albumArtData.imageWidth,
                        height: albumArtData.imageHeight,
                        originalSize: albumArtData.originalSize,
                        grayscaleSize: albumArtData.grayscaleSize,
                        compressedSize: albumArtData.compressedSize,
                        compressionRatio: albumArtData.compressionRatio,
                        pakoCompressionRatio: albumArtData.pakoCompressionRatio,
                        totalCompressionRatio: albumArtData.totalCompressionRatio,
                        averageBrightness: albumArtData.averageBrightness,
                        darkPercent: albumArtData.darkPercent,
                        lightPercent: albumArtData.lightPercent,
                        originalImageUrl: albumArtData.originalImageUrl,
                        processedAt: albumArtData.processedAt,
                        processingVersion: albumArtData.processingVersion,
                        compressionMethod: albumArtData.compressionMethod
                    }
                };
            }
            
            // Check for legacy binary data and suggest reprocessing
            if (albumArtData.binaryImageData && albumArtData.imageWidth && albumArtData.imageHeight) {
                console.log(`🔄 Found legacy binary data for ${albumArtId}, reprocessing to grayscale...`);
                return await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
            }
        }
        
        // If not found, trigger server-side processing
        console.log(`⏳ Album art not in cache, triggering server processing for ${albumArtId}`);
        const result = await processAlbumArtToGrayscale(songArtImageUrl, albumArtId);
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
 * Process album art to binary format via Firebase Function
 * This function is optimized for speed - client gets data ASAP
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
        throw error;
    }
}

// Backward compatibility alias
export const getAlbumArtBinaryImage = getAlbumArtGrayscaleImage;
