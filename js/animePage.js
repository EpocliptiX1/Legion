/**
 * animePage.js
 * Anime-mode toggle for indexMain.html
 * When active, replaces hero + content rows with TMDB anime discover data.
 */
(function () {
    'use strict';

    const TMDB_BASE = '/api/tmdb-proxy';
    const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
    const TMDB_BG = 'https://image.tmdb.org/t/p/original';

    // ── Poster cache: in-memory for same session, persisted to /api/poster-cache ──
    const _posterMemCache = new Map(); // key: title → cached TMDB entry object
    const _POSTER_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

    // ── TMDB API cache: memory + localStorage (for broader grid-card acceleration) ──
    const _tmdbMemCache = new Map(); // key: request path, value: { results, ts }
    const _TMDB_API_CACHE_KEY = 'anime_tmdb_api_cache_v1';
    const _TMDB_API_TTL = 6 * 60 * 60 * 1000; // 6 hours
    let _tmdbDiskCache = null;

    function normalizeTmdbResult(item) {
        if (!item || typeof item !== 'object') return null;
        return {
            id: item.id || null,
            name: item.name || null,
            title: item.title || null,
            original_name: item.original_name || null,
            original_language: item.original_language || null,
            first_air_date: item.first_air_date || null,
            release_date: item.release_date || null,
            vote_average: item.vote_average != null ? item.vote_average : null,
            overview: item.overview || '',
            poster_path: item.poster_path || null,
            backdrop_path: item.backdrop_path || null
        };
    }

    function loadTmdbDiskCache() {
        if (_tmdbDiskCache) return _tmdbDiskCache;
        try {
            _tmdbDiskCache = JSON.parse(localStorage.getItem(_TMDB_API_CACHE_KEY) || '{}') || {};
        } catch (e) {
            _tmdbDiskCache = {};
        }
        return _tmdbDiskCache;
    }

    function saveTmdbDiskCache() {
        try {
            localStorage.setItem(_TMDB_API_CACHE_KEY, JSON.stringify(_tmdbDiskCache || {}));
        } catch (e) {
            // If storage quota is exceeded, reset and continue without breaking page load.
            _tmdbDiskCache = {};
        }
    }

    let _posterWriteBuffer = [];
    let _posterFlushTimer = null;

    function makePosterKey(title, type = 'tv') {
        const normalizedTitle = String(title || '').trim().toLowerCase();
        return normalizedTitle ? `${normalizedTitle}::${type}` : '';
    }

    function buildPosterEntryFromTmdb(show, type = 'tv') {
        const title = (show?.name || show?.title || show?.original_name || '').trim();
        const key = makePosterKey(title, type);
        if (!key) return null;
        return {
            key,
            type,
            tmdb_id: show?.id || null,
            mal_id: null,
            name: show?.name || show?.title || null,
            poster_path: show?.poster_path || null,
            mal_poster: null,
            backdrop_path: show?.backdrop_path || null,
            vote_average: show?.vote_average != null ? show.vote_average : null,
            // Keep payload bounded so large cache batches don't exceed body limits.
            overview: show?.overview ? String(show.overview).slice(0, 420) : null,
            first_air_date: show?.first_air_date || show?.release_date || null
        };
    }

    async function flushPosterWriteBuffer() {
        const batch = _posterWriteBuffer.splice(0, _posterWriteBuffer.length);
        _posterFlushTimer = null;
        if (!batch.length) return;

        // Keep the latest version per key before write.
        const dedupMap = new Map();
        for (const entry of batch) {
            if (entry?.key) dedupMap.set(entry.key, entry);
        }
        const entries = Array.from(dedupMap.values());

        console.log(`[AnimeCache] flushing ${entries.length} deduped entries to backend (queued=${batch.length})`);

        const CHUNK_SIZE = 40;
        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            const chunk = entries.slice(i, i + CHUNK_SIZE);
            try {
                const r = await fetch('/api/poster-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entries: chunk })
                });
                const data = r.ok ? await r.json() : null;
                if (data?.saved != null) {
                    console.log(`[AnimeCache] saved chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${data.saved} entries)`);
                } else {
                    console.log(`[AnimeCache] failed chunk ${Math.floor(i / CHUNK_SIZE) + 1}`);
                }
            } catch (e) {
                console.log(`[AnimeCache] error on chunk ${Math.floor(i / CHUNK_SIZE) + 1}`);
            }
        }
    }

    function queuePosterEntriesFromTmdb(shows, type = 'tv', sourceTag = 'tmdb-row') {
        if (!Array.isArray(shows) || !shows.length) return;
        const entries = shows
            .map(show => buildPosterEntryFromTmdb(show, type))
            .filter(Boolean);
        if (!entries.length) return;

        _posterWriteBuffer.push(...entries);
        console.log(`[AnimeCache] queued ${entries.length} entries from ${sourceTag}`);

        if (_posterFlushTimer) return;
        _posterFlushTimer = setTimeout(() => {
            flushPosterWriteBuffer();
        }, 450);
    }

    // ── Mode helpers ──────────────────────────────────────────────
    function isAnimeMode() {
        return localStorage.getItem('animeMode') === 'true';
    }

    // Set global flag IMMEDIATELY (before DOMContentLoaded) so mainPageControls.js
    // can skip its fetchRow / initHero calls when anime mode is on.
    const _path = window.location.pathname;
    const _isMain = _path.includes('indexMain.html') || _path === '/' || _path.endsWith('/');
    const _isBrowse = _path.includes('indexBrowse.html');
    const _isAllMovies = _path.includes('allMovies.html');
    window.__animeMode = isAnimeMode() && (_isMain || _isBrowse || _isAllMovies);

    window.__toggleAnimeMode = function () {
        localStorage.setItem('animeMode', isAnimeMode() ? 'false' : 'true');
        if (_isMain || _isBrowse || _isAllMovies) {
            window.location.reload();
        } else {
            window.location.href = '/html/indexMain.html';
        }
    };

    // ── TMDB fetch helper ─────────────────────────────────────────
    async function tmdbFetch(path) {
        const now = Date.now();

        const mem = _tmdbMemCache.get(path);
        if (mem && (now - (mem.ts || 0)) < _TMDB_API_TTL && Array.isArray(mem.results)) {
            console.log(`[AnimeApiCache] memory hit ${path}`);
            return mem.results;
        }

        const disk = loadTmdbDiskCache();
        const diskEntry = disk[path];
        if (diskEntry && (now - (diskEntry.ts || 0)) < _TMDB_API_TTL && Array.isArray(diskEntry.results)) {
            _tmdbMemCache.set(path, { results: diskEntry.results, ts: diskEntry.ts || now });
            console.log(`[AnimeApiCache] disk hit ${path}`);
            return diskEntry.results;
        }

        try {
            const res = await fetch(`${TMDB_BASE}${path}`);
            if (!res.ok) return [];
            const data = await res.json();
            const results = Array.isArray(data.results)
                ? data.results.map(normalizeTmdbResult).filter(Boolean)
                : [];

            _tmdbMemCache.set(path, { results, ts: now });
            const cacheObj = loadTmdbDiskCache();
            cacheObj[path] = { results, ts: now };
            saveTmdbDiskCache();
            console.log(`[AnimeApiCache] network store ${path}`);

            return results;
        } catch (e) {
            console.error('[animePage] fetch error:', e);
            return [];
        }
    }

    async function fetchTmdbObject(path) {
        try {
            const res = await fetch(`${TMDB_BASE}${path}`);
            if (!res.ok) return null;
            const data = await res.json();
            return normalizeTmdbResult(data);
        } catch (err) {
            console.warn('[animePage] fetchTmdbObject failed:', err);
            return null;
        }
    }

    async function fetchTmdbItemById(tmdbId, preferredType = 'tv') {
        if (!tmdbId) return null;
        const order = preferredType === 'movie' ? ['movie', 'tv'] : ['tv', 'movie'];
        for (const type of order) {
            const item = await fetchTmdbObject(`/${type}/${tmdbId}?language=en-US`);
            if (item) return { ...item, type };
        }
        return null;
    }

    async function getAnimeBrowseHistoryTmdbIds() {
        if (!window.recommendationsSystem?.fetchActivityHistory) return [];
        try {
            const rows = await window.recommendationsSystem.fetchActivityHistory(20) || [];
            const animeRows = rows.filter(h => {
                const type = String(h?.item_type || '').toLowerCase();
                const genre = String(h?.genre || '').toLowerCase();
                return type === 'tv' || type === 'anime' || genre.includes('anime') || genre.includes('animation');
            });
            return [...new Set(animeRows.map(h => String(h.movie_id || '').trim()).filter(Boolean))];
        } catch (err) {
            return [];
        }
    }

    async function buildAnimeHeroFromRecommendations(lastTmdbId) {
        if (!lastTmdbId) return [];
        try {
            const response = await fetch(`/api/anime-recommendations?tmdbId=${encodeURIComponent(lastTmdbId)}`);
            if (!response.ok) return [];
            const body = await response.json();
            if (body.status !== 'ready' || !Array.isArray(body.recommendations)) return [];
            const shows = [];
            const seen = new Set();
            for (const rec of body.recommendations.slice(0, 12)) {
                const tmdbId = rec?.ID || rec?.tmdb_id || null;
                if (!tmdbId || seen.has(String(tmdbId))) continue;
                const show = await fetchTmdbItemById(tmdbId, 'tv');
                if (!show) continue;
                seen.add(String(tmdbId));
                shows.push(show);
                if (shows.length >= 8) break;
            }
            return shows;
        } catch (err) {
            return [];
        }
    }

    async function buildAnimeHeroFromMostPopularRow() {
        try {
            const items = await fetchAniListRow('MOST_POPULAR', 1, 8);
            if (!items.length) return [];

            const shows = [];
            const seen = new Set();
            for (const item of items) {
                const title = item.title?.english || item.title?.romaji || item.title?.native || '';
                const preferredType = /MOVIE|FILM/i.test(item.format || '') ? 'movie' : 'tv';
                const tmdbId = await getTmdbIdForAniList(
                    item.id,
                    title,
                    item.idMal || null,
                    item.title?.english || null,
                    item.title?.romaji || null,
                    item.title?.native || null
                );

                let show = tmdbId ? await fetchTmdbItemById(tmdbId, preferredType) : null;
                if (!show && title) {
                    const searchType = preferredType === 'movie' ? 'movie' : 'tv';
                    const results = await tmdbFetch(`/search/${searchType}?query=${encodeURIComponent(title)}&language=en-US`);
                    const match = (results || []).find(r => r.original_language === 'ja') || results?.[0];
                    if (match) show = { ...match, type: searchType };
                }

                if (!show || seen.has(String(show.id))) continue;
                seen.add(String(show.id));
                shows.push(show);
                if (shows.length >= 8) break;
            }
            return shows;
        } catch (err) {
            return [];
        }
    }

    const ANILIST_URL = 'https://graphql.anilist.co';

    async function anilistQuery(query, variables = {}) {
        const res = await fetch(ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        if (!res.ok) {
            throw new Error(`AniList returned ${res.status}`);
        }
        const json = await res.json();
        if (json.errors) {
            throw new Error(json.errors.map(err => err.message).join('; '));
        }
        return json.data;
    }

    async function fetchAniListRow(rowKey, page = 1, perPage = 24) {
        try {
            const res = await fetch(`/api/anime-row?rowKey=${encodeURIComponent(rowKey)}&page=${page}&perPage=${perPage}`);
            if (!res.ok) throw new Error(`Backend row fetch failed: ${res.status}`);
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn('[AniListRow] backend row fetch failed, falling back to AniList:', err.message || err);
            return [];
        }
    }

    async function fetchAniListTrending(page = 1, perPage = 24) {
        return fetchAniListRow('TRENDING', page, perPage);
    }

    async function renderAniListRow(rowId, rowKey) {
        const items = await fetchAniListRow(rowKey, 1, 18);
        const tmdbCounts = new Map();
        const rendered = [];

        for (const item of items) {
            const title = item.title?.romaji || item.title?.english || item.title?.native || '';
            const tmdbId = await getTmdbIdForAniList(
                item.id,
                title,
                item.idMal || null,
                item.title?.english || null,
                item.title?.romaji || null,
                item.title?.native || null
            );

            if (rowKey === 'KAIJU' && tmdbId != null) {
                const count = (tmdbCounts.get(tmdbId) || 0) + 1;
                tmdbCounts.set(tmdbId, count);
                if (count > 2) continue;
            }

            rendered.push(renderAniListGridCard(item, tmdbId));
        }

        return rendered.join('');
    }

    async function fetchAniListMedia(query, variables = {}) {
        const data = await anilistQuery(query, variables);
        return data?.Page?.media || [];
    }

    async function populateAniListRow(rowId, fetcher, renderItem) {
        const container = document.getElementById(rowId);
        if (!container) return;

        container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
        try {
            const items = await fetcher();
            container.innerHTML = items.length
                ? items.map(renderItem).join('')
                : '<p style="color:#888;padding:20px">Nothing found.</p>';
        } catch (err) {
            console.warn(`[AniListRow] ${rowId} failed:`, err);
            container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
        }
    }

    async function populateAniListHtmlRow(rowId, fetchHtml) {
        const container = document.getElementById(rowId);
        if (!container) return;

        container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
        try {
            const html = await fetchHtml();
            container.innerHTML = html && html.length
                ? html
                : '<p style="color:#888;padding:20px">Nothing found.</p>';
        } catch (err) {
            console.warn(`[AniListHtmlRow] ${rowId} failed:`, err);
            container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
        }
    }

    async function getTmdbIdForAniList(anilistId, title, malId = null, titleEnglish = null, titleRomaji = null, titleNative = null) {
        if (!anilistId) return null;
        try {
            const params = new URLSearchParams({ anilistId: String(anilistId) });
            if (title) params.set('title', String(title));
            if (titleEnglish) params.set('titleEnglish', String(titleEnglish));
            if (titleRomaji) params.set('titleRomaji', String(titleRomaji));
            if (titleNative) params.set('titleNative', String(titleNative));
            if (malId) params.set('malId', String(malId));

            const res = await fetch(`/api/anime-tmdb-id?${params.toString()}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.tmdb_id || null;
        } catch (err) {
            console.warn('[AniListTMDB] lookup failed:', err);
            return null;
        }
    }

    function stripHtml(text) {
        return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function renderAniListGridCard(item, tmdbId) {
        const title = escapeHtml(item.title?.english || item.title?.romaji || item.title?.native || 'Unknown');
        const poster = escapeHtml(item.coverImage?.extraLarge || '/img/LOGO_Short.png');
        const backdrop = escapeHtml(item.bannerImage || item.coverImage?.extraLarge || '');
        const year = item.startDate?.year ? String(item.startDate.year) : '----';
        const rating = item.averageScore != null ? (item.averageScore / 10).toFixed(1) : '--';
        const plot = escapeHtml(stripHtml(item.description || '')).substring(0, 130);
        const navTarget = tmdbId
            ? `/html/movieInfo.html?id=${tmdbId}&type=tv`
            : '#';
        const fallbackTitle = escapeHtml(item.title?.romaji || item.title?.english || item.title?.native || '');

        return `
            <div class="grid-card"
                 data-id="${tmdbId || ''}"
                 data-title="${title}"
                 data-year="${year}"
                 data-runtime="TV Series"
                 data-rating="${rating}"
                 data-plot="${plot}"
                 data-row-bg="${backdrop}"
                 data-type="tv"
                 onmouseenter="handleCardHover(this)"
                 onmouseleave="handleCardLeave(this)"
                 onclick="${tmdbId ? `window.location.href='${navTarget}'` : `navigateToAnimeByTitle('${fallbackTitle.replace(/'/g, "\\'")}');`}">
                ${rating !== '--' ? `<span class="card-rating-badge"><span style="color:#f5c518;font-size:0.75rem">★</span>${rating}</span>` : ''}
                <img src="${poster}" loading="lazy" alt="${title}" onclick="${tmdbId ? `window.location.href='${navTarget}'` : `navigateToAnimeByTitle('${fallbackTitle.replace(/'/g, "\\'")}');`}" onerror="this.src='/img/LOGO_Short.png'">
                <div class="card-title-label">
                    <div class="card-title-name">${title}</div>
                    <div class="card-title-tag">Anime</div>
                </div>
                <div class="card-hover-info">
                    <div class="hover-preview">
                        <iframe class="card-trailer" title="Trailer"
                                frameborder="0"
                                allow="autoplay; encrypted-media" allowfullscreen></iframe>
                    </div>
                    <div class="hover-meta">
                        <div class="hover-meta-title">${title}</div>
                        <div class="hover-meta-stats">
                            <span>⭐ ${rating}</span>
                            <span>${year}</span>
                            <span>TV Series</span>
                        </div>
                        <p class="hover-meta-desc">${plot}</p>
                        <div class="hover-meta-actions">
                            <button class="hover-play" onclick="${tmdbId ? `window.location.href='${navTarget}'` : `navigateToAnimeByTitle('${fallbackTitle.replace(/'/g, "\\'")}');`}">▶</button>
                            <a class="hover-info" href="${navTarget}" ${tmdbId ? '' : `onclick="navigateToAnimeByTitle('${fallbackTitle.replace(/'/g, "\\'")}'); return false;"`}>More Info</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderAniListPreviewCard(item) {
        const image = escapeHtml(item.coverImage?.extraLarge || '');
        const title = escapeHtml(item.title?.english || item.title?.romaji || item.title?.native || 'Unknown');
        return `
            <div style="width:180px; margin-right:12px;">
                <img src="${image}" style="width:100%; border-radius: 10px;" loading="lazy" alt="${title}">
                <p style="margin:8px 0 0; font-size:0.9rem; line-height:1.2;">${title}</p>
            </div>
        `;
    }

    function escapeHtml(text) {
        return String(text || '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    // ── Anime card HTML (matches grid-card structure) ─────────────
    function animeCard(show, type = 'tv') {
        const title = (show.name || show.title || show.original_name || 'Unknown').replace(/"/g, '&quot;');
        const year = (show.first_air_date || show.release_date || '----').slice(0, 4);
        const rating = show.vote_average ? show.vote_average.toFixed(1) : '--';
        const plot = (show.overview || 'No plot summary available.').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const poster = show.poster_path ? `${TMDB_IMG}${show.poster_path}` : '/img/LOGO_Short.png';
        const backdrop = show.backdrop_path
            ? `${TMDB_BG}${show.backdrop_path}`
            : (show.poster_path ? `${TMDB_BG}${show.poster_path}` : poster);
        const href = `/html/movieInfo.html?id=${show.id}&type=${type}`;

        return `
            <div class="grid-card"
                 data-id="${show.id}"
                 data-title="${title}"
                 data-year="${year}"
                 data-runtime="${type === 'movie' ? 'Anime Film' : 'TV Series'}"
                 data-rating="${rating}"
                 data-plot="${plot}"
                 data-row-bg="${backdrop}"
                 data-type="${type}"
                 onmouseenter="handleCardHover(this)"
                 onmouseleave="handleCardLeave(this)">
                ${rating !== '--' ? `<span class="card-rating-badge"><span style="color:#f5c518;font-size:0.75rem">★</span>${rating}</span>` : ''}
                <img src="${poster}" loading="lazy"
                     onclick="window.location.href='${href}'"
                     onerror="this.src='/img/LOGO_Short.png'">
                <div class="card-title-label">
                    <div class="card-title-name">${title}</div>
                    <div class="card-title-tag">${type === 'movie' ? 'Anime Film' : 'Anime'}</div>
                </div>
                <div class="card-hover-info">
                    <div class="hover-preview">
                        <iframe class="card-trailer" title="Trailer"
                                frameborder="0"
                                allow="autoplay; encrypted-media" allowfullscreen></iframe>
                    </div>
                    <div class="hover-meta">
                        <div class="hover-meta-title">${title}</div>
                        <div class="hover-meta-stats">
                            <span>⭐ ${rating}</span>
                            <span>${year}</span>
                            <span>TV Series</span>
                        </div>
                        <p class="hover-meta-desc">${(show.overview || '').substring(0, 130)}</p>
                        <div class="hover-meta-actions">
                            <button class="hover-play" onclick="window.location.href='${href}'">▶</button>
                            <a class="hover-info" href="${href}">More Info</a>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // ── Append a row section to #subSec ──────────────────────────
    function addRow(containerId, label) {
        const main = document.getElementById('subSec');
        if (!main) return null;
        const widgets = main.querySelector('.home-widgets-area');
        const sec = document.createElement('section');
        sec.className = 'row anime-spawned-row';
        sec.innerHTML = `<div class="anime-row-bg anime-row-bg-a active"></div>
                         <div class="anime-row-bg anime-row-bg-b"></div>
                         <div class="row-header">
                             <h2 class="row-title">${label}</h2>
                             <div class="row-arrows">
                                 <button class="row-arrow-btn" onclick="scrollRow('${containerId}',-1)">&#8249;</button>
                                 <button class="row-arrow-btn" onclick="scrollRow('${containerId}',1)">&#8250;</button>
                             </div>
                         </div>
                         <div class="horizontal-scroll-row" id="${containerId}"></div>`;
        if (widgets) main.insertBefore(sec, widgets);
        else main.appendChild(sec);
        return document.getElementById(containerId);
    }

    function setAnimeRowBackground(section, imageUrl) {
        if (!section || !imageUrl) return;
        const layerA = section.querySelector('.anime-row-bg-a');
        const layerB = section.querySelector('.anime-row-bg-b');
        if (!layerA || !layerB) return;

        const current = section.dataset.activeBgLayer === 'b' ? layerB : layerA;
        const next = current === layerA ? layerB : layerA;
        const currentBg = current.style.backgroundImage;
        const nextBg = `url('${imageUrl}')`;

        if (currentBg === nextBg) return;

        next.style.backgroundImage = nextBg;
        next.classList.add('active');
        current.classList.remove('active');
        section.dataset.activeBgLayer = current === layerA ? 'b' : 'a';
    }

    function patchAnimeRowHoverBackgrounds() {
        const originalHover = window.handleCardHover;
        if (typeof originalHover !== 'function' || window.__animeRowHoverPatched) return;

        window.handleCardHover = async function(card) {
            if (card) {
                const section = card.closest('.anime-spawned-row');
                const bg = card.dataset.rowBg;
                if (section && bg) setAnimeRowBackground(section, bg);
            }
            return originalHover.call(this, card);
        };

        window.__animeRowHoverPatched = true;
    }

    function scheduleAnimeRowLoad(rowTasks, eagerCount = 2) {
        if (!Array.isArray(rowTasks) || !rowTasks.length) return;

        const runTask = (task) => {
            if (!task || typeof task.load !== 'function') return;
            if (task.loaded) return;
            task.loaded = true;
            task.load();
        };

        rowTasks.slice(0, eagerCount).forEach(runTask);

        const lazyTasks = rowTasks.slice(eagerCount);
        if (!lazyTasks.length) return;

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const task = lazyTasks.find(t => t.target === entry.target);
                    if (task) runTask(task);
                    obs.unobserve(entry.target);
                });
            }, { root: null, rootMargin: '240px 0px', threshold: 0.1 });

            lazyTasks.forEach(task => {
                if (task.target) observer.observe(task.target);
            });
            return;
        }

        // Fallback for older browsers.
        lazyTasks.forEach((task, idx) => {
            setTimeout(() => runTask(task), idx * 140);
        });
    }

    // ── Hero management ───────────────────────────────────────────
    let animeHeroList = [];
    let animeHeroIdx = 0;

    function renderAnimeHero(show) {
        const content = document.querySelector('.hero-content');
        if (content) content.style.opacity = '0';

        setTimeout(() => {
            const title = show.name || show.original_name || '';
            const rating = show.vote_average ? show.vote_average.toFixed(1) : '--';
            const year = (show.first_air_date || '----').slice(0, 4);

            const titleEl  = document.getElementById('heroTitle');
            const ratingEl = document.getElementById('statRating');
            const dateEl   = document.getElementById('statDate');
            const runtimeEl= document.getElementById('statRuntime');
            const descEl   = document.getElementById('heroDesc');

            if (titleEl) {
                titleEl.innerText = title;
                titleEl.classList.remove('hero-title-clamped');
                titleEl.style.maxHeight = '';
                const parent = titleEl.parentElement;
                if (parent) {
                    const maxAllowed = parent.getBoundingClientRect().height * 0.4;
                    const titleHeight = titleEl.getBoundingClientRect().height;
                    if (maxAllowed > 0 && titleHeight > maxAllowed) {
                        titleEl.classList.add('hero-title-clamped');
                    }
                }
            }
            if (ratingEl)  ratingEl.innerText  = rating;
            if (dateEl)    dateEl.innerText     = year;
            if (runtimeEl) runtimeEl.innerText = 'TV Series';
            if (descEl)    descEl.innerText     = show.overview || '';

            const heroPosterImg = document.getElementById('heroPosterImg');
            if (heroPosterImg) {
                if (show.poster_path) {
                    heroPosterImg.src = `https://image.tmdb.org/t/p/w500${show.poster_path}`;
                    heroPosterImg.style.display = 'block';
                } else {
                    heroPosterImg.style.display = 'none';
                }
            }

            if (content) content.style.opacity = '1';

            // Update slider dots
            const dotsEl = document.getElementById('sliderDots');
            if (dotsEl) {
                dotsEl.innerHTML = animeHeroList.map((_, i) =>
                    `<span class="dot${i === animeHeroIdx ? ' active' : ''}" onclick="window.__animeGoTo(${i})"></span>`
                ).join('');
            }

            // Load trailer — use TMDB ID directly since we already have it
            const iframe = document.getElementById('heroTrailerFrame');
            if (iframe) {
                const videosUrl = `/api/tmdb-proxy/tv/${show.id}/videos?language=en-US`;
                fetch(videosUrl)
                    .then(r => r.json())
                    .then(data => {
                        const trailers = (data.results || []).filter(v => v.site === 'YouTube');
                        const lowData = localStorage.getItem('lowDataMode') === 'true';
                        const usedTrailers = new Set();

                        const playTrailer = (candidate) => {
                            if (!candidate || lowData) {
                                return skipTrailer();
                            }
                            if (typeof window.setHeroTrailerSource === 'function') {
                                window.setHeroTrailerSource(
                                    iframe,
                                    candidate.key,
                                    () => {
                                        if (typeof window.nextSlide === 'function') window.nextSlide();
                                    },
                                    () => {
                                        usedTrailers.add(candidate.key);
                                        const nextCandidate = trailers.find(t => t.site === 'YouTube' && !usedTrailers.has(t.key));
                                        if (nextCandidate) {
                                            playTrailer(nextCandidate);
                                        } else {
                                            skipTrailer();
                                        }
                                    }
                                );
                            } else {
                                iframe.src = `https://www.youtube.com/embed/${candidate.key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${candidate.key}&rel=0`;
                            }
                        };

                        const skipTrailer = () => {
                            if (typeof window.setHeroTrailerSource === 'function') {
                                window.setHeroTrailerSource(iframe, '', null);
                            } else {
                                iframe.src = '';
                            }
                            const nextIdx = (animeHeroIdx + 1) % animeHeroList.length;
                            if (nextIdx !== animeHeroIdx) {
                                setTimeout(() => {
                                    animeHeroIdx = nextIdx;
                                    renderAnimeHero(animeHeroList[animeHeroIdx]);
                                }, 800);
                            }
                        };

                        const primaryTrailer = trailers.find(v => v.type === 'Trailer') || trailers[0];
                        playTrailer(primaryTrailer);
                    })
                    .catch(() => { iframe.src = ''; });
            }
        }, 300);
    }

    // Override slider controls
    function patchSlider() {
        window.nextSlide = function () {
            if (!animeHeroList.length) return;
            animeHeroIdx = (animeHeroIdx + 1) % animeHeroList.length;
            renderAnimeHero(animeHeroList[animeHeroIdx]);
        };
        window.prevSlide = function () {
            if (!animeHeroList.length) return;
            animeHeroIdx = (animeHeroIdx - 1 + animeHeroList.length) % animeHeroList.length;
            renderAnimeHero(animeHeroList[animeHeroIdx]);
        };
        window.__animeGoTo = function (idx) {
            animeHeroIdx = idx;
            renderAnimeHero(animeHeroList[animeHeroIdx]);
        };

        // Play button → go to anime info page
        window.openMovie = async function () {
            const show = animeHeroList[animeHeroIdx];
            if (show) window.location.href = `/html/movieInfo.html?id=${show.id}&type=${show.type || 'tv'}`;
        };

        // "More Info" button → also go to anime info page
        window.openRedirectModal = function () {
            const show = animeHeroList[animeHeroIdx];
            if (show) window.location.href = `/html/movieInfo.html?id=${show.id}&type=${show.type || 'tv'}`;
        };
    }

    // ── Main anime mode loader ────────────────────────────────────
    async function loadAnimeMode() {
        document.title = 'Legion Space | Anime Hub';

        // Hero tag
        const heroTag = document.getElementById('heroTag');
        if (heroTag) heroTag.textContent = 'Trending Anime';

        // Rename "Most Recent" → "Currently Airing"
        const rowNewest = document.getElementById('rowNewest');
        if (rowNewest) {
            const sec = rowNewest.closest('section.row');
            if (sec) {
                const h2 = sec.querySelector('.row-title');
                if (h2) h2.textContent = 'Currently Airing';
            }
        }

        // Base filter shared by all rows (animation genre + Japanese language)
        const BASE = 'with_genres=16&with_original_language=ja&without_genres=10762,10751';

        // Row definitions — each uses its own genre (no AND combination to maximise results)
        const rowDefs = [
            {
                id: 'animeRowPopular',
                label: 'Popular Anime',
                anilistKey: 'TRENDING'
            }
            // {
            //     id: 'animeRowTopRated',
            //     label: 'Top Rated',
            //     path: `/discover/tv?${BASE}&vote_count.gte=200&sort_by=vote_average.desc`
            // },
            // {
            //     id: 'animeRowRomance',
            //     label: 'Romance',
            //     path: `/discover/tv?with_genres=10749&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc`
            // },
            // {
            //     id: 'animeRowScifi',
            //     label: 'Sci-Fi & Fantasy',
            //     path: `/discover/tv?with_genres=10765&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc`
            // },
            // {
            //     id: 'animeRowComedy',
            //     label: 'Comedy',
            //     path: `/discover/tv?with_genres=35&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc`
            // }
        ];

        // Load "Currently Airing" — TV anime + mix in popular anime films
        if (rowNewest) {
            const airingPath = `/discover/tv?${BASE}&vote_count.gte=50&first_air_date.gte=2022-01-01&sort_by=popularity.desc`;
            const filmPath = `/discover/movie?with_genres=16&with_original_language=ja&vote_count.gte=100&sort_by=popularity.desc`;
            const [airing, films] = await Promise.all([tmdbFetch(airingPath), tmdbFetch(filmPath)]);
            queuePosterEntriesFromTmdb(airing, 'tv', 'animeMode-rowNewest-airing');
            queuePosterEntriesFromTmdb(films, 'movie', 'animeMode-rowNewest-films');
            // Interleave: 3 TV shows then 1 film, so films are sprinkled throughout
            const mixed = [];
            let fi = 0;
            for (let i = 0; i < airing.length; i++) {
                mixed.push(animeCard(airing[i], 'tv'));
                if ((i + 1) % 3 === 0 && fi < films.length) mixed.push(animeCard(films[fi++], 'movie'));
            }
            while (fi < films.length) mixed.push(animeCard(films[fi++], 'movie'));
            rowNewest.innerHTML = mixed.length ? mixed.join('') : '<p style="color:#888;padding:20px">Nothing found.</p>';
        }

        // Inject rows and load them on demand while scrolling.
        const rowTasks = [];
        for (const def of rowDefs) {
            const container = addRow(def.id, def.label);
            if (container) {
                const section = container.closest('section.row') || container;
                container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
                rowTasks.push({
                    target: section,
                    loaded: false,
                    load: () => {
                        container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                        if (def.anilistKey) {
                            renderAniListRow(def.id, def.anilistKey).then(html => {
                                container.innerHTML = html.length
                                    ? html
                                    : '<p style="color:#888;padding:20px">Nothing found.</p>';
                            }).catch(err => {
                                console.warn('[AniListRow] ' + def.id + ' failed:', err);
                                container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                            });
                        } else {
                            tmdbFetch(def.path).then(shows => {
                                queuePosterEntriesFromTmdb(shows, 'tv', 'animeMode-' + def.id);
                                if (section && shows.length) {
                                    const first = shows[0];
                                    const bg = first.backdrop_path
                                        ? '${TMDB_BG}' + first.backdrop_path
                                        : (first.poster_path ? '${TMDB_BG}' + first.poster_path : '');
                                    if (bg) setAnimeRowBackground(section, bg);
                                }
                                container.innerHTML = shows.length
                                    ? shows.map(s => animeCard(s, 'tv')).join('')
                                    : '<p style="color:#888;padding:20px">Nothing found.</p>';
                            });
                        }
                    }
                });
            }
        }
        scheduleAnimeRowLoad(rowTasks, 1);

        patchAnimeRowHoverBackgrounds();

        // Load hero using history-based recommendations first, then AniList cache, then TMDB discover.
        let heroShows = [];
        const historyIds = await getAnimeBrowseHistoryTmdbIds();
        if (historyIds.length > 0) {
            heroShows = await buildAnimeHeroFromRecommendations(historyIds[0]);
            if (heroShows.length > 0 && heroTag) {
                heroTag.textContent = 'Recommended from your last watched anime';
            }
        }

        if (heroShows.length === 0) {
            heroShows = await buildAnimeHeroFromMostPopularRow();
            if (heroShows.length > 0 && heroTag) {
                heroTag.textContent = 'Popular Anime';
            }
        }

        if (heroShows.length === 0) {
            heroShows = await tmdbFetch(`/discover/tv?${BASE}&vote_count.gte=50&sort_by=popularity.desc`);
            if (heroShows.length > 0 && heroTag) {
                heroTag.textContent = 'Trending Anime';
            }
        }

        animeHeroList = heroShows.slice(0, 8);
        if (animeHeroList.length > 0) {
            renderAnimeHero(animeHeroList[0]);
            patchSlider();
        }

        // Move static marketing sections to bottom of #subSec
        const subSec = document.getElementById('subSec');
        if (subSec) {
            ['introSection', 'featureSection', 'roadmapSection',
             'ctaStrip', 'adSection', 'aboutSection'].forEach(id => {
                const el = document.getElementById(id);
                if (el) subSec.appendChild(el);
            });
        }
    }

    // ── Browse-page anime loader (uses existing indexBrowse row IDs) ──────
    async function loadAnimeBrowse() {
        document.title = 'Legion Space | Anime Browse';

        const heroTag = document.getElementById('heroTag');
        if (heroTag) heroTag.textContent = '⛩ Anime Picks';

        // Hide movie-only personal rows; MAL/Jikan will populate the rest
        ['topAiringSection'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const BASE = 'with_genres=16&with_original_language=ja&without_genres=10762,10751';
        const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);

        // Map existing browse row IDs → anime TMDB queries + new labels
        const rowMap = [
            { id: 'rowTrending',   label: 'Top Rated Anime',      path: `/discover/tv?${BASE}&vote_count.gte=200&sort_by=vote_average.desc` },
            { id: 'rowPopular',    label: 'Popular Anime',        anilistKey: 'MOST_POPULAR' },
            { id: 'rowNewest',     label: 'Currently Airing',     path: `/discover/tv?${BASE}&vote_count.gte=50&first_air_date.gte=2022-01-01&sort_by=popularity.desc`, mixFilms: true },
            { id: 'rowAction',     label: 'Action & Adventure',   path: `/discover/tv?with_genres=10759&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowDrama',      label: 'Drama',                path: `/discover/tv?with_genres=18&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowComedy',     label: 'Comedy',               path: `/discover/tv?with_genres=35&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowSciFi',      label: 'Sci-Fi & Fantasy',     path: `/discover/tv?with_genres=10765&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowThriller',   label: 'Horror & Mystery',     path: `/discover/tv?with_genres=9648&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowAnimation',  label: 'Anime Films',          path: `/discover/movie?with_genres=16&with_original_language=ja&vote_count.gte=50&sort_by=popularity.desc`, type: 'movie' },
            { id: 'rowAdventure',  label: 'Isekai & Fantasy',     path: `/discover/tv?with_keywords=210024&with_original_language=ja&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowRomance',    label: 'Romance',              path: `/discover/tv?with_genres=10749&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowCrime',      label: 'Crime & Underworld',   path: `/discover/tv?with_genres=80&with_original_language=ja&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowHorror',     label: 'Dark & Horror',        path: `/discover/movie?with_genres=27&with_original_language=ja&vote_count.gte=20&sort_by=popularity.desc`, type: 'movie' },
            { id: 'rowMystery',    label: 'Mystery & Mind Games', path: `/discover/tv?with_genres=9648&with_original_language=ja&vote_count.gte=20&sort_by=popularity.desc` },
            { id: 'rowFantasy',    label: 'Fantasy Worlds',       path: `/discover/tv?with_genres=10765&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc&page=2` },
            { id: 'rowFamily',     label: 'Feel-Good Anime',      path: `/discover/tv?with_genres=35&with_original_language=ja&without_genres=10762,10751&vote_count.gte=20&sort_by=popularity.desc&page=2` },
            { id: 'rowRecentHits', label: 'Modern Anime Hits',    path: `/discover/tv?${BASE}&vote_count.gte=50&first_air_date.gte=2018-01-01&sort_by=vote_average.desc` },
            { id: 'rowHiddenGems', label: 'Hidden Gems',          path: `/discover/tv?${BASE}&vote_count.gte=20&vote_average.gte=7.5&sort_by=vote_count.asc` },
            { id: 'rowLongest',    label: 'Long-Running Series',  path: `/discover/tv?${BASE}&vote_count.gte=100&sort_by=vote_count.desc` },
            { id: 'rowGrossing',   label: 'All-Time Classics',    path: `/discover/tv?${BASE}&first_air_date.lte=2010-01-01&vote_count.gte=200&sort_by=vote_average.desc` },
            { id: 'rowBinge',      label: 'Binge-Worthy',         path: `/discover/tv?${BASE}&vote_count.gte=50&sort_by=popularity.desc&page=2` },
        ];

        const visibleRowIds = new Set(rowMap.map(def => def.id));
        document.querySelectorAll('section.row[data-browse-discovery="true"]').forEach(section => {
            const container = section.querySelector('.horizontal-scroll-row[id]');
            if (!container) return;
            if (visibleRowIds.has(container.id) || section.classList.contains('specialVisibilityExpemption')) {
                section.style.display = '';
            } else {
                section.style.display = 'none';
            }
        });

        const rowTasks = [];
        for (const def of rowMap) {
            const container = document.getElementById(def.id);
            if (!container) continue;
            const section = container.closest('section.row');
            if (section) {
                const h2 = section.querySelector('.row-title');
                if (h2) h2.textContent = def.label;
                section.style.display = '';
            }
            container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || container,
                loaded: false,
                load: () => {
                    container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    if (def.anilistKey) {
                        renderAniListRow(def.id, def.anilistKey).then(html => {
                            container.innerHTML = html.length
                                ? html
                                : '<p style="color:#888;padding:20px">Nothing found.</p>';
                        }).catch(err => {
                            console.warn(`[AniListRow] ${def.id} failed:`, err);
                            container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                        });
                    } else if (def.mixFilms) {
                        // Interleave TV anime + anime films
                        const filmPath = `/discover/movie?with_genres=16&with_original_language=ja&vote_count.gte=100&sort_by=popularity.desc`;
                        Promise.all([tmdbFetch(def.path), tmdbFetch(filmPath)]).then(([shows, films]) => {
                            queuePosterEntriesFromTmdb(shows, 'tv', `${def.id}-airing`);
                            queuePosterEntriesFromTmdb(films, 'movie', `${def.id}-films`);
                            const mixed = [];
                            let fi = 0;
                            for (let i = 0; i < shows.length; i++) {
                                mixed.push(animeCard(shows[i], 'tv'));
                                if ((i + 1) % 3 === 0 && fi < films.length) mixed.push(animeCard(films[fi++], 'movie'));
                            }
                            while (fi < films.length) mixed.push(animeCard(films[fi++], 'movie'));
                            container.innerHTML = mixed.length ? mixed.join('') : '<p style="color:#888;padding:20px">Nothing found.</p>';
                        });
                    } else {
                        tmdbFetch(def.path).then(shows => {
                            const cardType = def.type || 'tv';
                            queuePosterEntriesFromTmdb(shows, cardType, def.id);
                            container.innerHTML = shows.length
                                ? shows.map(s => animeCard(s, cardType)).join('')
                                : '<p style="color:#888;padding:20px">Nothing found.</p>';
                        });
                    }
                }
            });
        }

        populateAniListHtmlRow('rowTrendingNow', () => renderAniListRow('rowTrendingNow', 'TRENDING'));
        populateAniListHtmlRow('rowRisingThisSeason', () => renderAniListRow('rowRisingThisSeason', 'RISING_THIS_SEASON'));
        populateAniListHtmlRow('rowHighestRated', () => renderAniListRow('rowHighestRated', 'HIGHEST_RATED'));
        populateAniListHtmlRow('rowMostPopular', () => renderAniListRow('rowMostPopular', 'MOST_POPULAR'));
        populateAniListHtmlRow('rowCurrentlyAiring', () => renderAniListRow('rowCurrentlyAiring', 'CURRENTLY_AIRING'));
        populateAniListHtmlRow('rowUpcomingNextSeason', () => renderAniListRow('rowUpcomingNextSeason', 'UPCOMING_NEXT_SEASON'));

        const action2Container = document.getElementById('rowAction2');
        if (action2Container) {
            const section = action2Container.closest('section.row');
            if (section) section.style.display = '';
            action2Container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || action2Container,
                loaded: false,
                load: async () => {
                    action2Container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowAction2', 'ACTION');
                        action2Container.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowAction2 failed:', err);
                        action2Container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const comedy2Container = document.getElementById('rowComedy2');
        if (comedy2Container) {
            const section = comedy2Container.closest('section.row');
            if (section) section.style.display = '';
            comedy2Container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || comedy2Container,
                loaded: false,
                load: async () => {
                    comedy2Container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowComedy2', 'COMEDY');
                        comedy2Container.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowComedy2 failed:', err);
                        comedy2Container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const romance2Container = document.getElementById('rowRomance2');
        if (romance2Container) {
            const section = romance2Container.closest('section.row');
            if (section) section.style.display = '';
            romance2Container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || romance2Container,
                loaded: false,
                load: async () => {
                    romance2Container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowRomance2', 'ROMANCE');
                        romance2Container.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowRomance2 failed:', err);
                        romance2Container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const drama2Container = document.getElementById('rowDrama2');
        if (drama2Container) {
            const section = drama2Container.closest('section.row');
            if (section) section.style.display = '';
            drama2Container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || drama2Container,
                loaded: false,
                load: async () => {
                    drama2Container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowDrama2', 'DRAMA');
                        drama2Container.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowDrama2 failed:', err);
                        drama2Container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const sciFi2Container = document.getElementById('rowSciFi2');
        if (sciFi2Container) {
            const section = sciFi2Container.closest('section.row');
            if (section) section.style.display = '';
            sciFi2Container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || sciFi2Container,
                loaded: false,
                load: async () => {
                    sciFi2Container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowSciFi2', 'SCI_FI');
                        sciFi2Container.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowSciFi2 failed:', err);
                        sciFi2Container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const sliceOfLifeContainer = document.getElementById('rowSliceOfLife');
        if (sliceOfLifeContainer) {
            const section = sliceOfLifeContainer.closest('section.row');
            if (section) section.style.display = '';
            sliceOfLifeContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || sliceOfLifeContainer,
                loaded: false,
                load: async () => {
                    sliceOfLifeContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowSliceOfLife', 'SLICE_OF_LIFE');
                        sliceOfLifeContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowSliceOfLife failed:', err);
                        sliceOfLifeContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const supernaturalContainer = document.getElementById('rowSupernatural');
        if (supernaturalContainer) {
            const section = supernaturalContainer.closest('section.row');
            if (section) section.style.display = '';
            supernaturalContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || supernaturalContainer,
                loaded: false,
                load: async () => {
                    supernaturalContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowSupernatural', 'SUPERNATURAL');
                        supernaturalContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowSupernatural failed:', err);
                        supernaturalContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const mechaContainer = document.getElementById('rowMecha');
        if (mechaContainer) {
            const section = mechaContainer.closest('section.row');
            if (section) section.style.display = '';
            mechaContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || mechaContainer,
                loaded: false,
                load: async () => {
                    mechaContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowMecha', 'MECHA');
                        mechaContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowMecha failed:', err);
                        mechaContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const horror2Container = document.getElementById('rowHorror2');
        if (horror2Container) {
            const section = horror2Container.closest('section.row');
            if (section) section.style.display = '';
            horror2Container.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || horror2Container,
                loaded: false,
                load: async () => {
                    horror2Container.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowHorror2', 'HORROR');
                        horror2Container.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowHorror2 failed:', err);
                        horror2Container.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const psychologicalContainer = document.getElementById('rowPsychological');
        if (psychologicalContainer) {
            const section = psychologicalContainer.closest('section.row');
            if (section) section.style.display = '';
            psychologicalContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || psychologicalContainer,
                loaded: false,
                load: async () => {
                    psychologicalContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowPsychological', 'PSYCHOLOGICAL');
                        psychologicalContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowPsychological failed:', err);
                        psychologicalContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const isekaiContainer = document.getElementById('rowIsekai');
        if (isekaiContainer) {
            const section = isekaiContainer.closest('section.row');
            if (section) section.style.display = '';
            isekaiContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || isekaiContainer,
                loaded: false,
                load: async () => {
                    isekaiContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowIsekai', 'ISEKAI');
                        isekaiContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowIsekai failed:', err);
                        isekaiContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const kaijuContainer = document.getElementById('rowKaiju');
        if (kaijuContainer) {
            const section = kaijuContainer.closest('section.row');
            if (section) section.style.display = '';
            kaijuContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || kaijuContainer,
                loaded: false,
                load: async () => {
                    kaijuContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowKaiju', 'KAIJU');
                        kaijuContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowKaiju failed:', err);
                        kaijuContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const moviesContainer = document.getElementById('rowMovies');
        if (moviesContainer) {
            const section = moviesContainer.closest('section.row');
            if (section) section.style.display = '';
            moviesContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || moviesContainer,
                loaded: false,
                load: async () => {
                    moviesContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowMovies', 'MOVIES');
                        moviesContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowMovies failed:', err);
                        moviesContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const ovasContainer = document.getElementById('rowOVAs');
        if (ovasContainer) {
            const section = ovasContainer.closest('section.row');
            if (section) section.style.display = '';
            ovasContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || ovasContainer,
                loaded: false,
                load: async () => {
                    ovasContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowOVAs', 'OVAS');
                        ovasContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowOVAs failed:', err);
                        ovasContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        const onasContainer = document.getElementById('rowONAs');
        if (onasContainer) {
            const section = onasContainer.closest('section.row');
            if (section) section.style.display = '';
            onasContainer.innerHTML = '<p style="color:#555;padding:20px">Scroll to load…</p>';
            rowTasks.push({
                target: section || onasContainer,
                loaded: false,
                load: async () => {
                    onasContainer.innerHTML = '<p style="color:#555;padding:20px">Loading…</p>';
                    try {
                        const html = await renderAniListRow('rowONAs', 'ONAS');
                        onasContainer.innerHTML = html && html.length
                            ? html
                            : '<p style="color:#888;padding:20px">Nothing found.</p>';
                    } catch (err) {
                        console.warn('[AniListRow] rowONAs failed:', err);
                        onasContainer.innerHTML = '<p style="color:#888;padding:20px">Failed to load.</p>';
                    }
                }
            });
        }

        scheduleAnimeRowLoad(rowTasks, 3);

        // Start personal rows immediately so they can finish behind the loading overlay.
        if (!window.__animePersonalRowsStarted) {
            window.__animePersonalRowsStarted = true;
            loadAnimePersonalRows().catch(() => {});
        }

        // Hero
        let heroShows = [];
        const historyIds = await getAnimeBrowseHistoryTmdbIds();
        if (historyIds.length > 0) {
            heroShows = await buildAnimeHeroFromRecommendations(historyIds[0]);
            if (heroShows.length > 0) {
                heroTag.textContent = 'Recommended from your last watched anime';
            }
        }

        if (heroShows.length === 0) {
            heroShows = await buildAnimeHeroFromMostPopularRow();
            if (heroShows.length > 0) {
                heroTag.textContent = 'Popular Anime';
            }
        }

        if (heroShows.length === 0) {
            heroShows = await tmdbFetch(`/discover/tv?${BASE}&vote_count.gte=50&sort_by=popularity.desc`);
            if (heroShows.length > 0) {
                heroTag.textContent = 'Trending Anime';
            }
        }

        animeHeroList = heroShows.slice(0, 8);
        if (animeHeroList.length > 0) {
            renderAnimeHero(animeHeroList[0]);
            patchSlider();
        }

        const recommendationFirstPageReady = new Promise(resolve => {
            window.__browseRecommendedFirstPageReadyResolve = resolve;
        });
        const recommendationReadyTimeout = new Promise(resolve => setTimeout(resolve, 7000));

        await Promise.race([recommendationFirstPageReady, recommendationReadyTimeout]);

        if (window.__signalBrowseCriticalReady) {
            window.__signalBrowseCriticalReady();
        }
    }

    // ── MAL/Jikan personal rows ───────────────────────────────────

    function getJikanPoster(anime) {
        return anime?.images?.jpg?.large_image_url
            || anime?.images?.jpg?.image_url
            || anime?.images?.webp?.large_image_url
            || anime?.images?.webp?.image_url
            || '';
    }

    function setBrowseSectionBgImage(sectionId, imageUrl) {
        if (!imageUrl) return;
        const section = document.getElementById(sectionId);
        if (!section) return;
        const bg = section.querySelector('.browse-row-bg');
        if (!bg) return;
        bg.style.backgroundImage = `url('${imageUrl}')`;
        bg.classList.add('active');
    }

    async function waitForBrowseOverlayToFinish(maxWaitMs = 14000) {
        const started = Date.now();
        while (Date.now() - started < maxWaitMs) {
            const overlay = document.getElementById('pageLoadingOverlay');
            if (!overlay) return;
            const isGone = overlay.style.display === 'none'
                || overlay.classList.contains('fade-out')
                || window.getComputedStyle(overlay).display === 'none';
            if (isGone) return;
            await new Promise(resolve => setTimeout(resolve, 120));
        }
    }

    // On-click navigation: search TMDB by anime title, then go to movieInfo
    window.navigateToAnimeByTitle = async function(title) {
        try {
            // Try TV first (most anime is TV)
            const tvResults = await tmdbFetch(`/search/tv?query=${encodeURIComponent(title)}&language=en-US`);
            const tvMatch = (tvResults || []).find(r => r.original_language === 'ja')
                        || (tvResults || [])[0];
            if (tvMatch) { window.location.href = `/html/movieInfo.html?id=${tvMatch.id}&type=tv`; return; }
        } catch(e) {}
        try {
            // Fallback: try movie search (covers anime films)
            const movieResults = await tmdbFetch(`/search/movie?query=${encodeURIComponent(title)}&language=en-US`);
            const movieMatch = (movieResults || []).find(r => r.original_language === 'ja')
                           || (movieResults || [])[0];
            if (movieMatch) { window.location.href = `/html/movieInfo.html?id=${movieMatch.id}&type=movie`; return; }
        } catch(e) {}
        window.location.href = `/html/searchQueryResult.html?q=${encodeURIComponent(title)}`;
    };

    // Card built from Jikan anime data (not TMDB)
    function jikanCard(anime) {
        const rawTitle = anime.title_english || anime.title || '';
        const title = rawTitle.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const year = anime.year || (anime.aired?.from ? String(anime.aired.from).slice(0, 4) : '----');
        const rating = anime.score ? anime.score.toFixed(1) : '--';
        const episodes = anime.episodes ? `${anime.episodes} eps` : 'TV Series';
        const synopsis = (anime.synopsis || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const poster = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '/img/LOGO_Short.png';
        // Normalise Jikan type: "TV" → "Anime", "Movie" stays "Movie", rest as-is
        const rawType = (anime.type || '').toUpperCase();
        const typeLabel = rawType === 'MOVIE' ? 'Movie' : 'Anime';
        // Use mal_id as a stable key to find the img later for TMDB poster swap
        const cardType = rawType === 'MOVIE' ? 'movie' : 'tv';
        const uid = 'jc-' + (anime.mal_id || Math.random().toString(36).slice(2));
        return `
            <div class="grid-card"
                 data-id="${anime.mal_id}"
                 data-title="${title}"
                 data-type="${cardType}"
                 data-year="${year}"
                 data-runtime="${episodes}"
                 data-rating="${rating}"
                 data-plot="${synopsis.substring(0, 200)}"
                 onmouseenter="handleCardHover(this)"
                 onmouseleave="handleCardLeave(this)">
                ${rating !== '--' ? `<span class="card-rating-badge"><span style="color:#f5c518;font-size:0.75rem">★</span>${rating}</span>` : ''}
                <img id="${uid}" src="${poster}" loading="lazy"
                     onclick="navigateToAnimeByTitle(this.closest('.grid-card').dataset.title)"
                     onerror="this.src='/img/LOGO_Short.png'">
                <div class="card-title-label">
                    <div class="card-title-name">${title}</div>
                    <div class="card-title-tag">${typeLabel}</div>
                </div>
                <div class="card-hover-info">
                    <div class="hover-preview">
                        <iframe class="card-trailer" title="Trailer" frameborder="0"
                                allow="autoplay; encrypted-media" allowfullscreen></iframe>
                    </div>
                    <div class="hover-meta">
                        <div class="hover-meta-title">${title}</div>
                        <div class="hover-meta-stats">
                            <span>⭐ ${rating}</span>
                            <span>${year}</span>
                            <span>${episodes}</span>
                        </div>
                        <p class="hover-meta-desc">${synopsis.substring(0, 130)}</p>
                        <div class="hover-meta-actions">
                            <button class="hover-play" onclick="navigateToAnimeByTitle(this.closest('.grid-card').dataset.title)">▶</button>
                            <a class="hover-info" href="#" onclick="navigateToAnimeByTitle(this.closest('.grid-card').dataset.title);return false;">More Info</a>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // After inserting jikan cards into the DOM, swap their posters for TMDB English ones
    async function swapJikanPostersToTmdb(containerEl) {
        const cards = Array.from(containerEl.querySelectorAll('.grid-card[data-id]'));
        if (!cards.length) return;
        const now = Date.now();

        // ── 1. Apply in-memory cache hits immediately ─────────────
        const toFetch = [];
        for (const card of cards) {
            const title = card.dataset.title;
            const type  = card.dataset.type || 'tv';   // 'tv' | 'movie'
            const cacheKey = makePosterKey(title, type);
            if (!title) continue;
            const mem = _posterMemCache.get(cacheKey);
            if (mem && (now - (mem.ts || 0)) < _POSTER_TTL && mem.poster_path) {
                const img = card.querySelector('img');
                if (img) img.src = `${TMDB_IMG}${mem.poster_path}`;
                console.log(`[AnimeCache] memory hit ${cacheKey}`);
            } else {
                toFetch.push({ card, title, type, cacheKey });
            }
        }
        if (!toFetch.length) return;

        // ── 2. Batch-check backend poster_cache.json ─────────────
        const uniqueKeys = [...new Set(toFetch.map(c => c.cacheKey))];
        let backendHits = {};
        try {
            const r = await fetch(`/api/poster-cache?keys=${uniqueKeys.map(encodeURIComponent).join(',')}`);
            if (r.ok) backendHits = await r.json();
        } catch(e) {}

        const stillMissing = [];
        for (const item of toFetch) {
            const hit = backendHits[item.cacheKey];
            if (hit?.poster_path) {
                const img = item.card.querySelector('img');
                if (img) img.src = `${TMDB_IMG}${hit.poster_path}`;
                _posterMemCache.set(item.cacheKey, { ...hit, ts: hit.ts || now });
                console.log(`[AnimeCache] backend hit ${item.cacheKey}`);
            } else {
                stillMissing.push(item);
            }
        }
        if (!stillMissing.length) return;

        // ── 3. Fetch TMDB for remaining cache misses ─────────────
        const newEntries = [];
        for (const { card, title, type, cacheKey } of stillMissing) {
            // Capture MAL poster before we swap it away
            const malPoster = card.querySelector('img')?.src || null;
            const malId     = card.dataset.id || null;  // MAL ID from data-id
            // Search correct TMDB endpoint based on type
            const tmdbEndpoint = type === 'movie'
                ? `/search/movie?query=${encodeURIComponent(title)}&language=en-US`
                : `/search/tv?query=${encodeURIComponent(title)}&language=en-US`;
            try {
                const results = await tmdbFetch(tmdbEndpoint);
                const match = (results || []).find(m => m.original_language === 'ja') || results?.[0];
                if (match?.poster_path) {
                    const img = card.querySelector('img');
                    if (img) img.src = `${TMDB_IMG}${match.poster_path}`;
                    const entry = {
                        key:            cacheKey,
                        type:           type,
                        tmdb_id:        match.id,
                        mal_id:         malId,
                        name:           match.name || match.title || null,
                        poster_path:    match.poster_path,
                        mal_poster:     malPoster,
                        backdrop_path:  match.backdrop_path  || null,
                        vote_average:   match.vote_average   || null,
                        overview:       match.overview       || null,
                        first_air_date: match.first_air_date || match.release_date || null
                    };
                    _posterMemCache.set(cacheKey, { ...entry, ts: now });
                    newEntries.push(entry);
                }
            } catch(e) {}
            await new Promise(r => setTimeout(r, 80));
        }

        // ── 4. Persist new entries to backend (fire-and-forget) ──
        if (newEntries.length) {
            console.log('[AnimeCache] saving entries', newEntries.map(e => ({
                key: e.key,
                type: e.type,
                tmdb_id: e.tmdb_id,
                mal_id: e.mal_id
            })));
            fetch('/api/poster-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: newEntries })
            })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data?.saved != null) {
                        console.log(`[AnimeCache] saved ${data.saved} entries to backend poster cache`);
                    }
                })
                .catch(() => {});
        }
    }

    // Convert Jikan recommendation entries → TMDB animeCards (cache-aware)
    async function jikanRecsToCards(recs, limit = 10) {
        const batch = recs.slice(0, limit);
        const now = Date.now();
        // Jikan recommendations are always TV anime
        const TYPE = 'tv';

        // ── 1. Collect titles, apply memory cache hits ────────────
        const entries = batch.map(rec => ({
            title:    rec.entry?.title || null,
            cacheKey: rec.entry?.title ? makePosterKey(rec.entry.title, TYPE) : null,
            memHit:   null
        }));
        const needBackend = [];
        for (const e of entries) {
            if (!e.cacheKey) continue;
            const mem = _posterMemCache.get(e.cacheKey);
            if (mem && (now - (mem.ts || 0)) < _POSTER_TTL && mem.tmdb_id) {
                e.memHit = mem;
                console.log(`[AnimeCache] memory hit ${e.cacheKey}`);
            } else {
                needBackend.push(e.cacheKey);
            }
        }

        // ── 2. Batch-check backend for remaining ─────────────────
        let backendHits = {};
        if (needBackend.length) {
            const uniq = [...new Set(needBackend)];
            try {
                const r = await fetch(`/api/poster-cache?keys=${uniq.map(encodeURIComponent).join(',')}`);
                if (r.ok) backendHits = await r.json();
            } catch(e) {}
        }
        for (const e of entries) {
            if (!e.cacheKey || e.memHit) continue;
            const hit = backendHits[e.cacheKey];
            if (hit?.tmdb_id) {
                _posterMemCache.set(e.cacheKey, { ...hit, ts: hit.ts || now });
                e.memHit = hit;
                console.log(`[AnimeCache] backend hit ${e.cacheKey}`);
            }
        }

        // ── 3. TMDB fetch for still-missing; collect new entries ──
        const fetchQueue = entries.filter(e => e.cacheKey && !e.memHit);
        const newCacheEntries = [];
        await Promise.all(fetchQueue.map(e =>
            tmdbFetch(`/search/tv?query=${encodeURIComponent(e.title)}&language=en-US`)
                .then(results => {
                    const match = (results || []).find(r => r.original_language === 'ja')
                                || (results || [])[0];
                    if (match?.id) {
                        const entry = {
                            key:            e.cacheKey,
                            type:           TYPE,
                            tmdb_id:        match.id,
                            mal_id:         null,  // not available in rec flow
                            name:           match.name || match.title || null,
                            poster_path:    match.poster_path    || null,
                            mal_poster:     null,
                            backdrop_path:  match.backdrop_path  || null,
                            vote_average:   match.vote_average   || null,
                            overview:       match.overview       || null,
                            first_air_date: match.first_air_date || match.release_date || null
                        };
                        _posterMemCache.set(e.cacheKey, { ...entry, ts: now });
                        e.memHit = entry;
                        newCacheEntries.push(entry);
                    }
                })
                .catch(() => {})
        ));

        if (newCacheEntries.length) {
            console.log('[AnimeCache] saving entries', newCacheEntries.map(e => ({
                key: e.key,
                type: e.type,
                tmdb_id: e.tmdb_id,
                mal_id: e.mal_id
            })));
            fetch('/api/poster-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: newCacheEntries })
            })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data?.saved != null) {
                        console.log(`[AnimeCache] saved ${data.saved} entries to backend poster cache`);
                    }
                })
                .catch(() => {});
        }

        // ── 4. Build cards from cache hits (preserve rec order) ──
        return entries
            .map(e => {
                if (!e.memHit?.tmdb_id) return null;
                return animeCard(e.memHit, TYPE);
            })
            .filter(Boolean);
    }

    function initAnimeRecommendedPager(cards, containerEl, pageSize = 6) {
        if (!containerEl || !Array.isArray(cards) || cards.length === 0) {
            window.__browseRecommendedPage = null;
            return;
        }

        const state = {
            cards,
            page: 0,
            pageSize,
            pageCount: Math.max(1, Math.ceil(cards.length / pageSize)),
            container: containerEl
        };

        const renderPage = async (dir = 0) => {
            if (dir !== 0) {
                state.page = (state.page + dir + state.pageCount) % state.pageCount;
            }
            const start = state.page * state.pageSize;
            const chunk = state.cards.slice(start, start + state.pageSize);
            state.container.innerHTML = chunk.join('');

            if (dir !== 0 && typeof state.container.animate === 'function') {
                state.container.animate(
                    [
                        { opacity: 0.45, transform: `translateX(${dir > 0 ? 24 : -24}px)` },
                        { opacity: 1, transform: 'translateX(0px)' }
                    ],
                    { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
                );
            }

            await swapJikanPostersToTmdb(state.container);
            if (typeof window.applyBrowseRowBg === 'function') {
                window.applyBrowseRowBg('recommendedSection');
            }
        };

        const updateRecommendedPagerCards = (newCards) => {
            state.cards = newCards;
            state.pageCount = Math.max(1, Math.ceil(state.cards.length / state.pageSize));
            if (state.page >= state.pageCount) {
                state.page = state.pageCount - 1;
            }
            return renderPage(0);
        };

        window.__browseRecommendedPage = (dir) => {
            if (state.pageCount <= 1) return false;
            renderPage(dir);
            return true;
        };

        window.__browseRecommendedPageUpdate = updateRecommendedPagerCards;

        renderPage(0);
    }

    async function loadAnimePersonalRows() {
        // Route all Jikan calls through the backend proxy — avoids browser-side rate limiting,
        // reuses the server's retry/backoff logic, and caches responses.
        // const jikanFetch = (jikanPath) => fetch('/api/jikan?path=' + encodeURIComponent(jikanPath));

        // ── 1. Collect anime TMDB IDs from watch history ─────────────
        let historyRows = [];
        let historyIds = [];
        let animeHistoryRows = [];
        if (window.recommendationsSystem?.fetchActivityHistory) {
            historyRows = await window.recommendationsSystem.fetchActivityHistory(20) || [];
            animeHistoryRows = historyRows.filter(h => {
                const type = String(h?.item_type || '').toLowerCase();
                const genre = String(h?.genre || '').toLowerCase();
                return type === 'tv' || type === 'anime' || genre.includes('anime') || genre.includes('animation');
            });
            historyIds = animeHistoryRows.map(h => h.movie_id).filter(Boolean);
        }
        if (historyIds.length === 0) {
            try {
                const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
                historyIds = (prefs.clickedMovies || []).slice(0, 10);
            } catch(e) {}
        }
        historyIds = [...new Set(historyIds.map(v => String(v)).filter(Boolean))];

        // ── 2. Convert TMDB IDs → MAL IDs (up to 8, with fallback query) ──
        const malResults = await Promise.all(
            historyIds.slice(0, 8).map(async (tmdbId) => {
                try {
                    // First pass with season hint (best for TV anime)
                    let r = await fetch(`/api/anime-mal-id?tmdbId=${tmdbId}&season=1`);
                    if (!r.ok) {
                        // Fallback without season in case mapping differs
                        r = await fetch(`/api/anime-mal-id?tmdbId=${tmdbId}`);
                    }
                    if (!r.ok) return null;
                    const d = await r.json();
                    return d.mal_id ? { tmdbId, malId: d.mal_id } : null;
                } catch(e) {
                    return null;
                }
            })
        );
        const malEntries = malResults
            .filter(Boolean)
            .filter((entry, idx, arr) => arr.findIndex(x => String(x.malId) === String(entry.malId)) === idx);

        let lastWatchedPoster = '';
        let historyAnime = [];

        // ── No history yet: show two discovery rows ──────────────────────
        if (malEntries.length === 0) {
            // Hide history-dependent rows in anime mode when no MAL-linked watch history exists.
            ['becauseYouWatchedSection', 'topGenreSection'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            if (animeHistoryRows.length === 0) {
                const el = document.getElementById('historyRowSection');
                if (el) el.style.display = 'none';
            }

            // Row 1: Recommended = Airing This Season (most-followed)
            const recSec = document.getElementById('recommendedSection');
            const recCon = document.getElementById('rowRecommended');
            if (recSec && recCon) {
                const lbl = recSec.querySelector('.row-title');
                if (lbl) lbl.textContent = '📡 Airing This Season';
                try {
                    const r = await jikanFetch('/seasons/now?limit=20');
                    if (r.ok) {
                        const d = await r.json();
                        const sorted = (d.data || []).sort((a, b) => (b.members || 0) - (a.members || 0));
                        const cards = sorted.slice(0, 24).map(jikanCard);
                        initAnimeRecommendedPager(cards, recCon, 6);
                        if (typeof window.__browseRecommendedFirstPageReadyResolve === 'function') {
                            window.__browseRecommendedFirstPageReadyResolve();
                        }
                    }
                } catch(e) {}
            }
            // Row 2: Top Airing Right Now — airing, started ≤1 year ago, high members
            const taSec = document.getElementById('topAiringSection');
            const taCon = document.getElementById('rowTopAiring');
            if (taSec && taCon) {
                try {
                    console.log('[TopAiring] Fetching pages 1 and 2...');
                    const r1 = await jikanFetch('/top/anime?filter=airing&limit=25&page=1');
                    console.log('[TopAiring] Page 1 status:', r1.status);
                    const r2 = await jikanFetch('/top/anime?filter=airing&limit=25&page=2');
                    console.log('[TopAiring] Page 2 status:', r2.status);
                    let pool = [];
                    if (r1.ok) { const d = await r1.json(); console.log('[TopAiring] Page 1 data count:', d.data?.length, 'sample:', d.data?.[0]?.title); pool.push(...(d.data || [])); }
                    else console.warn('[TopAiring] Page 1 failed:', r1.status);
                    if (r2.ok) { const d = await r2.json(); console.log('[TopAiring] Page 2 data count:', d.data?.length); pool.push(...(d.data || [])); }
                    else console.warn('[TopAiring] Page 2 failed:', r2.status);
                    console.log('[TopAiring] Pool total:', pool.length);
                    // Keep: currently airing + decent traction
                    const filtered = pool.filter(a =>
                        a.airing === true && a.members >= 5000
                    ).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20);
                    console.log('[TopAiring] After filter:', filtered.length, filtered.map(a => a.title));
                    if (filtered.length > 0) {
                        taSec.style.display = '';
                        taCon.innerHTML = filtered.map(jikanCard).join('');
                        swapJikanPostersToTmdb(taCon);
                    } else {
                        console.warn('[TopAiring] Nothing passed filter — section stays hidden');
                    }
                } catch(e) { console.error('[TopAiring] Error:', e); }
            }
            if (animeHistoryRows.length === 0) return;
        }

        // ── 3. "Recently Viewed" — History row from local activity cache ──
        const histSection = document.getElementById('historyRowSection');
        const histContainer = document.getElementById('rowHistory');
        if (histSection && histContainer) {
            const lbl = histSection.querySelector('.row-title');
            if (lbl) lbl.textContent = '🕘 Your Anime History';

            if (animeHistoryRows.length === 0) {
                histSection.style.display = 'none';
            } else {
                const histCards = await Promise.all(animeHistoryRows.slice(0, 24).map(async (row) => {
                    const itemType = String(row.item_type || '').toLowerCase();
                    const type = itemType === 'movie' ? 'movie' : 'tv';
                    const movieId = String(row.movie_id || '').trim();
                    if (!movieId) return null;
                    try {
                        const res = await fetch(`/api/tmdb-proxy/${type}/${encodeURIComponent(movieId)}`);
                        if (!res.ok) return null;
                        const show = await res.json();
                        if (!show || !(show.name || show.title)) return null;
                        return animeCard(show, type);
                    } catch (e) {
                        return null;
                    }
                }));
                const cards = histCards.filter(Boolean);
                const historyMoreCard = `
                    <div class="grid-card" role="button" tabindex="0"
                         aria-label="Open My List"
                         onclick="window.location.href='/html/personalList.html'"
                         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.location.href='/html/personalList.html';}"
                         style="position:relative;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:36px 0 0 36px;backdrop-filter:blur(2px);cursor:pointer;overflow:hidden;">
                        <div style="transform:rotate(-90deg);color:#ffffff;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;white-space:nowrap;opacity:0.95;">Click For More</div>
                        <div aria-hidden="true" style="position:absolute;right:67px;top:50%;transform:translateY(-50%);color:#ffffff;opacity:0.9;font-size:1.2rem;line-height:1;">→</div>
                    </div>`;
                if (cards.length > 0) {
                    const histCardsWithMore = [...cards, historyMoreCard];
                    histSection.style.display = '';
                    histContainer.innerHTML = histCardsWithMore.join('');

                    const firstRenderedPoster = histContainer.querySelector('.grid-card img')?.src || '';
                    lastWatchedPoster = firstRenderedPoster;
                    if (lastWatchedPoster) {
                        setBrowseSectionBgImage('historyRowSection', lastWatchedPoster);
                    }
                } else {
                    histSection.style.display = 'none';
                }
            }
        }

        // ── 4. "Because You Watched X" — Anime recommendations from cache ──────
        const seedTmdbId = malEntries[0]?.tmdbId || historyIds[0] || null;
        const seedHistory = historyRows.find(h => String(h.movie_id) === String(seedTmdbId));
        const seedTitle = seedHistory?.title || historyRows[0]?.title || 'a recent anime';

        if (seedTmdbId) {
            await loadAnimeBecauseYouWatchedRow(seedTmdbId, seedTitle);
        } else {
            const bywSection = document.getElementById('becauseYouWatchedSection');
            if (bywSection) bywSection.style.display = 'none';
        }

        //====TOP GENRE SECTION DEPRECATED====
        // The "Because you love this genre" section is deprecated and controlled here.
        // The old behavior used Jikan genre history and local preferences to populate rowTopGenre.
        // It is disabled because the feature is no longer supported.
        // const tgSection = document.getElementById('topGenreSection');
        // const tgContainer = document.getElementById('rowTopGenre');
        // const tgTitle = document.getElementById('topGenreTitle');
        // if (tgSection && tgContainer) {
        //     const jikanGenreMap = {
        //         'Action': 1,
        //         'Action & Adventure': 1,
        //         'Adventure': 2,
        //         'Comedy': 4,
        //         'Drama': 8,
        //         'Fantasy': 10,
        //         'Horror': 14,
        //         'Mystery': 7,
        //         'Romance': 22,
        //         'Sci-Fi': 24,
        //         'Sci-Fi & Fantasy': 24,
        //         'Science Fiction': 24,
        //         'Supernatural': 37,
        //         'Thriller': 41,
        //         'Suspense': 41
        //     };
        //     const isGeneric = (g) => {
        //         const v = String(g || '').trim().toLowerCase();
        //         return v === 'animation' || v === 'anime' || v === 'tv movie' || v === 'family' || v === 'kids';
        //     };

        //     let rankedGenres = [];

        //     // Prefer genres from resolved anime watch history first.
        //     if (historyAnime.length > 0) {
        //         const animeGenreCounts = new Map();
        //         historyAnime.forEach(a => {
        //             (a?.genres || []).forEach(g => {
        //                 const name = String(g?.name || '').trim();
        //                 if (!name) return;
        //                 animeGenreCounts.set(name, (animeGenreCounts.get(name) || 0) + 1);
        //             });
        //         });
        //         rankedGenres = [...animeGenreCounts.entries()]
        //             .sort((a, b) => b[1] - a[1])
        //             .map(([name]) => name);
        //     }

        //     if (rankedGenres.length === 0 && window.recommendationsSystem?.fetchActivityGenres) {
        //         try {
        //             const dbGenres = await window.recommendationsSystem.fetchActivityGenres();
        //             rankedGenres = (dbGenres || []).map(g => String(g.genre || '').split(',')[0].trim()).filter(Boolean);
        //         } catch (e) {}
        //     }
        //     if (rankedGenres.length === 0) {
        //         let prefs = {};
        //         try { prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}'); } catch(e) {}
        //         const genreClicks = prefs.genreClicks || {};
        //         rankedGenres = Object.entries(genreClicks).sort((a, b) => b[1] - a[1]).map(e => e[0]);
        //     }

        //     const topGenre = rankedGenres.find(g => jikanGenreMap[g] && !isGeneric(g))
        //         || rankedGenres.flatMap(g => g.split(' & ')).find(g => jikanGenreMap[g] && !isGeneric(g))
        //         || rankedGenres.find(g => jikanGenreMap[g]);
        //     if (topGenre) {
        //         if (tgTitle) tgTitle.textContent = `Because You Love ${topGenre} Anime`;
        //         try {
        //             const genreRes = await jikanFetch(`/anime?genres=${jikanGenreMap[topGenre]}&order_by=score&sort=desc&limit=15&min_score=7`);
        //             if (genreRes.ok) {
        //                 const genreData = await genreRes.json();
        //                 if ((genreData.data || []).length > 0) {
        //                     tgSection.style.display = '';
        //                     tgContainer.innerHTML = genreData.data.map(jikanCard).join('');
        //                     swapJikanPostersToTmdb(tgContainer);
        //                     if (lastWatchedPoster) {
        //                         setBrowseSectionBgImage('topGenreSection', lastWatchedPoster);
        //                     }
        //                 } else {
        //                     tgSection.style.display = 'none';
        //                 }
        //             } else {
        //                 tgSection.style.display = 'none';
        //             }
        //         } catch(e) {
        //             tgSection.style.display = 'none';
        //         }
        //     } else {
        //         tgSection.style.display = 'none';
        //     }
        // }

        // ── 6. "Recommended for You" — cached anime recommendations ──
        const recSection = document.getElementById('recommendedSection');
        const recContainer = document.getElementById('rowRecommended');
        if (recSection && recContainer) {
            const lbl = recSection.querySelector('.row-title');
            if (lbl) lbl.textContent = '✦ Recommended Anime for You';

            const watchedTmdbIds = animeHistoryRows
                .slice(1, 16)
                .map(h => String(h.movie_id || '').trim())
                .filter(Boolean);

            const merged = [];
            const seenIds = new Set();
            const cardHtmls = [];
            let recPagerInitialized = false;
            let recReadySignaled = false;
            const RECOMMEND_PAGE_SIZE = 6;
            const MIN_CARDS_FOR_PAGER = 6;
            const MAX_CONCURRENT_RECOMMENDATION_FETCHES = 4;
            const recMoreCard = `
                        <div class="grid-card" role="button" tabindex="0"
                             aria-label="Watch more anime for further recommendations"
                             onclick="window.location.href='/html/personalList.html'"
                             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.location.href='/html/personalList.html';}"
                             style="position:relative;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:36px 0 0 36px;backdrop-filter:blur(2px);cursor:pointer;overflow:hidden;">
                            <div style="transform:rotate(-90deg);color:#ffffff;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;white-space:nowrap;opacity:0.95;text-align: center;">Watch more animes for<br>further recommendations!</div>
                            <div aria-hidden="true" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);color:#ffffff;opacity:0.9;font-size:1.2rem;line-height:1;">→</div>
                        </div>`;

            const signalBrowseRecommendationsReady = () => {
                if (recReadySignaled) return;
                recReadySignaled = true;
                if (typeof window.__browseRecommendedFirstPageReadyResolve === 'function') {
                    window.__browseRecommendedFirstPageReadyResolve();
                }
            };

            recContainer.innerHTML = '<p style="color:#888;padding:20px">Loading recommendations…</p>';

            const renderRecommended = () => {
                if (cardHtmls.length === 0) return;
                recSection.style.display = '';
                if (!recPagerInitialized) {
                    if (cardHtmls.length >= MIN_CARDS_FOR_PAGER) {
                        initAnimeRecommendedPager(cardHtmls, recContainer, RECOMMEND_PAGE_SIZE);
                        recPagerInitialized = true;
                        signalBrowseRecommendationsReady();
                    } else {
                        recContainer.innerHTML = cardHtmls.join('');
                    }
                } else if (typeof window.__browseRecommendedPageUpdate === 'function') {
                    window.__browseRecommendedPageUpdate(cardHtmls);
                }
            };

            const fetchRecommendation = async (tmdbId, idx, isLast) => {
                try {
                    const response = await fetch(`/api/anime-recommendations?tmdbId=${encodeURIComponent(tmdbId)}`);
                    if (!response.ok) return;
                    const body = await response.json();
                    if (body.status !== 'ready' || !Array.isArray(body.recommendations)) return;

                    const limit = isLast ? 4 : 3;
                    const recs = body.recommendations.slice(0, limit).map(rec => ({ ...rec, _type: 'tv' }));
                    for (const rec of recs) {
                        const id = rec?.ID || rec?.tmdb_id || null;
                        if (!id || seenIds.has(String(id))) continue;
                        seenIds.add(String(id));
                        merged.push(rec);
                        cardHtmls.push(createCard(rec));
                        if (merged.length >= 43) break;
                    }

                    renderRecommended();
                } catch (e) {
                    // Continue loading the next watched anime if one recommendation fetch fails.
                }
            };

            const queue = watchedTmdbIds.slice(0, 12);
            let nextIndex = 0;
            const workers = Array.from({ length: Math.min(MAX_CONCURRENT_RECOMMENDATION_FETCHES, queue.length) }, async () => {
                while (true) {
                    const index = nextIndex++;
                    if (index >= queue.length) break;
                    await fetchRecommendation(queue[index], index, index === queue.length - 1);
                    if (merged.length >= 43) break;
                }
            });
            await Promise.all(workers);

            if (merged.length > 0) {
                cardHtmls.push(recMoreCard);
            }

            if (merged.length > 0) {
                if (!recPagerInitialized) {
                    initAnimeRecommendedPager(cardHtmls, recContainer, RECOMMEND_PAGE_SIZE);
                    recPagerInitialized = true;
                    signalBrowseRecommendationsReady();
                } else if (typeof window.__browseRecommendedPageUpdate === 'function') {
                    window.__browseRecommendedPageUpdate(cardHtmls);
                }
            }

            if (merged.length === 0) {
                recContainer.innerHTML = '<div class="browse-empty-state">Recommendations are warming up. Watch a few anime and try again.</div>';
                recSection.style.display = '';
                signalBrowseRecommendationsReady();
            } else if (cardHtmls.length < MIN_CARDS_FOR_PAGER) {
                signalBrowseRecommendationsReady();
            }
        }
    }

    async function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

// ===================JIKAN COMMENTED OUT
/*
    async function jikanFetch(path) {
        const url = `https://api.jikan.moe/v4${path}`;

        let delay = 500;

        for (let attempt = 1; attempt <= 8; attempt++) {
            console.log(`[JIKAN] ${path} (attempt ${attempt})`);

            try {
                const res = await fetch(url);

                if (res.ok) {
                    return res;
                }

                // Retry rate limits and upstream failures
                if (res.status === 429 || res.status === 504) {
                    console.warn(`Jikan ${res.status}, retrying in ${delay}ms...`);
                    await sleep(delay);
                    delay = Math.min(delay * 2, 5000); // 500 → 1000 → 2000 → 4000 → 5000
                    continue;
                }

                return res;
            } catch (err) {
                console.warn("Network error:", err);
                await sleep(delay);
                delay = Math.min(delay * 2, 5000);
            }
        }

        throw new Error(`Jikan failed after multiple retries: ${path}`);
    }
*/
// ===================JIKAN COMMENTED OUT
// THIS IS THE PART RESPONSIBLE FOR JIKAN IN INDEXBROWSE, DONT FUCKING FORGET ABOUT IT, IT IS IMPORTANT, I REPEAT, DO NOT FORGET ABOUT IT, THIS IS THE PART RESPONSIBLE FOR JIKAN IN INDEXBROWSE, DONT FUCKING FORGET ABOUT IT, IT IS IMPORTANT, I REPEAT, DO NOT FORGET ABOUT IT

    async function loadAnimeBecauseYouWatchedRow(seedTmdbId, seedTitle) {
        const section = document.getElementById('becauseYouWatchedSection');
        const container = document.getElementById('rowBecauseYouWatched');
        const titleEl = document.getElementById('becauseYouWatchedTitle');
        if (!section || !container) return;

        if (titleEl) {
            titleEl.textContent = `Because you watched "${seedTitle || 'a recent anime'}"`;
        }

        try {
            const response = await fetch(`/api/anime-recommendations?tmdbId=${encodeURIComponent(seedTmdbId)}`);
            if (!response.ok) {
                section.style.display = 'none';
                return;
            }

            const body = await response.json();
            if (body.status !== 'ready' || !Array.isArray(body.recommendations) || body.recommendations.length === 0) {
                section.style.display = 'none';
                return;
            }

            const cards = body.recommendations
                .map(rec => ({ ...rec, _type: 'tv' }))
                .map(createCard)
                .join('');

            if (!cards) {
                section.style.display = 'none';
                return;
            }

            section.style.display = '';
            container.innerHTML = cards;

            const firstPoster = container.querySelector('img')?.src || '';
            if (firstPoster) {
                setBrowseSectionBgImage('becauseYouWatchedSection', firstPoster);
            }
        } catch (err) {
            console.warn('[animePersonal] BYW failed:', err);
            section.style.display = 'none';
        }
    }
    // ── Bootstrap ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        // Sync toggle checkbox state
        const cb = document.getElementById('animeModeCheck');
        const wrap = document.getElementById('modeToggleWrap');
        if (cb) {
            cb.checked = isAnimeMode();
            if (wrap) wrap.classList.toggle('anime-active', isAnimeMode());
        }

        if (isAnimeMode()) {
            if (_isMain) loadAnimeMode();
            else if (_isBrowse) loadAnimeBrowse();
        }
    });
})();
