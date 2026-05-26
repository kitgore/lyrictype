/**
 * Grayscale Image Service - handles 8-bit grayscale image data
 * Replaces traditional CORS proxy + client-side dithering
 */

import { db, functions } from './initFirebase.js';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import pako from 'pako';

// in-memory cache of in-flight server-processing promises, keyed by artist+url
// keeps concurrent callers from issuing duplicate function invocations
const processingCache = new Map();
const CACHE_TIMEOUT = 30000; // ms

// chunked Uint8Array → base64; chunked to avoid stack overflow on large buffers
function bytesToBase64(bytes) {
    let binaryString = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binaryString += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    return btoa(binaryString);
}

// pako-decompress base64 grayscale data → raw Uint8Array
function decompressGrayscaleData(compressedBase64) {
    const compressed = Uint8Array.from(atob(compressedBase64), c => c.charCodeAt(0));
    return pako.inflate(compressed);
}

/**
 * Get grayscale image data for an artist
 * First checks if grayscale data exists in the database
 * If not, triggers processing and returns the result
 */
export async function getArtistGrayscaleImage(artistUrlKey, imageUrl) {
    try {
        const artistRef = doc(db, 'artists', artistUrlKey);
        const artistDoc = await getDoc(artistRef);

        if (artistDoc.exists()) {
            const artistData = artistDoc.data();
            const sourceUrl = artistData.imageUrl || artistData.originalImageUrl;

            // legacy/corrupted: has grayscaleImageData but wrong processing version
            if (artistData.grayscaleImageData && artistData.processingVersion !== '2.0-grayscale') {
                if (sourceUrl) return await processArtistImageToGrayscale(sourceUrl, artistUrlKey);
            }

            // valid cached grayscale data
            if (artistData.grayscaleImageData && artistData.imageWidth && artistData.imageHeight && artistData.processingVersion === '2.0-grayscale') {
                const expectedSize = artistData.imageWidth * artistData.imageHeight;
                let grayscaleData = artistData.grayscaleImageData;
                let rawGrayscaleBytes = null;

                if (!grayscaleData || typeof grayscaleData !== 'string' || grayscaleData.length === 0) {
                    console.warn(`Invalid cached grayscale data for ${artistUrlKey}, reprocessing`);
                    if (sourceUrl) return await processArtistImageToGrayscale(sourceUrl, artistUrlKey);
                    return { success: false, error: 'Invalid cached grayscale data', cached: false };
                }

                try {
                    if (artistData.compressionMethod === 'pako-deflate') {
                        // fresh copy: pako may return a view into a larger buffer, which breaks WebGL
                        rawGrayscaleBytes = new Uint8Array(decompressGrayscaleData(grayscaleData));
                    } else {
                        const binaryString = atob(grayscaleData);
                        rawGrayscaleBytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            rawGrayscaleBytes[i] = binaryString.charCodeAt(i);
                        }
                    }

                    if (rawGrayscaleBytes.length !== expectedSize) {
                        console.warn(`Cached grayscale size mismatch for ${artistUrlKey} (expected ${expectedSize}, got ${rawGrayscaleBytes.length}), reprocessing`);
                        if (sourceUrl) return await processArtistImageToGrayscale(sourceUrl, artistUrlKey);
                        return { success: false, error: 'Cached data size mismatch', cached: false };
                    }

                    grayscaleData = bytesToBase64(rawGrayscaleBytes);
                } catch (error) {
                    console.warn(`Failed to decode cached grayscale data for ${artistUrlKey}, reprocessing:`, error.message);
                    if (sourceUrl) return await processArtistImageToGrayscale(sourceUrl, artistUrlKey);
                    return { success: false, error: `Failed to decode data: ${error.message}`, cached: false };
                }

                return {
                    success: true,
                    cached: true,
                    grayscaleData,
                    rawGrayscaleBytes,
                    metadata: {
                        width: artistData.imageWidth,
                        height: artistData.imageHeight,
                        processingVersion: artistData.processingVersion,
                        compressionMethod: artistData.compressionMethod
                    }
                };
            }

            // legacy binary data → reprocess
            if (artistData.binaryImageData && artistData.imageWidth && artistData.imageHeight && sourceUrl) {
                return await processArtistImageToGrayscale(sourceUrl, artistUrlKey);
            }

            // has url but no grayscale data → process
            if (artistData.imageUrl && !artistData.grayscaleImageData) {
                return await processArtistImageToGrayscale(artistData.imageUrl, artistUrlKey);
            }
        }

        // no stored data, but caller supplied a url
        if (imageUrl) {
            try {
                const result = await processArtistImageToGrayscale(imageUrl, artistUrlKey);
                if (result.success) return result;
            } catch (processingError) {
                console.error(`Error processing new artist image ${artistUrlKey}:`, processingError);
            }
            return { success: false, error: 'Failed to process new artist image', cached: false };
        }

        return { success: false, error: 'No image data available', cached: false };
    } catch (error) {
        console.error(`Error getting artist grayscale image for ${artistUrlKey}:`, error);
        return { success: false, error: error.message, cached: false };
    }
}

