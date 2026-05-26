// section-aware parsing for lyrics.
// brackets like [Verse 1] are the primary marker. some songs use (Chorus)
// in parens instead — we only fall back to paren markers when the song
// contains no brackets and the substring "(chorus)" appears somewhere.
const BRACKET_REGEX = /^\s*\[[^\]]+\]\s*$/;
const PARENTHESIS_REGEX = /^\s*\([^)]+\)\s*$/;

/**
 * Parse full lyrics into content lines (markers stripped) plus a list of
 * anchor indices — content-line positions where a new section begins.
 * @param {string} fullLyrics
 * @returns {{ contentLines: string[], anchors: number[] }}
 */
export function parseLyricSections(fullLyrics) {
    if (!fullLyrics || typeof fullLyrics !== 'string') {
        return { contentLines: [], anchors: [] };
    }
    const allLines = fullLyrics.split('\n').filter(l => l.trim().length > 0);

    let markerRe = null;
    if (allLines.some(l => BRACKET_REGEX.test(l))) {
        markerRe = BRACKET_REGEX;
    } else if (allLines.some(l => l.toLowerCase().includes('(chorus)'))) {
        markerRe = PARENTHESIS_REGEX;
    }

    if (!markerRe) {
        return {
            contentLines: allLines,
            anchors: allLines.length > 0 ? [0] : []
        };
    }

    const contentLines = [];
    const anchors = [];
    let pendingAnchor = false;
    for (const line of allLines) {
        if (markerRe.test(line)) {
            pendingAnchor = true;
        } else {
            if (pendingAnchor) {
                anchors.push(contentLines.length);
                pendingAnchor = false;
            }
            contentLines.push(line);
        }
    }

    // no marker preceded any content — fall back to line 0
    if (anchors.length === 0 && contentLines.length > 0) {
        anchors.push(0);
    }

    return { contentLines, anchors };
}

/**
 * Pick a starting content-line index based on selected max line length.
 * Selectable anchors = those with enough trailing content to fill maxLines.
 * Uniform random across selectable anchors. Falls back to 0.
 * @param {number} totalContentLines
 * @param {number[]} anchors
 * @param {number|'full'} maxLines
 * @returns {number}
 */
export function pickStartAnchor(totalContentLines, anchors, maxLines) {
    if (!anchors || anchors.length === 0) return 0;
    if (maxLines === 'full') return 0;
    const qualified = anchors.filter(a => totalContentLines - a >= maxLines);
    if (qualified.length === 0) return 0;
    return qualified[Math.floor(Math.random() * qualified.length)];
}
