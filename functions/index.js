import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import { handler } from './server.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const geniusApiKeyParam = defineString('GENIUS_KEY');

export const ssrServer = onRequest({
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 100,
    region: 'us-central1',
    invoker: 'public'  // This makes the function publicly accessible
}, async (request, response) => {
    try {
        return await handler(request, response);
    } catch (error) {
        console.error('SSR Error:', error);
        response.status(500).send('Internal Server Error');
    }
});

// ensure that the first result matches the search
async function getInitialSearch(artist_name) {
    const searchUrl = "https://api.genius.com/search";
    let geniusApiKey = geniusApiKeyParam.value();

    // Fallback to local config if the Firebase config is null
    if (!geniusApiKey) {
        try {
            const localConfigPath = path.join(__dirname, 'local-config.json');
            const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
            geniusApiKey = localConfig.genius.key;
        } catch (error) {
            console.error('Error loading local config:', error);
            throw new Error('API key not found. Please configure your API key.');
        }
    }

    const headers = {
        "Authorization": geniusApiKey
    };

    const params = new URLSearchParams({ q: artist_name });
    const response = await fetch(`${searchUrl}?${params}`, { headers });
    const data = await response.json();
    const songs = data.response.hits;

    if (songs.length === 0) {
        return { songTitle: "No songs found.", lyrics: "" };
    }

    const artistId = songs[0].result.primary_artist.id;
    let songReturn = await getSongsById(artistId, []);
    songReturn.initialArtist = songs[0].result.primary_artist.name;
    songReturn.initialArtistImg = songs[0].result.primary_artist.image_url;
    songReturn.initialArtistId = artistId;
    return songReturn;
}

export const initialArtistSearch = onCall({
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 100,
    region: 'us-central1'
}, async (request, context) => {
    // Access the nested data property
    const { artistName } = request.data;
    
    if (!artistName) {
        console.error("artistName is undefined. Full data object:", request);
        throw new HttpsError('invalid-argument', 'Artist name is required');
    }

    try {
        console.log("Processing artist name:", artistName);
        const returnJSON = await getInitialSearch(artistName);
        return returnJSON;
    } catch (error) {
        console.error("Error fetching artist lyrics:", error);
        throw new HttpsError('internal', 'Failed to fetch artist lyrics', error.toString());
    }
});


