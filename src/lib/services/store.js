import { writable, derived } from 'svelte/store'
import Cookies from 'js-cookie';

export const cookiesAccepted = writable(Cookies.get('cookiesAccepted') === 'true' || false)

const defaultCorrection = {
    correct: "#368e5e",
    incorrect: "#bd5454"
}

const defaultTheme = {
    primary: '#000000',
    secondary: '#ffffff',
    name: "Default"
}

const darkTheme = {
    primary: '#f0f6f0',
    secondary: '#222323',
    name: "Dark",
    monoBackground: '#222323',
    inverseImage: true
};

const blue = {
    primary: '#051b2c',
    secondary: '#8bc8fe',
    name: "Blue"
};

const paperback = {
    primary: '#382b26',
    secondary: '#b8c2b9',
    name: "Paperback",
    correct: "#507354"
};

const whiteGreen = {
    primary: '#004c3d',
    secondary: '#ffeaf9',
    name: "Bamboo"
};

const casio = {
    primary: '#000000',
    secondary: '#83b07e',
    name: "Casio",
    correct: "#497444",
    incorrect: "#b06464"
};

const gatoRoboto = {
    primary: '#323c39',
    secondary: '#d3c9a1',
    name: "Hazy"
};

const peachy = {
    primary: '#242234',
    secondary: '#facab8',
    name: "Peachy",
    incorrect: "#fa7373"
};

const purp = {
    primary: '#17141c',
    secondary: '#a692b0',
    name: "Purp",
    correct: "#5c8961",
};

const redWhite = {
    primary: '#c62b69',
    secondary: '#edf4ff',
    name: "Hibiscus"
};

const endgame = {
    primary: '#1b1233',
    secondary: '#dcf29d',
    name: "Pistachio"
};

const matcha = {
    primary: '#2b4022',
    secondary: '#7da580',
    name: "Matcha"
}

const milkcarton = {
    primary: '#5b88e2',
    secondary: '#f5f4e9',
    name: "Milk Carton"
};

const puffs = {
    primary: '#6f4d3d',
    secondary: '#cb9867',
    name: "Puffs"
}

const creme = {
    primary: '#2e3037',
    secondary: '#ebe5ce',
    name: "Creme"
}

const blueberry = {
    primary: '#40318e',
    secondary: '#88d7de',
    name: "Blueberry",
    correct: "#912c95",
    incorrect: "#d64c89"
}

const matrix = {
    primary: '#26c30f',
    secondary: '#000000',
    name: "Matrix",
    monoBackground: '#000000',
    inverseImage: true,
    correct: '#d1ffcd',
    incorrect: '#da3333'
}

const coffee = {
    primary: '#2d2020',
    secondary: '#eacda8',
    name: "Coffee"
}

const strawberryMilk = {
    primary: '#1c221c',
    secondary: '#e0c9e0',
    name: "Strawberry Milk"
}

const redrum = {
    primary: '#2b0000',
    secondary: '#cc0e13',
    name: "Redrum"
}

export const themeChoices = [ defaultTheme, darkTheme, creme, strawberryMilk, whiteGreen, casio, blue, paperback,  gatoRoboto, peachy, purp, redWhite, endgame, milkcarton, 
    puffs,  blueberry, matrix, coffee,  redrum, matcha ];

export const currentTheme = writable(defaultTheme);
export const themeColors = writable({
    primary: currentTheme.primary,
    secondary: currentTheme.secondary
});
export const backgroundColors = writable({
    primary: currentTheme.primary,
    secondary: currentTheme.secondary
});
export const imageColors = writable({
    primary: currentTheme.primary,
    secondary: currentTheme.secondary
});

export const correctionColors = writable(defaultCorrection);

export const ditherImages = writable(true);
export const capitalization = writable(true);
export const punctuation = writable(true);
export const recentArtists = writable([]);

recentArtists.subscribe(artists => {
    if (artists.length > 7) {
        recentArtists.set(artists.slice(0, 7));
    }
});


