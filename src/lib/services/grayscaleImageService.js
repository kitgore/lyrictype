/**
 * Grayscale Image Service - handles 8-bit grayscale image data
 * Replaces traditional CORS proxy + client-side dithering
 */

import { db, functions } from './initFirebase.js';
import { doc, getDoc } from 'firebase/firestore';
import pako from 'pako';

/**
 * Decompress grayscale image data using Pako
 * @param {string} compressedBase64 - Base64 encoded compressed grayscale data
 * @returns {string} - Base64 encoded decompressed grayscale data
 */
function decompressGrayscaleData(compressedBase64, returnRawBytes = false) {
    try {
        console.log(`🔍 Attempting to decompress ${compressedBase64.length} chars of Base64 data`);
        
        // Decode from Base64
        const compressedData = Uint8Array.from(atob(compressedBase64), c => c.charCodeAt(0));
        console.log(`📦 Decoded Base64 to ${compressedData.length} bytes`);
        
        // Decompress with Pako
        const decompressedData = pako.inflate(compressedData);
        console.log(`🗜️  Pako inflated to ${decompressedData.length} bytes`);
        
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
        
        console.log(`🗜️  Pako decompressed: ${compressedData.length} → ${decompressedData.length} bytes`);
        
        if (returnRawBytes) {
            // Return raw Uint8Array for WebGL
            return decompressedData;
        } else {
            // Return Base64 for backward compatibility
            console.log(`🔧 Converting binary string to Base64...`);
            const decompressedBase64 = btoa(binaryString);
            return decompressedBase64;
        }
    } catch (error) {
        console.error('❌ Error decompressing grayscale data:', error);
        throw error;
    }
}

/**
 * Get grayscale image data for an artist
 * First checks if grayscale data exists in the database
 * If not, triggers processing and returns the result
 */
export async function getArtistGrayscaleImage(artistUrlKey, imageUrl) {
    try {
        console.log(`🔍 Looking for grayscale image data for artist: ${artistUrlKey}`);
        
        // First, check if we already have grayscale data stored
        const artistRef = doc(db, 'artists', artistUrlKey);
        const artistDoc = await getDoc(artistRef);
        
        if (artistDoc.exists()) {
            const artistData = artistDoc.data();
            
            // Check for corrupted/legacy data first (wrong format stored in grayscaleImageData field)
            if (artistData.grayscaleImageData && artistData.processingVersion !== '2.0-grayscale') {
                console.log(`🔄 Found corrupted/legacy data in grayscaleImageData field for ${artistUrlKey}, reprocessing...`);
                if (artistData.imageUrl) {
                    return await processArtistImageToGrayscale(artistData.imageUrl, artistUrlKey);
                }
            }
            
            // Check if we have valid grayscale image data (new format)
            if (artistData.grayscaleImageData && artistData.imageWidth && artistData.imageHeight && artistData.processingVersion === '2.0-grayscale') {
                console.log(`✅ Found cached grayscale image data for ${artistUrlKey} (${artistData.imageWidth}x${artistData.imageHeight})`);
                
                let grayscaleData = artistData.grayscaleImageData;
                let rawGrayscaleBytes = null;
                
                if (artistData.compressionMethod === 'pako-deflate') {
                    console.log(`🗜️  Decompressing cached grayscale data (${artistData.compressionMethod})`);
                    try {
                        grayscaleData = decompressGrayscaleData(artistData.grayscaleImageData);
                        rawGrayscaleBytes = decompressGrayscaleData(artistData.grayscaleImageData, true); // Get raw bytes for WebGL
                    } catch (error) {
                        console.warn(`🔄 Failed to decompress cached data, reprocessing image: ${error.message}`);
                        if (artistData.imageUrl) {
                            return await processArtistImageToGrayscale(artistData.imageUrl, artistUrlKey);
                        }
                        throw error;
                    }
                }
                
                return {
                    success: true,
                    cached: true,
                    grayscaleData: grayscaleData,
                    rawGrayscaleBytes: rawGrayscaleBytes, // Raw bytes for WebGL
                    metadata: {
                        width: artistData.imageWidth,
                        height: artistData.imageHeight,
                        originalSize: artistData.originalSize,
                        grayscaleSize: artistData.grayscaleSize,
                        compressedSize: artistData.compressedSize,
                        compressionRatio: artistData.compressionRatio,
                        pakoCompressionRatio: artistData.pakoCompressionRatio,
                        totalCompressionRatio: artistData.totalCompressionRatio,
                        averageBrightness: artistData.averageBrightness,
                        darkPercent: artistData.darkPercent,
                        lightPercent: artistData.lightPercent,
                        processedAt: artistData.processedAt,
                        originalImageUrl: artistData.originalImageUrl,
                        processingVersion: artistData.processingVersion,
                        compressionMethod: artistData.compressionMethod
                    }
                };
            }
            
            // Check for legacy binary data and suggest reprocessing
            if (artistData.binaryImageData && artistData.imageWidth && artistData.imageHeight) {
                console.log(`🔄 Found legacy binary data for ${artistUrlKey}, reprocessing to grayscale...`);
                if (artistData.imageUrl) {
                    return await processArtistImageToGrayscale(artistData.imageUrl, artistUrlKey);
                }
            }
            
            // If we have an imageUrl but no grayscale data, process it
            if (artistData.imageUrl && !artistData.grayscaleImageData) {
                console.log(`🔄 Found image URL but no grayscale data, processing...`);
                return await processArtistImageToGrayscale(artistData.imageUrl, artistUrlKey);
            }
        }
        
        // If we have an imageUrl parameter but no stored data, process it
        if (imageUrl) {
            console.log(`🆕 Processing new image URL for artist: ${artistUrlKey}`);
            console.log(`🔗 Image URL: ${imageUrl}`);
            
            // For new artists, we need to be more aggressive about processing
            try {
                const result = await processArtistImageToGrayscale(imageUrl, artistUrlKey);
                if (result.success) {
                    console.log(`✅ Successfully processed new artist image: ${artistUrlKey}`);
                    return result;
                } else {
                    console.warn(`⚠️  Failed to process new artist image: ${artistUrlKey}`, result.error);
                }
            } catch (processingError) {
                console.error(`❌ Error processing new artist image: ${artistUrlKey}`, processingError);
            }
            
            // If processing failed, return failure so UI can fallback
            return {
                success: false,
                error: 'Failed to process new artist image',
                cached: false
            };
        }
        
        // No image data available
        console.log(`❌ No image data available for artist: ${artistUrlKey}`);
        return {
            success: false,
            error: 'No image data available',
            cached: false
        };
        
    } catch (error) {
        console.error('Error getting artist binary image:', error);
        return {
            success: false,
            error: error.message,
            cached: false
        };
    }
}

