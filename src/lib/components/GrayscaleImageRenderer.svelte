<!--
  Grayscale Image WebGL Renderer
  Renders 8-bit grayscale image data with dynamic theme colors
  Optimized for performance and instant theme changes
-->

<script>
  import { onMount, onDestroy } from 'svelte';
  import { imageColors } from '$lib/services/store.js';

  // Debug flag - set to true to enable detailed console logging
  const DEBUG = false;

  export let grayscaleData = ''; // Base64 encoded grayscale image data
  export let rawGrayscaleBytes = null; // Raw Uint8Array for WebGL (preferred)
  export let width = 200; // Storage resolution width
  export let height = 200; // Storage resolution height
  export let alt = 'Grayscale rendered image';
  export let borderRadius = '25%'; // Default border radius for artist images
  
  // Allow custom CSS class to be passed in
  let className = '';
  export { className as class };

  let canvas;
  let canvasWrapper;
  let gl;
  // Shader program variants for adaptive downsampling (selected based on downscale ratio)
  let programs = {
    tap1: null,   // 1-tap for 1x-2x downscale
    tap4: null,   // 4-tap for 2x-4x downscale
    tap16: null,  // 16-tap for 4x-8x downscale
    tap36: null   // 36-tap for 8x+ downscale
  };
  let activeProgram = null; // Currently selected shader program
  let downsampleProgram;
  let texture;
  let framebuffer;
  let framebufferTexture;
  let animationId;
  let currentPrimaryColor = '';
  let currentSecondaryColor = '';
  let isInitialized = false;
  let displayWidth = 200; // Actual display width in pixels
  let displayHeight = 200; // Actual display height in pixels
  let renderWidth = 800; // 4x resolution width for intermediate rendering
  let renderHeight = 800; // 4x resolution height for intermediate rendering
  let resizeObserver;
  let currentDownscaleRatio = 1; // Track downscale ratio for shader selection
  let lastLoggedRatio = -1; // For throttling debug logs

  // Vertex shader - simple quad
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  // Fragment shader variants for adaptive multi-sample downsampling
  // Each variant uses a box filter with different tap counts based on downscale ratio
  // NOTE: Fixed 4x intermediate framebuffer is used; future optimization could use dynamic scaling

  // 1-tap shader (standard linear, for downscale ratios 1x-2x)
  const fragmentShader1Tap = `
    precision mediump float;
    
    uniform sampler2D u_texture;
    uniform vec3 u_primaryColor;
    uniform vec3 u_secondaryColor;
    
    varying vec2 v_texCoord;
    
    void main() {
      float grayscaleValue = texture2D(u_texture, v_texCoord).r;
      vec3 color = mix(u_primaryColor, u_secondaryColor, grayscaleValue);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // 4-tap shader (2x2 box filter, for downscale ratios 2x-4x)
  // Samples are spread across the area covered by the downscale ratio
  const fragmentShader4Tap = `
    precision mediump float;
    
    uniform sampler2D u_texture;
    uniform vec3 u_primaryColor;
    uniform vec3 u_secondaryColor;
    uniform vec2 u_texelSize; // 1.0 / textureSize
    uniform float u_downscaleRatio; // How many source pixels per output pixel
    
    varying vec2 v_texCoord;
    
    void main() {
      // 2x2 box filter: sample 4 points spread across the downscale area
      // Each sample is offset by ratio/2 texels to cover the full source area
      vec2 sampleStep = u_texelSize * u_downscaleRatio * 0.5;
      
      float g00 = texture2D(u_texture, v_texCoord + vec2(-sampleStep.x, -sampleStep.y)).r;
      float g10 = texture2D(u_texture, v_texCoord + vec2( sampleStep.x, -sampleStep.y)).r;
      float g01 = texture2D(u_texture, v_texCoord + vec2(-sampleStep.x,  sampleStep.y)).r;
      float g11 = texture2D(u_texture, v_texCoord + vec2( sampleStep.x,  sampleStep.y)).r;
      
      float grayscaleValue = (g00 + g10 + g01 + g11) * 0.25;
      vec3 color = mix(u_primaryColor, u_secondaryColor, grayscaleValue);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // 16-tap shader (4x4 box filter, for downscale ratios 4x-8x)
  // Samples are evenly distributed across the source pixel area
  const fragmentShader16Tap = `
    precision mediump float;
    
    uniform sampler2D u_texture;
    uniform vec3 u_primaryColor;
    uniform vec3 u_secondaryColor;
    uniform vec2 u_texelSize;
    uniform float u_downscaleRatio;
    
    varying vec2 v_texCoord;
    
    void main() {
      // 4x4 box filter: sample 16 points spread across downscale area
      // Step size: ratio/4 texels between samples to cover full area
      vec2 sampleStep = u_texelSize * u_downscaleRatio / 4.0;
      float sum = 0.0;
      
      for (int y = -2; y < 2; y++) {
        for (int x = -2; x < 2; x++) {
          vec2 offset = vec2(float(x) + 0.5, float(y) + 0.5) * sampleStep;
          sum += texture2D(u_texture, v_texCoord + offset).r;
        }
      }
      
      float grayscaleValue = sum / 16.0;
      vec3 color = mix(u_primaryColor, u_secondaryColor, grayscaleValue);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // 36-tap shader (6x6 box filter, for downscale ratios 8x+)
  // Maximum sampling for extreme downscaling scenarios
  const fragmentShader36Tap = `
    precision mediump float;
    
    uniform sampler2D u_texture;
    uniform vec3 u_primaryColor;
    uniform vec3 u_secondaryColor;
    uniform vec2 u_texelSize;
    uniform float u_downscaleRatio;
    
    varying vec2 v_texCoord;
    
    void main() {
      // 6x6 box filter: sample 36 points spread across downscale area
      // Step size: ratio/6 texels between samples to cover full area
      vec2 sampleStep = u_texelSize * u_downscaleRatio / 6.0;
      float sum = 0.0;
      
      for (int y = -3; y < 3; y++) {
        for (int x = -3; x < 3; x++) {
          vec2 offset = vec2(float(x) + 0.5, float(y) + 0.5) * sampleStep;
          sum += texture2D(u_texture, v_texCoord + offset).r;
        }
      }
      
      float grayscaleValue = sum / 36.0;
      vec3 color = mix(u_primaryColor, u_secondaryColor, grayscaleValue);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // Downsampling fragment shader - averages 4x4 blocks (Pass 2)
  const downsampleFragmentShaderSource = `
    precision mediump float;
    
    uniform sampler2D u_framebufferTexture;
    
    varying vec2 v_texCoord;
    
    void main() {
      // Flip Y coordinate to correct upside-down framebuffer
      vec2 flippedCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
      
      // Sample the framebuffer texture with corrected coordinates
      vec3 color = texture2D(u_framebufferTexture, flippedCoord).rgb;
      
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (DEBUG) console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    
    return shader;
  }

  function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (DEBUG) console.error('Program linking error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    
    return program;
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ] : [0, 0, 0];
  }

  // Select the appropriate shader program based on downscale ratio
  // This ensures smooth rendering by sampling enough source pixels
  function selectShaderProgram() {
    if (!programs.tap1) return null;
    
    // Calculate downscale ratio: source image size / FINAL DISPLAY size
    // This accounts for the full downscale chain (source -> framebuffer -> display)
    // The box filter needs to sample across the entire source area that maps to each display pixel
    const scaleX = width / (displayWidth || 1);
    const scaleY = height / (displayHeight || 1);
    const ratio = Math.max(scaleX, scaleY);
    currentDownscaleRatio = ratio;
    
    // Select shader based on ratio thresholds
    let selected;
    let tapCount;
    
    if (ratio <= 0.5) {
      // Upscaling or near 1:1 - simple linear is fine
      selected = programs.tap1;
      tapCount = 1;
    } else if (ratio <= 1.0) {
      // 1x-2x downscale: 1-tap (linear sampling handles this well)
      selected = programs.tap1;
      tapCount = 1;
    } else if (ratio <= 2.0) {
      // 2x-4x downscale: 4-tap (2x2 box filter)
      selected = programs.tap4;
      tapCount = 4;
    } else if (ratio <= 4.0) {
      // 4x-8x downscale: 16-tap (4x4 box filter)
      selected = programs.tap16;
      tapCount = 16;
    } else {
      // 8x+ downscale: 36-tap (6x6 box filter)
      selected = programs.tap36;
      tapCount = 36;
    }
    
    if (selected !== activeProgram) {
      if (DEBUG) {
        const coveragePerSample = tapCount === 1 ? 'N/A' : (ratio / Math.sqrt(tapCount)).toFixed(2);
        console.log(`Shader selection: ratio=${ratio.toFixed(2)}x, ${tapCount}-tap filter, ~${coveragePerSample} texels/sample (source: ${width}x${height} -> display: ${displayWidth}x${displayHeight}, framebuffer: ${renderWidth}x${renderHeight})`);
      }
      activeProgram = selected;
    }
    
    return selected;
  }

  function grayscaleDataToImageData(grayscaleBase64, width, height) {
    try {
      // Decode base64 to grayscale data
      const grayscaleString = atob(grayscaleBase64);
      const grayscaleData = new Uint8Array(grayscaleString.length);
      for (let i = 0; i < grayscaleString.length; i++) {
        grayscaleData[i] = grayscaleString.charCodeAt(i);
      }
      
      // Grayscale data is already 8-bit per pixel, just return it
      // Data should already be width * height bytes
      if (grayscaleData.length !== width * height && DEBUG) {
        console.warn(`Grayscale data size mismatch: expected ${width * height}, got ${grayscaleData.length}`);
      }
      
      return grayscaleData;
      
    } catch (error) {
      console.error('Error converting grayscale to image data:', error);
      throw error;
    }
  }

  function initWebGL() {
    if (!canvas || !grayscaleData) {
      if (DEBUG) console.warn(`⚠️ [WEBGL DEBUG] initWebGL skipped for "${alt}":`, { hasCanvas: !!canvas, hasGrayscaleData: !!grayscaleData, hasRawBytes: !!rawGrayscaleBytes });
      return false;
    }
    
    if (DEBUG) {
      console.log(`🎮 [WEBGL DEBUG] initWebGL starting for "${alt}"`, {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        grayscaleDataLength: grayscaleData?.length,
        rawBytesLength: rawGrayscaleBytes?.length,
        imageWidth: width,
        imageHeight: height,
        expectedBytes: width * height
      });
    }

    try {
      gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        if (DEBUG) console.error('WebGL not supported');
        return false;
      }

      // Create vertex shaders (shared across all programs)
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      if (!vertexShader) return false;

      // Create fragment shaders for each tap variant
      const fragShader1 = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader1Tap);
      const fragShader4 = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader4Tap);
      const fragShader16 = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader16Tap);
      const fragShader36 = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader36Tap);
      
      if (!fragShader1 || !fragShader4 || !fragShader16 || !fragShader36) {
        if (DEBUG) console.error('Failed to compile one or more fragment shader variants');
        return false;
      }

      // Create programs for each variant
      programs.tap1 = createProgram(gl, createShader(gl, gl.VERTEX_SHADER, vertexShaderSource), fragShader1);
      programs.tap4 = createProgram(gl, createShader(gl, gl.VERTEX_SHADER, vertexShaderSource), fragShader4);
      programs.tap16 = createProgram(gl, createShader(gl, gl.VERTEX_SHADER, vertexShaderSource), fragShader16);
      programs.tap36 = createProgram(gl, createShader(gl, gl.VERTEX_SHADER, vertexShaderSource), fragShader36);
      
      if (!programs.tap1 || !programs.tap4 || !programs.tap16 || !programs.tap36) {
        if (DEBUG) console.error('Failed to link one or more shader programs');
        return false;
      }

      // Create downsample program
      const downsampleVertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const downsampleFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, downsampleFragmentShaderSource);
      
      if (!downsampleVertexShader || !downsampleFragmentShader) {
        return false;
      }
      
      downsampleProgram = createProgram(gl, downsampleVertexShader, downsampleFragmentShader);
      
      if (!downsampleProgram) {
        return false;
      }

      // Set up quad geometry (full canvas)
      const positions = new Float32Array([
        -1, -1,  0, 1,
         1, -1,  1, 1,
        -1,  1,  0, 0,
         1,  1,  1, 0,
      ]);

      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      // Set up attribute and uniform locations for all program variants
      function setupProgramLocations(prog, hasMultiSampleUniforms = false) {
        prog.positionLocation = gl.getAttribLocation(prog, 'a_position');
        prog.texCoordLocation = gl.getAttribLocation(prog, 'a_texCoord');
        prog.textureLocation = gl.getUniformLocation(prog, 'u_texture');
        prog.primaryColorLocation = gl.getUniformLocation(prog, 'u_primaryColor');
        prog.secondaryColorLocation = gl.getUniformLocation(prog, 'u_secondaryColor');
        prog.positionBuffer = positionBuffer;
        if (hasMultiSampleUniforms) {
          prog.texelSizeLocation = gl.getUniformLocation(prog, 'u_texelSize');
          prog.downscaleRatioLocation = gl.getUniformLocation(prog, 'u_downscaleRatio');
        }
      }

      // 1-tap doesn't need multi-sample uniforms, others do
      setupProgramLocations(programs.tap1, false);
      setupProgramLocations(programs.tap4, true);
      setupProgramLocations(programs.tap16, true);
      setupProgramLocations(programs.tap36, true);
      
      // Default to 1-tap program initially
      activeProgram = programs.tap1;

      // Get attribute and uniform locations for downsample pass
      const downsamplePositionLocation = gl.getAttribLocation(downsampleProgram, 'a_position');
      const downsampleTexCoordLocation = gl.getAttribLocation(downsampleProgram, 'a_texCoord');
      const framebufferTextureLocation = gl.getUniformLocation(downsampleProgram, 'u_framebufferTexture');

      // Store locations for downsample pass
      downsampleProgram.positionLocation = downsamplePositionLocation;
      downsampleProgram.texCoordLocation = downsampleTexCoordLocation;
      downsampleProgram.framebufferTextureLocation = framebufferTextureLocation;
      downsampleProgram.positionBuffer = positionBuffer;

      // Create and upload grayscale texture
      createGrayscaleTexture();

      // Create framebuffer for 4x rendering
      if (!createFramebuffer()) {
        return false;
      }

      isInitialized = true;
      if (DEBUG) {
        console.log('WebGL adaptive multi-sample renderer initialized', {
          hasGl: !!gl,
          programVariants: Object.keys(programs).filter(k => programs[k]).length,
          hasDownsampleProgram: !!downsampleProgram,
          hasTexture: !!texture,
          hasFramebuffer: !!framebuffer,
          hasFramebufferTexture: !!framebufferTexture
        });
      }
      return true;

    } catch (error) {
      if (DEBUG) console.error('WebGL initialization error:', error);
      return false;
    }
  }

  function createGrayscaleTexture() {
    if (!gl || !programs.tap1 || !grayscaleData) {
      if (DEBUG) console.warn(`[TEXTURE DEBUG] createGrayscaleTexture skipped for "${alt}":`, { hasGl: !!gl, hasPrograms: !!programs.tap1, hasGrayscaleData: !!grayscaleData });
      return;
    }

    try {
      if (DEBUG) {
        console.log(`[TEXTURE DEBUG] Starting texture creation for "${alt}"...`);
        console.log(`[TEXTURE DEBUG] Input data:`, {
          grayscaleDataType: typeof grayscaleData,
          grayscaleDataLength: grayscaleData?.length,
          rawGrayscaleBytesType: rawGrayscaleBytes ? rawGrayscaleBytes.constructor.name : 'null',
          rawGrayscaleBytesLength: rawGrayscaleBytes?.length,
          imageWidth: width,
          imageHeight: height,
          expectedBytes: width * height,
          hasRawBytes: !!(rawGrayscaleBytes && rawGrayscaleBytes instanceof Uint8Array)
        });
        console.log(`[TEXTURE DEBUG] First 100 chars of base64: ${grayscaleData?.substring(0, 100)}`);
      }
      
      // Use raw bytes if available, otherwise convert from base64
      let luminanceData;
      if (rawGrayscaleBytes && rawGrayscaleBytes instanceof Uint8Array) {
        if (DEBUG) console.log(`[TEXTURE DEBUG] Using raw grayscale bytes: ${rawGrayscaleBytes.length} bytes`);
        luminanceData = rawGrayscaleBytes;
      } else {
        if (DEBUG) console.log(`[TEXTURE DEBUG] Converting base64 grayscale data to Uint8Array`);
        let binaryString;
        try {
          binaryString = atob(grayscaleData);
          if (DEBUG) console.log(`[TEXTURE DEBUG] Decoded binary string length: ${binaryString.length}`);
        } catch (atobError) {
          if (DEBUG) {
            console.error(`[TEXTURE DEBUG] atob() failed! Invalid base64 data:`, atobError);
            console.error(`[TEXTURE DEBUG] First 200 chars: ${grayscaleData?.substring(0, 200)}`);
          }
          return;
        }
        luminanceData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          luminanceData[i] = binaryString.charCodeAt(i);
        }
      }

      // Create texture
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      
      // CRITICAL: Set UNPACK_ALIGNMENT to 1 for LUMINANCE textures
      // WebGL defaults to 4-byte alignment, which causes GL_INVALID_OPERATION (1282)
      // when texture width is not divisible by 4 (e.g., 433x433, 427x427)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (DEBUG) console.log(`[TEXTURE DEBUG] Set UNPACK_ALIGNMENT to 1 for ${width}x${height} texture (width % 4 = ${width % 4})`);

      // Validate data size BEFORE uploading to WebGL
      const expectedSize = width * height;
      const actualSize = luminanceData.length;
      
      if (DEBUG) {
        console.log(`📊 Texture data validation:`, {
          width,
          height,
          expectedSize,
          actualSize,
          match: expectedSize === actualSize
        });
      }
      
      if (actualSize !== expectedSize) {
        if (DEBUG) {
          console.error(`[TEXTURE DEBUG] DATA SIZE MISMATCH! Expected ${expectedSize} bytes, got ${actualSize} bytes`);
          console.error(`This will cause WebGL texImage2D to fail!`);
        }
        
        // Try to recover: pad or trim the data
        if (actualSize < expectedSize) {
          if (DEBUG) console.warn(`⚠️ Padding data from ${actualSize} to ${expectedSize} bytes with zeros`);
          const paddedData = new Uint8Array(expectedSize);
          paddedData.set(luminanceData);
          // Fill remaining with middle gray (128) instead of black (0)
          paddedData.fill(128, actualSize);
          luminanceData = paddedData;
        } else {
          if (DEBUG) console.warn(`⚠️ Trimming data from ${actualSize} to ${expectedSize} bytes`);
          luminanceData = luminanceData.slice(0, expectedSize);
        }
      }
      
      // ========== DETAILED LUMINANCE ANALYSIS ==========
      if (DEBUG) {
        let zeroCount = 0;
        let lowCount = 0;   // 1-63
        let midCount = 0;   // 64-191
        let highCount = 0;  // 192-254
        let maxCount = 0;   // 255
        let min = 255, max = 0, sum = 0;
        
        for (let i = 0; i < luminanceData.length; i++) {
          const val = luminanceData[i];
          sum += val;
          if (val < min) min = val;
          if (val > max) max = val;
          
          if (val === 0) zeroCount++;
          else if (val < 64) lowCount++;
          else if (val < 192) midCount++;
          else if (val < 255) highCount++;
          else maxCount++;
        }
        
        const avg = sum / luminanceData.length;
        const zeroPercent = ((zeroCount / luminanceData.length) * 100).toFixed(1);
        const maxPercent = ((maxCount / luminanceData.length) * 100).toFixed(1);
        
        console.log(`📊 [TEXTURE DEBUG] Luminance distribution:`);
        console.log(`   Range: ${min} - ${max}, Average: ${avg.toFixed(1)}`);
        console.log(`   Zero (0): ${zeroCount} (${zeroPercent}%)`);
        console.log(`   Low (1-63): ${lowCount} (${((lowCount / luminanceData.length) * 100).toFixed(1)}%)`);
        console.log(`   Mid (64-191): ${midCount} (${((midCount / luminanceData.length) * 100).toFixed(1)}%)`);
        console.log(`   High (192-254): ${highCount} (${((highCount / luminanceData.length) * 100).toFixed(1)}%)`);
        console.log(`   Max (255): ${maxCount} (${maxPercent}%)`);
        
        // Diagnostic warnings for problematic data
        if (parseFloat(zeroPercent) > 95) {
          console.error(`[TEXTURE DEBUG] PROBLEM DETECTED: ${zeroPercent}% of pixels are ZERO!`);
          console.error(`[TEXTURE DEBUG] This will cause the image to appear as SOLID PRIMARY COLOR!`);
          console.error(`[TEXTURE DEBUG] Likely causes: corrupted data, failed decompression, or incorrect image processing`);
        }
        if (max === min) {
          console.error(`[TEXTURE DEBUG] PROBLEM DETECTED: All pixels have same value (${min})!`);
          console.error(`[TEXTURE DEBUG] This means NO grayscale variation - image will be a solid color!`);
        }
        if (max - min < 10 && luminanceData.length > 100) {
          console.warn(`[TEXTURE DEBUG] Very low contrast: range is only ${min}-${max} (${max - min} levels)`);
        }
      }
      
      // Upload luminance data directly
      gl.texImage2D(
        gl.TEXTURE_2D, 
        0, 
        gl.LUMINANCE, 
        width, 
        height, 
        0, 
        gl.LUMINANCE, 
        gl.UNSIGNED_BYTE, 
        luminanceData
      );
      
      // Check for WebGL errors after texture upload
      const glError = gl.getError();
      if (DEBUG) {
        if (glError !== gl.NO_ERROR) {
          console.error(`[TEXTURE DEBUG] WebGL error after texImage2D: ${glError}`);
        } else {
          console.log(`[TEXTURE DEBUG] texImage2D successful, no WebGL errors`);
        }
      }

      // Set texture parameters for smooth anti-aliasing
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      if (DEBUG) {
        console.log(`[TEXTURE DEBUG] Created grayscale texture: ${width}x${height} (${luminanceData.length} bytes)`);
        
        // Sample some values from the texture to verify
        console.log(`[TEXTURE DEBUG] First 20 luminance values:`, Array.from(luminanceData.slice(0, 20)));
        console.log(`[TEXTURE DEBUG] Middle 20 luminance values:`, Array.from(luminanceData.slice(Math.floor(luminanceData.length / 2), Math.floor(luminanceData.length / 2) + 20)));
        console.log(`[TEXTURE DEBUG] Last 20 luminance values:`, Array.from(luminanceData.slice(-20)));
      }

    } catch (error) {
      if (DEBUG) {
        console.error('[TEXTURE DEBUG] Error creating grayscale texture:', error);
        console.error(`[TEXTURE DEBUG] Stack trace:`, error.stack);
      }
    }
  }

  function createFramebuffer() {
    if (!gl) return;

    try {
      // Clean up existing framebuffer
      if (framebuffer) {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(framebufferTexture);
      }

      // Create framebuffer for 4x resolution rendering
      framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

      // Create texture for framebuffer
      framebufferTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);

      // Set up framebuffer texture
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        renderWidth,
        renderHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );

      // Set texture parameters
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      // Attach texture to framebuffer
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        framebufferTexture,
        0
      );

      // Check framebuffer completeness
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        if (DEBUG) console.error('Framebuffer not complete:', status);
        return false;
      }

      // Unbind framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      if (DEBUG) console.log(`[TEXTURE DEBUG] Created framebuffer: ${renderWidth}x${renderHeight}`);
      return true;

    } catch (error) {
      if (DEBUG) console.error('Error creating framebuffer:', error);
      return false;
    }
  }

  function updateDisplaySize() {
    if (!canvasWrapper || !width || !height) {
      if (DEBUG) console.warn(`[SIZE DEBUG] updateDisplaySize skipped:`, { hasWrapper: !!canvasWrapper, width, height, alt });
      return;
    }

    // Get the actual displayed size of the wrapper element
    const rect = canvasWrapper.getBoundingClientRect();
    
    // Debug: Log container dimensions
    if (DEBUG) {
      console.log(`[SIZE DEBUG] Container rect for "${alt}":`, {
        rectWidth: rect.width,
        rectHeight: rect.height,
        imageWidth: width,
        imageHeight: height,
        isZeroSize: rect.width === 0 || rect.height === 0
      });
    }
    
    // Calculate original image aspect ratio
    const imageAspectRatio = width / height;
    const containerAspectRatio = rect.width / rect.height;
    
    // Size to fit within container while maintaining original aspect ratio
    let targetWidth, targetHeight;
    
    if (imageAspectRatio > containerAspectRatio) {
      // Image is wider - fit to container width
      targetWidth = rect.width;
      targetHeight = rect.width / imageAspectRatio;
    } else {
      // Image is taller - fit to container height
      targetHeight = rect.height;
      targetWidth = rect.height * imageAspectRatio;
    }
    
    const newDisplayWidth = Math.round(targetWidth * window.devicePixelRatio);
    const newDisplayHeight = Math.round(targetHeight * window.devicePixelRatio);
    
    // Calculate 4x render resolution for intermediate framebuffer
    const newRenderWidth = newDisplayWidth * 4;
    const newRenderHeight = newDisplayHeight * 4;

    // Only update if size has changed significantly
    if (Math.abs(newDisplayWidth - displayWidth) > 2 || Math.abs(newDisplayHeight - displayHeight) > 2) {
      displayWidth = Math.max(1, newDisplayWidth);
      displayHeight = Math.max(1, newDisplayHeight);
      renderWidth = Math.max(1, newRenderWidth);
      renderHeight = Math.max(1, newRenderHeight);
      
      // CRITICAL DEBUG: Detect problematic small sizes
      if (DEBUG && (displayWidth < 10 || displayHeight < 10)) {
        console.error(`[SIZE DEBUG] CRITICAL: Very small display size detected for "${alt}"!`, {
          displayWidth,
          displayHeight,
          renderWidth,
          renderHeight,
          rectWidth: rect.width,
          rectHeight: rect.height,
          devicePixelRatio: window.devicePixelRatio
        });
      }

      if (canvas) {
        // Set canvas resolution to high-res render size for anti-aliasing
        canvas.width = renderWidth;
        canvas.height = renderHeight;
        
        if (DEBUG) console.log(`[SIZE DEBUG] High-res rendering for "${alt}": Canvas ${renderWidth}x${renderHeight}, Display ${displayWidth}x${displayHeight}, Original ${width}x${height} (AR: ${imageAspectRatio.toFixed(2)})`);
        
        // Recreate framebuffer with new size
        if (isInitialized) {
          createFramebuffer();
          render();
        }
      }
    }
  }

  function render() {
    // Select the appropriate shader based on current downscale ratio
    const currentProgram = selectShaderProgram();
    
    if (!gl || !currentProgram || !downsampleProgram || !texture || !framebuffer || !framebufferTexture || !isInitialized) {
      if (DEBUG) {
        console.warn(`[RENDER DEBUG] Render skipped for "${alt}" - missing WebGL objects:`, {
          hasGl: !!gl,
          hasProgram: !!currentProgram,
          hasDownsampleProgram: !!downsampleProgram,
          hasTexture: !!texture,
          hasFramebuffer: !!framebuffer,
          hasFramebufferTexture: !!framebufferTexture,
          isInitialized
        });
      }
      return;
    }
    
    // Debug: Log render dimensions (reduced frequency)
    if (DEBUG && currentDownscaleRatio !== lastLoggedRatio) {
      console.log(`[RENDER DEBUG] Rendering "${alt}":`, {
        renderWidth,
        renderHeight,
        displayWidth,
        displayHeight,
        sourceSize: `${width}x${height}`,
        downscaleRatio: currentDownscaleRatio.toFixed(2)
      });
      lastLoggedRatio = currentDownscaleRatio;
    }

    // ========== PASS 1: Render to framebuffer at 4x resolution ==========
    
    // Bind framebuffer and set viewport to 4x resolution
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, renderWidth, renderHeight);

    // Clear framebuffer
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use selected program (based on downscale ratio)
    gl.useProgram(currentProgram);

    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, currentProgram.positionBuffer);
    
    // Set up position attribute
    gl.enableVertexAttribArray(currentProgram.positionLocation);
    gl.vertexAttribPointer(currentProgram.positionLocation, 2, gl.FLOAT, false, 16, 0);
    
    // Set up texture coordinate attribute
    gl.enableVertexAttribArray(currentProgram.texCoordLocation);
    gl.vertexAttribPointer(currentProgram.texCoordLocation, 2, gl.FLOAT, false, 16, 8);

    // Bind source texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(currentProgram.textureLocation, 0);

    // Set theme colors
    const primaryRgb = hexToRgb($imageColors.primary);
    const secondaryRgb = hexToRgb($imageColors.secondary);
    
    gl.uniform3f(currentProgram.primaryColorLocation, primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    gl.uniform3f(currentProgram.secondaryColorLocation, secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]);

    // Set multi-sample uniforms for box filter shaders (if available)
    if (currentProgram.texelSizeLocation) {
      gl.uniform2f(currentProgram.texelSizeLocation, 1.0 / width, 1.0 / height);
    }
    if (currentProgram.downscaleRatioLocation) {
      gl.uniform1f(currentProgram.downscaleRatioLocation, currentDownscaleRatio);
    }

    // Draw quad to framebuffer
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ========== PASS 2: Downsample framebuffer to screen ==========
    
    // Bind back to default framebuffer (screen)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, renderWidth, renderHeight);

    // Clear screen
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use downsample program
    gl.useProgram(downsampleProgram);

    // Bind position buffer (same geometry)
    gl.bindBuffer(gl.ARRAY_BUFFER, downsampleProgram.positionBuffer);
    
    // Set up position attribute
    gl.enableVertexAttribArray(downsampleProgram.positionLocation);
    gl.vertexAttribPointer(downsampleProgram.positionLocation, 2, gl.FLOAT, false, 16, 0);
    
    // Set up texture coordinate attribute
    gl.enableVertexAttribArray(downsampleProgram.texCoordLocation);
    gl.vertexAttribPointer(downsampleProgram.texCoordLocation, 2, gl.FLOAT, false, 16, 8);

    // Bind framebuffer texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);
    gl.uniform1i(downsampleProgram.framebufferTextureLocation, 0);

    // Draw downsampled quad to screen
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function startRenderLoop() {
    function loop() {
      // Only render if colors have changed or initial render
      const newPrimary = $imageColors.primary;
      const newSecondary = $imageColors.secondary;
      
      if (newPrimary !== currentPrimaryColor || newSecondary !== currentSecondaryColor) {
        currentPrimaryColor = newPrimary;
        currentSecondaryColor = newSecondary;
        render();
      }
      
      animationId = requestAnimationFrame(loop);
    }
    
    loop();
  }

  function stopRenderLoop() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  // Fallback canvas rendering for non-WebGL browsers
  function renderFallback() {
    if (!canvas || !grayscaleData) return;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas resolution to high-res render size for anti-aliasing
      canvas.width = renderWidth;
      canvas.height = renderHeight;

      // Convert grayscale data to ImageData with theme colors
      const imageData = grayscaleDataToImageData(grayscaleData, width, height);
      
      // Create a temporary canvas for the source image
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext('2d');
      
      const tempImageData = tempCtx.createImageData(width, height);
      const tempData = tempImageData.data;

      const primary = hexToRgb($imageColors.primary);
      const secondary = hexToRgb($imageColors.secondary);

      for (let i = 0; i < imageData.length; i++) {
        const grayscaleValue = imageData[i] / 255; // Normalize to 0-1
        const color = [
          primary[0] * (1 - grayscaleValue) + secondary[0] * grayscaleValue,
          primary[1] * (1 - grayscaleValue) + secondary[1] * grayscaleValue,
          primary[2] * (1 - grayscaleValue) + secondary[2] * grayscaleValue
        ];
        const pixelIndex = i * 4;

        tempData[pixelIndex] = color[0] * 255;     // R
        tempData[pixelIndex + 1] = color[1] * 255; // G
        tempData[pixelIndex + 2] = color[2] * 255; // B
        tempData[pixelIndex + 3] = 255;           // A
      }

      tempCtx.putImageData(tempImageData, 0, 0);

      // Scale and draw to main canvas with smooth anti-aliasing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, displayWidth, displayHeight);

      if (DEBUG) console.log(`[INIT DEBUG] Rendered with Canvas 2D fallback at 4x: ${displayWidth}x${displayHeight}`);

    } catch (error) {
      if (DEBUG) console.error('Canvas 2D fallback render error:', error);
    }
  }

  // Helper function to initialize WebGL with safeguards
  function initializeRenderer() {
    if (DEBUG) {
      console.log(`[INIT DEBUG] initializeRenderer called for "${alt}"`, {
        hasCanvas: !!canvas,
        hasGrayscaleData: !!grayscaleData,
        grayscaleDataLength: grayscaleData?.length,
        hasRawBytes: !!rawGrayscaleBytes,
        isInitialized,
        displayWidth,
        displayHeight
      });
    }
    
    if (isInitialized) {
      stopRenderLoop();
    }
    
    // Update display size before initializing
    updateDisplaySize();
    
    // SAFEGUARD: If display size is too small, defer initialization
    // This can happen if the container hasn't been laid out yet
    if (displayWidth < 10 || displayHeight < 10) {
      if (DEBUG) console.warn(`[INIT DEBUG] Display size too small for "${alt}" (${displayWidth}x${displayHeight}), deferring...`);
      // Schedule a retry after the next frame when layout should be complete
      requestAnimationFrame(() => {
        updateDisplaySize();
        if (DEBUG) console.log(`[INIT DEBUG] Retry after RAF for "${alt}":`, { displayWidth, displayHeight });
        if (displayWidth >= 10 && displayHeight >= 10) {
          if (initWebGL()) {
            startRenderLoop();
          } else {
            if (DEBUG) console.warn('[INIT DEBUG] WebGL failed, using Canvas 2D fallback');
            renderFallback();
          }
        } else {
          if (DEBUG) console.error(`[INIT DEBUG] Still too small after RAF for "${alt}", forcing minimum size`);
          // Force minimum size of 50x50 for safety
          displayWidth = 50;
          displayHeight = 50;
          renderWidth = 200;
          renderHeight = 200;
          if (canvas) {
            canvas.width = renderWidth;
            canvas.height = renderHeight;
          }
          if (initWebGL()) {
            startRenderLoop();
          } else {
            renderFallback();
          }
        }
      });
      return;
    }
    
    // Try WebGL first, fallback to Canvas 2D
    if (initWebGL()) {
      startRenderLoop();
    } else {
      if (DEBUG) console.warn('[INIT DEBUG] WebGL failed, using Canvas 2D fallback');
      renderFallback();
      
      // Watch for theme changes in fallback mode
      const unsubscribe = imageColors.subscribe(() => {
        renderFallback();
      });
      
      onDestroy(() => {
        unsubscribe();
      });
    }
  }

  // Initialize when component mounts and when grayscale data changes
  $: if (canvas && grayscaleData) {
    initializeRenderer();
  }

  onMount(() => {
    // Set up ResizeObserver to watch for size changes
    if (canvasWrapper && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        updateDisplaySize();
      });
      resizeObserver.observe(canvasWrapper);
    }

    // Initial size setup
    updateDisplaySize();
  });

  onDestroy(() => {
    stopRenderLoop();
    
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    
    if (gl) {
      if (texture) gl.deleteTexture(texture);
      if (framebufferTexture) gl.deleteTexture(framebufferTexture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      // Delete all program variants
      Object.values(programs).forEach(prog => {
        if (prog) gl.deleteProgram(prog);
      });
      if (downsampleProgram) gl.deleteProgram(downsampleProgram);
    }
  });
</script>

<!-- Wrapper div for border-radius clipping -->
<div bind:this={canvasWrapper} class="canvas-wrapper {className}" style="border-radius: {borderRadius};">
  <canvas
    bind:this={canvas}
    {alt}
    class="grayscale-image-canvas"
    style="width: {displayWidth / (window.devicePixelRatio || 1)}px; height: {displayHeight / (window.devicePixelRatio || 1)}px;"
  />
</div>

<style>
  .canvas-wrapper {
    position: relative;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  
  .grayscale-image-canvas {
    display: block;
    /* Use smooth/auto rendering to allow browser to interpolate canvas scaling */
    /* The box filter in the shader handles proper downsampling of the source image */
    image-rendering: auto;
    image-rendering: smooth;
    image-rendering: high-quality;
    -webkit-font-smoothing: antialiased;
  }
</style>
