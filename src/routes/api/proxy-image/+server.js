// Try to import canvas - it may not be available in all environments
let createCanvas, loadImage;
try {
    const canvasModule = await import('canvas');
    createCanvas = canvasModule.createCanvas;
    loadImage = canvasModule.loadImage;
    console.log('✅ Canvas library loaded successfully');
} catch (error) {
    console.log('❌ Canvas library not available:', error.message);
    console.log('📝 Binary processing will be disabled');
}

/**
 * Server-side Atkinson dithering algorithm
 * @param {ImageData} imageData - Input image data
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
            const newPixel = isDark ? 0 : 255;
            
            // Store binary result (1 for light, 0 for dark)
            const bitIndex = y * width + x;
            const byteIndex = Math.floor(bitIndex / 8);
            const bitPosition = 7 - (bitIndex % 8);
            
            if (!isDark) { // Light pixel = 1
                binaryData[byteIndex] |= (1 << bitPosition);
            }
            
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
 * Convert binary data to different formats for analysis
 */
function analyzeBinaryData(binaryData, width, height) {
    const totalPixels = width * height;
    const totalBytes = binaryData.length;
    const compressionRatio = totalBytes / (totalPixels * 4); // vs original RGBA
    
    // Convert to hex string for logging
    const hexString = Array.from(binaryData)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    
    // Calculate some statistics
    let setBits = 0;
    for (let byte of binaryData) {
        setBits += byte.toString(2).split('1').length - 1;
    }
    
    return {
        totalPixels,
        totalBytes,
        compressionRatio: compressionRatio.toFixed(3),
        setBits,
        whiteFraction: (setBits / totalPixels).toFixed(3),
        hexString: hexString.substring(0, 64) + '...', // First 32 bytes only
        base64: Buffer.from(binaryData).toString('base64').substring(0, 64) + '...'
    };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    const imageUrl = url.searchParams.get('url');
    const dither = url.searchParams.get('dither') === 'true';
    const logBinary = url.searchParams.get('logBinary') === 'true';
    
    if (!imageUrl) {
        return new Response('No URL provided', { status: 400 });
    }

    try {
        const response = await fetch(imageUrl);
        const contentType = response.headers.get('content-type');
        const arrayBuffer = await response.arrayBuffer();

        // If dithering is requested, process the image
        if ((dither || logBinary) && createCanvas && loadImage) {
            console.log('🎨 Starting image processing...');
            try {
                // Create canvas and load image for processing
                const buffer = Buffer.from(arrayBuffer);
                const img = await loadImage(buffer);
                console.log(`📷 Loaded image: ${img.width}x${img.height}`);
                
                // Create canvas and get image data
                const canvas = createCanvas(img.width, img.height);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                console.log('🖼️  Got image data, applying dithering...');
                
                // Apply dithering and get binary data
                const binaryData = atkinsonDitherToBinary(imageData);
                const analysis = analyzeBinaryData(binaryData, img.width, img.height);
                
                // Log binary analysis
                if (logBinary) {
                    console.log('🔍 BINARY IMAGE ANALYSIS:');
                    console.log(`📊 Image: ${img.width}x${img.height} pixels`);
                    console.log(`📦 Original size: ${arrayBuffer.byteLength} bytes`);
                    console.log(`🗜️  Binary size: ${analysis.totalBytes} bytes`);
                    console.log(`📉 Compression ratio: ${analysis.compressionRatio}x`);
                    console.log(`⚫ White pixels: ${analysis.whiteFraction} (${analysis.setBits}/${analysis.totalPixels})`);
                    console.log(`🔢 Hex preview: ${analysis.hexString}`);
                    console.log(`📝 Base64 preview: ${analysis.base64}`);
                    console.log('---');
                }
                
                if (dither) {
                    // Return the binary data with appropriate headers
                    return new Response(binaryData, {
                        headers: {
                            'Content-Type': 'application/octet-stream',
                            'X-Image-Width': img.width.toString(),
                            'X-Image-Height': img.height.toString(),
                            'X-Binary-Size': binaryData.length.toString(),
                            'X-Compression-Ratio': analysis.compressionRatio,
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Expose-Headers': 'X-Image-Width,X-Image-Height,X-Binary-Size,X-Compression-Ratio'
                        }
                    });
                }
            } catch (processingError) {
                console.error('❌ Error during image processing:', processingError);
                // Fall through to return original image
            }
        } else if (dither || logBinary) {
            console.log('⚠️  Canvas not available - returning original image');
        }

        // Return original image
        return new Response(arrayBuffer, {
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        console.error('Error processing image:', error);
        return new Response('Error fetching image', { status: 500 });
    }
}