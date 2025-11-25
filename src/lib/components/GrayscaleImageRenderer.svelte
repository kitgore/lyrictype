<!--
  Grayscale Image WebGL Renderer
  Renders 8-bit grayscale image data with dynamic theme colors
  Optimized for performance and instant theme changes
-->

<script>
  import { onMount, onDestroy } from 'svelte';
  import { imageColors } from '$lib/services/store.js';

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
  let program;
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

  // Fragment shader - maps grayscale data to theme colors (Pass 1)
  const fragmentShaderSource = `
    precision mediump float;
    
    uniform sampler2D u_texture;
    uniform vec3 u_primaryColor;   // Dark pixels (low grayscale values)
    uniform vec3 u_secondaryColor; // Light pixels (high grayscale values)
    
    varying vec2 v_texCoord;
    
    void main() {
      // Sample the grayscale texture (8-bit values normalized to 0.0-1.0)
      float grayscaleValue = texture2D(u_texture, v_texCoord).r;
      
      // Map grayscale value to theme colors
      // 0.0 = dark (primary), 1.0 = light (secondary)
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
      console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
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
      console.error('Program linking error:', gl.getProgramInfoLog(program));
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
      if (grayscaleData.length !== width * height) {
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
      console.warn('⚠️ initWebGL skipped:', { hasCanvas: !!canvas, hasGrayscaleData: !!grayscaleData, hasRawBytes: !!rawGrayscaleBytes });
      return false;
    }

    try {
      gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        console.error('WebGL not supported');
        return false;
      }

      // Create shaders for both passes
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
      const downsampleVertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const downsampleFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, downsampleFragmentShaderSource);
      
      if (!vertexShader || !fragmentShader || !downsampleVertexShader || !downsampleFragmentShader) {
        return false;
      }

      // Create programs
      program = createProgram(gl, vertexShader, fragmentShader);
      downsampleProgram = createProgram(gl, downsampleVertexShader, downsampleFragmentShader);
      
      if (!program || !downsampleProgram) {
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

      // Get attribute and uniform locations for first pass
      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
      const textureLocation = gl.getUniformLocation(program, 'u_texture');
      const primaryColorLocation = gl.getUniformLocation(program, 'u_primaryColor');
      const secondaryColorLocation = gl.getUniformLocation(program, 'u_secondaryColor');

      // Store locations for first pass
      program.positionLocation = positionLocation;
      program.texCoordLocation = texCoordLocation;
      program.textureLocation = textureLocation;
      program.primaryColorLocation = primaryColorLocation;
      program.secondaryColorLocation = secondaryColorLocation;
      program.positionBuffer = positionBuffer;

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
      console.log('✅ WebGL two-pass grayscale image renderer initialized', {
        hasGl: !!gl,
        hasProgram: !!program,
        hasDownsampleProgram: !!downsampleProgram,
        hasTexture: !!texture,
        hasFramebuffer: !!framebuffer,
        hasFramebufferTexture: !!framebufferTexture
      });
      return true;

    } catch (error) {
      console.error('WebGL initialization error:', error);
      return false;
    }
  }

  function createGrayscaleTexture() {
    if (!gl || !program || !grayscaleData) {
      console.warn('⚠️ createGrayscaleTexture skipped:', { hasGl: !!gl, hasProgram: !!program, hasGrayscaleData: !!grayscaleData });
      return;
    }

    try {
      // Use raw bytes if available, otherwise convert from base64
      let luminanceData;
      if (rawGrayscaleBytes && rawGrayscaleBytes instanceof Uint8Array) {
        console.log(`🚀 Using raw grayscale bytes: ${rawGrayscaleBytes.length} bytes`);
        luminanceData = rawGrayscaleBytes;
      } else {
        console.log(`🔄 Converting base64 grayscale data to Uint8Array`);
        const binaryString = atob(grayscaleData);
        luminanceData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          luminanceData[i] = binaryString.charCodeAt(i);
        }
      }

      // Create texture
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      // Validate data size BEFORE uploading to WebGL
      const expectedSize = width * height;
      const actualSize = luminanceData.length;
      
      console.log(`📊 Texture data validation:`, {
        width,
        height,
        expectedSize,
        actualSize,
        match: expectedSize === actualSize
      });
      
      if (actualSize !== expectedSize) {
        console.error(`❌ DATA SIZE MISMATCH! Expected ${expectedSize} bytes, got ${actualSize} bytes`);
        console.error(`This will cause WebGL texImage2D to fail!`);
        
        // Try to recover: pad or trim the data
        if (actualSize < expectedSize) {
          console.warn(`⚠️ Padding data from ${actualSize} to ${expectedSize} bytes with zeros`);
          const paddedData = new Uint8Array(expectedSize);
          paddedData.set(luminanceData);
          // Fill remaining with middle gray (128) instead of black (0)
          paddedData.fill(128, actualSize);
          luminanceData = paddedData;
        } else {
          console.warn(`⚠️ Trimming data from ${actualSize} to ${expectedSize} bytes`);
          luminanceData = luminanceData.slice(0, expectedSize);
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

      // Set texture parameters for smooth anti-aliasing
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      console.log(`🖼️  Created grayscale texture: ${width}x${height} (${luminanceData.length} bytes)`);
      
      // Sample some values from the texture to verify
      console.log(`🔍 First 20 luminance values:`, Array.from(luminanceData.slice(0, 20)));
      console.log(`🔍 Middle 20 luminance values:`, Array.from(luminanceData.slice(Math.floor(luminanceData.length / 2), Math.floor(luminanceData.length / 2) + 20)));
      console.log(`🔍 Last 20 luminance values:`, Array.from(luminanceData.slice(-20)));

    } catch (error) {
      console.error('Error creating grayscale texture:', error);
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
        console.error('Framebuffer not complete:', status);
        return false;
      }

      // Unbind framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      console.log(`🖼️  Created framebuffer: ${renderWidth}x${renderHeight}`);
      return true;

    } catch (error) {
      console.error('Error creating framebuffer:', error);
      return false;
    }
  }

  function updateDisplaySize() {
    if (!canvasWrapper || !width || !height) return;

    // Get the actual displayed size of the wrapper element
    const rect = canvasWrapper.getBoundingClientRect();
    
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

      if (canvas) {
        // Set canvas resolution to high-res render size for anti-aliasing
        canvas.width = renderWidth;
        canvas.height = renderHeight;
        
        console.log(`📐 High-res rendering: Canvas ${renderWidth}x${renderHeight}, Display ${displayWidth}x${displayHeight}, Original ${width}x${height} (AR: ${imageAspectRatio.toFixed(2)})`);
        
        // Recreate framebuffer with new size
        if (isInitialized) {
          createFramebuffer();
          render();
        }
      }
    }
  }

  function render() {
    if (!gl || !program || !downsampleProgram || !texture || !framebuffer || !framebufferTexture || !isInitialized) {
      console.warn('❌ Render skipped - missing WebGL objects:', {
        hasGl: !!gl,
        hasProgram: !!program,
        hasDownsampleProgram: !!downsampleProgram,
        hasTexture: !!texture,
        hasFramebuffer: !!framebuffer,
        hasFramebufferTexture: !!framebufferTexture,
        isInitialized
      });
      return;
    }

    // ========== PASS 1: Render to framebuffer at 4x resolution ==========
    
    // Bind framebuffer and set viewport to 4x resolution
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, renderWidth, renderHeight);

    // Clear framebuffer
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use first pass program
    gl.useProgram(program);

    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, program.positionBuffer);
    
    // Set up position attribute
    gl.enableVertexAttribArray(program.positionLocation);
    gl.vertexAttribPointer(program.positionLocation, 2, gl.FLOAT, false, 16, 0);
    
    // Set up texture coordinate attribute
    gl.enableVertexAttribArray(program.texCoordLocation);
    gl.vertexAttribPointer(program.texCoordLocation, 2, gl.FLOAT, false, 16, 8);

    // Bind binary texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.textureLocation, 0);

    // Set theme colors
    const primaryRgb = hexToRgb($imageColors.primary);
    const secondaryRgb = hexToRgb($imageColors.secondary);
    
    gl.uniform3f(program.primaryColorLocation, primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    gl.uniform3f(program.secondaryColorLocation, secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]);

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

      console.log(`🔄 Rendered with Canvas 2D fallback at 4x: ${displayWidth}x${displayHeight}`);

    } catch (error) {
      console.error('Canvas 2D fallback render error:', error);
    }
  }

  // Initialize when component mounts and when grayscale data changes
  $: if (canvas && grayscaleData) {
    if (isInitialized) {
      stopRenderLoop();
    }
    
    // Update display size before initializing
    updateDisplaySize();
    
    // Try WebGL first, fallback to Canvas 2D
    if (initWebGL()) {
      startRenderLoop();
    } else {
      console.warn('🔄 WebGL failed, using Canvas 2D fallback');
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
      if (program) gl.deleteProgram(program);
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
    image-rendering: -moz-crisp-edges;
    image-rendering: -webkit-crisp-edges;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
</style>
