const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const dbPath = path.join(__dirname, 'anime_skip_cache.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('[AnimeSkipService] db error:', err.message);
    }
});

const GRAPHQL_URL = 'https://api.anime-skip.com/graphql';
const CLIENT_IDS = [
    'ZGfO0sMF3eCwLYf8yMSCJjlynwNGRXWE',
    'tvh1xhUhRkgXwXRLdqRkACJnX47gqDap',
    '2HvRtOKOdSlDHuDyjFSe9q0mEnXfuVJm'
];
const CACHE_STALE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function initDb() {
    db.serialize(() => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='anime_skip_shows'`, (err, row) => {
            if (err) {
                console.error('[AnimeSkipService] initDb error checking anime_skip_shows:', err.message);
                return;
            }

            if (!row) {
                db.run(`CREATE TABLE IF NOT EXISTS anime_skip_shows (
                    normalized_title TEXT PRIMARY KEY,
                    display_title TEXT NOT NULL,
                    anime_skip_show_id TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                )`);
                return;
            }

            db.all(`PRAGMA table_info(anime_skip_shows)`, (err2, columns) => {
                if (err2) {
                    console.error('[AnimeSkipService] initDb error inspecting anime_skip_shows:', err2.message);
                    return;
                }

                const hasNormalizedTitle = columns.some(col => col.name === 'normalized_title');
                const hasMalId = columns.some(col => col.name === 'mal_id');

                if (hasNormalizedTitle) {
                    return;
                }

                if (hasMalId) {
                    const legacyName = 'anime_skip_shows_legacy';
                    db.run(`ALTER TABLE anime_skip_shows RENAME TO ${legacyName}`);
                    db.run(`CREATE TABLE IF NOT EXISTS anime_skip_shows (
                        normalized_title TEXT PRIMARY KEY,
                        display_title TEXT NOT NULL,
                        anime_skip_show_id TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    )`);
                    console.log('[AnimeSkipService] Renamed legacy anime_skip_shows table to', legacyName);
                } else {
                    db.run(`CREATE TABLE IF NOT EXISTS anime_skip_shows (
                        normalized_title TEXT PRIMARY KEY,
                        display_title TEXT NOT NULL,
                        anime_skip_show_id TEXT NOT NULL,
                        updated_at INTEGER NOT NULL
                    )`);
                }
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS anime_skip_episodes (
            show_id TEXT NOT NULL,
            episode TEXT NOT NULL,
            anime_skip_episode_id TEXT NOT NULL,
            markers_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(show_id, episode)
        )`);
    });
}

function getAnimeSkipDbRow(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

function runAnimeSkipDb(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function buildEpisodeCacheKey(season, episode) {
    const s = String(season ?? '1').trim() || '1';
    const e = String(episode ?? '1').trim() || '1';
    return `${s}:${e}`;
}

function isCacheStale(updatedAt) {
    if (!Number.isFinite(Number(updatedAt))) return true;
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(updatedAt);
    return ageSeconds > 30 * 24 * 60 * 60;
}

function normalizeEpisodeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
}

function normalizeTitle(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function getCachedShowRow(normalizedTitle) {
    if (!normalizedTitle) return null;
    const row = await getAnimeSkipDbRow(
        `SELECT display_title, anime_skip_show_id, updated_at FROM anime_skip_shows WHERE normalized_title = ?`,
        [String(normalizedTitle)]
    );
    if (!row) return null;
    return {
        displayTitle: row.display_title,
        animeSkipShowId: row.anime_skip_show_id,
        updatedAt: Number(row.updated_at || 0)
    };
}

async function setCachedShowRow(normalizedTitle, displayTitle, animeSkipShowId) {
    if (!normalizedTitle || !animeSkipShowId) return;
    await runAnimeSkipDb(
        `INSERT INTO anime_skip_shows (normalized_title, display_title, anime_skip_show_id, updated_at)
         VALUES (?, ?, ?, strftime('%s','now'))
         ON CONFLICT(normalized_title) DO UPDATE SET
             display_title = COALESCE(NULLIF(excluded.display_title, ''), display_title),
             anime_skip_show_id = excluded.anime_skip_show_id,
             updated_at = excluded.updated_at`,
        [String(normalizedTitle), String(displayTitle || ''), String(animeSkipShowId)]
    );
}

async function fetchShowIdByTitle(title) {
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) return null;

    const query = `query SearchShows($search: String!) {
        searchShows(search: $search, limit: 5) {
            id
            name
            originalName
        }
    }`;

    try {
        const response = await queryGraphQL(query, { search: String(title).trim() });
        if (response?.errors) {
            console.warn('[AnimeSkipService] GraphQL searchShows errors:', response.errors);
            return null;
        }

        const shows = Array.isArray(response?.data?.searchShows) ? response.data.searchShows : [];
        if (!shows.length) return null;

        const exactName = shows.find(show => show?.name && normalizeTitle(show.name) === normalizedTitle);
        if (exactName) {
            return {
                showId: String(exactName.id),
                displayTitle: exactName.name || exactName.originalName || title
            };
        }

        const exactOriginal = shows.find(show => show?.originalName && normalizeTitle(show.originalName) === normalizedTitle);
        if (exactOriginal) {
            return {
                showId: String(exactOriginal.id),
                displayTitle: exactOriginal.originalName || exactOriginal.name || title
            };
        }

        const fallback = shows[0];
        return {
            showId: String(fallback.id),
            displayTitle: fallback.name || fallback.originalName || title
        };
    } catch (err) {
        console.warn('[AnimeSkipService] searchShows failed for title', title, err.message || err);
        return null;
    }
}

async function getShowIdForTitle(title) {
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) return null;

    const cached = await getCachedShowRow(normalizedTitle);
    if (cached && cached.animeSkipShowId) {
        return cached.animeSkipShowId;
    }

    const show = await fetchShowIdByTitle(title);
    if (!show?.showId) return null;

    await setCachedShowRow(normalizedTitle, show.displayTitle, show.showId);
    return show.showId;
}

