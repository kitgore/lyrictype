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
function decompressGrayscaleData(compressedBase64) {
    try {
        // Decode from Base64
        const compressedData = Uint8Array.from(atob(compressedBase64), c => c.charCodeAt(0));
        
        console.log(`🔍 [DECOMPRESS DEBUG] Input base64 length: ${compressedBase64.length}`);
        console.log(`🔍 [DECOMPRESS DEBUG] Compressed data length: ${compressedData.length} bytes`);
        console.log(`🔍 [DECOMPRESS DEBUG] First 20 compressed bytes:`, Array.from(compressedData.slice(0, 20)));
        
        // Decompress with Pako
        const decompressedData = pako.inflate(compressedData);
        
        console.log(`🔍 [DECOMPRESS DEBUG] Decompressed data length: ${decompressedData.length} bytes`);
        console.log(`🔍 [DECOMPRESS DEBUG] First 50 decompressed values:`, Array.from(decompressedData.slice(0, 50)));
        console.log(`🔍 [DECOMPRESS DEBUG] Last 50 decompressed values:`, Array.from(decompressedData.slice(-50)));
        
        // Analyze the grayscale distribution
        let zeroCount = 0;
        let lowCount = 0;   // 1-63
        let midCount = 0;   // 64-191
        let highCount = 0;  // 192-254
        let maxCount = 0;   // 255
        let min = 255, max = 0, sum = 0;
        
        for (let i = 0; i < decompressedData.length; i++) {
            const val = decompressedData[i];
            sum += val;
            if (val < min) min = val;
            if (val > max) max = val;
            
            if (val === 0) zeroCount++;
            else if (val < 64) lowCount++;
            else if (val < 192) midCount++;
            else if (val < 255) highCount++;
            else maxCount++;
        }
        
        const avg = sum / decompressedData.length;
        const zeroPercent = ((zeroCount / decompressedData.length) * 100).toFixed(1);
        const lowPercent = ((lowCount / decompressedData.length) * 100).toFixed(1);
        const midPercent = ((midCount / decompressedData.length) * 100).toFixed(1);
        const highPercent = ((highCount / decompressedData.length) * 100).toFixed(1);
        const maxPercent = ((maxCount / decompressedData.length) * 100).toFixed(1);
        
        console.log(`📊 [DECOMPRESS DEBUG] Grayscale distribution analysis:`);
        console.log(`   Min: ${min}, Max: ${max}, Avg: ${avg.toFixed(1)}`);
        console.log(`   Zero (0): ${zeroCount} (${zeroPercent}%)`);
        console.log(`   Low (1-63): ${lowCount} (${lowPercent}%)`);
        console.log(`   Mid (64-191): ${midCount} (${midPercent}%)`);
        console.log(`   High (192-254): ${highCount} (${highPercent}%)`);
        console.log(`   Max (255): ${maxCount} (${maxPercent}%)`);
        
        // WARNING: If all or most values are 0, recoloring will appear as solid primary color!
        if (zeroPercent > 90) {
            console.error(`⚠️ [DECOMPRESS DEBUG] WARNING: ${zeroPercent}% of pixels are ZERO! Image will appear as solid PRIMARY color!`);
        }
        if (maxPercent > 90) {
            console.warn(`⚠️ [DECOMPRESS DEBUG] NOTE: ${maxPercent}% of pixels are MAX (255). Image will appear as solid SECONDARY color.`);
        }
        if (max === min) {
            console.error(`🚨 [DECOMPRESS DEBUG] CRITICAL: All pixels have the same value (${min})! No grayscale variation!`);
        }
        
        // Re-encode to Base64 for compatibility with existing WebGL code
        const decompressedBase64 = btoa(String.fromCharCode(...decompressedData));
        
        console.log(`🗜️  Pako decompressed: ${compressedData.length} → ${decompressedData.length} bytes`);
        
        return decompressedBase64;
    } catch (error) {
        console.error('❌ Error decompressing grayscale data:', error);
        console.error('❌ [DECOMPRESS DEBUG] Stack trace:', error.stack);
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
        console.log(`🔍 [binaryImageService] Looking for grayscale image data for artist: ${artistUrlKey}, imageUrl: ${imageUrl?.substring(0, 50)}...`);
        
        // First, check if we already have grayscale data stored
        const artistRef = doc(db, 'artists', artistUrlKey);
        const artistDoc = await getDoc(artistRef);
        
        if (artistDoc.exists()) {
            const artistData = artistDoc.data();
            
            // Check if we have grayscale image data (new format)
            if (artistData.grayscaleImageData && artistData.imageWidth && artistData.imageHeight) {
                console.log(`✅ [binaryImageService] Found cached grayscale image data for ${artistUrlKey} (${artistData.imageWidth}x${artistData.imageHeight})`);
                console.log(`🔗 [binaryImageService] Cached image URL: ${artistData.originalImageUrl?.substring(0, 50)}...`);
                
                // Check if this is compressed data 
                const isCompressed = artistData.processingVersion === '2.0-grayscale' || artistData.compressionMethod === 'pako-deflate';
                
                let grayscaleData = artistData.grayscaleImageData;
                if (isCompressed) {
                    console.log(`🗜️  Decompressing cached grayscale data (${artistData.compressionMethod})`);
                    grayscaleData = decompressGrayscaleData(artistData.grayscaleImageData);
                }
                
                const result = {
                    success: true,
                    cached: true,
                    grayscaleData: grayscaleData,
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
                
                console.log(`🎯 [binaryImageService] Returning cached result for ${artistUrlKey}`);
                return result;
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
            console.log(`🆕 Processing new image URL: ${imageUrl}`);
            return await processArtistImageToGrayscale(imageUrl, artistUrlKey);
        }
        
        // No image data available
        console.log(`❌ No image data available for artist: ${artistUrlKey}`);
        return {
            success: false,
            error: 'No image data available - imageUrl may be missing or invalid',
            cached: false
        };
        
    } catch (error) {
        console.error('Error getting artist binary image:', error);
        // Provide more detailed error message
        const errorMessage = error.message || 'Unknown error occurred';
        return {
            success: false,
            error: errorMessage,
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
        
        // Validate imageUrl before attempting to process
        if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
            throw new Error('Invalid imageUrl: URL is empty or invalid');
        }
        
        // Check if URL is valid format
        try {
            new URL(imageUrl);
        } catch (urlError) {
            throw new Error(`Invalid imageUrl format: ${imageUrl}`);
        }
        
        // Call our optimized Firebase Function (auto-detects environment)
        const functionUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://localhost:5001/lyrictype-cdf2c/us-central1/processArtistImageBinary'
            : 'https://us-central1-lyrictype-cdf2c.cloudfunctions.net/processArtistImageBinary';
            
        // Add timeout to fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        let response;
        try {
            response = await fetch(functionUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: imageUrl,
                    artistKey: artistUrlKey
                    // No size parameter - using native resolution
                }),
                signal: controller.signal
            });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error('Image processing timeout: Request took longer than 15 seconds');
            }
            throw new Error(`Network error: ${fetchError.message}`);
        } finally {
            clearTimeout(timeoutId);
        }
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Processing failed (${response.status}): ${errorText}`);
        }
        
        const result = await response.json();
        
        // Check if result indicates an error
        if (!result.success) {
            throw new Error(result.error || 'Image processing failed');
        }
        
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
        // Re-throw with more context
        throw new Error(`Failed to process image: ${error.message}`);
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
