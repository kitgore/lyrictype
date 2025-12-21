<script>
    import { onMount } from 'svelte';
    import { getArtistBinaryImage } from '$lib/services/grayscaleImageService';
    import GrayscaleImageRenderer from './GrayscaleImageRenderer.svelte';
    import { imageColors } from '$lib/services/store.js';
    import pako from 'pako';
    
    let testMode = 'artist'; // 'artist' or 'url'
    let artistUrlKey = '410'; // Default for testing
    let standaloneUrl = '';
    let testPrimaryColor = '#000000';
    let testSecondaryColor = '#ffffff';
    
    let loading = false;
    let error = null;
    let imageData = null;
    let debugInfo = {};
    
    // Override store colors for testing
    $: if (imageData) {
        $imageColors = {
            primary: testPrimaryColor,
            secondary: testSecondaryColor
        };
    }
    
    async function processStandaloneUrl(imageUrl) {
        console.log(`🧪 TEST: Processing standalone URL: ${imageUrl}`);
        
        // Call Firebase function directly
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
                artistKey: 'test-standalone' // Dummy key for testing
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Processing failed (${response.status}): ${errorText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Image processing failed');
        }
        
        // Decompress the data
        console.log(`🧪 TEST: Decompressing data...`);
        const compressedData = Uint8Array.from(atob(result.grayscaleData), c => c.charCodeAt(0));
        const decompressedBytesRaw = pako.inflate(compressedData);
        
        // Create a fresh copy to avoid WebGL ArrayBuffer issues
        const decompressedBytes = new Uint8Array(decompressedBytesRaw);
        
        // Convert to Base64 for display
        let binaryString = '';
        const chunkSize = 8192;
        for (let i = 0; i < decompressedBytes.length; i += chunkSize) {
            const chunk = decompressedBytes.slice(i, i + chunkSize);
            binaryString += String.fromCharCode(...chunk);
        }
        const grayscaleDataBase64 = btoa(binaryString);
        
        return {
            success: true,
            cached: false,
            grayscaleData: grayscaleDataBase64,
            rawGrayscaleBytes: decompressedBytes,
            metadata: {
                width: result.metadata.width,
                height: result.metadata.height,
                originalSize: result.metadata.originalSize,
                grayscaleSize: result.metadata.grayscaleSize,
                compressedSize: result.metadata.compressedSize,
                compressionMethod: result.metadata.compressionMethod,
                processingVersion: '2.0-grayscale',
                originalImageUrl: imageUrl,
                processingTimeMs: result.metadata.processingTimeMs
            }
        };
    }
    
    async function loadImage() {
        loading = true;
        error = null;
        imageData = null;
        debugInfo = {};
        
        try {
            let result;
            
            if (testMode === 'url') {
                if (!standaloneUrl) {
                    throw new Error('Please provide an image URL');
                }
                result = await processStandaloneUrl(standaloneUrl);
            } else {
                if (!artistUrlKey) {
                    throw new Error('Please provide an artist URL key');
                }
                console.log(`🧪 TEST: Loading image for artist: ${artistUrlKey}`);
                result = await getArtistBinaryImage(artistUrlKey, undefined);
            }
            
            console.log(`🧪 TEST: Result received:`, result);
            
            if (result.success) {
                imageData = result;
                
                // Gather debug info
                debugInfo = {
                    success: true,
                    cached: result.cached,
                    mode: testMode,
                    dimensions: `${result.metadata.width} × ${result.metadata.height}`,
                    expectedBytes: result.metadata.width * result.metadata.height,
                    hasGrayscaleData: !!result.grayscaleData,
                    hasRawBytes: !!result.rawGrayscaleBytes,
                    grayscaleDataLength: result.grayscaleData?.length || 0,
                    rawBytesLength: result.rawGrayscaleBytes?.length || 0,
                    compressionMethod: result.metadata.compressionMethod,
                    processingVersion: result.metadata.processingVersion,
                    originalImageUrl: result.metadata.originalImageUrl,
                    processingTimeMs: result.metadata.processingTimeMs,
                    
                    // Validation checks
                    dataValid: !!result.grayscaleData && result.grayscaleData.length > 0,
                    sizeMatch: result.rawGrayscaleBytes ? 
                        result.rawGrayscaleBytes.length === (result.metadata.width * result.metadata.height) :
                        'No raw bytes to check',
                    
                    // Sample bytes from different parts of the image
                    sampleBytes: result.rawGrayscaleBytes ? 
                        Array.from(result.rawGrayscaleBytes.slice(0, 10)).join(', ') + '...' :
                        'No raw bytes available',
                    
                    // Analyze brightness distribution
                    brightnessStats: result.rawGrayscaleBytes ? (() => {
                        const bytes = result.rawGrayscaleBytes;
                        let min = 255, max = 0, sum = 0;
                        const histogram = new Array(256).fill(0);
                        
                        for (let i = 0; i < bytes.length; i++) {
                            const val = bytes[i];
                            min = Math.min(min, val);
                            max = Math.max(max, val);
                            sum += val;
                            histogram[val]++;
                        }
                        
                        const avg = sum / bytes.length;
                        const uniqueValues = histogram.filter(count => count > 0).length;
                        
                        return {
                            min,
                            max,
                            avg: avg.toFixed(1),
                            range: max - min,
                            uniqueValues,
                            isUniform: uniqueValues < 10
                        };
                    })() : null,
                    
                    // Detailed distribution breakdown
                    distribution: result.rawGrayscaleBytes ? (() => {
                        const bytes = result.rawGrayscaleBytes;
                        let zeroCount = 0, lowCount = 0, midCount = 0, highCount = 0, maxCount = 0;
                        
                        for (let i = 0; i < bytes.length; i++) {
                            const val = bytes[i];
                            if (val === 0) zeroCount++;
                            else if (val < 64) lowCount++;
                            else if (val < 192) midCount++;
                            else if (val < 255) highCount++;
                            else maxCount++;
                        }
                        
                        const total = bytes.length;
                        return {
                            zeroCount,
                            lowCount,
                            midCount,
                            highCount,
                            maxCount,
                            zeroPercent: ((zeroCount / total) * 100).toFixed(1),
                            lowPercent: ((lowCount / total) * 100).toFixed(1),
                            midPercent: ((midCount / total) * 100).toFixed(1),
                            highPercent: ((highCount / total) * 100).toFixed(1),
                            maxPercent: ((maxCount / total) * 100).toFixed(1)
                        };
                    })() : null
                };
                
                console.log(`🧪 TEST: Debug info:`, debugInfo);
            } else {
                error = result.error || 'Unknown error';
                debugInfo = {
                    success: false,
                    error: result.error,
                    cached: result.cached
                };
            }
        } catch (err) {
            console.error(`🧪 TEST: Error loading image:`, err);
            error = err.message;
            debugInfo = {
                success: false,
                error: err.message,
                stack: err.stack
            };
        } finally {
            loading = false;
        }
    }
    
    function testColorChange(preset) {
        switch(preset) {
            case 'black-white':
                testPrimaryColor = '#000000';
                testSecondaryColor = '#ffffff';
                break;
            case 'white-black':
                testPrimaryColor = '#ffffff';
                testSecondaryColor = '#000000';
                break;
            case 'red-yellow':
                testPrimaryColor = '#ff0000';
                testSecondaryColor = '#ffff00';
                break;
            case 'blue-pink':
                testPrimaryColor = '#0000ff';
                testSecondaryColor = '#ff00ff';
                break;
            case 'green-cyan':
                testPrimaryColor = '#00ff00';
                testSecondaryColor = '#00ffff';
                break;
        }
    }
