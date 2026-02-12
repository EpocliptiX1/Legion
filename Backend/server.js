function loadLocalMoviesCsv() {
    console.log("\n------------------------------------------------");
    console.log("📂 DEBUG: SEARCHING FOR DATABASE...");
    console.log("   Server is running in:", __dirname);

    const candidates = [
        path.join(__dirname, '..', 'datasets', 'AITUCAP_Final_Database.csv'),       // 1. Up one level (usuall setup)
        path.join(__dirname, '..', '..', 'datasets', 'AITUCAP_Final_Database.csv'), // 2. Up two levels (Justttt in case)
        path.join(__dirname, 'datasets', 'AITUCAP_Final_Database.csv')              // 3. Inside a 'datasets' folder in the CURRENT directory
    ];

    let foundPath = null;

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            foundPath = p;
            break;
        }
    }

    if (!foundPath) {
        console.error("❌ FATAL: Could not find 'AITUCAP_Final_Database.csv'.");
        console.error("   I looked in these folders relative to server.js:");
        candidates.forEach(p => console.error(`   - ${p}`));
        console.log("------------------------------------------------\n");
        return [];
    }

    console.log(`✅ FOUND FILE AT: ${foundPath}`);

    try {
        const csvData = fs.readFileSync(foundPath, 'utf8');
        if (csvData.length === 0) {
            console.error("❌ ERROR: File exists but is EMPTY (0 bytes).");
            return [];
        }

        const records = csvParse.parse(csvData, { 
            columns: true, 
            skip_empty_lines: true 
        });
        
        console.log(`🎉 SUCCESS! Loaded ${records.length} movies.`);
        console.log("------------------------------------------------\n");
        return records;

    } catch (err) {
        console.error("❌ ERROR PARSING CSV:", err.message);
        return [];
    }
}
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');
const localCsvPath = path.join(__dirname, '..', 'datasets', 'AITUCAP_Final_Database.csv');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();
const YT_API_KEY = 'AIzaSyCGg0QqAURfPOs5OoCemTRBMrOxqtbw0tg';
const YOUTUBE_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const BCRYPT_SALT_ROUNDS = 10;
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || '';
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || '';
const LIBRETRANSLATE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';
const TMDB_API_KEY = 'f4705f0e34fafba5ccef5cc38a703fc5';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TRANSLATION_CACHE_FILE = path.join(__dirname, 'translation_cache.json');
const ADMIN_BOOTSTRAP_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || 'LegionCinemaAdmin@gmail.com';
const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'AdminPriv2.0';
const ADMIN_BOOTSTRAP_USERNAME = process.env.ADMIN_BOOTSTRAP_USERNAME || 'Legion Admin';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
if (ADMIN_BOOTSTRAP_EMAIL) {
    const normalized = ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase();
    if (normalized && !ADMIN_EMAILS.includes(normalized)) {
        ADMIN_EMAILS.push(normalized);
    }
}
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '')
    .split(',')
    .map(uid => parseInt(uid.trim(), 10))
    .filter(uid => !Number.isNaN(uid) && uid > 0);

function isAdminUser(user) {
    if (!user) return false;
    if (user.isAdmin === true) return true;
    const email = user.userEmail ? String(user.userEmail).trim().toLowerCase() : '';
    const uid = parseInt(user.userUID, 10);
    if (email && ADMIN_EMAILS.includes(email)) return true;
    if (uid && ADMIN_UIDS.includes(uid)) return true;
    return false;
}

const TMDB_GENRES = {
    action: 28,
    adventure: 12,
    animation: 16,
    comedy: 35,
    crime: 80,
    documentary: 99,
    drama: 18,
    family: 10751,
    fantasy: 14,
    history: 36,
    horror: 27,
    music: 10402,
    mystery: 9648,
    romance: 10749,
    'science fiction': 878,
    scifi: 878,
    'tv movie': 10770,
    thriller: 53,
    war: 10752,
    western: 37
};

const TMDB_GENRE_NAMES = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Science Fiction',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western'
};

function isTmdbConfigured() {
    return TMDB_API_KEY && TMDB_API_KEY !== 'YOUR_TMDB_API_KEY';
}

function loadTranslationCacheFile() {
    try {
        if (!fs.existsSync(TRANSLATION_CACHE_FILE)) {
            return {};
        }
        const raw = fs.readFileSync(TRANSLATION_CACHE_FILE, 'utf8');
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.warn('Translation cache read error:', err.message || err);
        return {};
    }
}

function saveTranslationCacheFile(cacheObj) {
    try {
        fs.writeFileSync(TRANSLATION_CACHE_FILE, JSON.stringify(cacheObj || {}, null, 2));
    } catch (err) {
        console.warn('Translation cache write error:', err.message || err);
    }
}

async function tmdbGet(path, params = {}) {
    if (!isTmdbConfigured()) {
        throw new Error('TMDB API key is not configured');
    }
    const url = `${TMDB_BASE_URL}${path}`;
    const response = await axios.get(url, {
        params: {
            api_key: TMDB_API_KEY,
            ...params
        }
    });
    return response.data;
}

function mapTmdbMovie(item) {
    const genreNames = Array.isArray(item.genre_ids)
        ? item.genre_ids.map(id => TMDB_GENRE_NAMES[id]).filter(Boolean)
        : (item.genres || []).map(g => g.name).filter(Boolean);

    const releaseYear = item.release_date ? item.release_date.split('-')[0] : '';

    return {
        ID: item.id,
        'Movie Name': item.title || item.name || 'Unknown',
        title: item.title || item.name || 'Unknown',
        Year: releaseYear || item.release_date || 'N/A',
        Released_Year: releaseYear || item.release_date || 'N/A',
        release_date: item.release_date || '',
        Rating: item.vote_average ?? 'N/A',
        Votes: item.vote_count ?? 0,
        Genre: genreNames.join(', ') || 'N/A',
        Plot: item.overview || 'No description available.',
        Overview: item.overview || 'No description available.',
        poster_full_url: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '/img/LOGO_Short.png',
        Poster: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '/img/LOGO_Short.png',
        Runtime: item.runtime ? `${item.runtime} min` : undefined,
        Status: item.status || '',
        budget: item.budget || 0,
        revenue: item.revenue || 0
    };
}

function mapTmdbMovieWithCredits(item, credits) {
    const mapped = mapTmdbMovie(item);
    const directors = (credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
    const cast = (credits?.cast || []).slice(0, 6).map(c => c.name);
    return {
        ...mapped,
        Directors: directors.join(', ') || 'N/A',
        Stars: cast.join(', ') || 'N/A'
    };
}

// --- 1. MIDDLEWARE ---
app.use(cors());
app.use(express.json()); 

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 1000,  //funny story, ratemlimited myself a  few times lol
    message: { error: 'Too many requests from this IP, please try again later.' }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 20, 
    message: { error: 'Too many requests from this IP, please try again later.' }
});

// Apply rate limiting to all routes
app.use(generalLimiter);

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

// DEBUG: Log all incoming requests (method, path, query)
app.use((req, res, next) => {
    console.log('REQ:', req.method, req.path, req.query);
    next();
});

// Friendly admin routes
app.get('/admin', (req, res) => res.redirect('/html/admin.html'));
app.get('/html/admin', (req, res) => res.redirect('/html/admin.html'));

function signUserToken(user) {
    const isAdmin = isAdminUser(user);
    return jwt.sign(
        {
            userUID: user.userUID,
            userEmail: user.userEmail,
            username: user.username,
            userTier: user.userTier,
            isAdmin
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        const adminAllowed = req.user && (req.user.isAdmin === true || isAdminUser(req.user));
        if (!adminAllowed) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        return next();
    });
}


// --- TMDB API KEY CHECK ENDPOINT ---
app.get('/api/tmdb-key-status', async (req, res) => {
    try {
        if (!isTmdbConfigured()) {
            return res.json({ valid: false, message: 'TMDB API key not configured.' });
        }
        const url = `${TMDB_BASE_URL}/authentication`;
        const response = await axios.get(url, { params: { api_key: TMDB_API_KEY } });
        if (response.data && response.data.success) {
            return res.json({ valid: true });
        } else {
            return res.json({ valid: false, message: response.data.status_message || 'TMDB API key invalid or unexpected data.' });
        }
    } catch (err) {
        return res.json({ valid: false, message: err.response?.data?.status_message || 'TMDB API key check failed.' });
    }
});

