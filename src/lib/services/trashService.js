import { writable, get } from 'svelte/store';
import Cookies from 'js-cookie';

// Track whether the user has accepted data persistence
let cookiesEnabled = Cookies.get('cookiesAccepted') === 'true';

// localStorage key used for the song history list.
// Cookies have a strict 4 KB per-cookie browser limit; localStorage gives ~5 MB.
const LS_KEY = 'completedSongs';

/**
 * Read the saved song list from localStorage.
 * Also performs a one-time migration of any data left in the old cookie.
 */
function loadFromStorage() {
    try {
        // One-time migration: if an old cookie exists and localStorage is empty, move it over
        const oldCookie = Cookies.get(LS_KEY);
        if (oldCookie) {
            if (!localStorage.getItem(LS_KEY)) {
                localStorage.setItem(LS_KEY, oldCookie);
            }
            Cookies.remove(LS_KEY);
        }

        const saved = localStorage.getItem(LS_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch (error) {
        console.warn('Failed to load completed songs from storage:', error);
        return [];
    }
}

function saveToStorage(songs) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(songs));
    } catch (error) {
        console.warn('Failed to save completed songs to storage:', error);
    }
}

function clearStorage() {
    try {
        localStorage.removeItem(LS_KEY);
        Cookies.remove(LS_KEY); // also clear any legacy cookie
    } catch (error) {
        console.warn('Failed to clear completed songs from storage:', error);
    }
}

// Trash store to manage completed songs (unlimited)
const createTrashStore = () => {
    const initialTrash = cookiesEnabled ? loadFromStorage() : [];

    const { subscribe, set, update } = writable(initialTrash);

    return {
        subscribe,
        
        // Called when the user accepts data persistence
        enableCookies: () => {
            cookiesEnabled = true;
            const songs = loadFromStorage();
            if (songs.length > 0) {
                set(songs);
            }
        },
        
        // Called when the user disables data persistence — wipe stored data
        disableCookies: () => {
            cookiesEnabled = false;
            clearStorage();
        },
        
        // Add a completed song to trash (newest first, no cap)
        addCompletedSong: (songData) => {
            update(songs => {
                const completedSong = {
                    id: `${songData.songId}_${Date.now()}`,
                    songId: songData.songId,
                    title: songData.title,
                    artist: songData.artist,
                    artistUrlKey: songData.artistUrlKey,
                    imageUrl: songData.imageUrl,
                    albumArtId: songData.albumArtId,
                    geniusUrl: songData.geniusUrl,
                    wpm: Math.round(songData.wpm * 100) / 100,
                    accuracy: Math.round(songData.accuracy * 100) / 100,
                    charactersTyped: songData.charactersTyped,
                    incorrectChars: songData.incorrectChars,
                    testDuration: songData.testDuration,
                    completedAt: new Date().toISOString(),
                    lyricsLength: songData.lyricsLength,
                    fileName: `${songData.artist} - ${songData.title}.mp3`.replace(/[<>:"/\\|?*]/g, '_'),
                    fileSize: `${Math.round(songData.lyricsLength / 10)}KB`,
                };

                const updatedSongs = [completedSong, ...songs.filter(s => s.id !== completedSong.id)];
                if (cookiesEnabled) saveToStorage(updatedSongs);
                return updatedSongs;
            });
        },
        
        // Remove a song from trash
        removeSong: (songId) => {
            update(songs => {
                const updatedSongs = songs.filter(song => song.id !== songId);
                if (cookiesEnabled) saveToStorage(updatedSongs);
                return updatedSongs;
            });
        },
        
        // Clear all completed songs
        clearAll: () => {
            set([]);
            if (cookiesEnabled) clearStorage();
        },
        
        // Get song by ID
        getSong: (songId) => {
            let foundSong = null;
            update(songs => {
                foundSong = songs.find(song => song.id === songId);
                return songs;
            });
            return foundSong;
        },
        
        // Subscribe to changes and persist (used as a fallback sync hook)
        setupCookieSync: () => {
            return subscribe(songs => {
                if (cookiesEnabled) saveToStorage(songs);
            });
        }
    };
};

// Export the trash store instance
export const trashStore = createTrashStore();

// Helper function to format test results for trash
export const formatTestResultsForTrash = (testResults) => {
    return {
        songId: testResults.songId,
        title: testResults.songTitle,
        artist: testResults.artistName,
        artistUrlKey: testResults.artistUrlKey, // Artist URL key for replay functionality
        imageUrl: testResults.imageUrl,
        albumArtId: testResults.albumArtId,
        geniusUrl: testResults.geniusUrl,
        
        wpm: testResults.wpm,
        accuracy: testResults.accuracy,
        charactersTyped: testResults.charactersTyped,
        incorrectChars: testResults.incorrectChars,
        testDuration: testResults.testDuration,
        lyricsLength: testResults.lyricsLength || testResults.lyrics?.length || 0,
    };
};

// Helper function to generate file icon based on stats
export const getFileIcon = (song) => {
    // Return different icon colors/styles based on performance
    if (song.wpm >= 100 && song.accuracy >= 99) {
        return 'legendary'; // Legendary performance
    } else if (song.wpm >= 80 && song.accuracy >= 95) {
        return 'gold'; // Excellent performance
    } else if (song.wpm >= 60 && song.accuracy >= 85) {
        return 'silver'; // Good performance
    } else if (song.wpm >= 40 && song.accuracy >= 75) {
        return 'bronze'; // Average performance
    } else {
        return 'default'; // Below average
    }
};

// Helper function to format duration
export const formatDuration = (minutes) => {
    if (minutes < 1) {
        return `${Math.round(minutes * 60)}s`;
    } else {
        return `${Math.round(minutes * 10) / 10}m`;
    }
};

// Helper function to get performance grade
export const getPerformanceGrade = (wpm, accuracy) => {
    const score = (wpm * 0.7) + (accuracy * 0.3);
    
    if (score >= 120) return 'S+';
    if (score >= 100) return 'S';
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'A-';
    if (score >= 75) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 65) return 'B-';
    if (score >= 60) return 'C+';
    if (score >= 55) return 'C';
    if (score >= 50) return 'C-';
    if (score >= 45) return 'D+';
    if (score >= 40) return 'D';
    return 'F';
};
