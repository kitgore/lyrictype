# Image Recoloring Test Tool

## Access the Tool

Navigate to: **`http://localhost:5173/image-test`** (or your dev URL)

## Purpose

This tool helps diagnose image recoloring issues by:
1. Loading artist image data from Firestore OR processing any standalone image URL
2. Displaying detailed debug information about the image data
3. Testing real-time recoloring with different color combinations
4. Validating data integrity (size, format, compression)

## How to Use

### 1. Choose Test Mode

**Test Artist (from database)**: Load an artist's cached image from Firestore
**Test URL (standalone image)**: Process any image URL directly, without needing a database entry

### 2. Load an Image

#### Artist Mode:
**Artist URL Key**: Enter the artist's Firestore document ID
- Examples: `410`, `10-years`, `917-rackz`, `cheema-y`, `el-jordan-23`
- Will load cached data if available

#### URL Mode:
**Image URL**: Paste any image URL (Genius or otherwise)
- Example: `https://images.genius.com/831c17328ec74439f5d3614c461e3cf8.499x499x1.jpg`
- Will process the image fresh through the Firebase function
- Does not save to database (test only)

Click **"Load & Test"** or **"Process & Test"** to fetch/process the image data

### 3. Review Debug Information (Left Panel)

**Status Section:**
- ✅/❌ **Success**: Whether the image loaded successfully
- **Cached**: Whether using cached data or freshly processed
- **Dimensions**: Image width × height
- **Expected Bytes**: How many bytes should be in the image (width × height)

**Data Validation Section:**
- **Has Grayscale Data**: Confirms Base64 grayscale data exists
- **Has Raw Bytes**: Confirms Uint8Array raw bytes exist (needed for WebGL)
- **Grayscale Data Length**: Size of Base64 string
- **Raw Bytes Length**: Actual byte count
- **Size Match**: ✅ if actual bytes = expected bytes, ❌ if mismatch

**Processing Info Section:**
- **Compression Method**: Should be `pako-deflate` for new images
- **Processing Version**: Should be `2.0-grayscale` for new images
- **Original URL**: The Genius image URL used

**Sample Data:**
- First 10 bytes of grayscale data (to verify it's not all zeros/corrupted)

### 4. Test Color Recoloring (Right Panel)

**Manual Color Selection:**
- Use color pickers or type hex codes
- **Primary (Dark)**: Color for dark pixels (low grayscale values)
- **Secondary (Light)**: Color for light pixels (high grayscale values)
- Changes apply in real-time

**Preset Buttons:**
- **Black/White**: Default theme
- **White/Black**: Inverted
- **Red/Yellow**: High contrast test
- **Blue/Pink**: Vibrant test
- **Green/Cyan**: Another vibrant test

**Rendered Result:**
- Shows the actual rendered image with current colors
- Should update instantly when you change colors
- Uses the same `GrayscaleImageRenderer` component as the main app

## What to Look For

### Signs of Success ✅
- All checkmarks in the Status section
- Size Match shows "✅ Match"
- Raw Bytes Length equals Expected Bytes
- Image renders clearly
- Changing colors updates the image instantly
- Sample bytes show varied values (not all zeros)

### Signs of Problems ❌

**Data Size Mismatch:**
```
Size Match: ❌ Mismatch
Raw Bytes Length: 360,000 bytes
Expected Bytes: 1,000,000 bytes
```
- **Cause**: Corrupted cached data
- **Solution**: Image will auto-reprocess on main app load

**No Raw Bytes:**
```
Has Raw Bytes: ❌ No
Size Match: ⚠️ No raw bytes to check
```
- **Cause**: Decompression failure or old format
- **Solution**: Check console for decompression errors

**Image Not Rendering:**
- Check if "Has Grayscale Data" and "Has Raw Bytes" are both ✅
- Look at Sample Data - if all zeros, data is corrupted
- Check browser console for WebGL errors

**Image Not Recoloring:**
- If image appears but doesn't change colors:
  - Check console for WebGL errors
  - Try a preset button (forces color update)
  - Look for "Render skipped" warnings in console

## Testing Specific Artists

### Artist Mode Examples

**410 (Previously had issues)**
```
Mode: Test Artist
Artist URL Key: 410
Expected Result: Should show size mismatch detection and auto-reprocess
```

**10 Years**
```
Mode: Test Artist
Artist URL Key: 10-years
Expected Result: Should load and recolor properly
```

**917 Rackz (Had unsupported format error)**
```
Mode: Test Artist
Artist URL Key: 917-rackz
Expected Result: Should show successful processing after retry
```

**Cheema Y (Working reference)**
```
Mode: Test Artist
Artist URL Key: cheema-y
Expected Result: Should work perfectly, use as baseline
```

### URL Mode Examples

**Test any Genius image**
```
Mode: Test URL
Image URL: https://images.genius.com/831c17328ec74439f5d3614c461e3cf8.499x499x1.jpg
Expected Result: Fresh processing, should recolor properly
```

**Test problematic format (WebP)**
```
Mode: Test URL
Image URL: https://images.genius.com/[any-webp-url].webp
Expected Result: Should retry with .jpg alternative
```

**Test external image**
```
Mode: Test URL
Image URL: https://example.com/any-image.jpg
Expected Result: Should process and recolor any valid image
```

## Console Logging

The tool adds `🧪 TEST:` prefix to all its console logs for easy filtering.

Key logs to watch:
- `🧪 TEST: Loading image for artist: [name]`
- `🧪 TEST: Result received: [object]`
- `🧪 TEST: Debug info: [object]`

## Common Issues and Fixes

### Issue: "Error: No image data available"
- **Cause**: Artist not in Firestore or has no imageUrl
- **Fix**: Make sure artist exists and has been processed once in main app

### Issue: "Error: Decompression failed"
- **Cause**: Corrupted compressed data
- **Fix**: Will auto-trigger reprocessing

### Issue: WebGL context errors
- **Cause**: Too many WebGL contexts (browser limit)
- **Fix**: Refresh the page before testing multiple artists

### Issue: Colors not changing
- **Cause**: Render loop not running or WebGL failure
- **Fix**: Check browser console for errors, try refreshing

## Tips for Effective Testing

1. **Test known working artists first** (like Cheema Y) to establish a baseline
2. **Compare debug info** between working and non-working artists
3. **Watch the console** for detailed logging about what's happening
4. **Try extreme color combinations** (like pure red/blue) to make issues more obvious
5. **Test immediately after** visiting the main app to ensure cache is fresh
6. **Clear browser cache** if you want to force fresh processing

## Exit and Return

Simply navigate back to your main app or close the tab.
The test tool is completely independent and won't affect your main app state.