</script>

<div class="test-container">
    <h1>🧪 Image Recoloring Test Tool</h1>
    
    <div class="mode-selector">
        <label>
            <input 
                type="radio" 
                bind:group={testMode} 
                value="artist"
            />
            <span>Test Artist (from database)</span>
        </label>
        <label>
            <input 
                type="radio" 
                bind:group={testMode} 
                value="url"
            />
            <span>Test URL (standalone image)</span>
        </label>
    </div>
    
    <div class="controls">
        {#if testMode === 'artist'}
            <div class="input-group">
                <label for="artistKey">Artist URL Key:</label>
                <input 
                    id="artistKey"
                    type="text" 
                    bind:value={artistUrlKey} 
                    placeholder="e.g., 410, 10-years, 917-rackz"
                />
                <span class="hint-text">The artist's Firestore document ID</span>
            </div>
        {:else}
            <div class="input-group full-width">
                <label for="standaloneUrl">Image URL:</label>
                <input 
                    id="standaloneUrl"
                    type="text" 
                    bind:value={standaloneUrl} 
                    placeholder="https://images.genius.com/..."
                />
                <span class="hint-text">Any valid image URL (will be processed fresh)</span>
            </div>
        {/if}
        
        <button 
            on:click={loadImage} 
            disabled={loading || (testMode === 'artist' && !artistUrlKey) || (testMode === 'url' && !standaloneUrl)}
        >
            {loading ? '⏳ Processing...' : testMode === 'url' ? '🔄 Process & Test' : '🔄 Load & Test'}
        </button>
    </div>
    
    {#if error}
        <div class="error-box">
            <h3>❌ Error</h3>
            <pre>{error}</pre>
        </div>
    {/if}
    
    {#if imageData}
        <div class="results">
            <div class="left-panel">
                <h2>Debug Information</h2>
                <div class="debug-section">
                    <h3>Status</h3>
                    <table>
                        <tr>
                            <td>Mode:</td>
                            <td>{debugInfo.mode === 'url' ? '🔗 Standalone URL' : '👤 Artist from DB'}</td>
                        </tr>
                        <tr>
                            <td>Success:</td>
                            <td class={debugInfo.success ? 'success' : 'error'}>
                                {debugInfo.success ? '✅ Yes' : '❌ No'}
                            </td>
                        </tr>
                        <tr>
                            <td>Cached:</td>
                            <td>{debugInfo.cached ? '✅ Yes' : '🆕 No (freshly processed)'}</td>
                        </tr>
                        <tr>
                            <td>Dimensions:</td>
                            <td>{debugInfo.dimensions}</td>
                        </tr>
                        <tr>
                            <td>Expected Bytes:</td>
                            <td>{debugInfo.expectedBytes?.toLocaleString()}</td>
                        </tr>
                        {#if debugInfo.processingTimeMs}
                        <tr>
                            <td>Processing Time:</td>
                            <td>{debugInfo.processingTimeMs}ms</td>
                        </tr>
                        {/if}
                    </table>
                </div>
                
                <div class="debug-section">
                    <h3>Data Validation</h3>
                    <table>
                        <tr>
                            <td>Has Grayscale Data:</td>
                            <td class={debugInfo.hasGrayscaleData ? 'success' : 'error'}>
                                {debugInfo.hasGrayscaleData ? '✅ Yes' : '❌ No'}
                            </td>
                        </tr>
                        <tr>
                            <td>Has Raw Bytes:</td>
                            <td class={debugInfo.hasRawBytes ? 'success' : 'error'}>
                                {debugInfo.hasRawBytes ? '✅ Yes' : '❌ No'}
                            </td>
                        </tr>
                        <tr>
                            <td>Grayscale Data Length:</td>
                            <td>{debugInfo.grayscaleDataLength?.toLocaleString()} chars</td>
                        </tr>
                        <tr>
                            <td>Raw Bytes Length:</td>
                            <td>{debugInfo.rawBytesLength?.toLocaleString()} bytes</td>
                        </tr>
                        <tr>
                            <td>Size Match:</td>
                            <td class={debugInfo.sizeMatch === true ? 'success' : typeof debugInfo.sizeMatch === 'string' ? 'warning' : 'error'}>
                                {debugInfo.sizeMatch === true ? '✅ Match' : 
                                 typeof debugInfo.sizeMatch === 'string' ? '⚠️ ' + debugInfo.sizeMatch :
                                 '❌ Mismatch'}
                            </td>
                        </tr>
                    </table>
                </div>
                
                <div class="debug-section">
                    <h3>Processing Info</h3>
                    <table>
                        <tr>
                            <td>Compression Method:</td>
                            <td>{debugInfo.compressionMethod || 'None'}</td>
                        </tr>
                        <tr>
                            <td>Processing Version:</td>
                            <td>{debugInfo.processingVersion || 'Unknown'}</td>
                        </tr>
                        <tr>
                            <td>Original URL:</td>
                            <td class="url-cell" title={debugInfo.originalImageUrl}>
                                {debugInfo.originalImageUrl?.substring(0, 40)}...
                            </td>
                        </tr>
                    </table>
                </div>
                
                <div class="debug-section">
                    <h3>Sample Data</h3>
                    <pre class="sample-data">{debugInfo.sampleBytes}</pre>
                </div>
                
                {#if debugInfo.brightnessStats}
                <div class="debug-section">
                    <h3>Brightness Analysis</h3>
                    <table>
                        <tr>
                            <td>Min Value:</td>
                            <td>{debugInfo.brightnessStats.min}</td>
                        </tr>
                        <tr>
                            <td>Max Value:</td>
                            <td>{debugInfo.brightnessStats.max}</td>
                        </tr>
                        <tr>
                            <td>Average:</td>
                            <td>{debugInfo.brightnessStats.avg}</td>
                        </tr>
                        <tr>
                            <td>Range:</td>
                            <td class={debugInfo.brightnessStats.range < 10 ? 'error' : debugInfo.brightnessStats.range < 50 ? 'warning' : 'success'}>
                                {debugInfo.brightnessStats.range} {debugInfo.brightnessStats.range < 10 ? '⚠️ Very low!' : ''}
                            </td>
                        </tr>
                        <tr>
                            <td>Unique Values:</td>
                            <td class={debugInfo.brightnessStats.uniqueValues > 100 ? 'success' : debugInfo.brightnessStats.uniqueValues > 10 ? 'warning' : 'error'}>
                                {debugInfo.brightnessStats.uniqueValues} / 256
                            </td>
                        </tr>
                        <tr>
                            <td>Status:</td>
                            <td class={debugInfo.brightnessStats.isUniform ? 'error' : 'success'}>
                                {debugInfo.brightnessStats.isUniform ? '❌ Uniform (Problem!)' : '✅ Varied'}
                            </td>
                        </tr>
                    </table>
                    
                    {#if debugInfo.distribution}
                    <h4>Value Distribution</h4>
                    <div class="distribution-bars">
                        <div class="dist-bar" title="Zero (0): {debugInfo.distribution.zeroPercent}%">
                            <div class="bar-fill zero" style="width: {Math.min(100, debugInfo.distribution.zeroPercent)}%"></div>
                            <span class="bar-label">0: {debugInfo.distribution.zeroPercent}%</span>
                        </div>
                        <div class="dist-bar" title="Low (1-63): {debugInfo.distribution.lowPercent}%">
                            <div class="bar-fill low" style="width: {Math.min(100, debugInfo.distribution.lowPercent)}%"></div>
                            <span class="bar-label">1-63: {debugInfo.distribution.lowPercent}%</span>
                        </div>
                        <div class="dist-bar" title="Mid (64-191): {debugInfo.distribution.midPercent}%">
                            <div class="bar-fill mid" style="width: {Math.min(100, debugInfo.distribution.midPercent)}%"></div>
                            <span class="bar-label">64-191: {debugInfo.distribution.midPercent}%</span>
                        </div>
                        <div class="dist-bar" title="High (192-254): {debugInfo.distribution.highPercent}%">
                            <div class="bar-fill high" style="width: {Math.min(100, debugInfo.distribution.highPercent)}%"></div>
                            <span class="bar-label">192-254: {debugInfo.distribution.highPercent}%</span>
                        </div>
                        <div class="dist-bar" title="Max (255): {debugInfo.distribution.maxPercent}%">
                            <div class="bar-fill max" style="width: {Math.min(100, debugInfo.distribution.maxPercent)}%"></div>
                            <span class="bar-label">255: {debugInfo.distribution.maxPercent}%</span>
                        </div>
                    </div>
                    {/if}
                    
                    {#if debugInfo.brightnessStats.isUniform || debugInfo.distribution?.zeroPercent > 90}
                        <div class="warning-box critical">
                            🚨 <strong>SOLID COLOR PROBLEM DETECTED!</strong><br/>
                            {#if debugInfo.distribution?.zeroPercent > 90}
                                {debugInfo.distribution.zeroPercent}% of pixels are value 0 (black).<br/>
                                This will render as a solid block of the PRIMARY color.
                            {:else}
                                Only {debugInfo.brightnessStats.uniqueValues} unique values detected.<br/>
                                The image has no grayscale variation.
                            {/if}
                            <br/><br/>
                            <strong>Possible causes:</strong>
                            <ul>
                                <li>Corrupted image data in database</li>
                                <li>Server-side processing failed</li>
                                <li>Image URL was inaccessible during processing</li>
                                <li>CORS or network issues during fetch</li>
                            </ul>
                        </div>
                    {:else if debugInfo.brightnessStats.range < 50}
                        <div class="warning-box">
                            ⚠️ <strong>Low contrast detected.</strong><br/>
                            Value range is only {debugInfo.brightnessStats.min}-{debugInfo.brightnessStats.max}.<br/>
                            The recolored image may appear washed out or lack detail.
                        </div>
                    {/if}
                </div>
                {/if}
            </div>
            
            <div class="right-panel">
                <h2>Color Testing</h2>
                
                <div class="color-controls">
                    <div class="color-input-group">
                        <label for="primary">Primary (Dark):</label>
                        <input 
                            id="primary"
                            type="color" 
                            bind:value={testPrimaryColor}
                        />
                        <input 
                            type="text" 
                            bind:value={testPrimaryColor}
                            placeholder="#000000"
                        />
                    </div>
                    
                    <div class="color-input-group">
                        <label for="secondary">Secondary (Light):</label>
                        <input 
                            id="secondary"
                            type="color" 
                            bind:value={testSecondaryColor}
                        />
                        <input 
                            type="text" 
                            bind:value={testSecondaryColor}
                            placeholder="#ffffff"
                        />
                    </div>
                </div>
                
                <div class="preset-buttons">
                    <h3>Presets:</h3>
                    <button on:click={() => testColorChange('black-white')}>⚫ Black/White</button>
                    <button on:click={() => testColorChange('white-black')}>⚪ White/Black</button>
                    <button on:click={() => testColorChange('red-yellow')}>🔴 Red/Yellow</button>
                    <button on:click={() => testColorChange('blue-pink')}>🔵 Blue/Pink</button>
                    <button on:click={() => testColorChange('green-cyan')}>🟢 Green/Cyan</button>
                </div>
                
                <div class="render-container">
                    <h3>Rendered Result:</h3>
                    <div class="image-wrapper">
                        {#if imageData.grayscaleData && imageData.metadata}
                            <GrayscaleImageRenderer
                                grayscaleData={imageData.grayscaleData}
                                rawGrayscaleBytes={imageData.rawGrayscaleBytes}
                                width={imageData.metadata.width}
                                height={imageData.metadata.height}
                                alt={`Test render for ${artistUrlKey}`}
                                borderRadius="15%"
                            />
                        {:else}
                            <div class="no-data">❌ No image data to render</div>
                        {/if}
                    </div>
                </div>
                
                <div class="render-info">
                    <p><strong>Current Colors:</strong></p>
                    <div class="color-preview">
                        <div class="color-sample" style="background: {testPrimaryColor}">
                            Primary
                        </div>
                        <div class="color-sample" style="background: {testSecondaryColor}; color: {testPrimaryColor}">
                            Secondary
                        </div>
                    </div>
                    <p class="hint">💡 Change colors above and watch the image update in real-time</p>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .test-container {
        padding: 2rem;
        max-width: 1600px;
        margin: 0 auto;
        background: #1e1e1e;
        color: #ffffff;
        min-height: 100vh;
    }
    
    h1 {
        text-align: center;
        margin-bottom: 1.5rem;
        font-size: 2rem;
    }
    
    .mode-selector {
        background: #2d2d2d;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        display: flex;
        gap: 2rem;
        justify-content: center;
    }
    
    .mode-selector label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        padding: 0.5rem 1rem;
        border-radius: 4px;
        transition: background 0.2s;
    }
    
    .mode-selector label:hover {
        background: #3d3d3d;
    }
    
    .mode-selector input[type="radio"] {
        cursor: pointer;
        width: 18px;
        height: 18px;
    }
    
    .mode-selector span {
        font-weight: bold;
        font-size: 1rem;
    }
    
    .controls {
        background: #2d2d2d;
        padding: 1.5rem;
        border-radius: 8px;
        margin-bottom: 2rem;
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        align-items: flex-end;
    }
    
    .input-group {
        flex: 1;
        min-width: 250px;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    
    .input-group.full-width {
        flex: 1 1 100%;
        min-width: 100%;
    }
    
    label {
        font-weight: bold;
        font-size: 0.9rem;
    }
    
    .hint-text {
        font-size: 0.8rem;
        color: #aaa;
        font-style: italic;
        margin-top: -0.25rem;
    }
    
    input[type="text"] {
        padding: 0.5rem;
        border: 1px solid #444;
        border-radius: 4px;
        background: #1e1e1e;
        color: #fff;
        font-size: 1rem;
    }
    
    button {
        padding: 0.75rem 1.5rem;
        background: #0066cc;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        font-size: 1rem;
        transition: background 0.2s;
    }
    
    button:hover:not(:disabled) {
        background: #0052a3;
    }
    
    button:disabled {
        background: #555;
        cursor: not-allowed;
    }
    
    .error-box {
        background: #3d1f1f;
        border: 2px solid #cc0000;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 2rem;
    }
    
    .error-box h3 {
        margin-top: 0;
        color: #ff6666;
    }
    
    .error-box pre {
        overflow-x: auto;
        color: #ffcccc;
    }
    
    .warning-box {
        background: #3d2f1f;
        border: 2px solid #ff9800;
        padding: 1rem;
        border-radius: 4px;
        margin-top: 1rem;
        color: #ffb74d;
        font-weight: bold;
    }
    
    .warning-box.critical {
        background: #4d1f1f;
        border-color: #ff4444;
        color: #ff8888;
    }
    
    .warning-box ul {
        margin: 0.5rem 0 0 1.5rem;
        padding: 0;
        font-weight: normal;
        font-size: 0.9rem;
    }
    
    .warning-box li {
        margin: 0.25rem 0;
    }
    
    h4 {
        color: #aaa;
        margin: 1rem 0 0.5rem;
        font-size: 0.9rem;
    }
    
    .distribution-bars {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        background: #1e1e1e;
        padding: 0.75rem;
        border-radius: 4px;
    }
    
    .dist-bar {
        position: relative;
        height: 24px;
        background: #333;
        border-radius: 3px;
        overflow: hidden;
    }
    
    .bar-fill {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s ease;
    }
    
    .bar-fill.zero { background: linear-gradient(90deg, #ff4444, #cc3333); }
    .bar-fill.low { background: linear-gradient(90deg, #ff9800, #cc7700); }
    .bar-fill.mid { background: linear-gradient(90deg, #4caf50, #388e3c); }
    .bar-fill.high { background: linear-gradient(90deg, #2196f3, #1976d2); }
    .bar-fill.max { background: linear-gradient(90deg, #9c27b0, #7b1fa2); }
    
    .bar-label {
        position: absolute;
        left: 0.5rem;
        top: 50%;
        transform: translateY(-50%);
        font-size: 0.75rem;
        font-family: monospace;
        color: white;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        z-index: 1;
    }
    
    .results {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
    }
    
    .left-panel, .right-panel {
        background: #2d2d2d;
        padding: 1.5rem;
        border-radius: 8px;
    }
    
    h2 {
        margin-top: 0;
        border-bottom: 2px solid #444;
        padding-bottom: 0.5rem;
    }
    
    h3 {
        color: #66b3ff;
        margin-top: 1.5rem;
        margin-bottom: 0.75rem;
    }
    
    .debug-section {
        margin-bottom: 1.5rem;
    }
    
    table {
        width: 100%;
        border-collapse: collapse;
    }
    
    td {
        padding: 0.5rem;
        border-bottom: 1px solid #444;
    }
    
    td:first-child {
        font-weight: bold;
        width: 40%;
        color: #aaa;
    }
    
    .success {
        color: #4caf50;
    }
    
    .error {
        color: #f44336;
    }
    
    .warning {
        color: #ff9800;
    }
    
    .url-cell {
        font-size: 0.85rem;
        font-family: monospace;
        word-break: break-all;
    }
    
    .sample-data {
        background: #1e1e1e;
        padding: 0.75rem;
        border-radius: 4px;
        font-size: 0.85rem;
        overflow-x: auto;
        color: #4caf50;
    }
    
    .color-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    
    .color-input-group {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }
    
    .color-input-group label {
        width: 120px;
    }
    
    input[type="color"] {
        width: 50px;
        height: 40px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }
    
    .color-input-group input[type="text"] {
        flex: 1;
        font-family: monospace;
    }
    
    .preset-buttons {
        margin-bottom: 1.5rem;
    }
    
    .preset-buttons button {
        margin: 0.25rem;
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
    }
    
    .render-container {
        margin-top: 1.5rem;
    }
    
    .image-wrapper {
        width: 400px;
        height: 400px;
        margin: 1rem auto;
        background: #1e1e1e;
        border: 2px solid #444;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
    
    .no-data {
        color: #f44336;
        font-size: 1.2rem;
    }
    
    .render-info {
        background: #1e1e1e;
        padding: 1rem;
        border-radius: 4px;
        margin-top: 1rem;
    }
    
    .color-preview {
        display: flex;
        gap: 1rem;
        margin: 1rem 0;
    }
    
    .color-sample {
        flex: 1;
        padding: 1.5rem;
        border-radius: 4px;
        text-align: center;
        font-weight: bold;
        border: 2px solid #444;
    }
    
    .hint {
        color: #aaa;
        font-style: italic;
        margin-top: 1rem;
    }
    
    @media (max-width: 1200px) {
        .results {
            grid-template-columns: 1fr;
        }
    }
</style>

