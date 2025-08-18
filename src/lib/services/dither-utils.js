// dither-utils.js

/**
 * Atkinson dithering algorithm with optional binary output
 * @param {ImageData} imageData - Input image data
 * @param {string} primaryColor - Hex color for dark pixels (optional for binary mode)
 * @param {string} secondaryColor - Hex color for light pixels (optional for binary mode)
 * @param {boolean} returnBinary - If true, returns binary data instead of colored ImageData
 * @returns {ImageData|Uint8Array} Colored ImageData or binary array
 */
export function atkinsonDither(imageData, primaryColor, secondaryColor, returnBinary = false) {
    // Convert hex to RGB
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return [r, g, b];
    }

    const width = imageData.width;
    const height = imageData.height;
    const data = new Uint8ClampedArray(imageData.data);
    
    // Only parse colors if we need them for colored output
    const darkColor = returnBinary ? null : hexToRgb(primaryColor);
    const lightColor = returnBinary ? null : hexToRgb(secondaryColor);
    
    // Create binary output array if needed (1 bit per pixel, packed into bytes)
    let binaryData = null;
    if (returnBinary) {
        const binarySize = Math.ceil((width * height) / 8);
        binaryData = new Uint8Array(binarySize);
    }
    
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

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const oldPixel = data[idx];
            
            // Determine if pixel should be dark or light
            const isDark = oldPixel < 128;
            
            if (returnBinary) {
                // Store binary result (1 for light, 0 for dark)
                const bitIndex = y * width + x;
                const byteIndex = Math.floor(bitIndex / 8);
                const bitPosition = 7 - (bitIndex % 8);
                
                if (!isDark) { // Light pixel = 1
                    binaryData[byteIndex] |= (1 << bitPosition);
                }
            } else {
                // Store colored result
                const newColor = isDark ? darkColor : lightColor;
                data[idx] = newColor[0];     // R
                data[idx + 1] = newColor[1]; // G
                data[idx + 2] = newColor[2]; // B
            }
            
            const newPixel = isDark ? 0 : 255;
            const error = (oldPixel - newPixel) / 8;

            // Propagate error
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

    // Return appropriate result
    if (returnBinary) {
        return binaryData;
    } else {
        return new ImageData(data, width, height);
    }
}

export async function applyDitheringToImage(originalUrl, primaryColor, secondaryColor, shouldDither = true, targetSize = null) {
    const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
    
    try {
        const img = await loadImage(proxiedUrl);
        if (!shouldDither) return proxiedUrl;
        
        const canvas = document.createElement('canvas');
        
        // If targetSize is provided, scale the image
        if (targetSize) {
            canvas.width = targetSize;
            canvas.height = targetSize;
        } else {
            canvas.width = img.width;
            canvas.height = img.height;
        }
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const ditheredData = atkinsonDither(imageData, primaryColor, secondaryColor);
        
        ctx.putImageData(ditheredData, 0, 0);
        return canvas.toDataURL();
    } catch (error) {
        console.error('Error in applyDitheringToImage:', error);
        throw error;
    }
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        
        img.src = url;
    });
}

/**
 * Generate binary dithered data from an image URL
 * @param {string} originalUrl - URL of the image to process
 * @param {number} targetSize - Target size for the image (optional)
 * @returns {Promise<{binaryData: Uint8Array, width: number, height: number, analysis: object}>}
 */
export async function generateBinaryDitheredData(originalUrl, targetSize = null) {
    const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
    
    try {
        const img = await loadImage(proxiedUrl);
        
        const canvas = document.createElement('canvas');
        
        // If targetSize is provided, scale the image
        if (targetSize) {
            canvas.width = targetSize;
            canvas.height = targetSize;
        } else {
            canvas.width = img.width;
            canvas.height = img.height;
        }
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const binaryData = atkinsonDither(imageData, null, null, true);
        
        // Generate analysis
        const analysis = analyzeBinaryData(binaryData, canvas.width, canvas.height);
        
        return {
            binaryData,
            width: canvas.width,
            height: canvas.height,
            analysis
        };
    } catch (error) {
        console.error('Error generating binary dithered data:', error);
        throw error;
    }
}

/**
 * Analyze binary dithered data for compression and statistics
 * @param {Uint8Array} binaryData - Binary dithered data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {object} Analysis object with statistics
 */
export function analyzeBinaryData(binaryData, width, height) {
    const totalPixels = width * height;
    const totalBytes = binaryData.length;
    const originalSize = totalPixels * 4; // RGBA
    const compressionRatio = totalBytes / originalSize;
    
    // Calculate white pixel count
    let setBits = 0;
    for (let byte of binaryData) {
        setBits += byte.toString(2).split('1').length - 1;
    }
    
    // Convert to different formats for storage/debugging
    const hexString = Array.from(binaryData)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    
    const base64String = btoa(String.fromCharCode(...binaryData));
    
    return {
        totalPixels,
        totalBytes,
        originalSize,
        compressionRatio: compressionRatio.toFixed(3),
        compressionPercent: ((1 - compressionRatio) * 100).toFixed(1),
        setBits,
        whiteFraction: (setBits / totalPixels).toFixed(3),
        whitePercent: ((setBits / totalPixels) * 100).toFixed(1),
        hexString: hexString.substring(0, 64) + (hexString.length > 64 ? '...' : ''),
        base64String: base64String.substring(0, 64) + (base64String.length > 64 ? '...' : ''),
        fullBase64: base64String, // For storage
        fullHex: hexString // For debugging
    };
}

/**
 * Test function to log binary analysis to console
 * @param {string} imageUrl - URL of image to test
 * @param {number} targetSize - Target size (optional)
 */
export async function testBinaryDithering(imageUrl, targetSize = 100) {
    try {
        console.log('🧪 Testing binary dithering...');
        const result = await generateBinaryDitheredData(imageUrl, targetSize);
        
        console.log('🔍 BINARY DITHERING ANALYSIS:');
        console.log(`📊 Image: ${result.width}x${result.height} pixels`);
        console.log(`📦 Original size: ${result.analysis.originalSize} bytes (RGBA)`);
        console.log(`🗜️  Binary size: ${result.analysis.totalBytes} bytes`);
        console.log(`📉 Compression: ${result.analysis.compressionPercent}% reduction (${result.analysis.compressionRatio}x)`);
        console.log(`⚫ White pixels: ${result.analysis.whitePercent}% (${result.analysis.setBits}/${result.analysis.totalPixels})`);
        console.log(`🔢 Hex preview: ${result.analysis.hexString}`);
        console.log(`📝 Base64 preview: ${result.analysis.base64String}`);
        console.log('✅ Binary data ready for storage/WebGL rendering');
        
        return result;
    } catch (error) {
        console.error('❌ Binary dithering test failed:', error);
        throw error;
    }
}