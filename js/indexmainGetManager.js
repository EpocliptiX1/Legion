/* indexMain page manager: discovery panels + home widgets */

(function () {
    const TMDB_MOVIE_GENRES = {
        28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
        18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
        9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller',
        10752: 'War', 37: 'Western'
    };

    const TMDB_TV_GENRES = {
        10759: 'Action', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama',
        10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality',
        10765: 'Sci-Fi', 10766: 'Soap', 10767: 'Talk', 10768: 'War', 37: 'Western'
    };

    const TRENDING_GENRE_ACCENTS = {
        Action: '#f96d00',
        Adventure: '#ff934f',
        Animation: '#41c7b9',
        Comedy: '#f2c94c',
        Crime: '#d94f4f',
        Documentary: '#5bb6ff',
        Drama: '#d96c8e',
        Family: '#63d6c7',
        Fantasy: '#4f7cff',
        History: '#b58a5a',
        Horror: '#c44536',
        Music: '#ff7a59',
        Mystery: '#6f86d6',
        News: '#51a3ff',
        Kids: '#79d65f',
        Reality: '#00b8a9',
        Romance: '#ff6f91',
        'Sci-Fi': '#42b3ff',
        Soap: '#f08db4',
        Talk: '#ffb347',
        Thriller: '#ff5f5f',
        'TV Movie': '#7ad3ff',
        War: '#8c6b4f',
        Western: '#c97b36'
    };

    function getTrendingGenreAccent(name) {
        return TRENDING_GENRE_ACCENTS[name] || '#f96d00';
    }

    function safeHtmlText(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeJsString(text) {
        return String(text || '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

    async function resolveAniListItemTmdbId(item) {
        if (!item || !item.id) return null;
        const params = new URLSearchParams({ anilistId: String(item.id) });
        if (item.title?.english) params.set('titleEnglish', String(item.title.english));
        if (item.title?.romaji) params.set('titleRomaji', String(item.title.romaji));
        if (item.title?.native) params.set('titleNative', String(item.title.native));
        if (item.idMal) params.set('malId', String(item.idMal));

        try {
            const res = await fetch(`/api/anime-tmdb-id?${params.toString()}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.tmdb_id || null;
        } catch (err) {
            return null;
        }
    }

    async function fetchAnimeTrendingItems(page = 1, perPage = 18) {
        const res = await fetch(`/api/anime-row?rowKey=TRENDING&page=${page}&perPage=${perPage}`);
        if (!res.ok) throw new Error(`Anime trending row request failed: ${res.status}`);
        return await res.json();
    }

    function renderAnimeTrendingCard(item, tmdbId, index) {
        const title = item.title?.english || item.title?.romaji || item.title?.native || 'Unknown';
        const poster = item.coverImage?.extraLarge || '/img/noposter.jpg';
        const year = item.startDate?.year ? String(item.startDate.year) : '----';
        const rating = item.averageScore != null ? (item.averageScore / 10).toFixed(1) : '--';
        const num = String(index + 1).padStart(2, '0');
        const rankClass = index < 3 ? `rank-top-${index + 1}` : '';
        const safeTitle = safeHtmlText(title);
        const safeTitleJs = escapeJsString(title);
        const meta = `${year}${rating !== '--' ? ` · ★ ${rating}` : ''}`;

        if (tmdbId) {
            const href = `/html/movieInfo.html?id=${tmdbId}&type=tv`;
            return `<a class="disc-card ${rankClass}" href="${href}">
                <img class="disc-card-img" src="${poster}" alt="" loading="lazy">
                <span class="disc-card-num">${num}</span>
                <div class="disc-card-info">
                    <div class="disc-card-title">${safeTitle}</div>
                    <div class="disc-card-meta">${meta}</div>
                </div>
            </a>`;
        }

        return `<a class="disc-card ${rankClass}" href="#" onclick="window.navigateToAnimeByTitle('${safeTitleJs}'); return false;">
            <img class="disc-card-img" src="${poster}" alt="" loading="lazy">
            <span class="disc-card-num">${num}</span>
            <div class="disc-card-info">
                <div class="disc-card-title">${safeTitle}</div>
                <div class="disc-card-meta">${meta}</div>
            </div>
        </a>`;
    }

    async function loadAnimeTrendingRanked(list, panelBg, pills) {
        const items = await fetchAnimeTrendingItems(1, 18);
        if (!Array.isArray(items) || !items.length) {
            list.innerHTML = '<p style="color:#555;font-size:.8rem;padding:10px">No trending anime available.</p>';
            if (pills) pills.innerHTML = '';
            return;
        }

        if (panelBg) {
            const bg = items[0].bannerImage || items[0].coverImage?.extraLarge || '';
            if (bg) panelBg.style.backgroundImage = `url('${bg}')`;
        }

        if (pills) {
            const genreNames = Array.isArray(items[0].genres) && items[0].genres.length
                ? items[0].genres.filter(Boolean).slice(0, 8)
                : ['Anime'];
            pills.innerHTML = genreNames.map(name => `
                <div class="trending-genre-pill" style="--genre-accent:${getTrendingGenreAccent(name)};">
                    <span class="trending-genre-mark"></span>
                    <span class="trending-genre-text">${safeHtmlText(name)}</span>
                </div>`).join('');
        }

        const tmdbIds = await Promise.all(items.map(item => resolveAniListItemTmdbId(item)));
        list.innerHTML = items.map((item, i) => renderAnimeTrendingCard(item, tmdbIds[i], i)).join('');
    }

    /* ── Trending Now: TMDB weekly trending (anime-mode aware) ── */
    async function loadTrendingRanked() {
        const list = document.getElementById('trendingRankedList');
        const panelBg = document.getElementById('trendingPanelBg');
        const pills = document.getElementById('trendingGenrePills');
        if (!list) return;
        try {
            const isAnime = !!window.__animeMode;
            if (isAnime) {
                await loadAnimeTrendingRanked(list, panelBg, pills);
                return;
            }

            const endpoint = '/api/tmdb-proxy/trending/movie/week';
            const res = await fetch(endpoint);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const items = data.results || [];

            if (panelBg && items[0]) {
                const bg = items[0].backdrop_path
                    ? `https://image.tmdb.org/t/p/w780${items[0].backdrop_path}`
                    : (items[0].poster_path ? `https://image.tmdb.org/t/p/w500${items[0].poster_path}` : '');
                if (bg) panelBg.style.backgroundImage = `url('${bg}')`;
            }

            if (pills) {
                const genreNames = [];
                const seen = new Set();
                items.forEach(item => {
                    (item.genre_ids || []).forEach(id => {
                        const name = TMDB_MOVIE_GENRES[id];
                        if (name && !seen.has(name)) {
                            seen.add(name);
                            genreNames.push(name);
                        }
                    });
                });
                pills.innerHTML = genreNames.slice(0, 8).map(name => `
                    <div class="trending-genre-pill" style="--genre-accent:${getTrendingGenreAccent(name)};">
                        <span class="trending-genre-mark"></span>
                        <span class="trending-genre-text">${name}</span>
                    </div>`).join('');
            }

            list.innerHTML = items.slice(0, 20).map((m, i) => {
                const href = `/html/movieInfo.html?id=${m.id}&type=movie`;
                const poster = m.poster_path
                    ? `https://image.tmdb.org/t/p/w185${m.poster_path}`
                    : '/img/noposter.jpg';
                const year = (m.release_date || '').slice(0, 4);
                const rating = m.vote_average ? m.vote_average.toFixed(1) : '--';
                const num = String(i + 1).padStart(2, '0');
                const rankClass = i < 3 ? `rank-top-${i + 1}` : '';
                const title = (m.title || 'Unknown').replace(/'/g, '&#39;');
                return `<a class="disc-card ${rankClass}" href="${href}">
                    <img class="disc-card-img" src="${poster}" alt="" loading="lazy">
                    <span class="disc-card-num">${num}</span>
                    <div class="disc-card-info">
                        <div class="disc-card-title">${title}</div>
                        <div class="disc-card-meta">${year}${rating !== '--' ? ' · ★ ' + rating : ''}</div>
                    </div>
                </a>`;
            }).join('');
        } catch (e) {
            list.innerHTML = '<p style="color:#555;font-size:.8rem;padding:10px">Could not load trending.</p>';
            if (pills) pills.innerHTML = '';
        }
    }

    /* ── This Week's Schedule: Jikan v4 schedules ───────── */
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const scheduleCache = {};

    function toIsoDateLocal(date) {
        const d = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
        return d.toISOString().slice(0, 10);
    }

    function getDateAfterDays(offset) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        return d;
    }

    function getWeekStartMonday(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d;
    }

    function getMovieWeekRange(weekIdx) {
        const baseMonday = getWeekStartMonday(new Date());
        const start = new Date(baseMonday);
        start.setDate(baseMonday.getDate() + (weekIdx * 7));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { start, end };
    }

    function setSchedulePanelModeUI() {
        const titleNode = document.querySelector('#schedulePanelBg + .discovery-panel-content .discovery-panel-title');
        if (!titleNode) return;
        if (window.__animeMode) {
            titleNode.innerHTML = '<span class="discovery-accent">⛩</span> This Week\'s Schedule';
        } else {
            titleNode.innerHTML = '<span class="discovery-accent">🎬</span> This Week\'s Movie Schedule';
        }
    }

    async function fetchMovieWeekSchedule(weekIdx) {
        const { start, end } = getMovieWeekRange(weekIdx);
        const weekStart = toIsoDateLocal(start);
        const weekEnd = toIsoDateLocal(end);
        const cacheKey = `movie-week-${weekStart}`;
        if (!scheduleCache[cacheKey]) {
            // `release_date.gte/lte` matches ANY regional release-date entry on a movie (a
            // re-release, digital release, festival premiere, etc.), not just its real release --
            // that let decades-old films leak into "this week". `primary_release_date.gte/lte`
            // filters against the single canonical release date instead.
            const queries = [
                `/api/tmdb-proxy/discover/movie?language=en-US&sort_by=popularity.desc&include_adult=false&primary_release_date.gte=${weekStart}&primary_release_date.lte=${weekEnd}&page=1`,
                `/api/tmdb-proxy/discover/movie?language=en-US&sort_by=popularity.desc&include_adult=false&primary_release_date.gte=${weekStart}&primary_release_date.lte=${weekEnd}&page=2`,
                `/api/tmdb-proxy/discover/movie?language=en-US&sort_by=popularity.desc&include_adult=false&primary_release_date.gte=${weekStart}&primary_release_date.lte=${weekEnd}&page=3`
            ];

            const responses = await Promise.allSettled(queries.map(q => fetch(q)));
            const payloads = await Promise.all(
                responses.map(async (r) => {
                    if (r.status !== 'fulfilled' || !r.value.ok) return { results: [] };
                    try {
                        return await r.value.json();
                    } catch {
                        return { results: [] };
                    }
                })
            );

            const merged = payloads.flatMap(p => p.results || []);
            const uniq = [];
            const seen = new Set();
            for (const item of merged) {
                // No poster means it's almost always obscure homemade/unreleasable filler --
                // not worth showing in the schedule widget.
                if (!item || !item.id || !item.poster_path || seen.has(item.id)) continue;
                seen.add(item.id);
                uniq.push(item);
            }
            scheduleCache[cacheKey] = uniq;
        }
        return scheduleCache[cacheKey];
    }

    function getTodayIndex() {
        const d = new Date().getDay(); // 0=Sun
        return d === 0 ? 6 : d - 1;    // 0=Mon…6=Sun
    }

    async function loadScheduleDay(dayIdx) {
        const tabs = document.querySelectorAll('.schedule-day-tab');
        tabs.forEach((t, i) => t.classList.toggle('sch-active', i === dayIdx));
        setSchedulePanelModeUI();

        const list = document.getElementById('scheduleAnimeList');
        if (!list) return;
        list.innerHTML = window.__animeMode
            ? '<p style="color:#444;font-size:.78rem;padding:10px">Loading schedule...</p>'
            : '<p style="color:#444;font-size:.78rem;padding:10px">Loading movie schedule...</p>';

        if (!window.__animeMode) {
            try {
                const weekMovies = await fetchMovieWeekSchedule(dayIdx);
                const { start, end } = getMovieWeekRange(dayIdx);
                const weekStartIso = toIsoDateLocal(start);
                const weekEndIso = toIsoDateLocal(end);
                const weeklyRows = weekMovies
                    .filter(m => {
                        const d = (m.release_date || '').slice(0, 10);
                        return d && d >= weekStartIso && d <= weekEndIso;
                    })
                    .sort((a, b) => {
                        const da = (a.release_date || '9999-12-31');
                        const db = (b.release_date || '9999-12-31');
                        if (da !== db) return da.localeCompare(db);
                        return (b.popularity || 0) - (a.popularity || 0);
                    })
                    .slice(0, 14);

                if (!weeklyRows.length) {
                    list.innerHTML = '<p style="color:#555;font-size:.78rem;padding:10px">No movie releases found for this week.</p>';
                    return;
                }

                const panelBg = document.getElementById('schedulePanelBg');
                if (panelBg) {
                    const top = [...weeklyRows].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
                    const bgImg = top.backdrop_path
                        ? `https://image.tmdb.org/t/p/w780${top.backdrop_path}`
                        : (top.poster_path ? `https://image.tmdb.org/t/p/w500${top.poster_path}` : '');
                    if (bgImg) panelBg.style.backgroundImage = `url('${bgImg}')`;
                }

                list.innerHTML = weeklyRows.map(m => {
                    const img = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '/img/noposter.jpg';
                    const dateText = (m.release_date || '').slice(5, 10).replace('-', '/');
                    const score = m.vote_average ? `★ ${m.vote_average.toFixed(1)}` : '';
                    const title = (m.title || 'Unknown').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
                    const href = `/html/movieInfo.html?id=${m.id}&type=movie`;

                    return `<a class="disc-card disc-card-schedule" href="${href}">
                        <img class="disc-card-img" src="${img}" alt="" loading="lazy">
                        <span class="disc-card-time">${dateText || 'TBA'}</span>
                        <div class="disc-card-info">
                            <div class="disc-card-title">${title}</div>
                            <div class="disc-card-meta">${score || 'Upcoming'}</div>
                        </div>
                    </a>`;
                }).join('');
                return;
            } catch (e) {
                list.innerHTML = '<p style="color:#555;font-size:.78rem;padding:10px">Could not load movie schedule.</p>';
                return;
            }
        }

        const day = DAYS[dayIdx];
        if (!scheduleCache[day]) {
            try {
                const monday = getWeekStartMonday(new Date());
                const dateForDay = new Date(monday);
                dateForDay.setDate(monday.getDate() + dayIdx);
                const dateIso = toIsoDateLocal(dateForDay);

                const res = await fetch(`/api/anime-schedule?date=${encodeURIComponent(dateIso)}`);
                if (!res.ok) throw new Error(res.status);
                const data = await res.json();
                scheduleCache[day] = data.data || [];
            } catch (e) {
                list.innerHTML = '<p style="color:#555;font-size:.78rem;padding:10px">Could not load schedule.</p>';
                return;
            }
        }

        const animes = scheduleCache[day];
        if (!animes.length) {
            list.innerHTML = '<p style="color:#555;font-size:.78rem;padding:10px">No schedule data for this day.</p>';
            return;
        }

        // Set schedule panel background from most popular anime of the day
        const panelBg = document.getElementById('schedulePanelBg');
        if (panelBg && animes.length) {
            const top = [...animes].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
            const bgImg = top.images?.jpg?.large_image_url || top.images?.jpg?.image_url || '';
            if (bgImg) panelBg.style.backgroundImage = `url('${bgImg}')`;
        }

        // ── Resolve all TMDB IDs in parallel via title search ────────────
        const slice = animes.slice(0, 14);

        function buildTitleCandidates(title) {
            const candidates = [title];
            const add = (c) => { if (c && c !== title && !candidates.includes(c)) candidates.push(c); };

            add(title.replace(/\s+(Season\s+\d+|\d+(st|nd|rd|th)\s+Season)$/i, '').trim());
            add(title.replace(/\s+(Part\s+\d+|Cour\s+\d+|\d+(st|nd|rd|th)\s+Part)$/i, '').trim());
            add(title.replace(/\s*[:\-–]\s*(Part|Season)?\s*(II|III|IV|V|VI|VII|VIII|IX|X)$/i, '').trim());
            add(title.replace(/\s+(II|III|IV|VI{0,3}|IX|X)$/, '').trim());
            add(title.replace(/\s+\d+$/, '').trim());
            add(title.split(/[:\-–]/)[0].trim());

            return candidates;
        }

        async function tmdbTitleSearch(q) {
            const trySearch = async (query) => {
                const r = await fetch(`/api/tmdb-proxy/search/tv?query=${encodeURIComponent(query)}&language=en-US`);
                if (!r.ok) return null;
                const d = await r.json();
                return (d.results || [])[0] || null;
            };

            for (const candidate of buildTitleCandidates(q)) {
                const hit = await trySearch(candidate);
                if (hit) return hit.id;
            }
            return null;
        }

        const tmdbIds = await Promise.all(
            slice.map(a => tmdbTitleSearch(a.title_english || a.title || ''))
        );

        const parseScheduleTime = (value) => {
            const text = String(value || '').trim();
            const match = text.match(/^(\d{1,2}):(\d{2})$/);
            if (!match) return Number.POSITIVE_INFINITY;
            return (Number(match[1]) * 60) + Number(match[2]);
        };

        const renderedCards = slice.map((a, idx) => {
            const img = a.images?.jpg?.image_url || '';
            const time = a.broadcast?.time || '--:--';
            const score = a.score ? `★ ${parseFloat(a.score).toFixed(1)}` : '';
            const ep = a.episodes ? `${a.episodes} eps` : 'Ongoing';
            const title = (a.title_english || a.title || 'Unknown').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
            const tmdbId = tmdbIds[idx];

            if (!tmdbId) {
                return {
                    unavailable: true,
                    html: `<div class="disc-card disc-card-schedule sch-unavailable">
                    <img class="disc-card-img" src="${img}" alt="" loading="lazy">
                    <span class="disc-card-time">${time}</span>
                    <div class="disc-card-info">
                        <div class="disc-card-title">${title}</div>
                        <div class="disc-card-meta">${ep}</div>
                    </div>
                    <span class="disc-card-unavail">N/A</span>
                </div>`
                };
            }

            const href = `/html/movieInfo.html?id=${tmdbId}&type=tv`;
            return {
                unavailable: false,
                html: `<a class="disc-card disc-card-schedule" href="${href}">
                <img class="disc-card-img" src="${img}" alt="" loading="lazy">
                <span class="disc-card-time">${time}</span>
                <div class="disc-card-info">
                    <div class="disc-card-title">${title}</div>
                    <div class="disc-card-meta">${score}${score ? ' · ' : ''}${ep}</div>
                </div>
            </a>`
            };
        });

        const availableCards = renderedCards
            .filter(card => !card.unavailable)
            .sort((a, b) => parseScheduleTime(a.time) - parseScheduleTime(b.time));

        const unavailableCards = renderedCards
            .filter(card => card.unavailable)
            .sort((a, b) => parseScheduleTime(a.time) - parseScheduleTime(b.time));

        list.innerHTML = [...availableCards, ...unavailableCards]
            .map(card => card.html)
            .join('');
    }

    function buildDayTabs() {
        const container = document.getElementById('scheduleDayTabs');
        if (!container) return;
        if (window.__animeMode) {
            container.innerHTML = DAY_LABELS.map((label, i) =>
                `<button class="schedule-day-tab" onclick="window.__loadScheduleDay(${i})">${label}</button>`
            ).join('');
            return;
        }

        container.innerHTML = Array.from({ length: 7 }).map((_, i) => {
            const { start, end } = getMovieWeekRange(i);
            const sm = String(start.getMonth() + 1).padStart(2, '0');
            const sd = String(start.getDate()).padStart(2, '0');
            const em = String(end.getMonth() + 1).padStart(2, '0');
            const ed = String(end.getDate()).padStart(2, '0');
            const label = `W${i + 1} ${sm}/${sd}-${em}/${ed}`;
            return `<button class="schedule-day-tab" onclick="window.__loadScheduleDay(${i})">${label}</button>`;
        }).join('');
    }

    window.__loadScheduleDay = loadScheduleDay;

    function dismissPageOverlay() {
        if (window.dismissPageLoadingOverlay) {
            window.dismissPageLoadingOverlay('pageLoadingOverlay');
        }
    }

    document.addEventListener('DOMContentLoaded', async function () {
        // Safety: always dismiss after 12s even if something hangs
        const safetyTimer = setTimeout(dismissPageOverlay, 12000);

        buildDayTabs();
        await Promise.all([
            loadTrendingRanked(),
            loadScheduleDay(window.__animeMode ? getTodayIndex() : 0)
        ]);

        clearTimeout(safetyTimer);
        // Brief pause so the rendered cards have a moment to paint
        setTimeout(dismissPageOverlay, 120);
    });
})();

(function () {
    /* helpers */
    function timeAgo(ts) {
        if (!ts) return '';
        const diff = Date.now() - new Date(ts).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }

    /* ── Quick Stats ─────────────────────────────────── */
    async function loadQuickStats() {
        const row = document.getElementById('quickStatsRow');
        if (!row) return;
        const username = localStorage.getItem('username');
        const userUID = localStorage.getItem('userUID');
        const tier = localStorage.getItem('userTier') || 'Free';
        if (!username || !userUID) {
            row.innerHTML = '<div class="qs-guest">Sign in to see your personal stats</div>';
            return;
        }
        const [histRes, listRes, genreRes] = await Promise.all([
            fetch(`/activity/history?userUID=${encodeURIComponent(userUID)}&limit=50`).then(r => r.ok ? r.json() : []).catch(() => []),
            fetch(`/activity/list?userUID=${encodeURIComponent(userUID)}`).then(r => r.ok ? r.json() : []).catch(() => []),
            fetch(`/activity/genres?userUID=${encodeURIComponent(userUID)}`).then(r => r.ok ? r.json() : []).catch(() => [])
        ]);
        const watched = (histRes || []).length;
        const listCount = (listRes || []).length;
        const topGenre = (genreRes || [])[0]?.genre || '—';
        const tierColors = { Gold: '#f7c843', Silver: '#a0aec0', Platinum: '#6ae4ff', Free: '#666' };
        const tierColor = tierColors[tier] || '#666';
        row.innerHTML = `
            <div class="qs-stat">
                <div class="qs-val">${username.replace(/</g, '&lt;')}</div>
                <div class="qs-label">Signed in as <span class="qs-tier" style="color:${tierColor}">${tier}</span></div>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-stat">
                <div class="qs-val">${watched}</div>
                <div class="qs-label">Watched</div>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-stat">
                <div class="qs-val">${listCount}</div>
                <div class="qs-label">In My List</div>
            </div>
            <div class="qs-divider"></div>
            <div class="qs-stat">
                <div class="qs-val" style="font-size:0.95rem">${topGenre}</div>
                <div class="qs-label">Top Genre</div>
            </div>`;
    }

    /* ── Community Pulse ─────────────────────────────── */
    async function loadCommunityPulse() {
        const list = document.getElementById('communityPulseList');
        if (!list) return;
        try {
            const res = await fetch('/forum/threads');
            if (!res.ok) throw new Error(res.status);
            const threads = await res.json();
            const top = threads.filter(t => (t.score || 0) > -1).slice(0, 3);
            if (!top.length) {
                list.innerHTML = '<div class="cp-empty">No threads yet. <a href="/html/forum.html" style="color:#f96d00">Start one →</a></div>';
                return;
            }
            list.innerHTML = top.map(t => {
                const safe = (t.title || 'Untitled').replace(/</g, '&lt;');
                const ago = timeAgo(t.createdAt);
                return `<a class="cp-thread" href="/html/forum.html">
                    <div class="cp-thread-title">${safe}</div>
                    <div class="cp-thread-meta">
                        <span class="cp-score">▲ ${t.score || 0}</span>
                        <span class="cp-dot">·</span>
                        <span>${t.commentCount || 0} comments</span>
                        ${ago ? `<span class="cp-dot">·</span><span>${ago}</span>` : ''}
                    </div>
                </a>`;
            }).join('');
        } catch {
            list.innerHTML = '<div class="cp-empty">Could not load threads.</div>';
        }
    }

    /* ── Platform Announcements ──────────────────────── */
    function renderAnnouncements() {
        const list = document.getElementById('announcementsList');
        if (!list) return;
        const ANNOUNCEMENTS = [
            { date: 'May 3, 2026', title: 'Legion Space v2 Home Page', body: 'Rebuilt home with trending panels, anime schedule, and this dashboard.' },
            { date: 'Apr 28, 2026', title: 'TMDB Global Catalog live', body: 'Millions of titles now browsable with full metadata from TMDB.' },
            { date: 'Apr 20, 2026', title: 'Forum & Reviews', body: 'Community threads, upvotes, and per-movie ratings are fully live.' }
        ];
        list.innerHTML = ANNOUNCEMENTS.map(a => `
            <div class="ann-item">
                <div class="ann-date">${a.date}</div>
                <div class="ann-title">${a.title}</div>
                <div class="ann-body">${a.body}</div>
            </div>`).join('');
    }

    /* ── Random Discovery ────────────────────────────── */
    async function fetchRandomTmdbMovieId() {
        const randomPage = 1 + Math.floor(Math.random() * 500);
        const res = await fetch(`/api/tmdb-proxy/discover/movie?language=en-US&sort_by=popularity.desc&vote_count.gte=200&page=${randomPage}`);
        if (!res.ok) throw new Error('TMDB discover failed');
        const data = await res.json();
        const results = data.results || [];
        if (!results.length) throw new Error('No TMDB movies');
        const pick = results[Math.floor(Math.random() * results.length)];
        return { id: pick.id, type: 'movie' };
    }

    async function resolveTmdbFromMalAnime(anime) {
        const malId = anime && anime.mal_id;
        if (!malId) return null;

        // Required order: MAL id first, then TMDB mapping
        const extRes = await fetch(`https://api.jikan.moe/v4/anime/${malId}/external`);
        if (extRes.ok) {
            const extData = await extRes.json();
            const links = extData.data || [];
            const tmdbLink = links.find(e => /themoviedb\.org\/(tv|movie)\/\d+/i.test(e.url || ''));
            if (tmdbLink && tmdbLink.url) {
                const m = tmdbLink.url.match(/themoviedb\.org\/(tv|movie)\/(\d+)/i);
                if (m) return { type: m[1].toLowerCase(), id: parseInt(m[2], 10) };
            }
        }

        // Fallback: still MAL-first (use MAL title to find TMDB)
        const q = anime.title_english || anime.title || '';
        if (!q) return null;

        const trySearch = async (kind) => {
            const r = await fetch(`/api/tmdb-proxy/search/${kind}?query=${encodeURIComponent(q)}&language=en-US`);
            if (!r.ok) return null;
            const d = await r.json();
            const first = (d.results || [])[0];
            return first ? { type: kind, id: first.id } : null;
        };

        return (await trySearch('tv')) || (await trySearch('movie'));
    }

    async function fetchRandomAnimeViaMalThenTmdb() {
        for (let i = 0; i < 4; i++) {
            const jikanRes = await fetch('https://api.jikan.moe/v4/random/anime');
            if (!jikanRes.ok) continue;
            const jikan = await jikanRes.json();
            const anime = jikan.data;
            if (!anime || !anime.mal_id) continue;
            const tmdbTarget = await resolveTmdbFromMalAnime(anime).catch(() => null);
            if (tmdbTarget && tmdbTarget.id) return tmdbTarget;
        }
        throw new Error('Could not map MAL anime to TMDB');
    }

    function initRandomDiscovery() {
        const btn = document.getElementById('randomDiscoveryBtn');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            const isAnime = !!window.__animeMode;
            const originalText = btn.textContent;
            btn.textContent = isAnime ? 'Finding Anime…' : 'Finding Movie…';
            btn.disabled = true;

            // Open tab from user gesture so browsers don't block it.
            const newTab = window.open('about:blank', '_blank', 'noopener');

            try {
                const target = isAnime
                    ? await fetchRandomAnimeViaMalThenTmdb()
                    : await fetchRandomTmdbMovieId();
                const url = `/html/movieInfo.html?id=${target.id}&type=${target.type}`;
                if (newTab) newTab.location.href = url;
                else window.location.href = url;
            } catch {
                if (newTab) newTab.close();
                btn.textContent = 'Try Again';
                btn.disabled = false;
                return;
            }

            btn.textContent = originalText;
            btn.disabled = false;
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        loadQuickStats();
        loadCommunityPulse();
        renderAnnouncements();
        initRandomDiscovery();
    });
})();