/**
 * Process an artist image to grayscale format via Firebase Function
 * This function is optimized for speed - client gets data ASAP
 */
async function processArtistImageToGrayscale(imageUrl, artistUrlKey) {
    try {
        console.log(`⚡ Processing image to grayscale format...`);
        const startTime = Date.now();
        
        // Call our optimized Firebase Function (auto-detects environment)
        const functionUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://localhost:5001/lyrictype-cdf2c/us-central1/processArtistImageBinary'
            : 'https://us-central1-lyrictype-cdf2c.cloudfunctions.net/processArtistImageBinary';
            
        const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: imageUrl,
                artistKey: artistUrlKey
                // No size parameter - using native resolution
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Firebase function error for ${artistUrlKey}:`, {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            });
            throw new Error(`Processing failed: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        const processingTime = Date.now() - startTime;
        
        console.log(`🚀 Grayscale image processed in ${processingTime}ms at ${result.metadata.width}x${result.metadata.height} (${result.metadata.totalCompressionPercent}% total compression)`);
        
        // Decompress the grayscale data since it's now Pako compressed
        let grayscaleData = result.grayscaleData;
        if (result.metadata.compressionMethod === 'pako-deflate') {
            console.log(`🗜️  Decompressing fresh grayscale data (${result.metadata.compressionMethod})`);
            grayscaleData = decompressGrayscaleData(result.grayscaleData);
        }
        
        return {
            ...result,
            grayscaleData: grayscaleData,
            cached: false,
            clientProcessingTime: processingTime
        };
        
    } catch (error) {
        console.error('Error processing artist image to grayscale:', error);
        throw error;
    }
}

/**
 * Convert grayscale data back to ImageData for WebGL rendering
 * This will be used by the WebGL renderer component
 * Note: This function is now mostly handled by the WebGL component itself
 */
export function grayscaleToImageData(grayscaleBase64, width, height) {
    try {
        // Decode base64 to binary data
        const binaryString = atob(binaryBase64);
        const binaryData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            binaryData[i] = binaryString.charCodeAt(i);
        }
        
        // Create RGBA image data from binary
        const imageData = new ImageData(width, height);
        const data = imageData.data;
        
        for (let i = 0; i < width * height; i++) {
            const byteIndex = Math.floor(i / 8);
            const bitPosition = 7 - (i % 8);
            const isLight = (binaryData[byteIndex] & (1 << bitPosition)) !== 0;
            
            const pixelIndex = i * 4;
            const value = isLight ? 255 : 0;
            
            data[pixelIndex] = value;     // R
            data[pixelIndex + 1] = value; // G  
            data[pixelIndex + 2] = value; // B
            data[pixelIndex + 3] = 255;   // A
        }
        
        return imageData;
        
    } catch (error) {
        console.error('Error converting binary to ImageData:', error);
        throw error;
    }
}

/**
 * Generate a data URL from binary image data with theme colors
 * Temporary solution until WebGL renderer is implemented
 */
export function binaryToDataUrl(binaryBase64, width, height, primaryColor = '#000000', secondaryColor = '#ffffff') {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        const imageData = binaryToImageData(binaryBase64, width, height);
        
        // Apply theme colors
        const data = imageData.data;
        const primary = hexToRgb(primaryColor);
        const secondary = hexToRgb(secondaryColor);
        
        for (let i = 0; i < data.length; i += 4) {
            const isLight = data[i] === 255;
            const color = isLight ? secondary : primary;
            
            data[i] = color[0];     // R
            data[i + 1] = color[1]; // G
            data[i + 2] = color[2]; // B
            // Alpha stays 255
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL();
        
    } catch (error) {
        console.error('Error converting binary to data URL:', error);
        throw error;
    }
}

/**
 * Helper function to convert hex color to RGB array
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : [0, 0, 0];
}

// Backward compatibility alias
export const getArtistBinaryImage = getArtistGrayscaleImage;
