<!--
  Binary Image WebGL Renderer
  Renders 1-bit binary image data with dynamic theme colors
  Optimized for performance and instant theme changes
-->

<script>
  import { onMount, onDestroy } from 'svelte';
  import { imageColors } from '$lib/services/store.js';

  export let binaryData = ''; // Base64 encoded binary image data
  export let width = 200;
  export let height = 200;
  export let alt = 'Binary rendered image';
  
  // Allow custom CSS class to be passed in
  let className = '';
  export { className as class };

  let canvas;
  let gl;
  let program;
  let texture;
  let animationId;
  let currentPrimaryColor = '';
  let currentSecondaryColor = '';
  let isInitialized = false;

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

  // Fragment shader - maps binary data to theme colors
  const fragmentShaderSource = `
    precision mediump float;
    
    uniform sampler2D u_texture;
    uniform vec3 u_primaryColor;   // Dark pixels (0 bits)
    uniform vec3 u_secondaryColor; // Light pixels (1 bits)
    
    varying vec2 v_texCoord;
    
    void main() {
      // Sample the binary texture (stored as grayscale)
      float binaryValue = texture2D(u_texture, v_texCoord).r;
      
      // Map binary value to theme colors
      // 0.0 = dark (primary), 1.0 = light (secondary)
      vec3 color = mix(u_primaryColor, u_secondaryColor, binaryValue);
      
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

  function binaryDataToImageData(binaryBase64, width, height) {
    try {
      // Decode base64 to binary data
      const binaryString = atob(binaryBase64);
      const binaryData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        binaryData[i] = binaryString.charCodeAt(i);
      }
      
      // Create grayscale image data from binary (for WebGL texture)
      const imageData = new Uint8Array(width * height);
      
      for (let i = 0; i < width * height; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitPosition = 7 - (i % 8);
        const isLight = (binaryData[byteIndex] & (1 << bitPosition)) !== 0;
        
        // Store as grayscale: 0 = dark, 255 = light
        imageData[i] = isLight ? 255 : 0;
      }
      
      return imageData;
      
    } catch (error) {
      console.error('Error converting binary to image data:', error);
      throw error;
    }
  }

  function initWebGL() {
    if (!canvas || !binaryData) return false;

    try {
      gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        console.error('WebGL not supported');
        return false;
      }

      // Create shaders
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
      
      if (!vertexShader || !fragmentShader) {
        return false;
      }

      // Create program
      program = createProgram(gl, vertexShader, fragmentShader);
      
      if (!program) {
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

      // Get attribute and uniform locations
      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
      const textureLocation = gl.getUniformLocation(program, 'u_texture');
      const primaryColorLocation = gl.getUniformLocation(program, 'u_primaryColor');
      const secondaryColorLocation = gl.getUniformLocation(program, 'u_secondaryColor');

      // Store locations for later use
      program.positionLocation = positionLocation;
      program.texCoordLocation = texCoordLocation;
      program.textureLocation = textureLocation;
      program.primaryColorLocation = primaryColorLocation;
      program.secondaryColorLocation = secondaryColorLocation;
      program.positionBuffer = positionBuffer;

      // Create and upload binary texture
      createBinaryTexture();

      isInitialized = true;
      console.log('✅ WebGL binary image renderer initialized');
      return true;

    } catch (error) {
      console.error('WebGL initialization error:', error);
      return false;
    }
  }

  function createBinaryTexture() {
    if (!gl || !program || !binaryData) return;

    try {
      // Convert binary data to grayscale image data
      const imageData = binaryDataToImageData(binaryData, width, height);

      // Create texture
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      // Upload image data
      gl.texImage2D(
        gl.TEXTURE_2D, 
        0, 
        gl.LUMINANCE, 
        width, 
        height, 
        0, 
        gl.LUMINANCE, 
        gl.UNSIGNED_BYTE, 
        imageData
      );

      // Set texture parameters
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      console.log(`🖼️  Created binary texture: ${width}x${height}`);

    } catch (error) {
      console.error('Error creating binary texture:', error);
    }
  }

  function render() {
    if (!gl || !program || !texture || !isInitialized) return;

    // Set viewport
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Clear canvas
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use program
    gl.useProgram(program);

    // Bind position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, program.positionBuffer);
    
    // Set up position attribute
    gl.enableVertexAttribArray(program.positionLocation);
    gl.vertexAttribPointer(program.positionLocation, 2, gl.FLOAT, false, 16, 0);
    
    // Set up texture coordinate attribute
    gl.enableVertexAttribArray(program.texCoordLocation);
    gl.vertexAttribPointer(program.texCoordLocation, 2, gl.FLOAT, false, 16, 8);

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.textureLocation, 0);

    // Set theme colors
    const primaryRgb = hexToRgb($imageColors.primary);
    const secondaryRgb = hexToRgb($imageColors.secondary);
    
    gl.uniform3f(program.primaryColorLocation, primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    gl.uniform3f(program.secondaryColorLocation, secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]);

    // Draw quad
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
    if (!canvas || !binaryData) return;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Convert binary data to ImageData with theme colors
      const imageData = binaryDataToImageData(binaryData, width, height);
      const canvasImageData = ctx.createImageData(width, height);
      const data = canvasImageData.data;

      const primary = hexToRgb($imageColors.primary);
      const secondary = hexToRgb($imageColors.secondary);

      for (let i = 0; i < imageData.length; i++) {
        const isLight = imageData[i] === 255;
        const color = isLight ? secondary : primary;
        const pixelIndex = i * 4;

        data[pixelIndex] = color[0] * 255;     // R
        data[pixelIndex + 1] = color[1] * 255; // G
        data[pixelIndex + 2] = color[2] * 255; // B
        data[pixelIndex + 3] = 255;           // A
      }

      ctx.putImageData(canvasImageData, 0, 0);
      console.log('🔄 Rendered with Canvas 2D fallback');

    } catch (error) {
      console.error('Canvas 2D fallback render error:', error);
    }
  }

  // Initialize when component mounts and when binary data changes
  $: if (canvas && binaryData) {
    if (isInitialized) {
      stopRenderLoop();
    }
    
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
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  });

  onDestroy(() => {
    stopRenderLoop();
    
    if (gl) {
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
    }
  });
</script>

<!-- Wrapper div for border-radius clipping -->
<div class="canvas-wrapper {className}">
  <canvas
    bind:this={canvas}
    width={width}
    height={height}
    {alt}
    class="binary-image-canvas"
  />
</div>

<style>
  .canvas-wrapper {
    display: block;
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
    border-radius: 25%;
    overflow: hidden;
    object-fit: cover;
  }
  
  .binary-image-canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: -moz-crisp-edges;
    image-rendering: -webkit-crisp-edges;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
</style>