// --- YOUTUBE API KEY CHECK ENDPOINT ---
app.get('/api/youtube-key-status', async (req, res) => {
    try {
        if (!YT_API_KEY || YT_API_KEY.length < 10) {
            return res.json({ valid: false, error: 'No API key set' });
        }
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&type=video&maxResults=1&key=${YT_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (response.ok && data.items && data.items.length > 0) {
            return res.json({ valid: true });
        } else {
            return res.json({ valid: false, error: data.error || 'Invalid or quota-exceeded key' });
        }
    } catch (err) {
        return res.json({ valid: false, error: err.message });
    }
});

// --- 1.5 TRANSLATION PROXY ---
app.post('/translate', async (req, res) => {
    try {
        const { text, target_lang, source_lang } = req.body || {};
        const texts = Array.isArray(text) ? text : [text];
        const filtered = texts.filter(t => typeof t === 'string' && t.trim().length > 0);

        if (filtered.length === 0 || !target_lang) {
            return res.status(400).json({ error: 'text and target_lang required' });
        }

        const target = String(target_lang).toUpperCase();
        const source = source_lang && String(source_lang).toUpperCase() !== 'AUTO'
            ? String(source_lang).toUpperCase()
            : undefined;

        if (LIBRETRANSLATE_URL) {
            const requestConfig = {
                headers: { 'Content-Type': 'application/json' }
            };

            const translateOne = async (inputText) => {
                try {
                    const response = await axios.post(
                        LIBRETRANSLATE_URL,
                        {
                            q: inputText,
                            source: source ? source.toLowerCase() : 'auto',
                            target: target.toLowerCase(),
                            format: 'text',
                            api_key: LIBRETRANSLATE_API_KEY || undefined
                        },
                        requestConfig
                    );

                    if (response.data?.translatedText) {
                        return response.data.translatedText;
                    }

                    if (Array.isArray(response.data?.translations) && response.data.translations[0]) {
                        const candidate = response.data.translations[0].text || response.data.translations[0].translatedText;
                        return candidate || inputText;
                    }

                    return inputText;
                } catch (err) {
                    const detail = err.response?.data || err.message;
                    console.warn('LibreTranslate item error:', detail);
                    return inputText;
                }
            };

            const translatedTexts = await Promise.all(filtered.map(translateOne));
            return res.json({ translations: translatedTexts.map(text => ({ text })) });
        }

        if (GOOGLE_TRANSLATE_API_KEY) {
            const response = await axios.post(
                'https://translation.googleapis.com/language/translate/v2',
                {
                    q: filtered,
                    target: target.toLowerCase(),
                    source: source ? source.toLowerCase() : undefined,
                    format: 'text',
                    key: GOOGLE_TRANSLATE_API_KEY
                }
            );

            const translations = (response.data?.data?.translations || []).map(t => ({
                text: t.translatedText
            }));

            return res.json({ translations });
        }

        return res.status(400).json({ error: 'No translation provider configured' });
    } catch (error) {
        const detail = error.response?.data || error.message;
        console.error('Translation Proxy Error:', detail);
        res.status(500).json({ error: 'Translation failed', detail });
    }
});

// --- 1.6 TRANSLATION CACHE PERSISTENCE ---
app.get('/translation-cache', (req, res) => {
    const cache = loadTranslationCacheFile();
    res.json({ cache });
});

app.post('/translation-cache', (req, res) => {
    const { cache, replace } = req.body || {};
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
        return res.status(400).json({ error: 'cache object required' });
    }

    const existing = replace ? {} : loadTranslationCacheFile();
    const merged = { ...existing, ...cache };
    saveTranslationCacheFile(merged);
    return res.json({ ok: true, size: Object.keys(merged).length });
});


// --- 2. DATABASE SETUP ---
const dbPath = path.join(__dirname, '..', 'datasets', 'movies.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database error:", err.message);
    else console.log("✅ Connected to movies database");
});

const usersDbPath = path.join(__dirname, 'users.db');
const usersDb = new sqlite3.Database(usersDbPath, (err) => {
    if (err) console.error("Users DB error:", err.message);
    else console.log("✅ Connected to users database");
    usersDb.run(`CREATE TABLE IF NOT EXISTS users (
        userUID INTEGER PRIMARY KEY,
        username TEXT,
        userEmail TEXT UNIQUE,
        userTier TEXT,
        userLanguage TEXT,
        searchCount INTEGER,
        viewCount INTEGER,
        allUIDs TEXT,
        userPassword TEXT
    )`);
});

// --- 3. REVIEWS FILE SETUP ---
const reviewsDir = path.join(__dirname, 'backend');
const reviewsPath = path.join(reviewsDir, 'reviews.json');
const usersPath = path.join(reviewsDir, 'users.json');

// Create folder if it doesn't exist
if (!fs.existsSync(reviewsDir)) {
    fs.mkdirSync(reviewsDir);
}
// Create file if it doesn't exist
if (!fs.existsSync(reviewsPath)) {
    fs.writeFileSync(reviewsPath, JSON.stringify([])); // Start with an empty list []
}
// Create users file if it doesn't exist
if (!fs.existsSync(usersPath)) {
    fs.writeFileSync(usersPath, JSON.stringify([]));
}

async function ensureAdminUser() {
    try {
        if (!ADMIN_BOOTSTRAP_EMAIL || !ADMIN_BOOTSTRAP_PASSWORD) return;
        const data = fs.readFileSync(usersPath, 'utf8');
        const users = JSON.parse(data) || [];
        const exists = users.find(u => String(u.userEmail).toLowerCase() === String(ADMIN_BOOTSTRAP_EMAIL).toLowerCase());
        if (exists) return;

        const maxUID = users.reduce((max, u) => Math.max(max, parseInt(u.userUID, 10) || 0), 0);
        const newUID = maxUID + 1;
        const hashedPassword = await bcrypt.hash(ADMIN_BOOTSTRAP_PASSWORD, BCRYPT_SALT_ROUNDS);

        const userRecord = {
            username: ADMIN_BOOTSTRAP_USERNAME,
            userUID: newUID,
            userEmail: ADMIN_BOOTSTRAP_EMAIL,
            userTier: 'Gold',
            userLanguage: 'en',
            searchCount: 0,
            viewCount: 0,
            allUIDs: users.map(u => parseInt(u.userUID, 10)).filter(n => !Number.isNaN(n)).concat(newUID),
            userPassword: hashedPassword
        };

        users.push(userRecord);
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
        console.log('✅ Admin bootstrap user created:', ADMIN_BOOTSTRAP_EMAIL);
    } catch (err) {
        console.error('Admin bootstrap error:', err);
    }
}

// --- 3.5 FORUM FILES SETUP ---
const forumMoviesPath = path.join(reviewsDir, 'forum_movies.json');
const forumThreadsPath = path.join(reviewsDir, 'forum_threads.json');

if (!fs.existsSync(forumMoviesPath)) {
    fs.writeFileSync(forumMoviesPath, JSON.stringify([]));
}
if (!fs.existsSync(forumThreadsPath)) {
    fs.writeFileSync(forumThreadsPath, JSON.stringify([]));
}

ensureAdminUser();

// =========================================
//  4. MOVIE READ ROUTES
// =========================================

