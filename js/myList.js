
//====GUEST USER BLOCKER FOR SITES
// (Disabled: guest accounts are treated as real accounts now.)
// (function checkAccess() {
//     const user = localStorage.getItem('username');
//     
//     if (!user) {
//         // Create the UI block immediately
//         const lockMarkup = `
//             <div class="locked-overlay">
//                 <div class="locked-box">
//                     <div class="lock-icon" style="font-size: 50px; margin-bottom: 20px;">🔒</div>
//                     <h2>Private Collection</h2>
//                     <p style="display: block;margin-bottom: 10px;">This list is only available to registered members.</p>
//                     <a href="indexMain.html#promoMarquee">
//                         <button class="btn-locked-signin">Sign In / Join</button>
//                     </a>
//                     <br><br>
//                     <a href="indexMain.html" style="color: #666; font-size: 13px; text-decoration: none;">← Back to Home</a>
//                 </div>
//             </div>
//         `;

//         const injectLock = () => {
//             document.body.innerHTML = lockMarkup;
//             document.body.style.overflow = 'hidden';
//         };

//         // If body is ready, inject now. If not, wait for it.
//         if (document.body) injectLock();
//         else window.addEventListener('DOMContentLoaded', injectLock);

//         const keepLocked = () => {
//             if (!document.querySelector('.locked-overlay')) {
//                 injectLock();
//             }
//         };

//         setInterval(keepLocked, 1000);
//         
//         // STOPPPPPPPPP PLS
//         throw new Error("Access Denied: Redirecting to Login UI");
//     }
// })();
// 🚨 FRONTEND BROWSER SPAMMER 🚨
// Put this in your main.js, script.js, or HTML file!

 


// -----------------------------above is the blocking mechanism, below loading movies goes-----------------------------\\

let personalModeOverride = null;
let personalModeFlyoutEl = null;
let personalModeOutsideHandler = null;
let personalModeEscapeHandler = null;
const MODE_FLYOUT_CLOSE_MS = 180;

function getBaselineMode() {
    return localStorage.getItem('animeMode') === 'true' ? 'anime' : 'movie';
}

function getEffectiveMode() {
    return personalModeOverride || getBaselineMode();
}

function isAnimeModeEnabled() {
    return getEffectiveMode() === 'anime';
}