currentTheme.subscribe(theme => {
    themeColors.set({
        primary: theme.primary,
        secondary: theme.secondary
    });
    backgroundColors.set({
        primary: theme.monoBackground ? theme.monoBackground : theme.primary,
        secondary: theme.monoBackground ? theme.monoBackground : theme.secondary
    });
    imageColors.set({
        primary: theme.inverseImage ? theme.secondary : theme.primary,
        secondary: theme.inverseImage ? theme.primary : theme.secondary
    });
    correctionColors.set({
        correct: theme.correct ? theme.correct : defaultCorrection.correct,
        incorrect: theme.incorrect ? theme.incorrect : defaultCorrection.incorrect
    });
});

cookiesAccepted.subscribe(accepted => {
    if (accepted) {
        Cookies.set('cookiesAccepted', 'true');
        
        const savedTheme = Cookies.get('currentTheme');
        const savedColors = Cookies.get('themeColors');
        const savedBackground = Cookies.get('backgroundColor');
        const savedDither = Cookies.get('ditherImages');
        const savedCapitalization = Cookies.get('capitalization');
        const savedPunctuation = Cookies.get('punctuation');
        const savedArtists = Cookies.get('recentArtists');

        if (savedTheme) currentTheme.set(JSON.parse(savedTheme));
        if (savedColors) themeColors.set(JSON.parse(savedColors));
        if (savedBackground) backgroundColors.set(JSON.parse(savedBackground));
        if (savedDither) ditherImages.set(JSON.parse(savedDither));
        if (savedCapitalization) capitalization.set(JSON.parse(savedCapitalization));
        if (savedPunctuation) punctuation.set(JSON.parse(savedPunctuation));
        if (savedArtists) recentArtists.set(JSON.parse(savedArtists));

        currentTheme.subscribe(value => {
            Cookies.set('currentTheme', JSON.stringify(value));
            themeColors.set({
                primary: value.primary,
                secondary: value.secondary
            });
            backgroundColors.set({
                primary: value.monoBackground ? value.monoBackground : value.primary,
                secondary: value.monoBackground ? value.monoBackground : value.secondary
            });
            imageColors.set({
                primary: value.inverseImage ? value.secondary : value.primary,
                secondary: value.inverseImage ? value.primary : value.secondary
            });
            correctionColors.set({
                correct: value.correct ? value.correct : defaultCorrection.correct,
                incorrect: value.incorrect ? value.incorrect : defaultCorrection.incorrect
            });
        });

        themeColors.subscribe(value => {
            Cookies.set('themeColors', JSON.stringify(value));
        });

        backgroundColors.subscribe(value => {
            Cookies.set('backgroundColor', JSON.stringify(value));
        });

        ditherImages.subscribe(value => {
            Cookies.set('ditherImages', JSON.stringify(value));
        });
        capitalization.subscribe(value => {
            Cookies.set('capitalization', JSON.stringify(value));
        });
        punctuation.subscribe(value => {
            Cookies.set('punctuation', JSON.stringify(value));
        });
        imageColors.subscribe(value => {
            Cookies.set('imageColors', JSON.stringify(value));
        });

        if (!savedArtists) {
            let currentArtists;
            recentArtists.subscribe(value => {
                currentArtists = value;
            })();  // Immediately unsubscribe after getting value
            Cookies.set('recentArtists', JSON.stringify(currentArtists));
        }

        recentArtists.subscribe(value => {
            Cookies.set('recentArtists', JSON.stringify(value));
        });
    } else {
        Cookies.remove('currentTheme');
        Cookies.remove('themeColors');
        Cookies.remove('backgroundColor');
        Cookies.remove('ditherImages');
        Cookies.remove('capitalization');
        Cookies.remove('punctuation');
        Cookies.remove('recentArtists');
        Cookies.remove('cookiesAccepted');
    }
});

const initialState = {
    activeWindowId: null,
    nextZIndex: 0,
    windowStates: [],
    screenDimensions: {
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0
    }
};

export const windowStore = writable(initialState);

