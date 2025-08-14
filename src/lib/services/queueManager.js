// src/lib/services/queueManager.js
import { loadArtistForQueue, loadSongsForNavigation } from './artistService.js';
import { writable, derived } from 'svelte/store';

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
     * Ensure the song has a stable 4-line excerpt and store it on the song object.
     * The excerpt is chosen once per song and kept in memory with the queue so
     * navigating back to the song reuses the same lines.
     */
    ensureExcerptForSong(song) {
        if (!song || !song.lyrics || typeof song.lyrics !== 'string') return song;

        // If we've already selected lines for this song in this session, reuse them
        if (song.displayLineIndices && Array.isArray(song.displayLineIndices) && song.displayLineIndices.length > 0) {
            // If lyrics currently hold the full lyrics and we have indices, rebuild excerpt
            if (song.fullLyrics && song.lyrics === song.fullLyrics) {
                const lines = song.fullLyrics.split('\n');
                song.lyrics = song.displayLineIndices.map(i => lines[i] ?? '').join('\n');
            }
            return song;
        }

        const original = song.lyrics;
        const lines = original.split('\n').filter(l => l.trim().length > 0);
        const count = 4;
        if (lines.length === 0) return song;

        let indices = [];
        if (lines.length <= count) {
            indices = Array.from({ length: lines.length }, (_, i) => i);
        } else {
            // Pick a random consecutive window of 4 lines for coherent typing context
            const start = Math.floor(Math.random() * (lines.length - count + 1));
            indices = [start, start + 1, start + 2, start + 3];
        }

        const excerpt = indices.map(i => lines[i]).join('\n');
        song.fullLyrics = original; // keep full lyrics for reference
        song.displayLineIndices = indices; // persist selection in queue
        song.lyrics = excerpt; // what the UI will render
        song.displayLyrics = excerpt; // optional, explicit field
        console.log("Excerpt for song", song.title + ":\n", excerpt);

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
            this.currentIndex = 0;
            
            // Clear and initialize songs array with placeholders
            this.songs = this.songIds.map((id, index) => ({
                id,
                index,
                loaded: false,
                cached: result.queueInfo.cachedSongs > index, // Assume first N songs are cached
                title: `Loading...`,
                artist: artist.name
            }));
            this.broadcast();
            
            console.log('🧱 Beginning queue build from first-page songIds (placeholders created)');
            // Load the first song immediately
            const firstWithExcerpt = this.ensureExcerptForSong({ ...result.song });
            this.loadedSongs.set(firstWithExcerpt.id, firstWithExcerpt);
            this.songs[0] = {
                ...firstWithExcerpt,
                index: 0,
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
                        const withExcerpt = this.ensureExcerptForSong({ ...songData });
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
     * Load a specific song by index
     */
    async loadSongAtIndex(index) {
        if (index < 0 || index >= this.songs.length) {
            throw new Error(`Invalid song index: ${index}`);
        }

        const songId = this.songIds[index];
        
        // Check if already loaded
        if (this.loadedSongs.has(songId)) {
            const loadedSong = this.loadedSongs.get(songId);
            this.songs[index] = { ...loadedSong, index, loaded: true, cached: true };
            this.broadcast();
            return this.songs[index];
        }

        try {
            console.log(`🔄 Loading song at index ${index}: ${songId}`);
            
            // Use the navigation loader to get this song and surrounding ones
            const result = await loadSongsForNavigation(songId, false, this.artistUrlKey);
            
            // Update loaded songs cache and ensure each has a 4-line excerpt
            Object.entries(result.songs).forEach(([id, songData]) => {
                const withExcerpt = this.ensureExcerptForSong({ ...songData });
                this.loadedSongs.set(id, withExcerpt);
                
                // Find and update the song in our queue
                const songIndex = this.songIds.indexOf(id);
                if (songIndex !== -1) {
                    this.songs[songIndex] = {
                        ...withExcerpt,
                        index: songIndex,
                        loaded: true,
                        cached: true
                    };
                }
            });
            
            console.log(`✅ Loaded ${Object.keys(result.songs).length} songs around position ${index}`);
            this.broadcast();
            
            return this.songs[index];
            
        } catch (error) {
            console.error(`Error loading song at index ${index}:`, error);
            
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
     * Preload songs around current position for smooth navigation
     * This implements the smart preloading from your plan
     */
    async preloadAroundCurrentPosition() {
        if (this.isLoading) return; // Avoid concurrent loading
        
        const startIndex = Math.max(0, this.currentIndex - 2);
        const endIndex = Math.min(this.songs.length - 1, this.currentIndex + this.preloadRadius);
        
        console.log(`🔄 Preloading songs ${startIndex}-${endIndex} around current position ${this.currentIndex}`);
        
        // Find songs that need loading
        const songsToLoad = [];
        for (let i = startIndex; i <= endIndex; i++) {
            if (!this.songs[i].loaded && !this.loadedSongs.has(this.songIds[i])) {
                songsToLoad.push(i);
            }
        }
        
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
