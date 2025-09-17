import { writable } from 'svelte/store';
import Cookies from 'js-cookie';

// Trash store to manage completed songs (max 10)
const createTrashStore = () => {
    // Load from cookies on initialization
    const initialTrash = (() => {
        try {
            const saved = Cookies.get('completedSongs');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.warn('Failed to load completed songs from cookies:', error);
            return [];
        }
    })();

    const { subscribe, set, update } = writable(initialTrash);

    return {
        subscribe,
        
        // Add a completed song to trash (keeps max 25, newest first)
        addCompletedSong: (songData) => {
            update(songs => {
                // Create completed song entry with stats and timestamp
                const completedSong = {
                    id: `${songData.songId}_${Date.now()}`, // Unique ID for each completion
                    songId: songData.songId,
                    title: songData.title,
                    artist: songData.artist,
                    imageUrl: songData.imageUrl,
                    albumArtId: songData.albumArtId,
                    geniusUrl: songData.geniusUrl,
                    
                    // Stats from the completed test
                    wpm: Math.round(songData.wpm * 100) / 100, // Round to 2 decimals
                    accuracy: Math.round(songData.accuracy * 100) / 100,
                    charactersTyped: songData.charactersTyped,
                    incorrectChars: songData.incorrectChars,
                    testDuration: songData.testDuration, // in minutes
                    
                    // Metadata
                    completedAt: new Date().toISOString(),
                    lyricsLength: songData.lyricsLength,
                    
                    // MP3-like file representation
                    fileName: `${songData.artist} - ${songData.title}.mp3`.replace(/[<>:"/\\|?*]/g, '_'), // Sanitize filename
                    fileSize: `${Math.round(songData.lyricsLength / 10)}KB`, // Approximate based on lyrics length
                };

                // Add to beginning and keep only the most recent 25
                const updatedSongs = [completedSong, ...songs.filter(s => s.id !== completedSong.id)].slice(0, 25);
                
                // Save to cookies
                try {
                    Cookies.set('completedSongs', JSON.stringify(updatedSongs), { expires: 365 });
                } catch (error) {
                    console.warn('Failed to save completed songs to cookies:', error);
                }
                
                return updatedSongs;
            });
        },
        
        // Remove a song from trash
        removeSong: (songId) => {
            update(songs => {
                const updatedSongs = songs.filter(song => song.id !== songId);
                
                // Save to cookies
                try {
                    Cookies.set('completedSongs', JSON.stringify(updatedSongs), { expires: 365 });
                } catch (error) {
                    console.warn('Failed to save completed songs to cookies:', error);
                }
                
                return updatedSongs;
            });
        },
        
        // Clear all completed songs
        clearAll: () => {
            set([]);
            Cookies.remove('completedSongs');
        },
        
        // Get song by ID
        getSong: (songId) => {
            let foundSong = null;
            update(songs => {
                foundSong = songs.find(song => song.id === songId);
                return songs;
            });
            return foundSong;
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
