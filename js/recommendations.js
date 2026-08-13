/* =========================================
   RECOMMENDATIONS SYSTEM
   Track user preferences and generate recommendations
   ========================================= */

const PREFS_KEY = 'userPreferences';
const isLocalApi = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = isLocalApi
    ? ''
    : window.location.origin;
const MOVIE_DATA_LOAD_DELAY = 1000;
console.log(window === globalThis);
console.log(window.showLongToast);
console.log(typeof window.showLongToast);
// Returns a stable UID for the current user (logged-in or anonymous guest)
function getActivityUID() {
    const stored = localStorage.getItem('userUID');
    if (stored && stored !== '0') return stored;
    let guestUID = localStorage.getItem('guestUID');
    if (!guestUID) {
        // Crypto-safe random hex ID for guests
        const arr = new Uint8Array(12);
        crypto.getRandomValues(arr);
        guestUID = 'g_' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('guestUID', guestUID);
        ensureGuestAccountRow(guestUID, true);
    }
    return guestUID;
}

function scheduleGuestWelcomeToasts() {
    const message2 = 'There are two ways of signing in, using the code that is available in profile settings (top left of the screen) mainly used for guest accounts, or using your email and password. The login code regenerates each time you log in with it so make sure to note down the updated version as well.';
    const message3 = 'Use the Anime → Movie switch in the navigation bar (top, left, or bottom depending on your device) to change the site\'s experience. Your account, watch history, and lists stay the same—the layout and recommendations simply adapt for anime or live-action content.';

    setTimeout(() => {
        if (typeof window.showLongToast === 'function') {
            window.showLongToast(message2, 16000);
        } else if (typeof window.showLimitToast === 'function') {
            window.showLimitToast(message2);
        }
    }, 17000);

    setTimeout(() => {
        if (typeof window.showLongToast === 'function') {
            window.showLongToast(message3, 16000);
        } else if (typeof window.showLimitToast === 'function') {
            window.showLimitToast(message3);
        }
    }, 24000);
}