function escapeQuotes(text) {
    return String(text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function toYear(value) {
    if (!value) return '';
    const str = String(value);
    return str.length >= 4 ? str.slice(0, 4) : '';
}

function formatHistoryDate(value) {
    if (!value) return '';
    let dt = null;
    if (/^\d+$/.test(String(value))) {
        dt = new Date(Number(value) * 1000);
    } else {
        dt = new Date(value);
    }
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${mm}/${dd}`;
}

function modeLabel() {
    const mode = getEffectiveMode();
    if (mode === 'anime') return 'ANIME MODE';
    if (mode === 'all') return 'ALL MODE';
    return 'MOVIE MODE';
}

// My List / My History show everything regardless of the site's anime/movie
// mode toggle -- these are the user's own saved items/watch history, not a
// content-discovery row, so filtering them by mode just hid things the user
// deliberately saved.
function applyModeFilter(records) {
    return Array.isArray(records) ? records : [];
}

function updateModePills() {
    const listPill = document.getElementById('myListModePill');
    const histPill = document.getElementById('myHistoryModePill');
    const label = modeLabel();
    const mode = getEffectiveMode();
    if (listPill) {
        listPill.textContent = label;
        listPill.dataset.mode = mode;
    }
    if (histPill) {
        histPill.textContent = label;
        histPill.dataset.mode = mode;
    }
}

function getAlternativeModes(activeMode) {
    const allModes = ['anime', 'movie', 'all'];
    return allModes.filter(mode => mode !== activeMode);
}

function closeModeFlyout(animate = true) {
    const flyout = personalModeFlyoutEl;
    if (flyout) {
        personalModeFlyoutEl = null;
        if (animate) {
            flyout.classList.remove('is-visible');
            flyout.classList.add('is-closing');
            setTimeout(() => {
                if (flyout.parentNode) flyout.remove();
            }, MODE_FLYOUT_CLOSE_MS);
        } else {
            flyout.remove();
        }
    }
    if (personalModeOutsideHandler) {
        document.removeEventListener('click', personalModeOutsideHandler);
        personalModeOutsideHandler = null;
    }
    if (personalModeEscapeHandler) {
        document.removeEventListener('keydown', personalModeEscapeHandler);
        personalModeEscapeHandler = null;
    }
}

function createFlyoutOptionButton(mode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'personal-mode-option';
    button.dataset.mode = mode;
    button.textContent = mode === 'anime' ? 'ANIME MODE' : mode === 'movie' ? 'MOVIE MODE' : 'ALL MODE';
    return button;
}

function openModeFlyout(anchorEl) {
    if (!anchorEl) return;
    const activeMode = getEffectiveMode();

    if (personalModeFlyoutEl && personalModeFlyoutEl.dataset.activeMode === activeMode) {
        closeModeFlyout(true);
        return;
    }

    closeModeFlyout(false);

    const flyout = document.createElement('div');
    flyout.className = 'personal-mode-flyout';
    flyout.dataset.activeMode = activeMode;
    flyout.setAttribute('role', 'menu');

    getAlternativeModes(activeMode).forEach(mode => {
        const option = createFlyoutOptionButton(mode);
        option.addEventListener('click', async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            personalModeOverride = mode;
            closeModeFlyout();
            await renderPersonalDiscoveryPanels();
        });
        flyout.appendChild(option);
    });

    document.body.appendChild(flyout);
    const rect = anchorEl.getBoundingClientRect();
    const top = rect.bottom + 8;
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - flyout.offsetWidth - 8));
    flyout.style.top = `${Math.max(8, top)}px`;
    flyout.style.left = `${Math.max(8, left)}px`;
    setTimeout(() => {
        flyout.classList.add('is-visible');
    }, 0);

    personalModeFlyoutEl = flyout;

    personalModeOutsideHandler = function(e) {
        if (!personalModeFlyoutEl) return;
        const target = e.target;
        if (personalModeFlyoutEl.contains(target) || anchorEl.contains(target)) return;
        closeModeFlyout(true);
    };

    personalModeEscapeHandler = function(e) {
        if (e.key === 'Escape') closeModeFlyout(true);
    };

    setTimeout(() => {
        if (personalModeOutsideHandler) document.addEventListener('click', personalModeOutsideHandler);
    }, 0);
    document.addEventListener('keydown', personalModeEscapeHandler);
}

function setPanelBackground(panelBgId, records) {
    const bg = document.getElementById(panelBgId);
    if (!bg) return;
    const first = Array.isArray(records) ? records[0] : null;
    if (first && first.poster) {
        bg.style.backgroundImage = `url('${first.poster}')`;
    } else {
        bg.style.backgroundImage = '';
    }
}

function getEmptyPanelHTML(kind) {
    if (kind === 'list') {
        return `<div class="personal-discovery-empty">No items for this mode yet. <a href="/html/allMovies.html">Browse titles →</a></div>`;
    }
    return `<div class="personal-discovery-empty">No watch history for this mode yet.</div>`;
}

function cardMetaText(record, kind) {
    // record.type only distinguishes movie vs tv-shaped content - a plain Russian/Western TV
    // show (e.g. "Cold" via Kino/RU-MV TV) is stored with the exact same item_type='tv' a real
    // anime series gets, since TMDB itself has no separate "anime" media type to key off of.
    // record.isAnime (set in resolveTvOrAnimeRow/fetchAnimeCacheRow below from the real
    // genre/language signal, same heuristic moviePlayer.js uses for its own isAnime check) is
    // the actual anime-or-not signal; record.type alone is not enough to label this correctly.
    const typeLabel = record.type === 'movie' ? 'MOVIE' : (record.isAnime ? 'ANIME' : 'TV');
    const bits = [typeLabel];
    if (record.year) bits.push(record.year);
    if (record.rating && record.rating !== '--') bits.push(`★ ${record.rating}`);
    if (kind === 'history' && record.watchedAt) {
        const watched = formatHistoryDate(record.watchedAt);
        if (watched) bits.push(`Watched ${watched}`);
    }
    return bits.join(' · ');
}

function createDiscoveryCardHTML(record, index, kind) {
    const safeTitle = escapeHtml(record.title || 'Unknown');
    const safeTitleAttr = escapeQuotes(record.title || 'Unknown');
    const navType = (record.type === 'tv' || record.type === 'anime') ? 'tv' : 'movie';
    const removeFn = kind === 'list' ? 'removeFromList' : 'removeFromHistory';
    const removeTitle = kind === 'list' ? 'Remove from list' : 'Remove from history';
    const number = String(index + 1).padStart(2, '0');
    const metaText = escapeHtml(cardMetaText(record, kind));
    const poster = record.poster || '/img/LOGO_Short.png';
    const safeId = escapeQuotes(record.id);
    const navId = encodeURIComponent(record.id);

    return `
        <div class="disc-card personal-disc-card" data-item-id="${safeId}" onclick="window.location.href='movieInfo.html?id=${navId}&type=${navType}'">
            <img class="disc-card-img" src="${poster}" alt="${safeTitleAttr}" loading="lazy" onerror="this.src='/img/LOGO_Short.png'">
            <span class="disc-card-num">${number}</span>
            <button class="disc-card-remove-btn hover-delete-btn" title="${removeTitle}" onclick="event.stopPropagation(); ${removeFn}('${safeId}', event)"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <g transform="translate(3.6 3.6) scale(0.7)">
    <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </g>
</svg>

</button>
            <div class="disc-card-info">
                <div class="disc-card-title">${safeTitle}</div>
                <div class="disc-card-meta">${metaText}</div>
            </div>
        </div>
    `;
}

function renderPanelCards(rowId, panelBgId, records, kind) {
    const row = document.getElementById(rowId);
    if (!row) return;

    if (!records.length) {
        row.innerHTML = getEmptyPanelHTML(kind);
        setPanelBackground(panelBgId, []);
        return;
    }

    row.innerHTML = records.map((record, index) => createDiscoveryCardHTML(record, index, kind)).join('');
    setPanelBackground(panelBgId, records);
}

async function getHistoryRows(limit = 50) {
    try {
        if (window.recommendationsSystem?.fetchActivityHistory) {
            const rows = await window.recommendationsSystem.fetchActivityHistory(limit);
            return rows || [];
        }
    } catch (err) {
        console.warn('[myList] fallback history fetch (recommendationsSystem failed):', err.message);
    }

    try {
        const userUID = localStorage.getItem('userUID');
        if (!userUID) return [];
        const res = await fetch(`/activity/history?userUID=${encodeURIComponent(userUID)}&limit=${limit}`);
        if (!res.ok) return [];
        const rows = await res.json();
        return rows || [];
    } catch (err) {
        console.warn('[myList] fallback history fetch failed:', err.message);
        return [];
    }
}

function normalizeSavedItems(rawList, historyTypeMap) {
    return (rawList || []).map(item => {
        const normalized = (typeof item === 'object' && item !== null)
            ? { id: String(item.id), type: item.type || 'movie' }
            : { id: String(item), type: 'movie' };

        const histType = historyTypeMap[String(normalized.id)];
        if (histType) normalized.type = histType;
        return normalized;
    });
}

// Anime that's already been viewed on its info page has its title/thumbnail/rating cached
// locally from that AniList fetch -- reuse it instead of hitting TMDB again. Deliberately
// scoped to type === 'anime' only: a cache miss here (never-viewed anime) falls through to
// the exact same TMDB call as before, so this can only add a shortcut, never remove the
// fallback. Plain 'tv' and 'movie' items never call this at all.
async function fetchAnimeCacheRow(tmdbId) {
    try {
        const res = await fetch(`/api/anime-cache-by-tmdb?tmdbId=${encodeURIComponent(tmdbId)}`);
        const data = await res.json().catch(() => ({}));
        return (res.ok && data?.exists) ? data : null;
    } catch (err) {
        console.warn('[myList] anime cache lookup failed, falling back to TMDB:', err.message);
        return null;
    }
}

async function resolveTvOrAnimeRow(item) {
    if (item.type === 'anime') {
        const cached = await fetchAnimeCacheRow(item.id);
        if (cached) {
            return {
                id: String(item.id),
                type: item.type,
                isAnime: true,
                title: cached.title || 'Unknown',
                poster: cached.thumbnail || '/img/LOGO_Short.png',
                rating: cached.rating || '--',
                year: cached.year ? String(cached.year) : ''
            };
        }
    }
    try {
        const res = await fetch(`/api/tmdb-proxy/tv/${item.id}`);
        const tv = await res.json();
        if (tv && (tv.name || tv.title)) {
            // Same heuristic moviePlayer.js's own isAnime check uses (Animation genre plus a
            // Japanese origin signal) - item.type alone is 'tv' for both real anime and plain
            // TV shows now that Kino TV/RU-MV TV support non-anime content too, so this is the
            // only real anime-or-not signal available here.
            const isAnime = item.type === 'anime' || !!(Array.isArray(tv.genres) && tv.genres.some(g => (g.name || '').toLowerCase() === 'animation')
                && ((tv.original_language || '').toLowerCase() === 'ja' || (Array.isArray(tv.origin_country) && tv.origin_country.includes('JP'))));
            return {
                id: String(item.id),
                type: item.type,
                isAnime,
                title: tv.name || tv.title || 'Unknown',
                poster: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : '/img/LOGO_Short.png',
                rating: tv.vote_average ? tv.vote_average.toFixed(1) : '--',
                year: toYear(tv.first_air_date)
            };
        }
    } catch (err) {
        console.warn('[myList] failed to fetch tv row:', err.message);
    }
    return null;
}

async function resolveMyListRecords(savedItems) {
    const localItems = savedItems.filter(i => i.type === 'movie');
    const tvItems = savedItems.filter(i => i.type === 'tv' || i.type === 'anime');
    const orderMap = new Map(savedItems.map((item, index) => [String(item.id), index]));

    const records = [];

    if (localItems.length > 0) {
        try {
            const baseUrl = '/movies/get-list';
            const requestUrl = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: localItems.map(i => i.id) })
            });
            const movies = await response.json();
            (movies || []).forEach(m => {
                records.push({
                    id: String(m.ID),
                    type: 'movie',
                    title: m['Movie Name'] || 'Unknown',
                    poster: m.poster_full_url || '/img/LOGO_Short.png',
                    rating: m.Rating || '--',
                    year: toYear(m.Year || m.release_date)
                });
            });
        } catch (err) {
            console.warn('[myList] failed to fetch local movie rows:', err.message);
        }
    }

    // These were fetched one at a time in a sequential for-loop -- each TMDB round trip
    // waiting for the last to finish before starting the next, turning a 20-show list into
    // 20x a single request's latency instead of roughly 1x. Fire them all in parallel.
    // Anime items also check the local AniList cache first (resolveTvOrAnimeRow); plain tv
    // items go straight to TMDB, same as before.
    const tvResults = await Promise.all(tvItems.map(resolveTvOrAnimeRow));
    records.push(...tvResults.filter(Boolean));

    records.sort((a, b) => {
        return (orderMap.get(String(a.id)) ?? 9999) - (orderMap.get(String(b.id)) ?? 9999);
    });

    return records;
}

async function resolveHistoryRecords(historyRows) {
    const typeMap = Object.fromEntries(historyRows.map(h => [String(h.movie_id), h.item_type || 'movie']));
    const movieItems = historyRows.filter(h => (h.item_type || 'movie') === 'movie');
    const tvItems = historyRows.filter(h => h.item_type === 'tv' || h.item_type === 'anime');
    const records = [];

    if (movieItems.length > 0) {
        try {
            const localMovies = await fetchMoviesByIds(movieItems.map(h => h.movie_id));
            localMovies.forEach(m => {
                const id = String(m.ID);
                const row = historyRows.find(h => String(h.movie_id) === id);
                records.push({
                    id,
                    type: typeMap[id] || 'movie',
                    title: m['Movie Name'] || 'Unknown',
                    poster: m.poster_full_url || '/img/LOGO_Short.png',
                    rating: m.Rating || '--',
                    year: toYear(m.Year || m.release_date),
                    watchedAt: row?.watched_at || ''
                });
            });
        } catch (err) {
            console.warn('[myList] failed to fetch history movie rows:', err.message);
        }
    }

    // Same sequential-loop fix as resolveMyListRecords -- parallelize instead of awaiting
    // each TMDB round trip one at a time. Anime rows also check the local AniList cache
    // first via resolveTvOrAnimeRow; plain tv rows go straight to TMDB, same as before.
    const tvResults = await Promise.all(tvItems.map(async row => {
        const base = await resolveTvOrAnimeRow({ id: row.movie_id, type: row.item_type || 'tv' });
        return base ? { ...base, watchedAt: row.watched_at || '' } : null;
    }));
    records.push(...tvResults.filter(Boolean));

    const historyIndex = new Map(historyRows.map((h, index) => [String(h.movie_id), index]));
    records.sort((a, b) => {
        return (historyIndex.get(String(a.id)) ?? 9999) - (historyIndex.get(String(b.id)) ?? 9999);
    });

    return records;
}

async function renderPersonalDiscoveryPanels() {
    updateModePills();

    const rawList = JSON.parse(localStorage.getItem('myList')) || [];
    const historyRows = await getHistoryRows(50);
    const historyTypeMap = Object.fromEntries(historyRows.map(h => [String(h.movie_id), h.item_type || 'movie']));
    // toggleMyList() appends newly-added items to the end of the array, so
    // reading it in storage order put the OLDEST addition first (leftmost) and
    // the newest last -- reversed here so it reads newest-first, same
    // direction as the History panel next to it.
    const savedItems = normalizeSavedItems(rawList, historyTypeMap).reverse();

    const [listRecords, historyRecords] = await Promise.all([
        resolveMyListRecords(savedItems),
        resolveHistoryRecords(historyRows)
    ]);

    renderPanelCards('myListDiscRow', 'myListPanelBg', applyModeFilter(listRecords), 'list');
    renderPanelCards('myHistoryDiscRow', 'myHistoryPanelBg', applyModeFilter(historyRecords), 'history');
}

document.addEventListener('DOMContentLoaded', async () => {
    const username = localStorage.getItem('username');
    const userUID = parseInt(localStorage.getItem('userUID'), 10) || 0;
    const titleElement = document.querySelector('.list-title');

    if (username && titleElement) {
        titleElement.innerText = `${username}'s List`;
    }

    await renderPersonalDiscoveryPanels();

    const bindModePill = (pillEl) => {
        if (!pillEl) return;
        pillEl.style.cursor = 'pointer';
        pillEl.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            openModeFlyout(pillEl);
        });
    };

    bindModePill(document.getElementById('myListModePill'));
    bindModePill(document.getElementById('myHistoryModePill'));

    // --- Render owner playlists under My List ---
    const playlistsGrid = document.getElementById('myPlaylistsGrid');
    if (!playlistsGrid || userUID === 0) return;

    try {
        const res = await fetch('/playlists');
        const playlists = await res.json();
        const owned = (playlists || []).filter(p => parseInt(p.ownerUID, 10) === userUID);

        if (!owned || owned.length === 0) {
            playlistsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">No playlists yet. Create one to get started!</p>';
        } else {
            const html = owned.map(p => {
                const poster = (p.movies && p.movies[0] && p.movies[0].poster) ? p.movies[0].poster : '/img/LOGO_Short.png';
                const count = (p.movies || []).length;
                return `
                    <div class="playlist-item" onclick="window.location.href='customPlaylists.html'" style="display: flex; gap: 12px; padding: 12px; background: #090909; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border: 1px solid rgb(22 22 22);">
                        <img src="${poster}" onerror="this.src='/img/LOGO_Short.png'" style="width: 60px; height: 90px; border-radius: 6px; object-fit: cover;">
                        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                            <h4 style="margin: 0 0 5px 0; font-size: 1rem; color: var(--text-primary);">${p.name}</h4>
                            <span style="font-size: 0.85rem; color: var(--text-muted);">${count} movies</span>
                        </div>
                    </div>
                `;
            }).join('');

            playlistsGrid.innerHTML = html;
        }
    } catch (err) {
        console.error('Playlist load error:', err);
        playlistsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Could not load playlists.</p>';
    }

    await loadRecentPosts(userUID);
});

