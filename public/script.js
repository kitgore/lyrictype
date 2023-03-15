let startTime
const quoteDisplayElement = document.getElementById('quoteDisplay')
const quoteInputElement = document.getElementById('quoteInput')
const artistInput = document.getElementById('artistInput')
const loading = document.getElementById('loading')
const songTitle = document.getElementById('song-title')
const songInfo = document.getElementById('song-info')
const albumArt = document.getElementById('album-art')
const wpmRender = document.getElementById('wpm')
const accRender = document.getElementById('acc')
const continueBut = document.getElementById('continue')
const redoBut = document.getElementById('redo')
const searchBut = document.getElementById('search')
let currQuote = ''
var randSongQueue = []
var jsonData
var preloadJson
let incorrectTotal = 0;

const baseURL = 'https://lyrictype.cyclic.app/'

artistInputTabIndex();

window.onload = focusArtistInput();

artistInput.addEventListener('keypress', async function(e){
    if(e.key === 'Enter' && artistInput.value.length > 2){
        await artistLoad(e)
        quoteInputTabIndex()
        focusQuoteInput()
        preloadNext()
    }else if(e.key === 'Enter'){
        e.preventDefault();
    }
})

const artistLoad = async (obj) => {
    document.body.classList.add('artistTyping-clear')
    document.body.classList.add('loadingToggle')
    const result = await getArtist(obj).then()
    document.body.classList.remove('typing-clear')
    document.body.classList.add('typing')
}
async function getArtist(e){
    e.preventDefault()
    let andBool = 0
    if((artistInput.value.includes('&') || artistInput.value.toLowerCase().includes('and'))){
        andBool = 1
        console.log("contains &")
    }
    const res = await fetch(baseURL + 'artist/' + artistInput.value + '/' + andBool,
        {
            method: 'GET'
        })
    let bruhstatus = await res.json()
    console.log(bruhstatus)
    await preloadNext()
    renderNewQuote(formatLyrics(preloadJson.lyrics), false).then(document.body.classList.remove('loadingToggle'))
}

async function handleStatus(status){
    console.log(status + "!!!!!!")
    if(status >= 500){
        console.log("ERROR!!!")
        serverError()
    }
}

async function preloadNext(){
    //preload json of next song in queue
    jsonData = preloadJson;
    console.log('Preloading song #' + randSongQueue[0])
    try{
    const res = await fetch(baseURL + 'songnum/' + randSongQueue[0],
        {
            method: 'GET'
        })
        randSongQueue.shift()
        preloadJson = await res.json().then(console.log(handleStatus(res.status)))
    }catch{
        if(randSongQueue.length === 0){
            console.log('Out of songs, loading next page')
            const res = await fetch(baseURL + 'next',
            {
                method: 'GET'
            })
            const queueLength = await res.json()
            for(let i = 0; i < queueLength.num; i++){
                randSongQueue.push(i)
            }
            randSongQueue = shuffleArray(randSongQueue)
            console.log('Queue Length: ' + queueLength.num)
            console.log('test')
            preloadNext()
        }
        else{
            console.log("Song failed to load, trying next song")
            preloadNext()
        }
    }
}

function formatLyrics(lyrics){
    //takes unformatted lyrics and randomly chooses 4 lines after a section header ex. [Chorus]
    //if no brackets present, returns first 4 lines
    //if unable to find 4 lines without a bracket, returns whatever lines currently being checked
    try{
    const indexes = []
    for(let i = 0; i < lyrics.length; i++){
        if(lyrics[i] === ']'){
            indexes.push(i)
        }
    }
    console.log('Format indexes: ' + indexes)
    while(true){
        if(indexes.length === 0){
            var increment = -1
        }
        else{
            let rand = Math.floor(Math.random() * indexes.length)
            var increment = indexes[rand]
            indexes.pop(rand)
        }
        var lines = 0
        var output = ""
        while(true){
            increment++
            if(lyrics[increment] === "[" && indexes.length === 0){
                return output
            }
            else if(lyrics[increment] === "[" | lyrics[increment] == null){
                break
            }
            else if(lyrics[increment] === "\n"){
                lines++
                if(lines === 5){
                    return output.trim()
                }
                output += " "
            }
            else{
                output += lyrics[increment]
            }
        }
    }
}
catch{
    console.log("error")
}
}

quoteInputElement.addEventListener('input', () => {
    const arrayDisplayQuote = quoteDisplayElement.querySelectorAll('span')
    //quote to display to user as spans (seperate from stored quote because characters may change)
    const arrayQuote = currQuote.split('')
    //quote to compare input against
    const arrayValue = quoteInputElement.value.split('')
    //inputted character array
    

    arrayDisplayQuote.forEach((characterSpan, index) =>{
        const character = arrayValue[index]
        characterSpan.classList.remove('blinking-cursor')
        if(characterSpan.nextElementSibling != null){
            characterSpan.nextElementSibling.classList.remove('blinking-cursorNL')
        }
        if(character == null){
            //character not entered (default)
            characterSpan.textContent = arrayQuote[index]
            characterSpan.classList.remove('correct')
            characterSpan.classList.remove('incorrect')
        }
        else if(character === arrayQuote[index]){
            //apply correct class to matching character
            characterSpan.classList.add('correct')
            characterSpan.classList.remove('incorrect')
        } else {
            //if space wrongly inputted, just display correct character in red to avoid spacing errors
            if(character === ' '){
                characterSpan.textContent = arrayQuote[index]
            }else{
                characterSpan.textContent = character
            }
            if(index + 1 === arrayValue.length){
                incorrectTotal++
            }
            //apply incorrect class to non matching character
            characterSpan.classList.add('incorrect')
            characterSpan.classList.remove('correct')
        }
        if(character != null && arrayValue[index + 1] == null && characterSpan.nextElementSibling != null){
            if(characterSpan.nextElementSibling.offsetTop > characterSpan.offsetTop){
                console.log("new line")
                console.log(characterSpan.nextElementSibling)
                characterSpan.nextElementSibling.classList.add('blinking-cursorNL')
            }
            else{
                characterSpan.classList.add('blinking-cursor')
            }
        }
    })
    
    if(arrayValue.length >= arrayDisplayQuote.length){
        //input greater/equal to quote, end quote typing
        getWPM(arrayDisplayQuote, arrayQuote.length, incorrectTotal)
        document.body.classList.add('typing-clear')
        document.body.classList.remove('typing')
        document.body.classList.remove('result-clear')
        resultTabIndex()
        lastinputtoggle = 0;
    }
})

