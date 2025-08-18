/**
 * Album Art Service - handles binary dithered album art data
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
 * Decompress binary image data using Pako
 * @param {string} compressedBase64 - Base64 encoded compressed binary data
 * @returns {string} - Base64 encoded decompressed binary data
 */
function decompressBinaryData(compressedBase64) {
    try {
        // Decode from Base64
        const compressedData = Uint8Array.from(atob(compressedBase64), c => c.charCodeAt(0));
        
        // Decompress with Pako
        const decompressedData = pako.inflate(compressedData);
        
        // Re-encode to Base64 for compatibility with existing WebGL code
        const decompressedBase64 = btoa(String.fromCharCode(...decompressedData));
        
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
export async function getAlbumArtBinaryImage(songArtImageUrl) {
    try {
        console.log(`🔍 Looking for album art binary data: ${songArtImageUrl}`);
        
        // Extract the hash from the Genius URL to use as document ID
        const albumArtId = extractGeniusImageHash(songArtImageUrl);
        console.log(`📝 Using album art ID: ${albumArtId}`);
        
        // Check if we already have this album art processed
        const albumArtRef = doc(db, 'albumArt', albumArtId);
        const albumArtDoc = await getDoc(albumArtRef);
        
        if (albumArtDoc.exists()) {
            const albumArtData = albumArtDoc.data();
            console.log(`✅ Found cached album art binary data for ${albumArtId}`);
            
            // Check if this is compressed data (version 1.1-pako or has compression method)
            const isCompressed = albumArtData.processingVersion === '1.1-pako' || albumArtData.compressionMethod === 'pako-deflate';
            
            let binaryData = albumArtData.binaryImageData;
            if (isCompressed) {
                console.log(`🗜️  Decompressing cached album art (${albumArtData.compressionMethod})`);
                binaryData = decompressBinaryData(albumArtData.binaryImageData);
            }
            
            return {
                success: true,
                cached: true,
                binaryData: binaryData,
                metadata: {
                    albumArtId: albumArtId,
                    width: albumArtData.imageWidth,
                    height: albumArtData.imageHeight,
                    originalImageUrl: albumArtData.originalImageUrl,
                    processedAt: albumArtData.processedAt,
                    processingVersion: albumArtData.processingVersion,
                    compressionMethod: albumArtData.compressionMethod
                }
            };
        }
        
        // If not found, trigger server-side processing
        console.log(`⏳ Album art not in cache, triggering server processing for ${albumArtId}`);
        const result = await processAlbumArtToBinary(songArtImageUrl, albumArtId);
        return { ...result, cached: false };
        
    } catch (error) {
        console.error('Error getting album art binary image:', error);
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
async function processAlbumArtToBinary(imageUrl, albumArtId) {
    try {
        console.log(`⚡ Processing album art to binary format...`);
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
                albumArtId: albumArtId,
                size: 800 // High resolution for album art displayed on results screen
            })
        });
        
        if (!response.ok) {
            throw new Error(`Processing failed: ${response.status}`);
        }
        
        const result = await response.json();
        const processingTime = Date.now() - startTime;
        
        console.log(`🚀 Album art processed in ${processingTime}ms (${result.metadata.totalCompressionPercent}% total compression)`);
        
        // Decompress the binary data since it's now Pako compressed
        let binaryData = result.binaryData;
        if (result.metadata.compressionMethod === 'pako-deflate') {
            console.log(`🗜️  Decompressing fresh album art (${result.metadata.compressionMethod})`);
            binaryData = decompressBinaryData(result.binaryData);
        }
        
        return {
            ...result,
            binaryData: binaryData,
            cached: false,
            clientProcessingTime: processingTime
        };
        
    } catch (error) {
        console.error('Error processing album art to binary:', error);
        throw error;
    }
}