// Your Comments (anime/movie switch) -- was "Recent Posts", pulling from the
// forum via an N+1 fetch (every forum movie, then every one of ITS threads,
// filtered client-side by userUID). Forum threads are a separate, unrelated
// system from anime_comments/movie_comments anyway (see indexMain.html's
// "Your Comments" widget, same idea, ported here). One request per mode via
// the same /api/anime-comments/by-user and /movie-comments/by-user used there.
let plCommentsMode = null;

// A raw gif link is one unbroken "word" with no spaces, so it stretches the
// whole comment block sideways instead of wrapping -- render it as an actual
// thumbnail (and let any other text wrap normally) instead of raw text.
const GIF_URL_RE = /(https?:\/\/\S+\.gif(?:\?\S*)?)/i;
function renderCommentBody(text) {
    const raw = String(text || '');
    const textHtml = `<p style="margin: 0 0 6px 0; font-size: 0.9rem; color: var(--text-primary); overflow-wrap: anywhere; word-break: break-word; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${escapeHtml(raw)}</p>`;
    const match = raw.match(GIF_URL_RE);
    if (!match) return textHtml;
    const gifImg = `<img src="${escapeHtml(match[1])}" alt="gif" loading="lazy" style="max-width: 100%; max-height: 160px; border-radius: 8px; display: block; margin-top: 4px;">`;
    return raw.trim() === match[1] ? gifImg : textHtml + gifImg;
}

