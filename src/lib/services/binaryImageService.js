/**
 * Binary Image Service - handles binary dithered image data
 * Replaces traditional CORS proxy + client-side dithering
 */

import { db, functions } from './initFirebase.js';
import { doc, getDoc } from 'firebase/firestore';
import pako from 'pako';

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
        
        console.log(`🗜️  Pako decompressed: ${compressedData.length} → ${decompressedData.length} bytes`);
        
        return decompressedBase64;
    } catch (error) {
        console.error('❌ Error decompressing binary data:', error);
        throw error;
    }
}

/**
 * Get binary image data for an artist
 * First checks if binary data exists in the database
 * If not, triggers processing and returns the result
 */
export async function getArtistBinaryImage(artistUrlKey, imageUrl) {
    try {
        console.log(`🔍 Looking for binary image data for artist: ${artistUrlKey}`);
        
        // First, check if we already have binary data stored
        const artistRef = doc(db, 'artists', artistUrlKey);
        const artistDoc = await getDoc(artistRef);
        
        if (artistDoc.exists()) {
            const artistData = artistDoc.data();
            
            // Check if we have binary image data
            if (artistData.binaryImageData && artistData.imageWidth && artistData.imageHeight) {
                console.log(`✅ Found cached binary image data for ${artistUrlKey}`);
                
                // Check if this is compressed data (version 1.1-pako or has compression method)
                const isCompressed = artistData.processingVersion === '1.1-pako' || artistData.compressionMethod === 'pako-deflate';
                
                let binaryData = artistData.binaryImageData;
                if (isCompressed) {
                    console.log(`🗜️  Decompressing cached data (${artistData.compressionMethod})`);
                    binaryData = decompressBinaryData(artistData.binaryImageData);
                }
                
                return {
                    success: true,
                    cached: true,
                    binaryData: binaryData,
                    metadata: {
                        width: artistData.imageWidth,
                        height: artistData.imageHeight,
                        originalSize: artistData.originalSize,
                        binarySize: artistData.binarySize,
                        compressedSize: artistData.compressedSize,
                        compressionRatio: artistData.compressionRatio,
                        pakoCompressionRatio: artistData.pakoCompressionRatio,
                        totalCompressionRatio: artistData.totalCompressionRatio,
                        processedAt: artistData.processedAt,
                        originalImageUrl: artistData.originalImageUrl,
                        processingVersion: artistData.processingVersion,
                        compressionMethod: artistData.compressionMethod
                    }
                };
            }
            
            // If we have an imageUrl but no binary data, process it
            if (artistData.imageUrl && !artistData.binaryImageData) {
                console.log(`🔄 Found image URL but no binary data, processing...`);
                return await processArtistImageToBinary(artistData.imageUrl, artistUrlKey);
            }
        }
        
        // If we have an imageUrl parameter but no stored data, process it
        if (imageUrl) {
            console.log(`🆕 Processing new image URL: ${imageUrl}`);
            return await processArtistImageToBinary(imageUrl, artistUrlKey);
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
 * Process an artist image to binary format via Firebase Function
 * This function is optimized for speed - client gets data ASAP
 */
async function processArtistImageToBinary(imageUrl, artistUrlKey) {
    try {
        console.log(`⚡ Processing image to binary format...`);
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
                artistKey: artistUrlKey,
                size: 200
            })
        });
        
        if (!response.ok) {
            throw new Error(`Processing failed: ${response.status}`);
        }
        
        const result = await response.json();
        const processingTime = Date.now() - startTime;
        
        console.log(`🚀 Binary image processed in ${processingTime}ms (${result.metadata.totalCompressionPercent}% total compression)`);
        
        // Decompress the binary data since it's now Pako compressed
        let binaryData = result.binaryData;
        if (result.metadata.compressionMethod === 'pako-deflate') {
            console.log(`🗜️  Decompressing fresh data (${result.metadata.compressionMethod})`);
            binaryData = decompressBinaryData(result.binaryData);
        }
        
        return {
            ...result,
            binaryData: binaryData,
            cached: false,
            clientProcessingTime: processingTime
        };
        
    } catch (error) {
        console.error('Error processing artist image to binary:', error);
        throw error;
    }
}

/**
 * Convert binary data back to ImageData for WebGL rendering
 * This will be used by the WebGL renderer component
 */
export function binaryToImageData(binaryBase64, width, height) {
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