app.get('/search', (req, res) => {
    const query = req.query.q;
    const source = String(req.query.source || 'local').toLowerCase();
    if (source === 'api') {
        tmdbGet('/search/movie', { query, page: 1, include_adult: false })
            .then(data => {
                const today = new Date().toISOString().slice(0, 10);
                const results = (data.results || [])
                    .filter(m => m.release_date && m.release_date <= today)
                    .filter(m => (m.vote_count || 0) >= 100)
                    .filter(m => (m.vote_average || 0) >= 4.5)
                    .slice(0, 10)
                    .map(mapTmdbMovie);
                res.json(results);
            })
            .catch(err => {
                const detail = err.response?.data || err.message;
                res.status(500).json({ error: 'TMDB search failed', detail });
            });
        return;
    }
    const sql = `
        SELECT m.*, COALESCE(c.click_count, 0) as clicks 
        FROM movies m 
        LEFT JOIN movie_clicks c ON m.ID = c.movie_id 
        WHERE "Movie Name" LIKE ? AND CAST(SUBSTR(m.release_date, -4) AS INTEGER) <= ?
        ORDER BY clicks DESC, Rating DESC 
        LIMIT 10
    `;
    const currentYear = new Date().getFullYear();
    db.all(sql, [`%${query}%`, currentYear], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/movie/:id', (req, res) => {
    const id = req.params.id;
    const source = String(req.query.source || 'local').toLowerCase();
    if (source === 'api') {
        Promise.all([
            tmdbGet(`/movie/${id}`, { language: 'en-US' }),
            tmdbGet(`/movie/${id}/credits`, { language: 'en-US' })
        ])
            .then(([data, credits]) => res.json(mapTmdbMovieWithCredits(data, credits)))
            .catch(err => {
                const detail = err.response?.data || err.message;
                res.status(500).json({ error: 'TMDB movie failed', detail });
            });
        return;
    }
    const sql = `
        SELECT m.*, COALESCE(c.click_count, 0) as clicks 
        FROM movies m 
        LEFT JOIN movie_clicks c ON m.ID = c.movie_id 
        WHERE m.ID = ?
    `;
    db.get(sql, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Movie not found" });
        res.json(row);
    });
});

app.post('/movie/:id/click', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid movie ID" });
    
    db.run(
        'INSERT INTO movie_clicks (movie_id, click_count) VALUES (?, 1) ON CONFLICT(movie_id) DO UPDATE SET click_count = click_count + 1',
        [id],
        function(err) {
            if (err) {
                console.error('Error tracking click:', err);
                return res.status(500).json({ error: "Could not track click" });
            }
            res.json({ success: true, clicks: this.changes });
        }
    );
});

app.get('/movies/library', async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const sortMode = req.query.sort || 'popularity_desc';
    const minYear = parseInt(req.query.year) || 1900;
    const genre = req.query.genre || '';
    const actor = req.query.actor || '';
    const director = req.query.director || '';
    const source = String(req.query.source || 'local').toLowerCase();
    const hydrate = String(req.query.hydrate || '') === '1';

    if (source === 'local') {
        let movies = loadLocalMoviesCsv();
        const minYear = parseInt(req.query.minYear || req.query.year) || 1900;
        const maxYear = parseInt(req.query.maxYear) || new Date().getFullYear();
        const genre = req.query.genre || '';
        const actor = req.query.actor || '';
        const director = req.query.director || '';
        const sortMode = req.query.sort || 'rating_desc';
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        movies = movies.filter(m => {
            const y = parseInt(m.release_date ? m.release_date.split('/').pop() : m.Year || m.year || '');
            if (isNaN(y) || y < minYear || y > maxYear) return false;
            if (genre && (!m.Genre || !m.Genre.toLowerCase().includes(genre.toLowerCase()))) return false;
            if (actor && (!m.Stars || !m.Stars.toLowerCase().includes(actor.toLowerCase()))) return false;
            if (director && (!m.Directors || !m.Directors.toLowerCase().includes(director.toLowerCase()))) return false;
            return true;
        });
        if (sortMode === 'rating_desc') {
            movies.sort((a, b) => parseFloat(b.Rating || 0) - parseFloat(a.Rating || 0));
        } else if (sortMode === 'date_desc') {
            movies.sort((a, b) => {
                const ay = parseInt(a.release_date ? a.release_date.split('/').pop() : a.Year || a.year || 0);
                const by = parseInt(b.release_date ? b.release_date.split('/').pop() : b.Year || b.year || 0);
                return by - ay;
            });
        } 
        movies = movies.slice(offset, offset + limit);
        res.json(movies);
        return;
    } else if (source === 'api') {
        try {
            const today = new Date().toISOString().slice(0, 10);
            // Map sort modes to TMDB API sort parameters
            // 'rating_desc' (Top Rated) uses vote_average.desc, but we enforce a vote_count.gte floor to avoid obscure movies
            // 'popularity_desc' and 'clicks_desc' use popularity.desc, which is heavily influenced by vote count and recent activity
            const sortMap = {
                rating_desc: 'vote_average.desc', 
                popularity_desc: 'popularity.desc', 
                clicks_desc: 'popularity.desc',
                date_desc: 'primary_release_date.desc',
                date_new: 'primary_release_date.desc',
                date_old: 'primary_release_date.asc',
                duration_desc: 'popularity.desc',
                success_desc: 'revenue.desc'
            };

            const genreKey = String(genre || '').trim().toLowerCase();
            const genreId = TMDB_GENRES[genreKey];

            const personQuery = (actor || director).trim();
            let personId = null;
            if (personQuery) {
                const personData = await tmdbGet('/search/person', { query: personQuery, page: 1 });
                personId = personData.results?.[0]?.id || null;
            }

            const pageSize = 20;
            const start = Math.max(0, offset);
            const end = start + Math.min(100, limit);
            const startPage = Math.floor(start / pageSize) + 1;
            const endPage = Math.floor((end - 1) / pageSize) + 1;

            let voteCountFloor = 20;
            if (sortMode === 'rating_desc') voteCountFloor = 200; 
            if (sortMode === 'rating_asc') voteCountFloor = 5;
            if (sortMode === 'success_asc') voteCountFloor = 100; 
            const params = {
                sort_by: sortMap[sortMode] || 'vote_average.desc',
                include_adult: false,
                page: startPage,
                'primary_release_date.lte': today,
                'with_runtime.gte': 60,
                'vote_count.gte': voteCountFloor
            };
            if (sortMode !== 'rating_asc') {
                params['vote_average.gte'] = 4.5;
            }

            if (minYear) {
                params['primary_release_date.gte'] = `${minYear}-01-01`;
            }
            if (genreId) params.with_genres = genreId;
            if (personId && actor) params.with_cast = personId;
            if (personId && director) params.with_crew = personId;

            const pagesToFetch = Math.min(3, endPage - startPage + 1);
            const pageResults = [];
            for (let i = 0; i < pagesToFetch; i++) {
                const page = startPage + i;
                const data = await tmdbGet('/discover/movie', { ...params, page });
                pageResults.push(...(data.results || []));
            }

            const sliced = pageResults
                .filter(m => m.release_date && m.release_date <= today)
                .slice(start % pageSize, (start % pageSize) + limit);

            if (!hydrate) {
                res.json(sliced.map(mapTmdbMovie));
                return;
            }

            const hydrated = await Promise.all(sliced.map(async (m) => {
                try {
                    const detail = await tmdbGet(`/movie/${m.id}`, { 
                        language: 'en-US',
                        append_to_response: 'credits'
                    });
                    return detail;
                } catch {
                    return m;
                }
            }));

            const filtered = hydrated.filter(m => {
                const releaseDate = m.release_date || '';
                const runtime = parseInt(String(m.runtime || m.Runtime || '').replace(/\D/g, ''), 10) || 0;
                const status = m.status || m.Status || '';
                return releaseDate && releaseDate <= today && runtime >= 60 && status === 'Released';
            });

            res.json(filtered.map(m => {
                if (m.credits) {
                    return mapTmdbMovieWithCredits(m, m.credits);
                }
                return mapTmdbMovie(m);
            }));
        } catch (err) {
            const detail = err.response?.data || err.message;
            res.status(500).json({ error: 'TMDB library failed', detail });
        }
        return;
    }


    let sql = `SELECT m.*, COALESCE(c.click_count, 0) as clicks FROM movies m LEFT JOIN movie_clicks c ON m.ID = c.movie_id WHERE 1=1`;
    let params = [];

    const currentYear = new Date().getFullYear();
    // 1. Filter by Year (Released after X) + exclude future
    // Extract year from MM/DD/YYYY format (last 4 chars)
    sql += ` AND CAST(SUBSTR(m.release_date, LENGTH(m.release_date) - 3, 4) AS INTEGER) >= ? AND CAST(SUBSTR(m.release_date, LENGTH(m.release_date) - 3, 4) AS INTEGER) <= ?`;
    params.push(minYear, currentYear);

    // 2. Filter by Genre
    if (genre) {
        sql += ` AND m.Genre LIKE ?`;
        params.push(`%${genre}%`);
    }

    // 3. Filter by Actor
    if (actor) {
        sql += ` AND m.Stars LIKE ?`;
        params.push(`%${actor}%`);
    }

    // 4. Filter by Director
    if (director) {
        sql += ` AND m.Directors LIKE ?`;
        params.push(`%${director}%`);
    }

    // 5. Filter out movies with missing or zero revenue/rating/votes/status for relevant sorts
    if (["success_desc","success_asc"].includes(sortMode)) {
        sql += ` AND m.revenue IS NOT NULL AND m.revenue != '' AND m.revenue != 'N/A' AND CAST(m.revenue AS FLOAT) > 0`;
    }
    if (["rating_desc","rating_income_desc","rating_asc"].includes(sortMode)) {
        sql += ` AND m.Rating IS NOT NULL AND m.Rating != '' AND m.Rating != 'N/A' AND CAST(m.Rating AS FLOAT) > 0`;
    }
    if (["popularity_desc"].includes(sortMode)) {
        sql += ` AND m.Votes IS NOT NULL AND m.Votes != '' AND m.Votes != 'N/A' AND CAST(m.Votes AS INTEGER) >= 50`;
    }
    // Filter out movies with low votes, unknown status, or missing/invalid data for all sorts
    sql += ` AND m.Votes IS NOT NULL AND m.Votes != '' AND m.Votes != 'N/A' AND CAST(m.Votes AS INTEGER) >= 50`;
    // Only filter by Status if column exists
    try {
        db.get("SELECT Status FROM movies LIMIT 1", (err, row) => {
            if (!err && row && typeof row.Status !== 'undefined') {
                sql += ` AND m.Status IS NOT NULL AND m.Status != '' AND m.Status != 'N/A' AND m.Status = 'Released'`;
            }
        });
    } catch (e) { /* just ignoree */ }

    // 5. Apply Sorting
    let orderBy = `CAST(m.Rating AS FLOAT) DESC`; 

    if (sortMode === 'date_desc') {
        orderBy = `CASE WHEN m.release_date IS NULL OR m.release_date = 'N/A' THEN 1 ELSE 0 END, CAST(SUBSTR(m.release_date, -4) AS INTEGER) DESC`;
    } 
    else if (sortMode === 'duration_desc') {
        orderBy = `CASE WHEN m.Runtime IS NULL OR m.Runtime = 'N/A' THEN 1 ELSE 0 END, CAST(REPLACE(m.Runtime, ' min', '') AS INTEGER) DESC`;
    } 
    else if (sortMode === 'success_desc') {
        orderBy = `CASE WHEN m.revenue IS NULL OR m.revenue = 'N/A' THEN 1 ELSE 0 END, ((CAST(m.revenue AS FLOAT) - CAST(m.budget AS FLOAT)) / NULLIF(CAST(m.budget AS FLOAT), 0)) DESC`;
    } 
    else if (sortMode === 'success_asc') {
        
        orderBy = `CASE WHEN m.revenue IS NULL OR m.revenue = 'N/A' OR m.revenue = '' OR CAST(m.revenue AS FLOAT) = 0 OR CAST(m.revenue AS FLOAT) > 10000000 THEN 1 ELSE 0 END, CAST(m.revenue AS FLOAT) ASC`;
    }
    else if (sortMode === 'rating_income_desc') {
        orderBy = `CASE WHEN m.Rating IS NULL OR m.Rating = 'N/A' OR m.revenue IS NULL OR m.revenue = 'N/A' THEN 1 ELSE 0 END, (CAST(m.Rating AS FLOAT) / NULLIF(CAST(m.revenue AS FLOAT), 0)) DESC`;
    }
    else if (sortMode === 'popularity_desc') {
        orderBy = `CASE WHEN m.Votes IS NULL OR m.Votes = 'N/A' THEN 1 ELSE 0 END, CAST(m.Votes AS INTEGER) DESC`;
    }

    else if (sortMode === 'clicks_desc') {
        orderBy = `CASE WHEN clicks IS NULL THEN 1 ELSE 0 END, clicks DESC`;
    }
    else {
        orderBy = `CASE WHEN m.Votes IS NULL OR m.Votes = '' OR m.Votes = 'N/A' THEN 1 ELSE 0 END, CAST(m.Votes AS INTEGER) DESC, CASE WHEN m.Rating IS NULL OR m.Rating = 'N/A' THEN 1 ELSE 0 END, CAST(m.Rating AS FLOAT) DESC`;
    }

    sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows || []);
    });
});