function parseTimestamps(rawTimestamps) {
    if (!Array.isArray(rawTimestamps)) return [];
    return rawTimestamps
        .map(item => {
            if (!item) return null;
            const at = Number(item.at ?? item.atSeconds ?? item.atMs ?? item.start ?? item.time);
            if (!Number.isFinite(at)) return null;
            return {
                id: item.id ? String(item.id) : null,
                at: Math.max(0, Number(item.at)),
                type: item.type && typeof item.type === 'object'
                    ? String(item.type.name || item.type.id || item.type)
                    : item.type ? String(item.type) : null,
                raw: item
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.at - b.at);
}

async function fetchEpisodesByShowId(showId) {
    if (!showId) return [];
    const query = `query FindEpisodesByShowId($showId: ID!) {
        findEpisodesByShowId(showId: $showId) {
            id
            number
            season
            timestamps {
                id
                at
                type { id name }
            }
        }
    }`;
    try {
        const response = await queryGraphQL(query, { showId: String(showId) });
        if (response?.errors) {
            console.warn('[AnimeSkipService] GraphQL findEpisodesByShowId errors:', response.errors);
            return [];
        }
        return Array.isArray(response?.data?.findEpisodesByShowId) ? response.data.findEpisodesByShowId : [];
    } catch (err) {
        console.warn('[AnimeSkipService] findEpisodesByShowId failed:', err.message || err);
        return [];
    }
}

async function getCachedEpisodeRow(showId, season, episode) {
    if (!showId || !episode) return null;
    const key = buildEpisodeCacheKey(season, episode);
    const row = await getAnimeSkipDbRow(
        `SELECT anime_skip_episode_id, markers_json, updated_at FROM anime_skip_episodes WHERE show_id = ? AND episode = ?`,
        [String(showId), key]
    );
    if (!row) return null;
    try {
        return {
            episodeId: row.anime_skip_episode_id,
            markers: JSON.parse(row.markers_json || '[]'),
            updatedAt: Number(row.updated_at || 0)
        };
    } catch (err) {
        return null;
    }
}

async function setCachedEpisodeRow(showId, season, episode, animeSkipEpisodeId, markers) {
    if (!showId || !episode) return;
    const key = buildEpisodeCacheKey(season, episode);
    const payload = JSON.stringify(Array.isArray(markers) ? markers : []);
    await runAnimeSkipDb(
        `INSERT INTO anime_skip_episodes (show_id, episode, anime_skip_episode_id, markers_json, updated_at)
         VALUES (?, ?, ?, ?, strftime('%s','now'))
         ON CONFLICT(show_id, episode) DO UPDATE SET
             anime_skip_episode_id = excluded.anime_skip_episode_id,
             markers_json = excluded.markers_json,
             updated_at = excluded.updated_at`,
        [String(showId), key, String(animeSkipEpisodeId || ''), payload]
    );
}

async function cacheShowEpisodes(showId, episodes) {
    if (!showId || !Array.isArray(episodes)) return;
    const tasks = episodes.map(episode => {
        const season = episode?.season ?? 1;
        const number = episode?.number ?? episode?.absoluteNumber ?? episode?.id ?? '1';
        const markers = Array.isArray(episode?.timestamps) ? episode.timestamps : [];
        return setCachedEpisodeRow(showId, season, number, episode?.id, markers);
    });
    await Promise.all(tasks);
}

async function refreshShowEpisodesInBackground(showId) {
    if (!showId) return;
    try {
        const episodes = await fetchEpisodesByShowId(showId);
        if (episodes.length) {
            await cacheShowEpisodes(showId, episodes);
            console.log('[AnimeSkipService] refreshed episode markers for showId', showId);
        }
    } catch (err) {
        console.warn('[AnimeSkipService] background refresh failed for showId', showId, err.message || err);
    }
}

async function getAnimeSkipMarkers({ showId, season = 1, episode }) {
    if (!showId || !episode) return [];
    const cached = await getCachedEpisodeRow(showId, season, episode);
    console.log("[AnimeSkip] cached =", cached);
    if (cached && Array.isArray(cached.markers) && cached.markers.length) {
        if (isCacheStale(cached.updatedAt)) {
            setTimeout(() => {
                refreshShowEpisodesInBackground(showId).catch(err => console.warn('[AnimeSkipService] stale refresh error', err));
            }, 0);
        }
        return cached.markers;
    }

    const episodes = await fetchEpisodesByShowId(showId);
    console.log("[AnimeSkip] downloaded episodes =", episodes.length);

    if (episodes.length) {
        // console.log(
        //     "[AnimeSkip] first episode:",
        //     episodes[0].number,
        //     episodes[0].season,
        //     episodes[0].timestamps?.length
        // );
        console.table(
            episodes.map(e => ({
                season: e.season,
                number: e.number,
                timestamps: e.timestamps.length
            }))
        );
    }
    if (!episodes.length) {
        return [];
    }

    await cacheShowEpisodes(showId, episodes);
    const fresh = await getCachedEpisodeRow(showId, season, episode);
    return fresh ? fresh.markers : [];
}

async function queryGraphQL(query, variables = {}) {
    console.log('[AnimeSkipService] Sending GraphQL request to anime-skip:', GRAPHQL_URL);
    console.log('[AnimeSkipService] GraphQL query:', query);
    console.log('[AnimeSkipService] GraphQL variables:', variables);

    let lastError = null;

    for (const clientId of CLIENT_IDS) {
        try {
            const res = await axios.post(
                GRAPHQL_URL,
                { query, variables },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-client-id': clientId
                    },
                    timeout: 25000
                }
            );
            console.log('[AnimeSkipService] GraphQL response data:', res.data);
            return res.data;
        } catch (err) {
            lastError = err;
            console.warn('[AnimeSkipService] GraphQL request failed for client id', clientId, err.message || err);
            console.warn('[AnimeSkipService] GraphQL response status:', err.response?.status);
            console.warn('[AnimeSkipService] GraphQL response data:', err.response?.data);
        }
    }

    throw lastError || new Error('Unknown AnimeSkip GraphQL request error');
}

async function getAnimeSkipTimestamps({ title, season = 1, episode }) {
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle || !normalizeEpisodeNumber(episode)) {
        return [];
    }

    const showId = await getShowIdForTitle(title);
    console.log('[AnimeSkip] normalizedTitle =', normalizedTitle);
    console.log('[AnimeSkip] showId =', showId);
    if (!showId) {
        console.warn('[AnimeSkipService] No anime_skip show id found for title', title);
        return [];
    }
    console.log('[AnimeSkip] title =', title);
    console.log('[AnimeSkip] season =', season);
    console.log('[AnimeSkip] episode =', episode);
    return await getAnimeSkipMarkers({ showId, season, episode });
}

initDb();

module.exports = {
    getAnimeSkipTimestamps
};