async function getSongsById(artistId, seenSongs) {
    const searchUrl = "https://api.genius.com/artists/";
    let geniusApiKey = geniusApiKeyParam.value();
    const pageSize = 10;

    // Fallback to local config if the Firebase config is null
    if (!geniusApiKey) {
        try {
            const localConfigPath = path.join(__dirname, 'local-config.json');
            const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
            geniusApiKey = localConfig.genius.key;
        } catch (error) {
            console.error('Error loading local config:', error);
            throw new Error('API key not found. Please configure your API key.');
        }
    }
    const headers = {
        "Authorization": geniusApiKey
    };
    try {
        const pageNum = Math.floor(seenSongs.length / pageSize) + 1;

        function removeValuesEfficient(sourceArray, valuesToRemove) {
            const removeSet = new Set(valuesToRemove);
            return sourceArray.filter(item => !removeSet.has(item));
        }
    
        function getRandomArrayValue(array) {
            return array[Math.floor(Math.random() * array.length)];
        }
    
        // generate indices for songs in page
        const pageIndices = Array.from({length: pageSize}, (_, i) => (i + (pageNum - 1) * pageSize) + 1);
    
        // get random song index from pageIndices that is not in seenSongs
        const songIndex = getRandomArrayValue(removeValuesEfficient(pageIndices, seenSongs));
    
        // console.log(`${searchUrl}${artistId}/songs?per_page=1&page=${songIndex}&sort=popularity`)
        const response = await fetch(`${searchUrl}${artistId}/songs?per_page=1&page=${songIndex}&sort=popularity`, { headers });
        const data = await response.json();
        if (!data.response || !data.response.songs || !data.response.songs[0]) {
            console.error("Unexpected API response structure:", data);
            throw new Error('Invalid API response structure');
        }
        const song = data.response.songs[0];

        

        let lyrics = '';

        // Fetch the song page
        const songPageResponse = await fetch(song.url);
        const songPageHtml = await songPageResponse.text();

        // Parse the page with load
        const $ = cheerio.load(songPageHtml);
        let lyricsHtml = '';
        

        // Select the container that includes the lyrics and retrieve the HTML
        // Try this updated selector
        const lyricsContainer = $('div[class*="Lyrics__Container"]');
        if (lyricsContainer.length > 0) {
            lyricsHtml = lyricsContainer.html();
        } else {
            lyricsHtml = "Lyrics not found.";
        }


        // Replace <br> tags with \n to maintain formatting
        lyrics = lyricsHtml.replace(/<br\s*\/?>/gi, '\n');

        // Remove any script or style elements entirely
        lyrics = lyrics.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
        lyrics = lyrics.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');

        lyrics = lyrics.replace(/<\/?a[^>]*>/gi, ''); // Remove anchor tags but preserve their text
        lyrics = lyrics.replace(/<span[^>]*>/gi, ''); // Remove start span tags
        lyrics = lyrics.replace(/<\/span>/gi, '');    // Remove end span tags
        lyrics = lyrics.replace(/<div[^>]*>/gi, '\n');// Replace start div tags with new lines
        lyrics = lyrics.replace(/<\/div>/gi, '');     // Remove end div tags
        lyrics = lyrics.replace(/\[.*?\]/g, '');      // Remove text within square brackets
        lyrics = lyrics.replace(/<\/?(i|b)>/gi, '');  // Remove italic and bold tags

        // Decode HTML entities
        lyrics = $('<textarea/>').html(lyrics).text();

        console.log("LYRICS: ", lyrics)

        // Trim the final string to remove any leading/trailing whitespace
        lyrics = lyrics.trim();

        const lines = lyrics.split('\n');

        // Filter out empty lines and lines with text in square brackets
        const filteredLines = lines.filter(line => line.trim() !== '' && !line.trim().match(/\[.*?\]/));

        // Ensure there are at least four lines to choose from
        if (filteredLines.length < 4) {
            return { songTitle, lyrics }; // Or handle differently if needed
        }

        // Choose a random start index, ensuring it allows for four consecutive lines
        const startIndex = Math.floor(Math.random() * (filteredLines.length - 3));
        const selectedLines = filteredLines.slice(startIndex, startIndex + 4).join('\n');

        // Use selectedLines instead of the full lyrics
        lyrics = selectedLines;
        
        // Add the song attributes to returned JSON
        const returnJSON = {
            title: song.title,
            url: song.url,
            image: song.song_art_image_url,
            artist: song.artist_names,
            artistImg: song.primary_artist.image_url,
            artistId: song.primary_artist.id,
            songId: song.id,
            songIndex: songIndex,
            lyrics: lyrics,
        };
        console.log(returnJSON)
        return returnJSON;
    } catch (error) {
        console.error("Error navigating to song URL:", error);
        throw error;
    }
}


export const searchByArtistId = onCall({
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 100,
    region: 'us-central1'
}, async (request, context) => {
    const { artistId, seenSongs } = request.data;
    try {
        const returnJSON = await getSongsById(artistId, seenSongs);
        console.log(returnJSON)
        return returnJSON;
    } catch (error) {
        console.error("Error fetching artist lyrics:", error);
        throw new HttpsError('internal', '...')
    }
});

export const healthCheck = onRequest({
    timeoutSeconds: 10,
    region: 'us-central1'
}, (req, res) => {
    res.status(200).send('OK');
});

// console.log(getInitialSearch("Bladee"));
// console.log(getSongsById(1421, []));