async function loadRecentPosts(userUID, mode) {
    const container = document.getElementById('recentPostsContainer');
    if (!container || !userUID) return;
    if (mode) plCommentsMode = mode;
    if (!plCommentsMode) plCommentsMode = localStorage.getItem('animeMode') === 'true' ? 'anime' : 'movie';

    document.querySelectorAll('#plCommentsModeSwitch .cp-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cpMode === plCommentsMode);
    });

    container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Loading...</p>';

    try {
        const endpoint = plCommentsMode === 'anime' ? '/api/anime-comments/by-user' : '/movie-comments/by-user';
        const res = await fetch(`${endpoint}?userUID=${encodeURIComponent(userUID)}&limit=5`);
        if (!res.ok) throw new Error(res.status);
        const comments = await res.json();

        if (!comments.length) {
            const hint = plCommentsMode === 'anime' ? 'No anime comments yet.' : 'No movie comments yet.';
            container.innerHTML = `<p style="color: var(--text-muted); padding: 20px; text-align: center;">${hint}</p>`;
            return;
        }

        container.innerHTML = comments.map(c => {
            const timeAgo = formatTimeAgo((c.created_at || 0) * 1000);
            const onLabel = plCommentsMode === 'anime'
                ? `Ep ${c.episode_number}${c.animeTitle ? ` · ${escapeHtml(c.animeTitle)}` : ''}`
                : escapeHtml(c.movieTitle || 'Untitled');
            const href = plCommentsMode === 'anime'
                ? (c.tmdbId ? `/html/movieInfo.html?id=${c.tmdbId}&type=anime` : '#')
                : `/html/movieInfo.html?id=${encodeURIComponent(c.movie_id)}&type=movie`;
            return `
                <div class="post-item" onclick="window.location.href='${href}'" style="padding: 12px; background: #090909; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border: 1px solid rgb(22 22 22);">
                    <div style="display: flex; align-items: start; gap: 10px;">
                        <span style="font-size: 1.2rem;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:1em;height:1em;vertical-align:-0.15em;color:var(--accent-primary, #f96d00);"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg></span>
                        <div style="flex: 1; min-width: 0;">
                            ${renderCommentBody(c.text)}
                            <div style="display: flex; gap: 12px; font-size: 0.8rem; color: var(--text-muted);">
                                <span>on “${onLabel}”</span>
                                <span>▲ ${c.upvotes || 0}</span>
                                ${timeAgo ? `<span><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:1em;height:1em;vertical-align:-0.15em;color:var(--accent-primary, #f96d00);"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" /></svg> ${timeAgo}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading comments:', err);
        container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Could not load your comments.</p>';
    }
}

document.getElementById('plCommentsModeSwitch')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cp-mode-btn');
    if (!btn) return;
    const userUID = parseInt(localStorage.getItem('userUID'), 10) || 0;
    loadRecentPosts(userUID, btn.dataset.cpMode);
});