// =========================================
//  5. RECOMMENDATION ROUTES
// =========================================

app.get('/recommend/genre', (req, res) => {
    const { genre, exclude } = req.query;
    if (!genre) return res.json([]);
    const firstGenre = genre.split(',')[0].trim(); 
    const sql = `
        SELECT *, 
        ((CAST(revenue AS FLOAT)/CASE WHEN CAST(budget AS FLOAT)=0 THEN 1 ELSE CAST(budget AS FLOAT) END)*0.4 + (CAST(Votes AS FLOAT)/100000)*0.6)*Rating as smart_score
        FROM movies 
        WHERE Genre LIKE ? AND ID != ? 
        ORDER BY smart_score DESC LIMIT 20`;
    db.all(sql, [`%${firstGenre}%`, exclude], (err, rows) => res.json(rows || []));
});

app.get('/recommend/actors', (req, res) => {
    const { val, exclude } = req.query;
    const sql = `SELECT * FROM movies WHERE Stars LIKE ? AND ID != ? ORDER BY (CAST(Votes AS INTEGER) * Rating) DESC LIMIT 20`;
    db.all(sql, [`%${val}%`, exclude], (err, rows) => res.json(rows || []));
});

app.get('/recommend/director', (req, res) => {
    const { val, exclude } = req.query;
    const sql = `SELECT * FROM movies WHERE Directors LIKE ? AND ID != ? ORDER BY (CAST(Votes AS INTEGER) * Rating) DESC LIMIT 20`;
    db.all(sql, [`%${val}%`, exclude], (err, rows) => res.json(rows || []));
});

app.get('/recommend/timeline', (req, res) => {
    const targetYear = parseInt(req.query.year);
    const exclude = req.query.exclude;
    if (!targetYear) return res.json([]);

    const sql = `
        SELECT * FROM movies 
        WHERE CAST(SUBSTR(release_date, -4) AS INTEGER) BETWEEN ? AND ?
        AND ID != ? 
        ORDER BY (CAST(Votes AS INTEGER) * Rating) DESC 
        LIMIT 20
    `;
    db.all(sql, [targetYear - 5, targetYear + 5, exclude], (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows || []);
    });
});

// =========================================
//  6. "MY LIST" ROUTE
// =========================================
app.post('/movies/get-list', (req, res) => {
    const ids = req.body.ids; 
    const source = String(req.query.source || 'local').toLowerCase();
    if (!ids || ids.length === 0) return res.json([]);

    if (source === 'api') {
        Promise.all(ids.map(id => tmdbGet(`/movie/${id}`, { language: 'en-US' }).then(mapTmdbMovie).catch(() => null)))
            .then(results => res.json(results.filter(Boolean)))
            .catch(err => {
                const detail = err.response?.data || err.message;
                res.status(500).json({ error: 'TMDB list failed', detail });
            });
        return;
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `SELECT * FROM movies WHERE ID IN (${placeholders})`;
    
    db.all(sql, ids, (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows || []);
    });
});

