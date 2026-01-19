/**
 * Cloudflare Worker - Image Proxy for Genius Images
 * Bypasses Google Cloud IP blocking by using Cloudflare's edge network
 * 
 * Usage: https://your-worker.workers.dev?url=<encoded-image-url>&key=<auth-key>
 */

// Rotate through different User-Agent strings to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Delay helper for retries
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

      // Retry logic with exponential backoff
      const MAX_RETRIES = 3;
      let lastError = null;
      
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const backoffMs = 500 * Math.pow(2, attempt - 1);
          console.log(`Retry attempt ${attempt + 1}/${MAX_RETRIES} after ${backoffMs}ms delay`);
          await delay(backoffMs);
        }
        
        try {
          // Fetch image with browser-like headers to avoid blocking
          const imageResponse = await fetch(imageUrl, {
            headers: {
              'User-Agent': getRandomUserAgent(),
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'Referer': 'https://genius.com/',
              'Origin': 'https://genius.com',
              'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"macOS"',
              'Sec-Fetch-Dest': 'image',
              'Sec-Fetch-Mode': 'no-cors',
              'Sec-Fetch-Site': 'cross-site',
              'Pragma': 'no-cache',
              'Cache-Control': 'no-cache',
            },
            // Use Cloudflare cache for frequently accessed images
            cf: {
              cacheTtl: 86400, // Cache for 24 hours
              cacheEverything: true
            }
          });

          if (imageResponse.ok) {
            // Success - return the image
            const imageData = await imageResponse.arrayBuffer();
            const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

            console.log(`Successfully fetched image (${imageData.byteLength} bytes) on attempt ${attempt + 1}`);
            
            return new Response(imageData, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=86400',
                'X-Proxy-Status': 'success',
                'X-Proxy-Attempts': String(attempt + 1)
              }
            });
          }
          
          // Handle specific error codes
          if (imageResponse.status === 403) {
            console.error(`403 Forbidden on attempt ${attempt + 1} - Genius may be rate limiting`);
            lastError = `403 Forbidden (attempt ${attempt + 1})`;
            // Continue to retry
          } else if (imageResponse.status === 429) {
            console.error(`429 Too Many Requests on attempt ${attempt + 1}`);
            lastError = `429 Too Many Requests (attempt ${attempt + 1})`;
            // Continue to retry with longer backoff
          } else if (imageResponse.status === 404) {
            // Image not found - don't retry
            console.error(`404 Not Found - image does not exist: ${imageUrl}`);
            return new Response(`Image not found: ${imageResponse.status}`, {
              status: 404,
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'text/plain'
              }
            });
          } else {
            lastError = `${imageResponse.status} ${imageResponse.statusText}`;
            console.error(`Failed to fetch image: ${lastError}`);
          }
          
        } catch (fetchError) {
          lastError = fetchError.message;
          console.error(`Fetch error on attempt ${attempt + 1}: ${fetchError.message}`);
        }
      }
      
      // All retries exhausted
      console.error(`All ${MAX_RETRIES} attempts failed. Last error: ${lastError}`);
      return new Response(`Failed to fetch image after ${MAX_RETRIES} attempts: ${lastError}`, {
        status: 502, // Bad Gateway - upstream server error
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'text/plain',
          'X-Proxy-Attempts': String(MAX_RETRIES)
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