// GET SONGS USING SONG IDS IN SEENSONGS
// async function getSongsById(artistId, seenSongs, numSongs) {
//     const searchUrl = "https://api.genius.com/artists/";
//     let geniusApiKey = functions.config().genius ? functions.config().genius.key : null;
//     const pageSize = 1;

//     // Fallback to local config if the Firebase config is null
//     if (!geniusApiKey) {
//         try {
//             const localConfigPath = path.join(__dirname, 'local-config.json');
//             const localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
//             geniusApiKey = localConfig.genius.key;
//         } catch (error) {
//             console.error('Error loading local config:', error);
//             throw new Error('API key not found. Please configure your API key.');
//         }
//     }
//     const headers = {
//         "Authorization": geniusApiKey
//     };

//     //TODO: GET NEXT PAGE IF NECESSARY
//     const pageNum = Math.floor(seenSongs.length / pageSize) + 1;
//     const response = await fetch(`${searchUrl}${artistId}/songs?per_page=${pageSize}&page=${pageNum}&sort=popularity`, { headers });
//     const data = await response.json();
//     const songs = data.response.songs;

//     const filteredSongs = songs.filter(song => !seenSongs.includes(song.id));
//     const returnJSON = {}
    
//     // get specif random songs from the filteredSongs
//     for(let i = 0; i < numSongs; i++) {
//         if (filteredSongs.length === 0) {
//             break;
//         }
//         const randomIndex = Math.floor(Math.random() * filteredSongs.length);
//         const randomSong = filteredSongs[randomIndex];
//         let lyrics = '';
//         try {
//             // Fetch the song page
//             const songPageResponse = await fetch(randomSong.url);
//             const songPageHtml = await songPageResponse.text();
    
//             // Parse the page with load
//             const $ = load.load(songPageHtml);
//             let lyricsHtml = '';
    
//             // Select the container that includes the lyrics and retrieve the HTML
//             const lyricsContainer = $('[class^="Lyrics-"]');
//             if (lyricsContainer.length > 0) {
//                 lyricsHtml = lyricsContainer.html();
//             } else {
//                 lyricsHtml = "Lyrics not found.";
//             }
    
    
//             // Replace <br> tags with \n to maintain formatting
//             lyrics = lyricsHtml.replace(/<br\s*\/?>/gi, '\n');
    
//             // Remove any script or style elements entirely
//             lyrics = lyrics.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
//             lyrics = lyrics.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');
    
//             lyrics = lyrics.replace(/<\/?a[^>]*>/gi, ''); // Remove anchor tags but preserve their text
//             lyrics = lyrics.replace(/<span[^>]*>/gi, ''); // Remove start span tags
//             lyrics = lyrics.replace(/<\/span>/gi, '');    // Remove end span tags
//             lyrics = lyrics.replace(/<div[^>]*>/gi, '\n');// Replace start div tags with new lines
//             lyrics = lyrics.replace(/<\/div>/gi, '');     // Remove end div tags
//             lyrics = lyrics.replace(/\[.*?\]/g, '');      // Remove text within square brackets
//             lyrics = lyrics.replace(/<\/?(i|b)>/gi, '');  // Remove italic and bold tags
    
//             console.log(lyrics)
    
//             // Decode HTML entities
//             lyrics = $('<textarea/>').html(lyrics).text();
    
//             // Trim the final string to remove any leading/trailing whitespace
//             lyrics = lyrics.trim();
    
//             const lines = lyrics.split('\n');
    
//             // Filter out empty lines and lines with text in square brackets
//             const filteredLines = lines.filter(line => line.trim() !== '' && !line.trim().match(/\[.*?\]/));
    
//             // Ensure there are at least four lines to choose from
//             if (filteredLines.length < 4) {
//                 return { songTitle, lyrics }; // Or handle differently if needed
//             }
    