const errorJson = {
    "title": "error",
    "artist": "maybe try a different",
    "album": "artist <3",
    "image": "blonde.png"
}

function serverError(){
    getWPM(0, 0, 1000)
    renderResults(errorJson)
    document.body.classList.add('typing-clear')
    document.body.classList.remove('typing')
    document.body.classList.remove('result-clear')
    console.log("server error")
    resultTabIndex()
}

function getWPM(arrayDisplayQuote, length, incorrectIn){
    let incorrect = 0;
    if(arrayDisplayQuote === 0){
        wpmRender.innerHTML = "wpm: :("
        accRender.innerHTML = "acc: :p"
        incorrectTotal = 0;
    }else{
        arrayDisplayQuote.forEach((characterSpan) => {
            if(characterSpan.classList == 'incorrect'){
                incorrect++
            }
        })
        const rawWPM = Math.ceil(length * (12/getTimerTime()))
        let adjWPM = 0;
        if(incorrect/length < .5){
            adjWPM = rawWPM - (incorrect * 3)
        }
        let adjTemp = Math.floor(((length-incorrectIn)/length)*100)
        if(adjTemp < 0){
            adjTemp = 0
        }
        wpmRender.innerHTML = "wpm: " + adjWPM
        accRender.innerHTML = "acc: " + adjTemp + "%"
        console.log("length: " + length + " incorrect: " + incorrectIn)
    
        console.log("Raw WPM: " + rawWPM)
        console.log('WPM: ' + adjWPM)
        incorrectTotal = 0;
    }
}

async function renderNewQuote(quote, redo){
    console.log("Rendering new quote...")
    currQuote = quote
    quoteDisplayElement.innerHTML = ''
    quote.split('').forEach(character => {
        const characterSpan = document.createElement('span')
        characterSpan.innerText = character
        quoteDisplayElement.appendChild(characterSpan)
    })
    if(!redo){
        setTimeout(() => {
            renderResults(preloadJson)
          }, 700);
        
    }
    quoteInputElement.value = null
    await firstInput(quoteInputElement)
    startTimer()
}

async function firstInput(obj){
    //console.log('input')
    return new Promise(resolve => obj.oninput = () => resolve())
}

function startTimer(){
    startTime = new Date()
}

function getTimerTime(){
    return Math.floor((new Date() - startTime)/1000)
}

function focusQuoteInput(){
    document.getElementById('quoteInput').focus()
}

function focusArtistInput(){
    document.getElementById('artistInput').focus()
}

function focusCurrInput(){
    if(document.body.classList.contains('typing')){
        focusQuoteInput()
    }
    else{
        focusArtistInput()
    }
}

function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array
}

function nextSong(){
    renderNewQuote(formatLyrics(preloadJson.lyrics), false)
    document.body.classList.add('result-clear')
    document.body.classList.remove('typing-clear')
    document.body.classList.add('typing')
    quoteInputTabIndex()
    setTimeout(preloadNext(), 500)
}

function redo(){
    renderNewQuote(formatLyrics(jsonData.lyrics), true)
    document.body.classList.remove('typing-clear')
    document.body.classList.add('typing')
    document.body.classList.add('result-clear')
}

function search(){
    document.body.classList.add('typing-clear')
    document.body.classList.remove('typing')
    document.body.classList.add('result-clear')
    document.body.classList.remove('artistTyping-clear')
    artistInput.value = ""
    artistInputTabIndex()
}

function renderResults(jsonIn){
    songTitle.innerHTML = jsonIn.title.toLowerCase() 
    songInfo.innerHTML = jsonIn.artist.toLowerCase() + "<br>" + jsonIn.album.toLowerCase();
    albumArt.src = jsonIn.image;
    textFit(songTitle, {minFontSize: 30, multiLine: true, alignVert: true, reProcess: true})
    textFit(songInfo, {reProcess:true})
    textFit(wpmRender, {reProcess:true})
    textFit(accRender, {reProcess:true})
}

function removeTabIndexes(){
    artistInput.tabIndex = -1
    quoteInputElement.tabIndex = -1
    continueBut.tabIndex = -1
    redoBut.tabIndex = -1
    searchBut.tabIndex = -1
    loading.tabIndex = -1
}

function artistInputTabIndex(){
    removeTabIndexes()
    artistInput.tabIndex = 1;
}

function quoteInputTabIndex(){
    removeTabIndexes()
    quoteInputElement.tabIndex = 1;
}

function resultTabIndex(){
    removeTabIndexes()
    quoteInputElement.blur();
    continueBut.tabIndex = 1;
    redoBut.tabIndex = 2;
    searchBut.tabIndex = 3;
}

addEventListener('resize', (event) => {
    textFit(songTitle, {minFontSize: 30, multiLine: true, alignVert: true, reProcess: true})
    textFit(songInfo, {reProcess: true})
});