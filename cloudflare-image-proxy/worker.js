/**
 * Cloudflare Worker - Image Proxy for Genius Images
 * Bypasses Google Cloud IP blocking by using Cloudflare's edge network
 * 
 * Usage: https://your-worker.workers.dev?url=<encoded-image-url>&key=<auth-key>
 */

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    try {
      // Parse query parameters
      const url = new URL(request.url);
      const imageUrl = url.searchParams.get('url');
      const authKey = url.searchParams.get('key');

      // Validate authentication key
      // After deployment, set this in Cloudflare dashboard: Settings > Variables > Environment Variables
      // Variable name: AUTH_KEY
      const expectedKey = env.AUTH_KEY || 'your-secret-key-change-this';
      
      if (!authKey || authKey !== expectedKey) {
        return new Response('Unauthorized', { 
          status: 401,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'text/plain'
          }
        });
      }

      // Validate image URL
      if (!imageUrl) {
        return new Response('Missing url parameter', { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'text/plain'
          }
        });
      }

      // Only allow Genius image URLs (security measure)
      if (!imageUrl.includes('images.genius.com')) {
        return new Response('Invalid image URL - only images.genius.com allowed', { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'text/plain'
          }
        });
      }

      console.log(`Proxying image: ${imageUrl}`);

      // Fetch image with browser-like headers to avoid blocking
      const imageResponse = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://genius.com/',
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'same-site'
        },
        // Use Cloudflare cache for frequently accessed images
        cf: {
          cacheTtl: 86400, // Cache for 24 hours
          cacheEverything: true
        }
      });

      if (!imageResponse.ok) {
        console.error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
        return new Response(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`, {
          status: imageResponse.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'text/plain'
          }
        });
      }

      // Return image with CORS headers
      const imageData = await imageResponse.arrayBuffer();
      const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

      return new Response(imageData, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
          'X-Proxy-Status': 'success'
        }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(`Proxy error: ${error.message}`, {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/plain'
        }
      });
    }
  }
};