// fallback path when server can't fetch (e.g. genius IP-blocks firebase)
// loads image directly in browser, canvas-converts to grayscale
// requires genius CDN to send CORS headers, otherwise canvas taints and getImageData throws
async function processArtistImageClientSide(imageUrl, artistUrlKey) {
    console.log(`🖥️ Processing artist image client-side for ${artistUrlKey}...`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

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
                ctx.drawImage(img, 0, 0, width, height);

                const { data } = ctx.getImageData(0, 0, width, height);
                const grayscaleBytes = new Uint8Array(width * height);
                for (let i = 0; i < data.length; i += 4) {
                    grayscaleBytes[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                }

                const rawGrayscaleBytes = new Uint8Array(grayscaleBytes);
                const grayscaleData = bytesToBase64(grayscaleBytes);
                const processingTime = Date.now() - startTime;
                console.log(`✅ Client-side artist processing complete in ${processingTime}ms (${width}x${height})`);

                resolve({
                    success: true,
                    grayscaleData,
                    rawGrayscaleBytes,
                    metadata: {
                        width,
                        height,
                        processingVersion: '2.0-grayscale-client',
                        compressionMethod: 'none'
                    },
                    cached: false,
                    clientProcessingTime: processingTime,
                    processedClientSide: true
                });
            } catch (canvasError) {
                console.error('Canvas processing failed:', canvasError);
                reject(canvasError);
            }
        };

        img.onerror = () => reject(new Error(`Failed to load image for client-side processing: ${imageUrl}`));
        img.src = imageUrl;
    });
}

/**
 * Process an artist image to grayscale format via Firebase Function
 * Falls back to client-side canvas processing if server fails
 * Uses in-memory cache to dedupe concurrent requests for the same artist
 */
async function processArtistImageToGrayscale(imageUrl, artistUrlKey) {
    const cacheKey = `${artistUrlKey}-${imageUrl}`;

    if (processingCache.has(cacheKey)) {
        return await processingCache.get(cacheKey);
    }

    const processingPromise = (async () => {
        try {
            const processArtistImage = httpsCallable(functions, 'processArtistImageBinary');
            const response = await processArtistImage({ url: imageUrl, artistKey: artistUrlKey });
            const result = response.data;

            let grayscaleData = result.grayscaleData;
            let rawGrayscaleBytes = null;

            if (result.metadata.compressionMethod === 'pako-deflate') {
                rawGrayscaleBytes = new Uint8Array(decompressGrayscaleData(result.grayscaleData));
                grayscaleData = bytesToBase64(rawGrayscaleBytes);
            }

            return { ...result, grayscaleData, rawGrayscaleBytes, cached: false };
        } catch (error) {
            console.error(`Error processing artist image to grayscale for ${artistUrlKey}:`, error.message);

            // genius IP-blocks firebase → 403 → try in-browser canvas as fallback
            // also catch any other server failure as last resort
            const is403 = error.code === 'internal' && error.message?.includes('403');
            if (is403) {
                console.log(`Server got 403, trying client-side artist processing...`);
            } else {
                console.log(`Server processing failed, trying client-side artist processing as last resort...`);
            }

            try {
                return await processArtistImageClientSide(imageUrl, artistUrlKey);
            } catch (clientError) {
                console.error('Client-side artist processing also failed:', clientError.message);
                throw error;
            }
        } finally {
            setTimeout(() => processingCache.delete(cacheKey), CACHE_TIMEOUT);
        }
    })();

    processingCache.set(cacheKey, processingPromise);
    return await processingPromise;
}
