// src/lib/services/queueManager.js
import { loadArtistForQueue, loadSongsForNavigation } from './artistService.js';
import { writable, derived, get } from 'svelte/store';
import { maxDisplayedLines } from './store.js';
import { parseLyricSections, pickStartAnchor } from '$lib/utils/lyricSections.js';

/* -------------------- Reactive stores -------------------- */
// Full queue (all songs)
export const queueSongs = writable([]);
// Current queue position
export const queueIndex = writable(0);
// Reactive "next 5" (or fewer) based on both songs and index
export const queueUpcomingSongs = derived(
  [queueSongs, queueIndex],
  ([$songs, $index]) => $songs.slice($index + 1, Math.min($songs.length, $index + 6))
);

/**
 * New Queue Manager that integrates with the caching system
 * This replaces the legacy queue functionality with cache-aware operations
 */
export class CacheAwareQueueManager {
    constructor() {
        this.songs = [];
        this.currentIndex = 0;
        this.artistUrlKey = null;
        this.artistData = null;
        this.songIds = []; // Master list from Firebase
        this.loadedSongs = new Map(); // Cache of loaded song data
        this.isLoading = false;
        this.preloadRadius = 5; // Number of songs to keep loaded around current position
    }

    // Push queue changes to Svelte stores so the UI can update reactively
    broadcast() {
        // new array ref so Svelte notices changes to items
        queueSongs.set([...this.songs]);
        queueIndex.set(this.currentIndex);
    }

    /**
     * Parse section markers, build content-line view of the song, and pick a
     * random section-aligned start anchor. Stored on the song so navigating
     * back reuses the same anchor.
     *   fullLyrics:            raw lyrics including [Verse]/(Chorus) markers
     *   contentLyrics:         marker lines stripped, joined with \n
     *   sectionAnchors:        content-line indices where each section starts
     *   startContentLineIndex: where the typing window initially begins
     */
    ensureSongDisplayData(song) {
        if (!song || !song.lyrics || typeof song.lyrics !== 'string') return song;
        if (song.sectionAnchors && typeof song.contentLyrics === 'string') return song;

        const raw = song.fullLyrics || song.lyrics;
        const { contentLines, anchors } = parseLyricSections(raw);
        if (contentLines.length === 0) return song;

        const maxLines = get(maxDisplayedLines);
        const startContentLineIndex = pickStartAnchor(contentLines.length, anchors, maxLines);

        song.fullLyrics = raw;
        song.contentLyrics = contentLines.join('\n');
        song.sectionAnchors = anchors;
        song.startContentLineIndex = startContentLineIndex;
        // back-compat: callers that read song.lyrics see the marker-stripped
        // full content rather than a pre-windowed excerpt
        song.lyrics = song.contentLyrics;
        song.displayLyrics = song.contentLyrics;
        console.log(`Song "${song.title}" — ${contentLines.length} content lines, ${anchors.length} anchors, start=${startContentLineIndex}`);

        return song;
    }