// =========================================
//  7. YOUTUBE TRAILER SEARCH (API) with Caching
// =========================================
app.get('/youtube/search', async (req, res) => {
    const movieName = req.query.name;
    if (!movieName) return res.status(400).json({ error: "Movie name required" });
    
    try {
        const normalizedName = movieName.toLowerCase().trim();
        const now = Date.now();
        
        // Check cache first
        const cached = await new Promise((resolve, reject) => {
            db.get(
                'SELECT video_id, cached_at FROM youtube_cache WHERE movie_name = ?',
                [normalizedName],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
        
        // If cache exists and not expired, return it
        if (cached && (now - cached.cached_at) < YOUTUBE_CACHE_EXPIRY_MS) {
            console.log(`[YouTube] Cache hit: ${movieName} -> ${cached.video_id}`);
            return res.json({ videoId: cached.video_id, cached: true });
        }
        
        // Cache miss or expired, fetch from API
        const query = encodeURIComponent(movieName + " official trailer");
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&maxResults=1&type=video&key=${YT_API_KEY}`;
        console.log(`[YouTube] Searching: ${movieName}`);
        const response = await fetch(url);
        const data = await response.json();
        
        // Log full response for debugging
        if (!response.ok || data.error) {
            console.error(`[YouTube] API Error:`, data);
            return res.status(response.status || 500).json({ error: data.error || "YouTube API error" });
        }
        
        const videoId = data.items?.[0]?.id?.videoId || "";
        console.log(`[YouTube] Found video: ${videoId || "None"}`);
        
        // Save to cache
        if (videoId) {
            db.run(
                'INSERT OR REPLACE INTO youtube_cache (movie_name, video_id, cached_at) VALUES (?, ?, ?)',
                [normalizedName, videoId, now],
                (err) => {
                    if (err) console.error('[YouTube] Cache save error:', err);
                    else console.log(`[YouTube] Cached: ${movieName} -> ${videoId}`);
                }
            );
        }
        
        res.json({ videoId, cached: false });
    } catch (err) {
        console.error("[YouTube] Network error:", err);
        res.status(500).json({ error: "Could not fetch trailer" });
    }
});

// =========================================
//  8. REVIEW ROUTES (JSON File)
// =========================================

app.get('/reviews', (req, res) => {
    try {
        console.log('GET /reviews query:', req.query);
        const data = fs.readFileSync(reviewsPath, 'utf8');
        let reviews = JSON.parse(data) || [];
        const movieId = req.query.movieId;
        console.log('Filtering by movieId:', movieId);
        if (movieId) {
            reviews = reviews.filter(r => r.movieId && String(r.movieId) === String(movieId));
        }
        res.json(reviews);
    } catch (err) {
        console.error("Error reading reviews:", err);
        res.status(500).json({ error: "Could not read reviews" });
    }
});

// Post a new review
app.post('/reviews', (req, res) => {
    try {
        const data = fs.readFileSync(reviewsPath, 'utf8');
        const reviews = JSON.parse(data);

        // Normalize incoming payload and ensure fields
        const newReview = {
            user: req.body.user || 'Guest',
            pfp: req.body.pfp || null,
            movieTitle: req.body.movieTitle || req.body.movie || null,
            movieId: req.body.movieId || null,
            stars: parseInt(req.body.stars, 10) || 0,
            text: req.body.text || '',
            createdAt: new Date().toISOString()
        };
        
        reviews.unshift(newReview); 
        
        fs.writeFileSync(reviewsPath, JSON.stringify(reviews, null, 2));
        res.status(200).json({ message: "Review saved!" });
    } catch (err) {
        console.error("Error saving review:", err);
        res.status(500).json({ error: "Could not save review" });
    }
});

// =========================================
//  8. PLAYLISTS FILE SETUP
// =========================================
// Playlists file will live alongside reviews
const playlistsPath = path.join(reviewsDir, 'playlists.json');
if (!fs.existsSync(playlistsPath)) {
    fs.writeFileSync(playlistsPath, JSON.stringify([]));
}

// =========================================
//  8.5 USERS FILE SETUP & ROUTES
// =========================================

app.post('/users', requireAuth, async (req, res) => {
    try {
        const data = fs.readFileSync(usersPath, 'utf8');
        const users = JSON.parse(data) || [];
        const {
            username,
            userUID,
            userEmail,
            userTier,
            userLanguage,
            searchCount,
            viewCount,
            allUIDs
        } = req.body || {};

        const uidNum = parseInt(req.user.userUID, 10);
        if (!uidNum) return res.status(401).json({ error: 'Invalid token user' });

        if (userUID !== undefined && parseInt(userUID, 10) !== uidNum) {
            return res.status(403).json({ error: 'Cannot update another user' });
        }

        const idx = users.findIndex(u => parseInt(u.userUID, 10) === uidNum);
        if (idx === -1) return res.status(404).json({ error: 'User not found' });
        
        const userRecord = {
            username: username || users[idx].username,
            userUID: uidNum,
            userEmail: userEmail || users[idx].userEmail || '',
            userTier: userTier || users[idx].userTier || 'Free',
            userLanguage: userLanguage || users[idx].userLanguage || 'en',
            searchCount: parseInt(searchCount, 10) || 0,
            viewCount: parseInt(viewCount, 10) || 0,
            allUIDs: Array.isArray(allUIDs) ? allUIDs : users[idx].allUIDs || []
        };

        users[idx] = { ...users[idx], ...userRecord };

        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
        res.json(userRecord);
    } catch (err) {
        console.error('Error saving user:', err);
        res.status(500).json({ error: 'Could not save user' });
    }
});

// Register new user (assign unique UID, prevent email duplicates)
app.post('/users/register', strictLimiter, async (req, res) => {
    try {
        const { username, userEmail, userTier, userPassword, userLanguage } = req.body || {};
        if (!username || !userEmail || !userPassword) {
            return res.status(400).json({ error: 'username, email, and password required' });
        }
        usersDb.get('SELECT * FROM users WHERE userEmail = ?', [userEmail], async (err, row) => {
            if (row) return res.status(409).json({ error: 'Email already registered' });
            usersDb.get('SELECT MAX(userUID) as maxUID FROM users', async (err2, row2) => {
                const newUID = (row2 && row2.maxUID ? row2.maxUID : 1) + 1;
                const hashedPassword = await bcrypt.hash(userPassword, BCRYPT_SALT_ROUNDS);
                const userRecord = {
                    username,
                    userUID: newUID,
                    userEmail,
                    userTier: userTier || 'Free',
                    userLanguage: userLanguage || 'en',
                    searchCount: 0,
                    viewCount: 0,
                    allUIDs: [newUID],
                    userPassword: hashedPassword
                };
                usersDb.run(`INSERT INTO users (userUID, username, userEmail, userTier, userLanguage, searchCount, viewCount, allUIDs, userPassword) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userRecord.userUID, userRecord.username, userRecord.userEmail, userRecord.userTier, userRecord.userLanguage, userRecord.searchCount, userRecord.viewCount, JSON.stringify(userRecord.allUIDs), userRecord.userPassword],
                    function (err3) {
                        if (err3) return res.status(500).json({ error: 'Could not register user' });
                        // Save to users.json as well, might have removed this in favor of SQLite but keeping for compatibility with existing data structure
                        let users = [];
                        try {
                            if (fs.existsSync(usersPath)) {
                                users = JSON.parse(fs.readFileSync(usersPath, 'utf8')) || [];
                            }
                        } catch (e) { users = []; }
                        users.push({ ...userRecord, allUIDs: userRecord.allUIDs });
                        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        const { userPassword: _userPassword, ...safeUser } = userRecord;
                        safeUser.isAdmin = isAdminUser(userRecord);
                        const token = signUserToken(safeUser);
                        res.json({ token, user: safeUser });
                    }
                );
            });
        });
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(500).json({ error: 'Could not register user' });
    }
});

// Authenticate user by email + password
app.post('/users/auth', strictLimiter, async (req, res) => {
    try {
        const { userEmail, userPassword } = req.body || {};
        if (!userEmail || !userPassword) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        usersDb.get('SELECT * FROM users WHERE userEmail = ?', [userEmail], async (err, user) => {
            if (!user) return res.status(401).json({ error: 'Invalid credentials' });
            const passwordMatch = await bcrypt.compare(userPassword, user.userPassword);
            if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });
            const { userPassword: _userPassword, ...safeUser } = user;
            safeUser.isAdmin = isAdminUser(user);
            const token = signUserToken(safeUser);
            res.json({ token, user: safeUser });
        });
    } catch (err) {
        console.error('Error authenticating user:', err);
        res.status(500).json({ error: 'Could not authenticate user' });
    }
});