// Derived store for aspect ratio
export const aspectRatio = derived(
    windowStore,
    $store => $store.screenDimensions.width / $store.screenDimensions.height
);

export const windowActions = {
    activateWindow: (id) => {
        if (!id) return;
       
        windowStore.update(state => {
            const newNextZIndex = state.nextZIndex + 1;
            return {
                ...state,
                activeWindowId: id,
                nextZIndex: newNextZIndex,
                windowStates: state.windowStates.map(window => ({
                    ...window,
                    zIndex: window.id === id ? newNextZIndex : window.zIndex,
                    isActive: window.id === id
                }))
            };
        });
    },

    addWindow: (windowData) => {
        if (!windowData.id) return;
       
        windowStore.update(state => {
            const existingWindow = state.windowStates.find(w => w.id === windowData.id);
            
            // Calculate dimensions based on screen size
            const dimensions = windowData.id ? 
                calculateResponsiveDimensions(state.screenDimensions.width, state.screenDimensions.height, windowData.id) : windowData.dimensions
           
            // If window already exists, just make it active
            if (existingWindow) {
                return {
                    ...state,
                    activeWindowId: windowData.id, // Set as active window
                    windowStates: state.windowStates.map(w => ({
                        ...w,
                        isActive: w.id === windowData.id, // Make only this window active
                        dimensions: w.id === windowData.id ? dimensions : w.dimensions
                    }))
                };
            }

            // Add new window
            const newNextZIndex = state.nextZIndex + 1;
            const newWindow = {
                ...windowData,
                zIndex: newNextZIndex,
                isActive: true,
                position: windowData.position,
                dimensions
            };

            return {
                ...state,
                activeWindowId: windowData.id,
                nextZIndex: newNextZIndex,
                windowStates: state.windowStates
                    .map(w => ({...w, isActive: false})) // Deactivate all other windows
                    .concat(newWindow)
            };
        });
    },

    removeWindow: (id) => {
        if (!id) return;
       
        windowStore.update(state => {
            const filteredWindows = state.windowStates.filter(w => w.id !== id);
            const lastWindow = filteredWindows[filteredWindows.length - 1];
            return {
                ...state,
                activeWindowId: lastWindow?.id ?? null,
                nextZIndex: state.nextZIndex,
                windowStates: filteredWindows.map(w => ({
                    ...w,
                    isActive: w.id === lastWindow?.id // Make last window active
                }))
            };
        });
    },

    updatePosition: (id, newPosition) => {
        if (!id) return;
       
        windowStore.update(state => ({
            ...state,
            windowStates: state.windowStates.map(window =>
                window.id === id
                    ? { ...window, position: newPosition } // Update position of window with matching id
                    : window
            )
        }));
    },

    updateScreenDimensions: (width, height) => {
        windowStore.update(state => ({
            ...state,
            screenDimensions: { width, height },
            windowStates: state.windowStates.map(window => ({ // Update dimensions of all windows based on new screen size and their id
                ...window,
                dimensions: window.id ? calculateResponsiveDimensions(width, height, window.id) : window.dimensions
            }))
        }));
    }
};

function calculateResponsiveDimensions(width, height, windowId) {
    const ratio = width / height;
    console.log("WindowID: " + windowId)
    if(windowId === 'typingTestWindow') {
        if (ratio > 1.65) {
            // Wide screen
            return {
                width: height * 0.8 * 2,
                height: height * 0.8
            };
        } else {
            // Narrow screen
            return {
                width: width * 0.94,
                height: width * 0.94 / 2
            };
        }
    } else if(windowId === 'aboutDisplayWindow'){
        if (ratio > 1.65) {
            // Wide screen
            return {
                width: height * 0.7 * 0.8,
                height: height * 0.7
            };
        } else {
            // Narrow screen
            return {
                width: width * 0.5 * 0.8,
                height: width * 0.5
            };
        }
    } else if(windowId === 'settingsWindow'){
        if (ratio > 1.65) {
            // Wide screen
            return {
                width: height * 0.6,
                height: height * 0.7
            };
        } else {
            // Narrow screen
            return {
                width: width * 0.7 / 2,
                height: width * 0.41
            };
        }
    }
}

