/* Full release calendar page — anime (per-date simulcast schedule via AniList)
   and movie (TMDB release-date discover) modes. Renders a real month grid;
   clicking a date with releases opens a popup listing everything for that day
   instead of dumping every card on the page at once. */
(function () {
    const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const MAX_PER_DAY = 20;

    const animeScheduleCache = {};
    const animeCardCache = {};
    const movieMonthCache = {};
    let releaseBuckets = {};

    const now = new Date();
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();

    function isAnimeMode() {
        return window.__animeMode === true;
    }

    function toIsoDateLocal(date) {
        const d = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
        return d.toISOString().slice(0, 10);
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
    // AniList name -- strips season/part/cour markers and roman-numeral or
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

    // Monday-start 6-week (42 cell) grid covering the given month plus enough
    // lead/trail days from the adjacent months to fill whole weeks.
    function getMonthGridDates(year, month) {
        const firstOfMonth = new Date(year, month, 1);
        const firstDow = firstOfMonth.getDay(); // 0=Sun..6=Sat
        const leadDays = firstDow === 0 ? 6 : firstDow - 1;
        const gridStart = new Date(year, month, 1 - leadDays);
        const dates = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(gridStart);
            d.setDate(gridStart.getDate() + i);
            dates.push(d);
        }
        return dates;
    }

    // NOTE: TMDB's `release_date.gte/lte` filters against ANY regional release-date entry
    // attached to a movie (re-releases, digital releases, festival premieres, etc.), not just
    // its real release -- that's what was pulling decades-old films into "this week" results.
    // `primary_release_date.gte/lte` filters against the single canonical release date instead.
    async function fetchMonthReleaseBuckets(startDate, endDate) {
        const startIso = toIsoDateLocal(startDate);
        const endIso = toIsoDateLocal(endDate);
        const cacheKey = `${startIso}_${endIso}`;
        if (movieMonthCache[cacheKey]) return movieMonthCache[cacheKey];

        const PAGES = 8;
        const fetchType = async (mediaType) => {
            const isMovie = mediaType === 'movie';
            const path = isMovie ? 'discover/movie' : 'discover/tv';
            const dateField = isMovie ? 'primary_release_date' : 'first_air_date';
            const queries = Array.from({ length: PAGES }, (_, i) =>
                `/api/tmdb-proxy/${path}?language=en-US&sort_by=popularity.desc&include_adult=false&${dateField}.gte=${startIso}&${dateField}.lte=${endIso}&page=${i + 1}`
            );
            const responses = await Promise.allSettled(queries.map(q => fetch(q)));
            const payloads = await Promise.all(responses.map(async (r) => {
                if (r.status !== 'fulfilled' || !r.value.ok) return { results: [] };
                try { return await r.value.json(); } catch { return { results: [] }; }
            }));
            return payloads.flatMap(p => p.results || []).map(item => ({ ...item, _mediaType: mediaType }));
        };

        const [movies, series] = await Promise.all([fetchType('movie'), fetchType('tv')]);
        const buckets = {};
        const seen = new Set();
        for (const item of [...movies, ...series]) {
            const seenKey = `${item._mediaType}-${item.id}`;
            if (!item || !item.id || !item.poster_path || seen.has(seenKey)) continue;
            seen.add(seenKey);
            const dateField = item._mediaType === 'movie' ? 'release_date' : 'first_air_date';
            const dateStr = (item[dateField] || '').slice(0, 10);
            if (!dateStr || dateStr < startIso || dateStr > endIso) continue;
            if (!buckets[dateStr]) buckets[dateStr] = [];
            if (buckets[dateStr].length < MAX_PER_DAY) buckets[dateStr].push(item);
        }
        Object.values(buckets).forEach(list => list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)));

        movieMonthCache[cacheKey] = buckets;
        return buckets;
    }

    function renderMonthGrid(dates, counts) {
        const grid = document.getElementById('calendarGrid');
        const todayIso = toIsoDateLocal(new Date());
        grid.innerHTML = dates.map(d => {
            const iso = toIsoDateLocal(d);
            const otherMonth = d.getMonth() !== viewMonth;
            const isToday = iso === todayIso;
            const count = counts[iso] || 0;
            return `<div class="cal-month-cell${otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}${count ? ' has-items' : ''}" data-date="${iso}">
                <span class="cal-month-daynum">${d.getDate()}</span>
                ${count ? `<span class="cal-month-badge">${count}</span>` : ''}
            </div>`;
        }).join('');
    }

    function renderWeekdayHeader() {
        const el = document.getElementById('calMonthWeekdays');
        if (!el) return;
        el.innerHTML = DAY_LABELS.map(l => `<div class="cal-month-weekday">${l.slice(0, 3)}</div>`).join('');
    }

    function renderControls() {
        const controls = document.getElementById('calendarControls');
        const title = document.getElementById('calendarModeTitle');
        const subtitle = document.getElementById('calendarModeSubtitle');

        if (isAnimeMode()) {
            title.textContent = 'Anime Release Calendar';
            subtitle.textContent = "Click a date to see what's airing";
        } else {
            title.textContent = 'Movie & Series Release Calendar';
            subtitle.textContent = "Click a date to see what's releasing";
        }

        controls.innerHTML = `
            <button class="calendar-nav-btn" id="calPrevMonth">&#8249; Prev</button>
            <span class="calendar-range-label" id="calendarRangeLabel">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
            <button class="calendar-nav-btn" id="calNextMonth">Next &#8250;</button>
            <button class="calendar-nav-btn" id="calToday">Today</button>
        `;

        document.getElementById('calPrevMonth').onclick = () => shiftMonth(-1);
        document.getElementById('calNextMonth').onclick = () => shiftMonth(1);
        document.getElementById('calToday').onclick = () => {
            const today = new Date();
            viewYear = today.getFullYear();
            viewMonth = today.getMonth();
            refresh();
        };
    }

    function shiftMonth(delta) {
        viewMonth += delta;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        refresh();
    }

    async function refresh() {
        renderControls();
        const grid = document.getElementById('calendarGrid');
        grid.innerHTML = '<p class="calendar-day-loading" style="grid-column:1/-1;text-align:center;padding:40px 0;">Loading…</p>';

        const dates = getMonthGridDates(viewYear, viewMonth);
        const counts = {};

        if (isAnimeMode()) {
            // One batched request for the whole visible grid instead of up to 42
            // parallel per-date calls -- that burst was tripping AniList's per-IP
            // rate limit. The backend still only hits AniList for whichever dates
            // in the range aren't already cached server-side.
            const isoDates = dates.map(toIsoDateLocal);
            const missingDates = isoDates.filter(iso => !(iso in animeScheduleCache));
            if (missingDates.length) {
                try {
                    const startIso = isoDates[0];
                    const endIso = isoDates[isoDates.length - 1];
                    const res = await fetch(`/api/anime-schedule-range?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`);
                    const payload = res.ok ? await res.json() : {};
                    missingDates.forEach(iso => {
                        animeScheduleCache[iso] = payload[iso] || [];
                    });
                } catch {
                    missingDates.forEach(iso => {
                        animeScheduleCache[iso] = [];
                    });
                }
            }
            isoDates.forEach(iso => {
                counts[iso] = (animeScheduleCache[iso] || []).length;
            });
        } else {
            releaseBuckets = await fetchMonthReleaseBuckets(dates[0], dates[41]);
            dates.forEach(d => {
                const iso = toIsoDateLocal(d);
                counts[iso] = (releaseBuckets[iso] || []).length;
            });
        }

        renderMonthGrid(dates, counts);
    }

    async function openDayPopup(iso, dateObj) {
        const overlay = document.getElementById('calDayPopupOverlay');
        const title = document.getElementById('calDayPopupTitle');
        const body = document.getElementById('calDayPopupBody');
        if (!overlay || !title || !body) return;

        title.textContent = dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        body.innerHTML = '<p class="calendar-day-loading">Loading...</p>';
        overlay.classList.add('open');

        if (isAnimeMode()) {
            const animes = (animeScheduleCache[iso] || [])
                .slice()
                .sort((a, b) => parseScheduleTime(a.broadcast?.time) - parseScheduleTime(b.broadcast?.time))
                .slice(0, MAX_PER_DAY);

            if (!animes.length) {
                body.innerHTML = '<p class="calendar-day-empty">Nothing airing.</p>';
                return;
            }

            if (!animeCardCache[iso]) {
                const tmdbIds = await Promise.all(animes.map(a => tmdbTitleSearch(a.title_english || a.title || '')));
                const cards = animes.map((a, idx) => ({ html: renderAnimeCard(a, tmdbIds[idx]), unavailable: !tmdbIds[idx] }));
                animeCardCache[iso] = [...cards.filter(c => !c.unavailable), ...cards.filter(c => c.unavailable)].map(c => c.html);
            }

            // Bail if the user already navigated to a different date while this resolved.
            if (overlay.dataset.activeDate !== iso) return;
            body.innerHTML = animeCardCache[iso].join('') || '<p class="calendar-day-empty">Nothing airing.</p>';
        } else {
            const items = releaseBuckets[iso] || [];
            body.innerHTML = items.length ? items.map(renderReleaseCard).join('') : '<p class="calendar-day-empty">No releases.</p>';
        }
    }

    function closeDayPopup() {
        const overlay = document.getElementById('calDayPopupOverlay');
        if (overlay) overlay.classList.remove('open');
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderWeekdayHeader();
        refresh();

        document.getElementById('calendarGrid')?.addEventListener('click', (e) => {
            const cell = e.target.closest('.cal-month-cell.has-items');
            if (!cell) return;
            const iso = cell.dataset.date;
            const overlay = document.getElementById('calDayPopupOverlay');
            if (overlay) overlay.dataset.activeDate = iso;
            const [y, m, dd] = iso.split('-').map(Number);
            openDayPopup(iso, new Date(y, m - 1, dd));
        });

        document.getElementById('calDayPopupOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'calDayPopupOverlay') closeDayPopup();
        });
        document.getElementById('calDayPopupClose')?.addEventListener('click', closeDayPopup);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDayPopup();
        });
    });
})();