// Change user password (requires current password, new password, and authentication)
app.post('/users/change-password', requireAuth, async (req, res) => {
    try {
        console.log('Password change endpoint called');
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            console.log('Missing current or new password');
            return res.status(400).json({ error: 'Current and new password required' });
        }
        const data = fs.readFileSync(usersPath, 'utf8');
        const users = JSON.parse(data) || [];
        const uidNum = parseInt(req.user.userUID, 10);
        if (!uidNum) {
            console.log('Invalid token user');
            return res.status(401).json({ error: 'Invalid token user' });
        }
        const idx = users.findIndex(u => parseInt(u.userUID, 10) === uidNum);
        if (idx === -1) {
            console.log('User not found');
            return res.status(404).json({ error: 'User not found' });
        }
        const user = users[idx];
        const passwordMatch = await bcrypt.compare(currentPassword, user.userPassword);
        if (!passwordMatch) {
            console.log('Current password is incorrect');
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
        users[idx].userPassword = hashedPassword;
        console.log('Writing new password hash to file:', usersPath);
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        console.error('Error changing password:', err);
        res.status(500).json({ error: 'Could not change password' });
    }
});

// =========================================
//  9. PLAYLIST ROUTES
// =========================================

// Get all playlists (optional ?owner=username)
app.get('/playlists', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        let playlists = JSON.parse(data) || [];
        const owner = req.query.owner;
        if (owner) playlists = playlists.filter(p => p.owner && String(p.owner) === String(owner));
        res.json(playlists);
    } catch (err) {
        console.error('Error reading playlists:', err);
        res.status(500).json({ error: 'Could not read playlists' });
    }
});

// Get single playlist
app.get('/playlists/:id', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const pl = playlists.find(p => String(p.id) === String(req.params.id));
        if (!pl) return res.status(404).json({ error: 'Playlist not found' });
        res.json(pl);
    } catch (err) {
        console.error('Error reading playlist:', err);
        res.status(500).json({ error: 'Could not read playlist' });
    }
});

// Create playlist
app.post('/playlists', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const { name, desc, owner, ownerUID } = req.body;
        if (!name) return res.status(400).json({ error: 'Playlist name required' });
        if (!ownerUID || parseInt(ownerUID, 10) === 0) {
            return res.status(403).json({ error: 'Sign in to create playlists' });
        }
        const newPl = { 
            id: String(Date.now()), 
            name, 
            desc: desc || '',
            owner: owner || 'Guest', 
            ownerUID: (ownerUID !== undefined) ? ownerUID : 0,
            score: 0,
            voters: {},
            comments: [],
            movies: [], 
            createdAt: new Date().toISOString() 
        };
        playlists.unshift(newPl);
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json(newPl);
    } catch (err) {
        console.error('Error creating playlist:', err);
        res.status(500).json({ error: 'Could not create playlist' });
    }
});

// Rename / update playlist metadata
app.put('/playlists/:id', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
        playlists[idx].name = req.body.name || playlists[idx].name;
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json(playlists[idx]);
    } catch (err) {
        console.error('Error updating playlist:', err);
        res.status(500).json({ error: 'Could not update playlist' });
    }
});

// Delete playlist
app.delete('/playlists/:id', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        let playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
        
        const playlist = playlists[idx];
        const userUID = (req.body.userUID !== undefined) ? req.body.userUID : 0;
        if (parseInt(userUID) !== parseInt(playlist.ownerUID)) {
            return res.status(403).json({ error: 'You do not own this playlist' });
        }
        
        playlists.splice(idx, 1);
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json({ message: 'Playlist deleted' });
    } catch (err) {
        console.error('Error deleting playlist:', err);
        res.status(500).json({ error: 'Could not delete playlist' });
    }
});

// Vote on playlist (one vote per user)
app.post('/playlists/:id/vote', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });

        const { userUID, vote } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) {
            return res.status(403).json({ error: 'Sign in to vote' });
        }
        if (vote !== 'up' && vote !== 'down') {
            return res.status(400).json({ error: 'Invalid vote' });
        }

        const playlist = playlists[idx];
        if (!playlist.voters) playlist.voters = {};
        if (playlist.score === undefined || playlist.score === null) playlist.score = 0;

        const prevVote = playlist.voters[String(uid)] || null;
        if (prevVote === vote) {
            return res.status(409).json({ error: 'Already voted' });
        }

        if (prevVote === 'up') playlist.score -= 1;
        if (prevVote === 'down') playlist.score += 1;

        playlist.voters[String(uid)] = vote;
        if (vote === 'up') playlist.score += 1;
        if (vote === 'down') playlist.score -= 1;

        playlists[idx] = playlist;
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json({ score: playlist.score });
    } catch (err) {
        console.error('Error voting on playlist:', err);
        res.status(500).json({ error: 'Could not vote' });
    }
});

// Add comment to playlist
app.post('/playlists/:id/comments', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });

        const { userUID, username, text } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to comment' });
        if (!text || !String(text).trim()) return res.status(400).json({ error: 'Comment text required' });

        const playlist = playlists[idx];
        if (!playlist.comments) playlist.comments = [];
        const newComment = {
            id: String(Date.now()),
            userUID: uid,
            username: username || 'User',
            text: String(text).trim(),
            createdAt: new Date().toISOString(),
            upvotes: 0,
            voters: {}
        };
        playlist.comments.unshift(newComment);
        playlists[idx] = playlist;
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json(newComment);
    } catch (err) {
        console.error('Error adding comment:', err);
        res.status(500).json({ error: 'Could not add comment' });
    }
});

// Upvote comment (one per user)
app.post('/playlists/:id/comments/:commentId/vote', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });

        const { userUID } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to vote' });

        const playlist = playlists[idx];
        const comments = playlist.comments || [];
        const cIdx = comments.findIndex(c => String(c.id) === String(req.params.commentId));
        if (cIdx === -1) return res.status(404).json({ error: 'Comment not found' });

        const comment = comments[cIdx];
        if (!comment.voters) comment.voters = {};
        if (comment.upvotes === undefined || comment.upvotes === null) comment.upvotes = 0;

        if (comment.voters[String(uid)]) {
            return res.status(409).json({ error: 'Already voted' });
        }

        comment.voters[String(uid)] = true;
        comment.upvotes += 1;
        comments[cIdx] = comment;
        playlist.comments = comments;
        playlists[idx] = playlist;
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json({ upvotes: comment.upvotes });
    } catch (err) {
        console.error('Error voting on comment:', err);
        res.status(500).json({ error: 'Could not vote' });
    }
});

// Delete comment (owner only)
app.delete('/playlists/:id/comments/:commentId', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });

        const { userUID } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to delete comment' });

        const playlist = playlists[idx];
        const comments = playlist.comments || [];
        const cIdx = comments.findIndex(c => String(c.id) === String(req.params.commentId));
        if (cIdx === -1) return res.status(404).json({ error: 'Comment not found' });

        const comment = comments[cIdx];
        if (parseInt(comment.userUID, 10) !== uid) {
            return res.status(403).json({ error: 'You do not own this comment' });
        }

        comments.splice(cIdx, 1);
        playlist.comments = comments;
        playlists[idx] = playlist;
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json({ message: 'Comment deleted' });
    } catch (err) {
        console.error('Error deleting comment:', err);
        res.status(500).json({ error: 'Could not delete comment' });
    }
});

// Add movie to playlist
app.post('/playlists/:id/movies', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
        const { movieId, movieTitle, poster, genre, userUID } = req.body;
        const ownerUID = playlists[idx].ownerUID;
        if (parseInt(userUID, 10) !== parseInt(ownerUID, 10)) {
            return res.status(403).json({ error: 'You do not own this playlist' });
        }
        if (!movieId) return res.status(400).json({ error: 'movieId required' });
        if (!playlists[idx].movies) playlists[idx].movies = [];
        const exists = playlists[idx].movies.find(m => String(m.movieId) === String(movieId));
        if (exists) return res.status(200).json({ message: 'Already in playlist' });
        playlists[idx].movies.push({
            movieId: String(movieId),
            movieTitle: movieTitle || '',
            poster: poster || '',
            genre: genre || ''
        });
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json({ message: 'Added' });
    } catch (err) {
        console.error('Error adding movie to playlist:', err);
        res.status(500).json({ error: 'Could not add movie' });
    }
});

