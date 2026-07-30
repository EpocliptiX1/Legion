
// ==========================================
// MYANIMELIST (MAL) APIv2 OAUTH INTEGRATION
// ==========================================
// Place after all other requires and after app is initialized
// (Moved here to avoid ReferenceError)
// --- TMDB Multi-Search API: Movies & TV Series ---
// (MUST be after const app = express)
const express = require('express');
const cheerio = require('cheerio');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csvParse = require('csv-parse/sync');
const { load } = require('cheerio');
const localCsvPath = path.join(__dirname, '..', 'datasets', 'AITUCAP_Final_Database.csv');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Kwik } = require('@consumet/extensions/dist/extractors');
const { getAnimeSkipTimestamps } = require('./AnimeSkipService');
const app = express();
app.set('trust proxy', 1);
const KAA_DEBUG_LOG_PATH = path.join(__dirname, 'kaa-debug-log.txt');
function logKaaDebug(...parts) {
    const stamp = new Date().toISOString();
    const text = parts.map(part => {
        if (typeof part === 'string') return part;
        try {
            return JSON.stringify(part, null, 2);
        } catch (e) {
            return String(part);
        }
    }).join(' ');
    const line = `[${stamp}] ${text}`;
    console.log(line);
    try {
        fs.appendFileSync(KAA_DEBUG_LOG_PATH, line + '\n');
    } catch (err) {
        console.warn('[KAA DEBUG] failed to append log file:', err.message);
    }
}

// NekoStream debug logger (disabled - KAA debugging takes priority)
function logNekoDebug(...parts) {
    // NekoStream logging disabled - using kaa-debug-log.txt for KAA debugging
    // const stamp = new Date().toISOString();
    // const text = parts.map(part => {
    //     if (typeof part === 'string') return part;
    //     try {
    //         return JSON.stringify(part, null, 2);
    //     } catch (e) {
    //         return String(part);
    //     }
    // }).join(' ');
    // const line = `[${stamp}] [NEKO] ${text}`;
    // console.log(line);
    // try {
    //     fs.appendFileSync(KAA_DEBUG_LOG_PATH, line + '\n');
    // } catch (err) {
    //     // Silent fail
    // }
}

logKaaDebug('[KAA DEBUG] logger ready', {
    path: KAA_DEBUG_LOG_PATH,
    pid: process.pid
});
app.get('/api/tmdb/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'Missing search query' });
        const tmdbKey = TMDB_API_KEY;
        // Multi-search endpoint returns both movies and TV
        const url = `${TMDB_BASE_URL}/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(query)}`;
        const tmdbRes = await axios.get(url);
        // Filter to only movies and TV (ignore people, etc)
        const results = (tmdbRes.data.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');
        // Normalize results for frontend
        const normalized = results.map(item => ({
            id: item.id,
            title: item.title || item.name,
            poster: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '',
            year: (item.release_date || item.first_air_date || '').slice(0, 4),
            type: item.media_type,
            overview: item.overview || ''
        }));
        res.json(normalized);
    } catch (err) {
        console.error('[TMDB Multi-Search] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch from TMDB' });
    }
});

// --- TMDB Proxy (keeps the API key out of the browser) ---
// Frontend calls /api/tmdb-proxy/tv/123?language=en-US
// → this route adds the key and forwards to https://api.themoviedb.org/3/tv/123
app.use('/api/tmdb-proxy', async (req, res) => {
    try {
        const tmdbPath = req.path;
        const query    = { ...req.query, api_key: TMDB_API_KEY };

        // Check if this is a season request: /tv/{id}/season/{num}
        const seasonMatch = tmdbPath.match(/^\/tv\/(\d+)\/season\/(\d+)$/);
        if (seasonMatch) {
            const tmdbId = Number(seasonMatch[1]);
            const seasonNum = Number(seasonMatch[2]);

            // Try to get from cache first
            const cached = await new Promise((resolve) => {
                animeCacheDb.all(`
                    SELECT episode_number, title, air_date, overview, still_path, runtime
                    FROM episode_cache
                    WHERE tmdb_id = ? AND season_number = ?
                    ORDER BY episode_number ASC
                `, [tmdbId, seasonNum], (err, rows) => {
                    if (err) {
                        console.warn('[TMDB Cache] read failed:', err.message);
                        resolve(null);
                    } else {
                        resolve(rows);
                    }
                });
            });

            logEpisodeCache(`Cache CHECK ${tmdbId} S${seasonNum}: ${cached ? cached.length : 0} rows found`);
            if (cached && cached.length > 0) {
                logEpisodeCache(`  └─ First ep: #${cached[0]?.episode_number} title="${cached[0]?.title}" air_date="${cached[0]?.air_date}" still_path="${cached[0]?.still_path}"`);
                logEpisodeCache(`  └─ Last ep:  #${cached[cached.length-1]?.episode_number} title="${cached[cached.length-1]?.title}" air_date="${cached[cached.length-1]?.air_date}"`);
            }

            // STRICT: Cache is only valid if EVERY episode has complete data
            const incompleteness = cached ? cached.filter(ep =>
                !ep.episode_number || !ep.title || !ep.air_date === null || !ep.still_path
            ) : [];

            if (cached && cached.length > 0 && incompleteness.length === 0) {
                logEpisodeCache(`✓ Cache HIT ${tmdbId} S${seasonNum}: all ${cached.length} episodes complete`);
                // Transform cached episodes: rename 'title' to 'name' to match TMDB API response format
                const normalizedEpisodes = cached.map(ep => ({
                    episode_number: ep.episode_number,
                    name: ep.title,  // Database stores as 'title', but TMDB API uses 'name'
                    air_date: ep.air_date,
                    overview: ep.overview,
                    still_path: ep.still_path,
                    runtime: ep.runtime
                }));
                return res.json({
                    episodes: normalizedEpisodes,
                    _cached: true
                });
            } else if (cached && cached.length > 0) {
                // Cache exists but has NULLs - log details and clear it
                const nullEps = cached.filter(ep => !ep.title || !ep.air_date || !ep.still_path);
                logEpisodeCache(`⚠️  Cache CORRUPT ${tmdbId} S${seasonNum}: ${nullEps.length}/${cached.length} episodes have NULLs`);
                nullEps.slice(0, 5).forEach(ep => {
                    const fields = [];
                    if (!ep.title) fields.push('title=NULL');
                    if (!ep.air_date) fields.push('air_date=NULL');
                    if (!ep.still_path) fields.push('still_path=NULL');
                    logEpisodeCache(`    └─ Ep ${ep.episode_number}: ${fields.join(', ')}`);
                });

                animeCacheDb.run(`DELETE FROM episode_cache WHERE tmdb_id = ? AND season_number = ?`,
                    [tmdbId, seasonNum],
                    (err) => {
                        if (err) logEpisodeCache(`  └─ Delete error: ${err.message}`);
                        else logEpisodeCache(`  └─ Deleted, fetching from TMDB...`);
                    }
                );
            } else {
                logEpisodeCache(`Cache MISS ${tmdbId} S${seasonNum} (0 rows)`);
            }
        }

        // Not cached, fetch from TMDB
        const tmdbRes  = await axios.get(`${TMDB_BASE_URL}${tmdbPath}`, {
            params:  query,
            headers: { Accept: 'application/json' },
        });

        // Cache season episodes if applicable
        if (seasonMatch && tmdbRes.data?.episodes) {
            const tmdbId = Number(seasonMatch[1]);
            const seasonNum = Number(seasonMatch[2]);
            const episodes = tmdbRes.data.episodes;

            // Count missing data
            const nullCount = episodes.filter(ep => !ep.name || !ep.air_date || !ep.still_path).length;
            logEpisodeCache(`TMDB response ${tmdbId} S${seasonNum}: ${nullCount}/${episodes.length} episodes (ep1="${episodes[0]?.name || 'N/A'}", air_date="${episodes[0]?.air_date || 'N/A'}")`);

            // Only cache if data is complete
            if (nullCount === 0) {
                logEpisodeCache(`Cache WRITE START ${tmdbId} S${seasonNum}: deleting old data...`);

                // Delete old cache first (must complete before inserting)
                animeCacheDb.run(`
                    DELETE FROM episode_cache
                    WHERE tmdb_id = ? AND season_number = ?
                `, [tmdbId, seasonNum], (deleteErr) => {
                    if (deleteErr) {
                        logEpisodeCache(`Cache DELETE error: ${deleteErr.message}`);
                        return;
                    }

                    logEpisodeCache(`Cache DELETE done for ${tmdbId} S${seasonNum}, inserting ${episodes.length} episodes...`);

                    // Now insert all episodes sequentially after DELETE completes
                    let inserted = 0;
                    const insertNext = () => {
                        if (inserted >= episodes.length) {
                            logEpisodeCache(`Cache WRITE DONE ${tmdbId} S${seasonNum}: all ${episodes.length} episodes inserted ✓`);
                            return;
                        }

                        const ep = episodes[inserted];
                        animeCacheDb.run(`
                            INSERT INTO episode_cache
                            (tmdb_id, season_number, episode_number, title, air_date, still_path, runtime, overview, cached_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            tmdbId,
                            seasonNum,
                            ep.episode_number,
                            ep.name,
                            ep.air_date,
                            ep.still_path,
                            ep.runtime || 0,
                            ep.overview || '',
                            Date.now()
                        ], (insertErr) => {
                            if (insertErr) {
                                logEpisodeCache(`Cache INSERT error ep${ep.episode_number}: ${insertErr.message}`);
                            }
                            inserted++;
                            insertNext();
                        });
                    };

                    insertNext();
                });
            } else {
                const incompleteSample = episodes.filter(ep => !ep.name || !ep.air_date || !ep.still_path).slice(0, 2);
                logEpisodeCache(`Cache SKIP ${tmdbId} S${seasonNum}: ${nullCount}/${episodes.length} incomplete`);
            }
        }

        res.json(tmdbRes.data);
    } catch (err) {
        const status = err.response?.status || 500;
        res.status(status).json({ error: 'TMDB proxy error', detail: err.message });
    }
});

// --- MEGACLOUD STREAM API (via Consumet/FlixHQ) ---
const { MOVIES, ANIME } = require('@consumet/extensions');
const flixhq = new MOVIES.FlixHQ();
const animeKai = new ANIME.AnimeKai();
const kickass = new ANIME.KickAssAnime();

// console.log(ANIME);
// console.log(Object.keys(ANIME));
// console.log("====================================");
// console.log("INSTANCE:");
// console.dir(animePahe, { depth: 3 });

// console.log("PROTO:");
// console.log(
//   Reflect.ownKeys(
//     Object.getPrototypeOf(animePahe)
//   )
// );

// console.log("PARENT PROTO:");
// console.log(
//   Reflect.ownKeys(
//     Object.getPrototypeOf(
//       Object.getPrototypeOf(animePahe)
//     )
//   )
// );
 
// --- USER VIEWCOUNT & TIER ENDPOINTS ---
// Get current user's viewCount and userTier

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
// --- Megacloud API route (must be after app is initialized) ---
app.get('/api/megacloud/:title', async (req, res) => {
    try {
        console.log(`[Megacloud API] Searching for: ${req.params.title}`);
        const downloadMode = String(req.query.download || '') === '1';
        const searchRes = await flixhq.search(req.params.title);

        if (!searchRes.results || searchRes.results.length === 0) {
            return res.status(404).json({ error: "Movie not found on FlixHQ" });
        }

        // Specifically look for a Movie type that matches the title closely
        let movieTarget = searchRes.results.find(item => 
            item.type === 'Movie' && item.title.toLowerCase().includes(req.params.title.toLowerCase())
        );
        // Fallback to the first item if exact match isn't found
        if (!movieTarget) movieTarget = searchRes.results[0];

        console.log(`[Megacloud API] Found target: ${movieTarget.title} (${movieTarget.id})`);

        const mediaInfo = await flixhq.fetchMediaInfo(movieTarget.id);

        // Handle FlixHQ returning the episode ID directly on the mediaInfo object sometimes
        const episodeId = (mediaInfo.episodes && mediaInfo.episodes.length > 0) 
            ? mediaInfo.episodes[0].id 
            : movieTarget.id; // Fallback to media ID if episodes array is missing

        console.log(`[Megacloud API] Fetching sources for Episode ID: ${episodeId}`);

        const watchLinks = await flixhq.fetchEpisodeSources(episodeId, mediaInfo.id);

        if (downloadMode) {
            const candidates = [];
            const pushCandidate = (value) => {
                const url = String(value || '').trim();
                if (!url) return;
                if (!/^https?:\/\//i.test(url)) return;
                if (!candidates.includes(url)) candidates.push(url);
            };

            if (Array.isArray(watchLinks?.sources)) {
                watchLinks.sources.forEach(src => pushCandidate(src?.url || src?.file || src?.src));
            }
            if (Array.isArray(watchLinks?.sourcesBackup)) {
                watchLinks.sourcesBackup.forEach(src => pushCandidate(src?.url || src?.file || src?.src));
            }
            if (Array.isArray(watchLinks?.download)) {
                watchLinks.download.forEach(src => pushCandidate(src?.url || src?.file || src?.src || src));
            } else {
                pushCandidate(watchLinks?.download?.url || watchLinks?.download);
            }

            const directFile = candidates.find(u => /\.(mp4|mkv|webm)(\?|$)/i.test(u));
            const nonHls = candidates.find(u => !/\.m3u8(\?|$)/i.test(u));
            const chosen = directFile || nonHls || candidates[0];

            if (!chosen) {
                return res.status(404).json({ error: 'No downloadable MegaCloud source found for this title.' });
            }

            return res.json({
                title: movieTarget.title,
                downloadUrl: `/api/megacloud-download?url=${encodeURIComponent(chosen)}`,
                sourceUrl: chosen
            });
        }

        res.json(watchLinks);
    } catch (error) {
        console.error("[Megacloud API] Extraction failed:", error.message);
        res.status(500).json({ error: "Cloudflare blocked the request or extraction failed." });
    }
});

// 1. Keep your existing Movie Downloader
app.get('/api/megacloud-download', (req, res) => {
    const raw = String(req.query.url || '').trim();
    if (!raw) {
        return res.status(400).json({ error: 'Missing url' });
    }
    // ... rest of your existing movie code ...
    try {
        const parsed = new URL(raw);
        if (!/^https?:$/i.test(parsed.protocol)) {
            return res.status(400).json({ error: 'Only http/https URLs are allowed' });
        }
        return res.redirect(parsed.toString());
    } catch {
        return res.status(400).json({ error: 'Invalid url' });
    }
});

// 2. ADD the new Anime Downloader below it
app.get('/api/megaplay/extract/:malId/:ep/:type', async (req, res) => {
    try {
        // Find the "real" API endpoint using the Network Tab
        // Let's assume you found it is: https://megaplay.buzz/api/v1/source/....
        const realApiUrl = `https://megaplay.buzz/api/v1/source/...`; 
        
        const response = await axios.get(realApiUrl, {
            headers: { 
                'Referer': 'https://megaplay.buzz/',
                'User-Agent': 'Mozilla/5.0...' 
            }
        });

        // If the API returns JSON, simply pull the link out
        // e.g., if response.data = { sources: [{ file: "..." }] }
        const sourceUrl = response.data.sources[0].file; 

        if (sourceUrl) {
            res.json({ sourceUrl: sourceUrl });
        } else {
            res.status(404).json({ error: 'Could not extract from API' });
        }
    } catch (err) {
        console.error("API Fetch Error:", err.message);
        res.status(500).json({ error: 'Failed to fetch API' });
    }
});
const BCRYPT_SALT_ROUNDS = 10;
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || '';
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || '';
const LIBRETRANSLATE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';
const LOGIN_CODE_TTL_SECONDS = 60 * 60 * 24 * 3650; // 10 years
const TMDB_API_KEY = 'f4705f0e34fafba5ccef5cc38a703fc5';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TRANSLATION_CACHE_FILE = path.join(__dirname, 'translation_cache.json');
const POSTER_CACHE_FILE = path.join(__dirname, 'poster_cache.json'); // legacy migration source
const POSTER_CACHE_DB_FILE = path.join(__dirname, 'poster_cache.db');
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
app.get('/users/me/viewdata', requireAuth, (req, res) => {
    const uidNum = parseInt(req.user.userUID, 10);
    if (!uidNum) return res.status(401).json({ error: 'Invalid token user' });
    usersDb.get('SELECT userTier, viewCount FROM users WHERE userUID = ?', [uidNum], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'User not found' });
        res.json({ userTier: row.userTier || 'Free', viewCount: row.viewCount || 0 });
    });
});

// Increment viewCount for current user
app.post('/users/me/increment-view', requireAuth, (req, res) => {
    const uidNum = parseInt(req.user.userUID, 10);
    if (!uidNum) return res.status(401).json({ error: 'Invalid token user' });
    usersDb.run('UPDATE users SET viewCount = COALESCE(viewCount,0) + 1 WHERE userUID = ?', [uidNum], function(err) {
        if (err) return res.status(500).json({ error: 'Could not increment viewCount why wish id knew' });
        usersDb.get('SELECT viewCount FROM users WHERE userUID = ?', [uidNum], (err2, row) => {
            if (err2 || !row) return res.status(404).json({ error: 'User not found' });
            res.json({ viewCount: row.viewCount });
        });
    });
});
// --- USER VIEWCOUNT & TIER ENDPOINTS ---
app.get('/users/me/viewdata', requireAuth, (req, res) => {
    const uidNum = parseInt(req.user.userUID, 10);
    if (!uidNum) return res.status(401).json({ error: 'Invalid token user' });
    usersDb.get('SELECT userTier, viewCount FROM users WHERE userUID = ?', [uidNum], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'User not found' });
        res.json({ userTier: row.userTier || 'Free', viewCount: row.viewCount || 0 });
    });
});

// Increment viewCount for current user
app.post('/users/me/increment-view', requireAuth, (req, res) => {
    const uidNum = parseInt(req.user.userUID, 10);
    if (!uidNum) return res.status(401).json({ error: 'Invalid token user' });
    usersDb.run('UPDATE users SET viewCount = COALESCE(viewCount,0) + 1 WHERE userUID = ?', [uidNum], function(err) {
        if (err) return res.status(500).json({ error: 'Could not increment viewCount' });
        usersDb.get('SELECT viewCount FROM users WHERE userUID = ?', [uidNum], (err2, row) => {
            if (err2 || !row) return res.status(404).json({ error: 'User not found' });
            res.json({ viewCount: row.viewCount });
        });
    });
});
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

const posterCacheDb = new sqlite3.Database(POSTER_CACHE_DB_FILE, (err) => {
    if (err) console.error('Poster cache DB error:', err.message);
    else console.log('✅ Connected to poster cache database');
});

const ANIME_CACHE_DB_FILE = path.join(__dirname, 'animeCache.db');
const animeCacheDb = new sqlite3.Database(ANIME_CACHE_DB_FILE, (err) => {
    if (err) console.error('Anime cache DB error:', err.message);
    else console.log('✅ Connected to anime cache database');
});

// Episode cache logging
const EPISODE_LOG_FILE = path.join(__dirname, 'episode-logs.txt');
function logEpisodeCache(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(EPISODE_LOG_FILE, line, 'utf8');
    console.log(`[TMDB] ${msg}`);
}

posterCacheDb.serialize(() => {
    posterCacheDb.run(`
        CREATE TABLE IF NOT EXISTS poster_cache (
            cache_key TEXT PRIMARY KEY,
            type TEXT,
            tmdb_id INTEGER,
            mal_id TEXT,
            name TEXT,
            poster_path TEXT,
            mal_poster TEXT,
            backdrop_path TEXT,
            vote_average REAL,
            overview TEXT,
            first_air_date TEXT,
            ts INTEGER
        )
    `);
    posterCacheDb.run(`CREATE INDEX IF NOT EXISTS idx_poster_cache_ts ON poster_cache(ts)`);
});

animeCacheDb.serialize(() => {
    animeCacheDb.run(`
        CREATE TABLE IF NOT EXISTS anime_recommendations (
            mal_id INTEGER,
            anilist_id INTEGER,
            tmdb_id INTEGER,

            title TEXT,

            recommendation_count INTEGER NOT NULL,
            json TEXT NOT NULL,

            cached_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL,

            PRIMARY KEY(anilist_id)
        );
    `);
    animeCacheDb.run(`CREATE INDEX IF NOT EXISTS idx_anime_recommendations_last_accessed ON anime_recommendations(last_accessed)`);
    animeCacheDb.run(`
        CREATE TABLE IF NOT EXISTS anime_schedule (
            day TEXT PRIMARY KEY,
            json TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL
        );
    `);
    animeCacheDb.run(`CREATE INDEX IF NOT EXISTS idx_anime_schedule_last_accessed ON anime_schedule(last_accessed)`);
    animeCacheDb.run(`
        CREATE TABLE IF NOT EXISTS anime_tmdb_mapping (
            tmdb_id INTEGER PRIMARY KEY,
            mal_id INTEGER,
            anilist_id INTEGER,
            title TEXT,
            cached_at INTEGER NOT NULL
        );
    `);
    animeCacheDb.run(`
        CREATE TABLE IF NOT EXISTS anime_cache (
            anilist_id INTEGER PRIMARY KEY,
            tmdb_id INTEGER,
            mal_id INTEGER,
            english_title TEXT,
            romaji_title TEXT,
            native_title TEXT,
            cover_image TEXT,
            banner_image TEXT,
            score INTEGER,
            popularity INTEGER,
            favourites INTEGER,
            description TEXT,
            format TEXT,
            status TEXT,
            episodes INTEGER,
            json TEXT,
            cached_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL
        );
    `);
    animeCacheDb.run(`
        CREATE TABLE IF NOT EXISTS anime_row_cache (
            row_key TEXT NOT NULL,
            page INTEGER NOT NULL,
            per_page INTEGER NOT NULL,
            json TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            PRIMARY KEY(row_key, page, per_page)
        );
    `);
});