    /**
     * Initialize queue with a new artist
     * Step 1 of your queue process: Check if songList is populated, create queue
     */
    async initializeWithArtist(artist) {
        console.log('🚀 Initializing queue with artist:', artist.name);
        console.log("Artist ID:", artist.id);
        try {
            this.isLoading = true;
            
            // Load artist and get initial song
            const result = await loadArtistForQueue(artist);
            
            // Set up queue metadata
            this.artistUrlKey = result.queueInfo.artistUrlKey;
            this.artistData = result.artistData;
            this.songIds = result.queueInfo.songIds;
            this.currentIndex = result.song.songIndex || 0;
            
            // Clear and initialize songs array with placeholders
            // For new artists, cachedSongIds might be empty initially, so be more flexible
            const cachedSongIds = result.artistData.cachedSongIds || [];
            const isNewArtist = cachedSongIds.length === 0 && result.artistData.totalSongs > 0;
            
            this.songs = this.songIds.map((id, index) => ({
                id,
                index,
                loaded: false,
                cached: isNewArtist ? false : cachedSongIds.includes(id), // For new artists, assume uncached initially
                title: `Loading...`,
                artist: artist.name
            }));
            
            if (isNewArtist) {
                console.log(`🆕 New artist detected: ${artist.name} - will update cache status as songs load`);
            }
            this.broadcast();
            
            console.log('🧱 Beginning queue build from first-page songIds (placeholders created)');
            // Load the first song immediately at the correct index
            const firstWithExcerpt = this.ensureSongDisplayData({ ...result.song });
            this.loadedSongs.set(firstWithExcerpt.id, firstWithExcerpt);
            this.songs[this.currentIndex] = {
                ...firstWithExcerpt,
                index: this.currentIndex,
                loaded: true,
                cached: true
            };
            this.broadcast();

            // If backend preloaded a block of songs (and scraped missing lyrics),
            // inject them into the queue now so they are instantly usable.
            if (result.preloadedSongs && Object.keys(result.preloadedSongs).length > 0) {
                Object.entries(result.preloadedSongs).forEach(([id, songData]) => {
                    const idx = this.songIds.indexOf(id);
                    if (idx !== -1) {
                        const withExcerpt = this.ensureSongDisplayData({ ...songData });
                        this.loadedSongs.set(id, withExcerpt);
                        this.songs[idx] = {
                            ...withExcerpt,
                            index: idx,
                            loaded: true,
                            cached: Boolean(withExcerpt.lyrics && withExcerpt.lyrics.length > 0)
                        };
                    }
                });
                this.broadcast();
            }

            console.log("First song with excerpt lyrics:", firstWithExcerpt.lyrics);
            console.log(`📋 Queue initialized: ${this.songs.length} songs, starting with "${result.song.title}"`);

            // Allow background preload immediately after first song is ready
            this.isLoading = false;
            // Defer preloading to the next macrotask so the first song can render immediately
            setTimeout(() => {
                this.preloadAroundCurrentPosition().catch((e) => {
                    console.warn('Deferred preload error:', e);
                });
            }, 0);

            return firstWithExcerpt;
            
        } catch (error) {
            console.error('Error initializing queue:', error);
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Get current song
     */
    getCurrentSong() {
        if (this.currentIndex >= 0 && this.currentIndex < this.songs.length) {
            return this.songs[this.currentIndex];
        }
        return null;
    }

    /**
     * Move to next song with smart loading
     * Step 3 of your queue process: Check if songs are cached, load if needed
     */
    async goToNext() {
        if (this.currentIndex >= this.songs.length - 1) {
            console.log('📭 Reached end of queue');
            return null;
        }

        this.currentIndex++;
        this.broadcast(); // notify index change immediately

        const nextSong = this.songs[this.currentIndex];
        console.log(`⏭️ Moving to next song: ${nextSong.title} (${this.currentIndex + 1}/${this.songs.length})`);
        
        // If song is not loaded, load it now
        if (!nextSong.loaded) {
            await this.loadSongAtIndex(this.currentIndex);
        }
        
        // Preload surrounding songs
        this.preloadAroundCurrentPosition();
        
        return this.songs[this.currentIndex];
    }

    /**
     * Move to previous song
     */
    async goToPrevious() {
        if (this.currentIndex <= 0) {
            console.log('📭 Already at beginning of queue');
            return null;
        }

        this.currentIndex--;
        this.broadcast(); // notify index change immediately

        const prevSong = this.songs[this.currentIndex];
        console.log(`⏮️ Moving to previous song: ${prevSong.title} (${this.currentIndex + 1}/${this.songs.length})`);
        
        // If song is not loaded, load it now
        if (!prevSong.loaded) {
            await this.loadSongAtIndex(this.currentIndex);
        }
        
        // Preload surrounding songs
        this.preloadAroundCurrentPosition();
        
        return this.songs[this.currentIndex];
    }

    /**
     * Jump to specific song in queue
     */
    async goToIndex(index) {
        if (index < 0 || index >= this.songs.length) {
            throw new Error(`Invalid queue index: ${index}`);
        }

        this.currentIndex = index;
        this.broadcast(); // notify index change immediately

        const targetSong = this.songs[index];
        console.log(`🎯 Jumping to song: ${targetSong.title} (${index + 1}/${this.songs.length})`);
        
        // If song is not loaded, load it now
        if (!targetSong.loaded) {
            await this.loadSongAtIndex(index);
        }
        
        // Preload surrounding songs
        this.preloadAroundCurrentPosition();
        
        return this.songs[index];
    }

    /**
     * Load a specific song by index - FIXED VERSION
     */
    async loadSongAtIndex(index) {
        if (index < 0 || index >= this.songs.length) {
            throw new Error(`Invalid song index: ${index}`);
        }

        const songId = this.songIds[index];
        
        // Check if already loaded in memory
        if (this.loadedSongs.has(songId)) {
            const loadedSong = this.loadedSongs.get(songId);
            this.songs[index] = { ...loadedSong, index, loaded: true, cached: true };
            this.broadcast();
            return this.songs[index];
        }

        try {
            console.log(`🔄 Loading song at index ${index}: ${songId}`);
            
            // FIRST: Try to load directly from Firestore (for cached songs)
            const directResult = await this.tryLoadSongDirectly(songId, index);
            if (directResult) {
                console.log(`✅ Loaded cached song directly: ${directResult.title}`);
                return directResult;
            }
            
            // FALLBACK: Use the navigation loader for uncached songs
            console.log(`📡 Song not cached, using navigation loader...`);
            const result = await loadSongsForNavigation(songId, false, this.artistUrlKey);
            
            // Update loaded songs cache and ensure each has a 4-line excerpt
            Object.entries(result.songs).forEach(([id, songData]) => {
                // Check if lyrics are valid before processing
                const hasValidLyrics = songData.lyrics && 
                                      songData.lyrics.trim().length > 0 && 
                                      songData.lyrics !== 'null' &&
                                      songData.lyrics !== 'undefined';
                
                if (!hasValidLyrics) {
                    console.warn(`⚠️ Song ${id} returned from navigation loader with null/invalid lyrics`);
                }
                
                const withExcerpt = hasValidLyrics ? this.ensureSongDisplayData({ ...songData }) : { ...songData };
                this.loadedSongs.set(id, withExcerpt);
                
                // Find and update the song in our queue
                const songIndex = this.songIds.indexOf(id);
                if (songIndex !== -1) {
                    this.songs[songIndex] = {
                        ...withExcerpt,
                        index: songIndex,
                        loaded: true,
                        cached: hasValidLyrics,
                        scrapingStatus: songData.scrapingStatus || (hasValidLyrics ? 'completed' : 'failed'),
                        hasValidLyrics: hasValidLyrics
                    };
                }
            });
            
            console.log(`✅ Loaded ${Object.keys(result.songs).length} songs around position ${index}`);
            this.broadcast();
            
            return this.songs[index];
            
        } catch (error) {
            console.error(`❌ Error loading song at index ${index}:`, error);
            
            // Mark as failed but keep placeholder
            this.songs[index] = {
                ...this.songs[index],
                loaded: false,
                error: error.message,
                title: 'Failed to load',
                lyrics: 'This song could not be loaded. Please try the next song.'
            };
            this.broadcast();
            throw error;
        }
    }

    /**
     * Try to load a song directly from Firestore (for cached songs)
     */
    async tryLoadSongDirectly(songId, index) {
        try {
            // Import Firestore functions
            const { doc, getDoc } = await import('firebase/firestore');
            const { db } = await import('./initFirebase.js');
            
            const songRef = doc(db, 'songs', songId);
            const songDoc = await getDoc(songRef);
            
            if (songDoc.exists()) {
                const songData = songDoc.data();
                
                // Only return if song has lyrics (is cached)
                if (songData.lyrics && songData.lyrics.trim().length > 0) {
                    const transformedSong = {
                        id: songId,
                        title: songData.title,
                        artist: songData.primaryArtist?.name || songData.artistNames,
                        lyrics: songData.lyrics,
                        image: songData.songArtImageUrl,
                        albumArtId: songData.albumArtId,
                        url: songData.url,
                        songId: songId,
                        primaryArtist: songData.primaryArtist?.name,
                        index: index,
                        loaded: true,
                        cached: true,
                        scrapingStatus: songData.scrapingStatus || 'completed',
                        hasValidLyrics: !!(songData.lyrics && songData.lyrics.trim().length > 10)
                    };
                    
                    const withExcerpt = this.ensureSongDisplayData(transformedSong);
                    
                    // Cache in memory and update queue
                    this.loadedSongs.set(songId, withExcerpt);
                    this.songs[index] = withExcerpt;
                    this.broadcast();
                    
                    return withExcerpt;
                }
            }
            
            return null; // Song not cached or doesn't exist
            
        } catch (error) {
            console.warn(`Failed to load song directly from Firestore: ${error.message}`);
            return null; // Fall back to navigation loader
        }
    }

    /**
     * Preload songs around current position for smooth navigation
     * This implements the smart preloading from your plan
     */
    async preloadAroundCurrentPosition() {
        if (this.isLoading) return; // Avoid concurrent loading
        
        const startIndex = Math.max(0, this.currentIndex - 2);
        const endIndex = Math.min(this.songs.length - 1, this.currentIndex + this.preloadRadius);
        
        console.log(`🔄 Preloading songs ${startIndex}-${endIndex} around current position ${this.currentIndex}`);
        
        // Find songs that need loading, prioritizing cached songs
        const cachedSongsToLoad = [];
        const uncachedSongsToLoad = [];
        
        for (let i = startIndex; i <= endIndex; i++) {
            if (!this.songs[i].loaded && !this.loadedSongs.has(this.songIds[i])) {
                if (this.songs[i].cached) {
                    cachedSongsToLoad.push(i);
                } else {
                    uncachedSongsToLoad.push(i);
                }
            }
        }
        
        // Load cached songs first (faster), then uncached songs
        const songsToLoad = [...cachedSongsToLoad, ...uncachedSongsToLoad];
        
        if (songsToLoad.length === 0) {
            console.log('✅ All nearby songs already loaded');
            return;
        }
        
        // Load songs in background (don't await to avoid blocking)
        this.loadSongsInBackground(songsToLoad);
    }

    /**
     * Load multiple songs in background without blocking UI
     */
    async loadSongsInBackground(indices) {
        console.log(`🔄 Background loading ${indices.length} songs:`, indices);
        
        // Load songs in small batches to avoid overwhelming the system
        const batchSize = 3;
        for (let i = 0; i < indices.length; i += batchSize) {
            const batch = indices.slice(i, i + batchSize);
            
            // Load batch in parallel
            const loadPromises = batch.map(async (index) => {
                try {
                    await this.loadSongAtIndex(index);
                } catch (error) {
                    console.warn(`Background load failed for song ${index}:`, error);
                }
            });
            
            await Promise.all(loadPromises);
            
            // Small delay between batches
            if (i + batchSize < indices.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`✅ Background loading complete for ${indices.length} songs`);
    }

    /**
     * Get queue status for UI
     */
    getQueueStatus() {
        const loadedCount = this.songs.filter(song => song.loaded).length;
        const cachedCount = this.songs.filter(song => song.cached).length;
        
        return {
            totalSongs: this.songs.length,
            loadedSongs: loadedCount,
            cachedSongs: cachedCount,
            currentIndex: this.currentIndex,
            currentSong: this.getCurrentSong(),
            canGoNext: this.currentIndex < this.songs.length - 1,
            canGoPrevious: this.currentIndex > 0,
            artistName: this.artistData?.name,
            artistUrlKey: this.artistUrlKey
        };
    }

    /**
     * (Optional) Plain helper if you still want it — but prefer $queueUpcomingSongs in components.
     */
    getUpcomingSongs(count = 5) {
        const upcoming = [];
        for (let i = this.currentIndex + 1; i < Math.min(this.currentIndex + 1 + count, this.songs.length); i++) {
            upcoming.push(this.songs[i]);
        }
        return upcoming;
    }

    /**
     * Clear queue
     */
    clear() {
        this.songs = [];
        this.currentIndex = 0;
        this.artistUrlKey = null;
        this.artistData = null;
        this.songIds = [];
        this.loadedSongs.clear();
        this.isLoading = false;
        
        console.log('🗑️ Queue cleared');
        this.broadcast();
    }
}

// Export singleton instance for global use
export const queueManager = new CacheAwareQueueManager();