// Remove movie from playlist
app.delete('/playlists/:id/movies/:movieId', (req, res) => {
    try {
        const data = fs.readFileSync(playlistsPath, 'utf8');
        const playlists = JSON.parse(data) || [];
        const idx = playlists.findIndex(p => String(p.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
        const ownerUID = playlists[idx].ownerUID;
        const userUID = (req.body && req.body.userUID !== undefined) ? req.body.userUID : 0;
        if (parseInt(userUID, 10) !== parseInt(ownerUID, 10)) {
            return res.status(403).json({ error: 'You do not own this playlist' });
        }
        playlists[idx].movies = (playlists[idx].movies || []).filter(m => String(m.movieId) !== String(req.params.movieId));
        fs.writeFileSync(playlistsPath, JSON.stringify(playlists, null, 2));
        res.json({ message: 'Removed' });
    } catch (err) {
        console.error('Error removing movie from playlist:', err);
        res.status(500).json({ error: 'Could not remove movie' });
    }
});

// =========================================
//  9.5 FORUM ROUTES
// =========================================

// Get all forum movies
app.get('/forum/movies', (req, res) => {
    try {
        const data = fs.readFileSync(forumMoviesPath, 'utf8');
        const movies = JSON.parse(data) || [];
        const threadsData = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(threadsData) || [];
        
        const moviesWithCounts = movies.map(movie => ({
            ...movie,
            threadCount: threads.filter(t => String(t.movieId) === String(movie.movieId)).length
        }));
        
        res.json(moviesWithCounts);
    } catch (err) {
        console.error('Error reading forum movies:', err);
        res.status(500).json({ error: 'Could not read forum movies' });
    }
});

// Add movie to forum
app.post('/forum/movies', (req, res) => {
    try {
        const data = fs.readFileSync(forumMoviesPath, 'utf8');
        const movies = JSON.parse(data) || [];
        const { movieId, movieTitle, poster, genre, userUID, username } = req.body;
        
        if (!movieId || !movieTitle) {
            return res.status(400).json({ error: 'movieId and movieTitle required' });
        }
        
        const exists = movies.find(m => String(m.movieId) === String(movieId));
        if (exists) {
            return res.status(200).json({ message: 'Movie already in forum', movie: exists });
        }
        
        const newMovie = {
            movieId: String(movieId),
            movieTitle,
            poster: poster || '',
            genre: genre || '',
            addedBy: username || 'User',
            addedByUID: parseInt(userUID, 10) || 0,
            createdAt: new Date().toISOString()
        };
        
        movies.unshift(newMovie);
        fs.writeFileSync(forumMoviesPath, JSON.stringify(movies, null, 2));
        res.json(newMovie);
    } catch (err) {
        console.error('Error adding forum movie:', err);
        res.status(500).json({ error: 'Could not add movie' });
    }
});

// Get threads for a movie
app.get('/forum/threads', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        let threads = JSON.parse(data) || [];
        
        const movieId = req.query.movieId;
        if (movieId) {
            threads = threads.filter(t => String(t.movieId) === String(movieId));
        }
        
        threads = threads.map(thread => ({
            ...thread,
            commentCount: (thread.comments || []).length
        }));
        
        threads.sort((a, b) => (b.score || 0) - (a.score || 0));
        
        res.json(threads);
    } catch (err) {
        console.error('Error reading threads:', err);
        res.status(500).json({ error: 'Could not read threads' });
    }
});

// Create new thread
app.post('/forum/threads', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const { movieId, title, description, image, userUID, username } = req.body;
        
        if (!movieId || !title || !description) {
            return res.status(400).json({ error: 'movieId, title, and description required' });
        }
        
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) {
            return res.status(403).json({ error: 'Sign in to create threads' });
        }
        
        const newThread = {
            id: String(Date.now()),
            movieId: String(movieId),
            title: String(title).trim(),
            description: String(description).trim(),
            image: image || '',
            username: username || 'User',
            userUID: uid,
            score: 0,
            voters: {},
            comments: [],
            createdAt: new Date().toISOString()
        };
        
        threads.unshift(newThread);
        fs.writeFileSync(forumThreadsPath, JSON.stringify(threads, null, 2));
        res.json(newThread);
    } catch (err) {
        console.error('Error creating thread:', err);
        res.status(500).json({ error: 'Could not create thread' });
    }
});

// Vote on thread
app.post('/forum/threads/:id/vote', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const idx = threads.findIndex(t => String(t.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Thread not found' });
        
        const { userUID, vote } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) {
            return res.status(403).json({ error: 'Sign in to vote' });
        }
        if (vote !== 'up' && vote !== 'down') {
            return res.status(400).json({ error: 'Invalid vote' });
        }
        
        const thread = threads[idx];
        if (!thread.voters) thread.voters = {};
        if (thread.score === undefined || thread.score === null) thread.score = 0;
        
        const prevVote = thread.voters[String(uid)] || null;
        if (prevVote === vote) {
            return res.status(409).json({ error: 'Already voted' });
        }
        
        if (prevVote === 'up') thread.score -= 1;
        if (prevVote === 'down') thread.score += 1;
        
        thread.voters[String(uid)] = vote;
        if (vote === 'up') thread.score += 1;
        if (vote === 'down') thread.score -= 1;
        
        threads[idx] = thread;
        fs.writeFileSync(forumThreadsPath, JSON.stringify(threads, null, 2));
        res.json({ score: thread.score });
    } catch (err) {
        console.error('Error voting on thread:', err);
        res.status(500).json({ error: 'Could not vote' });
    }
});

// Get comments for a thread
app.get('/forum/threads/:id/comments', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const thread = threads.find(t => String(t.id) === String(req.params.id));
        if (!thread) return res.status(404).json({ error: 'Thread not found' });
        
        res.json(thread.comments || []);
    } catch (err) {
        console.error('Error reading comments:', err);
        res.status(500).json({ error: 'Could not read comments' });
    }
});

// Add comment to thread
app.post('/forum/threads/:id/comments', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const idx = threads.findIndex(t => String(t.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Thread not found' });
        
        const { userUID, username, text } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to comment' });
        if (!text || !String(text).trim()) return res.status(400).json({ error: 'Comment text required' });
        
        const thread = threads[idx];
        if (!thread.comments) thread.comments = [];
        
        const newComment = {
            id: String(Date.now()),
            userUID: uid,
            username: username || 'User',
            text: String(text).trim(),
            createdAt: new Date().toISOString(),
            upvotes: 0,
            voters: {}
        };
        
        thread.comments.unshift(newComment);
        threads[idx] = thread;
        fs.writeFileSync(forumThreadsPath, JSON.stringify(threads, null, 2));
        res.json(newComment);
    } catch (err) {
        console.error('Error adding comment:', err);
        res.status(500).json({ error: 'Could not add comment' });
    }
});

// Upvote comment
app.post('/forum/threads/:id/comments/:commentId/upvote', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const idx = threads.findIndex(t => String(t.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Thread not found' });
        
        const { userUID } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to vote' });
        
        const thread = threads[idx];
        const comments = thread.comments || [];
        const cIdx = comments.findIndex(c => String(c.id) === String(req.params.commentId));
        if (cIdx === -1) return res.status(404).json({ error: 'Comment not found' });
        
        const comment = comments[cIdx];
        if (!comment.voters) comment.voters = {};
        if (comment.upvotes === undefined || comment.upvotes === null) comment.upvotes = 0;
        
        if (comment.voters[String(uid)]) {
            return res.status(409).json({ error: 'Already voted' });
        }
        
        comment.voters[String(uid)] = true;
        comment.upvotes += 1;
        comments[cIdx] = comment;
        thread.comments = comments;
        threads[idx] = thread;
        fs.writeFileSync(forumThreadsPath, JSON.stringify(threads, null, 2));
        res.json({ upvotes: comment.upvotes });
    } catch (err) {
        console.error('Error upvoting comment:', err);
        res.status(500).json({ error: 'Could not upvote' });
    }
});