const TMDB_SEARCH_LOG_FILE = path.join(__dirname, 'tmdb_search_log.txt');
const TMDB_FALLBACK_LOG_FILE = path.join(__dirname, 'tmdb_fallback_search_log.txt');
function appendTmdbLogLine(message) {
    try {
        fs.appendFileSync(TMDB_SEARCH_LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch (err) {
        console.error('[TMDB LOG] failed writing:', err.message || err);
    }
}

function appendTmdbFallbackLog(message) {
    try {
        fs.appendFileSync(TMDB_FALLBACK_LOG_FILE, `${message}\n`, 'utf8');
    } catch (err) {
        console.error('[TMDB FALLBACK LOG] failed writing:', err.message || err);
    }
}

function formatTmdbFallbackResults(results) {
    if (!Array.isArray(results)) return '';
    const preview = results.slice(0, 10).map((item, index) => {
        const title = String(item.name || item.original_name || item.title || item.original_title || '').trim();
        const year = item.first_air_date || item.release_date || '';
        return `${index + 1}. id=${item.id || 'none'} title="${title}" first_air_date="${year}"`;
    });
    if (results.length > 10) {
        preview.push(`...and ${results.length - 10} more result(s)`);
    }
    return preview.join('\n');
}

function appendTmdbFallbackBlock({ anilistId, originalTitle, searchTitle, attempts, succeeded = false }) {
    if (!Array.isArray(attempts) || !attempts.length) return;
    const header = [
        '==============================',
        `AniList ${anilistId}`,
        `Original title: ${originalTitle || ''}`,
        `Starting fallback search from: ${searchTitle || ''}`,
        `Attempt count: ${attempts.length}`,
        ''
    ];
    const lines = [];
    for (const attempt of attempts) {
        lines.push(`Query: "${attempt.query}" type=${attempt.mediaType || 'tv'}`);
        lines.push(`TMDB chosen_id: ${attempt.chosenId || 'none'}`);
        lines.push(`TMDB result count: ${attempt.results?.length || 0}`);
        if (attempt.results && attempt.results.length) {
            lines.push(formatTmdbFallbackResults(attempt.results));
        }
        lines.push('');
    }
    if (succeeded) {
        lines.push('SUCCESSFULLY FOUND TMDB EQUIVALENT');
    }
    appendTmdbFallbackLog([...header, ...lines].join('\n'));
}

function posterCacheGetMany(keys, minTs) {
    return new Promise((resolve, reject) => {
        if (!keys.length) return resolve([]);
        const normKeys = keys.map(k => k.toLowerCase());
        const placeholders = normKeys.map(() => '?').join(',');
        const sql = `
            SELECT cache_key, type, tmdb_id, mal_id, name, poster_path, mal_poster,
                   backdrop_path, vote_average, overview, first_air_date, ts
            FROM poster_cache
            WHERE cache_key IN (${placeholders}) AND ts >= ?
        `;
        posterCacheDb.all(sql, [...normKeys, minTs], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function posterCacheUpsertMany(entries, now) {
    return new Promise((resolve, reject) => {
        if (!entries.length) return resolve(0);
        posterCacheDb.serialize(() => {
            posterCacheDb.run('BEGIN TRANSACTION');
            const stmt = posterCacheDb.prepare(`
                INSERT INTO poster_cache (
                    cache_key, type, tmdb_id, mal_id, name, poster_path, mal_poster,
                    backdrop_path, vote_average, overview, first_air_date, ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    type = excluded.type,
                    tmdb_id = excluded.tmdb_id,
                    mal_id = excluded.mal_id,
                    name = excluded.name,
                    poster_path = excluded.poster_path,
                    mal_poster = excluded.mal_poster,
                    backdrop_path = excluded.backdrop_path,
                    vote_average = excluded.vote_average,
                    overview = excluded.overview,
                    first_air_date = excluded.first_air_date,
                    ts = excluded.ts
            `);

            for (const e of entries) {
                const rawKey = e.key || e.cache_key;
                if (!rawKey) continue;
                const key = rawKey.toLowerCase();
                stmt.run([
                    key,
                    e.type || null,
                    e.tmdb_id || e.id || null,
                    e.mal_id || null,
                    e.name || null,
                    e.poster_path || null,
                    e.mal_poster || null,
                    e.backdrop_path || null,
                    e.vote_average != null ? e.vote_average : null,
                    e.overview || null,
                    e.first_air_date || null,
                    e.ts || now
                ]);
            }

            stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                    posterCacheDb.run('ROLLBACK');
                    return reject(finalizeErr);
                }
                posterCacheDb.run('COMMIT', (commitErr) => {
                    if (commitErr) return reject(commitErr);
                    resolve(entries.length);
                });
            });
        });
    });
}

function migratePosterCacheJsonToDb() {
    if (!fs.existsSync(POSTER_CACHE_FILE)) return;

    posterCacheDb.get('SELECT COUNT(*) AS c FROM poster_cache', [], async (countErr, row) => {
        if (countErr) {
            console.warn('Poster cache migration count error:', countErr.message || countErr);
            return;
        }
        if ((row?.c || 0) > 0) return;

        try {
            const raw = fs.readFileSync(POSTER_CACHE_FILE, 'utf8');
            const parsed = raw ? JSON.parse(raw) : {};
            const entries = Object.entries(parsed).map(([key, v]) => ({
                key,
                type: v?.type || null,
                tmdb_id: v?.tmdb_id || v?.id || null,
                mal_id: v?.mal_id || null,
                name: v?.name || null,
                poster_path: v?.poster_path || null,
                mal_poster: v?.mal_poster || null,
                backdrop_path: v?.backdrop_path || null,
                vote_average: v?.vote_average != null ? v.vote_average : null,
                overview: v?.overview || null,
                first_air_date: v?.first_air_date || null,
                ts: v?.ts || Date.now()
            }));

            if (!entries.length) return;
            await posterCacheUpsertMany(entries, Date.now());
            console.log(`✅ Migrated ${entries.length} poster cache entries from JSON to DB`);
        } catch (err) {
            console.warn('Poster cache migration error:', err.message || err);
        }
    });
}

migratePosterCacheJsonToDb();

// One-time migration: lowercase all existing cache_key values in the DB
function normalizePosterCacheKeys() {
    posterCacheDb.all('SELECT cache_key FROM poster_cache', [], (err, rows) => {
        if (err || !rows || !rows.length) return;
        const needsFix = rows.filter(r => r.cache_key !== r.cache_key.toLowerCase());
        if (!needsFix.length) return;
        posterCacheDb.serialize(() => {
            posterCacheDb.run('BEGIN TRANSACTION');
            const stmt = posterCacheDb.prepare(
                'UPDATE poster_cache SET cache_key = ? WHERE cache_key = ?'
            );
            for (const r of needsFix) stmt.run([r.cache_key.toLowerCase(), r.cache_key]);
            stmt.finalize(() => {
                posterCacheDb.run('COMMIT');
                console.log(`✅ Normalized ${needsFix.length} poster cache keys to lowercase`);
            });
        });
    });
}
normalizePosterCacheKeys();

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
        revenue: item.revenue || 0,
        imdb_id: item.imdb_id || (item.external_ids && item.external_ids.imdb_id) || null
    };
}

function mapTmdbMovieWithCredits(item, credits) {
    const mapped = mapTmdbMovie(item);
    const directors = (credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
    const cast = (credits?.cast || []).slice(0, 6).map(c => c.name);
    return {
        ...mapped,
        Directors: directors.join(', ') || 'N/A',
        Stars: cast.join(', ') || 'N/A',
        imdb_id: mapped.imdb_id // ensure imdb_id is always present
    };
}

// --- 1. MIDDLEWARE ---
// Restrict CORS to the middleware layer only (localhost:3000).
// In production, replace with the real middleware domain.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://localhost:3000,http://localhost:3000')
    .split(',').map(o => o.trim());
app.use(cors({
    origin: (origin, cb) => {
        // Allow requests with no origin (e.g. same-origin, curl, Postman), explicitly allowed origins, or local network IPs
        if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://192.168.') || origin.startsWith('https://192.168.')) return cb(null, true);
        
        console.error(`CORS Blocked: ${origin}`); // Log the blocked origin for debugging
        cb(new Error('CORS: origin not allowed'));
    },
    credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Secret-header guard — backend refuses any request that didn't come through the middleware.
// Override the default with the MIDDLEWARE_SECRET environment variable (must match middleware.js).
const MIDDLEWARE_SECRET = process.env.MIDDLEWARE_SECRET || 'ls_internal_4f8b2e9d';
app.use((req, res, next) => {
    // Allow direct browser access to the MAL OAuth endpoints
    if (
        req.path === '/api/auth/mal/callback' ||
        req.path === '/api/auth/mal'
    ) {
        return next();
    }
    if (req.headers['x-middleware-secret'] !== MIDDLEWARE_SECRET) {
        return res.status(403).json({ error: 'Forbidden: direct access to backend is not allowed' });
    }
    next();
});

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
// app.use(generalLimiter);
 
// Static files are served by middleware.js — not here.
// (The backend is internal-only and should never be hit directly by browsers.)

// DEBUG: Log all incoming requests (method, path, query)
app.use((req, res, next) => {
    console.log('REQ:', req.method, req.path, req.query);
    next();
});

// Sexy friendly admin routes
app.get('/admin', (req, res) => res.redirect('/html/admin.html'));
app.get('/html/admin', (req, res) => res.redirect('/html/admin.html'));

function signUserToken(user) {
    const isAdmin = isAdminUser(user);
    return jwt.sign(
        {
            userUID: user.userUID,
            accountUID: user.accountUID || null,
            userEmail: user.userEmail,
            username: user.username,
            userTier: user.userTier,
            isAdmin
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function buildClientUser(user) {
    if (!user) return null;
    let allUIDs = [];
    if (Array.isArray(user.allUIDs)) {
        allUIDs = user.allUIDs;
    } else if (typeof user.allUIDs === 'string') {
        try {
            allUIDs = JSON.parse(user.allUIDs || '[]');
        } catch (_) {
            allUIDs = [];
        }
    }
    return {
        userUID: user.userUID,
        username: user.username || 'Guest',
        userEmail: user.userEmail || null,
        userTier: user.userTier || 'Free',
        userLanguage: user.userLanguage || 'en',
        searchCount: user.searchCount || 0,
        viewCount: user.viewCount || 0,
        allUIDs,
        accountUID: user.accountUID || null,
        is_guest: user.is_guest === 1 ? 1 : 0,
        loginCode: user.login_code || null,
        created_at: user.created_at,
        last_seen: user.last_seen,
        isAdmin: isAdminUser(user)
    };
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

function normalizeAccountUID(uid) {
    return String(uid || '').trim().slice(0, 64);
}

function normalizeLoginCode(code) {
    return String(code || '').trim().toUpperCase().slice(0, 32);
}

function generateLoginCode() {
    return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function assignLoginCode(userUID, callback) {
    const code = generateLoginCode();
    const expiresAt = Math.floor(Date.now() / 1000) + LOGIN_CODE_TTL_SECONDS;
    usersDb.run(
        'UPDATE users SET login_code = ?, login_code_expires_at = ? WHERE userUID = ?',
        [code, expiresAt, userUID],
        function (err) {
            if (err) return callback(err);
            callback(null, { login_code: code, login_code_expires_at: expiresAt });
        }
    );
}

function getUserByAccountUID(accountUID, callback) {
    const normalized = normalizeAccountUID(accountUID);
    if (!normalized) return callback(null, null);
    usersDb.get('SELECT * FROM users WHERE accountUID = ?', [normalized], callback);
}

function ensureGuestUser(accountUID, options = {}, callback) {
    const normalized = normalizeAccountUID(accountUID);
    if (!normalized || !normalized.startsWith('g_')) {
        return callback(new Error('Invalid guest UID'));
    }

    getUserByAccountUID(normalized, (err, row) => {
        if (err) return callback(err);
        const now = Math.floor(Date.now() / 1000);
        if (row) {
            usersDb.run('UPDATE users SET last_seen = ? WHERE userUID = ?', [now, row.userUID], (updateErr) => {
                return callback(updateErr, row);
            });
            return;
        }

        usersDb.get('SELECT MAX(userUID) as maxUID FROM users', (err2, row2) => {
            if (err2) return callback(err2);
            const nextUID = ((row2 && row2.maxUID) ? row2.maxUID : 0) + 1;
            const guestRecord = {
                userUID: nextUID,
                accountUID: normalized,
                username: 'Guest',
                userEmail: null,
                userTier: 'Free',
                userLanguage: String(options.userLanguage || 'en').slice(0, 8),
                searchCount: 0,
                viewCount: 0,
                allUIDs: JSON.stringify([normalized]),
                userPassword: '',
                is_guest: 1,
                created_at: now,
                last_seen: now
            };
            usersDb.run(
                `INSERT INTO users (userUID, accountUID, username, userEmail, userTier, userLanguage, searchCount, viewCount, allUIDs, userPassword, is_guest, created_at, last_seen)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [guestRecord.userUID, guestRecord.accountUID, guestRecord.username, guestRecord.userEmail, guestRecord.userTier, guestRecord.userLanguage, guestRecord.searchCount, guestRecord.viewCount, guestRecord.allUIDs, guestRecord.userPassword, guestRecord.is_guest, guestRecord.created_at, guestRecord.last_seen],
                function (insertErr) {
                    if (insertErr) return callback(insertErr);
                    assignLoginCode(guestRecord.userUID, (codeErr, codeData) => {
                        if (codeErr) return callback(codeErr);
                        guestRecord.login_code = codeData.login_code;
                        guestRecord.login_code_expires_at = codeData.login_code_expires_at;
                        callback(null, guestRecord);
                    });
                }
            );
        });
    });
}

app.post('/users/guest/ensure', async (req, res) => {
    const { accountUID, userLanguage } = req.body || {};
    if (!accountUID || typeof accountUID !== 'string' || !accountUID.startsWith('g_')) {
        return res.status(400).json({ error: 'Valid accountUID required' });
    }
    ensureGuestUser(accountUID, { userLanguage }, (err, user) => {
        if (err) {
            console.error('Guest ensure error:', err.message || err);
            return res.status(500).json({ error: 'Could not ensure guest user' });
        }
        res.json({ success: true, user: buildClientUser(user) });
    });
});

app.post('/users/guest/convert', strictLimiter, async (req, res) => {
    try {
        const { guestUID, userEmail, userPassword } = req.body || {};
        if (!guestUID || typeof guestUID !== 'string' || !guestUID.startsWith('g_')) {
            return res.status(400).json({ error: 'Valid guestUID required' });
        }
        if (!userEmail || !userPassword) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const normalizedEmail = String(userEmail).trim().toLowerCase();
        usersDb.get('SELECT * FROM users WHERE userEmail = ?', [normalizedEmail], async (emailErr, existingEmailUser) => {
            if (emailErr) return res.status(500).json({ error: 'Database error' });
            if (existingEmailUser) return res.status(409).json({ error: 'Email already registered' });

            usersDb.get('SELECT * FROM users WHERE accountUID = ? AND is_guest = 1', [guestUID], async (err, guestUser) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                if (!guestUser) return res.status(404).json({ error: 'Guest account not found' });

                usersDb.get(`SELECT MAX(CAST(accountUID AS INTEGER)) AS maxNumeric FROM users WHERE accountUID GLOB '[0-9]*'`, [], async (maxErr, row) => {
                    if (maxErr) return res.status(500).json({ error: 'Database error' });
                    const nextAccountUID = ((row && row.maxNumeric) ? row.maxNumeric : 0) + 1;
                    const hashedPassword = await bcrypt.hash(userPassword, BCRYPT_SALT_ROUNDS);
                    const newAccountUID = String(nextAccountUID);
                    const newAllUIDs = JSON.stringify([newAccountUID]);

                    usersDb.run(
                        'UPDATE users SET accountUID = ?, userEmail = ?, userPassword = ?, is_guest = 0, allUIDs = ? WHERE userUID = ?',
                        [newAccountUID, normalizedEmail, hashedPassword, newAllUIDs, guestUser.userUID],
                        function (updateErr) {
                            if (updateErr) {
                                console.error('Guest conversion update failed:', updateErr.message || updateErr);
                                return res.status(500).json({ error: 'Could not convert guest account' });
                            }

                            usersDb.get('SELECT * FROM users WHERE userUID = ?', [guestUser.userUID], (selectErr, updatedUser) => {
                                if (selectErr) return res.status(500).json({ error: 'Could not load converted user' });
                                res.json({ success: true, user: buildClientUser(updatedUser) });
                            });
                        }
                    );
                });
            });
        });
    } catch (err) {
        console.error('Guest conversion error:', err);
        res.status(500).json({ error: 'Could not convert guest account' });
    }
});

app.post('/users/login-code/request', strictLimiter, async (req, res) => {
    try {
        const { userEmail, accountUID } = req.body || {};
        if (!userEmail && !accountUID) return res.status(400).json({ error: 'Email or accountUID required' });

        const queryUser = (user) => {
            if (!user) return res.status(404).json({ error: 'User not found' });
            const code = generateLoginCode();
            const expiresAt = Math.floor(Date.now() / 1000) + LOGIN_CODE_TTL_SECONDS;
            usersDb.run('UPDATE users SET login_code = ?, login_code_expires_at = ? WHERE userUID = ?', [code, expiresAt, user.userUID], function (updateErr) {
                if (updateErr) return res.status(500).json({ error: 'Could not save login code' });
                const target = userEmail ? `email=${String(userEmail).trim().toLowerCase()}` : `accountUID=${String(accountUID).trim()}`;
                console.log(`[LoginCode] ${target} code=${code} expires=${new Date(expiresAt * 1000).toISOString()}`);
                res.json({ ok: true, login_code: code, expires_at: expiresAt });
            });
        };

        if (userEmail) {
            const normalizedEmail = String(userEmail).trim().toLowerCase();
            usersDb.get('SELECT * FROM users WHERE userEmail = ?', [normalizedEmail], async (err, user) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                queryUser(user);
            });
            return;
        }

        const normalizedUID = normalizeAccountUID(accountUID);
        usersDb.get('SELECT * FROM users WHERE accountUID = ?', [normalizedUID], async (err, user) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            queryUser(user);
        });
    } catch (err) {
        console.error('Login code request error:', err);
        res.status(500).json({ error: 'Could not request login code' });
    }
});

app.get('/users/account-status', async (req, res) => {
    try {
        const accountUID = String(req.query.accountUID || '').trim();
        if (!accountUID) return res.status(400).json({ error: 'accountUID required' });
        const normalizedUID = normalizeAccountUID(accountUID);
        usersDb.get('SELECT is_guest FROM users WHERE accountUID = ?', [normalizedUID], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!row) return res.status(404).json({ error: 'User not found' });
            res.json({ is_guest: row.is_guest === 1 ? 1 : 0 });
        });
    } catch (err) {
        console.error('Account status lookup error:', err);
        res.status(500).json({ error: 'Could not retrieve account status' });
    }
});

app.post('/users/auth-code', strictLimiter, async (req, res) => {
    try {
        const { userEmail, accountUID, loginCode } = req.body || {};
        if ((!userEmail && !accountUID) || !loginCode) return res.status(400).json({ error: 'Email or accountUID and login code required' });
        const normalizedCode = normalizeLoginCode(loginCode);

        const query = userEmail
            ? { sql: 'SELECT * FROM users WHERE userEmail = ?', params: [String(userEmail).trim().toLowerCase()] }
            : { sql: 'SELECT * FROM users WHERE accountUID = ?', params: [normalizeAccountUID(accountUID)] };

        usersDb.get(query.sql, query.params, async (err, user) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!user) return res.status(401).json({ error: 'Invalid credentials' });
            const now = Math.floor(Date.now() / 1000);
            if (!user.login_code || normalizeLoginCode(user.login_code) !== normalizedCode || !user.login_code_expires_at || user.login_code_expires_at < now) {
                return res.status(401).json({ error: 'Invalid or expired login code' });
            }
            usersDb.run('UPDATE users SET login_code = NULL, login_code_expires_at = NULL WHERE userUID = ?', [user.userUID], (updateErr) => {
                if (updateErr) console.error('Could not clear login code:', updateErr.message || updateErr);
                const clientUser = buildClientUser(user);
                const token = signUserToken(user);
                res.json({ success: true, token, user: clientUser });
            });
        });
    } catch (err) {
        console.error('Auth code error:', err);
        res.status(500).json({ error: 'Could not authenticate user' });
    }
});

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

// --- 1.7 POSTER CACHE ---
const POSTER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// GET /api/poster-cache?keys=title1,title2,...
app.get('/api/poster-cache', async (req, res) => {
    const keys = String(req.query.keys || '')
        .split(',')
        .map(k => decodeURIComponent(k.trim()))
        .filter(Boolean);
    if (!keys.length) return res.json({});

    const minTs = Date.now() - POSTER_CACHE_TTL;
    try {
        const rows = await posterCacheGetMany(keys, minTs);
        const result = {};
        for (const row of rows) {
            result[row.cache_key] = {
                type: row.type,
                tmdb_id: row.tmdb_id,
                mal_id: row.mal_id,
                name: row.name,
                poster_path: row.poster_path,
                mal_poster: row.mal_poster,
                backdrop_path: row.backdrop_path,
                vote_average: row.vote_average,
                overview: row.overview,
                first_air_date: row.first_air_date,
                ts: row.ts
            };
        }
        res.json(result);
    } catch (err) {
        console.warn('Poster cache GET DB error:', err.message || err);
        res.status(500).json({ error: 'poster cache read failed' });
    }
});

// POST /api/poster-cache  body: { entries: [{key, id, name, poster_path, backdrop_path, vote_average, overview, first_air_date}] }
app.post('/api/poster-cache', async (req, res) => {
    const { entries } = req.body || {};
    if (!Array.isArray(entries) || !entries.length) {
        return res.status(400).json({ error: 'entries array required' });
    }

    const now = Date.now();
    try {
        const saved = await posterCacheUpsertMany(entries, now);
        res.json({ saved });
    } catch (err) {
        console.warn('Poster cache POST DB error:', err.message || err);
        res.status(500).json({ error: 'poster cache write failed' });
    }
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
});
const animeInfoCacheDb = new sqlite3.Database(
    path.join(__dirname, "animeCache.db"),
    (err) => {
        if (err) {
            console.error("Anime cache DB error:", err.message);
        } else {
            console.log("✅ Connected to anime cache database");
        }
    }
);
usersDb.serialize(() => {
    usersDb.run(`CREATE TABLE IF NOT EXISTS users (
        userUID INTEGER PRIMARY KEY,
        accountUID TEXT,
        username TEXT,
        userEmail TEXT UNIQUE,
        userTier TEXT,
        userLanguage TEXT,
        searchCount INTEGER,
        viewCount INTEGER,
        allUIDs TEXT,
        userPassword TEXT,
        is_guest INTEGER DEFAULT 0,
        login_code TEXT,
        login_code_expires_at INTEGER,
        created_at INTEGER,
        last_seen INTEGER
    )`);
    usersDb.run(`ALTER TABLE users ADD COLUMN accountUID TEXT`, () => {});
    usersDb.run(`ALTER TABLE users ADD COLUMN is_guest INTEGER DEFAULT 0`, () => {});
    usersDb.run(`ALTER TABLE users ADD COLUMN login_code TEXT`, () => {});
    usersDb.run(`ALTER TABLE users ADD COLUMN login_code_expires_at INTEGER`, () => {});
    usersDb.run(`ALTER TABLE users ADD COLUMN created_at INTEGER`, () => {});
    usersDb.run(`ALTER TABLE users ADD COLUMN last_seen INTEGER`, () => {});
    usersDb.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_accountUID ON users(accountUID)`);
    usersDb.run(`UPDATE users SET accountUID = CAST(userUID AS TEXT) WHERE accountUID IS NULL OR accountUID = ''`);
    usersDb.run(`UPDATE users SET userEmail = NULL WHERE TRIM(IFNULL(userEmail, '')) = ''`, () => {});
    usersDb.run(`UPDATE users SET login_code = NULL, login_code_expires_at = NULL WHERE login_code = ''`, () => {});
    usersDb.each('SELECT userUID, userEmail, accountUID, login_code, login_code_expires_at FROM users WHERE login_code IS NULL OR login_code = "" OR login_code_expires_at IS NULL OR LENGTH(login_code) != 10', (err, user) => {
        if (err || !user) return;
        const code = generateLoginCode();
        const expiresAt = Math.floor(Date.now() / 1000) + LOGIN_CODE_TTL_SECONDS;
        usersDb.run('UPDATE users SET login_code = ?, login_code_expires_at = ? WHERE userUID = ?', [code, expiresAt, user.userUID], (updateErr) => {
            if (updateErr) return console.error('Could not initialize login code for user', user.userUID, updateErr.message || updateErr);
            console.log(`[LoginCodeInit] userUID=${user.userUID} accountUID=${user.accountUID || ''} email=${user.userEmail || ''} code=${code} expires=${new Date(expiresAt * 1000).toISOString()}`);
        });
    });
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
            tmdbGet(`/movie/${id}`, { language: 'en-US', append_to_response: 'external_ids' }),
            tmdbGet(`/movie/${id}/credits`, { language: 'en-US' })
        ])
            .then(([data, credits]) => {
                // Attach imdb_id from external_ids if present
                if (data.external_ids && data.external_ids.imdb_id) {
                    data.imdb_id = data.external_ids.imdb_id;
                }
                res.json(mapTmdbMovieWithCredits(data, credits));
            })
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
    db.get(sql, [id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Movie not found" });
        // Try to extract imdb_id from any IMDB link field
        let imdb_id = null;
        const imdbFields = [row.imdb_id, row.imdbID, row.imdb, row.imdb_url, row["IMDB Link"]];
        for (const field of imdbFields) {
            if (typeof field === 'string' && field.includes('tt')) {
                const match = field.match(/tt\d{7,}/);
                if (match) {
                    imdb_id = match[0];
                    break;
                }
            }
        }
        // If not found, try to extract from any field that looks like a URL
        if (!imdb_id) {
            for (const key in row) {
                if (typeof row[key] === 'string' && row[key].includes('imdb.com/title/tt')) {
                    const match = row[key].match(/tt\d{7,}/);
                    if (match) {
                        imdb_id = match[0];
                        break;
                    }
                }
            }
        }
        // If still not found, try TMDB API using tmdb_id if available (using /external_ids endpoint)
        if (!imdb_id && (row.tmdb_id || row.TMDB_ID || row.tmdbID)) {
            const tmdbId = row.tmdb_id || row.TMDB_ID || row.tmdbID;
            try {
                const tmdbResp = await tmdbGet(`/movie/${tmdbId}/external_ids`);
                if (tmdbResp && tmdbResp.imdb_id) {
                    imdb_id = tmdbResp.imdb_id;
                }
            } catch (e) {
                console.warn('TMDB /external_ids lookup failed for IMDB id:', e.message);
            }
        }
        // Attach imdb_id to the returned object
        row.imdb_id = imdb_id;
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

// ── Activity DB (watch history + genre affinity) ──────────────
const activityDbPath = path.join(__dirname, 'activity.db');
const activityDb = new sqlite3.Database(activityDbPath, (err) => {
    if (err) console.error('Activity DB error:', err.message);
    else console.log('✅ Connected to activity database');
});
activityDb.serialize(() => {
    activityDb.run(`CREATE TABLE IF NOT EXISTS watch_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        userUID   TEXT    NOT NULL,
        movie_id  TEXT    NOT NULL,
        title     TEXT,
        genre     TEXT,
        year      TEXT,
        rating    TEXT,
        item_type TEXT    NOT NULL DEFAULT 'movie',
        watched_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        continue_from TEXT,
        timeStamp_continue TEXT,
        finished  TEXT,
        UNIQUE(userUID, movie_id)
    )`);
    // Add columns to existing schema safely
    activityDb.run(`ALTER TABLE watch_history ADD COLUMN item_type TEXT NOT NULL DEFAULT 'movie'`, () => {});
    activityDb.run(`ALTER TABLE watch_history ADD COLUMN continue_from TEXT`, () => {});
    activityDb.run(`ALTER TABLE watch_history ADD COLUMN timeStamp_continue TEXT`, () => {});
    activityDb.run(`CREATE TABLE IF NOT EXISTS user_list (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        userUID   TEXT    NOT NULL,
        item_id   TEXT    NOT NULL,
        item_type TEXT    NOT NULL DEFAULT 'movie',
        added_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        UNIQUE(userUID, item_id)
    )`);

    // Repair legacy/broken watch_history schemas that used strftime(chr(...)) in default value.
    // SQLite doesn't have chr(), so inserts fail at runtime with "unknown function: chr()".
    activityDb.get(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='watch_history'`,
        (schemaErr, row) => {
            if (schemaErr || !row || !row.sql) return;
            if (!String(row.sql).toLowerCase().includes('chr(')) return;

            console.warn('[activity/watch_history] Detected broken schema default; repairing table...');
            activityDb.serialize(() => {
                activityDb.run('BEGIN TRANSACTION');
                activityDb.run(`CREATE TABLE IF NOT EXISTS watch_history_new (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    userUID   TEXT    NOT NULL,
                    movie_id  TEXT    NOT NULL,
                    title     TEXT,
                    genre     TEXT,
                    year      TEXT,
                    rating    TEXT,
                    item_type TEXT    NOT NULL DEFAULT 'movie',
                    watched_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                    continue_from TEXT,
                    timeStamp_continue TEXT,
                    finished  TEXT,
                    UNIQUE(userUID, movie_id)
                )`);
                activityDb.run(
                          `INSERT OR REPLACE INTO watch_history_new (userUID, movie_id, title, genre, year, rating, item_type, watched_at, continue_from, timeStamp_continue, finished)
                        SELECT userUID, movie_id, title, genre, year, rating,
                            COALESCE(item_type, 'movie'), COALESCE(watched_at, strftime('%s','now')), continue_from, timeStamp_continue, finished
                        FROM watch_history
                        ORDER BY watched_at ASC`
                );
                activityDb.run('DROP TABLE watch_history');
                activityDb.run('ALTER TABLE watch_history_new RENAME TO watch_history');
                activityDb.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                        console.error('[activity/watch_history] Repair failed:', commitErr.message);
                        return;
                    }
                    console.log('[activity/watch_history] Repair complete.');
                });
            });
        }
    );
});

// POST /activity/watch — record a movie view
app.post('/activity/watch', (req, res) => {
    console.log('[activity/watch] HIT — body:', JSON.stringify(req.body));
    const { userUID, movie_id, title, genre, year, rating, item_type, continue_from, timeStamp_continue, finished } = req.body || {};
    if (!userUID || !movie_id) {
        console.warn('[activity/watch] REJECTED — missing userUID or movie_id');
        return res.status(400).json({ error: 'userUID and movie_id required' });
    }
    const safeUID  = String(userUID).slice(0, 64);
    const safeId   = String(movie_id).slice(0, 32);
    const safeTitle  = String(title  || '').slice(0, 200);
    const safeGenre  = String(genre  || '').slice(0, 200);
    const safeYear   = String(year   || '').slice(0, 4);
    const safeRating = String(rating || '').slice(0, 10);
    const safeItemType = (String(item_type || 'movie') === 'tv') ? 'tv' : 'movie';
    const continueFromVal = continue_from ? String(continue_from).slice(0, 50) : null;
    const rawTimeStamp = timeStamp_continue ? String(timeStamp_continue).slice(0, 2000) : null;

    const parseContinueMap = (raw) => {
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                const map = {};
                parsed.forEach(item => {
                    if (!Array.isArray(item) || item.length < 2) return;
                    const key = String(item[0]);
                    const value = Number(item[1]);
                    if (key && Number.isFinite(value)) map[key] = Math.max(0, Math.floor(value));
                });
                return map;
            }
            if (parsed && typeof parsed === 'object') {
                const map = {};
                Object.entries(parsed).forEach(([key, value]) => {
                    const num = Number(value);
                    if (key && Number.isFinite(num)) map[String(key)] = Math.max(0, Math.floor(num));
                });
                return map;
            }
        } catch (e) {
            // Ignore invalid data
        }
        return {};
    };

    const mergeContinueMaps = (base, incoming) => ({ ...base, ...incoming });

    // Get current record to merge `finished` and `timeStamp_continue` if they exist
    activityDb.get(`SELECT finished, timeStamp_continue FROM watch_history WHERE userUID = ? AND movie_id = ?`, [safeUID, safeId], (err, row) => {
        let finishedArr = [];
        let existingTimeStampMap = {};
        if (row && row.finished) {
            try { finishedArr = JSON.parse(row.finished); } catch (e) {}
        }
        if (row && row.timeStamp_continue) {
            existingTimeStampMap = parseContinueMap(String(row.timeStamp_continue));
        }

        if (finished && !finishedArr.includes(finished)) {
            finishedArr.push(finished);
        }
        const finishedVal = finishedArr.length > 0 ? JSON.stringify(finishedArr) : null;

        const newTimeStampMap = parseContinueMap(rawTimeStamp);
        const mergedTimeStampMap = Object.keys(newTimeStampMap).length
            ? mergeContinueMaps(existingTimeStampMap, newTimeStampMap)
            : existingTimeStampMap;
        const timeStampContinueVal = Object.keys(mergedTimeStampMap).length
            ? JSON.stringify(mergedTimeStampMap)
            : null;

        activityDb.run(
            `INSERT INTO watch_history (userUID, movie_id, title, genre, year, rating, item_type, continue_from, timeStamp_continue, finished)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(userUID, movie_id) DO UPDATE SET
                 title=COALESCE(NULLIF(excluded.title, ''), title),
                 genre=COALESCE(NULLIF(excluded.genre, ''), genre),
                 year=COALESCE(NULLIF(excluded.year, ''), year),
                 rating=COALESCE(NULLIF(excluded.rating, ''), rating),
                 item_type=COALESCE(NULLIF(excluded.item_type, ''), item_type),
                 watched_at=(strftime('%s','now')),
                 continue_from=COALESCE(excluded.continue_from, continue_from),
                 timeStamp_continue=COALESCE(excluded.timeStamp_continue, timeStamp_continue),
                 finished=COALESCE(excluded.finished, finished)`,
               [safeUID, safeId, safeTitle, safeGenre, safeYear, safeRating, safeItemType, continueFromVal, timeStampContinueVal, finishedVal],
            (err) => {
                if (err) {
                    console.error('[activity/watch] INSERT ERROR:', err.message);
                    return res.status(500).json({ error: 'db insert failed', detail: err.message });
                }
                console.log(`[activity/watch] SAVED — uid=${safeUID} movie=${safeId} title="${safeTitle}" continue_from=${continueFromVal} timeStamp_continue=${timeStampContinueVal} finished=${finishedVal}`);

                if (safeGenre) {
                    safeGenre.split(',').slice(0, 5).forEach(g => {
                        const gTrim = g.trim().slice(0, 50);
                        if (!gTrim) return;
                        activityDb.run(
                            `INSERT INTO genre_affinity (userUID, genre, score) VALUES (?,?,1)
                             ON CONFLICT(userUID, genre) DO UPDATE SET score = score + 1`,
                            [safeUID, gTrim]
                        );
                    });
                }

                return res.json({ ok: true, finished: finishedArr });
            }
        );
    });
});

// GET /activity/history — recent watch history for a user
app.get('/activity/history', (req, res) => {
    const userUID = String(req.query.userUID || '').slice(0, 64);
    const movieId = req.query.movie_id ? String(req.query.movie_id).slice(0, 32) : null;
    const limit   = Math.min(parseInt(req.query.limit) || 20, 50);
    if (!userUID) return res.json([]);

    if (movieId) {
        activityDb.get(
            `SELECT movie_id, title, genre, year, rating, item_type, watched_at, continue_from, timeStamp_continue, finished
             FROM watch_history WHERE userUID = ? AND movie_id = ?`,
            [userUID, movieId],
            (err, row) => {
                if (err) { console.error('[activity/history]', err.message); return res.json([]); }
                res.json(row ? [row] : []);
            }
        );
    } else {
        activityDb.all(
            `SELECT movie_id, title, genre, year, rating, item_type, watched_at, continue_from, timeStamp_continue, finished
             FROM watch_history WHERE userUID = ?
             ORDER BY watched_at DESC LIMIT ?`,
            [userUID, limit],
            (err, rows) => {
                if (err) { console.error('[activity/history]', err.message); return res.json([]); }
                res.json(rows || []);
            }
        );
    }
});

function parsePlaybackPosition(raw) {
    if (!raw) return 0;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number') {
            return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
        }
        if (typeof parsed === 'string') {
            const num = Number(parsed);
            return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
        }
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                if (!Array.isArray(item) || item.length < 2) continue;
                const num = Number(item[1]);
                if (Number.isFinite(num)) return Math.max(0, Math.floor(num));
            }
            return 0;
        }
        if (parsed && typeof parsed === 'object') {
            for (const value of Object.values(parsed)) {
                const num = Number(value);
                if (Number.isFinite(num)) return Math.max(0, Math.floor(num));
            }
            return 0;
        }
    } catch (e) {
        return 0;
    }
    return 0;
}

// GET /activity/continueWatching — continue-watching rows for a user
app.get('/activity/continueWatching', (req, res) => {
    const userUID = String(req.query.userUID || '').slice(0, 64);
    if (!userUID) return res.json([]);

    activityDb.all(
        `SELECT movie_id, item_type, timeStamp_continue
         FROM watch_history
         WHERE userUID = ?
           AND timeStamp_continue IS NOT NULL
         ORDER BY timeStamp_continue DESC
         LIMIT 10`,
        [userUID],
        (err, rows) => {
            if (err) {
                console.error('[activity/continueWatching]', err.message);
                return res.json([]);
            }

            const payload = (rows || []).map(row => {
                const type = String(row.item_type || 'movie').toLowerCase();
                return {
                    movie_id: row.movie_id,
                    type: type === 'tv' || type === 'anime' ? 'tv' : 'movie',
                    continue_timestamp: row.timeStamp_continue || null,
                    playback_position: parsePlaybackPosition(row.timeStamp_continue)
                };
            });

            res.json(payload);
        }
    );
});

// POST /activity/history/remove — remove an item from history
app.post('/activity/history/remove', (req, res) => {
    const { userUID, movie_id } = req.body || {};
    if (!userUID || !movie_id) return res.status(400).json({ error: 'userUID and movie_id required' });
    const safeUID = String(userUID).slice(0, 64);
    const safeId  = String(movie_id).slice(0, 32);
    activityDb.run(
        `DELETE FROM watch_history WHERE userUID = ? AND movie_id = ?`,
        [safeUID, safeId],
        (err) => {
            if (err) { console.error('[activity/history remove]', err.message); return res.status(500).json({ error: 'db error' }); }
            res.json({ ok: true });
        }
    );
});

// GET /activity/genres — top genres for a user
app.get('/activity/genres', (req, res) => {
    const userUID = String(req.query.userUID || '').slice(0, 64);
    if (!userUID) return res.json([]);
    activityDb.all(
        `SELECT genre, score FROM genre_affinity WHERE userUID = ?
         ORDER BY score DESC LIMIT 10`,
        [userUID],
        (err, rows) => {
            if (err) { console.error('[activity/genres]', err.message); return res.json([]); }
            res.json(rows || []);
        }
    );
});

// GET /activity/list — fetch saved list for a user
app.get('/activity/list', (req, res) => {
    const userUID = String(req.query.userUID || '').slice(0, 64);
    if (!userUID) return res.json([]);
    activityDb.all(
        `SELECT item_id, item_type FROM user_list WHERE userUID = ? ORDER BY added_at ASC`,
        [userUID],
        (err, rows) => {
            if (err) { console.error('[activity/list GET]', err.message); return res.json([]); }
            res.json((rows || []).map(r => ({ id: r.item_id, type: r.item_type })));
        }
    );
});

// POST /activity/list/add — add an item to the list
app.post('/activity/list/add', (req, res) => {
    const { userUID, item_id, item_type } = req.body || {};
    if (!userUID || !item_id) return res.status(400).json({ error: 'userUID and item_id required' });
    const safeUID  = String(userUID).slice(0, 64);
    const safeId   = String(item_id).slice(0, 32);
    const safeType = String(item_type || 'movie').slice(0, 16);
    activityDb.run(
        `INSERT OR IGNORE INTO user_list (userUID, item_id, item_type) VALUES (?,?,?)`,
        [safeUID, safeId, safeType],
        (err) => {
            if (err) { console.error('[activity/list add]', err.message); return res.status(500).json({ error: 'db error' }); }
            res.json({ ok: true });
        }
    );
});

// POST /activity/list/remove — remove an item from the list
app.post('/activity/list/remove', (req, res) => {
    const { userUID, item_id } = req.body || {};
    if (!userUID || !item_id) return res.status(400).json({ error: 'userUID and item_id required' });
    const safeUID = String(userUID).slice(0, 64);
    const safeId  = String(item_id).slice(0, 32);
    activityDb.run(
        `DELETE FROM user_list WHERE userUID = ? AND item_id = ?`,
        [safeUID, safeId],
        (err) => {
            if (err) { console.error('[activity/list remove]', err.message); return res.status(500).json({ error: 'db error' }); }
            res.json({ ok: true });
        }
    );
});

// ── YouTube trailer scraper (server-side, no API key needed) ──
app.get('/api/yt-search', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.length > 200) {
        return res.status(400).json({ videoId: '' });
    }
    try {
        const ytRes = await axios.get(
            `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                timeout: 7000
            }
        );
        const html = ytRes.data;
        const marker = 'var ytInitialData = ';
        const start = html.indexOf(marker);
        if (start === -1) return res.json({ videoId: '' });
        const jsonStart = start + marker.length;
        const jsonEnd = html.indexOf(';</script>', jsonStart);
        if (jsonEnd === -1) return res.json({ videoId: '' });
        const data = JSON.parse(html.slice(jsonStart, jsonEnd));
        const contents =
            data?.contents?.twoColumnSearchResultsRenderer
                ?.primaryContents?.sectionListRenderer
                ?.contents?.[0]?.itemSectionRenderer?.contents || [];
        const firstVideo = contents.find(c => c.videoRenderer);
        const videoId = firstVideo?.videoRenderer?.videoId || '';
        res.json({ videoId });
    } catch (e) {
        console.error('[yt-search] Error:', e.message);
        res.json({ videoId: '' });
    }
});

// ── Random movie pick ──────────────────────────────────────────
app.get('/api/random-movie', (req, res) => {
    db.get(
        `SELECT m.ID, m."Movie Name" as title, m.Rating, m.Year, m.Genre, m.Poster
         FROM movies m
         WHERE m.Poster IS NOT NULL AND m.Poster != ''
         ORDER BY RANDOM() LIMIT 1`,
        (err, row) => {
            if (err || !row) return res.status(500).json({ error: 'No movie found' });
            res.json(row);
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
    } catch (e) { // just ignoree
    }

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

//=====================THE INDEXBROWSE ROW POPULATION FOR ANIME
//HEY RAPTOR DO THE ROW THIGN HERE
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
        const { username, userEmail, userTier, userPassword, userLanguage, guestAccountUID } = req.body || {};
        if (!username || !userEmail || !userPassword) {
            return res.status(400).json({ error: 'username, email, and password required' });
        }

        const normalizedEmail = String(userEmail).trim().toLowerCase();
        const normalizedLanguage = String(userLanguage || 'en').slice(0, 8);
        const normalizedGuestUID = guestAccountUID ? normalizeAccountUID(guestAccountUID) : null;

        const finalizeUser = (userRecord) => {
            const clientUser = buildClientUser(userRecord);
            const token = signUserToken(userRecord);
            res.json({ success: true, token, user: clientUser });
        };

        if (normalizedGuestUID && normalizedGuestUID.startsWith('g_')) {
            getUserByAccountUID(normalizedGuestUID, async (err, existingGuest) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                if (existingGuest) {
                    usersDb.get('SELECT * FROM users WHERE userEmail = ? AND userUID != ?', [normalizedEmail, existingGuest.userUID], async (emailErr, emailTaken) => {
                        if (emailErr) return res.status(500).json({ error: 'Database error' });
                        if (emailTaken) return res.status(409).json({ error: 'Email already registered' });

                        const hashedPassword = await bcrypt.hash(userPassword, BCRYPT_SALT_ROUNDS);
                        const existingUIDs = Array.isArray(existingGuest.allUIDs) ? existingGuest.allUIDs : (() => {
                            try { return JSON.parse(existingGuest.allUIDs || '[]'); } catch { return []; }
                        })();
                        const mergedUIDs = Array.from(new Set([...existingUIDs, normalizedGuestUID, String(existingGuest.userUID)]));

                        const updatedUser = {
                            ...existingGuest,
                            username,
                            userEmail: normalizedEmail,
                            userTier: userTier || existingGuest.userTier || 'Free',
                            userLanguage: normalizedLanguage,
                            searchCount: existingGuest.searchCount || 0,
                            viewCount: existingGuest.viewCount || 0,
                            allUIDs: JSON.stringify(mergedUIDs),
                            userPassword: hashedPassword,
                            is_guest: 0,
                            last_seen: Math.floor(Date.now() / 1000)
                        };

                        usersDb.run(
                            `UPDATE users SET username = ?, userEmail = ?, userTier = ?, userLanguage = ?, searchCount = ?, viewCount = ?, allUIDs = ?, userPassword = ?, is_guest = 0, last_seen = ? WHERE userUID = ?`,
                            [updatedUser.username, updatedUser.userEmail, updatedUser.userTier, updatedUser.userLanguage, updatedUser.searchCount, updatedUser.viewCount, updatedUser.allUIDs, updatedUser.userPassword, updatedUser.last_seen, updatedUser.userUID],
                            function (updateErr) {
                                if (updateErr) return res.status(500).json({ error: 'Could not register user' });
                                try {
                                    let users = [];
                                    if (fs.existsSync(usersPath)) {
                                        users = JSON.parse(fs.readFileSync(usersPath, 'utf8')) || [];
                                    }
                                    const idx = users.findIndex(u => String(u.userUID) === String(updatedUser.userUID));
                                    const stored = { ...updatedUser, allUIDs: mergedUIDs };
                                    if (idx !== -1) {
                                        users[idx] = stored;
                                    } else {
                                        users.push(stored);
                                    }
                                    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                                } catch (_) {}
                                finalizeUser(updatedUser);
                            }
                        );
                    });
                    return;
                }

                usersDb.get('SELECT * FROM users WHERE userEmail = ?', [normalizedEmail], (emailErr, row) => {
                    if (emailErr) return res.status(500).json({ error: 'Database error' });
                    if (row) return res.status(409).json({ error: 'Email already registered' });
                    createNewRegisteredUser();
                });
            });
            return;
        }

        usersDb.get('SELECT * FROM users WHERE userEmail = ?', [normalizedEmail], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (row) return res.status(409).json({ error: 'Email already registered' });
            createNewRegisteredUser();
        });

        function createNewRegisteredUser() {
            usersDb.get('SELECT MAX(userUID) as maxUID FROM users', async (err2, row2) => {
                if (err2) return res.status(500).json({ error: 'Database error' });
                const newUID = (row2 && row2.maxUID ? row2.maxUID : 0) + 1;
                const hashedPassword = await bcrypt.hash(userPassword, BCRYPT_SALT_ROUNDS);
                const userRecord = {
                    username,
                    userUID: newUID,
                    accountUID: String(newUID),
                    userEmail: normalizedEmail,
                    userTier: userTier || 'Free',
                    userLanguage: normalizedLanguage,
                    searchCount: 0,
                    viewCount: 0,
                    allUIDs: JSON.stringify([String(newUID)]),
                    userPassword: hashedPassword,
                    is_guest: 0,
                    created_at: Math.floor(Date.now() / 1000),
                    last_seen: Math.floor(Date.now() / 1000)
                };
                usersDb.run(
                    `INSERT INTO users (userUID, accountUID, username, userEmail, userTier, userLanguage, searchCount, viewCount, allUIDs, userPassword, is_guest, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userRecord.userUID, userRecord.accountUID, userRecord.username, userRecord.userEmail, userRecord.userTier, userRecord.userLanguage, userRecord.searchCount, userRecord.viewCount, userRecord.allUIDs, userRecord.userPassword, userRecord.is_guest, userRecord.created_at, userRecord.last_seen],
                    function (err3) {
                        if (err3) return res.status(500).json({ error: 'Could not register user' });
                        try {
                            let users = [];
                            if (fs.existsSync(usersPath)) {
                                users = JSON.parse(fs.readFileSync(usersPath, 'utf8')) || [];
                            }
                            users.push({ ...userRecord, allUIDs: [String(newUID)] });
                            fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
                        } catch (_) {}
                        assignLoginCode(userRecord.userUID, (codeErr, codeData) => {
                            if (codeErr) {
                                console.error('Could not generate login code for new user:', codeErr.message || codeErr);
                                return finalizeUser(userRecord);
                            }
                            userRecord.login_code = codeData.login_code;
                            userRecord.login_code_expires_at = codeData.login_code_expires_at;
                            finalizeUser(userRecord);
                        });
                    }
                );
            });
        }
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(500).json({ error: 'Could not register user' });
    }
});

// Authenticate user by email + password
app.post('/users/auth', strictLimiter, async (req, res) => {
    try {
        const { userEmail, userPassword, loginCode } = req.body || {};

        if (loginCode) {
            const normalizedCode = normalizeLoginCode(loginCode);
            usersDb.get('SELECT * FROM users WHERE login_code = ?', [normalizedCode], async (err, user) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                if (!user) return res.status(401).json({ error: 'Invalid credentials' });
                const now = Math.floor(Date.now() / 1000);
                if (!user.login_code_expires_at || user.login_code_expires_at < now) {
                    return res.status(401).json({ error: 'Invalid or expired login code' });
                }
                usersDb.run('UPDATE users SET login_code = NULL, login_code_expires_at = NULL WHERE userUID = ?', [user.userUID], (updateErr) => {
                    if (updateErr) console.error('Could not clear login code:', updateErr.message || updateErr);
                    const { userPassword: _userPassword, login_code, login_code_expires_at, ...safeUser } = user;
                    safeUser.loginCode = login_code || null;
                    safeUser.isAdmin = isAdminUser(user);
                    const token = signUserToken(safeUser);
                    res.json({ token, user: safeUser });
                });
            });
            return;
        }

        if (!userEmail || !userPassword) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const normalizedEmail = String(userEmail).trim().toLowerCase();
        usersDb.get('SELECT * FROM users WHERE userEmail = ?', [normalizedEmail], async (err, user) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!user) return res.status(401).json({ error: 'Invalid credentials' });
            const passwordMatch = await bcrypt.compare(userPassword, user.userPassword);
            if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });
            const clientUser = buildClientUser(user);
            const token = signUserToken(user);
            res.json({ success: true, token, user: clientUser });
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
//  9d. HLS STREAM PROXY (reserved for future use)
// =========================================
// Proxy for anime HLS streams (handles CORS + Referer)
const ALLOWED_PROXY_HOSTS = [
    'kwik.si', 'kwik.cx', 'kwik.rs',
    'megaup.net', 'mega.nz',
    'gogo-stream.com', 'goload.io', 'anihdplay.com',
    'vidstreaming.io', 'gogoanime3.co', 'streamani.net',
    'plyr.link', 'blog.plyr.link',
    'swiftstream.top', 'mp4upload.com', 'fast4speed.rsvp',
    'kwik.cx', 'uwucdn.top',
    'hls.krussdomi.com', 'subst.krussdomi.com', 'krussdomi.com',
    'advancedairesearchlab.xyz', 'habibikun.xyz',
    'babybayw.xyz', 'narutokun.xyz'
];
let proxyDebugPrinted = false;

app.get('/api/proxy-stream', async (req, res) => {
    const rawUrl = req.query.url;
    const rawReferer = req.query.referer;
    const rawUserAgent = req.query.ua;
    if (!rawUrl) return res.status(400).send('Missing url');

    let decodedUrl, decodedReferer, decodedUserAgent;
    try {
        decodedUrl = decodeURIComponent(rawUrl);
        decodedReferer = rawReferer ? decodeURIComponent(rawReferer) : 'https://kwik.si/';
        decodedUserAgent = rawUserAgent
            ? decodeURIComponent(rawUserAgent)
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        const host = new URL(decodedUrl).hostname;
        if (!ALLOWED_PROXY_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
            return res.status(403).send('Domain not allowed');
        }
            // if (decodedUrl.includes('master.m3u8')) {
            //     console.log('MASTER PLAYLIST REQUESTED');
            // }
            // if (decodedUrl.includes('2949/playlist.m3u8')) {
            //     console.log('VIDEO PLAYLIST REQUESTED');
            // }
            // if (decodedUrl.includes('294f/playlist.m3u8')) {
            //     console.log('AUDIO PLAYLIST REQUESTED');
            // }
    } catch {
        return res.status(400).send('Invalid URL');
    }
        if (!proxyDebugPrinted) {
            console.log({
                url: decodedUrl,
                referer: decodedReferer,
                ua: decodedUserAgent
            });
            console.log('proxyDebugPrinted');
            proxyDebugPrinted = true;
        }
    const isM3u8 = decodedUrl.includes('.m3u8');
    try {

        // console.log({
        //     url: decodedUrl,
        //     referer: decodedReferer,
        //     ua: decodedUserAgent
        // });
        const response = await axios({
            url: decodedUrl,
            method: 'get',
            responseType: isM3u8 ? 'text' : 'stream',
            headers: {
                Referer: decodedReferer,
                Origin: 'https://krussdomi.com',
                Accept: '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': decodedUserAgent,

                ...(req.headers.range
                    ? { Range: req.headers.range }
                    : { Range: 'bytes=0-' })
            },
            timeout: 20000,
            validateStatus: () => true
        });
     /*   if (isM3u8) {
            console.log('====================');
            console.log('M3U8 URL:', decodedUrl);

            const text = String(response.data);

            console.log(
                'HAS STREAM-INF:',
                text.includes('#EXT-X-STREAM-INF')
            );

            console.log(
                'HAS MEDIA:',
                text.includes('#EXT-X-MEDIA')
            );

            console.log(
                text.substring(0, 2000)
            );

            console.log('====================');
        }*/
        if (
            decodedUrl.includes('294f/playlist.m3u8') ||
            decodedUrl.includes('2951/playlist.m3u8')
        ) {
            fs.writeFileSync(
                'audio-playlist.txt',
                String(response.data)
            );

            // console.log(
            //     'SAVED AUDIO PLAYLIST'
            // );
        }
        if (
            decodedUrl.includes('habibikun.xyz') ||
            decodedUrl.includes('advancedairesearchlab.xyz') ||
            decodedUrl.includes('babybayw.xyz') ||
            decodedUrl.includes('narutokun.xyz')
        ) {
            // console.log('CDN REQUEST:', decodedUrl);
            // console.log('SEGMENT STATUS', response.status);
        }
        if (
            decodedUrl.includes('294d/playlist.m3u8')
        ) {
            fs.writeFileSync(
                'kaa-294d-playlist.txt',
                String(response.data)
            );

            // console.log(
            //     'Saved playlist to kaa-294d-playlist.txt'
            // );
        }
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

        if (response.status >= 400) {
            console.warn('[ProxyStream] Upstream error:', {
                status: response.status,
                url: decodedUrl,
                headers: response.headers,
                referer: decodedReferer
            });
            res.status(response.status);
            const upstreamType = response.headers?.['content-type'];
            if (upstreamType) res.set('Content-Type', upstreamType);
            if (isM3u8 || typeof response.data === 'string') {
                return res.send(response.data || `Upstream returned ${response.status}`);
            }
            return response.data.pipe(res);
        }

        if (isM3u8) {
            const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
            let content = response.data;
           
            // Rewrite segment and child-playlist URLs to go through this proxy
            content = content.replace(/^(?!#)(.+)$/gm, line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                const absUrl = new URL(trimmed, baseUrl).toString();

                // console.log('PLAYLIST ENTRY:', trimmed);
                // console.log('ABS URL:', absUrl);

                return `/api/proxy-stream?url=${encodeURIComponent(absUrl)}&referer=${encodeURIComponent(decodedReferer)}&ua=${encodeURIComponent(decodedUserAgent)}`;
            });
            content = content.replace(/URI="([^"]+)"/g, (match, uri) => {
                if (/^data:/i.test(uri)) return match;
                const absUrl = new URL(uri, baseUrl).toString();
                const proxied = `/api/proxy-stream?url=${encodeURIComponent(absUrl)}&referer=${encodeURIComponent(decodedReferer)}&ua=${encodeURIComponent(decodedUserAgent)}`;
                return `URI="${proxied}"`;
                content = content.replace(
                    /URI="([^"]+)"/g,
                    (match, uri) => {

                        // console.log(
                        //     'REWRITING AUDIO URI:',
                        //     uri
                        // );

                        const absUrl = new URL(uri, baseUrl).toString();

                        // console.log(
                        //     'TO:',
                        //     absUrl
                        // );

                        const proxied =
                            `/api/proxy-stream?url=${encodeURIComponent(absUrl)}&referer=${encodeURIComponent(decodedReferer)}&ua=${encodeURIComponent(decodedUserAgent)}`;

                        return `URI="${proxied}"`;
                    }
                );
            });
            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            fs.writeFileSync(
                'final-playlist-sent-to-browser.txt',
                content
            );

            // console.log(
            //     'Saved final-playlist-sent-to-browser.txt'
            // );
            // if (decodedUrl.includes('master.m3u8')) {
            //     console.log('========= FINAL MASTER =========');
            //     console.log(content.substring(0, 4000));
            //     console.log('===============================');
            // }
            res.send(content);
        } else {
            if (response.status === 206) res.status(206);
            const responseHost = new URL(decodedUrl).hostname;
            const isKaaDisguisedSegment =
                /\.(jpg|jpeg|png|webp)(\?|$)/i.test(decodedUrl) &&
                ['advancedairesearchlab.xyz', 'habibikun.xyz'].some(h => responseHost === h || responseHost.endsWith('.' + h));
            const fallbackType = /\.vtt(\?|$)/i.test(decodedUrl)
                ? 'text/vtt; charset=utf-8'
                : 'video/mp2t';
            res.set('Content-Type', isKaaDisguisedSegment ? 'video/mp2t' : (response.headers['content-type'] || fallbackType));
            if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
            if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);
            if (response.headers['accept-ranges']) res.set('Accept-Ranges', response.headers['accept-ranges']);
            response.data.pipe(res);
        }
    } catch (err) {
        console.error('[ProxyStream]', err.message);
        res.status(500).send('Proxy error');
    }

});

// =========================================
//  9b. ANIME MAL ID LOOKUP (TMDB → MAL via Fribb's anime-lists)
// =========================================
let _animeMalList = null;
let _animeMalCacheTime = 0;
const ANIME_MAL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const _animeSeasonGroupsCache = new Map();
const ANIME_SEASON_GROUPS_TTL = 24 * 60 * 60 * 1000; // 24 hours

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureAnimeMalListLoaded() {
    if (_animeMalList && (Date.now() - _animeMalCacheTime <= ANIME_MAL_CACHE_TTL)) {
        return _animeMalList;
    }
    const r = await axios.get(
        'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json',
        { timeout: 20000 }
    );
    _animeMalList = r.data;
    _animeMalCacheTime = Date.now();
    console.log(`[Anime MAL] Loaded ${_animeMalList.length} entries from Fribb anime-lists`);
    return _animeMalList;
}

function getMappedTmdbId(value) {
    if (value == null) return null;

    const toInt = (v) => {
        if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
        if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return null;
            if (/^\d+$/.test(s)) return parseInt(s, 10);
            return null;
        }
        return null;
    };

    const direct = toInt(value);
    if (direct) return direct;

    if (Array.isArray(value)) {
        for (const item of value) {
            const parsed = getMappedTmdbId(item);
            if (parsed) return parsed;
        }
        return null;
    }

    if (typeof value === 'object') {
        const keyCandidates = [
            'tmdb_id', 'themoviedb_id', 'tmdb', 'id',
            'tv_id', 'movie_id', 'tv', 'movie',
            'value', 'tmdbId', 'theMovieDbId'
        ];
        for (const key of keyCandidates) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                const parsed = getMappedTmdbId(value[key]);
                if (parsed) return parsed;
            }
        }
    }

    return null;
}

// Returns { id: <number>, type: 'movie'|'tv' } by inspecting the Fribb themoviedb_id shape.
// Fribb encodes type in the object key: { "movie": 1218925 } or { "tv": 12345 }.
function getMappedTmdbIdAndType(value) {
    if (value == null) return null;

    const toInt = (v) => {
        if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
        if (typeof v === 'string') {
            const s = v.trim();
            if (/^\d+$/.test(s)) return parseInt(s, 10);
        }
        return null;
    };

    // Plain number or numeric string → type unknown, default 'tv'
    const direct = toInt(value);
    if (direct) return { id: direct, type: 'tv' };

    if (Array.isArray(value)) {
        for (const item of value) {
            const r = getMappedTmdbIdAndType(item);
            if (r) return r;
        }
        return null;
    }

    if (typeof value === 'object') {
        // Fribb canonical keys — check these FIRST with type inference
        if (Object.prototype.hasOwnProperty.call(value, 'movie')) {
            const id = toInt(value.movie);
            if (id) return { id, type: 'movie' };
        }
        if (Object.prototype.hasOwnProperty.call(value, 'tv')) {
            const id = toInt(value.tv);
            if (id) return { id, type: 'tv' };
        }
        // Fallback: any other numeric key
        const fallbackKeys = ['tmdb_id', 'themoviedb_id', 'tmdb', 'id', 'tv_id', 'movie_id', 'value', 'tmdbId'];
        for (const key of fallbackKeys) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                const id = toInt(value[key]);
                if (id) return { id, type: 'tv' };
            }
        }
    }

    return null;
}

async function searchAniListByTitle(title, year) {
    const query = `
        query ($search: String) {
            Page(page: 1, perPage: 10) {

                media(
                    search: $search
                    type: ANIME
                ) {

                    id
                    idMal
                    seasonYear
                    format

                    title {
                        romaji
                        english
                        native
                    }

                }

            }
        }
    `;

    const response = await axios.post(
        'https://graphql.anilist.co',
        {
            query,
            variables: {
                search: title
            }
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }
    );

    const results = response.data?.data?.Page?.media || [];
    if (!Array.isArray(results) || results.length === 0) return null;

    const searchText = String(title || '').trim().toLowerCase();

    const scoreTitle = (animeTitle) => {
        if (!animeTitle) return 0;
        const normalized = String(animeTitle).trim().toLowerCase();
        if (normalized === searchText) return 50;
        return 0;
    };

    let best = null;
    let bestScore = -Infinity;

    for (const anime of results) {
        let score = 0;

        if (anime.seasonYear != null && year != null) {
            const diff = Math.abs(anime.seasonYear - year);
            if (diff === 0) score += 100;
            else if (diff === 1) score += 75;
            else if (diff === 2) score += 40;
            else score -= diff * 10;
        }

        score += scoreTitle(anime.title?.english);
        score += scoreTitle(anime.title?.romaji);
        score += scoreTitle(anime.title?.native);

        if (score > bestScore) {
            bestScore = score;
            best = anime;
        }
    }

    return best;
}

const ANIME_ROW_CACHE_TTL = 2 * 24 * 60 * 60 * 1000; // 48 hours

function animeRowCacheGet(rowKey, page = 1, perPage = 18, maxAgeMs = ANIME_ROW_CACHE_TTL) {
    return new Promise((resolve, reject) => {
        animeCacheDb.get(
            `SELECT json, cached_at FROM anime_row_cache WHERE row_key = ? AND page = ? AND per_page = ?`,
            [rowKey, page, perPage],
            (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                if (Date.now() - row.cached_at > maxAgeMs) return resolve(null);

                try {
                    const ids = JSON.parse(row.json);
                    if (!Array.isArray(ids)) return resolve(null);
                    resolve(ids);
                } catch (parseErr) {
                    resolve(null);
                }
            }
        );
    });
}

function animeRowCacheUpsert(rowKey, page = 1, perPage = 18, ids = []) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        animeCacheDb.run(
            `INSERT INTO anime_row_cache (row_key, page, per_page, json, cached_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(row_key, page, per_page) DO UPDATE SET
                 json = excluded.json,
                 cached_at = excluded.cached_at`,
            [rowKey, page, perPage, JSON.stringify(ids), now],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            }
        );
    });
}

function animeCacheUpsertFromAniListItem(item) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const englishTitle = item.title?.english || null;
        const romajiTitle = item.title?.romaji || null;
        const nativeTitle = item.title?.native || null;
        const coverImage = item.coverImage?.extraLarge || null;
        const bannerImage = item.bannerImage || null;
        const score = item.averageScore != null ? item.averageScore : null;
        const popularity = item.popularity != null ? item.popularity : null;
        const favourites = item.favourites != null ? item.favourites : null;
        const description = item.description || null;
        const format = item.format || null;
        const status = item.status || null;
        const episodes = item.episodes != null ? item.episodes : null;
        const json = JSON.stringify(item);

        appendTmdbLogLine(`[AnimeCache Upsert] anilist_id=${item.id} title="${englishTitle || romajiTitle || nativeTitle || ''}" tmdb_id=${item.tmdbId || 'null'} mal_id=${item.idMal || 'null'}`);
        animeCacheDb.run(
            `INSERT INTO anime_cache (
                anilist_id, tmdb_id, mal_id, english_title, romaji_title, native_title,
                cover_image, banner_image, score, popularity, favourites,
                description, format, status, episodes, json, cached_at, last_accessed
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(anilist_id) DO UPDATE SET
                 tmdb_id = COALESCE(excluded.tmdb_id, anime_cache.tmdb_id),
                 mal_id = COALESCE(excluded.mal_id, anime_cache.mal_id),
                 english_title = COALESCE(excluded.english_title, anime_cache.english_title),
                 romaji_title = COALESCE(excluded.romaji_title, anime_cache.romaji_title),
                 native_title = COALESCE(excluded.native_title, anime_cache.native_title),
                 cover_image = COALESCE(excluded.cover_image, anime_cache.cover_image),
                 banner_image = COALESCE(excluded.banner_image, anime_cache.banner_image),
                 score = COALESCE(excluded.score, anime_cache.score),
                 popularity = COALESCE(excluded.popularity, anime_cache.popularity),
                 favourites = COALESCE(excluded.favourites, anime_cache.favourites),
                 description = COALESCE(excluded.description, anime_cache.description),
                 format = COALESCE(excluded.format, anime_cache.format),
                 status = COALESCE(excluded.status, anime_cache.status),
                 episodes = COALESCE(excluded.episodes, anime_cache.episodes),
                 json = COALESCE(excluded.json, anime_cache.json),
                 cached_at = excluded.cached_at,
                 last_accessed = excluded.last_accessed`,
            [
                item.id,
                item.tmdbId || null,
                item.idMal || null,
                englishTitle,
                romajiTitle,
                nativeTitle,
                coverImage,
                bannerImage,
                score,
                popularity,
                favourites,
                description,
                format,
                status,
                episodes,
                json,
                now,
                now
            ],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            }
        );
    });
}

function animeCacheGetByAniListIds(ids) {
    return new Promise((resolve, reject) => {
        if (!ids.length) return resolve([]);
        const placeholders = ids.map(() => '?').join(',');
        const orderCases = ids.map(() => 'WHEN ? THEN ?').join(' ');
        const query = `
            SELECT json
            FROM anime_cache
            WHERE anilist_id IN (${placeholders})
            ORDER BY CASE anilist_id ${orderCases} ELSE ${ids.length} END
        `;
        const params = [...ids, ...ids.reduce((acc, id, idx) => acc.concat(id, idx), [])];

        animeCacheDb.all(query, params, (err, rows) => {
            if (err) return reject(err);
            const parsed = (rows || []).map(row => {
                try {
                    return JSON.parse(row.json);
                } catch (parseErr) {
                    return null;
                }
            }).filter(Boolean);
            resolve(parsed);
        });
    });
}

function getCurrentAniListSeason() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (month >= 4 && month <= 6) return { season: 'SPRING', seasonYear: year };
    if (month >= 7 && month <= 9) return { season: 'SUMMER', seasonYear: year };
    if (month >= 10 && month <= 12) return { season: 'FALL', seasonYear: year };
    return { season: 'WINTER', seasonYear: year };
}

function getNextAniListSeason() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (month >= 1 && month <= 3) return { season: 'SPRING', seasonYear: year };
    if (month >= 4 && month <= 6) return { season: 'SUMMER', seasonYear: year };
    if (month >= 7 && month <= 9) return { season: 'FALL', seasonYear: year };
    return { season: 'WINTER', seasonYear: year + 1 };
}

function buildAniListRowFetchParams(rowKey) {
    rowKey = String(rowKey || '').toUpperCase();
    const params = { sort: ['TRENDING_DESC'], genre: null, tag: null, minimumTagRank: null, format: null, season: null, seasonYear: null, status: null };
    const currentSeason = getCurrentAniListSeason();
    const nextSeason = getNextAniListSeason();

    switch (rowKey) {
        case 'POPULAR':
        case 'MOST_POPULAR':
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'TOP_SCORE':
        case 'HIGHEST_RATED':
            params.sort = ['SCORE_DESC'];
            break;
        case 'RISING_THIS_SEASON':
            params.season = currentSeason.season;
            params.seasonYear = currentSeason.seasonYear;
            params.sort = ['TRENDING_DESC'];
            break;
        case 'CURRENTLY_AIRING':
            params.status = 'RELEASING';
            params.sort = ['TRENDING_DESC'];
            break;
        case 'UPCOMING_NEXT_SEASON':
            params.season = nextSeason.season;
            params.seasonYear = nextSeason.seasonYear;
            params.sort = ['TRENDING_DESC'];
            break;
        case 'ACTION':
            params.genre = 'Action';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'DRAMA':
            params.genre = 'Drama';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'SCI_FI':
            params.genre = 'Sci-Fi';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'SLICE_OF_LIFE':
            params.genre = 'Slice of Life';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'SUPERNATURAL':
            params.genre = 'Supernatural';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'MECHA':
            params.genre = 'Mecha';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'KAIJU':
            params.tag = 'Kaiju';
            params.minimumTagRank = 70;
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'ISEKAI':
            params.tag = 'Isekai';
            params.minimumTagRank = 70;
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'HORROR':
            params.genre = 'Horror';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'PSYCHOLOGICAL':
            params.genre = 'Psychological';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'MOVIES':
            params.format = 'MOVIE';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'OVAS':
            params.format = 'OVA';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'ONAS':
            params.format = 'ONA';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'COMEDY':
            params.genre = 'Comedy';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'ROMANCE':
            params.genre = 'Romance';
            params.sort = ['POPULARITY_DESC'];
            break;
        case 'TRENDING':
        default:
            params.sort = ['TRENDING_DESC'];
            break;
    }
    return params;
}

async function fetchAniListRowFromAniList(rowKey, page = 1, perPage = 18) {
    const { sort, genre, tag, minimumTagRank, format, season, seasonYear, status } = buildAniListRowFetchParams(rowKey);
    const variableDefs = [' $page:Int', ' $perPage:Int', ' $sort:[MediaSort]'];
    const filters = ['type: ANIME', 'sort: $sort'];
    const variables = { page, perPage, sort };

    if (genre) {
        variableDefs.push(' $genre:String');
        filters.push('genre: $genre');
        variables.genre = genre;
    }
    if (tag) {
        variableDefs.push(' $tag:String');
        filters.push('tag: $tag');
        variables.tag = tag;
    }
    if (minimumTagRank != null) {
        variableDefs.push(' $minimumTagRank:Int');
        filters.push('minimumTagRank: $minimumTagRank');
        variables.minimumTagRank = minimumTagRank;
    }
    if (format) {
        variableDefs.push(' $format:MediaFormat');
        filters.push('format: $format');
        variables.format = format;
    }
    if (season) {
        variableDefs.push(' $season:MediaSeason');
        filters.push('season: $season');
        variables.season = season;
    }
    if (seasonYear) {
        variableDefs.push(' $seasonYear:Int');
        filters.push('seasonYear: $seasonYear');
        variables.seasonYear = seasonYear;
    }
    if (status) {
        variableDefs.push(' $status:MediaStatus');
        filters.push('status: $status');
        variables.status = status;
    }

    const query = `
        query(${variableDefs.join(',')}) {
            Page(page:$page, perPage:$perPage) {
                media(
                    ${filters.join('\n                    ')}
                ) {
                    id
                    idMal
                    title {
                        romaji
                        english
                        native
                    }
                    coverImage {
                        extraLarge
                    }
                    bannerImage
                    averageScore
                    popularity
                    favourites
                    description(asHtml:false)
                    startDate {
                        year
                    }
                    episodes
                    format
                    status
                }
            }
        }
    `;

    console.log('[AniList Row Fetch] rowKey=', rowKey, 'variables=', variables);
    const response = await axios.post(
        'https://graphql.anilist.co',
        { query, variables },
        { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );

    if (response.data?.errors) {
        console.error('[AniList Row Fetch] GraphQL errors for', rowKey);
        console.dir(response.data.errors, { depth: null });
    }
    console.log('[AniList Row Fetch] response data for', rowKey, '=>', {
        data: response.data?.data,
        errors: response.data?.errors
    });

    const items = response.data?.data?.Page?.media || [];
    return Array.isArray(items) ? items : [];
}

app.get('/api/anime-row', async (req, res) => {
    const rowKey = req.query.rowKey ? String(req.query.rowKey).toUpperCase() : null;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.perPage, 10) || 18;

    if (!rowKey) {
        return res.status(400).json({ error: 'Missing rowKey' });
    }

    try {
        console.log(`[Anime Row Cache] request rowKey=${rowKey} page=${page} perPage=${perPage}`);
        const ids = await animeRowCacheGet(rowKey, page, perPage);
        if (ids && ids.length) {
            console.log(`[Anime Row Cache] cache hit for ${rowKey} (${ids.length} IDs)`);
            const cachedAnime = await animeCacheGetByAniListIds(ids);
            if (cachedAnime.length === ids.length) {
                console.log(`[Anime Row Cache] returning full cached row for ${rowKey}`);
                return res.json(cachedAnime);
            }
            console.log(`[Anime Row Cache] cache partial/missing data for ${rowKey}: expected ${ids.length}, got ${cachedAnime.length}`);
        } else {
            console.log(`[Anime Row Cache] cache miss or expired for ${rowKey}`);
        }

        console.log(`[Anime Row Cache] fetching AniList row ${rowKey}`);
        const items = await fetchAniListRowFromAniList(rowKey, page, perPage);
        console.log(`[Anime Row Cache] AniList returned ${items.length} items for ${rowKey}`);
        if (!items.length) {
            return res.json([]);
        }

        const idsToCache = [];
        for (const item of items) {
            idsToCache.push(item.id);
            await animeCacheUpsertFromAniListItem(item);
        }

        await animeRowCacheUpsert(rowKey, page, perPage, idsToCache);
        console.log(`[Anime Row Cache] cached ${idsToCache.length} IDs for ${rowKey}`);
        res.json(items);
    } catch (err) {
        console.error('[Anime Row Cache] Error:', err.message || err, { rowKey, page, perPage });
        res.status(500).json({ error: 'Failed to fetch anime row' });
    }
});

async function resolveAnimeIds(tmdbId, season = 1) {
    await ensureAnimeMalListLoaded();

    const findFribbEntry = () => {
        let entry = _animeMalList.find(item => {
            const mappedTmdbId = getMappedTmdbId(item.themoviedb_id);
            if (mappedTmdbId !== tmdbId) return false;
            if (item.season && item.season.tmdb != null) return Number(item.season.tmdb) === season;
            return true;
        });

        if (!entry || (!entry.mal_id && !entry.anilist_id)) {
            entry = _animeMalList.find(item => {
                const mappedTmdbId = getMappedTmdbId(item.themoviedb_id);
                return mappedTmdbId === tmdbId && item.mal_id;
            });
        }

        return entry;
    };

    const entry = findFribbEntry();
    if (entry && (entry.mal_id || entry.anilist_id)) {
        await animeTmdbMappingUpsert({
            tmdbId,
            malId: entry.mal_id || null,
            anilistId: entry.anilist_id || null,
            title: entry.title || null
        });

        return {
            malId: entry.mal_id || null,
            anilistId: entry.anilist_id || null
        };
    }

    console.log(`[Anime MAL] Fribb miss for TMDB ${tmdbId}`);

    const cachedMapping = await animeTmdbMappingGet(tmdbId);
    if (cachedMapping) {
        console.log(`[Anime MAL] Cache hit in anime_tmdb_mapping for TMDB ${tmdbId}`);
        if (cachedMapping.mal_id || cachedMapping.anilist_id) {
            return {
                malId: cachedMapping.mal_id || null,
                anilistId: cachedMapping.anilist_id || null
            };
        }
        return null;
    }

    const tmdb = await getTmdbAnimeTitle(tmdbId);
    if (!tmdb.title) return null;

    console.log(`[Anime MAL] Searching AniList for "${tmdb.title}" (${tmdb.year || 'unknown year'})`);
    const ani = await searchAniListByTitle(tmdb.title, tmdb.year);

    if (!ani) {
        await animeTmdbMappingUpsert({ tmdbId, malId: null, anilistId: null, title: tmdb.title });
        return null;
    }

    console.log('[Anime MAL] AniList fallback success');
    console.log(`AniList: ${ani.id}`);
    console.log(`MAL: ${ani.idMal}`);

    await animeTmdbMappingUpsert({
        tmdbId,
        malId: ani.idMal,
        anilistId: ani.id,
        title: tmdb.title
    });

    return {
        malId: ani.idMal || null,
        anilistId: ani.id || null
    };
}

function animeTmdbMappingGet(tmdbId) {
    return new Promise((resolve, reject) => {
        animeCacheDb.get(
            `SELECT mal_id, anilist_id, title, cached_at FROM anime_tmdb_mapping WHERE tmdb_id = ?`,
            [tmdbId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            }
        );
    });
}

function animeTmdbMappingGetByAniListId(anilistId) {
    return new Promise((resolve, reject) => {
        animeCacheDb.get(
            `SELECT tmdb_id, mal_id FROM anime_tmdb_mapping WHERE anilist_id = ?`,
            [anilistId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            }
        );
    });
}

function animeTmdbMappingUpsert({ tmdbId, malId = null, anilistId = null, title = null }) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const values = [tmdbId, malId, anilistId, title, now];
        animeCacheDb.run(
            `INSERT INTO anime_tmdb_mapping (tmdb_id, mal_id, anilist_id, title, cached_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(tmdb_id) DO UPDATE SET
                 mal_id = COALESCE(excluded.mal_id, anime_tmdb_mapping.mal_id),
                 anilist_id = COALESCE(excluded.anilist_id, anime_tmdb_mapping.anilist_id),
                 title = COALESCE(excluded.title, anime_tmdb_mapping.title),
                 cached_at = excluded.cached_at`,
            values,
            function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            }
        );
        console.log('[Mapping Upsert]');
        console.log({
            tmdbId,
            malId,
            anilistId,
            title
        });
    });
}

async function searchTmdbAnimeIdByTitle(title, options = {}) {
    if (!title) return null;
    const query = String(title || '').trim();
    if (!query) return null;

    const mediaType = options.mediaType === 'movie' ? 'movie' : 'tv';
    console.log(` SEARCHING TMDB FOR TITLE: [${query}] type=${mediaType}`);
    appendTmdbLogLine(`[TMDB SEARCH] type=${mediaType} query="${query}"`);

    try {
        const response = await tmdbGet(`/search/${mediaType}`, {
            query,
            language: 'en-US',
            page: 1
        });
        const results = Array.isArray(response.results) ? response.results : [];
        const normalize = (value) => String(value || '').trim().toLowerCase();
        const searchText = normalize(query);

        const fieldName = mediaType === 'movie' ? 'title' : 'name';
        const fieldOriginal = mediaType === 'movie' ? 'original_title' : 'original_name';

        const exactMatch = results.find(item => {
            const name = normalize(item[fieldName] || item[fieldOriginal]);
            return name === searchText;
        });
        const partialMatch = results.find(item => {
            const name = normalize(item[fieldName] || item[fieldOriginal]);
            return name.includes(searchText) || searchText.includes(name);
        });
        const chosenId = exactMatch?.id || partialMatch?.id || results[0]?.id || null;
        appendTmdbLogLine(`[TMDB SEARCH RESULT] type=${mediaType} query="${query}" count=${results.length} exact=${exactMatch?.id || 'none'} partial=${partialMatch?.id || 'none'} chosen=${chosenId || 'none'}`);

        if (typeof options.onResponse === 'function') {
            try {
                options.onResponse({ query, mediaType, results, exactMatchId: exactMatch?.id || null, partialMatchId: partialMatch?.id || null, chosenId });
            } catch (logErr) {
                console.error('[TMDB LOG CALLBACK] failed:', logErr.message || logErr);
            }
        }

        if (!results.length) return null;
        if (exactMatch) return exactMatch.id;
        if (partialMatch) return partialMatch.id;
        return results[0]?.id || null;
    } catch (err) {
        console.warn('[Anime TMDB Lookup] failed for title:', title, err.message || err);
        appendTmdbLogLine(`[TMDB SEARCH ERROR] type=${mediaType} query="${query}" error="${err.message || err}"`);
        if (typeof options.onResponse === 'function') {
            try {
                options.onResponse({ query, mediaType, results: [], exactMatchId: null, partialMatchId: null, chosenId: null, error: err.message || String(err) });
            } catch (logErr) {
                console.error('[TMDB LOG CALLBACK] failed:', logErr.message || logErr);
            }
        }
        return null;
    }
}

function cleanAnimeSearchTitle(title) {
    if (!title) return null;
    let cleaned = String(title).trim();
    if (!cleaned) return null;

    const suffixPatterns = [
        /\bSeason\s*\d+\b$/i,
        /\b\d+(?:st|nd|rd|th)\s*[Ss]eason\b$/i,
        /\bSeason\s*(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\b$/i,
        /\bPart\s*\d+\b$/i,
        /\bCour\s*\d+\b$/i,
        /\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\b$/i,
        /\b\d+\b$/
    ];

    let previous;
    do {
        previous = cleaned;
        cleaned = cleaned.replace(/[\s:–—-]+$/, '').trim();
        suffixPatterns.forEach(pattern => {
            cleaned = cleaned.replace(pattern, '').trim();
        });
    } while (cleaned !== previous);

    return cleaned || null;
}

function buildAniListSearchTitles({ title, englishTitle, romajiTitle, nativeTitle }) {
    const variants = [];
    const add = value => {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        if (!variants.includes(normalized)) variants.push(normalized);
    };

    add(romajiTitle);
    add(cleanAnimeSearchTitle(romajiTitle));
    add(englishTitle || title);
    add(cleanAnimeSearchTitle(englishTitle || title));
    add(nativeTitle);

    return variants;
}

function normalizeTmdbFallbackTitle(title) {
    if (!title) return null;
    let cleaned = String(title || '').trim().toLowerCase();
    cleaned = cleaned.replace(/\b(animation|anime)\b/g, '');
    cleaned = cleaned.replace(/[^a-z0-9\s]+/gi, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned || null;
}

function buildTmdbFallbackTitles(title) {
    const variants = [];
    const cleaned = normalizeTmdbFallbackTitle(title);
    if (!cleaned) return variants;

    if (cleaned !== String(title || '').trim().toLowerCase()) {
        variants.push(cleaned);
    }

    const words = cleaned.split(' ').filter(Boolean);
    for (let i = words.length - 1; i >= 1; i--) {
        const shorter = words.slice(0, i).join(' ');
        if (shorter && !variants.includes(shorter)) {
            variants.push(shorter);
        }
    }

    return variants;
}

async function getTmdbIdForAniList(anilistId, title, malId = null, titleEnglish = null, titleRomaji = null, titleNative = null) {
    const cached = await animeTmdbMappingGetByAniListId(anilistId);
    if (cached?.tmdb_id) {
        if (!cached.mal_id && malId) {
            await animeTmdbMappingUpsert({
                tmdbId: cached.tmdb_id,
                malId,
                anilistId,
                title: title || null
            });
        }
        return cached.tmdb_id;
    }

    const titles = buildAniListSearchTitles({
        title,
        englishTitle: titleEnglish,
        romajiTitle: titleRomaji,
        nativeTitle: titleNative
    });

    appendTmdbLogLine(`[AniList ${anilistId}] initial title variants=${JSON.stringify(titles)}`);

    const triedTitles = new Set();
    const searchTitles = [];

    for (const rawTitle of titles) {
        const normalized = String(rawTitle || '').trim();
        if (!normalized || triedTitles.has(normalized)) continue;
        triedTitles.add(normalized);
        searchTitles.push(normalized);
    }

    for (const searchTitle of searchTitles) {
        appendTmdbLogLine(`[AniList ${anilistId}] searching primary title="${searchTitle}"`);
        const tmdbId = await searchTmdbAnimeIdByTitle(searchTitle);
        if (tmdbId) {
            appendTmdbLogLine(`[AniList ${anilistId}] resolved tmdb_id=${tmdbId} from title="${searchTitle}"`);
            await animeTmdbMappingUpsert({
                tmdbId,
                malId,
                anilistId,
                title: title || null
            });
            return tmdbId;
        }
    }

    for (const searchTitle of searchTitles) {
        const fallbackTitles = buildTmdbFallbackTitles(searchTitle);
        if (!fallbackTitles.length) continue;

        appendTmdbLogLine(`[AniList ${anilistId}] fallback titles for "${searchTitle}" => ${JSON.stringify(fallbackTitles)}`);

        const fallbackAttempts = [];
        for (const fallbackTitle of fallbackTitles) {
            if (triedTitles.has(fallbackTitle)) continue;
            triedTitles.add(fallbackTitle);
            appendTmdbLogLine(`[AniList ${anilistId}] searching fallback title="${fallbackTitle}"`);

            const attemptData = {};
            let tmdbId = await searchTmdbAnimeIdByTitle(fallbackTitle, {
                onResponse: info => Object.assign(attemptData, info),
                mediaType: 'tv'
            });

            fallbackAttempts.push({
                query: fallbackTitle,
                results: attemptData.results || [],
                chosenId: attemptData.chosenId || null,
                mediaType: 'tv'
            });

            if (!tmdbId) {
                appendTmdbLogLine(`[AniList ${anilistId}] tv fallback failed for "${fallbackTitle}", trying movie search`);
                const movieAttemptData = {};
                tmdbId = await searchTmdbAnimeIdByTitle(fallbackTitle, {
                    onResponse: info => Object.assign(movieAttemptData, info),
                    mediaType: 'movie'
                });
                fallbackAttempts.push({
                    query: fallbackTitle,
                    results: movieAttemptData.results || [],
                    chosenId: movieAttemptData.chosenId || null,
                    mediaType: 'movie'
                });
            }

            if (tmdbId) {
                appendTmdbLogLine(`[AniList ${anilistId}] resolved tmdb_id=${tmdbId} from fallback title="${fallbackTitle}"`);
                appendTmdbFallbackBlock({
                    anilistId,
                    originalTitle: title || searchTitle,
                    searchTitle,
                    attempts: fallbackAttempts,
                    succeeded: true
                });
                await animeTmdbMappingUpsert({
                    tmdbId,
                    malId,
                    anilistId,
                    title: title || null
                });
                return tmdbId;
            }
        }

        if (fallbackAttempts.length) {
            appendTmdbFallbackBlock({
                anilistId,
                originalTitle: title || searchTitle,
                searchTitle,
                attempts: fallbackAttempts
            });
        }
    }

    appendTmdbLogLine(`[AniList ${anilistId}] no TMDB match found for any title variant`);
    return null;
}

app.get('/api/anime-tmdb-id', async (req, res) => {
    const anilistId = parseInt(req.query.anilistId, 10);
    const title = req.query.title ? String(req.query.title) : null;
    const titleEnglish = req.query.titleEnglish ? String(req.query.titleEnglish) : null;
    const titleRomaji = req.query.titleRomaji ? String(req.query.titleRomaji) : null;
    const titleNative = req.query.titleNative ? String(req.query.titleNative) : null;
    const malId = req.query.malId ? String(req.query.malId) : null;

    if (!anilistId) {
        return res.status(400).json({ error: 'Missing anilistId' });
    }

    try {
        const tmdbId = await getTmdbIdForAniList(anilistId, title, malId, titleEnglish, titleRomaji, titleNative);
        if (!tmdbId) {
            return res.status(404).json({ error: 'TMDB id not found for aniListId' });
        }
        res.json({ tmdb_id: tmdbId });
    } catch (err) {
        console.error('[Anime TMDB ID]', err.message || err);
        res.status(500).json({ error: 'Failed to resolve TMDB id' });
    }
});

function animeRecommendationsRowByTmdbId(tmdbId) {
    return new Promise((resolve, reject) => {
        animeCacheDb.get(
            `SELECT json FROM anime_recommendations WHERE tmdb_id = ?`,
            [tmdbId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            }
        );
    });
}

async function getTmdbAnimeTitle(tmdbId) {
    const anime = await tmdbGet(
        `/tv/${tmdbId}`,
        { language: 'en-US' }
    );

    return {
        title: anime.name || anime.original_name || null,
        year: anime.first_air_date ? Number(anime.first_air_date.substring(0, 4)) : null
    };
}

let jikanCounter = 0;
async function jikanGet(pathname) {
    console.log(`[JIKAN START] ${pathname}`);   
    console.log(`[${++jikanCounter}] ${pathname}`);
 
    const url = `https://api.jikan.moe/v4${pathname}`;
    const maxAttempts = 4;
    let delay = 700;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await sleep(Math.random() * 500);
            const r = await axios.get(url, {
                timeout: 15000,
                headers: { 'User-Agent': 'LegionSpace/1.0 (+anime-season-groups)' },
                validateStatus: () => true
            });
            console.log("================================");
                console.log("STATUS:", r.status, "PATH:", pathname);
            console.log("PATH:", pathname);
            console.log("STATUS:", r.status);
            console.log("BODY:", JSON.stringify(r.data).slice(0, 500));
            console.log("================================");
            if (r.status >= 200 && r.status < 300) return r.data;
            if (r.status === 429) {
                if (attempt < maxAttempts) {
                    await sleep(delay);
                    delay *= 2;
                    continue;
                }
            }

            if (r.status >= 500) {
                throw new Error(`Jikan ${r.status}`);
            }
            console.log(`[JIKAN ${r.status}] ${pathname}`);

            throw new Error(`Jikan ${r.status}`);
        } catch (err) {
            console.error("========== JIKAN ==========");
            console.error(`[JIKAN ERROR] ${pathname}`);
            console.error(err.message);
            console.error("URL:", url);
            console.error("Attempt:", attempt);
            console.error("Message:", err.message);
            console.error("Code:", err.code);
            console.error("Status:", err.response?.status);
            console.error("Data:", err.response?.data);
            console.error("==========================");

            if (attempt < maxAttempts) {
                await sleep(delay);
                delay *= 2;
                continue;
            }

            throw err;
        }
    }
    throw new Error('Jikan request failed');
}

// Jikan proxy cache (5 min TTL — avoids hammering Jikan on repeated page loads)
const _jikanProxyCache = new Map();
const JIKAN_PROXY_CACHE_TTL = 5 * 60 * 1000;

app.get('/api/jikan', async (req, res) => {
    const jikanPath = req.query.path;
    if (!jikanPath || !String(jikanPath).startsWith('/')) {
        return res.status(400).json({ error: 'Missing or invalid path parameter' });
    }
    const cached = _jikanProxyCache.get(jikanPath);
    if (cached && (Date.now() - cached.t < JIKAN_PROXY_CACHE_TTL)) {
        return res.json(cached.data);
    }
    try {
        const data = await jikanGet(jikanPath);
        _jikanProxyCache.set(jikanPath, { data, t: Date.now() });
        res.json(data);
    } catch (err) {
        console.error("========== JIKAN ERROR ==========");
        console.error("Path:", jikanPath);
        console.error("Message:", err.message);
        console.error("Code:", err.code);
        console.error("Status:", err.response?.status);
        console.error("Response:", err.response?.data);
        console.error(err);
        console.error("=================================");

        res.status(502).json({ error: "Jikan request failed" });
    }
});

function animeScheduleGet(day) {
    return new Promise((resolve, reject) => {
        animeCacheDb.get(
            `SELECT json, cached_at FROM anime_schedule WHERE day = ?`,
            [day],
            (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);

                const now = Date.now();
                animeCacheDb.run(
                    `UPDATE anime_schedule SET last_accessed = ? WHERE day = ?`,
                    [now, day],
                    (updateErr) => {
                        if (updateErr) console.warn('[Anime Schedule] failed to update last_accessed', updateErr.message || updateErr);
                    }
                );

                try {
                    resolve({ data: JSON.parse(row.json), cached_at: row.cached_at });
                } catch (parseErr) {
                    resolve(null);
                }
            }
        );
    });
}

function animeScheduleUpsert(day, json) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        animeCacheDb.run(
            `INSERT INTO anime_schedule (day, json, cached_at, last_accessed)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(day) DO UPDATE SET
                 json = excluded.json,
                 cached_at = excluded.cached_at,
                 last_accessed = excluded.last_accessed`,
            [day, json, now, now],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            }
        );
    });
}

function getAnimeScheduleRefreshWindowDays() {
    const dow = new Date().getDay();
    const lookup = [1, 7, 6, 5, 4, 3, 2];
    return lookup[dow] || 7;
}

app.get('/api/anime-schedule', async (req, res) => {
    const day = String(req.query.day || '').toLowerCase();
    const allowedDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (!allowedDays.includes(day)) {
        return res.status(400).json({ error: 'Missing or invalid day parameter' });
    }

    try {
        const refreshDays = getAnimeScheduleRefreshWindowDays();
        const refreshWindowMs = refreshDays * 24 * 60 * 60 * 1000;
        const cached = await animeScheduleGet(day);

        if (cached && cached.data) {
            const ageMs = Date.now() - cached.cached_at;
            if (ageMs < refreshWindowMs) {
                return res.json(cached.data);
            }
            console.log(`[Anime Schedule] stale cache for ${day}: age=${Math.round(ageMs / 1000 / 60)}m threshold=${refreshDays}d, refreshing cache`);
        }

        const data = await jikanGet(`/schedules/${day}`);
        if (!data || !data.data) {
            if (cached && cached.data) {
                console.warn('[Anime Schedule] Jikan fetch failed, returning stale cache');
                return res.json(cached.data);
            }
            return res.status(502).json({ error: 'Jikan schedule fetch failed' });
        }

        await animeScheduleUpsert(day, JSON.stringify(data));
        return res.json(data);
    } catch (err) {
        console.error('[Anime Schedule] Failed to fetch or cache schedule', err);
        return res.status(500).json({ error: 'Failed to fetch anime schedule' });
    }
});

app.get('/api/anime-mal-id', async (req, res) => {
    const tmdbId = parseInt(req.query.tmdbId, 10);
    const season = parseInt(req.query.season, 10) || 1;
    if (!tmdbId) return res.status(400).json({ error: 'Missing tmdbId' });

    try {
        const ids = await resolveAnimeIds(tmdbId, season);
        if (!ids) {
            return res.status(404).json({ error: 'Anime ID not found for this TMDB entry' });
        }

        res.json({
            mal_id: ids.malId,
            anilist_id: ids.anilistId
        });
    } catch (err) {
        console.error('[Anime MAL ID]', err.message);
        res.status(500).json({ error: 'Failed to fetch anime mapping data' });
    }
});
//  THIS SECTION IS RELATED TO THE ANIME RECOMMENDATION CACHE (ANILIST SPECIFICALLY) DONT FUCKING TOUCH IT DAMIR
app.post("/api/anime/recommendations/cache", (req, res) => {
    console.log("POST /api/anime/recommendations/cache");

    const {
        anilistId,
        malId,
        tmdbId,
        title,
        recommendations,
    } = req.body;
    
    if ((!malId && !anilistId) || !recommendations)
    {
        return res.status(400).json({
            error: "Missing malId or recommendations"
        });
    }

    let recommendationList = [];

    if (anilistId) {

        recommendationList =
            recommendations.data?.Media?.recommendations?.edges || [];

    }
    else {

        recommendationList =
            recommendations.data || [];

    }
    const recommendationCount = recommendationList.length;
    const now = Date.now();

    animeCacheDb.run(
        `INSERT OR REPLACE INTO anime_recommendations (
            mal_id,
            anilist_id,
            tmdb_id,
            title,
            recommendation_count,
            json,
            cached_at,
            last_accessed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            malId,
            anilistId,
            tmdbId || null,
            title || null,
            recommendationCount,
            JSON.stringify(recommendations),
            now,
            now
        ],
        function (err) {

            if (err) {
                console.error("[Recommendation Cache]", err);

                return res.status(500).json({
                    success: false
                });
            }

            console.log("===== Recommendation Cached =====");
            console.log("Title:", title);
            console.log("MAL:", malId);
            console.log("TMDB:", tmdbId);
            console.log("Recommendations:", recommendationCount);
            console.log("=================================");

            res.json({
                success: true
            });
        }
    );
});

app.post("/api/cache-anime-info", async (req, res) => {
    try {
        const {
            anilistId,
            malId,
            tmdbId,
            anime
        } = req.body;

        if (!anilistId || !anime) {
            return res.status(400).json({
                error: "Missing anime data."
            });
        }

        console.log(`[Anime Cache] Caching "${anime.title?.english || anime.title?.romaji}" (${anilistId})`);

        const now = Date.now();

        const studios =
            anime.studios?.nodes?.map(s => s.name).join(", ") || null;

        const genres =
            anime.genres?.join(", ") || null;

        const ratingRank =
            anime.rankings?.find(r => r.type === "RATED");

        const rank =
            ratingRank?.rank ?? null;

        animeCacheDb.run(`
            INSERT OR REPLACE INTO anime_info (
                anilist_id,
                mal_id,
                tmdb_id,
                title,
                score,
                popularity,
                rank,
                studios,
                genres,
                season,
                season_year,
                episodes,
                duration,
                source,
                status,
                description,
                json,
                cached_at,
                last_accessed
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            anilistId,
            malId,
            tmdbId,
            anime.title?.english || anime.title?.romaji || null,
            anime.averageScore,
            anime.popularity,
            rank,
            studios,
            genres,
            anime.season,
            anime.seasonYear,
            anime.episodes,
            anime.duration,
            anime.source,
            anime.status,
            anime.description,
            JSON.stringify(anime),
            now,
            now
        ], err => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "Database error."
                });
            }

            console.log(
`===== Anime Cached =====
Title: ${anime.title?.english || anime.title?.romaji}
AniList: ${anilistId}
MAL: ${malId}
TMDB: ${tmdbId}
========================`);

            res.json({
                success: true
            });
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: "Server error."
        });
    }
});
app.get('/api/anime-anilist-id', async (req, res) => {
    const tmdbId = parseInt(req.query.tmdbId, 10);
    const season = parseInt(req.query.season, 10) || 1;
    if (!tmdbId) return res.status(400).json({ error: 'Missing tmdbId' });

    try {
        const ids = await resolveAnimeIds(tmdbId, season);
        if (!ids) {
            return res.status(404).json({ error: 'Anime ID not found for this TMDB entry' });
        }
        res.json({
            anilist_id: ids.anilistId
        });
    } catch (err) {
        console.error('[Anime MAL ID]', err.message);
        res.status(500).json({ error: 'Failed to fetch anime mapping data' });
    }
});
app.get("/api/anime-info", (req, res) => {
    const anilistId = Number(req.query.anilistId);

    if (!anilistId) {
        return res.status(400).json({
            error: "Missing anilistId."
        });
    }

    animeCacheDb.get(
        `
        SELECT *
        FROM anime_info
        WHERE anilist_id = ?
        `,
        [anilistId],
        (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "Database error."
                });
            }

            if (!row) {
                console.log(`[Anime Cache] MISS (${anilistId})`);
                return res.json({
                    exists: false
                });
            }

            console.log(`[Anime Cache] HIT (${anilistId})`);

            animeCacheDb.run(
                `
                UPDATE anime_info
                SET last_accessed = ?
                WHERE anilist_id = ?
                `,
                [Date.now(), anilistId]
            );

            let parsedAnime;
            try {
                parsedAnime = JSON.parse(row.json);
            } catch (e) {
                return res.json({ exists: false });
            }

            res.json({
                exists: true,
                anime: parsedAnime
            });
        }
    );
});

app.get('/api/anime-recommendations', async (req, res) => {
    const tmdbId = parseInt(req.query.tmdbId, 10);
    if (!tmdbId) {
        return res.status(400).json({ error: 'Missing tmdbId' });
    }

    try {
        const row = await animeRecommendationsRowByTmdbId(tmdbId);
        console.log('[AnimeReco] Row exists:', !!row);
        console.log('[AnimeReco] Row:', row);
        if (!row || !row.json) {
            return res.json({ status: 'processing' });
        }

        let graph;
        try {
            graph = JSON.parse(row.json);
            console.log('[AnimeReco] Graph parsed successfully');
            console.log(graph);
        } catch (err) {
            console.warn('[Anime Recommendations] Invalid cached JSON for TMDB', tmdbId, err.message);
            return res.json({ status: 'processing' });
        }

        const edges = graph?.data?.Media?.recommendations?.edges || [];
        console.log('[AnimeReco] edges:', edges.length);
        const recommendations = [];

        for (const edge of edges) {
            const rec = edge?.node?.mediaRecommendation;
            if (!rec?.id) continue;

            console.log('[AnimeReco] Recommendation:', rec.title?.romaji || rec.title?.english || rec.title?.native || '<unknown>');
            console.log('[AnimeReco] AniList ID:', rec.id);
            console.log('[AnimeReco] AniList MAL ID:', rec.idMal);

            let mapping = await animeTmdbMappingGetByAniListId(rec.id);
            console.log('[AnimeReco] Mapping before lookup:', mapping);

            if (!mapping?.tmdb_id) {
                const title = rec.title?.english || rec.title?.romaji || rec.title?.native || null;
                const tmdbId = await getTmdbIdForAniList(rec.id, title, rec.idMal || null);
                mapping = tmdbId ? { tmdb_id: tmdbId } : null;
                console.log('[AnimeReco] Mapping after reverse lookup:', mapping);
            }

            console.log('[AnimeReco] TMDB:', mapping?.tmdb_id);

            if (!mapping?.tmdb_id) continue;

            recommendations.push({
                ID: mapping.tmdb_id,
                poster_full_url: rec.coverImage?.extraLarge || rec.coverImage?.large || rec.coverImage?.medium || '/img/LOGO_Short.png',
                'Movie Name': rec.title?.english || rec.title?.romaji || rec.title?.native || 'Unknown',
                Rating: rec.averageScore != null ? (rec.averageScore / 10) : 'N/A',
                Votes: edge?.node?.rating || 0,
                Year: ''
            });
        }

        console.log('[AnimeReco] Final recommendations:', recommendations.length);
        return res.json({
            status: 'ready',
            recommendations
        });
    } catch (err) {
        console.error('[Anime Recommendations]', err);
        return res.status(500).json({ error: 'Failed to fetch anime recommendations' });
    }
});
function getAnimeCacheTitlesByMalId(malId) {
    return new Promise((resolve, reject) => {
        animeCacheDb.get(
            `
            SELECT
                english_title,
                romaji_title,
                native_title,
                format,
                episodes
            FROM anime_cache
            WHERE mal_id = ?
            LIMIT 1
            `,
            [malId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

function getAnimeCacheTitlesByTmdbId(tmdbId) {
    return new Promise((resolve, reject) => {
        // Step 1: Get all mal_ids associated with this tmdb_id from anime_info
        animeCacheDb.all(
            `SELECT mal_id FROM anime_info WHERE tmdb_id = ?`,
            [tmdbId],
            (err, infoRows) => {
                if (err) return reject(err);

                if (!infoRows || infoRows.length === 0) {
                    console.log(`[Cache Query] No anime_info entries for tmdbId=${tmdbId}`);
                    return resolve(null);
                }

                const malIds = infoRows.map(r => r.mal_id);
                console.log(`[Cache Query] tmdbId=${tmdbId} maps to mal_ids:`, malIds);

                // Step 2: Get all cache entries for these mal_ids
                const placeholders = malIds.map(() => '?').join(',');
                animeCacheDb.all(
                    `
                    SELECT
                        english_title,
                        romaji_title,
                        native_title,
                        format,
                        episodes
                    FROM anime_cache
                    WHERE mal_id IN (${placeholders})
                    ORDER BY episodes DESC
                    `,
                    malIds,
                    (err, cacheRows) => {
                        if (err) return reject(err);

                        if (!cacheRows || cacheRows.length === 0) {
                            console.log(`[Cache Query] No cache entries for mal_ids:`, malIds);
                            return resolve(null);
                        }

                        const combined = cacheRows[0];
                        const totalEpisodes = cacheRows.reduce((sum, row) => sum + (row.episodes || 0), 0);

                        console.log(`[Cache Query] Found ${cacheRows.length} cache entries, total episodes: ${totalEpisodes}`, cacheRows.map(r => ({ title: r.english_title, eps: r.episodes })));

                        return resolve({
                            ...combined,
                            episodes: totalEpisodes
                        });
                    }
                );
            }
        );
    });
}
function normalizeAnimeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(the|tv|series|season|part)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function parseAnimeTitle(title) {
    const text = String(title || '').toLowerCase();

    let season = 1;

    // Try numeric form first: "season 2" or "season2"
    const seasonMatch = text.match(/\bseason\s*(\d+)\b/i);
    if (seasonMatch) {
        season = Number(seasonMatch[1]);
    } else {
        // Try ordinal forms: "2nd", "3rd", "4th", "2nd season", etc.
        if (/\b(?:2nd|second)\b/i.test(text))
            season = 2;
        else if (/\b(?:3rd|third)\b/i.test(text))
            season = 3;
        else if (/\b(?:4th|fourth)\b/i.test(text))
            season = 4;
        // Try Roman numerals
        else if (/\bii\b/i.test(text))
            season = 2;
        else if (/\biii\b/i.test(text))
            season = 3;
        else if (/\biv\b/i.test(text))
            season = 4;
        // Special case: "The Final Season" is often Season 4
        else if (/\bfinal\s+season|kanketsu/i.test(text))
            season = 4;
    }

    const partMatch = text.match(/\bpart\s*(\d+)\b/i);

    return {
        season,
        part: partMatch ? Number(partMatch[1]) : 1,

        isMovie: /\bmovie\b|hyouketsu|frozen bond|memory snow|manner/i.test(text),
        isOVA: /\b(?:ova|oad)\b/i.test(text),
        isONA: /\bona\b/i.test(text),
        isSpecial: /\b(?:special|recap|pv|trailer|preview)\b/i.test(text),

        normalizedTitle: normalizeAnimeTitle(title)
    };
}
function scoreAnimeSearchResult(result, wantedTitle) {
    const wanted = normalizeAnimeTitle(wantedTitle);
    const found = normalizeAnimeTitle(result?.title);
    if (!wanted || !found) return 0;
    if (found === wanted) return 1000;
    if (found.startsWith(`${wanted} `)) return 300;
    if (found.includes(wanted)) return 50;

    // Both title comparisons already done above, return 0 for partial matches
    return 0;
}
function convertEpisodeNumberForCandidate({
    requestedEpisode,
    candidate,
    candidateEpisodes,
    cacheEntry
}) {
    const candidateEpisodeCount = Array.isArray(candidateEpisodes)
        ? candidateEpisodes.length
        : 0;

    // If requested episode is within this candidate's episode range, use it
    if (requestedEpisode >= 1 && requestedEpisode <= candidateEpisodeCount) {
        return requestedEpisode;
    }

    return null;
}
async function resolveKickAssAnimeSources({ malId, tmdbId, episodeNumber, audioType, frontendTitle, season = 1 }) {
   let titles = [];
    let cacheEntry = null;

    if (tmdbId) {
        try {
            cacheEntry = await getAnimeCacheTitlesByTmdbId(tmdbId);
        } catch (err) {
            logKaaDebug('[KAA Resolve] anime cache lookup by tmdbId failed', {
                tmdbId,
                error: err.message || String(err)
            });
        }
    }

    if (!cacheEntry && malId) {
        try {
            cacheEntry = await getAnimeCacheTitlesByMalId(malId);
        } catch (err) {
            logKaaDebug('[KAA Resolve] anime cache lookup failed', {
                malId,
                error: err.message || String(err)
            });
        }
    }

    console.log(cacheEntry);
    console.log('FORMAT =', cacheEntry?.format);

    titles = [
        cacheEntry?.romaji_title,
        cacheEntry?.english_title,
        frontendTitle
    ].filter(Boolean).map(s => String(s).trim());
    titles = [...new Set(titles)];

    logKaaDebug('[KAA Resolve] start', {
        malId,
        episodeNumber,
        audioType,
        frontendTitle,
        season,
        searchTitles: titles,
        cacheEntry
    });

    let results = [];
    let usedTitle = null;

    for (const t of titles) {
        const search = await kickass.search(t);
        logKaaDebug('[KAA Resolve] search attempt', {
            query: t,
            resultCount: Array.isArray(search?.results) ? search.results.length : 0,
            resultPreview: Array.isArray(search?.results)
                ? search.results.slice(0, 10).map(r => ({
                    title: r.title,
                    audio: r.subOrDub,
                    id: r.id
                }))
                : []
        });

        if (Array.isArray(search?.results) && search.results.length) {
            results = search.results;
            usedTitle = t;
            break;
        }
    }

    logKaaDebug('[KAA Resolve] search title chosen', usedTitle);
    logKaaDebug('[KAA Resolve] raw search results', results.map(r => ({
        title: r.title,
        audio: r.subOrDub,
        id: r.id
    })));

    if (!results.length) {
        const err = new Error("Anime not found on KickAssAnime");
        err.status = 404;
        throw err;
    }

    // Fallback: search for all seasons to catch split-cour parts (e.g., S2 Part 1 and Part 2)
    const wantedSeason = Number(season) || 1;
    const baseTitle = titles[0] || frontendTitle;

    logKaaDebug('[KAA Resolve] starting enhanced search', {
        baseTitle,
        initialResultCount: results.length,
        initialResultTitles: results.slice(0, 5).map(r => r.title)
    });

    // Try to find missing season parts (especially Part 2s that might not be in initial results)
    const allSeasonSearches = [];
    for (let s = 1; s <= 4; s++) {
        if (s !== 1) { // Season 1 should be in initial results
            allSeasonSearches.push(`${baseTitle} Season ${s} Part 1`);
            allSeasonSearches.push(`${baseTitle} Season ${s} Part 2`);
        }
    }

    logKaaDebug('[KAA Resolve] season searches to try', {
        searches: allSeasonSearches
    });

    const foundIds = new Set(results.map(r => r.id));
    let newResultsAdded = 0;

    for (const seasonSearch of allSeasonSearches) {
        try {
            logKaaDebug('[KAA Resolve] searching for season part', { query: seasonSearch });
            const seasonSearchResults = await kickass.search(seasonSearch);
            const resultCount = Array.isArray(seasonSearchResults?.results) ? seasonSearchResults.results.length : 0;
            logKaaDebug('[KAA Resolve] season search got results', { query: seasonSearch, count: resultCount });

            if (Array.isArray(seasonSearchResults?.results)) {
                for (const result of seasonSearchResults.results) {
                    if (!foundIds.has(result.id)) {
                        results.push(result);
                        foundIds.add(result.id);
                        newResultsAdded++;
                        logKaaDebug('[KAA Resolve] ADDED new season result', {
                            query: seasonSearch,
                            title: result.title,
                            id: result.id
                        });
                    } else {
                        logKaaDebug('[KAA Resolve] season result already exists', {
                            title: result.title,
                            id: result.id
                        });
                    }
                }
            }
        } catch (err) {
            logKaaDebug('[KAA Resolve] season search error', { query: seasonSearch, error: err.message });
        }
    }

    logKaaDebug('[KAA Resolve] enhanced search complete', {
        newResultsAdded,
        totalResults: results.length,
        allResultTitles: results.map(r => r.title)
    });

    const wantedAudio = String(audioType || '').toLowerCase();
    const wantedFormat = String(cacheEntry?.format || 'TV').toUpperCase();

    const candidates = results;

  // THIS THING IS TO CHYECK THE ANIMES KICKASS RETURNS FOR THE SEARCH, AND HOW THEY ARE SCORED. SOMETIMES THE TOP RESULT IS DUB BUT THE SEARCH QUERY IS FOR SUB, SO THIS LOGGING HELPS TO DEBUG THAT SORT OF THING.
    // console.log(
    //     'CANDIDATES:',
    //     candidates.map(x => ({
    //         title: x.title,
    //         audio: x.subOrDub
    //     }))
    // );
    const ranked = candidates
        .map(result => {
            const meta = parseAnimeTitle(result.title);

            if (result.title.includes("Season 2 Movie")) {
                console.log({
                    title: result.title,
                    wantedFormat,
                    meta
                });
            }
            const titleScore = Math.max(
                ...titles.map(t => scoreAnimeSearchResult(result, t))
            );

            const normalizedTitle = normalizeAnimeTitle(result.title || '');
            const normalizedQueries = titles.map(normalizeAnimeTitle).filter(Boolean);
            const exactMainTitle = normalizedQueries.some(q => normalizedTitle === q);
            const beginsWithMainTitle = normalizedQueries.some(q => normalizedTitle.startsWith(q + ' '));
            let titleStructureScore = 0;
            if (exactMainTitle) {
                titleStructureScore += 250;
            } else if (beginsWithMainTitle) {
                titleStructureScore -= 100;
            }

            let seasonScore = 0;
            if (wantedSeason === 1) {
                // When wantedSeason is 1, DON'T heavily penalize higher seasons
                // We need them for split-cour episode accumulation
                // Just prefer season 1/part 1, but accept others
                if (/\bseason\s*1\b|\bpart\s*1\b|\bi\b/i.test(result.title) || !/\bseason\b|\bpart\b|\bii\b|\biii\b|\biv\b/i.test(result.title)) {
                    seasonScore += 150;  // Prefer S1 but don't hard-reject others
                }
            } else {
                // Soften the filter: prefer matching season but don't hard-reject others
                if (meta.season === wantedSeason) {
                    seasonScore += 300;
                } else {
                    seasonScore -= 500; // Penalize but don't nuke
                }
            }

            let formatScore = 0;
            const title = String(result.title || '').toLowerCase();

            switch (wantedFormat) {
                case 'MOVIE':
                    formatScore += meta.isMovie ? 900 : -900;
                    break;
                case 'OVA':
                    formatScore += meta.isOVA ? 900 : -900;
                    break;
                case 'ONA':
                    formatScore += meta.isONA ? 900 : -900;
                    break;
                case 'SPECIAL':
                    formatScore += meta.isSpecial ? 900 : -900;
                    break;
                default:
                    formatScore += !meta.isMovie && !meta.isOVA && !meta.isONA && !meta.isSpecial ? 100 : -300;
                    break;
            }

            const audio = String(result.subOrDub || '').toLowerCase();

            let audioScore = 0;

            if (wantedAudio) {
                if (audio === wantedAudio)
                    audioScore += 100;
                else
                    audioScore -= 100;
            }
            if (result.title.includes("Season 2 Movie")) {
                console.log({
                    title: result.title,
                    titleScore,
                    titleStructureScore,
                    seasonScore,
                    formatScore,
                    audioScore,
                    total:
                        titleScore +
                        titleStructureScore +
                        seasonScore +
                        formatScore +
                        audioScore
                });
            }
            return {
                result,
                score:
                    titleScore +
                    titleStructureScore +
                    seasonScore +
                    formatScore +
                    audioScore
            };
        })
        .sort((a, b) => b.score - a.score);
// THIS LOGGING IS TO CHYECK THE ANIMES KICKASS RETURNS FOR THE SEARCH, AND HOW THEY ARE SCORED. SOMETIMES THE TOP RESULT IS DUB BUT THE SEARCH QUERY IS FOR SUB, SO THIS LOGGING HELPS TO DEBUG THAT SORT OF THING.
    logKaaDebug('[KAA Resolve] ranked results', ranked.slice(0, 10).map(x => ({
        title: x.result.title,
        audio: x.result.subOrDub,
        score: x.score,
        id: x.result.id
    })));
    console.log("===== FULL RANKING =====");

    ranked.forEach((r, i) => {
        console.log(
            `${i + 1}. ${r.score} | ${r.result.title} | ${r.result.subOrDub}`
        );
    });

    console.log("========================");
    // const anime = ranked[0].result;
    // console.log(
    //     'ANIME MATCH:',
    //     anime?.title
    // );
    // const info = await kickass.fetchAnimeInfo(anime.id);

    logKaaDebug('[KAA Resolve] requested audio type', wantedAudio);
    logKaaDebug('[KAA Resolve] wanted season', wantedSeason);

    let selectedEntry = null;
    let anime = null;
    let info = null;
    let selectedEpisode = null;
    const reqEpNum = Number(episodeNumber);

    // Fetch top candidates in parallel (not all) to handle split-cour (e.g., S3 + S3P2)
    // Only fetch top 4 to avoid N+1 waterfall: 15 sequential calls → 4 parallel calls
    const topCandidates = ranked.slice(0, 4);
    logKaaDebug('[KAA Resolve] fetching top candidates in parallel', { count: topCandidates.length });

    const candidatesWithEpisodes = await Promise.all(
        topCandidates.map(async (entry) => {
            try {
                const candidateInfo = await kickass.fetchAnimeInfo(entry.result.id);
                const candidateEpisodes = Array.isArray(candidateInfo?.episodes) ? candidateInfo.episodes : [];
                return { entry, info: candidateInfo, episodes: candidateEpisodes };
            } catch (err) {
                logKaaDebug('[KAA Resolve] candidate fetch error', { title: entry.result.title, error: err.message });
                return { entry, info: null, episodes: [] };
            }
        })
    );

    // Sort candidates by season order (S1, S2P1, S2P2, S3, S4, ...) for proper episode accumulation
    // Don't rely on score ranking when accumulating episodes across seasons
    const sortedCandidates = candidatesWithEpisodes.sort((a, b) => {
        const titleA = String(a.entry.result.title || '').toLowerCase();
        const titleB = String(b.entry.result.title || '').toLowerCase();

        // Extract season/part info
        const seasonA = parseAnimeTitle(titleA);
        const seasonB = parseAnimeTitle(titleB);

        // Extract part numbers (1, 2, 3, 4, etc.) for correct ordering
        const partMatchA = titleA.match(/\bpart\s*(\d+)\b|cour\s*(\d+)/i);
        const partMatchB = titleB.match(/\bpart\s*(\d+)\b|cour\s*(\d+)/i);
        const partNumA = partMatchA ? Number(partMatchA[1] || partMatchA[2]) : 1;
        const partNumB = partMatchB ? Number(partMatchB[1] || partMatchB[2]) : 1;

        // Skip specials for ordering - they're filtered out anyway
        const isSpecialA = titleA.includes('special') || titleA.includes('ova') || titleA.includes('ona') || titleA.includes('movie');
        const isSpecialB = titleB.includes('special') || titleB.includes('ova') || titleB.includes('ona') || titleB.includes('movie');

        // Order by season number, then part 1 before part 2
        const seaA = seasonA.season || 999;
        const seaB = seasonB.season || 999;

        logKaaDebug('[KAA Resolve] sorting candidate', {
            titleA: a.entry.result.title,
            titleB: b.entry.result.title,
            seasonA: seaA,
            seasonB: seaB,
            partNumA,
            partNumB
        });

        if (seaA !== seaB) return seaA - seaB;
        return partNumA - partNumB; // Sort by part number: Part 1, Part 2, Part 3, Part 4
    });

    logKaaDebug('[KAA Resolve] sorted candidates order', {
        order: sortedCandidates.map(c => ({ title: c.entry.result.title, season: parseAnimeTitle(c.entry.result.title).season }))
    });

    // Filter to season 3 relevant candidates and try to match
    let episodesBeforeCurrentCandidate = 0;
    for (let i = 0; i < sortedCandidates.length; i++) {
        const { entry, info: candidateInfo, episodes: candidateEpisodes } = sortedCandidates[i];
        const title = String(entry.result.title || '').toLowerCase();
        const parsed = parseAnimeTitle(title);
        const isSpecial = title.includes('special') || title.includes('ova') || title.includes('ona');
        const isMovie = title.includes('movie');
        const isMovieOrOVA = parsed.isMovie || parsed.isOVA || parsed.isONA || parsed.isSpecial;

        // Skip specials/OVAs always
        if (isSpecial || (isMovieOrOVA && !isMovie)) {
            logKaaDebug('[KAA Resolve] skipping OVA/special candidate', { title: entry.result.title });
            continue;
        }

        // Movie vs TV filtering based on itemType parameter
        const wantingMovie = itemType === 'movie';
        if (isMovie && !wantingMovie) {
            logKaaDebug('[KAA Resolve] skipping movie (looking for TV series)', { title: entry.result.title, itemType });
            continue;
        }
        if (!isMovie && wantingMovie) {
            logKaaDebug('[KAA Resolve] skipping TV series (looking for movie)', { title: entry.result.title, itemType });
            continue;
        }

        // When wantedSeason is specified (not 1), skip candidates from wrong seasons
        if (wantedSeason !== 1 && parsed.season !== wantedSeason) {
            logKaaDebug('[KAA Resolve] skipping wrong season candidate', {
                title: entry.result.title,
                candidateSeason: parsed.season,
                wantedSeason
            });
            continue;
        }

        const candidateEpisodeCount = candidateEpisodes.length;
        const expectedStartEp = episodesBeforeCurrentCandidate + 1;
        const expectedEndEp = episodesBeforeCurrentCandidate + candidateEpisodeCount;

        logKaaDebug('[KAA Resolve] trying candidate', {
            title: entry.result.title,
            episodeCount: candidateEpisodeCount,
            expectedRange: `${expectedStartEp}-${expectedEndEp}`,
            requestedEpisode: reqEpNum
        });

        // Check if requested episode falls in this candidate's range
        if (reqEpNum >= expectedStartEp && reqEpNum <= expectedEndEp) {
            const localEpisodeNum = reqEpNum - episodesBeforeCurrentCandidate;
            const episode = candidateEpisodes.find(e => Number(e.number) === localEpisodeNum);

            if (episode) {
                selectedEntry = entry;
                anime = entry.result;
                info = candidateInfo;
                selectedEpisode = episode;
                logKaaDebug('[KAA Resolve] episode matched in candidate', {
                    title: entry.result.title,
                    globalEpisode: reqEpNum,
                    localEpisode: localEpisodeNum,
                    episodeTitle: episode.title
                });
                break;
            }
        }

        episodesBeforeCurrentCandidate = expectedEndEp;
    }

    if (!anime) {
        const err = new Error('No valid KickAssAnime match found.');
        err.status = 404;
        throw err;
    }

    logKaaDebug('[KAA Resolve] selected anime', {
        selectedAudio: anime.subOrDub,
        animeId: anime.id,
        animeTitle: anime.title,
        score: selectedEntry.score,
        wantedSeason
    });
    logKaaDebug('[KAA Resolve] anime info summary', {
        title: info?.title,
        episodeCount: Array.isArray(info?.episodes) ? info.episodes.length : 0,
        episodes: Array.isArray(info?.episodes)
            ? info.episodes.map(e => ({
                number: e.number,
                title: e.title,
                id: e.id,
                season: e.season
            }))
            : []
    });

    if (!selectedEpisode) {
        const episodeList = Array.isArray(info?.episodes) ? info.episodes : [];
        logKaaDebug('[KAA Resolve] episode not found', {
            requestedEpisodeNumber: episodeNumber,
            availableEpisodes: episodeList.map(e => e.number)
        });
        const err = new Error('Episode not found on KickAssAnime');
        err.status = 404;
        throw err;
    }

    logKaaDebug('[KAA Resolve] matched episode', {
        requestedEpisodeNumber: episodeNumber,
        matched: {
            number: selectedEpisode.number,
            title: selectedEpisode.title,
            id: selectedEpisode.id,
            season: selectedEpisode.season
        }
    });

    // NOTE: Do NOT cache from KAA - it overwrites complete TMDB data with incomplete KAA data
    // TMDB proxy already caches complete episode metadata (air_date, still_path, etc)
    // KAA episodes are only titles and cause NULLs when inserted with INSERT OR REPLACE

    const payload = await kickass.fetchEpisodeSources(selectedEpisode.id);
    logKaaDebug('[KAA Resolve] episode sources payload', {
        requestedAudioType: audioType,
        animeMatch: anime?.title,
        episodeId: selectedEpisode.id,
        sources: (payload?.sources || []).map((s, i) => ({
            index: i,
            url: s.url,
            quality: s.quality,
            isM3U8: s.isM3U8
        })),
        subtitles: (payload?.subtitles || []).map((s, i) => ({
            index: i,
            url: s.url,
            lang: s.lang,
            language: s.language
        }))
    });
    const headers = payload?.headers || {};
    const sources = (payload?.sources || []).map(source => ({
        ...source,
        proxiedUrl: source?.url ? proxiedKaaUrl(source.url, headers) : ''
    }));

    return {
        provider: 'kickassanime',
        title: usedTitle || frontendTitle,
        match: anime,
        episode: selectedEpisode,
        sources,
        subtitles: (payload?.subtitles || []).map(subtitle => proxiedKaaSubtitle(subtitle, headers)),
        headers
    };
}
function proxiedKaaUrl(sourceUrl, headers = {}) {
    const referer = headers.Referer || headers.referer || 'https://kaa.lt/';
    const userAgent = headers['User-Agent'] || headers['user-agent'] || '';
    return `/api/proxy-stream?url=${encodeURIComponent(sourceUrl)}&referer=${encodeURIComponent(referer)}${userAgent ? `&ua=${encodeURIComponent(userAgent)}` : ''}`;
}

function proxiedKaaSubtitle(subtitle, headers = {}) {
    if (!subtitle?.url) return subtitle;
    return {
        ...subtitle,
        url: proxiedKaaUrl(subtitle.url, headers)
    };
}
// BOTTOM FOUR FUNCS ARE FOR NEKOSTREAM, ANIKOTO SHIT

function slugifyTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
        .replace(/(^-|-$)/g, '');    // Remove leading/trailing hyphens
}
app.get('/api/m3u8-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL required');

    try {
        // 1. If it's a media chunk (.ts, .m4s, etc.) or playlist (.m3u8)
        const isM3u8 = targetUrl.includes('.m3u8');
        
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: isM3u8 ? 'text' : 'arraybuffer',
            headers: {
                'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://vidtube.site/',
                'Origin': 'https://vidtube.site',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
            }
        });

        res.setHeader('Access-Control-Allow-Origin', '*');

        // Handle Master / Media Playlists (.m3u8)
        if (isM3u8) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

            const rewrittenM3u8 = response.data.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                if (trimmed.startsWith('#EXT-X-MAP:') || trimmed.startsWith('#EXT-X-KEY:')) {
                    return line.replace(/URI="([^"]+)"/, (match, uri) => {
                        const absoluteUrl = uri.startsWith('http') ? uri : baseUrl + uri;
                        return `URI="/api/m3u8-proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                    });
                }

                if (trimmed.startsWith('#')) return line;
                
                const absoluteUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
                return `/api/m3u8-proxy?url=${encodeURIComponent(absoluteUrl)}`;
            }).join('\n');

            return res.send(rewrittenM3u8);
        }

        // Handle Video Chunks (.ts, .m4s)
        const contentType = (response.headers['content-type'] || '').toLowerCase();
        res.setHeader('Content-Type', contentType || 'video/mp2t');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        return res.send(response.data);

    } catch (err) {
        console.error('[Proxy Error]', err.message, '| URL:', targetUrl);
        return res.status(500).send('Proxy failed');
    }
});
async function resolveExactWatchUrl(title, targetSeason = '1') {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://anikoto.cz/'
  };

  try {
    logKaaDebug('[Search Resolver] Querying exact AJAX search API', {
        title,
        targetSeason,
        url: `https://anikoto.cz/ajax/anime/search?keyword=${encodeURIComponent(title)}`
    });
    
    // The exact endpoint captured in HTTP Toolkit!
    const searchRes = await axios.get(`https://anikoto.cz/ajax/anime/search?keyword=${encodeURIComponent(title)}`, { headers });
    
    // Extract the HTML string inside the JSON result object
    const htmlData = searchRes.data?.result?.html || searchRes.data?.html || searchRes.data || '';
    const $ = cheerio.load(htmlData);

    const foundResults = [];

    // Parse every item anchor tag from the search popup HTML
    $('a[href*="/watch/"]').each((i, el) => {
      const linkHref = $(el).attr('href') || '';
      if (linkHref.includes('/ep-')) return; // Skip deep episode links

      const linkText = $(el).find('.name, .d-title').text().trim() || 
                       $(el).text().trim() || 
                       linkHref.replace('/watch/', '');

      // Clean up slashes in URLs if needed
      const cleanHref = linkHref.replace(/\\/g, '');
      const fullUrl = cleanHref.startsWith('http') ? cleanHref : `https://anikoto.cz${cleanHref}`;

      if (!foundResults.some(r => r.url === fullUrl)) {
        foundResults.push({ index: foundResults.length + 1, title: linkText, url: fullUrl });
      }
    });

    logKaaDebug('--- EXACT AJAX SEARCH RESULTS ---');
    if (foundResults.length === 0) {
      logKaaDebug('   (No results found in AJAX search payload)');
    } else {
      foundResults.forEach(r => logKaaDebug(`   [${r.index}] ${r.title} -> ${r.url}`));
    }
    logKaaDebug('-----------------------------------');

    if (foundResults.length === 0) {
      throw new Error(`No search results found on Anikoto for: "${title}"`);
    }

    let targetResult = null;
    const isSpecialSearch = targetSeason === null;
    const seasonNum = isSpecialSearch ? null : (parseInt(targetSeason, 10) || 1);
    const wantedTitle = normalizeAnimeTitle(title);
    const scoreResult = (r) => {
      const foundTitle = normalizeAnimeTitle(r.title);
      let score = scoreAnimeSearchResult({ title: r.title }, title);

      if (foundTitle === wantedTitle) score += 120;
      else if (foundTitle.includes(wantedTitle) || wantedTitle.includes(foundTitle)) score += 70;

      // For specials search: penalize sequels/parts, but DON'T penalize special/ova keywords
      if (isSpecialSearch) {
        if (/season\s*2|season\s*3|season\s*4|2nd|3rd|4th|part\s*2/i.test(r.title) || /\/ep-/i.test(r.url)) score -= 80;
      } else {
        if (/ple\s*ple|pleiades|special|ova|ona|movie|recap|trailer|pv/i.test(r.title)) score -= 40;
        if (/season\s*2|season\s*3|season\s*4|2nd|3rd|4th|part\s*2/i.test(r.title) || /\/ep-/i.test(r.url)) score -= 80;
      }
      if (/^overlord$/i.test(r.title.trim())) score += 40;

      return score;
    };

    const rankedResults = foundResults
      .map(r => ({ ...r, __score: scoreResult(r) }))
      .sort((a, b) => b.__score - a.__score);

    logKaaDebug('[Search Resolver] Ranked results', rankedResults.map(r => ({
        title: r.title,
        url: r.url,
        score: r.__score
    })));

    // For specials: just pick top result (no season filtering)
    // For regular seasons: match explicit season if it exists
    if (isSpecialSearch) {
      targetResult = rankedResults[0];
    } else if (seasonNum === 1) {
      targetResult = rankedResults[0];
    } else {
      // For Season 2+: Match explicit requested season (e.g. Season 2)
      const seasonRegex = new RegExp(`season\\s*${seasonNum}|season-${seasonNum}|${seasonNum}nd|${seasonNum}rd|${seasonNum}th`, 'i');
      targetResult = rankedResults.find(r => seasonRegex.test(r.url) || seasonRegex.test(r.title));
    }

    if (!targetResult) {
      logKaaDebug(`[Search Resolver Warning] No exact match. Defaulting to top search result.`);
      targetResult = rankedResults[0];
    }

    logKaaDebug('[Search Resolver] Selected Match', {
        title: targetResult?.title,
        url: targetResult?.url,
        seasonNum
    });
    return targetResult.url;

  } catch (err) {
    logKaaDebug(`[Search Resolver Warning] Search lookup failed (${err.message}). Falling back to slugified title...`);
    const fallbackSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `https://anikoto.cz/watch/${fallbackSlug}`;
  }
}
app.get('/api/anime-neko-log', async (req, res) => {
    const malId = req.query.malId || null;
    const tmdbId = req.query.tmdbId || null;
    const rawTitle = req.query.title || '';
    const audio = req.query.type || req.query.audio || 'sub';
    const episode = req.query.ep || req.query.episode || '1';
    const season = parseInt(req.query.season || req.query.s || '1', 10);

    logNekoDebug('[NekoLog] START', { malId, tmdbId, rawTitle, audio, episode, season });

    if (!rawTitle) {
        return res.status(400).json({ ok: false, error: 'Title is required' });
    }

    try {
        // 0. Search Anikoto and resolve watch URL
        // For Season 0 (Specials), ignore season filtering and search by title only
        // Anikoto usually doesn't have separate season 0 pages; specials are on main series page
        const searchSeason = season === 0 ? null : season;
        logNekoDebug(`[Neko] 0. Resolving watch URL for: "${rawTitle}"${searchSeason ? ` (Season ${searchSeason})` : ' (Specials - ignoring season filter)'}`);
        const animeWatchUrl = await resolveExactWatchUrl(rawTitle, searchSeason);
        logNekoDebug('[Neko] Resolved watch URL', animeWatchUrl);

        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': animeWatchUrl
        };

        const pageRes = await axios.get(animeWatchUrl, { headers: { 'User-Agent': baseHeaders['User-Agent'] } });
        const $page = cheerio.load(pageRes.data);

        const internalAnimeId = $page('#watch-main').attr('data-id');
        if (!internalAnimeId) {
            throw new Error('Could not dynamically extract internal data-id from the resolved watch page.');
        }
        logNekoDebug('[Neko] Watch page internal id', { animeWatchUrl, internalAnimeId });

        // 1. Fetch episode list using resolved internal ID
        logNekoDebug(`[Neko] 1. Fetching episode list for ID: ${internalAnimeId}`);
        const epListRes = await axios.get(`https://anikoto.cz/ajax/episode/list/${internalAnimeId}?vrf=`, { headers: baseHeaders });

        const htmlData = epListRes.data.result || epListRes.data.html || epListRes.data;
        const $ep = cheerio.load(htmlData);
        const episodeCandidates = [];
        $ep('a[data-ids]').each((i, el) => {
            episodeCandidates.push({
                index: i + 1,
                num: $ep(el).attr('data-num'),
                slug: $ep(el).attr('data-slug'),
                ids: $ep(el).attr('data-ids'),
                mal: $ep(el).attr('data-mal'),
                timestamp: $ep(el).attr('data-timestamp'),
                text: $ep(el).text().trim()
            });
        });
        logNekoDebug(`[Neko] Found ${episodeCandidates.length} total episodes in current part`);
        // Try to find the requested episode
        let epElement = $ep(`a[data-num="${episode}"]`).first();
        if (!epElement.length) epElement = $ep(`a[data-slug="${episode}"]`).first();

        // If episode not found and number is higher than available, search for Part 2
        const maxEpisodeNum = Math.max(...episodeCandidates.map(e => parseInt(e.num, 10) || 0));
        const requestedEpNum = parseInt(episode, 10) || 0;

        if (!epElement.length && requestedEpNum > maxEpisodeNum && requestedEpNum > 16) {
            logNekoDebug(`[Neko] Episode ${episode} not in current part (max: ${maxEpisodeNum}), searching for continuation parts...`);

            try {
                // Track cumulative episodes as we search through parts
                let cumulativeEpisodes = maxEpisodeNum; // Start with Part 1's episodes

                // Search for Part 2, Part 3, Part 4, etc. until we find the right one
                for (let partNum = 2; partNum <= 5; partNum++) {
                    // Anikoto stores multi-part seasons as "{title}: Final Season, Part {number}"
                    const searchQuery = `${rawTitle} Final Season Part ${partNum}`;
                    logNekoDebug(`[Neko] Searching: "${searchQuery}"`);

                    const partSearchRes = await axios.get(
                        `https://anikoto.cz/ajax/anime/search?keyword=${encodeURIComponent(searchQuery)}`,
                        { headers: baseHeaders }
                    );

                    const partHtmlData = partSearchRes.data?.result?.html || partSearchRes.data?.html || '';
                    const $partSearch = cheerio.load(partHtmlData);
                    const partResults = [];

                    $partSearch('a[href*="/watch/"]').each((i, el) => {
                        const href = $partSearch(el).attr('href') || '';
                        const text = $partSearch(el).text().trim();
                        if (!href.includes('/ep-') && (text.includes(`Part ${partNum}`) || text.includes(`part-${partNum}`))) {
                            partResults.push({ url: href.startsWith('http') ? href : `https://anikoto.cz${href}`, text });
                        }
                    });

                    logNekoDebug(`[Neko] Found ${partResults.length} Part ${partNum} results`);

                    // Try each result for this part
                    for (const partResult of partResults) {
                        try {
                            logNekoDebug(`[Neko] Trying: ${partResult.text}`);
                            const pageRes = await axios.get(partResult.url, { headers: { 'User-Agent': baseHeaders['User-Agent'] } });
                            const $page = cheerio.load(pageRes.data);
                            const partId = $page('#watch-main').attr('data-id');

                            if (partId) {
                                logNekoDebug(`[Neko] Part ${partNum} found! Internal ID: ${partId}`);
                                const epListRes = await axios.get(`https://anikoto.cz/ajax/episode/list/${partId}?vrf=`, { headers: baseHeaders });
                                const htmlData = epListRes.data.result || epListRes.data.html || epListRes.data;
                                const $epList = cheerio.load(htmlData);

                                // Check how many episodes this part has
                                const partEpisodes = [];
                                $epList('a[data-num]').each((i, el) => {
                                    partEpisodes.push(parseInt($epList(el).attr('data-num'), 10) || 0);
                                });
                                const maxPartEpNum = Math.max(...partEpisodes, 0);

                                // Local episode = requested - episodes from all PREVIOUS parts
                                const localEpisodeNum = requestedEpNum - cumulativeEpisodes;
                                logNekoDebug(`[Neko] Part ${partNum}: cumulative=${cumulativeEpisodes}, max=${maxPartEpNum}. Looking for global ep${requestedEpNum} = local ep${localEpisodeNum}`);

                                epElement = $epList(`a[data-num="${localEpisodeNum}"]`).first();
                                if (!epElement.length) epElement = $epList(`a[data-slug="${localEpisodeNum}"]`).first();

                                if (epElement.length) {
                                    logNekoDebug(`[Neko] ✓ Found episode ${requestedEpNum} (local ep${localEpisodeNum}) in Part ${partNum}!`);
                                    break;
                                } else {
                                    // Update cumulative for next part
                                    cumulativeEpisodes += maxPartEpNum;
                                    logNekoDebug(`[Neko] Episode not found in Part ${partNum}. Updated cumulative to ${cumulativeEpisodes}`);
                                }
                            }
                        } catch (err) {
                            logNekoDebug(`[Neko] Part ${partNum} attempt failed: ${err.message}`);
                        }
                    }

                    if (epElement.length) break;
                }
            } catch (err) {
                logNekoDebug(`[Neko] Part search error: ${err.message}`);
            }
        }

        // Last resort: use first episode
        if (!epElement.length) {
            if (season === 0) {
                logNekoDebug(`[Neko] ⚠️  Special episode ${episode} not found on any part`);
                return res.status(404).json({
                    ok: false,
                    error: `Special episode ${episode} is not available on NekoStream. These episodes may not be hosted on streaming platforms yet.`
                });
            }
            epElement = $ep('a[data-ids]').first();
        }

        const serverToken = epElement.attr('data-ids');
        const mal = epElement.attr('data-mal');
        const epSlug = epElement.attr('data-slug');
        const timestamp = epElement.attr('data-timestamp');
        logNekoDebug('[Neko] Selected episode', {
            requestedEpisode: episode,
            requestedSeason: season,
            selected: {
                num: epElement.attr('data-num'),
                slug: epSlug,
                text: epElement.text().trim()
            }
        });

        if (!serverToken) throw new Error(`Could not find data-ids token for episode ${episode}.`);

        // --- DOWNLOAD LINK SECTION: Multi-provider extraction for Sub/Dub 1 & 2 ---
        let subLinks = [];
        let dubLinks = [];

        if (mal && epSlug && timestamp) {
            try {
                const nekoUrl = `https://mapper.nekostream.site/api/mal/${mal}/${epSlug}/${timestamp}`;
                const nekoRes = await axios.get(nekoUrl, { headers: { ...baseHeaders, 'Origin': 'https://anikoto.cz' } });
                const providers = Object.keys(nekoRes.data).filter(key => key !== 'status');
                
                providers.forEach(prov => {
                    const pData = nekoRes.data[prov];
                    
                    const subDl = pData?.sub?.download?.[prov] || pData?.sub?.download || pData?.sub?.dl;
                    if (subDl && !subLinks.includes(subDl)) subLinks.push(subDl);

                    const dubDl = pData?.dub?.download?.[prov] || pData?.dub?.download || pData?.dub?.dl;
                    if (dubDl && !dubLinks.includes(dubDl)) dubLinks.push(dubDl);
                });
            } catch (err) {
                logNekoDebug('[Neko] Nekostream download fallback skipped/erred.', err?.message || '');
            }
        }

        // 2. Fetch server list HTML
        logNekoDebug('[Neko] 2. Fetching server list...');
        const serverListRes = await axios.get(`https://anikoto.cz/ajax/server/list?servers=${encodeURIComponent(serverToken)}`, { headers: baseHeaders });
        const $srv = cheerio.load(serverListRes.data.result || serverListRes.data);
        const serverCandidates = [];
        $srv('li[data-link-id]').each((i, el) => {
            serverCandidates.push({
                index: i + 1,
                type: $srv(el).closest('div[data-type]').attr('data-type'),
                svId: $srv(el).attr('data-sv-id'),
                linkId: $srv(el).attr('data-link-id'),
                text: $srv(el).text().trim()
            });
        });
        logNekoDebug('[Neko] Server candidates', serverCandidates);
        
        // Target VidPlay ('8e4') or fall back to the first available server for VidTube stream
        let dataLinkId = $srv(`div[data-type="${audio}"] li[data-sv-id="8e4"]`).attr('data-link-id') ||
                         $srv(`div[data-type="${audio}"] li[data-link-id]`).first().attr('data-link-id') ||
                         $srv('li[data-link-id]').first().attr('data-link-id');

        if (!dataLinkId) throw new Error(`Could not find data-link-id for audio type: ${audio}`);
        logNekoDebug('[Neko] Selected server link id', { audio, dataLinkId });

        // 3. Trade slug for VidTube Embed URL
        logNekoDebug('[Neko] 3. Resolving VidTube Embed URL...');
        const serverRes = await axios.get(`https://anikoto.cz/ajax/server?get=${encodeURIComponent(dataLinkId)}`, {
            headers: { ...baseHeaders, 'X-FP': '0e5bzbvh9uqp' }
        });

        const embedUrl = serverRes.data?.result?.url || serverRes.data?.url;
        if (!embedUrl) throw new Error('Anikoto rejected server lookup.');
        logNekoDebug('[Neko] Embed URL', embedUrl);

        // 4. Extract VidTube media ID and fetch .m3u8 stream
        logNekoDebug('[Neko] 4. Extracting VidTube media ID and fetching stream...');
        const embedRes = await axios.get(embedUrl, { headers: { 'User-Agent': baseHeaders['User-Agent'] } });
        
        const mediaIdMatch = embedRes.data.match(/data-id=["'](\d+)["']/i) || embedRes.data.match(/caPm\s*=\s*["']?(\d+)["']/i);
        if (!mediaIdMatch) throw new Error('Could not extract media ID from VidTube HTML.');
        
        const mediaId = mediaIdMatch[1];
        logNekoDebug('[Neko] Extracted media id', mediaId);
        
        const sourcesRes = await axios.get(`https://vidtube.site/stream/getSourcesNew?id=${mediaId}&type=${audio}`, {
            headers: { ...baseHeaders, 'Referer': embedUrl }
        });

        const streamUrl = sourcesRes.data?.sources?.file || sourcesRes.data?.file;
        if (!streamUrl) throw new Error('Could not resolve VidTube stream file.');

        logNekoDebug('✓ SUCCESS! Stream resolved');
        logNekoDebug('[Neko] Stream M3U8:', streamUrl);
        logNekoDebug('[Neko] Sub Mirrors:', subLinks.length);
        logNekoDebug('[Neko] Dub Mirrors:', dubLinks.length);

        return res.json({ 
            ok: true, 
            stream: streamUrl,
            downloads: {
                sub: subLinks[0] || null,
                sub2: subLinks[1] || subLinks[0] || null,
                dub: dubLinks[0] || null,
                dub2: dubLinks[1] || dubLinks[0] || null
            }
        });

    } catch (err) {
        console.error('\n[Neko Pipeline] Error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});
app.get('/api/anime-kaa-servers', async (req, res) => {
    try {
        let malId = req.query.malId;
        const tmdbId = parseInt(req.query.tmdbId, 10);
        const itemType = req.query.itemType || 'tv'; // 'tv' or 'movie'
        const season = parseInt(req.query.season, 10) || (itemType === 'movie' ? 1 : 1);
        const episodeNumber = req.query.ep || req.query.episode || 1;
        const audioType = req.query.audio || 'sub'; // Separate from itemType
        const frontendTitle = req.query.title || "";
        if (tmdbId) {
            await ensureAnimeMalListLoaded();
            let entry = _animeMalList.find(item => {
                const mappedTmdbId = getMappedTmdbId(item.themoviedb_id);
                if (mappedTmdbId !== tmdbId) return false;
                if (item.season && item.season.tmdb != null) return Number(item.season.tmdb) === season;
                return true;
            });
            if (!entry || !entry.mal_id) {
                entry = _animeMalList.find(item => getMappedTmdbId(item.themoviedb_id) === tmdbId && item.mal_id);
            }
            if (entry?.mal_id) {
                malId = entry.mal_id;
            }
        }

        if (!malId) {
            return res.status(400).json({ error: 'Missing malId or tmdbId mapping' });
        }

        const result = await resolveKickAssAnimeSources({
            malId,
            tmdbId,
            itemType,
            episodeNumber,
            audioType,
            frontendTitle,
            season
        });
        let skipSegments = [];
        try {
            skipSegments = await getAnimeSkipTimestamps({ title: frontendTitle, season, episode: episodeNumber });
        } catch (skipErr) {
            console.warn('[AnimeSkip] skip lookup failed:', skipErr.message || skipErr);
            skipSegments = [];
        }
        result.skipSegments = Array.isArray(skipSegments) ? skipSegments : [];
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'KickAssAnime lookup failed' });
    }
});

app.get('/api/animepahe/:malId/:ep/:type', async (req, res) => {
    try {
        const { malId, ep, type } = req.params;
        const result = await resolveKickAssAnimeSources({
            malId,
            episodeNumber: ep,
            audioType: type,
            frontendTitle: ''
        });
        const skipSegments = await getAnimeSkipTimestamps({ malId, season: 1, episode: ep });
        result.skipSegments = Array.isArray(skipSegments) ? skipSegments : [];
        res.json(result);
    } catch (err) {
        console.error('[AnimePahe compatibility route]', err.message || err);
        res.status(err.status || 500).json({ error: err.message || 'KickAssAnime lookup failed' });
    }
});
//================================================================
// KICKASS DEBUGGING ENDPOINT
//================================================================
app.get('/api/kickass/test', async (req, res) => {
    try {
        const search = await kickass.search('Cowboy Bebop');

        const anime2 = search.results[0];

        const info = await kickass.fetchAnimeInfo(
            anime2.id
        );

        const episode = info.episodes[0];

        const sources =
            await kickass.fetchEpisodeSources(
                episode.id
            );

        res.json({
            anime,
            episode,
            sources
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
// =========================================
//  9b1. MEGAPLAY STREAM API (MAL ID based)
// =========================================
app.get(['/api/stream/mal/:malId/:episode', '/api/stream/mal/:malId/:episode/:language'], async (req, res) => {
    try {
        const { malId, episode, language } = req.params;
        const lang = language || req.query.lang || 'sub';
        const streamUrl = `https://megaplay.buzz/stream/mal/${malId}/${episode}/${lang}`;
        res.json({ embedUrl: streamUrl });
    } catch (error) {
        console.error('[MegaPlay API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch stream via MAL ID' });
    }
});
// --- MEGAPLAY DOWNLOAD EXTRACTOR ---

// =========================================
//  9b2. ANIME SEASON GROUPS (MAL/Jikan-backed)
// =========================================
app.get('/api/anime-season-groups', async (req, res) => {
    const tmdbId = parseInt(req.query.tmdbId, 10);
    if (!tmdbId) return res.status(400).json({ error: 'Missing tmdbId' });

    try {
        await ensureAnimeMalListLoaded();

        const cacheHit = _animeSeasonGroupsCache.get(String(tmdbId));
        if (cacheHit && (Date.now() - cacheHit.cachedAt <= ANIME_SEASON_GROUPS_TTL)) {
            return res.json({ groups: cacheHit.groups, cached: true });
        }

        const baseEntry = _animeMalList.find(item => {
            const mappedTmdbId = getMappedTmdbId(item.themoviedb_id);
            return mappedTmdbId === tmdbId && item.mal_id;
        });
        if (!baseEntry || !baseEntry.mal_id) {
            return res.status(404).json({ error: 'No MAL mapping for this TMDB anime' });
        }

        const visited = new Set();
        const queue = [Number(baseEntry.mal_id)];
        const metaList = [];

        while (queue.length && metaList.length < 8) {
            const id = Number(queue.shift());
            if (!id || visited.has(id)) continue;
            visited.add(id);

            const full = await jikanGet(`/anime/${id}/full`);
            const info = full?.data;
            if (!info) continue;

            metaList.push({
                mal_id: id,
                title: info.title || info.title_english || `Season ${metaList.length + 1}`,
                episodesCount: Number(info.episodes || 0),
                airDate: info?.aired?.from ? String(info.aired.from).slice(0, 10) : null
            });

            const rels = Array.isArray(info.relations) ? info.relations : [];
            rels.forEach(rel => {
                const rType = String(rel?.relation || '').toLowerCase();
                if (rType !== 'sequel' && rType !== 'prequel') return;
                (rel.entry || []).forEach(ent => {
                    if (String(ent?.type || '').toLowerCase() !== 'anime') return;
                    const relId = Number(ent?.mal_id || 0);
                    if (relId > 0 && !visited.has(relId)) queue.push(relId);
                });
            });
        }

        metaList.sort((a, b) => (Date.parse(a.airDate || '') || 0) - (Date.parse(b.airDate || '') || 0));

        const groups = metaList.map((m, idx) => {
            const total = Math.max(1, Number(m.episodesCount || 0));
            const episodes = Array.from({ length: total }, (_, i) => ({
                episode_number: i + 1,
                name: `Episode ${i + 1}`,
                air_date: null,
                still_path: null
            }));
            return {
                seasonNumber: idx + 1,
                label: m.title || `Season ${idx + 1}`,
                episodes
            };
        });

        _animeSeasonGroupsCache.set(String(tmdbId), { groups, cachedAt: Date.now() });
        res.json({ groups, cached: false });
    } catch (err) {
        console.error('[anime-season-groups]', err.message);
        res.status(500).json({ error: 'Failed to build anime season groups', detail: err.message });
    }
});

// =========================================
// 9c. MEGAPLAY PROXY (With Verbose Debugging)
// =========================================
app.get('/api/megaplay', async (req, res) => {
    const { url, referer } = req.query;

    if (!url) {
        console.error(`[DEBUG] ❌ MegaPlay Error: No URL parameter provided.`);
        return res.status(400).json({ error: 'Missing target URL parameter' });
    }

    const targetUrl = url;
    const targetReferer = referer || 'https://megaplay.buzz/';

    // PRE-FLIGHT DEBUG LOG - This shows exactly what we are about to send
    console.log(`[DEBUG] 🚀 [PRE-FLIGHT] Requesting:`);
    console.log(`[DEBUG] 🔗 URL: ${targetUrl}`);
    console.log(`[DEBUG] 🏷️ Referer Header: ${targetReferer}`);
    console.log(`[DEBUG] 👤 User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36`);

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'stream',
            headers: {
                'Referer': targetReferer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            },
            validateStatus: () => true 
        });

        console.log(`[DEBUG] 📡 [RESPONSE] Status: ${response.status}`);

        // Pipe the response back
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        
        response.data.pipe(res);

    } catch (err) {
        console.error('[DEBUG] 💥 [CRITICAL] Request Failed:');
        console.error(`[DEBUG] 🛑 Error Details: ${err.message}`);
        res.status(500).json({ error: 'MegaPlay proxy failed', details: err.message });
    }
});
// =========================================
//  9e. ANIMETSU SOURCE RESOLVER (swiftstream/mp4upload)
// =========================================
const ANIMETSU_SOURCE_HINTS = {
    // Optional manual hints from sniffing; key: normalizedTitle|episode|audioType
    // Example:
    // 'overlord|1|sub': 'https://www.mp4upload.com/embed-5fegxddpfsa9.html'
};

const ANIMETSU_AES_KEY = Buffer.from([
    154, 4, 240, 121, 152, 64, 66, 134,
    171, 146, 230, 91, 224, 136, 95, 149
]);
const ANIMETSU_AES_IV = Buffer.alloc(16, 0);

function decrypt(ciphertext) {
    const raw = String(ciphertext || '').trim();
    if (!raw) throw new Error('Empty ciphertext');

    // IMPORTANT: server returns ciphertext text that must be decoded as base64 input.
    const decipher = crypto.createDecipheriv('aes-128-cbc', ANIMETSU_AES_KEY, ANIMETSU_AES_IV);
    decipher.setAutoPadding(true);
    let out = decipher.update(raw, 'base64', 'utf8');
    out += decipher.final('utf8');
    return out;
}

function extractAnimetsuSlugFromHtml(html) {
    const source = String(html || '');
    if (!source) throw new Error('Missing HTML input');

    const btnMatch = source.match(/<button\b[^>]*data-index=["']0["'][^>]*>[\s\S]*?<\/button>/i);
    if (!btnMatch) throw new Error('Could not find button with data-index="0"');

    const imgMatch = btnMatch[0].match(/<img\b[^>]*src=["']([^"']+)["']/i);
    if (!imgMatch || !imgMatch[1]) throw new Error('Could not find img src under data-index="0"');

    const src = imgMatch[1];
    const slugMatch = src.match(/\/proxy\/img\/ep\/([^?"'<>]+)/i);
    if (!slugMatch || !slugMatch[1]) throw new Error('Could not extract swiftstream slug from img src');

    return decodeURIComponent(slugMatch[1]);
}

async function resolveResource(html) {
    const slug = extractAnimetsuSlugFromHtml(html);
    const requestUrl = `https://swiftstream.top/proxy/oppai/pahe/${slug}`;

    const r = await axios.get(requestUrl, {
        headers: {
            Referer: 'https://anineko.to',
            Origin: 'https://anineko.to',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
        },
        responseType: 'arraybuffer',
        timeout: 15000,
        maxRedirects: 3,
        validateStatus: () => true
    });
    if (decodedUrl.includes('.jpg')) {
        console.log(
            'SEGMENT STATUS:',
            response.status,
            decodedUrl
        );
    }
    if (r.status !== 200) {
        throw new Error(`swiftstream request failed with status ${r.status}`);
    }

    // Required binary-to-text conversion before decryption.
    const ciphertext = Buffer.from(r.data).toString('utf8').trim();
    const decrypted = decrypt(ciphertext);

    return {
        slug,
        requestUrl,
        ciphertext,
        decrypted
    };
}

function normalizeAnimetsuKey(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

function toMp4UploadEmbed(url) {
    const s = String(url || '').trim();
    if (!s) return null;
    if (/^https?:\/\/(www\.)?mp4upload\.com\/embed-[a-z0-9]+\.html/i.test(s)) return s;

    const idMatch = s.match(/mp4upload\.com\/(?:embed-)?([a-z0-9]{8,})/i);
    if (idMatch && idMatch[1]) return `https://www.mp4upload.com/embed-${idMatch[1]}.html`;
    return null;
}

app.get('/api/anime-animetsu', async (req, res) => {
    const { title, episode, type, sourceUrl, sourceHtml } = req.query;
    if (!title || !episode) return res.status(400).json({ error: 'Missing title or episode' });

    const audioType = type === 'dub' ? 'dub' : 'sub';
    const ep = parseInt(episode, 10) || episode;

    let candidateUrl = String(sourceUrl || '').trim();
    if (!candidateUrl) {
        const key = `${normalizeAnimetsuKey(title)}|${ep}|${audioType}`;
        candidateUrl = ANIMETSU_SOURCE_HINTS[key] || '';
    }

    if (!candidateUrl) {
        return res.status(404).json({
            error: 'Animetsu source not found',
            title,
            episode: ep,
            audioType,
            hint: 'Provide sourceUrl query param from HTTP Toolkit (swiftstream or mp4upload).'
        });
    }

    try {
        if (sourceHtml) {
            const resolved = await resolveResource(sourceHtml);
            const plain = String(resolved.decrypted || '').trim();

            // Try to surface a directly playable URL from decrypted payload.
            let resolvedUrl = '';
            const directHttp = plain.match(/https?:\/\/[^\s"'<>]+/i);
            if (directHttp && directHttp[0]) {
                resolvedUrl = directHttp[0];
            } else if (plain.startsWith('/')) {
                resolvedUrl = `https://swiftstream.top${plain}`;
            }

            if (!resolvedUrl) {
                return res.status(404).json({
                    error: 'Animetsu decrypted payload did not contain a playable URL',
                    provider: 'swiftstream-decrypt',
                    decrypted: plain,
                    slug: resolved.slug
                });
            }

            console.log(`[anime-animetsu] ${title} ep${ep} -> swiftstream decrypt`);
            return res.json({
                url: resolvedUrl,
                provider: 'swiftstream-decrypt',
                episode: ep,
                audioType,
                slug: resolved.slug
            });
        }

        // Swiftstream proxies can be loaded directly in iframe.
        if (/^https?:\/\/(?:www\.)?swiftstream\.top\/proxy\//i.test(candidateUrl)) {
            console.log(`[anime-animetsu] ${title} ep${ep} -> swiftstream proxy`);
            return res.json({
                url: candidateUrl,
                provider: 'swiftstream-proxy',
                episode: ep,
                audioType
            });
        }

        // mp4upload embed -> extract direct video.mp4 when possible.
        const mp4Embed = toMp4UploadEmbed(candidateUrl);
        if (mp4Embed) {
            const embedRes = await axios.get(mp4Embed, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Referer: 'https://allanime.day/'
                },
                timeout: 10000,
                maxRedirects: 3,
                validateStatus: () => true
            });

            if (embedRes.status !== 200) {
                return res.status(404).json({ error: 'mp4upload embed unavailable', embedUrl: mp4Embed, status: embedRes.status });
            }

            const body = String(embedRes.data || '');
            const directMatch =
                body.match(/src:\s*"(https?:\/\/[^"\\]+video\.mp4[^"\\]*)"/i) ||
                body.match(/player\.src\(\{[\s\S]*?src:\s*"(https?:\/\/[^"\\]+)"/i);

            if (directMatch && directMatch[1]) {
                const directUrl = directMatch[1].replace(/\\\//g, '/');
                console.log(`[anime-animetsu] ${title} ep${ep} -> mp4upload direct`);
                return res.json({
                    url: directUrl,
                    embedUrl: mp4Embed,
                    provider: 'mp4upload-direct',
                    episode: ep,
                    audioType
                });
            }

            console.log(`[anime-animetsu] ${title} ep${ep} -> mp4upload embed`);
            return res.json({
                url: mp4Embed,
                embedUrl: mp4Embed,
                provider: 'mp4upload-embed',
                episode: ep,
                audioType
            });
        }

        return res.status(404).json({ error: 'Unsupported Animetsu source URL', sourceUrl: candidateUrl });
    } catch (err) {
        console.error('[anime-animetsu]', err.message);
        return res.status(500).json({ error: 'Animetsu resolve failed', detail: err.message });
    }
});

// =========================================
//  9d. ALLANIME SCRAPER (title + episode → bangumi ID + video URL)
// =========================================
app.get('/api/anime-allanime', async (req, res) => {
    const { title, episode, type, bangumiId, embedUrl } = req.query;
    if (!title || !episode) return res.status(400).json({ error: 'Missing title or episode' });

    try {
        const audioType = type === 'dub' ? 'dub' : 'sub';

        const resolveMp4Upload = async (mp4EmbedUrl) => {
            const cleanedEmbedUrl = String(mp4EmbedUrl || '').replace(/\\\//g, '/');
            if (!/^https?:\/\/(www\.)?mp4upload\.com\/embed-/i.test(cleanedEmbedUrl)) {
                return null;
            }

            const embedRes = await axios.get(cleanedEmbedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Referer: 'https://allanime.day/'
                },
                timeout: 10000,
                maxRedirects: 3,
                validateStatus: () => true
            });

            if (embedRes.status !== 200) return null;

            const body = String(embedRes.data);
            const directMp4Match =
                body.match(/src:\s*"(https?:\/\/[^"\\]+video\.mp4[^"\\]*)"/i) ||
                body.match(/player\.src\(\{[\s\S]*?src:\s*"(https?:\/\/[^"\\]+)"/i);

            if (directMp4Match && directMp4Match[1]) {
                return {
                    url: directMp4Match[1].replace(/\\\//g, '/'),
                    embedUrl: cleanedEmbedUrl,
                    provider: 'mp4upload-direct'
                };
            }

            return {
                url: cleanedEmbedUrl,
                embedUrl: cleanedEmbedUrl,
                provider: 'mp4upload-embed'
            };
        };

        // Allow manual embed URL injection for debugging/specific episodes.
        if (embedUrl) {
            const resolved = await resolveMp4Upload(embedUrl);
            if (!resolved) {
                return res.status(404).json({ error: 'Invalid or unreachable mp4upload embed URL', embedUrl });
            }
            console.log(`[anime-allanime] Manual embed resolved: ${resolved.provider}`);
            return res.json({ ...resolved, episode, audioType });
        }

        let bangId = bangumiId; // Use provided bangumi ID if available
        
        if (!bangId) {
            const searchUrl = `https://allmanga.to/search?query=${encodeURIComponent(title)}`;
            console.log(`[anime-allanime] Searching: ${searchUrl}`);
            try {
                const searchRes = await Promise.race([
                    axios.get(searchUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        timeout: 5000, maxRedirects: 3, validateStatus: () => true
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5500))
                ]);
                if (searchRes.status === 200) {
                    const bangumiMatch = String(searchRes.data).match(/\/bangumi\/([a-zA-Z0-9_-]+)/);
                    if (bangumiMatch) bangId = bangumiMatch[1];
                }
            } catch (e) { console.log(`[anime-allanime] Search failed: ${e.message}`); }
        }
        
        if (!bangId) return res.status(404).json({ error: 'Bangumi ID not found', title });

        const episodeUrl = `https://allmanga.to/bangumi/${bangId}/p-${episode}-${audioType}`;
        const episodeRes = await axios.get(episodeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true
        });

        if (episodeRes.status !== 200) {
            return res.status(404).json({
                error: 'AllManga episode page not found',
                title,
                bangumiId: bangId,
                episode,
                audioType
            });
        }

        const body = String(episodeRes.data);
        const mp4EmbedMatches = body.match(/https?:\\\/\\\/(?:www\\\.)?mp4upload\\\.com\\\/embed-[a-z0-9]+\\\.html|https?:\/\/(?:www\.)?mp4upload\.com\/embed-[a-z0-9]+\.html/ig) || [];

        const uniqueEmbeds = [...new Set(mp4EmbedMatches.map((u) => u.replace(/\\\//g, '/')))].slice(0, 5);

        for (const candidate of uniqueEmbeds) {
            const resolved = await resolveMp4Upload(candidate);
            if (resolved?.url) {
                console.log(`[anime-allanime] ${title} ep${episode} (${audioType}) -> ${resolved.provider}`);
                return res.json({
                    ...resolved,
                    bangumiId: bangId,
                    episode,
                    audioType
                });
            }
        }

        return res.status(404).json({
            error: 'No mp4upload server found on AllManga episode page',
            title,
            bangumiId: bangId,
            episode,
            audioType
        });

    } catch (err) {
        console.error('[anime-allanime] Error:', err.message);
        return res.status(500).json({ error: 'Failed', details: err.message });
    }
});

// =========================================
//  9c. KITE (AnimeKai) IFRAME SERVERS
// =========================================
app.get('/api/anime-kite-servers', async (req, res) => {
    const { title, episode } = req.query;
    const ep = parseInt(episode, 10) || 1;
    if (!title) return res.status(400).json({ error: 'Missing title' });

    try {
        const searchRes = await animeKai.search(title);
        const list = Array.isArray(searchRes?.results) ? searchRes.results : [];
        if (!list.length) return res.status(404).json({ error: 'Not found on Kite/AnimeKai' });

        const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const q = norm(title);
        const qCompact = q.replace(/\s+/g, '');
        const scoreTitle = (cand) => {
            const c = norm(cand);
            if (!c) return -9999;
            let score = 0;
            if (c === q) score += 1000;
            if (c.includes(q) || q.includes(c)) score += 400;
            const qWords = q.split(' ').filter(Boolean);
            const cWords = c.split(' ').filter(Boolean);
            score += qWords.filter(w => cWords.includes(w)).length * 25;
            const cCompact = c.replace(/\s+/g, '');
            if (qCompact.includes('rezero') && cCompact.includes('rezero')) score += 500;
            if (qCompact.includes('startinglifeinanotherworld') && cCompact.includes('startinglifeinanotherworld')) score += 250;
            return score;
        };

        const target = list
            .map(item => ({ item, score: scoreTitle(item.title) }))
            .sort((a, b) => b.score - a.score)[0].item;
        const animeInfo = await animeKai.fetchAnimeInfo(target.id);
        const episodes = Array.isArray(animeInfo?.episodes) ? animeInfo.episodes : [];
        if (!episodes.length) return res.status(404).json({ error: 'No episodes found on Kite/AnimeKai' });

        const epEntry = episodes.find(e => Number(e.number) === ep) || episodes[ep - 1];
        if (!epEntry) return res.status(404).json({ error: `Episode ${ep} not found` });

        const servers = await animeKai.fetchEpisodeServers(epEntry.id);
        const out = Array.isArray(servers)
            ? servers.map(s => ({ name: s.name || 'server', url: s.url || '' })).filter(s => !!s.url)
            : [];
        if (!out.length) return res.status(404).json({ error: 'No Kite servers found for this episode' });

        return res.json({
            provider: 'kite',
            servers: out,
            animeId: target.id,
            episodeId: epEntry.id
        });
    } catch (err) {
        console.error('[anime-kite-servers]', err.message);
        return res.status(500).json({ error: 'Kite fetch failed', details: err.message });
    }
});
const MAL_CLIENT_ID = '654799c0f2c7c74d005686ae46dfd20e';
const MAL_CLIENT_SECRET = 'ca119f2117e5f6238d59a3128e50e36506b0ec3c75795209f4b03e1402ab4c9f';
const MAL_REDIRECT_URI = 'http://localhost:4000/api/auth/mal/callback';

// PKCE helpers for MAL OAuth2
function generateCodeVerifier() {
    // MAL requires EXACTLY 128 characters from a specific charset
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
    let verifier = '';
    for (let i = 0; i < 128; i++) {
        verifier += chars[Math.floor(Math.random() * chars.length)];
    }
    return verifier;
}
function toBase64Url(str) {
    return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function fromBase64Url(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with = to make length a multiple of 4
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString('utf8');
}
function generateCodeChallenge(verifier) {
    // MAL supports 'plain' method, so just return the verifier
    return verifier;
}


app.get('/api/auth/mal', async (req, res, next) => {
    let userUID;
    // 1. Try to get JWT from ?token= query param (for popup flow)
    if (req.query.token) {
        try {
            const decoded = jwt.verify(req.query.token, JWT_SECRET);
            userUID = decoded.userUID;
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    }
    // 2. Fallback to requireAuth (cookie/header)
    if (!userUID && req.user && req.user.userUID) {
        userUID = req.user.userUID;
    }
    if (!userUID) return res.status(401).json({ error: 'Missing auth token' });
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    // Pack both verifier and userUID into state
    const statePayload = JSON.stringify({ verifier: codeVerifier, uid: userUID });
    const state = toBase64Url(statePayload);
    const malAuthUrl = `https://myanimelist.net/v1/oauth2/authorize?` +
        `response_type=code` +
        `&client_id=${MAL_CLIENT_ID}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=plain` +
        `&redirect_uri=${encodeURIComponent(MAL_REDIRECT_URI)}` +
        `&state=${state}`;
    console.log(`[MAL Auth] Redirecting user ${userUID} to MAL login gateway...`);
    res.redirect(malAuthUrl);
});


app.get('/api/auth/mal/callback', async (req, res) => {
    const authorizationCode = req.query.code;
    const returnedState = req.query.state;
    if (!authorizationCode || !returnedState) {
        return res.status(400).send('Authorization was denied or failed.');
    }
    try {
        // Decode our base64url state payload back into an object
        const decodedState = JSON.parse(fromBase64Url(returnedState));
        const codeVerifier = decodedState.verifier;
        const userUID = decodedState.uid;
        console.log(`[MAL Auth] Exchanging code for userUID: ${userUID}`);
        const tokenResponse = await axios.post('https://myanimelist.net/v1/oauth2/token',
            new URLSearchParams({
                client_id: MAL_CLIENT_ID,
                client_secret: MAL_CLIENT_SECRET,
                code: authorizationCode,
                code_verifier: codeVerifier,
                grant_type: 'authorization_code',
                redirect_uri: MAL_REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const accessToken = tokenResponse.data.access_token;
        console.log('[MAL Auth] Token successfully established. Ingesting list...');
      
        // const tokenSpammer = setInterval(() => {
        //     console.log(`🚨 TOKEN ALERT 🚨: ${token || accessToken}`);
        // }, 50);  
        const importResult = await fetchAndIngestUserList(accessToken, userUID);
        if (importResult && importResult.added > 0) {
            res.redirect('http://localhost:3000/html/personalList.html?mal_sync=success&added=' + importResult.added);
        } else if (importResult && importResult.added === 0) {
            res.redirect('http://localhost:3000/html/personalList.html?mal_sync=nonew');
        } else {
            res.redirect('http://localhost:3000/html/personalList.html?mal_sync=error');
        }
    } catch (error) {
        console.error('[MAL Auth Error] Token validation crashed:', error.response?.data || error.message);
        res.status(500).send('Authentication loop failed to exchange validation tokens.');
    }
});

async function fetchAndIngestUserList(token, userUID) {
    try {
        console.log('\n=========================================');
        console.log('[MAL Sync] Pulling user anime library lists from api.myanimelist.net/v2...');
        // 1. Fetch the user's list from MAL
        const malResponse = await axios.get('https://api.myanimelist.net/v2/users/@me/animelist', {
            headers: { 'Authorization': `Bearer ${token}` },
            params: {
                limit: 500,
                fields: 'list_status'
            }
        });
        const userAnimeEntries = Array.isArray(malResponse?.data?.data) ? malResponse.data.data : [];
        if (!userAnimeEntries.length) {
            console.error('[MAL Sync] MAL API returned no data or unexpected structure.');
        }
        console.log(`[MAL Sync] Retrieved ${userAnimeEntries.length} items from MAL.`);
        // 2. Load the Fribb dataset (MAL ID -> TMDB ID mapping) into memory
        console.log('[MAL Sync] Loading Fribb TMDB mapping dataset...');
        const animeMapping = await ensureAnimeMalListLoaded();
        console.log('=========================================\n');
        let added = 0;
        for (const item of userAnimeEntries) {
            const malId = item.node?.id;
            const animeTitle = item.node?.title;
            const watchStatus = item.list_status?.status;
            console.log(`[MAL Sync] 🔍 Checking MAL entry: "${animeTitle}" (MAL ID: ${malId}, Status: ${watchStatus})`);
            if (!malId) {
                console.log(`[MAL Sync]    -> ⚠️ Skipping: No MAL ID provided.`);
                continue;
            }
            // 3. Find the TMDB ID from Fribb's mapping using the MAL ID
            const mappingEntry = animeMapping.find(entry => Number(entry.mal_id) === Number(malId));
            if (!mappingEntry || !mappingEntry.themoviedb_id) {
                console.log(`[MAL Sync]    -> ❌ Skipping: No TMDB ID found in mapping for MAL ID ${malId}.`);
                continue;
            }
            const mapped = getMappedTmdbIdAndType(mappingEntry.themoviedb_id);
            if (!mapped) {
                console.log(`[MAL Sync]    -> ❌ Skipping: Invalid TMDB ID shape in mapping for MAL ID ${malId}.`);
                console.log('[MAL Sync]    -> Raw themoviedb_id value:', mappingEntry.themoviedb_id);
                continue;
            }
            const { id: tmdbId, type: itemType } = mapped;
            console.log(`[MAL Sync]    -> 🗺️ Mapped MAL ID ${malId} to TMDB ID ${tmdbId} (type: ${itemType})`);
            // 4. Check if this TMDB ID is already in the user's list in activity.db
            const alreadyInList = await new Promise((resolve) => {
                activityDb.get(
                    `SELECT id FROM user_list WHERE userUID = ? AND item_id = ?`,
                    [userUID, String(tmdbId)],
                    (err, row) => {
                        if (err) console.error(`[MAL Sync ActivityDB Error]:`, err.message);
                        resolve(row);
                    }
                );
            });
            if (alreadyInList) {
                console.log(`[MAL Sync]    -> ⏭️ Already in user_list (UID: ${userUID}, TMDB ID: ${tmdbId}, type: ${itemType})`);
                continue;
            }
            // 5. Insert into activity.db -> user_list
            await new Promise((resolve) => {
                activityDb.run(
                    `INSERT INTO user_list (userUID, item_id, item_type, added_at) VALUES (?, ?, ?, strftime('%s','now'))`,
                    [userUID, String(tmdbId), itemType],
                    (err) => {
                        if (err) console.error(`[MAL Sync Insert Error]:`, err.message);
                        resolve();
                    }
                );
            });
            console.log(`[MAL Sync]    -> 💾 Successfully added "${animeTitle}" (TMDB: ${tmdbId}) to your list!`);
            added++;
        }
        console.log(`\n[MAL Sync] Finished! Added ${added} new entries to user_list.`);
        console.log('=========================================\n');
        return { added };
    } catch (error) {
        console.error('[MAL Sync Error] Failed to download or ingest MAL list:', error.response?.data || error.message);
        return false;
    }
}
// =========================================
//  10. START SERVER (HTTPS with fallback to HTTP)
// =========================================
// Backend runs as plain HTTP bound to localhost only.
// TLS is terminated at the middleware layer (middleware.js on port 3000).
// Never expose port 4000 externally — keep it firewalled / localhost-only.
const PORT = parseInt(process.env.BACKEND_PORT || '4000', 10);
const server = app.listen(PORT, 'localhost', () => {
    console.log(`\n🔧 Backend API  →  http://localhost:${PORT}  (internal only)`);
    console.log(`📂 Reviews file location: ${reviewsPath}`);
    if (MIDDLEWARE_SECRET) {
        console.log('   Secret header enforcement: enabled');
    } else {
        console.log('   Secret header enforcement: disabled (set MIDDLEWARE_SECRET env var to enable)');
    }
});