// TODO: stop using html tabindex and create a custom focus system
export const tabIndexStore = derived(windowStore, ($windowStore) => {
    const sortedWindows = [...$windowStore.windowStates].sort((a, b) => a.zIndex - b.zIndex);
    
    const tabIndexMap = new Map();
    let baseTabIndex = 1; // Start from 1 since 0 is typically for main navigation
    
    sortedWindows.forEach(window => {
        tabIndexMap.set(window.id, baseTabIndex);
        // Increment by 100 to leave room for elements within each window
        baseTabIndex += 100;
    });
    
    return tabIndexMap;
});

export function getElementTabIndex(windowId, elementIndex) {
    let tabIndexMap;
    
    // Subscribe to the store to get current tab index map
    tabIndexStore.subscribe(value => {
        tabIndexMap = value;
    })();
    
    if (!tabIndexMap.has(windowId)) {
        return -1; // Window not found
    }
    
    const baseTabIndex = tabIndexMap.get(windowId);
    return baseTabIndex + elementIndex;
}

// Song Queue Store
export const songQueue = writable({
    songs: [], // Array of song objects
    currentIndex: -1, // Index of currently playing song
    maxQueueSize: 50 // Maximum number of songs to keep in queue
});

// Helper functions for queue management
export const queueActions = {
    // Add a song to the queue and set it as current
    addSong: (song) => {
        songQueue.update(queue => {
            const newQueue = { ...queue };
            
            // If we're not at the end of the queue, remove everything after current position
            if (newQueue.currentIndex < newQueue.songs.length - 1) {
                newQueue.songs = newQueue.songs.slice(0, newQueue.currentIndex + 1);
            }
            
            // Add the new song
            newQueue.songs.push(song);
            newQueue.currentIndex = newQueue.songs.length - 1;
            
            // Trim queue if it exceeds max size
            if (newQueue.songs.length > newQueue.maxQueueSize) {
                const trimAmount = newQueue.songs.length - newQueue.maxQueueSize;
                newQueue.songs = newQueue.songs.slice(trimAmount);
                newQueue.currentIndex = newQueue.songs.length - 1;
            }
            
            return newQueue;
        });
    },
    
    // Navigate to previous song
    goToPrevious: () => {
        let previousSong = null;
        songQueue.update(queue => {
            if (queue.currentIndex > 0) {
                queue.currentIndex--;
                previousSong = queue.songs[queue.currentIndex];
            }
            return queue;
        });
        return previousSong;
    },
    
    // Navigate to next song
    goToNext: () => {
        let nextSong = null;
        songQueue.update(queue => {
            if (queue.currentIndex < queue.songs.length - 1) {
                queue.currentIndex++;
                nextSong = queue.songs[queue.currentIndex];
            }
            return queue;
        });
        return nextSong;
    },
    
    // Jump to specific song in queue
    jumpToSong: (index) => {
        let song = null;
        songQueue.update(queue => {
            if (index >= 0 && index < queue.songs.length) {
                queue.currentIndex = index;
                song = queue.songs[index];
            }
            return queue;
        });
        return song;
    },
    
    // Get current song
    getCurrentSong: () => {
        let currentSong = null;
        const unsubscribe = songQueue.subscribe(queue => {
            if (queue.currentIndex >= 0 && queue.currentIndex < queue.songs.length) {
                currentSong = queue.songs[queue.currentIndex];
            }
        });
        unsubscribe();
        return currentSong;
    },
    
    // Check if we can go to previous song
    canGoPrevious: () => {
        let canGo = false;
        const unsubscribe = songQueue.subscribe(queue => {
            canGo = queue.currentIndex > 0;
        });
        unsubscribe();
        return canGo;
    },
    
    // Check if we can go to next song
    canGoNext: () => {
        let canGo = false;
        const unsubscribe = songQueue.subscribe(queue => {
            canGo = queue.currentIndex < queue.songs.length - 1;
        });
        unsubscribe();
        return canGo;
    }
};