// Delete comment (owner only)
app.delete('/forum/threads/:id/comments/:commentId', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const idx = threads.findIndex(t => String(t.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Thread not found' });

        const { userUID } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to delete comment' });

        const thread = threads[idx];
        const comments = thread.comments || [];
        const cIdx = comments.findIndex(c => String(c.id) === String(req.params.commentId));
        if (cIdx === -1) return res.status(404).json({ error: 'Comment not found' });

        const comment = comments[cIdx];
        if (parseInt(comment.userUID, 10) !== uid) {
            return res.status(403).json({ error: 'You do not own this comment' });
        }

        comments.splice(cIdx, 1);
        thread.comments = comments;
        threads[idx] = thread;
        fs.writeFileSync(forumThreadsPath, JSON.stringify(threads, null, 2));
        res.json({ message: 'Comment deleted' });
    } catch (err) {
        console.error('Error deleting comment:', err);
        res.status(500).json({ error: 'Could not delete comment' });
    }
});

// Delete thread (owner only)
app.delete('/forum/threads/:id', (req, res) => {
    try {
        const data = fs.readFileSync(forumThreadsPath, 'utf8');
        const threads = JSON.parse(data) || [];
        const idx = threads.findIndex(t => String(t.id) === String(req.params.id));
        if (idx === -1) return res.status(404).json({ error: 'Thread not found' });

        const { userUID } = req.body || {};
        const uid = parseInt(userUID, 10);
        if (!uid || uid === 0) return res.status(403).json({ error: 'Sign in to delete thread' });

        const thread = threads[idx];
        if (parseInt(thread.userUID, 10) !== uid) {
            return res.status(403).json({ error: 'You do not own this thread' });
        }

        threads.splice(idx, 1);
        fs.writeFileSync(forumThreadsPath, JSON.stringify(threads, null, 2));
        res.json({ message: 'Thread deleted' });
    } catch (err) {
        console.error('Error deleting thread:', err);
        res.status(500).json({ error: 'Could not delete thread' });
    }
});

// =========================================
//  9.9 ADMIN STATS
// =========================================
function readJsonSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.warn('Admin stats read error:', err.message || err);
        return fallback;
    }
}

function tallyVotes(votersObj) {
    const voters = votersObj && typeof votersObj === 'object' ? votersObj : {};
    let up = 0;
    let down = 0;
    Object.values(voters).forEach(vote => {
        if (vote === 'down') down += 1;
        else up += 1;
    });
    return { total: up + down, up, down };
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

app.get('/admin/stats', requireAdmin, async (req, res) => {
    try {
        const users = readJsonSafe(usersPath, []);
        const reviews = readJsonSafe(reviewsPath, []);
        const playlists = readJsonSafe(playlistsPath, []);
        const forumThreads = readJsonSafe(forumThreadsPath, []);
        const forumMovies = readJsonSafe(forumMoviesPath, []);

        const tierCounts = users.reduce((acc, user) => {
            const tier = String(user.userTier || 'Free');
            acc[tier] = (acc[tier] || 0) + 1;
            return acc;
        }, {});

        const adminCount = users.filter(u => isAdminUser(u)).length;
        const totalSearches = users.reduce((sum, u) => sum + (parseInt(u.searchCount, 10) || 0), 0);
        const totalViews = users.reduce((sum, u) => sum + (parseInt(u.viewCount, 10) || 0), 0);

        const reviewStarsSum = reviews.reduce((sum, r) => sum + (parseInt(r.stars, 10) || 0), 0);
        const avgReviewStars = reviews.length ? (reviewStarsSum / reviews.length) : 0;
        const reviewCountsByUser = reviews.reduce((acc, r) => {
            const user = r.user || 'Guest';
            acc[user] = (acc[user] || 0) + 1;
            return acc;
        }, {});
        const topReviewers = Object.entries(reviewCountsByUser)
            .map(([user, count]) => ({ user, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        let playlistVoteTotal = 0;
        let playlistVoteUp = 0;
        let playlistVoteDown = 0;
        let playlistCommentCount = 0;
        let playlistCommentUpvotes = 0;
        let playlistMoviesCount = 0;

        const playlistTop = playlists
            .map(p => ({ id: p.id, name: p.name || 'Untitled', score: p.score || 0 }))
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 10);

        const likeItems = [];

        playlists.forEach(playlist => {
            playlistMoviesCount += (playlist.movies || []).length;
            const votes = tallyVotes(playlist.voters);
            playlistVoteTotal += votes.total;
            playlistVoteUp += votes.up;
            playlistVoteDown += votes.down;

            Object.entries(playlist.voters || {}).forEach(([uid, vote]) => {
                likeItems.push({
                    type: 'playlist',
                    entityId: String(playlist.id),
                    entityName: playlist.name || 'Untitled',
                    userUID: String(uid),
                    vote: vote === 'down' ? 'down' : 'up'
                });
            });

            const comments = playlist.comments || [];
            playlistCommentCount += comments.length;
            comments.forEach(comment => {
                playlistCommentUpvotes += parseInt(comment.upvotes, 10) || 0;
                Object.keys(comment.voters || {}).forEach(uid => {
                    likeItems.push({
                        type: 'playlist_comment',
                        entityId: String(comment.id),
                        parentId: String(playlist.id),
                        parentName: playlist.name || 'Untitled',
                        userUID: String(uid),
                        vote: 'up'
                    });
                });
            });
        });

        let threadVoteTotal = 0;
        let threadVoteUp = 0;
        let threadVoteDown = 0;
        let forumCommentCount = 0;
        let forumCommentUpvotes = 0;

        const threadTop = forumThreads
            .map(t => ({ id: t.id, title: t.title || 'Untitled', score: t.score || 0 }))
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 10);

        forumThreads.forEach(thread => {
            const votes = tallyVotes(thread.voters);
            threadVoteTotal += votes.total;
            threadVoteUp += votes.up;
            threadVoteDown += votes.down;

            Object.entries(thread.voters || {}).forEach(([uid, vote]) => {
                likeItems.push({
                    type: 'forum_thread',
                    entityId: String(thread.id),
                    entityName: thread.title || 'Untitled',
                    userUID: String(uid),
                    vote: vote === 'down' ? 'down' : 'up'
                });
            });

            const comments = thread.comments || [];
            forumCommentCount += comments.length;
            comments.forEach(comment => {
                forumCommentUpvotes += parseInt(comment.upvotes, 10) || 0;
                Object.keys(comment.voters || {}).forEach(uid => {
                    likeItems.push({
                        type: 'forum_comment',
                        entityId: String(comment.id),
                        parentId: String(thread.id),
                        parentName: thread.title || 'Untitled',
                        userUID: String(uid),
                        vote: 'up'
                    });
                });
            });
        });

        let movieCount = 0;
        let totalClicks = 0;
        try {
            const movieRow = await dbGet('SELECT COUNT(*) as count FROM movies');
            movieCount = movieRow?.count || 0;
        } catch (err) {
            console.warn('Admin stats movie count error:', err.message || err);
        }

        try {
            const clickRow = await dbGet('SELECT COALESCE(SUM(click_count), 0) as total FROM movie_clicks');
            totalClicks = clickRow?.total || 0;
        } catch (err) {
            console.warn('Admin stats click count error:', err.message || err);
        }

        res.json({
            generatedAt: new Date().toISOString(),
            users: {
                total: users.length,
                admins: adminCount,
                byTier: tierCounts,
                totalSearches,
                totalViews
            },
            movies: {
                total: movieCount,
                totalClicks
            },
            reviews: {
                total: reviews.length,
                averageStars: Number(avgReviewStars.toFixed(2)),
                topReviewers
            },
            playlists: {
                total: playlists.length,
                totalMovies: playlistMoviesCount,
                votes: {
                    total: playlistVoteTotal,
                    up: playlistVoteUp,
                    down: playlistVoteDown
                },
                comments: {
                    total: playlistCommentCount,
                    upvotes: playlistCommentUpvotes
                },
                topByScore: playlistTop
            },
            forum: {
                moviesTotal: forumMovies.length,
                threadsTotal: forumThreads.length,
                votes: {
                    total: threadVoteTotal,
                    up: threadVoteUp,
                    down: threadVoteDown
                },
                comments: {
                    total: forumCommentCount,
                    upvotes: forumCommentUpvotes
                },
                topThreads: threadTop
            },
            likes: {
                total: likeItems.length,
                items: likeItems
            }
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Could not load admin stats' });
    }
});

// =========================================
//  10. START SERVER
// =========================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server is running at http://localhost:${PORT}`);
    console.log(`📂 Reviews file location: ${reviewsPath}`);
});