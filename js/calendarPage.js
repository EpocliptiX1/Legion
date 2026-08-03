/* Full release calendar page — anime (recurring weekly simulcast schedule via Jikan)
   and movie (TMDB release-date discover, navigable by week) modes. */
(function () {
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const MAX_PER_DAY = 20;

    const animeScheduleCache = {};
    const movieWeekCache = {};
    let weekIdx = 0;

    function isAnimeMode() {
        return window.__animeMode === true;
    }

    function toIsoDateLocal(date) {
        const d = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
        return d.toISOString().slice(0, 10);
    }

    function getWeekStartMonday(date) {
        const d = new Date(date);
        const day = d.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function getWeekRange(weekIdx) {
        const baseMonday = getWeekStartMonday(new Date());
        const start = new Date(baseMonday);
        start.setDate(baseMonday.getDate() + (weekIdx * 7));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { start, end };
    }

    function getTodayDayIndex() {
        const d = new Date().getDay(); // 0=Sun
        return d === 0 ? 6 : d - 1; // 0=Mon..6=Sun
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');
    }

    function parseScheduleTime(value) {
        const text = String(value || '').trim();
        const match = text.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return Number.POSITIVE_INFINITY;
        return (Number(match[1]) * 60) + Number(match[2]);
    }

    // Primitive fallback candidates for titles TMDB doesn't index under their exact
    // Jikan/AniList name -- strips season/part/cour markers and roman-numeral or
    // trailing-number sequels one layer at a time, most-specific strip first.
    function buildTitleCandidates(title) {
        const candidates = [title];
        const add = (q) => { if (q && q !== title && !candidates.includes(q)) candidates.push(q); };

        add(title.replace(/\s+(Season\s+\d+|\d+(st|nd|rd|th)\s+Season)$/i, '').trim());
        add(title.replace(/\s+(Part\s+\d+|Cour\s+\d+|\d+(st|nd|rd|th)\s+Part)$/i, '').trim());
        add(title.replace(/\s*[:\-–]\s*(Part|Season)?\s*(II|III|IV|V|VI|VII|VIII|IX|X)$/i, '').trim());
        add(title.replace(/\s+(II|III|IV|VI{0,3}|IX|X)$/, '').trim());
        add(title.replace(/\s+\d+$/, '').trim());
        add(title.split(/[:\-–]/)[0].trim());

        return candidates;
    }

    async function tmdbTitleSearch(query) {
        const trySearch = async (q) => {
            const r = await fetch(`/api/tmdb-proxy/search/tv?query=${encodeURIComponent(q)}&language=en-US`);
            if (!r.ok) return null;
            const d = await r.json();
            return (d.results || [])[0] || null;
        };

        for (const candidate of buildTitleCandidates(query)) {
            const hit = await trySearch(candidate);
            if (hit) return hit.id;
        }
        return null;
    }

    function renderAnimeCard(a, tmdbId) {
        const img = a.images?.jpg?.image_url || '/img/noposter.jpg';
        const time = a.broadcast?.time || '--:--';
        const score = a.score ? `★ ${parseFloat(a.score).toFixed(1)}` : '';
        // `episode` is the specific episode airing on this date (what actually changes
        // week to week); `episodes` is the show's total run length -- show both so it's
        // obvious this isn't the same rerun of last week's card.
        const epLabel = a.episode
            ? `Ep ${a.episode}${a.episodes ? `/${a.episodes}` : ''}`
            : (a.episodes ? `${a.episodes} eps` : 'Ongoing');
        const title = escapeHtml(a.title_english || a.title || 'Unknown');

        if (!tmdbId) {
            return `<div class="disc-card sch-unavailable">
                <img class="disc-card-img" src="${img}" alt="" loading="lazy">
                <div class="disc-card-info">
                    <span class="disc-card-time">${time}</span>
                    <div class="disc-card-title">${title}</div>
                    <div class="disc-card-meta">${epLabel}</div>
                </div>
                <span class="disc-card-unavail">N/A</span>
            </div>`;
        }

        const href = `/html/movieInfo.html?id=${tmdbId}&type=tv`;
        return `<a class="disc-card" href="${href}">
            <img class="disc-card-img" src="${img}" alt="" loading="lazy">
            <div class="disc-card-info">
                <span class="disc-card-time">${time}</span>
                <div class="disc-card-title">${title}</div>
                <div class="disc-card-meta">${epLabel}${score ? ' · ' + score : ''}</div>
            </div>
        </a>`;
    }

    function renderReleaseCard(item) {
        const img = item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : '/img/noposter.jpg';
        const score = item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : 'Upcoming';
        const isTv = item._mediaType === 'tv';
        const title = escapeHtml(item.title || item.name || 'Unknown');
        const href = `/html/movieInfo.html?id=${item.id}&type=${isTv ? 'tv' : 'movie'}`;

        return `<a class="disc-card" href="${href}">
            <img class="disc-card-img" src="${img}" alt="" loading="lazy">
            <div class="disc-card-info">
                <span class="disc-card-time">${isTv ? 'Series' : 'Movie'}</span>
                <div class="disc-card-title">${title}</div>
                <div class="disc-card-meta">${score}</div>
            </div>
        </a>`;
    }

    async function loadAnimeDay(dateIso, colEl) {
        colEl.innerHTML = '<p class="calendar-day-loading">Loading...</p>';

        if (!(dateIso in animeScheduleCache)) {
            try {
                const res = await fetch(`/api/anime-schedule?date=${encodeURIComponent(dateIso)}`);
                if (!res.ok) throw new Error(String(res.status));
                const payload = await res.json();
                animeScheduleCache[dateIso] = payload.data || [];
            } catch (e) {
                colEl.innerHTML = '<p class="calendar-day-empty">Could not load.</p>';
                return;
            }
        }

        const animes = animeScheduleCache[dateIso];
        if (!animes.length) {
            colEl.innerHTML = '<p class="calendar-day-empty">Nothing airing.</p>';
            return;
        }

        const slice = animes
            .slice()
            .sort((a, b) => parseScheduleTime(a.broadcast?.time) - parseScheduleTime(b.broadcast?.time))
            .slice(0, MAX_PER_DAY);

        const tmdbIds = await Promise.all(
            slice.map(a => tmdbTitleSearch(a.title_english || a.title || ''))
        );

        const cards = slice.map((a, idx) => ({ html: renderAnimeCard(a, tmdbIds[idx]), unavailable: !tmdbIds[idx] }));
        const available = cards.filter(c => !c.unavailable);
        const unavailable = cards.filter(c => c.unavailable);

        colEl.innerHTML = [...available, ...unavailable].map(c => c.html).join('') || '<p class="calendar-day-empty">Nothing airing.</p>';
    }

    // NOTE: TMDB's `release_date.gte/lte` filters against ANY regional release-date entry
    // attached to a movie (re-releases, digital releases, festival premieres, etc.), not just
    // its real release -- that's what was pulling decades-old films into "this week" results.
    // `primary_release_date.gte/lte` filters against the single canonical release date instead.
    async function fetchWeekReleases(weekIdx, mediaType) {
        const { start, end } = getWeekRange(weekIdx);
        const weekStart = toIsoDateLocal(start);
        const weekEnd = toIsoDateLocal(end);
        const cacheKey = `${mediaType}-week-${weekStart}`;
        if (movieWeekCache[cacheKey]) return movieWeekCache[cacheKey];

        const isMovie = mediaType === 'movie';
        const path = isMovie ? 'discover/movie' : 'discover/tv';
        const dateField = isMovie ? 'primary_release_date' : 'first_air_date';

        const queries = [1, 2, 3].map(page =>
            `/api/tmdb-proxy/${path}?language=en-US&sort_by=popularity.desc&include_adult=false&${dateField}.gte=${weekStart}&${dateField}.lte=${weekEnd}&page=${page}`
        );

        const responses = await Promise.allSettled(queries.map(q => fetch(q)));
        const payloads = await Promise.all(
            responses.map(async (r) => {
                if (r.status !== 'fulfilled' || !r.value.ok) return { results: [] };
                try { return await r.value.json(); } catch { return { results: [] }; }
            })
        );

        const merged = payloads.flatMap(p => p.results || []);
        const uniq = [];
        const seen = new Set();
        for (const item of merged) {
            // No poster means it's almost always obscure homemade/unreleasable filler with
            // nothing to actually watch -- not worth showing on a release calendar.
            if (!item || !item.id || !item.poster_path || seen.has(item.id)) continue;
            seen.add(item.id);
            uniq.push({ ...item, _mediaType: mediaType });
        }
        movieWeekCache[cacheKey] = uniq;
        return uniq;
    }

    async function renderReleaseWeek() {
        const grid = document.getElementById('calendarGrid');
        const { start } = getWeekRange(weekIdx);
        Array.from(grid.children).forEach(col => {
            col.querySelector('.calendar-day-list').innerHTML = '<p class="calendar-day-loading">Loading...</p>';
        });

        let movies, series;
        try {
            [movies, series] = await Promise.all([
                fetchWeekReleases(weekIdx, 'movie'),
                fetchWeekReleases(weekIdx, 'tv')
            ]);
        } catch (e) {
            Array.from(grid.children).forEach(col => {
                col.querySelector('.calendar-day-list').innerHTML = '<p class="calendar-day-empty">Could not load.</p>';
            });
            return;
        }

        const byDay = Array.from({ length: 7 }, () => []);
        const bucket = (item, dateField) => {
            const d = (item[dateField] || '').slice(0, 10);
            if (!d) return;
            const dt = new Date(`${d}T00:00:00`);
            const diffDays = Math.round((dt - start) / 86400000);
            if (diffDays >= 0 && diffDays <= 6) byDay[diffDays].push(item);
        };
        movies.forEach(m => bucket(m, 'release_date'));
        series.forEach(s => bucket(s, 'first_air_date'));

        byDay.forEach((list, i) => {
            const listEl = grid.children[i].querySelector('.calendar-day-list');
            const sorted = list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, MAX_PER_DAY);
            listEl.innerHTML = sorted.length
                ? sorted.map(renderReleaseCard).join('')
                : '<p class="calendar-day-empty">No releases.</p>';
        });
    }

    function updateRangeLabel(start, end) {
        const label = document.getElementById('calendarRangeLabel');
        if (!label) return;
        const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
        label.textContent = `${fmt(start)} – ${fmt(end)}`;
    }

    function buildDayColumns() {
        const grid = document.getElementById('calendarGrid');
        const todayIdx = getTodayDayIndex();
        const { start } = getWeekRange(weekIdx);

        grid.innerHTML = DAY_LABELS.map((label, i) => {
            const isToday = weekIdx === 0 && i === todayIdx;
            const dateForCol = new Date(start);
            dateForCol.setDate(start.getDate() + i);
            const dateLabel = `${dateForCol.getMonth() + 1}/${dateForCol.getDate()}`;
            return `<div class="calendar-day-col${isToday ? ' cal-today' : ''}">
                <div class="calendar-day-header">
                    <div class="calendar-day-name">${label}</div>
                    <div class="calendar-day-date">${dateLabel}</div>
                </div>
                <div class="calendar-day-list"><p class="calendar-day-loading">Loading...</p></div>
            </div>`;
        }).join('');
    }

    function renderControls() {
        const controls = document.getElementById('calendarControls');
        const title = document.getElementById('calendarModeTitle');
        const subtitle = document.getElementById('calendarModeSubtitle');

        if (isAnimeMode()) {
            title.textContent = 'Anime Release Calendar';
            subtitle.textContent = 'Browse past and upcoming simulcast airings by week';
        } else {
            title.textContent = 'Movie & Series Release Calendar';
            subtitle.textContent = 'Browse upcoming and past movie and TV series releases by week';
        }

        controls.innerHTML = `
            <button class="calendar-nav-btn" id="calPrevWeek">&#8249; Prev</button>
            <span class="calendar-range-label" id="calendarRangeLabel"></span>
            <button class="calendar-nav-btn" id="calNextWeek">Next &#8250;</button>
            <button class="calendar-nav-btn" id="calToday">Today</button>
        `;

        const { start, end } = getWeekRange(weekIdx);
        updateRangeLabel(start, end);

        document.getElementById('calPrevWeek').onclick = () => shiftWeek(-1);
        document.getElementById('calNextWeek').onclick = () => shiftWeek(1);
        document.getElementById('calToday').onclick = () => { weekIdx = 0; refresh(); };
    }

    function shiftWeek(delta) {
        weekIdx += delta;
        refresh();
    }

    async function refresh() {
        renderControls();
        buildDayColumns();

        if (isAnimeMode()) {
            const grid = document.getElementById('calendarGrid');
            const { start } = getWeekRange(weekIdx);
            await Promise.all(DAYS.map((_, i) => {
                const dateForDay = new Date(start);
                dateForDay.setDate(start.getDate() + i);
                return loadAnimeDay(toIsoDateLocal(dateForDay), grid.children[i]);
            }));
        } else {
            await renderReleaseWeek();
        }
    }

    document.addEventListener('DOMContentLoaded', refresh);
})();