// Format time ago
function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// HTML escape function
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function findDiscoveryCard(rowId, id) {
    const row = document.getElementById(rowId);
    if (!row) return null;
    return Array.from(row.querySelectorAll('.disc-card[data-item-id]')).find(card => String(card.dataset.itemId) === String(id)) || null;
}

function refreshPanelAfterRemoval(rowId, panelBgId, kind) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const cards = row.querySelectorAll('.disc-card[data-item-id]');
    if (cards.length === 0) {
        row.innerHTML = getEmptyPanelHTML(kind);
        setPanelBackground(panelBgId, []);
        return;
    }

    cards.forEach((card, index) => {
        const num = card.querySelector('.disc-card-num');
        if (num) num.textContent = String(index + 1).padStart(2, '0');
    });

    const first = cards[0];
    const firstImg = first.querySelector('.disc-card-img');
    const bg = document.getElementById(panelBgId);
    if (bg && firstImg && firstImg.getAttribute('src')) {
        bg.style.backgroundImage = `url('${firstImg.getAttribute('src')}')`;
    }
}

window.removeFromList = function(id, evt) {
    const existing = document.getElementById('__deleteConfirmPopup');
    if (existing) existing.remove();
    const popup = document.createElement('div');
    popup.id = '__deleteConfirmPopup';
    popup.style.cssText = 'position:fixed;z-index:99999;background:#1a1a1a;border:1.5px solid #e53935;border-radius:10px;padding:16px 20px;color:#fff;font-family:inherit;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,0.6);min-width:220px;text-align:center;';
    if (evt) {
        popup.style.left = Math.min(evt.clientX, window.innerWidth - 260) + 'px';
        popup.style.top  = Math.min(evt.clientY, window.innerHeight - 120) + 'px';
    } else {
        popup.style.left = '50%'; popup.style.top = '50%'; popup.style.transform = 'translate(-50%,-50%)';
    }
    popup.innerHTML = `
        <div style="margin-bottom:12px;font-size:15px;font-weight:600;">Remove from My List?</div>
        <div style="display:flex;gap:10px;justify-content:center;">
            <button id="__deleteYes" style="background:#e53935;color:#fff;border:none;outline:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;font-weight:600;">Yes, remove</button>
            <button id="__deleteNo"  style="background:#333;color:#ccc;border:none;outline:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;">Cancel</button>
        </div>`;
    document.body.appendChild(popup);
    document.getElementById('__deleteNo').onclick = () => popup.remove();
    document.getElementById('__deleteYes').onclick = async () => {
        popup.remove();
        let list = JSON.parse(localStorage.getItem('myList')) || [];
        list = list.filter(item => (typeof item === 'object' && item !== null) ? String(item.id) !== String(id) : String(item) !== String(id));
        localStorage.setItem('myList', JSON.stringify(list));
        try {
            const userUID = localStorage.getItem('userUID');
            if (userUID) await fetch('/activity/list/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userUID, item_id: String(id) })
            });
        } catch(e) { console.warn('[removeFromList] failed:', e.message); }
        const card = findDiscoveryCard('myListDiscRow', id);
        if (card) {
            card.style.transition = 'opacity 0.25s,transform 0.25s';
            card.style.opacity = '0'; card.style.transform = 'scale(0.9)';
            setTimeout(() => {
                card.remove();
                refreshPanelAfterRemoval('myListDiscRow', 'myListPanelBg', 'list');
            }, 250);
        } else { location.reload(); }
    };
    setTimeout(() => { document.addEventListener('click', function c(e) { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', c); } }); }, 50);
};

window.removeFromHistory = function(id, evt) {
    const existing = document.getElementById('__deleteConfirmPopup');
    if (existing) existing.remove();
    const popup = document.createElement('div');
    popup.id = '__deleteConfirmPopup';
    popup.style.cssText = 'position:fixed;z-index:99999;background:#1a1a1a;border:1.5px solid #e53935;border-radius:10px;padding:16px 20px;color:#fff;font-family:inherit;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,0.6);min-width:220px;text-align:center;';
    if (evt) {
        popup.style.left = Math.min(evt.clientX, window.innerWidth - 260) + 'px';
        popup.style.top  = Math.min(evt.clientY, window.innerHeight - 120) + 'px';
    } else {
        popup.style.left = '50%'; popup.style.top = '50%'; popup.style.transform = 'translate(-50%,-50%)';
    }
    popup.innerHTML = `
        <div style="margin-bottom:12px;font-size:15px;font-weight:600;">Remove from History?</div>
        <div style="display:flex;gap:10px;justify-content:center;">
            <button id="__deleteYes" style="background:#e53935;color:#fff;border:none;outline:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;font-weight:600;">Yes, remove</button>
            <button id="__deleteNo"  style="background:#333;color:#ccc;border:none;outline:none;border-radius:6px;padding:7px 18px;font-size:13px;cursor:pointer;">Cancel</button>
        </div>`;
    document.body.appendChild(popup);
    document.getElementById('__deleteNo').onclick = () => popup.remove();
    document.getElementById('__deleteYes').onclick = async () => {
        popup.remove();
        try {
            const userUID = localStorage.getItem('userUID');
            if (userUID) await fetch('/activity/history/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userUID, movie_id: String(id) })
            });
        } catch(e) { console.warn('[removeFromHistory] failed:', e.message); }
        const card = findDiscoveryCard('myHistoryDiscRow', id);
        if (card) {
            card.style.transition = 'opacity 0.25s,transform 0.25s';
            card.style.opacity = '0'; card.style.transform = 'scale(0.9)';
            setTimeout(() => {
                card.remove();
                refreshPanelAfterRemoval('myHistoryDiscRow', 'myHistoryPanelBg', 'history');
            }, 250);
        } else { location.reload(); }
    };
    setTimeout(() => { document.addEventListener('click', function c(e) { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', c); } }); }, 50);
};