function ensureGuestAccountRow(accountUID, showFirstVisitToast = false) {
    if (!accountUID || !accountUID.startsWith('g_')) return;
    try {
        fetch(`${API_BASE_URL}/users/guest/ensure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountUID, userLanguage: localStorage.getItem('userLanguage') || 'en' })
        })
        .then((response) => response.ok ? response.json() : Promise.reject(response))
        .then((data) => {
            const loginCode = data?.user?.loginCode;
            const isGuestValue = typeof data?.user?.is_guest !== 'undefined'
                ? String(data.user.is_guest === 1 ? 1 : 0)
                : '1';
            localStorage.setItem('is_guest_local', isGuestValue);
            if (loginCode) {
                localStorage.setItem('loginCode', loginCode);
            }

            if (showFirstVisitToast && !localStorage.getItem('guestNoticeShown')) {
                if (typeof window.showLongToast === 'function') {
                    window.showLongToast('Welcome! Your temporary guest account is ready. Save the login code from the account menu so you can sign in later.', 16000);
                } else if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('Welcome! Your temporary guest account is ready. Save the login code from the account menu so you can sign in later.');
                }
                localStorage.setItem('guestNoticeShown', 'true');
                scheduleGuestWelcomeToasts();
            }
        })
        .catch(() => {});
    } catch (_) {}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const guestUID = localStorage.getItem('guestUID');
        if (guestUID) ensureGuestAccountRow(guestUID);
    });
} else {
    const guestUID = localStorage.getItem('guestUID');
    if (guestUID) ensureGuestAccountRow(guestUID);
}

// Get or initialize user preferences
function getUserPreferences() {
    const prefs = localStorage.getItem(PREFS_KEY);
    const defaults = {
        genreClicks: {},      
        yearRangeClicks: {},  
        ratingPreference: 0,  
        watchedMovies: [],    
        clickedMovies: []     
    };

    if (!prefs) {
        return defaults;
    }

    try {
        const parsed = JSON.parse(prefs);
        return {
            ...defaults,
            ...parsed,
            genreClicks: parsed?.genreClicks && typeof parsed.genreClicks === 'object' ? parsed.genreClicks : {},
            yearRangeClicks: parsed?.yearRangeClicks && typeof parsed.yearRangeClicks === 'object' ? parsed.yearRangeClicks : {},
            watchedMovies: Array.isArray(parsed?.watchedMovies) ? parsed.watchedMovies : [],
            clickedMovies: Array.isArray(parsed?.clickedMovies) ? parsed.clickedMovies : []
        };
    } catch (error) {
        console.warn('Invalid preferences in storage, resetting:', error);
        return defaults;
    }
}

// Save user preferences
function saveUserPreferences(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// Track movie click
function trackMovieClick(movieId, genre, year, rating, title, itemType) {
    const prefs = getUserPreferences();
    
    if (genre) {
        const genres = genre.split(',').map(g => g.trim());
        genres.forEach(g => {
            prefs.genreClicks[g] = (prefs.genreClicks[g] || 0) + 1;
        });
    }
    
    if (year) {
        const yearInt = parseInt(year);
        let yearRange;
        if (yearInt >= 2020) yearRange = '2020s';
        else if (yearInt >= 2010) yearRange = '2010s';
        else if (yearInt >= 2000) yearRange = '2000s';
        else if (yearInt >= 1990) yearRange = '1990s';
        else yearRange = 'Classic';
        
        prefs.yearRangeClicks[yearRange] = (prefs.yearRangeClicks[yearRange] || 0) + 1;
    }
    
    saveUserPreferences(prefs);
    
    trackMovieClickOnServer(movieId, title, genre, rating, itemType);
}

// Track movie click on server (global click count + personal activity history)
async function trackMovieClickOnServer(movieId, title, genre, rating, itemType, continueFrom = null, finished = null) {
    try {
        // Global click counter (for "Popular on AniKino" sort)
        await fetch(`${API_BASE_URL}/movie/${movieId}/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error tracking click on server:', error);
    }
    try {
        // Personal watch history in activity.db
        const userUID = getActivityUID();
        const safeItemType = (itemType === 'tv' || itemType === 'anime') ? 'tv' : 'movie';
        const payload = { 
            userUID, 
            movie_id: String(movieId), 
            title: title || '', 
            genre: genre || '', 
            rating: rating || null, 
            item_type: safeItemType,
            continue_from: continueFrom,
            finished: finished 
        };
        console.log('[trackMovieClickOnServer] Posting /activity/watch', payload);
        const watchRes = await fetch(`${API_BASE_URL}/activity/watch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('[trackMovieClickOnServer] Response status:', watchRes.status);
    } catch (error) {
        console.error('[trackMovieClickOnServer] Error recording activity watch:', error);
    }
}

// Mark movie as watched
function markMovieWatched(movieId, rating) {
    const prefs = getUserPreferences();
    
    if (!prefs.watchedMovies.includes(movieId)) {
        prefs.watchedMovies.push(movieId);
    }
    
    if (rating) {
        const currentAvg = prefs.ratingPreference || 0;
        const watchedCount = prefs.watchedMovies.length;
        prefs.ratingPreference = ((currentAvg * (watchedCount - 1)) + parseFloat(rating)) / watchedCount;
    }
    
    saveUserPreferences(prefs);
}

// Get top genres from user preferences
function getTopGenres(limit = 3) {
    const prefs = getUserPreferences();
    const genres = Object.entries(prefs.genreClicks || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(entry => entry[0]);
    
    return genres;
}

// Get top year range from user preferences
function getTopYearRange() {
    const prefs = getUserPreferences();
    const yearRanges = Object.entries(prefs.yearRangeClicks || {})
        .sort((a, b) => b[1] - a[1]);
    
    if (yearRanges.length === 0) return null;
    return yearRanges[0][0];
}

// Get year range bounds
function getYearRangeBounds(yearRange) {
    switch (yearRange) {
        case '2020s': return [2020, 2030];
        case '2010s': return [2010, 2019];
        case '2000s': return [2000, 2009];
        case '1990s': return [1990, 1999];
        case 'Classic': return [1900, 1989];
        default: return [1900, 2030];
    }
}

// Generate recommendations
async function generateRecommendations(limit = 12) {
    const prefs = getUserPreferences();
    const topGenres = getTopGenres();
    const topYearRange = getTopYearRange();
    
    if (topGenres.length === 0) {
        return await getTopRatedMovies(limit);
    }
    
    try {
        let params = new URLSearchParams({
            limit: limit * 2, 
            sort: 'rating_desc'
        });
        
        if (topGenres.length > 0) {
            params.append('genre', topGenres[0]);
        }
        
        if (topYearRange) {
            const [minYear] = getYearRangeBounds(topYearRange);
            params.append('year', minYear);
        }
        
        const baseUrl = `${API_BASE_URL}/movies/library?${params}`;
        const source = window.getMovieSource ? window.getMovieSource() : 'local';
        const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
        const response = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
        let movies = await response.json();
        
        movies = movies.filter(m => !prefs.watchedMovies.includes(String(m.ID)));
        
        const myList = JSON.parse(localStorage.getItem('myList') || '[]');
        movies = movies.filter(m => !myList.includes(String(m.ID)));
        
        movies = movies.slice(0, limit);
        
        if (movies.length < limit) {
            const topRated = await getTopRatedMovies(limit - movies.length);
            movies = [...movies, ...topRated];
        }
        
        return movies;
    } catch (error) {
        console.error('Error generating recommendations:', error);
        return await getTopRatedMovies(limit);
    }
}

// Get top rated movies as fallback
async function getTopRatedMovies(limit = 12) {
    try {
        const baseUrl = `${API_BASE_URL}/movies/library?limit=${limit}&sort=rating_desc`;
        const source = window.getMovieSource ? window.getMovieSource() : 'local';
        const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
        const response = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
        const movies = await response.json();
        
        const myList = JSON.parse(localStorage.getItem('myList') || '[]');
        return movies.filter(m => !myList.includes(String(m.ID)));
    } catch (error) {
        console.error('Error fetching top rated movies:', error);
        return [];
    }
}

// Load and display recommendations
async function loadRecommendations() {
    const container = document.getElementById('recommendationsGrid');
    if (!container) return;
    
    container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
            Loading recommendations...
        </div>
    `;
    
    const movies = await generateRecommendations(12);
    
    if (movies.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                <p>No recommendations available. Browse some movies to get personalized suggestions!</p>
            </div>
        `;
        return;
    }
    
    // Render movies
    container.innerHTML = movies.map(movie => {
        const poster = movie.poster_full_url || '/img/LOGO_Short.png';
        const title = movie['Movie Name'] || movie.title || 'Unknown Title';
        const rating = movie.Rating || 'N/A';
        const genre = movie.Genre || '';
        
        return `
            <div class="movie-card" onclick="goToMovieInfo('${movie.ID}', '${escapeForAttribute(title)}', '${genre}', '${movie.release_date}', '${rating}')">
                <img src="${poster}" alt="${escapeForAttribute(title)}" loading="lazy">
                <div class="movie-overlay">
                    <h4>${escapeHtml(title)}</h4>
                    <span class="rating-pill">IMDb ${rating}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Navigate to movie info and track click
function goToMovieInfo(movieId, title, genre, releaseDate, rating) {
    const year = releaseDate ? releaseDate.split('-')[0] : null;
    trackMovieClick(movieId, genre, year, rating, title);
    // Also send to server-side activity DB
    if (window.trackActivity) window.trackActivity(movieId, title, genre, year, rating);
    window.location.href = `movieInfo.html?id=${movieId}&type=movie`;
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeForAttribute(text) {
    if (!text) return '';
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Auto-track movie clicks on movie info page
if (window.location.pathname.includes('movieInfo.html')) {
    const urlParams = new URLSearchParams(window.location.search);
    const movieId = urlParams.get('id');
    const movieInfoType = (urlParams.get('type') === 'tv' || urlParams.get('type') === 'anime') ? 'tv' : 'movie';
    
    window.addEventListener('load', () => {
        setTimeout(() => {
            // movieInfo.html does not expose data-* attrs for these fields.
            // Read visible fields and only track if metadata is actually populated.
            const title = (document.getElementById('title')?.textContent || '').trim();
            const genre = (document.getElementById('genre')?.textContent || '').trim();
            const rating = (document.getElementById('rating')?.textContent || '').trim();
            const year = (document.getElementById('year')?.textContent || '').trim();
            const hasRealTitle = title && title !== 'Loading...' && title !== '...';
            const hasMetadata = Boolean(genre || rating || (year && year !== '----'));
            
            if (movieId && hasRealTitle && hasMetadata) {
                trackMovieClick(movieId, genre, year, rating, title, movieInfoType);
            }
        }, MOVIE_DATA_LOAD_DELAY);
    });
}

// Initialize on personal list page
if (window.location.pathname.includes('personalList.html')) {
    window.addEventListener('DOMContentLoaded', () => {
        loadRecommendations();
    });
}

// Fetch user's server-side watch history
async function fetchActivityHistory(limit = 20) {
    try {
        const userUID = getActivityUID();
        const res = await fetch(`${API_BASE_URL}/activity/history?userUID=${encodeURIComponent(userUID)}&limit=${limit}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        return [];
    }
}

// Fetch user's top genres from server
async function fetchActivityGenres() {
    try {
        const userUID = getActivityUID();
        const res = await fetch(`${API_BASE_URL}/activity/genres?userUID=${encodeURIComponent(userUID)}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        return [];
    }
}

// ── My List persistence helpers ────────────────────────────────────────────

// Load list from DB into localStorage (call on page load)
async function loadMyListFromDB() {
    try {
        const userUID = getActivityUID();
        const res = await fetch(`${API_BASE_URL}/activity/list?userUID=${encodeURIComponent(userUID)}`);
        if (!res.ok) return;
        const dbItems = await res.json(); // [{id, type}, ...]
        if (!Array.isArray(dbItems) || dbItems.length === 0) return;
        // Merge: existing localStorage items + DB items, deduplicated by id
        let local = [];
        try { local = JSON.parse(localStorage.getItem('myList') || '[]'); } catch(e) {}
        if (!Array.isArray(local)) local = [];
        const normalized = local.map(i => (typeof i === 'object' && i) ? i : { id: String(i), type: 'movie' });
        const merged = [...normalized];
        for (const dbItem of dbItems) {
            if (!merged.find(l => l.id === dbItem.id)) merged.push(dbItem);
        }
        localStorage.setItem('myList', JSON.stringify(merged));
    } catch(e) {}
}

// Persist a single add/remove to DB
async function persistMyListChange(item_id, item_type, action) {
    try {
        const userUID = getActivityUID();
        await fetch(`${API_BASE_URL}/activity/list/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userUID, item_id: String(item_id), item_type: item_type || 'movie' })
        });
    } catch(e) {}
}

// Export functions for use in other scripts
window.recommendationsSystem = {
    trackMovieClick,
    markMovieWatched,
    generateRecommendations,
    loadRecommendations,
    getUserPreferences,
    fetchActivityHistory,
    fetchActivityGenres,
    getActivityUID,
    loadMyListFromDB,
    persistMyListChange
};

// Auto-sync My List from DB on every page load
loadMyListFromDB();


setTimeout(() => {
    console.log("5 seconds later:", window.showLongToast);
}, 5000);