//             // Choose a random start index, ensuring it allows for four consecutive lines
//             const startIndex = Math.floor(Math.random() * (filteredLines.length - 3));
//             const selectedLines = filteredLines.slice(startIndex, startIndex + 4).join('\n');
    
//             // Use selectedLines instead of the full lyrics
//             lyrics = selectedLines;
    
//         } catch (error) {
//             console.error("Error navigating to song URL:", error);
//             throw error;
//         }
        
//         // Add the song attributes to returned JSON
//         returnJSON[randomSong.id] = {
//             title: randomSong.title,
//             url: randomSong.url,
//             image: randomSong.song_art_image_url,
//             artist: randomSong.artist_names,
//             artistImg: randomSong.primary_artist.image_url,
//             artistId: randomSong.primary_artist.id,
//             songId: randomSong.id,
//             lyrics: lyrics
//         };

//         filteredSongs.splice(randomIndex, 1); // Remove the song from the list
//     }
//     return returnJSON;
// }

//searchArtistAndFetchLyrics({data: {artistName: "playboi carti"}}).then(result => console.log(result));

// OLD CODE
/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const {onRequest} = require("firebase-functions/v2/https");
// const logger = require("firebase-functions/logger");

// Create and deploy your first functions
// functions/index.js
// const functions = require('firebase-functions');
// const Genius = require("genius-lyrics");
// const normalize = require('normalize-strings');

// // Initialize Genius Client with your API key
// const geniusApiKey = functions.config().genius.key;
// const Client = new Genius.Client(geniusApiKey);


// // Helper function to format characters
// function formatChars(input) {
//     let output = "";
//     const replacements = {
//         "‘": "'", "’": "'", "❛": "'", "❜": "'", "＇": "'",
//         "“": '"', "”": '"', "‟": '"', "❝": '"', "❞": '"', "〝": '"', "〞": '"', "＂": '"',
//         "‚": ",",
//         // Add more replacements as needed
//     };
//     for (let i = 0; i < input.length; i++) {
//         output += replacements[input.charAt(i)] || input.charAt(i);
//     }
//     return normalize(output).toLowerCase();
// }

// // Helper function to extract random 4 lines from lyrics
// function extractRandomLyricsSegment(lyrics) {
//     const lines = lyrics.split('\n').filter(line => line.trim() !== '');
//     if (lines.length <= 4) {
//         return lines.join('\n');
//     }

//     const start = Math.floor(Math.random() * (lines.length - 4));
//     return lines.slice(start, start + 4).join('\n');
// }

// // Helper function to shuffle an array
// function shuffleArray(array) {
//     for (let i = array.length - 1; i > 0; i--) {
//         const j = Math.floor(Math.random() * (i + 1));
//         [array[i], array[j]] = [array[j], array[i]];
//     }
//     return array;
// }

// // Firebase Function to search for an artist and fetch lyrics
// exports.searchArtistAndFetchLyrics = functions.https.onCall(async (data, context) => {
//     const { artistName } = data;

//     try {
//         const searches = await Client.songs.search(artistName);
//         if (searches.length === 0) {
//             throw new functions.https.HttpsError('not-found', 'Artist not found.');
//         }

//         // Shuffle search results to randomize song selection
//         const shuffledSearches = shuffleArray(searches);
//         const song = shuffledSearches[0]; // Select the first song after shuffling
//         const lyrics = await song.lyrics();
//         const songInfo = await song.fetch();
//         const formattedLyrics = formatChars(lyrics);
//         const randomLyricsSegment = extractRandomLyricsSegment(formattedLyrics);

//         const response = {
//             title: song.title,
//             artist: song.artist.name,
//             lyrics: randomLyricsSegment,
//             image: songInfo.album ? songInfo.album.image : null,
//         };

//         return response;
//     } catch (error) {
//         console.error("Error fetching artist lyrics:", error);
//         throw new functions.https.HttpsError('internal', 'Failed to fetch artist lyrics', error);
//     }
// });
