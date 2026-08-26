
// Attaches the resolve-nonce (see server.js's requireResolveNonce) to every call this page
// makes into the internal stream-resolving routes, without having to touch each of the many
// fetch() call sites below individually. Wraps window.fetch once, at file-load time (before
// DOMContentLoaded, so it's active before anything else in this file can call one of these
// routes), and only augments requests whose URL matches the gated path list - everything else
// (tmdb-proxy, anime-mal-id, etc.) passes through completely untouched.
(function () {
    const RESOLVE_GATED_PATHS = [
        '/api/anime-kaa-servers', '/api/anime-megaplay-log', '/api/anime-neko-log',
        '/api/movie-kino-log', '/api/tv-kino-log', '/api/movie-ru-log', '/api/tv-ru-log',
        '/api/anime-download-links', '/api/movie-ru-download', '/api/tv-ru-download',
        '/api/t1m-servers'
    ];
    let noncePromise = null;
    function ensureResolveNonce() {
        if (!noncePromise) {
            noncePromise = fetch('/api/resolve-nonce')
                .then(r => r.json())
                .then(d => d.nonce)
                .catch(err => { noncePromise = null; throw err; }); // let the next call retry instead of caching a failure forever
        }
        return noncePromise;
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (RESOLVE_GATED_PATHS.some(p => url.startsWith(p))) {
            try {
                const nonce = await ensureResolveNonce();
                init = init ? { ...init } : {};
                init.headers = { ...(init.headers || {}), 'X-Resolve-Nonce': nonce };
            } catch (err) {
                // Nonce fetch failed - let the real request through as-is and let the server's
                // own 403 (missing nonce) surface the real error, rather than blocking playback
                // entirely on a transient failure to mint one.
            }
        }
        return originalFetch(input, init);
    };
})();

document.addEventListener('DOMContentLoaded', function() {
    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    }

    // Test feature: fetches the AniList-sourced season chain for this show and renders it as a
    // row of cover-art cards under the player. Silently no-ops (row stays hidden) on a fetch
    // failure or a title AniList has no mapping for - this is a nice-to-have, not something
    // that should ever visibly break the player itself.
    async function renderSeasonCardsRow(tmdbId) {
        const row = document.getElementById('seasonCardsRow');
        const list = document.getElementById('seasonCardsList');
        if (!row || !list) return;
        try {
            const res = await fetch(`/api/anime-season-cards?tmdbId=${encodeURIComponent(tmdbId)}`);
            if (!res.ok) return;
            const data = await res.json();
            const seasons = Array.isArray(data.seasons) ? data.seasons : [];
            if (!seasons.length) return;

            // Many shows bundle every AniList season under ONE TMDB entry (TMDB's own season
            // list, not AniList's) - marking every card "active" in that case is misleading,
            // not informative, since there's no reliable way to tell which AniList season the
            // currently-loaded episode selection corresponds to. Only highlight when exactly
            // one card's tmdbId is unambiguously the one we're already on.
            const currentTmdbMatches = seasons.filter(s => String(s.tmdbId) === String(tmdbId)).length;
            list.innerHTML = seasons.map(s => {
                const isCurrent = currentTmdbMatches === 1 && String(s.tmdbId) === String(tmdbId);
                const href = s.tmdbId ? `movieInfo.html?id=${s.tmdbId}&type=tv` : null;
                const clickAttr = href ? `onclick="window.__handleSeasonCardClick(${s.seasonNumber}, '${String(s.tmdbId).replace(/'/g, "\\'")}')"` : '';
                return `
                    <div class="season-card${isCurrent ? ' active' : ''}" ${clickAttr} title="${escapeHtml(s.title || '')}">
                        <img class="season-card-cover" src="${s.coverImage || '/img/default_poster.png'}" alt="${escapeHtml(s.title || '')}" loading="lazy" onerror="this.src='/img/default_poster.png'">
                        <div class="season-card-shadow">
                            <div class="season-card-label">Season ${s.seasonNumber}</div>
                            <div class="season-card-sub">${escapeHtml(s.title || '')}</div>
                        </div>
                    </div>
                `;
            }).join('');
            row.style.display = 'block';
        } catch (err) {
            console.warn('[SeasonCardsRow] failed to load:', err.message || err);
        }
    }

    const watchNowBtn = document.getElementById('watchNowBtn');
    if (!watchNowBtn) return;

    // 1. Find or create the empty wrapper on page load
    let playerSection = document.getElementById('moviePlayerSection');
    if (!playerSection) {
        playerSection = document.createElement('div');
        playerSection.id = 'moviePlayerSection';
        // Insert after .movie-flex-row so the player lives OUTSIDE .movie-header
        // (inserting inside .movie-header caused the header to balloon to 2700+px)
        const movieFlexRow = document.querySelector('.movie-flex-row');
        if (movieFlexRow && movieFlexRow.parentNode) {
            movieFlexRow.parentNode.insertBefore(playerSection, movieFlexRow.nextSibling);
        } else {
            document.body.appendChild(playerSection);
        }
    }

    // Bumped once per updateSource() call, before any async loader starts. Switching servers
    // rapidly (e.g. KAA still resolving -> click Neko -> click HSUB) used to leave multiple
    // load*() calls in flight at once, and whichever one's async chain happened to finish LAST
    // won the player/UI state regardless of which the user actually clicked last - confirmed
    // live: KAA finishing after a Neko/HSUB click silently replaced it back. Each loader reads
    // its own token at the top (synchronously, before its first await) and checks it again
    // immediately before committing anything to the DOM/player state; a stale token means a
    // newer request has since superseded it, so it bails out quietly instead of overwriting.
    let playbackRequestGen = 0;
    let watchHistoryCache = null;
    let watchHistoryMap = {};
    let kaaContinueState = null;
    let currentKaaSkipMarkers = [];
    let currentKaaSkipSegments = [];
    let currentNekoDownloads = { sub2: null, dub2: null };
    // Tracks when each skip button last (re)appeared so it can auto-hide 10s after
    // spawning instead of staying up for the entire (sometimes minutes-long) active
    // segment - keyed per role since intro/outro show independently. { segmentKey,
    // spawnedAt } per role, or null when that role currently has nothing active.
    const kaaSkipButtonSpawnState = { intro: null, outro: null };
    const KAA_SKIP_BUTTON_VISIBLE_MS = 10000;

    function formatTimestamp(seconds) {
        const sec = Number(seconds) || 0;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function renderKaaSkipSegments() {
        const infoDiv = document.getElementById('serverInfoText');
        if (!infoDiv) return;
        let wrap = document.getElementById('kaaSkipSegmentsWrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'kaaSkipSegmentsWrap';
            wrap.style.cssText = 'margin-top:8px;color:#ccc;font-size:0.88rem;line-height:1.4;';
            infoDiv.insertAdjacentElement('afterend', wrap);
        }

        if (!Array.isArray(currentKaaSkipSegments) || !currentKaaSkipSegments.length) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }

        const items = currentKaaSkipSegments.slice(0, 4).map(item => {
            // item.type is the raw AnimeSkip type object ({id, name}), not a string — a bare
            // String(item.type || ...) always wins that `||` (an object is truthy) and prints
            // "[object Object]" instead of ever reaching the .name fallback.
            const rawType = item.type;
            const typeName = (typeof rawType === 'object' && rawType !== null)
                ? (rawType.name || rawType.id || 'skip')
                : (rawType || item.raw?.type?.name || 'skip');
            const type = String(typeName).replace(/_/g, ' ');
            return `<span style="display:inline-block;margin-right:10px;">${formatTimestamp(getKaaSegmentStart(item))} ${escapeHtml(type)}</span>`;
        }).join('');
        wrap.innerHTML = `<strong>Skip metadata:</strong> ${items}${currentKaaSkipSegments.length > 4 ? '…' : ''}`;
        wrap.style.display = 'block';
    }

    function getCurrentVideoElement() {
        return document.getElementById('moviePlayerVideo') || window.currentVideo?.videoElement || null;
    }

    function getKaaSegmentStart(segment) {
        return Number(segment?.at ?? segment?.start ?? segment?.from ?? 0) || 0;
    }

    function getKaaSegmentEnd(segment) {
        if (!segment) return 0;
        const rawEnd = segment?.end ?? segment?.to;
        if (rawEnd !== undefined && rawEnd !== null && !Number.isNaN(Number(rawEnd))) {
            return Number(rawEnd);
        }
        const start = getKaaSegmentStart(segment);
        const duration = Number(segment?.duration || 0);
        return Number.isFinite(duration) && duration > 0 ? start + duration : start;
    }

    // Nothing real ever needs skipping for longer than this - a real OP/ED is at most a
    // couple minutes. Used as a sanity check below: if reading a marker by its own role
    // (anchored to 0 or to the episode's end) produces something longer than this, the
    // anchor assumption itself must be wrong for this particular episode (e.g. there's a
    // cold open before the actual intro, so intro doesn't really start at 0) - fall back to
    // chaining against the neighboring marker instead, same as before this fix existed.
    const KAA_SKIP_SEGMENT_MAX_SANE_SECONDS = 3 * 60;

    function buildKaaPlaybackSegments(markers, duration) {
        if (!Array.isArray(markers)) return [];
        const maxDuration = Number(duration);
        const hasDuration = Number.isFinite(maxDuration) && maxDuration > 0;
        // anime-skip.com's community-submitted data is inconsistent about how many
        // boundary points it sends per episode - sometimes just the two that actually
        // matter for the skip UI (Intro, Credits), with no leading/trailing marker at 0
        // or at the episode's end. Chaining consecutive markers into one continuous
        // timeline (the old approach) assumed a full boundary list and silently produced
        // garbage whenever it wasn't one - e.g. Intro@1:54 chained straight to
        // Credits@20:40 read as "skip from 1:54 to 20:40", when what an Intro marker
        // actually means is "the intro runs from the start of the episode up to here" and
        // a Credits marker means "credits run from here to the end". Each marker is now
        // read independently using its own role first, with the old chain behavior kept
        // as a fallback for whichever episodes actually need it (see the sanity check
        // above).
        const sorted = markers.slice().sort((a, b) => Number(a.at ?? a.start ?? 0) - Number(b.at ?? b.start ?? 0));
        return sorted
            .map((current, index) => {
                const at = Number(current.at ?? current.start ?? 0);
                const role = getKaaSkipRole(current);
                const previous = sorted[index - 1];
                const next = sorted[index + 1];
                let start;
                let end;
                if (role === 'intro') {
                    start = 0;
                    end = at;
                    if (end - start > KAA_SKIP_SEGMENT_MAX_SANE_SECONDS) {
                        start = previous ? Number(previous.at ?? previous.start ?? 0) : 0;
                    }
                } else if (role === 'outro') {
                    start = at;
                    end = hasDuration ? maxDuration : Infinity;
                    if (end - start > KAA_SKIP_SEGMENT_MAX_SANE_SECONDS) {
                        end = next ? Number(next.at ?? next.start ?? 0) : end;
                    }
                } else {
                    // Unrecognized marker type (Recap/Filler/Canon/etc.) - no anchor to
                    // reason about, so this only ever gets the old neighbor-chained range.
                    start = at;
                    end = next ? Number(next.at ?? next.start ?? 0) : (hasDuration ? maxDuration : Infinity);
                }
                return {
                    start,
                    end,
                    type: current.type || current.raw?.type?.name || current.raw?.type?.id || 'skip',
                    raw: current
                };
            })
            .filter(segment => {
                const start = Number(segment.start || 0);
                const end = Number(segment.end || 0);
                if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
                return end > start;
            });
    }

    function refreshKaaSkipSegments() {
        const video = getCurrentVideoElement();
        const duration = video?.duration;
        currentKaaSkipSegments = buildKaaPlaybackSegments(currentKaaSkipMarkers, duration);
        renderKaaSkipSegments();
        updateKaaSkipOverlay();
    }

    function getSortedKaaSkipSegments() {
        return Array.isArray(currentKaaSkipSegments)
            ? currentKaaSkipSegments.slice().sort((a, b) => getKaaSegmentStart(a) - getKaaSegmentStart(b))
            : [];
    }

    function findNextKaaSkipSegment(currentTime = 0) {
        const sorted = getSortedKaaSkipSegments();
        return sorted.find(seg => getKaaSegmentStart(seg) > (Number(currentTime) || 0) + 0.5) || null;
    }

    function findPreviousKaaSkipSegment(currentTime = 0) {
        const sorted = getSortedKaaSkipSegments();
        const current = Number(currentTime) || 0;
        const candidates = sorted.filter(seg => getKaaSegmentEnd(seg) < current - 0.5);
        return candidates.length ? candidates[candidates.length - 1] : null;
    }

    function seekToKaaSegmentEnd(segment) {
        const video = getCurrentVideoElement();
        if (!video || !segment) return;
        const target = getKaaSegmentEnd(segment);
        if (!Number.isFinite(target) || target <= 0) return;
        video.currentTime = Math.min(target, video.duration || target);
    }

    function getKaaSkipRole(segment) {
        const rawType = segment?.type ?? segment?.raw?.type ?? '';
        let segType = '';

        if (typeof rawType === 'object' && rawType !== null) {
            segType = String(rawType.name ?? rawType.id ?? '').toLowerCase();
        } else {
            segType = String(rawType || '').toLowerCase();
        }

        if (segType.includes('branding') || segType.includes('intro') || segType.includes('opening')) return 'intro';
        if (segType.includes('credits') || segType.includes('new credits') || segType.includes('end') || segType.includes('preview') || segType.includes('outro')) return 'outro';
        return null;
    }

    function findCurrentKaaSkipSegmentByType(currentTime = 0, type = '') {
        const normalizedType = String(type || '').toLowerCase();
        return getActiveKaaSkipSegments(currentTime).find(seg => {
            const role = getKaaSkipRole(seg);
            if (role) return role === normalizedType;
            const segType = String(seg.type || seg.raw?.type?.name || seg.raw?.type?.id || '').toLowerCase();
            return segType.includes(normalizedType);
        }) || null;
    }

    function findNextKaaSkipSegmentByType(currentTime = 0, type = '') {
        const sorted = getSortedKaaSkipSegments();
        const normalizedType = String(type || '').toLowerCase();
        return sorted.find(seg => {
            const role = getKaaSkipRole(seg);
            const isTypeMatch = role ? role === normalizedType : String(seg.type || seg.raw?.type?.name || seg.raw?.type?.id || '').toLowerCase().includes(normalizedType);
            return isTypeMatch && getKaaSegmentStart(seg) > (Number(currentTime) || 0) + 0.5;
        }) || null;
    }

    function seekToNextKaaSkipSegmentByType(type) {
        const video = getCurrentVideoElement();
        if (!video || !type) return;
        const current = findCurrentKaaSkipSegmentByType(video.currentTime || 0, type);
        const next = current || findNextKaaSkipSegmentByType(video.currentTime || 0, type);
        if (!next) return;
        seekToKaaSegmentEnd(next);
    }

    function seekToNextKaaSkipIntro() {
        seekToNextKaaSkipSegmentByType('intro');
    }

    function seekToNextKaaSkipOutro() {
        seekToNextKaaSkipSegmentByType('outro');
    }

    function createKaaPlyrButton(className, title, content) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `kaa-plyr-btn ${className} plyr__controls__item plyr__control`;
        btn.title = title;
        btn.style.cssText = 'background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.12);color:#fff;font-size:0.85rem;padding:6px 12px;height:34px;line-height:1.1;border-radius:8px;margin-left:6px;cursor:pointer;pointer-events:auto;';
        btn.textContent = content;
        return btn;
    }

    function getActiveKaaSkipSegments(currentTime = 0) {
        const now = Number(currentTime) || 0;
        const sorted = getSortedKaaSkipSegments();
        const active = sorted.filter(seg => {
            const start = getKaaSegmentStart(seg);
            const end = getKaaSegmentEnd(seg);
            return Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
        });
        if (active.length) {
            console.log('[KAA ACTIVE]', 't=', now.toFixed(2), 'active=', active.map(seg => ({
                type: seg.type?.name || seg.type?.id || seg.type || seg.raw?.type?.name || seg.raw?.type?.id || 'unknown',
                role: getKaaSkipRole(seg),
                start: getKaaSegmentStart(seg),
                end: getKaaSegmentEnd(seg)
            })));
        }
        return active;
    }

    function updateKaaSkipOverlay() {
        const overlay = document.getElementById('kaaSkipOverlay');
        if (!overlay) return;
        const video = getCurrentVideoElement();
        if (!video) {
            overlay.style.display = 'none';
            return;
        }

        const active = getActiveKaaSkipSegments(video.currentTime || 0);
        if (!active.length) {
            console.log('[KAA UI] hide overlay, no active segment');
            overlay.style.display = 'none';
            return;
        }

        const introButton = overlay.querySelector('.kaa-skip-intro-btn');
        const outroButton = overlay.querySelector('.kaa-skip-outro-btn');
        const currentIntro = active.find(seg => getKaaSkipRole(seg) === 'intro');
        const currentOutro = active.find(seg => getKaaSkipRole(seg) === 'outro');
        console.log('[KAA UI] active segments', active.map(seg => ({
            type: seg.type?.name || seg.type?.id || seg.type || seg.raw?.type?.name || seg.raw?.type?.id || 'unknown',
            role: getKaaSkipRole(seg),
            start: getKaaSegmentStart(seg),
            end: getKaaSegmentEnd(seg)
        })));

        const showIntro = shouldShowKaaSkipButton('intro', currentIntro);
        const showOutro = shouldShowKaaSkipButton('outro', currentOutro);

        if (introButton) {
            introButton.style.display = showIntro ? '' : 'none';
            introButton.disabled = !showIntro;
        }
        if (outroButton) {
            outroButton.style.display = showOutro ? '' : 'none';
            outroButton.disabled = !showOutro;
        }

        if (!showIntro && !showOutro) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'flex';
    }

    // A segment can legitimately stay "active" (per getActiveKaaSkipSegments) for minutes,
    // but the button itself should only stay up for 10s after it first appears - it was
    // never disappearing before because visibility was tied 1:1 to the active window
    // instead of to its own timer. Re-entering the same segment later (a seek back into
    // it) counts as a fresh spawn and restarts the 10s window; a genuinely different
    // segment for the same role does too.
    function shouldShowKaaSkipButton(role, segment) {
        if (!segment) {
            kaaSkipButtonSpawnState[role] = null;
            return false;
        }
        const key = `${getKaaSegmentStart(segment)}:${getKaaSegmentEnd(segment)}`;
        const state = kaaSkipButtonSpawnState[role];
        if (!state || state.segmentKey !== key) {
            kaaSkipButtonSpawnState[role] = { segmentKey: key, spawnedAt: Date.now() };
            return true;
        }
        return (Date.now() - state.spawnedAt) < KAA_SKIP_BUTTON_VISIBLE_MS;
    }

    function attachKaaDownloadButton() {
        const player = window.plyrInstance?.elements?.container;
        if (!player) return;
        if (player.querySelector('.kaa-download-btn-top')) return;
        const btn = document.createElement('button');
        btn.className = 'kaa-download-btn-top';
        btn.title = 'Download';
        btn.style.cssText = 'background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.18);color:#fff;width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-left:6px;cursor:pointer;';
        btn.innerHTML = `
                <svg viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round">

                <path d="M12 3v11"/>
                <path d="M7 10l5 5 5-5"/>
                <path d="M5 21h14"/>

                </svg>
                `;
        btn.addEventListener('click', () => {
            if (window.currentServer === 'srvPahe1') {
                window.downloadKAAEpisode?.();
            }
        });
        player.appendChild(btn);
        btn.style.display = window.currentServer === 'srvPahe1' ? 'flex' : 'none';
    }

    // Splits volume/settings/captions/pip out of Plyr's bottom bar into a separate top-right
    // row - ONLY below the site's own mobile breakpoint (css/style.css's @media (max-width:850px)).
    // At that width the bottom bar gets too cramped for all 11 controls in one row; above it,
    // desktop keeps everything in Plyr's normal single bar (matches the public embed player).
    // Checked once at build time (same as this function's only call site, right after `new
    // Plyr(...)`) rather than on resize - a mid-playback device rotation reflowing the control
    // layout out from under the user would be more jarring than just not doing it live.
    function movePlyrTopControls() {
        if (!window.matchMedia('(max-width: 850px)').matches) return;
        const playerContainer = window.plyrInstance?.elements?.container;
        const controls = window.plyrInstance?.elements?.controls;
        if (!playerContainer || !controls) return;

        let topControls = playerContainer.querySelector('.kaa-top-controls');
        if (!topControls) {
            topControls = document.createElement('div');
            topControls.className = 'kaa-top-controls';
            topControls.style.cssText = 'position:absolute;top:12px;right:12px;display:flex;gap:8px;align-items:center;z-index:10010;pointer-events:none;';
            playerContainer.appendChild(topControls);
        }

        const moveSelectors = [
            '.plyr__volume',
            '[data-plyr="settings"]',
            '[data-plyr="captions"]',
            '[data-plyr="pip"]'
        ];

        moveSelectors.forEach(selector => {
            const element = controls.querySelector(selector);
            if (element && !topControls.contains(element)) {
                element.style.pointerEvents = 'auto';
                topControls.appendChild(element);
            }
        });
    }

    function attachKaaSkipOverlay() {
        const playerContainer = window.plyrInstance?.elements?.container;
        if (!playerContainer) {
            setTimeout(attachKaaSkipOverlay, 300);
            return;
        }
        if (document.getElementById('kaaSkipOverlay')) {
            updateKaaSkipOverlay();
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'kaaSkipOverlay';
        overlay.style.cssText = 'display:none;position:absolute;right:16px;bottom:80px;flex-direction:column;align-items:flex-end;gap:8px;z-index:10010;pointer-events:none;';

        const introButton = createKaaPlyrButton('kaa-skip-intro-btn', 'Skip intro', 'Skip intro');
        const outroButton = createKaaPlyrButton('kaa-skip-outro-btn', 'Skip outro', 'Skip outro');
        introButton.style.pointerEvents = 'auto';
        outroButton.style.pointerEvents = 'auto';
        introButton.addEventListener('click', seekToNextKaaSkipIntro);
        outroButton.addEventListener('click', seekToNextKaaSkipOutro);
        overlay.appendChild(introButton);
        overlay.appendChild(outroButton);

        if (getComputedStyle(playerContainer).position === 'static') {
            playerContainer.style.position = 'relative';
        }
        playerContainer.appendChild(overlay);
        updateKaaSkipOverlay();
    }

    function attachKaaDownloadDebugButtons() {
        const btnDownloadSub = document.getElementById('btnDownloadSub');
        const btnDownloadDub = document.getElementById('btnDownloadDub');

        if (btnDownloadSub && !btnDownloadSub.dataset.debugListenerAttached) {
            btnDownloadSub.addEventListener('click', () => {
            });
            btnDownloadSub.dataset.debugListenerAttached = '1';
        }

        if (btnDownloadDub && !btnDownloadDub.dataset.debugListenerAttached) {
            btnDownloadDub.addEventListener('click', () => {
            });
            btnDownloadDub.dataset.debugListenerAttached = '1';
        }

        if (!btnDownloadSub || !btnDownloadDub) {
            requestAnimationFrame(attachKaaDownloadDebugButtons);
        }
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function buildEpisodeKey(season, episode) {
        return `S${pad2(season)}E${pad2(episode)}`;
    }

    function parseTimeStampContinue(raw) {
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.reduce((acc, item) => {
                    if (!Array.isArray(item) || item.length < 2) return acc;
                    const key = String(item[0]);
                    const seconds = Number(item[1]);
                    if (key && Number.isFinite(seconds)) {
                        acc[key] = Math.max(0, Math.floor(seconds));
                    }
                    return acc;
                }, {});
            }
            if (parsed && typeof parsed === 'object') {
                return Object.entries(parsed).reduce((acc, [key, value]) => {
                    const seconds = Number(value);
                    if (key && Number.isFinite(seconds)) {
                        acc[String(key)] = Math.max(0, Math.floor(seconds));
                    }
                    return acc;
                }, {});
            }
        } catch (e) {
            console.warn('[ContinueWatching] invalid timeStamp_continue', e);
        }
        return {};
    }

    function serializeTimeStampContinue(map) {
        return map && Object.keys(map).length ? JSON.stringify(map) : null;
    }

    async function fetchWatchHistory(userUID, movieId) {
        if (!userUID || !movieId) return null;
        try {
            const res = await fetch(`/activity/history?userUID=${encodeURIComponent(userUID)}&movie_id=${encodeURIComponent(movieId)}`);
            if (!res.ok) return null;
            const data = await res.json();
            return Array.isArray(data) && data.length > 0 ? data[0] : null;
        } catch (e) {
            console.warn('[ContinueWatching] history fetch failed', e);
            return null;
        }
    }

    function setWatchHistoryCache(row) {
        watchHistoryCache = row || null;
        watchHistoryMap = row && typeof row.timeStamp_continue === 'string'
            ? parseTimeStampContinue(row.timeStamp_continue)
            : {};
    }

    function getWatchHistoryResumeSeconds(episodeKey) {
        return watchHistoryMap?.[episodeKey] ?? null;
    }

    function applyResumeToVideo(video, seconds) {
        if (!video || !Number.isFinite(seconds) || seconds <= 5) return;
        const trySeek = () => {
            try {
                if (video.duration && seconds < video.duration - 3) {
                    video.currentTime = seconds;
                }
            } catch (err) {
                console.warn('[ContinueWatching] seek failed', err);
            }
        };
        if (video.readyState >= 1) trySeek();
        video.addEventListener('loadedmetadata', trySeek, { once: true });
    }

    function showKaaResumeOverlay(episodeKey, seconds, onResume, onRestart) {
        if (!episodeKey || !Number.isFinite(seconds) || seconds <= 5) return;
        let overlay = document.getElementById('kaaResumeOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'kaaResumeOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;display:flex;justify-content:center;align-items:center;background:rgba(0,0,0,0.85);z-index:10010;';
            document.body.appendChild(overlay);
        }
        // Rebuilt on EVERY call, not just the first - each provider (KAA, Neko, ...) passes its
        // own onResume/onRestart closures bound to that provider's own <video> element. Reusing
        // the overlay's DOM without also re-attaching listeners left the FIRST provider's
        // closures wired up forever: switching KAA -> Neko still showed the overlay (message
        // text alone was being updated), but clicking Resume kept seeking KAA's now-detached
        // video element instead of Neko's, so it silently did nothing. Rebuilding the buttons'
        // innerHTML each time destroys the old listeners along with the old nodes, so the new
        // addEventListener calls below are always the ones that actually fire.
        overlay.innerHTML = `
            <div style="max-width:360px;width:100%;padding:24px;border-radius:18px;background:#111;border:1px solid #ff8000;color:#eee;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.65);">
                <div style="font-size:1.25rem;font-weight:800;color:#ffb14d;margin-bottom:12px;">Continue Watching</div>
                <div id="kaaResumeMessage" style="font-size:0.95rem;line-height:1.4;margin-bottom:22px;">Resume ${episodeKey} from <strong>${seconds}s</strong>?</div>
                <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                    <button id="kaaResumeConfirmBtn" style="padding:10px 16px;border:none;border-radius:10px;background:#ff8000;color:#111;font-weight:700;cursor:pointer;min-width:120px;">Resume</button>
                    <button id="kaaResumeRestartBtn" style="padding:10px 16px;border:1px solid #ff8000;border-radius:10px;background:transparent;color:#fff;font-weight:700;cursor:pointer;min-width:120px;">Start Over</button>
                </div>
            </div>
        `;
        overlay.querySelector('#kaaResumeConfirmBtn').addEventListener('click', () => {
            overlay.style.display = 'none';
            onResume();
        });
        overlay.querySelector('#kaaResumeRestartBtn').addEventListener('click', () => {
            overlay.style.display = 'none';
            onRestart();
        });
        overlay.style.display = 'flex';
    }

    async function saveKaaContinue({ episodeKey, seconds, userUID, movieId, itemType }) {
        if (!episodeKey || !Number.isFinite(seconds) || !userUID || !movieId) return null;
        const payload = {
            userUID,
            movie_id: String(movieId),
            item_type: itemType || 'tv',
            continue_from: episodeKey,
            timeStamp_continue: JSON.stringify({ [episodeKey]: Math.max(0, Math.floor(seconds)) })
        };

        try {
            const res = await fetch('/activity/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`status=${res.status}`);
            updateWatchHistoryCache(episodeKey, Math.max(0, Math.floor(seconds)));
            return await res.json();
        } catch (err) {
            console.warn('[ContinueWatching] save failed', err);
            return null;
        }
    }

    function updateWatchHistoryCache(episodeKey, seconds) {
        if (!episodeKey || !Number.isFinite(seconds)) return;
        watchHistoryMap[episodeKey] = Math.max(0, Math.floor(seconds));
        if (watchHistoryCache) {
            watchHistoryCache.timeStamp_continue = serializeTimeStampContinue(watchHistoryMap);
        }
    }

    function stopKaaContinueWatching() {
        if (kaaContinueState && kaaContinueState.intervalId) {
            clearInterval(kaaContinueState.intervalId);
            kaaContinueState.intervalId = null;
        }
        if (kaaContinueState && kaaContinueState.video && kaaContinueState.episodeKey && kaaContinueState.userUID && kaaContinueState.movieId) {
            const seconds = Math.floor(kaaContinueState.video.currentTime || 0);
            if (seconds >= 5 && seconds !== kaaContinueState.lastSavedSeconds) {
                saveKaaContinue({
                    episodeKey: kaaContinueState.episodeKey,
                    seconds,
                    userUID: kaaContinueState.userUID,
                    movieId: kaaContinueState.movieId,
                    itemType: kaaContinueState.itemType
                });
            }
        }
        kaaContinueState = null;
    }

    function startKaaContinueWatching(video, options) {
        if (!video || !options || !options.episodeKey || !options.userUID || !options.movieId) return;
        stopKaaContinueWatching();
        kaaContinueState = {
            video,
            episodeKey: options.episodeKey,
            userUID: options.userUID,
            movieId: options.movieId,
            itemType: options.itemType || 'tv',
            lastSavedSeconds: -1,
            intervalId: null
        };

        const tick = async () => {
            if (!kaaContinueState || !kaaContinueState.video || kaaContinueState.video.paused || kaaContinueState.video.ended) return;
            const seconds = Math.floor(kaaContinueState.video.currentTime || 0);
            if (seconds < 5 || seconds === kaaContinueState.lastSavedSeconds) return;
            kaaContinueState.lastSavedSeconds = seconds;
            await saveKaaContinue({
                episodeKey: kaaContinueState.episodeKey,
                seconds,
                userUID: kaaContinueState.userUID,
                movieId: kaaContinueState.movieId,
                itemType: kaaContinueState.itemType
            });
        };

        kaaContinueState.intervalId = setInterval(tick, 10000);
        const resumeSeconds = getWatchHistoryResumeSeconds(options.episodeKey);
        if (resumeSeconds && resumeSeconds > 5) {
            showKaaResumeOverlay(options.episodeKey, resumeSeconds, () => applyResumeToVideo(video, resumeSeconds), () => {});
        }
    }

    // 2. Delegate clicks for the dynamic download buttons, so handler survives innerHTML re-renders
    playerSection.addEventListener('click', function(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.id === 'btnDownloadSub' || target.id === 'btnDownloadDub') {
            event.preventDefault();
            if (window.currentServer !== 'srvPahe1') {
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('Please switch to the KAA server and wait for it to load before downloading.');
                }
                return;
            }
            window.currentAudioType = target.id === 'btnDownloadSub' ? 'sub' : 'dub';
            downloadKAAEpisode();
        }

        if (target.id === 'btnDownloadSub2' || target.id === 'btnDownloadDub2') {
            event.preventDefault();
            const wantDub = target.id === 'btnDownloadDub2';
            const link = wantDub ? currentNekoDownloads.dub2 : currentNekoDownloads.sub2;
            if (link) {
                window.open(link, '_blank', 'noopener,noreferrer');
                return;
            }
            // currentNekoDownloads is only populated as a side effect of the Neko extractor,
            // so these buttons used to be dead unless the user happened to be on the Neko
            // server and its whole anikoto chain succeeded. The links actually only need
            // (MAL id, episode), so resolve them directly instead of giving up.
            (async () => {
                const malId = window.__currentAnimeMalId;
                const epNum = window.__currentAnimeEpisode || parseInt(document.getElementById('episodeNum')?.textContent, 10) || 1;
                if (!malId) {
                    window.showLimitToast?.('Download links need the anime to be identified first - start playback once, then try again.');
                    return;
                }
                const original = target.textContent;
                target.textContent = 'Getting link...';
                target.disabled = true;
                try {
                    const r = await fetch(`/api/anime-download-links?malId=${encodeURIComponent(malId)}&episode=${encodeURIComponent(epNum)}`);
                    const j = await r.json();
                    const resolved = wantDub ? j?.bestDub : j?.bestSub;
                    if (!j?.ok || !resolved) {
                        window.showLimitToast?.(`No ${wantDub ? 'DUB' : 'SUB'} download available for episode ${epNum}.`);
                        return;
                    }
                    // Cache for the rest of this episode so repeat clicks are instant.
                    if (wantDub) currentNekoDownloads.dub2 = resolved;
                    else currentNekoDownloads.sub2 = resolved;
                    // Opened in the user's own browser on purpose: the file host sits behind a
                    // Cloudflare challenge that a real browser clears and our backend cannot.
                    window.open(resolved, '_blank', 'noopener,noreferrer');
                } catch (err) {
                    window.showLimitToast?.('Could not fetch the download link.');
                } finally {
                    target.textContent = original;
                    target.disabled = false;
                }
            })();
        }

        if (target.id === 'btnDownloadRuMovie') {
            event.preventDefault();
            window.downloadRuMovie?.(target);
        }

        if (target.id === 'btnDownloadRuTv') {
            event.preventDefault();
            window.downloadRuTv?.(target);
        }

        if (target.id === 'btnDownloadKino') {
            event.preventDefault();
            if (window.currentServer !== 'srvKino') {
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('Please switch to the Kino server and wait for it to load before downloading.');
                }
                return;
            }
            window.downloadKinoEpisode?.();
        }

        if (target.id === 'btnDownloadKinoTv') {
            event.preventDefault();
            if (window.currentServer !== 'srvKinoTv') {
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('Please switch to the Kino server and wait for it to load before downloading.');
                }
                return;
            }
            window.downloadKinoEpisode?.();
        }

    });

    // Background preload for Kino (movies only) -- same "fire it off early so
    // it's often already resolved by the time someone picks the server" idea
    // as the anime KAA/Neko preload below, just a single request since Kino
    // has no season/episode/audio variants to guess at.
    window.preloadKinoSource = async function(tmdbId) {
        try {
            if (!tmdbId) return;
            const res = await fetch(`/api/movie-kino-log?tmdbId=${encodeURIComponent(tmdbId)}`);
            const data = await res.json().catch(() => ({}));
            if (data?.stream) {
                window.__preloadedKinoSource = { tmdbId, data, cachedAt: Date.now() };
                console.log('[Preload] ✓ Kino stream cached for tmdbId ' + tmdbId);
            } else {
                console.log('[Preload] ✗ Kino returned no stream:', data);
            }
        } catch (err) {
            console.log('[Preload] ✗ Kino preload failed:', err);
        }
    };

    // Subtitle tracks (OpenSubtitles, via the backend's /api/kino-subtitles) --
    // fetched at play time (not preloaded, it's fast: one search request, no
    // Puppeteer). Returns [] on any failure so playback never blocks on subs.
    window.fetchKinoSubtitleTracks = async function(tmdbId, mediaType, season, episode) {
        try {
            const query = new URLSearchParams({ tmdbId: tmdbId || '', mediaType });
            if (season) query.set('season', season);
            if (episode) query.set('episode', episode);
            const res = await fetch(`/api/kino-subtitles?${query.toString()}`);
            const data = await res.json().catch(() => ({}));
            return Array.isArray(data?.tracks) ? data.tracks : [];
        } catch (err) {
            console.log('[Kino] subtitle fetch failed:', err);
            return [];
        }
    };

    // Same idea for the TV path -- keyed on season+episode too since each
    // episode is its own vidsrcme lookup (unlike Kino movies, one per title).
    window.preloadKinoTvSource = async function(tmdbId, season, episode) {
        try {
            if (!tmdbId) return;
            const query = new URLSearchParams({ tmdbId, season: season || 1, episode: episode || 1 });
            const res = await fetch(`/api/tv-kino-log?${query.toString()}`);
            const data = await res.json().catch(() => ({}));
            if (data?.stream) {
                window.__preloadedKinoTvSource = { tmdbId, season, episode, data, cachedAt: Date.now() };
                console.log('[Preload] ✓ Kino TV stream cached for S' + season + 'E' + episode);
            } else {
                console.log('[Preload] ✗ Kino TV returned no stream:', data);
            }
        } catch (err) {
            console.log('[Preload] ✗ Kino TV preload failed:', err);
        }
    };

    // Browser-side source preloads contain session-bound proxy tokens. They are only a speed-up,
    // never a source of truth: discard them after one hour so a tab left open cannot reuse an
    // expired token or a mapping that finished resolving after the initial page load.
    const SOURCE_PRELOAD_TTL_MS = 60 * 60 * 1000;
    function isFreshSourcePreload(value) {
        return !!value && Number.isFinite(value.cachedAt) && Date.now() - value.cachedAt < SOURCE_PRELOAD_TTL_MS;
    }

    // Background preload function for anime episodes
    window.preloadEpisodeSources = async function() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const tmdbId = urlParams.get('id');
            const typeParam = (urlParams.get('type') || 'movie').toLowerCase();
            const isAnime = typeParam === 'anime' || typeParam === 'tv';

            if (!tmdbId) {
                console.log('[Preload] Skipping - no tmdbId');
                return;
            }

            if (!isAnime) {
                // Movies (not anime/tv): only Kino benefits from preloading --
                // the rest are plain iframe embeds with nothing to resolve ahead
                // of time.
                if (typeParam === 'movie') window.preloadKinoSource(tmdbId);
                console.log('[Preload] Skipping KAA/Neko - not anime');
                return;
            }

            let episode = 1;
            let season = 1;
            let audioType = localStorage.getItem('preferredAudio') === 'dub' ? 'dub' : 'sub';

            // Try to get watch history (may not be loaded yet, fetch it if needed)
            let historyCache = window.__watchHistoryCache;
            console.log('[Preload] Initial historyCache:', historyCache);

            if (!historyCache && typeof window.getActivityUID === 'function') {
                try {
                    const activityUID = window.getActivityUID();
                    console.log('[Preload] Fetching history for userUID:', activityUID);
                    const histRes = await fetch(`/activity/history?userUID=${encodeURIComponent(activityUID)}&movie_id=${encodeURIComponent(tmdbId)}`);
                    if (histRes.ok) {
                        historyCache = await histRes.json();
                        console.log('[Preload] Fetched history:', historyCache);
                    }
                } catch (e) {
                    console.log('[Preload] Could not fetch history:', e.message);
                }
            }

            if (historyCache?.continue_from) {
                const contMatch = String(historyCache.continue_from).match(/S(\d+)E(\d+)/);
                if (contMatch) {
                    season = parseInt(contMatch[1]);
                    episode = parseInt(contMatch[2]);
                    console.log('[Preload] Parsed continue_from:', { season, episode });
                }
            }

            const malId = window.__malId || '';
            const title = document.getElementById('title')?.textContent.trim() || '';

            console.log('[Preload] Starting background source preload:', { tmdbId, season, episode, audioType, malId });

            // Kino TV shares the same resolved season/episode -- it lives in the
            // "TV Shows" server row regardless of whether this ends up being
            // real anime or not, so preload it alongside KAA/Neko.
            window.preloadKinoTvSource(tmdbId, season, episode);

            // Preload KAA sources
            // Same synthetic-season override loadKickAssAnimeVideo's own fetch uses (see its
            // comment) - without it here too, THIS preload (which races ahead of the user even
            // opening the player, straight from continue-watching history) resolves the wrong
            // season with no anchor title, caches that wrong result into
            // window.__preloadedKaaSources, and the real loader below then just reuses it
            // instead of making its own correctly-overridden request at all (confirmed live:
            // this preload firing for a synthetic Workshop Battle season was exactly why KAA
            // kept falling back to Neko even after the main loader's own override was working).
            const kaaSeasonGroupsForPreload = window.__resolvedSeasonGroups || [];
            const kaaSeasonMatchForPreload = kaaSeasonGroupsForPreload.find(g => Number(g.seasonNumber) === Number(season));
            // KAA's own catalog is titled in romaji/native form, not English - romajiTitle
            // specifically (falls back to label if that field isn't present, e.g. an older
            // cached /api/anime-season-groups response from before this field existed).
            const preloadSeasonTitleParam = (kaaSeasonMatchForPreload?.romajiTitle || kaaSeasonMatchForPreload?.label) ? `&seasonTitle=${encodeURIComponent(kaaSeasonMatchForPreload.romajiTitle || kaaSeasonMatchForPreload.label)}` : '';
            const preloadSeasonEpCountParam = Number.isFinite(kaaSeasonMatchForPreload?.episodes?.length) ? `&seasonEpisodeCount=${kaaSeasonMatchForPreload.episodes.length}` : '';
            const kaaUrl = `/api/anime-kaa-servers?malId=${encodeURIComponent(malId)}&tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&ep=${encodeURIComponent(episode)}&audio=${encodeURIComponent(audioType)}&itemType=tv&title=${encodeURIComponent(title)}${preloadSeasonTitleParam}${preloadSeasonEpCountParam}`;
            console.log('[Preload] KAA fetch URL:', kaaUrl);
            fetch(kaaUrl).then(res => res.json()).then(data => {
                if (data?.sources?.length > 0) {
                    window.__preloadedKaaSources = data;
                    window.__preloadedKaaEpisode = { season, ep: episode, audioType, cachedAt: Date.now() };
                    console.log('[Preload] ✓ KAA sources cached for S' + season + 'E' + episode, { sourceCount: data.sources.length });
                } else {
                    console.log('[Preload] ✗ KAA returned no sources:', data);
                }
            }).catch(err => console.log('[Preload] ✗ KAA preload failed:', err));

            // Preload Neko sources
            // Same synthetic-season override as KAA's preload just above (reusing the same
            // kaaSeasonMatchForPreload lookup - it's season-only, not KAA-specific).
            const nekoQuery = new URLSearchParams({
                malId: malId || '',
                tmdbId: tmdbId || '',
                title,
                type: audioType,
                season: season || 1,
                ep: episode || 1
            });
            if (kaaSeasonMatchForPreload?.label) nekoQuery.set('seasonTitle', kaaSeasonMatchForPreload.label);
            const nekoUrl = `/api/anime-neko-log?${nekoQuery.toString()}`;
            console.log('[Preload] Neko fetch URL:', nekoUrl);
            fetch(nekoUrl).then(res => res.json()).then(data => {
                if (data?.stream || data?.sources?.file) {
                    window.__preloadedNekoSources = data;
                    window.__preloadedNekoEpisode = { season, ep: episode, audio: audioType, cachedAt: Date.now() };
                    console.log('[Preload] ✓ Neko sources cached for S' + season + 'E' + episode, { hasStream: !!data.stream });
                } else {
                    console.log('[Preload] ✗ Neko returned no stream:', data);
                }
            }).catch(err => console.log('[Preload] ✗ Neko preload failed:', err));

            // Preload RU - MV (newstream) sources
            const newQuery = new URLSearchParams({
                malId: malId || '',
                tmdbId: tmdbId || '',
                title,
                season: season || 1,
                ep: episode || 1
            });
            const newUrl = `/api/anime-new-log?${newQuery.toString()}`;
            console.log('[Preload] RU-MV fetch URL:', newUrl);
            fetch(newUrl).then(res => res.json()).then(data => {
                if (data?.stream) {
                    window.__preloadedNewSources = data;
                    window.__preloadedNewEpisode = { season, ep: episode, cachedAt: Date.now() };
                    console.log('[Preload] ✓ RU-MV sources cached for S' + season + 'E' + episode);
                } else {
                    console.log('[Preload] ✗ RU-MV returned no stream:', data);
                }
            }).catch(err => console.log('[Preload] ✗ RU-MV preload failed:', err));

            // Preload MegaPlay sources - was never wired up here at all, unlike KAA/Neko/RU-MV
            // above, so "Watch Now" always paid this fetch live even when MegaPlay ended up
            // being the server that actually played. /api/anime-megaplay-log is the real payload
            // loadMegaPlayFrame's native-playback path consumes (tokenized stream + skip markers
            // + subtitle tracks) - same endpoint, same malId-per-season lookup loadMegaPlayFrame
            // itself does, just run ahead of time instead of on click.
            if (malId) {
                const megaplaySeasonMatchForPreload = kaaSeasonGroupsForPreload.find(g => Number(g.seasonNumber) === Number(season));
                const megaplayMalIdForPreload = megaplaySeasonMatchForPreload?.malId || malId;
                const megaUrl = `/api/anime-megaplay-log?malId=${encodeURIComponent(megaplayMalIdForPreload)}&episode=${encodeURIComponent(episode)}&lang=${encodeURIComponent(audioType)}`;
                console.log('[Preload] MegaPlay fetch URL:', megaUrl);
                fetch(megaUrl).then(res => res.json()).then(data => {
                    if (data?.ok && data.stream) {
                        window.__preloadedMegaSources = data;
                        window.__preloadedMegaEpisode = { season, ep: episode, audioType, cachedAt: Date.now() };
                        console.log('[Preload] ✓ MegaPlay sources cached for S' + season + 'E' + episode);
                    } else {
                        console.log('[Preload] ✗ MegaPlay returned no stream:', data);
                    }
                }).catch(err => console.log('[Preload] ✗ MegaPlay preload failed:', err));
            }

        } catch (err) {
            console.log('[Preload] Background preload error:', err);
        }
    };

    // 3. Everything happens ONLY when Watch Now is clicked
    watchNowBtn.addEventListener('click', async function() {
        // Add a class to restore spacing
        const movieHeader = document.querySelector('.movie-header');
        if (movieHeader) movieHeader.classList.add('player-active');
        const urlParams = new URLSearchParams(window.location.search);
        let tmdbId = urlParams.get('id');
        const requestedType = (urlParams.get('type') || 'movie').toLowerCase();
        
        if (!tmdbId) return alert('No ID found!');

        const savedPreferredAudio = localStorage.getItem('preferredAudio');
        let currentAudioMode = savedPreferredAudio === 'dub' ? 'dub' : 'sub';
        window.currentAudioType = currentAudioMode;
        let imdbId = '';
        let malId = null;
        let isSeries = false;
        let animeTitle = '';
        let currentHls = null;

        const genreText = document.getElementById('genre')?.innerText.toLowerCase() || "";
        let isAnime = requestedType === 'anime' || genreText.includes('anime');

        // Default server: anime uses Neko (falls to MegaPlay then KAA on failure - see
        // loadNekoStreamVideo/loadMegaPlayFrame/loadKickAssAnimeVideo's fallback wiring),
        // TV uses MegaTV, movies use Mega.
        let currentServer = isAnime ? 'srvNeko1' : (requestedType === 'tv' ? 'srvKinoTv' : 'srvKino');

        const animeLeverActive = localStorage.getItem('animeMode') === 'true';
        let useAnimeSeasonUX = isAnime && animeLeverActive;

        // 3. FORCE INJECT CUSTOM UI (List is now empty and waiting for dynamic data)
        playerSection.style = 'width:100%;margin-top:32px;display:block;flex-direction:column;';
        playerSection.innerHTML = `
            <style>
                .download-modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; display:none; justify-content:center; align-items:center; backdrop-filter:blur(4px); }
                .download-modal-content { background:#0c0c0c; padding:24px 32px; border-radius:14px; border:1px solid #ff800055; width:320px; text-align:center; box-shadow:0 10px 40px #000; }
                .download-modal-title { color:#ff8000; font-size:1.2rem; font-weight:800; margin:0 0 8px 0; letter-spacing:0.5px; }
                .download-modal-text { color:#ccc; font-size:0.9rem; margin-bottom:20px; }
                .download-progress-track { width:100%; background:#222; border-radius:8px; height:14px; overflow:hidden; box-shadow:inset 0 2px 6px #000; }
                .download-progress-fill { width:0%; background:#ff8000; height:100%; transition:width 0.3s ease; box-shadow:0 0 10px #ff800088; }
                .player-section { background:#080808; padding:16px 18px; padding-right:0; border-radius:14px; box-shadow:0 2px 24px #000a; display:flex; flex-direction:column; align-items:center; width:95%; }
                .player-title { color:#ff8000; margin-bottom:12px; font-size:1.3rem; font-weight:900; letter-spacing:1px; }
                .player-label { color:#ff8000; font-size:1rem; margin-bottom:6px; font-weight:700; }
                .player-block {  border-radius:10px; padding:12px 16px; padding-right:0; margin-bottom:10px; width:100%; display:flex; align-items:center; }
                .player-block-left { padding-right: 20px; width:20%; color:#fff; font-size:1rem; font-weight:600; text-align:left; height:100%; display:flex; flex-direction:column; justify-content:center; }
                .player-block-right { flex:1; display:flex; flex-direction:column; }
                .server-group { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:0; justify-content:flex-start; }
                .server-btn { background:#222; color:#fff; padding:6px 14px; border:none; border-radius:8px; cursor:pointer; font-size:0.95rem; font-weight:bold; margin:0 6px 6px 0; box-shadow:0 2px 8px #ff800033,0 1.5px 4px #0004; letter-spacing:0.5px; transition:background 0.2s,box-shadow 0.2s; }
                .server-btn.active { background:#ff8000; color:#fff; box-shadow:0 2px 12px #ff800055; }
                .player-section-divider { width:100%; height:2px; background:#ff8000; margin:12px 0 8px 0; border-radius:2px; opacity:0.7; }
                .player-report-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-width:150px; margin:0; background:#1a1a1a; color:#ddd; border:none; border-radius:8px; padding:6px 12px; font-size:0.95rem; font-weight:700; cursor:pointer; transition:background 0.2s,color 0.2s; box-shadow:0 2px 8px #ff000033; }
                .player-report-btn:hover { background:#241a10; color:#ff8000; }
                .player-report-btn svg { width:16px; height:16px; flex-shrink:0; }
                .player-block-actions { display:flex; flex-direction:row; align-items:center; flex-wrap:wrap; gap:16px; margin:10px 0; }
                .player-block-report { margin:0; }
                .player-info { color:#fff; font-size:0.95rem; margin-bottom:6px; }
                .player-select { background:#222; color:#fff; padding:6px 12px; border-radius:8px; border:none; font-size:0.95rem; margin:0 0px; box-shadow:0 1px 6px #ff800033; }
                .audio-btn { background:#222; color:#fff; padding:6px 18px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:0.95rem; margin:0 6px; transition:background 0.2s; box-shadow:0 2px 8px #ff800033; }
                .audio-btn.active { background:#ff8000; color:#fff; }
                .player-layout { width:100%; display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:14px; margin-top:10px; align-items:start; }
                .player-layout.is-plain-movie { display:block; }
                .player-main-pane { min-width:0; }
                .episode-list-section { width:100%; background:#0c0c0c; border-radius:12px; box-shadow:0 2px 16px #0004; padding:12px 0; display:none; border:1px solid #202020; box-sizing:border-box; flex-direction:column; position:relative; z-index:25; pointer-events:auto; }
                .episode-list-title { color:#ff8000; font-size:1.05rem; font-weight:700; margin:0 14px 8px 14px; }
                .episode-status-line { margin:0 14px 8px 14px; color:#b9b9b9; font-size:0.82rem; }
                .season-picker-wrap { margin:0 14px 10px 14px; display:flex; gap:8px; align-items:center; }
                .season-picker-label { color:#c9c9c9; font-size:0.8rem; white-space:nowrap; }
                .episode-search-wrap { margin:0 14px 10px 14px; }
                .episode-search-input { width:100%; box-sizing:border-box; background:#161616; color:#f5f5f5; border:1px solid #2d2d2d; border-radius:8px; padding:8px 10px; font-size:0.9rem; outline:none; }
                .episode-search-input:focus { border-color:#ff8000; }
                .episode-list { list-style:none; padding:0; margin:0; flex:1; min-height:0; overflow-y: auto; }
                .episode-list-item { display:flex; align-items:center; gap:10px; padding:8px 12px; font-size:0.94rem; color:#fff; border-bottom:1px solid #1f1f1f; background:#080808; transition:background 0.2s; cursor:pointer; position:relative; z-index:26; pointer-events:auto; }
                .episode-list-item.active { background:#ff8000 !important; color:#fff !important; font-weight:700 !important; box-shadow:0 0 16px #ff800099, inset 0 0 8px #00000055 !important; border-left:4px solid #00ff00 !important; }
                .episode-list-item.active .episode-num { color:#fff !important; }
                .episode-list-item.watched.active { background:#ff8000 !important; color:#fff !important; font-weight:700 !important; box-shadow:0 0 16px #ff800099, inset 0 0 8px #00000055 !important; border-left:4px solid #00ff00 !important; }
                .episode-list-item:hover { background:#ff8000aa; color:#fff; }
                .episode-num { width:22px; text-align:center; font-weight:700; color:#ff8000; font-size:0.82rem; }
                .episode-thumb { width:74px; height:42px; border-radius:6px; object-fit:cover; background:#141414; flex:0 0 auto; border:1px solid #242424; }
                .episode-text { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
                .episode-title { margin:0; font-size:0.83rem; line-height:1.2; white-space:normal; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
                .episode-meta { color:#9a9a9a; font-size:0.74rem; }
                .episode-play { margin-left:auto; color:#fff; font-size:1.2rem; }
                .episode-list-item.watched { background:#1a1a1a; color:#666; font-weight:400; border-left:3px solid #444; }
                .episode-list-item.watched .episode-num { color:#666; }
                .episode-list-item.hidden-by-search { display:none; }
                /* Filler/canon corner ribbon: a small square rotated 45deg and anchored just
                   outside the top-left corner, clipped by the item's own overflow so only the
                   triangular half that falls inside the card shows through as a diagonal flag.
                   Colors picked to match how the RU comments themselves already color-code this
                   (📘 blue = manga canon, 📙 orange = filler) so the two don't visually conflict;
                   Mixed/Anime Canon/Unknown get their own colors since the comments don't cover
                   those categories. */
                .episode-list-item[data-filler-type]:not([data-filler-type=""]) { overflow:hidden; }
                .episode-list-item[data-filler-type]:not([data-filler-type=""])::before {
                    content:''; position:absolute; top:-13px; left:-13px; width:26px; height:26px;
                    transform:rotate(45deg); z-index:27; pointer-events:none;
                    box-shadow:0 1px 3px rgba(0,0,0,0.5);
                }
                .episode-list-item[data-filler-type="Manga Canon"]::before { background:#2f6fed; }
                .episode-list-item[data-filler-type="Filler"]::before { background:#ff8c1a; }
                .episode-list-item[data-filler-type="Mixed Canon/Filler"]::before { background:#f2c94c; }
                .episode-list-item[data-filler-type="Anime Canon"]::before { background:#27ae60; }
                .episode-list-item[data-filler-type="Unknown"]::before { background:#9b59b6; }
                /* Legend for the ribbon colors above - same data-filler-type values, plain
                   swatches instead of rotated corners since there's no card to clip against. */
                .filler-legend { display:flex; flex-wrap:wrap; gap:5px 12px; padding:4px 12px 8px; font-size:0.72rem; color:#aaa; }
                .filler-legend-item { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
                .filler-legend-swatch { width:10px; height:10px; border-radius:2px; display:inline-block; flex-shrink:0; }
                .filler-legend-swatch[data-filler-type="Manga Canon"] { background:#2f6fed; }
                .filler-legend-swatch[data-filler-type="Filler"] { background:#ff8c1a; }
                .filler-legend-swatch[data-filler-type="Mixed Canon/Filler"] { background:#f2c94c; }
                .filler-legend-swatch[data-filler-type="Anime Canon"] { background:#27ae60; }
                .filler-legend-swatch[data-filler-type="Unknown"] { background:#9b59b6; }
                /* Custom Scrollbar for Episode List */
                .episode-list::-webkit-scrollbar { width: 8px; }
                .episode-list::-webkit-scrollbar-track { background: #181818; }
                .episode-list::-webkit-scrollbar-thumb { background: #ff8000; border-radius: 4px; }
                @media (max-width: 1100px) {
                    .player-layout { grid-template-columns: 1fr; }
                }
                /* .player-block was a fixed 20%/80% flex row with no mobile override at all -
                   on a narrow screen .player-block-left has so little room the info text, the
                   Report a Problem button, and the download button(s) all get cramped into a
                   column not much wider than the button's own min-width. Stack it instead of
                   trying to force everything to fit sideways. Same 850px breakpoint the site
                   already uses for its other player-specific mobile layout (see
                   movePlyrTopControls' own comment). */
                @media (max-width: 850px) {
                    .player-block { flex-direction: column; align-items: stretch; }
                    .player-block-left { width: 100%; padding-right: 0; margin-bottom: 12px; }
                }
            </style>
            <div class="player-section">
            
                <div class="player-block" style="margin-bottom:14px;">
                                        <div class="player-block-left">
                                            <div class="player-block-meta">
                                                <!-- episodeNum isn't just display - it's read as a fallback "what episode am I on"
                                                     source in several places in this file, so it stays in the DOM (just hidden) rather
                                                     than being removed outright along with the visible box the user actually wanted gone. -->
                                                <span id="episodeNum" style="display:none;">1</span>
                                                <div class="player-info">Our servers: Kino, KAA, Neko, RU - MV, MegaVid<br>The rest we have no control over, just close whatever opens up.<br>MegaVid = fastest<br>NekoStream = fast<br>KAA = old, may not have dub<br>Kino = fast<br>RU - MV = normal</div>
                                            </div>
                                            <div class="player-block-actions">
                                                <div class="player-block-report">
                                                    <button type="button" class="player-report-btn" onclick="window.openFooterModal ? window.openFooterModal('footerReportBugModal') : document.getElementById('footerReportBugModal')?.classList.add('active')">
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                                                        </svg>
                                                        Report a Problem
                                                    </button>
                                                </div>
                                                <div class="player-block-downloads">
                                                    <div id="animeDownloadWrap" style="display:none;">
                                                        <div class="downloadButtonMovieInfoParent">
                                                            <button id="btnDownloadAnime" class="audio-btn" style="margin:0;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;">
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:15px;height:15px;">
                                                                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                                                </svg>
                                                                Download Anime
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div id="movieDownloadWrap" style="display:none;">
                                                        <div class="downloadTextNextoBtn" style="font-size:0.85rem;color:#ffb366;margin-bottom:6px;">Movie Downloads</div>
                                                        <div class="downloadButtonMovieInfoParent">
                                                            <button id="btnDownloadRuMovie" class="audio-btn" style="margin:0;padding:6px 12px;">Download (RU - MV)</button>
                                                            <button id="btnDownloadKino" class="audio-btn" style="margin:0;padding:6px 12px;">Download (Kino)</button>
                                                        </div>
                                                    </div>
                                                    <div id="tvDownloadWrap" style="display:none;">
                                                        <div class="downloadTextNextoBtn" style="font-size:0.85rem;color:#ffb366;margin-bottom:6px;">TV Downloads</div>
                                                        <div class="downloadButtonMovieInfoParent">
                                                            <button id="btnDownloadRuTv" class="audio-btn" style="margin:0;padding:6px 12px;">Download Episode (RU - MV)</button>
                                                            <button id="btnDownloadKinoTv" class="audio-btn" style="margin:0;padding:6px 12px;">Download Episode (Kino)</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="player-section-divider player-section-divider-Downloads "></div>
                                        </div>
                    <div class="player-block-right">
                        <div class="player-label" id="labelMovies" style="cursor:pointer;" title="Click for info">Movies: <span style="font-size:0.75rem;opacity:0.5;font-weight:400;">ⓘ</span></div>
                        <div class="server-group">
                            <button id="srvKino" class="server-btn active">Kino</button>
                            <button id="srvT1mM" class="server-btn">T1M</button>
                            <button id="server2embed" class="server-btn">2Embed</button>
                            <button id="srvRuMovie" class="server-btn">
                                RU - MV <img src="https://upload.wikimedia.org/wikipedia/commons/f/f3/Flag_of_Russia.svg" alt="RU" style="width:16px;height:11px;vertical-align:middle;margin-left:2px;">
                            </button>
                            <button id="srvMega" class="server-btn">MegaCloud (S1)</button>
                            <button id="srvUp" class="server-btn">UpCloud (S2)</button>
                            <button id="srvT" class="server-btn">T-Cloud (S3)</button>
                            <button id="serverSuperembed" class="server-btn">SuperEmbed</button>
                            <button id="srvMoviesApiM" class="server-btn">MoviesAPI</button>
                            <button id="srv111MoviesM" class="server-btn">111Movies</button>
                            <button id="srvNontonGoM" class="server-btn">NontonGo</button>
                        </div>
                        <div class="player-section-divider"></div>
                        <div class="player-label" id="labelAnimeTV" style="cursor:pointer;" title="Click for info">TV Shows: <span style="font-size:0.75rem;opacity:0.5;font-weight:400;">ⓘ</span></div>
                        <div class="server-group">
                            <button id="srvKinoTv" class="server-btn">Kino</button>
                            <button id="srvT1mTV" class="server-btn">T1M</button>
                            <button id="srvMegaTV" class="server-btn">MegaCloud (S1)</button>
                            <button id="srvRuTv" class="server-btn">
                                RU - MV <img src="https://upload.wikimedia.org/wikipedia/commons/f/f3/Flag_of_Russia.svg" alt="RU" style="width:16px;height:11px;vertical-align:middle;margin-left:2px;">
                            </button>
                            <button id="srvUpTV" class="server-btn">UpCloud (S2)</button>
                            <button id="srvTTV" class="server-btn">T-Cloud (S3)</button>
                            <button id="srvMoviesApi" class="server-btn">MoviesAPI</button>
                            <button id="srv111Movies" class="server-btn">111Movies</button>
                            <button id="srvNontonGo" class="server-btn">NontonGo</button>
                        </div>
                        <div class="player-section-divider"></div>
                        <div class="player-label" id="labelAnimeDub" style="cursor:pointer;" title="Click for info">Anime Sub/Dub: <span style="font-size:0.75rem;opacity:0.5;font-weight:400;">ⓘ</span></div>
                        <div class="server-group">
                            <button id="srvPahe1" class="server-btn">
                                KickAssAnime
                            </button>
                            <button id="srvNeko1" class="server-btn">
                                NekoStream
                            </button>
                            <button id="srvNew1" class="server-btn">
                                RU - MV <img src="https://upload.wikimedia.org/wikipedia/commons/f/f3/Flag_of_Russia.svg" alt="RU" style="width:16px;height:11px;vertical-align:middle;margin-left:2px;">
                            </button>
                            <button id="srvMega1" class="server-btn">MegaVid</button>
                        </div>
                        <div id="subDubToggleRow" style="margin-top:8px;display:flex;gap:8px;align-items:center;">
                            <button id="btnSub" class="audio-btn active">SUB</button>
                            <button id="btnHsub" class="audio-btn" title="Hard-subbed: subtitles burned into the video. NekoStream only, and only for some titles.">HSUB</button>
                            <button id="btnDub" class="audio-btn">DUB</button>
                        </div>
                    </div>
                </div>
                <div id="animeDownloadPanel" class="anime-download-panel">
                    <div class="anime-download-panel__header">
                        <span class="anime-download-panel__title">Download Anime</span>
                        <button id="btnCloseDownloadPanel" class="anime-download-panel__close">✕</button>
                    </div>
                    <div class="anime-download-panel__body">
                        <div class="anime-download-panel__row">
                            <div>
                                <div class="anime-download-panel__label">Servers for downloads</div>
                                <div class="server-group anime-download-panel__group" id="dlSourceRow">
                                    <button class="audio-btn active" data-dl-source="kaa">KAA</button>
                                    <button class="audio-btn" data-dl-source="megaplay">MegaPlay</button>
                                    <button class="audio-btn" data-dl-source="neko">NekoStream</button>
                                    <button class="audio-btn" data-dl-source="rumv">RU-MV</button>
                                    <button class="audio-btn" data-dl-source="external">Kiwi (third party, ads)</button>
                                </div>
                            </div>
                            <div id="dlLanguageWrap">
                                <div class="anime-download-panel__label">Type</div>
                                <div class="server-group anime-download-panel__group" id="dlLanguageRow">
                                    <button class="audio-btn active" data-dl-lang="sub">SUB</button>
                                    <button class="audio-btn" data-dl-lang="dub">DUB</button>
                                    <button class="audio-btn anime-download-panel__hsub" data-dl-lang="hsub" id="dlHsubOption" title="Subtitles burned into the video by the source itself - NekoStream only, and only for some titles.">HSUB</button>
                                </div>
                            </div>
                            <div id="dlQualityWrap">
                                <div class="anime-download-panel__label">Quality</div>
                                <div class="server-group anime-download-panel__group" id="dlQualityRow">
                                    <button class="audio-btn active" data-dl-quality="1080p">1080p</button>
                                    <button class="audio-btn" data-dl-quality="720p">720p</button>
                                    <button class="audio-btn" data-dl-quality="360p">360p</button>
                                </div>
                            </div>
                            <div id="dlBurnWrap" class="anime-download-panel__burn">
                                <div class="anime-download-panel__label">Subtitles (burn into mp4)</div>
                                <label class="download-subs-choice anime-download-panel__burn-label">
                                    <input type="checkbox" id="dlBurnCheckbox" />
                                    Burn subtitles
                                </label>
                                <select id="dlSubsPicker" class="download-subs-picker" disabled>
                                    <option value="">Skip</option>
                                </select>
                            </div>
                            <div class="anime-download-panel__go">
                                <button id="btnDownloadGo" class="audio-btn active anime-download-panel__go-btn">Download</button>
                                <span id="dlStatusText" class="anime-download-panel__status"></span>
                            </div>
                        </div>
                        <div id="dlBurnHint" class="anime-download-panel__hint">
                            KAA / MegaPlay / NekoStream / RU-MV will switch the active server if needed before downloading. Kiwi links open a third-party download page in a new tab.
                        </div>
                    </div>
                </div>
                <div id="serverInfoText" style="min-height:24px;margin-bottom:8px;color:#bbb;font-size:0.95rem;text-align:center;"></div>
                <div class="player-layout">
                    <div class="player-main-pane"> <!-- aspect-ratio:16/9; -->
                        <div id="moviePlayerFrameWrap" style="width:100%;max-width:100%;background:#000;border-radius:12px;overflow:hidden;position:relative;">
                            <iframe id="moviePlayerFrame" src="" allowfullscreen allow="autoplay; encrypted-media; fullscreen;" frameborder="0" style="width:100%;height:100%;min-height:500px;border:none;"></iframe>
                            <video
                                id="moviePlayerVideo"
                                controls
                                style="display:none;width:100%;height:100%;"
                            ></video>
                            <div id="playerLoadingOverlay" class="player-loading-overlay" style="display:none;">
                                <div class="player-loading-spinner"></div>
                                <div class="player-loading-text">Fetching stream...</div>
                            </div>
                            <button id="btnBack10" title="Back 10s">
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                    <path fill="currentColor"
                                        d="M11 18V6L2.5 12L11 18ZM21 18V6L12.5 12L21 18Z"/>
                                </svg>
                            </button>
                            <button id="btnForward10" title="Forward 10s">
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                    <path fill="currentColor"
                                        d="M13 18L21.5 12L13 6V18ZM3 18L11.5 12L3 6V18Z"/>
                                </svg>
                            </button>
                            <button id="btnPiP" title="Picture in Picture">
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                    <path fill="currentColor"
                                        d="M19 7H11V13H19V7ZM21 3H3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V5C23 3.9 22.1 3 21 3ZM21 19H3V5H21V19Z"/>
                                </svg>
                            </button>
                            <button id="btnFullscreen" title="Fullscreen">⛶</button>
 
                        </div>
                    </div>

                    <div id="dynamicEpisodeSection" class="episode-list-section">
                        <div class="episode-list-title">Episodes</div>
                        <div id="episodeStatusLine" class="episode-status-line">Checking release status...</div>
                        <div id="seasonPickerWrap" class="season-picker-wrap" style="display:none;">
                            <span class="season-picker-label">Season</span>
                            <select id="seasonSelect" class="player-select"></select>
                            <select id="episodeSelect" class="player-select" style="display:none;"></select>
                        </div>
                        <div class="episode-search-wrap">
                            <input id="episodeSearchInput" class="episode-search-input" type="text" placeholder="Search episode...">
                        </div>
                        <div id="fillerLegend" class="filler-legend" style="display:none;">
                            <span class="filler-legend-item"><span class="filler-legend-swatch" data-filler-type="Manga Canon"></span>Manga Canon</span>
                            <span class="filler-legend-item"><span class="filler-legend-swatch" data-filler-type="Filler"></span>Filler</span>
                            <span class="filler-legend-item"><span class="filler-legend-swatch" data-filler-type="Mixed Canon/Filler"></span>Mixed Canon/Filler</span>
                            <span class="filler-legend-item"><span class="filler-legend-swatch" data-filler-type="Anime Canon"></span>Anime Canon</span>
                            <span class="filler-legend-item"><span class="filler-legend-swatch" data-filler-type="Unknown"></span>Mix (Manga, Novel, Unknown)</span>
                        </div>
                        <ul id="episodeListContainer" class="episode-list">
                        </ul>
                    </div>
                </div>

                <div id="seasonCardsRow" class="season-cards-row" style="display:none;">
                    <div class="season-cards-title">Seasons</div>
                    <div id="seasonCardsList" class="season-cards-list"></div>
                </div>

                <button id="closeMoviePlayer" style=" display:none ;margin-top:16px;background:#222;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">Close Player</button>
            </div>

        `;

        attachKaaDownloadDebugButtons();
        playerSection.scrollIntoView({behavior: 'smooth'});

        // Test feature: a row of season cards (cover art + shadow gradient, same visual
        // treatment as .card-title-label elsewhere on the site) under the player, sourced from
        // AniList's own relations graph (SEQUEL/PREQUEL chain) rather than TMDB's season list.
        // Deliberately NOT gated behind the `isAnime` heuristic above (genreText.includes
        // ('anime')) - confirmed live that heuristic reads e.g. "LIGHT_NOVEL" (the source
        // material field, not a genre) for a real anime and calls it non-anime. The endpoint
        // itself already no-ops safely (empty seasons list, row stays hidden) when AniList has
        // no mapping for this tmdbId at all, which is a much more accurate signal than reusing
        // a heuristic built for a different purpose.
        renderSeasonCardsRow(tmdbId);

        document.getElementById('btnSub').style.display = 'inline-block';
        document.getElementById('btnDub').style.display = 'inline-block';

        const btnSubEl = document.getElementById('btnSub');
        const btnDubEl = document.getElementById('btnDub');
        const btnHsubEl = document.getElementById('btnHsub');
        // HSUB ("hard sub") is a copy with the subtitles burned into the picture rather than
        // supplied as a separate text track. Only vidtube (NekoStream) carries it, and only
        // for some titles - anikoto lists it as its own audio type alongside sub/dub, e.g.
        // Attack on Titan/Frieren/Naruto have it while Demon Slayer/Solo Leveling don't.
        // So the button only makes sense on that server; updateSource re-runs this.
        const syncHsubVisibility = () => {
            // Always visible now (not gated to NekoStream) - clicking it switches server to
            // Neko automatically, so there's no need to hide it elsewhere first.
            if (btnHsubEl) btnHsubEl.style.display = 'inline-block';
        };
        window.__syncHsubVisibility = syncHsubVisibility;
        syncHsubVisibility();

        const applyAudioButtonState = (mode) => {
            btnSubEl?.classList.toggle('active', mode === 'sub');
            btnDubEl?.classList.toggle('active', mode === 'dub');
            btnHsubEl?.classList.toggle('active', mode === 'hsub');
        };
        applyAudioButtonState(currentAudioMode);

        // Selects the closest season already in the current dropdown to seasonNumber - the
        // fallback used whenever a season card can't be opened cleanly (see
        // __handleSeasonCardClick below). TMDB doesn't split anime into seasons consistently with
        // AniList/MAL (confirmed live: AOT's own "Season 3" card resolved to a tmdb id, 492999,
        // that doesn't exist on TMDB at all - some franchises get one TMDB season per cour, others
        // bundle several into one, with no reliable way to detect which from here), so this picks
        // an exact numeric match first, then the nearest option BELOW seasonNumber (a card past
        // the dropdown's own range means TMDB folded it into whatever the last real season
        // covers, not that season 1 is suddenly the closest fit), then finally the lowest option
        // if seasonNumber undershoots everything available.
        const selectClosestLocalSeason = (seasonNumber) => {
            const seasonSelectEl = document.getElementById('seasonSelect');
            if (!seasonSelectEl) return false;
            const numericOptions = Array.from(seasonSelectEl.options)
                .map(o => ({ el: o, n: parseInt(o.value, 10) }))
                .filter(o => Number.isFinite(o.n));
            if (!numericOptions.length) return false;
            const exact = numericOptions.find(o => o.n === seasonNumber);
            const below = numericOptions.filter(o => o.n <= seasonNumber);
            const best = exact
                || (below.length ? below.reduce((a, b) => (b.n > a.n ? b : a)) : numericOptions.reduce((a, b) => (b.n < a.n ? b : a)));
            seasonSelectEl.value = best.el.value;
            seasonSelectEl.dispatchEvent(new Event('change'));
            document.getElementById('episodeListContainer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return true;
        };

        // Season-cards row click: if this season's tmdbId is the show we're already on (TMDB
        // very often bundles every AniList season under one tv entry - see the isCurrent
        // ambiguity comment above), just point the existing Season dropdown at it instead of
        // reloading the whole page for a season that's already sitting right here.
        window.__handleSeasonCardClick = async (seasonNumber, cardTmdbId) => {
            const seasonSelectEl = document.getElementById('seasonSelect');
            const sameShow = String(cardTmdbId) === String(tmdbId) && seasonSelectEl &&
                Array.from(seasonSelectEl.options).some(o => o.value === String(seasonNumber));
            if (sameShow) {
                seasonSelectEl.value = String(seasonNumber);
                seasonSelectEl.dispatchEvent(new Event('change'));
                document.getElementById('episodeListContainer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            // Same tmdbId as the current page but no EXACT matching dropdown option (e.g. a card
            // whose AniList/MAL "season" TMDB folded into a show we're already on, past what the
            // dropdown itself splits out) - navigating here would just reload this exact URL.
            if (String(cardTmdbId) === String(tmdbId)) { selectClosestLocalSeason(seasonNumber); return; }
            // A genuinely different tmdbId - worth a quick existence check before committing to a
            // full navigation, since getTmdbIdForAniList's own resolution isn't always a real id.
            if (cardTmdbId) {
                try {
                    const res = await fetch(`/api/tmdb-proxy/tv/${encodeURIComponent(cardTmdbId)}`);
                    const data = await res.json().catch(() => null);
                    if (res.ok && data && data.success !== false && data.id) {
                        window.location.href = `movieInfo.html?id=${cardTmdbId}&type=tv`;
                        return;
                    }
                } catch (err) {
                    // Network hiccup - fall through to the local fallback below rather than risk a dead navigation.
                }
            }
            selectClosestLocalSeason(seasonNumber);
        };

        window.__handleEpisodeItemClick = (item) => {
            if (!item) return;
            console.log('[Episode Click] visual item clicked', {
                ep: item.getAttribute('data-ep'),
                season: item.getAttribute('data-season')
            });

            const seasonSelectEl = document.getElementById('seasonSelect');
            const episodeSelectEl = document.getElementById('episodeSelect');
            if (!seasonSelectEl || !episodeSelectEl) return;

            const epNum = item.getAttribute('data-ep');
            const epSeason = item.getAttribute('data-season') || seasonSelectEl.dataset.playSeason || '1';
            const previousEpNum = episodeSelectEl.value;
            const previousEpSeason = seasonSelectEl.dataset.playSeason || '1';

            seasonSelectEl.dataset.playSeason = String(epSeason);
            episodeSelectEl.value = epNum;
            item.classList.add('watched');

            // Add to watchedStates if not already there
            const epIdStr = `S${epSeason}E${epNum}`;
            if (window.__watchedStates && !window.__watchedStates.includes(epIdStr)) {
                window.__watchedStates.push(epIdStr);
            }

            document.querySelectorAll('.episode-list-item.active').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            window.__continueFromSeason = parseInt(epSeason);
            window.__continueFromEpisode = parseInt(epNum);

            const continueFromText = `S${epSeason}E${epNum}`;
            let finishedText = null;
            if (previousEpNum) {
                finishedText = `S${previousEpSeason}E${previousEpNum}`;
            }

            console.log(`[Episode Click] Currently on: ${continueFromText}, Finished: ${finishedText || 'none yet'}`);

            if (typeof window.getActivityUID === 'function') {
                fetch('/activity/watch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        userUID: window.getActivityUID(),
                        movie_id: String(tmdbId),
                        item_type: 'tv',
                        continue_from: continueFromText,
                        finished: finishedText
                    })
                }).catch(err => console.log('Backend tracking error', err));
            }

            updateSource(currentServer);
        };

        const animeDownloadWrap = document.getElementById('animeDownloadWrap');
        const movieDownloadWrap = document.getElementById('movieDownloadWrap');
        const tvDownloadWrap = document.getElementById('tvDownloadWrap');
        const playerLayoutEl = document.querySelector('.player-layout');
        const syncDownloadVisibility = () => {
            // KAA/Neko-based downloads only work for anime (srvPahe1/srvNeko1 are
            // anime-only servers) -- plain TV shows get the RU kinogo download instead.
            if (animeDownloadWrap) animeDownloadWrap.style.display = (isSeries && isAnime) ? 'block' : 'none';
            // RU movie downloads only exist for non-series titles (kinogo/cinemar is movies-only).
            if (movieDownloadWrap) movieDownloadWrap.style.display = (!isSeries && !isAnime) ? 'block' : 'none';
            // RU TV downloads only exist for non-anime series (kinogo/cinemar again).
            if (tvDownloadWrap) tvDownloadWrap.style.display = (isSeries && !isAnime) ? 'block' : 'none';
            // Plain (non-anime) movies get a single-column layout -- TV shows and anime
            // (movies included) keep the video+episode-list grid.
            if (playerLayoutEl) playerLayoutEl.classList.toggle('is-plain-movie', !isSeries && !isAnime);
        };
        syncDownloadVisibility();

        const serverInfo = {
            server2embed: '2Embed: High Compatibility',
            srvRuMovie: 'RU - MV: HLS stream, Russian audio only, movies only',
            srvKino: 'Kino: HLS stream, movies only (slower first load)',
            srvKinoTv: 'Kino: HLS stream, TV shows only (slower first load)',
            srvMega: 'MegaCloud (S1): Fast Streaming',
            srvUp: 'UpCloud (S2): Stable Mirror',
            srvPahe1: 'KickAssAnime: HLS stream',
            srvNeko1: 'NekoStream: HLS stream, or Injected, depends',
            srvNew1: 'RU - MV: HLS stream, Russian audio only (no sub/dub toggle)',
            srvT: 'T-Cloud (S3): Reliable Backup',
            serverSuperembed: 'SuperEmbed: Multi-source aggregator',
            srvMegaTV: 'MegaCloud TV: Fast Streaming',
            srvRuTv: 'RU - MV: HLS stream, Russian audio only, TV shows only',
            srvUpTV: 'UpCloud TV: Stable Mirror',
            srvTTV: 'T-Cloud TV: Reliable Backup',
            srvMoviesApi: 'MoviesAPI: Extra Source',
            srv111Movies: '111Movies: Extra Source',
            srvNontonGo: 'NontonGo: Extra Source',
            srvMoviesApiM: 'MoviesAPI: Extra Source',
            srv111MoviesM: '111Movies: Extra Source',
            srvNontonGoM: 'NontonGo: Extra Source',
            srvMega1: 'MegaPlay: Anime MAL-based stream'
        };
        // function showLimitToast2(message) {
        //     const existing = document.querySelector('.limit-toast');
        //     if (existing) existing.remove();

        //     const toast = document.createElement('div');
        //     toast.className = 'limit-toast';
        //     toast.innerHTML = `<span>${message}</span><div class="toast-progress"></div>`;
        //     document.body.appendChild(toast);

        //     const progressBar = toast.querySelector('.toast-progress');
        //     if (progressBar) progressBar.style.animation = 'progressShrink 3s linear forwards';

        //     setTimeout(() => {
        //         toast.style.opacity = '0';
        //         toast.style.transition = '0.5s';
        //         setTimeout(() => toast.remove(), 500);
        //     }, 3000);
        // }

        function showServerInfo(serverKey) {
            let info = serverInfo[serverKey] || '';
            if (isAnime && currentAudioMode === 'dub') {
                info += ' | Note: Click the 🎧/⚙️ icon in the player to switch audio to Dub if available.';
            }
            const infoTextDiv = document.getElementById('serverInfoText');
            if (infoTextDiv) infoTextDiv.textContent = info;
        }
        function updateKaaControlsVisibility() {
            const isDirectVideoServer =
                currentServer === 'srvPahe1';

            document.getElementById('btnBack10').style.display =
                isDirectVideoServer ? 'block' : 'none';

            document.getElementById('btnForward10').style.display =
                isDirectVideoServer ? 'block' : 'none';

            document.getElementById('btnPiP').style.display =
                isDirectVideoServer ? 'block' : 'none';

            const topDownloadBtn = document.querySelector('.kaa-download-btn-top');
            if (topDownloadBtn) {
                topDownloadBtn.style.display = isDirectVideoServer ? 'flex' : 'none';
            }

        }
        async function lookupMalId() {
            const imdbIdText = document.getElementById('imdbId')?.innerText || '';
            const match = imdbIdText.match(/MAL\s*(\d+)/i);
            if (match) {
                return match[1];
            }

            if (!tmdbId) return null;
            try {
                const res = await fetch(`/api/anime-mal-id?tmdbId=${encodeURIComponent(tmdbId)}`);
                if (!res.ok) return null;
                const data = await res.json();
                return data?.mal_id || null;
            } catch (err) {
                console.warn('[MegaPlay] MAL ID lookup failed:', err);
                return null;
            }
        }
        function destroyCurrentHls() {
            if (currentHls) {
                currentHls.destroy();
                currentHls = null;
            }
        }

        function releasePlaybackLease(streamUrl) {
            try {
                const url = new URL(String(streamUrl || ''), window.location.origin);
                if (url.origin !== window.location.origin || !['/api/m3u8-proxy', '/api/proxy-stream'].includes(url.pathname)) return;
                const token = url.searchParams.get('token');
                if (!token) return;
                // Best-effort cleanup only. The server still has its idle/max-age expiry if this
                // request is interrupted during navigation or the browser is closed.
                fetch('/api/playback-stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                    keepalive: true
                }).catch(() => {});
            } catch (e) {}
        }

        function resetSharedVideoPlayer() {
            releasePlaybackLease(window.currentVideo?.playlist);
            destroyCurrentHls();
            if (window.plyrInstance) {
                try {
                    window.plyrInstance.destroy();
                } catch (e) {}
                window.plyrInstance = null;
            }

            const frame = document.getElementById('moviePlayerFrame');
            const video = document.getElementById('moviePlayerVideo');

            if (video) {
                try {
                    video.pause();
                    video.removeAttribute('src');
                    video.querySelectorAll('source').forEach(source => source.remove());
                    video.querySelectorAll('track').forEach(track => track.remove());
                    video.load();
                } catch (e) {}
                video.style.display = 'none';
                video.onended = null;
            }

            if (frame) {
                frame.src = 'about:blank';
                frame.style.display = 'none';
            }
            window.currentVideo = null;
        }

        // Shown while a stream is being resolved - the iframe/video area can go small or briefly
        // blank mid-load depending on server, which reads as "broken" rather than "loading" and
        // was prompting people to spam other servers thinking this one failed. Every server type
        // converges on either showVideoPlayer (HLS/<video>) or showIframePlayer (embed servers),
        // so hiding it there covers all of them without touching each load*Video function
        // individually; a safety-net timeout guarantees it never gets stuck if a loader fails
        // through neither path (falls back to an error message instead of ever calling either).
        let playerLoadingHideTimeout = null;
        function showPlayerLoadingOverlay() {
            const overlay = document.getElementById('playerLoadingOverlay');
            if (!overlay) return;
            overlay.style.display = 'flex';
            clearTimeout(playerLoadingHideTimeout);
            playerLoadingHideTimeout = setTimeout(hidePlayerLoadingOverlay, 20000);
        }
        function hidePlayerLoadingOverlay() {
            clearTimeout(playerLoadingHideTimeout);
            const overlay = document.getElementById('playerLoadingOverlay');
            if (overlay) overlay.style.display = 'none';
        }

        function showIframePlayer(url) {
            resetSharedVideoPlayer();
            stopKaaContinueWatching();
            currentKaaSkipMarkers = [];
            currentKaaSkipSegments = [];
            renderKaaSkipSegments();
            updateKaaSkipOverlay();
            const frame = document.getElementById('moviePlayerFrame');
            if (frame) {
                frame.style.display = 'block';
                frame.src = url || 'about:blank';
            }
            hidePlayerLoadingOverlay();
        }

        function showVideoPlayer(streamUrl, subtitles = [], metadata = {}) {
            console.log('SHOWVIDEOPLAYER CALLED');

            hidePlayerLoadingOverlay();
            resetSharedVideoPlayer();

            const frame = document.getElementById('moviePlayerFrame');
            const video = document.getElementById('moviePlayerVideo');
            window.currentVideo = {
                playlist: streamUrl,
                subtitles,

                provider: metadata.provider,
                title: metadata.title,
                season: metadata.season,
                episode: metadata.episode,
                audio: metadata.audio,

                videoElement: video,
                hls: currentHls
            };
            window.currentDownloadContext = {
                title: metadata.title || document.getElementById("title")?.textContent.trim() || "Unknown Anime",
                season: metadata.season,
                episode: metadata.episode,
                thumbnail: window.currentAnimePosterThumb || '/img/LOGO_Short.png'
            };
            window.updateDownloadButtons(streamUrl);  
            if (!video) return false;

            video.querySelectorAll('track').forEach(track => track.remove());
            subtitles.forEach((subtitle, index) => {
                if (!subtitle?.url) return;
                const subtitleUrl = String(subtitle.url || '');
                const isSameOriginSubtitle = subtitleUrl.startsWith('/') || subtitleUrl.startsWith(window.location.origin);
                if (!isSameOriginSubtitle) {
                    console.warn('[KickAssAnime] Skipping unproxied subtitle:', subtitleUrl);
                    return;
                }
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = subtitle.lang || `Subtitle ${index + 1}`;

                // Map language names to ISO 639-1 codes - covers common anime subtitle languages
                const langMap = {
                    'English': 'en', 'eng': 'en',
                    'Arabic': 'ar', 'ara': 'ar',
                    'French': 'fr', 'fra': 'fr',
                    'German': 'de', 'deu': 'de',
                    'Italian': 'it', 'ita': 'it',
                    'Portuguese': 'pt', 'por': 'pt',
                    'Russian': 'ru', 'rus': 'ru',
                    'Spanish': 'es', 'spa': 'es',
                    'Thai': 'th', 'tha': 'th',
                    'Vietnamese': 'vi', 'vie': 'vi',
                    'Indonesian': 'id', 'ind': 'id',
                    'Chinese': 'zh', 'chi': 'zh', 'zho': 'zh',
                    '中文（简体）': 'zh', 'Simplified Chinese': 'zh',
                    '中文（繁體）': 'zh-TW', 'Traditional Chinese': 'zh-TW',
                    'Tiếng Việt': 'vi',
                    'ภาษาไทย': 'th',
                    'Bahasa Indonesia': 'id'
                };

                // Generate unique srclang code for each subtitle to ensure Plyr treats them as different tracks
                let srclang = langMap[subtitle.lang] || langMap[subtitle.language] || `xx-${index}`;

                track.srclang = srclang;
                track.src = subtitleUrl;
                if (index === 0) track.default = true;
                video.appendChild(track);
                console.log(`[Subtitles] Added ${track.label} (${srclang})`);
            });

            video.style.display = 'block';
            video.onended = () => {
                const episodeSelect = document.getElementById('episodeSelect');
                if (!episodeSelect) return;
                episodeSelect.value = String(Number(episodeSelect.value || 0) + 1);
                updateSource(currentServer);
            };
            console.log(
                'canPlayType:',
                video.canPlayType('application/vnd.apple.mpegurl')
            );

            console.log(
                'window.Hls exists:',
                !!window.Hls
            );

            console.log(
                'Hls supported:',
                window.Hls?.isSupported?.()
            );
            if (false && video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streamUrl;
            } else if (window.Hls && window.Hls.isSupported()) {
                currentHls = new window.Hls();

                currentHls.loadSource(streamUrl);
                currentHls.attachMedia(video);
                const wantedAudio =
                    window.currentAudioType || 'sub';
                if (window.plyrInstance) {
                    window.plyrInstance.destroy();
                }

                // Plyr has no built-in hls.js awareness (it only auto-detects quality
                // levels for its native YouTube/Vimeo/multi-<source> providers), and the
                // quality menu's real available heights differ per provider -- KAA/Neko's
                // vidtub masters happen to ship 360/720/1080, but Kino's vidsrcme masters
                // don't (e.g. 266p/534p). A hardcoded [1080,720,360] option list silently
                // no-ops on anything that doesn't match those exact heights (onChange's
                // `levels.findIndex(l => l.height === newQuality)` just returns -1). So
                // build the menu from the manifest's REAL levels once hls.js has parsed
                // it, instead of guessing.
                let plyrBuilt = false;
                function buildPlyrPlayer(qualityOptions) {
                    if (plyrBuilt) return;
                    plyrBuilt = true;
                    window.plyrInstance = new Plyr(video, {
                        controls: [
                            'rewind',
                            'play',
                            'fast-forward',
                            'progress',
                            'current-time',
                            'duration',
                            'mute',
                            'volume',
                            'captions',
                            'settings',
                            'pip',
                            'fullscreen'
                        ],
                        settings: ['captions', 'quality', 'speed'],
                        quality: {
                            default: 0,
                            options: qualityOptions,
                            forced: true,
                            onChange: (newQuality) => {
                                if (!currentHls) return;
                                if (newQuality === 0) {
                                    currentHls.currentLevel = -1;
                                    return;
                                }
                                const levelIndex = currentHls.levels.findIndex(l => l.height === newQuality);
                                if (levelIndex >= 0) currentHls.currentLevel = levelIndex;
                            }
                        },
                        // "0" means "Auto" (currentLevel = -1), not a literal "0p". Plyr's
                        // label lookup (ve.get) reads this from config.i18n specifically --
                        // a top-level config.qualityLabel is silently ignored.
                        i18n: { qualityLabel: { 0: 'Auto' } }
                    });
                    movePlyrTopControls();
                    setTimeout(() => {
                        console.log(window.plyrInstance.elements);
                        console.log(window.plyrInstance.elements.container);
                    }, 2000);

                    setTimeout(() => {
                        attachKaaDownloadButton();
                        attachKaaSkipOverlay();
                    }, 1000);
                }

                currentHls.once(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
                    const heights = [...new Set((data.levels || []).map(l => l.height).filter(h => h > 0))]
                        .sort((a, b) => b - a);
                    buildPlyrPlayer([0, ...heights]);
                });
                // Safety net: if the manifest never parses (bad stream), still give the
                // player *some* controls instead of leaving it with none at all.
                setTimeout(() => buildPlyrPlayer([0, 1080, 720, 360]), 8000);

                video.addEventListener('timeupdate', () => {
                    updateKaaSkipOverlay();
                    // Once past 80% of this episode, warm the next one's sources across all
                    // three anime providers ahead of time - same {season, ep, audioType,
                    // cachedAt} preload slots (window.__preloadedNekoSources/KaaSources/
                    // MegaSources) the Neko -> MegaPlay -> KAA loaders already know how to reuse
                    // (isFreshSourcePreload), so switching to the next episode consumes a warm
                    // cache instead of paying the full resolve chain live. Anime only - a
                    // "next episode" concept doesn't apply to movies.
                    if (isAnime && video.duration && video.currentTime / video.duration >= 0.8) {
                        preloadNextEpisodeSources(metadata.season, (parseInt(metadata.episode, 10) || 0) + 1, metadata.audio || currentAudioMode);
                    }
                });
                video.addEventListener('loadedmetadata', () => {
                    console.log('[KAA SKIP] loadedmetadata fired, duration=', video.duration);
                    refreshKaaSkipSegments();
                }, { once: true });
                if (video.readyState >= 1) {
                    console.log('[KAA SKIP] video.readyState >= 1 at attach time, duration=', video.duration);
                    refreshKaaSkipSegments();
                }
                
                currentHls.on(
                    window.Hls.Events.AUDIO_TRACKS_UPDATED,
                    () => {

                        console.table(
                            currentHls.audioTracks.map((t, i) => ({
                                index: i,
                                name: t.name,
                                lang: t.lang
                            }))
                        );

                        if (wantedAudio === 'dub') {

                            const englishTrack =
                                currentHls.audioTracks.findIndex(
                                    t =>
                                        /english/i.test(t.name) ||
                                        /eng/i.test(t.lang)
                                );

                            console.log(
                                'ENGLISH TRACK INDEX:',
                                englishTrack
                            );

                            if (englishTrack >= 0) {
                                currentHls.audioTrack = englishTrack;
                            }
                        }
                    }
                );
             
                currentHls.on(
                    window.Hls.Events.AUDIO_TRACKS_UPDATED,
                    (_, data) => {
                        //console.log('AUDIO_TRACKS_UPDATED', data);
                    }
                );

                currentHls.on(
                    window.Hls.Events.AUDIO_TRACK_SWITCHING,
                    (_, data) => {
                        //console.log('AUDIO_TRACK_SWITCHING', data);
                    }
                );

                currentHls.on(
                    window.Hls.Events.AUDIO_TRACK_SWITCHED,
                    (_, data) => {
                        // console.log('AUDIO_TRACK_SWITCHED', data);
                    }
                );

                // console.log('[KAA STREAM URL]', streamUrl);

                currentHls.on(window.Hls.Events.ERROR, (event, data) => {
                    if (!data?.fatal) return;
                    console.error('[KickAssAnime/HLS]', data);
                });
            } else {
                return false;
            }

            // Chrome only guarantees autoplay when either a user gesture is still "fresh"
            // (transient activation, ~5s) or the video is muted. The click on the server button
            // IS a real gesture, but everything between it and here (fetchWatchHistory, the
            // provider's own resolve call - a real network round trip for e.g. T1M, which has no
            // warm cache the first time) can burn through that window before this ever runs. When
            // it does, the unmuted play() above is silently rejected (NotAllowedError) and used to
            // just sit there fully buffered but paused forever - confirmed live on T1M/Venom
            // (readyState 4, buffered end-to-end, currentTime stuck at 0) right after a T1M/
            // Deadpool run that happened to still be within the gesture window worked fine. Retry
            // muted, which Chrome always allows regardless of gesture freshness - better a silent
            // start with the existing unmute control than a video that looks broken.
            video.play().catch(() => {
                video.muted = true;
                video.play().catch(() => {});
            });
            startEpisodePanelHeightSyncBurst();
            return true;
        }
        window.__nekoPreloadInFlight = window.__nekoPreloadInFlight || new Set();

        // Kick off a Neko resolution for this exact episode if one isn't already cached or
        // in flight. Fire-and-forget: runs in parallel with the KAA attempt so that if KAA
        // comes back empty, there's a good chance Neko has already resolved by then and can
        // be used instead of falling straight to Megaplay. KAA and Neko are ours (real HLS
        // sources we control); Megaplay is an external embed, kept as the last resort.
        function preloadNekoForEpisode(season, episode, audioType) {
            const key = `${season}:${episode}:${audioType}`;
            const already = window.__preloadedNekoEpisode;
            if (window.__preloadedNekoSources && isFreshSourcePreload(already) && parseInt(season) === parseInt(already.season || 1) && parseInt(episode) === parseInt(already.ep || 1) && (already.audio || 'sub') === audioType) {
                return;
            }
            if (window.__nekoPreloadInFlight.has(key)) return;
            window.__nekoPreloadInFlight.add(key);

            const title = animeTitle || document.getElementById('title')?.textContent.trim() || '';
            const query = new URLSearchParams({ malId: malId || '', tmdbId: tmdbId || '', title, type: audioType, season: season || 1, ep: episode || 1 });
            // See resolveExactWatchUrl's overrideSeasonTitle comment - needed for synthetic
            // cour-split seasons, whose anikoto page is often titled with the wrong literal
            // season number too.
            const preloadNekoSeasonGroups = window.__resolvedSeasonGroups || [];
            const preloadNekoSeasonMatch = preloadNekoSeasonGroups.find(g => Number(g.seasonNumber) === Number(season));
            if (preloadNekoSeasonMatch?.label) query.set('seasonTitle', preloadNekoSeasonMatch.label);
            fetch(`/api/anime-neko-log?${query.toString()}`).then(res => res.json()).then(data => {
                if (data?.stream || data?.sources?.file) {
                    window.__preloadedNekoSources = data;
                    window.__preloadedNekoEpisode = { season, ep: episode, audio: audioType, cachedAt: Date.now() };
                    console.log(`[Preload] ✓ Neko ready for S${season}E${episode}`);
                }
            }).catch(() => {}).finally(() => window.__nekoPreloadInFlight.delete(key));
        }

        // A merged season group (e.g. "Season 2" = a recap special + Part 1 + Part 2 under
        // three separate MAL ids) can't be addressed by one malId/episode-number pair anymore -
        // episode N might actually live under a completely different part than episode 1 does.
        // Each episode in window.__resolvedSeasonGroups already carries its OWN part's malId and
        // localEpisodeNumber (see metaListToGroups server-side) - this just looks that one
        // episode up instead of blindly using the season group's first/default malId for every
        // episode in it, which is what silently 404'd for anything past a merged season's first
        // part before this existed. Falls back to the page-load malId/raw episode number when
        // this season isn't in the resolved groups at all (unsplit shows), matching the old
        // (pre-merge) behavior exactly.
        function resolveEpisodeSourceOverride(selectedSeason, episode) {
            const groups = window.__resolvedSeasonGroups || [];
            const group = groups.find(g => Number(g.seasonNumber) === Number(selectedSeason));
            if (!group) return { malId: null, romajiTitle: null, label: null, localEpisode: episode, episodeCount: null, group: null };
            const episodes = Array.isArray(group.episodes) ? group.episodes : [];
            const epMatch = episodes.find(e => Number(e.episode_number) === Number(episode));
            const partMalId = epMatch?.malId || group.malId || null;
            const episodeCount = partMalId
                ? episodes.filter(e => (e.malId || group.malId) === partMalId).length
                : episodes.length;
            return {
                malId: partMalId,
                romajiTitle: epMatch?.romajiTitle || group.romajiTitle || group.label || null,
                label: epMatch?.sourceTitle || group.label || null,
                localEpisode: epMatch?.localEpisodeNumber != null ? epMatch.localEpisodeNumber : episode,
                episodeCount,
                group
            };
        }

        window.__kaaPreloadInFlight = window.__kaaPreloadInFlight || new Set();
        window.__megaPreloadInFlight = window.__megaPreloadInFlight || new Set();

        function preloadKaaForEpisode(season, episode, audioType) {
            const key = `${season}:${episode}:${audioType}`;
            const already = window.__preloadedKaaEpisode;
            if (window.__preloadedKaaSources && isFreshSourcePreload(already) && parseInt(season) === parseInt(already.season || 1) && parseInt(episode) === parseInt(already.ep || 1) && already.audioType === audioType) {
                return;
            }
            if (window.__kaaPreloadInFlight.has(key)) return;
            window.__kaaPreloadInFlight.add(key);

            const title = document.getElementById('title')?.textContent.trim() || '';
            const kaaOverride = resolveEpisodeSourceOverride(season, episode);
            const kaaMalId = kaaOverride.malId || malId;
            if (!kaaMalId) { window.__kaaPreloadInFlight.delete(key); return; }
            const seasonTitleParam = kaaOverride.romajiTitle ? `&seasonTitle=${encodeURIComponent(kaaOverride.romajiTitle)}` : '';
            const seasonEpCountParam = Number.isFinite(kaaOverride.episodeCount) ? `&seasonEpisodeCount=${kaaOverride.episodeCount}` : '';
            const kaaUrl = `/api/anime-kaa-servers?malId=${encodeURIComponent(kaaMalId)}&tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&ep=${encodeURIComponent(kaaOverride.localEpisode)}&audio=${encodeURIComponent(audioType)}&itemType=tv&title=${encodeURIComponent(title)}${seasonTitleParam}${seasonEpCountParam}`;
            fetch(kaaUrl).then(res => res.json()).then(data => {
                if (data?.sources?.length > 0) {
                    window.__preloadedKaaSources = data;
                    window.__preloadedKaaEpisode = { season, ep: episode, audioType, cachedAt: Date.now() };
                    console.log(`[Preload] ✓ KAA ready for S${season}E${episode}`);
                }
            }).catch(() => {}).finally(() => window.__kaaPreloadInFlight.delete(key));
        }

        function preloadMegaForEpisode(season, episode, audioType) {
            const key = `${season}:${episode}:${audioType}`;
            const already = window.__preloadedMegaEpisode;
            if (window.__preloadedMegaSources && isFreshSourcePreload(already) && parseInt(season) === parseInt(already.season || 1) && parseInt(episode) === parseInt(already.ep || 1) && already.audioType === audioType) {
                return;
            }
            if (window.__megaPreloadInFlight.has(key)) return;
            window.__megaPreloadInFlight.add(key);

            const megaOverride = resolveEpisodeSourceOverride(season, episode);
            const megaMalId = megaOverride.malId || malId;
            if (!megaMalId) { window.__megaPreloadInFlight.delete(key); return; }
            fetch(`/api/anime-megaplay-log?malId=${encodeURIComponent(megaMalId)}&episode=${encodeURIComponent(megaOverride.localEpisode)}&lang=${encodeURIComponent(audioType)}`)
                .then(res => res.json()).then(data => {
                    if (data?.ok && data.stream) {
                        window.__preloadedMegaSources = data;
                        window.__preloadedMegaEpisode = { season, ep: episode, audioType, cachedAt: Date.now() };
                        console.log(`[Preload] ✓ MegaPlay ready for S${season}E${episode}`);
                    }
                }).catch(() => {}).finally(() => window.__megaPreloadInFlight.delete(key));
        }

        // Fired once per episode, from showVideoPlayer's own timeupdate listener, once the
        // viewer crosses 80% watched - warms the NEXT episode's sources across all three
        // providers ahead of time (whichever the viewer ends up on, Neko/MegaPlay/KAA's own
        // preload-reuse checks - isFreshSourcePreload plus the season/episode/audio match -
        // already know how to consume a matching preload instead of resolving live). Silently
        // no-ops if there's no next episode in the currently rendered list (season finale) or
        // this episode/audio combo was already preloaded/is already in flight.
        function preloadNextEpisodeSources(season, nextEpisode, audioType) {
            if (!season || !nextEpisode || !malId) return;
            // metadata.season can come through zero-padded ("01") while data-season attributes
            // never are ("1") - a literal attribute-selector match silently found nothing for
            // every title, no-opping this whole feature. Numeric comparison instead.
            const nextExists = [...document.querySelectorAll('.episode-list-item')]
                .some(el => Number(el.dataset.season) === Number(season) && Number(el.dataset.ep) === Number(nextEpisode));
            if (!nextExists) return;
            preloadNekoForEpisode(season, nextEpisode, audioType);
            preloadMegaForEpisode(season, nextEpisode, audioType);
            preloadKaaForEpisode(season, nextEpisode, audioType);
        }

        async function loadKickAssAnimeVideo(
            episode,
            audioType
        ) {
            const myGen = playbackRequestGen;
            window.currentAudioType = audioType;
            const infoDiv = document.getElementById('serverInfoText');
            if (!malId) return false;

            try {
                if (infoDiv) infoDiv.textContent = 'KickAssAnime: Loading stream...';
                const seasonSelectEl = document.getElementById('seasonSelect');
                const selectedSeason = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || 1;
                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }
                // const res = await fetch(
                //     `/api/anime-kaa-servers?malId=${encodeURIComponent(malId)}&tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(selectedSeason)}&ep=${encodeURIComponent(episode)}&type=${encodeURIComponent(audioType)}`
                // );
                const title =
                    document.getElementById("title")?.textContent.trim() || "";

                let data;
                const preloadedEp = window.__preloadedKaaEpisode;
                // Season/episode alone isn't enough - the preload fetches whatever audio
                // localStorage's preferredAudio said at page-load time, then can sit unconsumed
                // if the real initial load already fetched its own copy before the preload
                // resolved. Without checking audioType too, the FIRST sub<->dub toggle click
                // after that would silently reuse that stale, wrong-audio preload instead of
                // fetching what was actually just picked.
                // Synthetic cour-split seasons need the override below to resolve at all - the
                // KAA preload (window.preloadEpisodeSources, fired from movieLoading.js at page
                // load, well before this page's own window.__resolvedSeasonGroups has had a
                // chance to populate) can never reliably have applied it, so its cached result
                // can't be trusted for one of these seasons even if season/episode/audio all
                // superficially match (confirmed live: this exact race is what kept KAA falling
                // back to Neko for Workshop Battle even after the override itself was working -
                // the preload had already resolved and cached the WRONG season's sources by the
                // time this ran, using none of the override logic below at all).
                const isSyntheticSeasonForKaa = (window.__resolvedSeasonGroups || [])
                    .some(g => Number(g.seasonNumber) === Number(selectedSeason));
                if (!isSyntheticSeasonForKaa && window.__preloadedKaaSources && isFreshSourcePreload(preloadedEp) && parseInt(selectedSeason) === parseInt(preloadedEp.season || 1) && parseInt(episode) === parseInt(preloadedEp.ep || 1) && preloadedEp.audioType === audioType) {
                    console.log('[KAA] Using preloaded sources for S' + selectedSeason + 'E' + episode);
                    data = window.__preloadedKaaSources;
                    window.__preloadedKaaSources = null;
                    window.__preloadedKaaEpisode = null;
                } else {
                    // Synthetic cour-split seasons (e.g. Workshop Battle) have no real TMDB
                    // season number - resolveKickAssAnimeSources' own resolveAnimeIds(tmdbId,
                    // season) lookup would find nothing to anchor its disambiguation on for
                    // those, so pass the season-group's own already-known title/episode count
                    // straight through as an override instead (see that function's comment).
                    // KAA's own catalog is titled in romaji/native form, not English - use
                    // romajiTitle specifically (Neko/anikoto's own loader uses `label`, the
                    // English one, instead - see its own comment for why the two providers
                    // need different languages here). malId/ep are this SPECIFIC episode's own
                    // part (see resolveEpisodeSourceOverride's comment) - a merged season's
                    // episode 15 might live under an entirely different malId/local-episode than
                    // episode 1 does.
                    const kaaOverride = resolveEpisodeSourceOverride(selectedSeason, episode);
                    const seasonTitleParam = kaaOverride.romajiTitle ? `&seasonTitle=${encodeURIComponent(kaaOverride.romajiTitle)}` : '';
                    const seasonEpCountParam = Number.isFinite(kaaOverride.episodeCount) ? `&seasonEpisodeCount=${kaaOverride.episodeCount}` : '';
                    // `malId` alone is whatever lookupMalId() resolved ONCE at page load with no
                    // season awareness (defaults to season 1 server-side) - a multi-season show
                    // (e.g. Sword Art Online, 4 real seasons each under a DIFFERENT MAL id) kept
                    // getting season 1's own episodes back for every season, since this always
                    // sent that same stale id regardless of which season was actually selected.
                    // kaaOverride.malId (this episode's own real id) is the fix - only falls back
                    // to the stale id when this season isn't in the resolved groups at all.
                    const kaaMalId = kaaOverride.malId || malId;
                    const res = await fetch(
                        `/api/anime-kaa-servers?malId=${encodeURIComponent(kaaMalId)}&tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(selectedSeason)}&ep=${encodeURIComponent(kaaOverride.localEpisode)}&audio=${encodeURIComponent(audioType)}&itemType=${encodeURIComponent(requestedType)}&title=${encodeURIComponent(title)}${seasonTitleParam}${seasonEpCountParam}`
                    );
                    data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        // Don't return here — KAA can fail with a hard error (e.g. "No valid
                        // KickAssAnime match found", a 404) just as often as it can return 200
                        // with an empty sources array, and both should hit the same Neko/
                        // Megaplay fallback below instead of stopping dead on this one.
                        console.log('[KAA] request failed, falling through to fallback:', data?.error);
                        data = {};
                    }
                }

                const source = (data.sources || []).find(src => src?.proxiedUrl || src?.url || src?.file);
                const streamUrl = source?.proxiedUrl || source?.url || source?.file;
                window.currentKaaPlaylist = streamUrl;
                currentKaaSkipMarkers = Array.isArray(data.skipSegments) ? data.skipSegments : [];
                currentKaaSkipSegments = buildKaaPlaybackSegments(currentKaaSkipMarkers, 0);
                window.currentKaaSkipSegments = currentKaaSkipSegments;
                console.log('[KAA SKIP] received raw markers from backend:', currentKaaSkipMarkers);
                console.log('[KAA SKIP] built playback segments:', currentKaaSkipSegments);

                window.currentEpisodeInfo = {
                    episode,
                    audioType,
                    malId,
                    tmdbId,
                    season: selectedSeason,
                    skipSegments: currentKaaSkipSegments
                };
                if (!streamUrl) {
                    // A newer updateSource() call has already started (user switched servers
                    // again while this one was still resolving) - stop here rather than racing
                    // whatever that newer call is doing.
                    if (myGen !== playbackRequestGen) return false;
                    // KAA is the last hop of the Neko -> MegaPlay -> KAA auto-fallback chain -
                    // nothing left to fall further to.
                    if (infoDiv) infoDiv.textContent = 'KickAssAnime: No playable stream found.';
                    return false;
                }

                // Same staleness check for KAA's own (non-fallback) success path.
                if (myGen !== playbackRequestGen) return false;
                const episodeKey = buildEpisodeKey(selectedSeason, episode);
                const ok = showVideoPlayer(
                    streamUrl,
                    data.subtitles || [],
                    {
                        provider: "kickassanime",

                        title: document.getElementById("title")?.textContent.trim() || "Unknown Anime",
                        season: selectedSeason,

                        episode,

                        audio: audioType
                    }
                );
                if (ok) {
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId
                        });
                    }
                    renderKaaSkipSegments();
                    attachKaaSkipOverlay();
                }
                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? `KickAssAnime: Loaded ${source.quality || 'HLS'} [${audioType.toUpperCase()}]`
                        : 'KickAssAnime: HLS playback is not supported in this browser.';
                }

                return ok;
            } catch (err) {
                console.error('[KickAssAnime] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'KickAssAnime: Failed to load stream.';
                return false;
            }
        }

        // MegaPlay's own subtitle extraction - same shape/proxy pattern as the inline version
        // in loadMegaPlayFrame, factored out so fetchKaaSubtitlesForEpisode's fallback tier
        // below can reuse it instead of duplicating the tracks->subs mapping.
        async function fetchMegaplaySubtitlesForEpisode(episode, season) {
            try {
                const override = resolveEpisodeSourceOverride(season, episode);
                const megaplayMalId = override.malId || malId;
                if (!megaplayMalId) return [];
                const res = await fetch(`/api/anime-megaplay-log?malId=${encodeURIComponent(megaplayMalId)}&episode=${encodeURIComponent(override.localEpisode)}&lang=sub`);
                if (!res.ok) return [];
                const data = await res.json().catch(() => ({}));
                // Already pre-tokenized in {url, lang, default} shape server-side.
                return Array.isArray(data?.tracks) ? data.tracks : [];
            } catch (err) {
                console.warn('[SubtitleBorrow] Failed to borrow MegaPlay subtitles:', err);
                return [];
            }
        }

        async function fetchKaaSubtitlesForEpisode(episode, audioType, season) {
            const seasonSelectEl = document.getElementById('seasonSelect');
            const selectedSeason = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || season || 1;
            const title = document.getElementById('title')?.textContent.trim() || '';
            // Same stale-malId issue as the main KAA loader above (see kaaMalId's comment) -
            // this borrow-KAA's-subtitles path needs this season's own id too, not whatever
            // lookupMalId() resolved once at page load for season 1.
            const subOverride = resolveEpisodeSourceOverride(selectedSeason, episode);
            const kaaSubMalId = subOverride.malId || malId;
            const fetchFor = async (kaaAudio) => {
                try {
                    const query = new URLSearchParams({
                        malId: kaaSubMalId || '', tmdbId: tmdbId || '',
                        season: selectedSeason, ep: subOverride.localEpisode || 1, type: kaaAudio, title
                    });
                    const res = await fetch(`/api/anime-kaa-servers?${query.toString()}`);
                    if (!res.ok) return [];
                    const data = await res.json().catch(() => ({}));
                    return Array.isArray(data?.subtitles) ? data.subtitles : [];
                } catch (err) {
                    console.warn('[NekoStream] Failed to borrow KAA subtitles:', err);
                    return [];
                }
            };
            // Anikoto/Neko/RU-MV/MegaPlay don't provide their own caption tracks -- borrow
            // KAA's. Always tries the 'sub' entry first (that's where KAA's captions usually
            // live) regardless of which audio the caller itself is playing, sub or dub - but
            // KAA's sub/dub searches can land on genuinely different catalog entries with
            // different subtitle coverage, so if 'sub' comes back empty, try 'dub' too before
            // giving up entirely. If KAA has nothing at all (neither sub nor dub), MegaPlay is
            // the other real subtitle source (not just another KAA-borrower like Neko/RU-MV
            // are) - try its own extraction as a last resort before giving up.
            const subResult = await fetchFor('sub');
            if (subResult.length) return subResult;
            const dubResult = await fetchFor('dub');
            if (dubResult.length) return dubResult;
            return fetchMegaplaySubtitlesForEpisode(episode, selectedSeason);
        }

        async function loadMegaPlayFrame(episode, audioType) {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');
            const frame = document.getElementById('moviePlayerFrame');
            if (!frame) return false;
            if (!malId) {
                if (infoDiv) infoDiv.textContent = 'MegaPlay: MAL ID unavailable for this title.';
                return false;
            }
            // Split-cour seasons (e.g. "86 Part 2") are their own MAL entry with local
            // episode numbering — using the base show's malId here would silently load
            // the wrong season's episode.
            const seasonSelectEl = document.getElementById('seasonSelect');
            const selectedSeason = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || 1;
            const megaplayFrameOverride = resolveEpisodeSourceOverride(selectedSeason, episode);
            const megaplayMalId = megaplayFrameOverride.malId || malId;
            // Was previously never wired up at all - MegaPlay never saved or resumed progress,
            // same pattern KAA/Neko/RU-MV use. Stop any tracking left running from whichever
            // server was active before this one, same as loadNekoStreamVideo does on entry.
            stopKaaContinueWatching();
            if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                const activityUID = window.getActivityUID();
                await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
            }
            // Same preload-reuse pattern KAA's real loader uses (see window.preloadEpisodeSources
            // above) - was never wired up for MegaPlay at all before, so "Watch Now" always paid
            // both the /api/stream/mal health-check AND the /api/anime-megaplay-log extraction
            // live, even on the common path where the page-load preload had already resolved the
            // exact same season/episode/audio combo well before the click happened.
            const preloadedMegaEp = window.__preloadedMegaEpisode;
            const hasMatchingMegaPreload = window.__preloadedMegaSources && isFreshSourcePreload(preloadedMegaEp) &&
                parseInt(selectedSeason) === parseInt(preloadedMegaEp.season || 1) &&
                parseInt(episode) === parseInt(preloadedMegaEp.ep || 1) &&
                preloadedMegaEp.audioType === audioType;

            try {
                if (!hasMatchingMegaPreload) {
                    const res = await fetch(`/api/stream/mal/${encodeURIComponent(megaplayMalId)}/${encodeURIComponent(megaplayFrameOverride.localEpisode)}/${encodeURIComponent(audioType)}`);
                    if (!res.ok) {
                        if (myGen !== playbackRequestGen) return false;
                        console.log('[Fallback] MegaPlay health check failed, falling to KAA');
                        return await fallbackFromMegaToKaa(episode, audioType);
                    }
                }
                // Prefer NATIVE playback via the extracted stream: our own player instead of
                // megaplay's iframe, which also means no megaplay ads/branding, real subtitle
                // tracks, and - the reason this exists - their per-episode intro/outro skip
                // markers, which an iframe can't expose to our skip overlay at all.
                // Falls back to the original iframe below if extraction fails.
                try {
                    let ex;
                    if (hasMatchingMegaPreload) {
                        console.log('[MegaPlay] Using preloaded sources for S' + selectedSeason + 'E' + episode);
                        ex = window.__preloadedMegaSources;
                        window.__preloadedMegaSources = null;
                        window.__preloadedMegaEpisode = null;
                    } else {
                        const exRes = await fetch(`/api/anime-megaplay-log?malId=${encodeURIComponent(megaplayMalId)}&episode=${encodeURIComponent(megaplayFrameOverride.localEpisode)}&lang=${encodeURIComponent(audioType)}`);
                        ex = exRes.ok ? await exRes.json() : null;
                    }
                    if (ex?.ok && ex.stream) {
                        // {start,end} is already the shape getKaaSegmentStart/End read; `type`
                        // is what getKaaSkipRole keys off. Zeroed markers mean "none known"
                        // for this episode, so drop them rather than rendering a 0-0 segment.
                        const marks = [];
                        if (ex.intro && (ex.intro.end || 0) > 0) marks.push({ type: 'intro', start: ex.intro.start || 0, end: ex.intro.end });
                        if (ex.outro && (ex.outro.end || 0) > 0) marks.push({ type: 'outro', start: ex.outro.start || 0, end: ex.outro.end });
                        currentKaaSkipMarkers = marks;
                        currentKaaSkipSegments = buildKaaPlaybackSegments(currentKaaSkipMarkers, 0);
                        window.currentKaaSkipSegments = currentKaaSkipSegments;
                        renderKaaSkipSegments();
                        updateKaaSkipOverlay();

                        // Already pre-tokenized in {url, lang, default} shape server-side.
                        let subs = ex.tracks || [];
                        // Not every title's MegaPlay stream carries its own caption tracks -
                        // same borrow-KAA's-subs fallback loadNekoStreamVideo/loadNewStreamVideo
                        // already use for the same reason.
                        if (!subs.length) {
                            const borrowed = await fetchKaaSubtitlesForEpisode(episode, 'sub', selectedSeason);
                            if (myGen !== playbackRequestGen) return false;
                            subs = borrowed;
                        }

                        if (myGen !== playbackRequestGen) return false;
                        // /api/anime-megaplay-log now hands back an already-tokenized
                        // /api/m3u8-proxy link - no raw CDN URL to wrap here anymore.
                        const proxied = ex.stream;
                        const ok = showVideoPlayer(proxied, subs, {
                            provider: 'megaplay',
                            title: document.getElementById('title')?.textContent.trim() || 'Unknown Anime',
                            season: selectedSeason,
                            episode,
                            audio: audioType
                        });
                        if (ok !== false) {
                            if (infoDiv) infoDiv.textContent = `MegaPlay: Loaded [${audioType.toUpperCase()}]${marks.length ? ' · skip markers' : ''}`;
                            // Only the native path has a <video> element we can read currentTime
                            // from - the iframe fallback below is megaplay's own cross-origin
                            // player, so there's nothing to track there.
                            const episodeKey = buildEpisodeKey(selectedSeason, episode);
                            const videoEl = document.getElementById('moviePlayerVideo');
                            if (videoEl) {
                                const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                                if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                                    showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                                }
                                const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                                startKaaContinueWatching(videoEl, {
                                    episodeKey,
                                    userUID: activityUID,
                                    movieId: tmdbId
                                });
                            }
                            return true;
                        }
                    }
                } catch (exErr) {
                    console.warn('[MegaPlay] native extraction failed, falling back to iframe:', exErr?.message || exErr);
                }

                const data = await res.json();
                if (!data?.embedUrl) {
                    if (myGen !== playbackRequestGen) return false;
                    console.log('[Fallback] MegaPlay had no embed URL, falling to KAA');
                    return await fallbackFromMegaToKaa(episode, audioType);
                }
                if (myGen !== playbackRequestGen) return false;
                // Iframe fallback - no skip markers/subs available in this mode.
                currentKaaSkipMarkers = [];
                currentKaaSkipSegments = [];
                renderKaaSkipSegments();
                updateKaaSkipOverlay();
                frame.src = data.embedUrl;
                if (infoDiv) infoDiv.textContent = `MegaPlay: Loaded [${audioType.toUpperCase()}]`;
                return true;
            } catch (err) {
                console.error('[MegaPlay] playback error:', err);
                if (myGen !== playbackRequestGen) return false;
                console.log('[Fallback] MegaPlay threw, falling to KAA:', err?.message || err);
                return await fallbackFromMegaToKaa(episode, audioType);
            }
        }

        // MegaPlay -> KAA is the last hop of the Neko -> MegaPlay -> KAA auto-fallback chain.
        // Shared helper for MegaPlay's own failure points above, same pattern as
        // fallbackFromNekoToMega.
        async function fallbackFromMegaToKaa(episode, audioType) {
            document.querySelectorAll('.server-btn').forEach(btn => btn.classList.toggle('active', btn.id === 'srvPahe1'));
            window.currentServer = 'srvPahe1';
            showServerInfo('srvPahe1');
            return await loadKickAssAnimeVideo(episode, audioType);
        }
        async function loadNekoStreamVideo(episode, audioType, season) {
            const myGen = playbackRequestGen;
            window.currentAudioType = audioType;
            const infoDiv = document.getElementById('serverInfoText');

            try {
                stopKaaContinueWatching();
                currentKaaSkipMarkers = [];
                currentKaaSkipSegments = [];
                renderKaaSkipSegments();
                updateKaaSkipOverlay();

                if (infoDiv) infoDiv.textContent = 'NekoStream: Loading stream...';

                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                const frame = document.getElementById('moviePlayerFrame');
                const video = document.getElementById('moviePlayerVideo');
                if (frame) {
                    frame.src = 'about:blank';
                    frame.style.display = 'none';
                }
                if (video) {
                    try {
                        video.pause();
                        video.removeAttribute('src');
                        video.load();
                    } catch (e) {}
                    video.style.display = 'none';
                }

                const title =
                    animeTitle || document.getElementById('title')?.textContent.trim() || '';
                // A merged season can span multiple MAL parts (see resolveEpisodeSourceOverride's
                // own comment) - this episode's own malId, not the season's first/default one,
                // same fix KAA/MegaPlay already got. Without this, an episode past a merged
                // season's first part sent the WRONG malId to Neko, which anikotoapi.site
                // correctly rejects before falling back to the old VidTube path's own separate
                // (slower, less reliable) Part-2-search logic.
                // `ep` stays the CONTINUOUS episode number always - the backend's own search
                // fallback needs that (anikoto doesn't always split a season into the same
                // per-part pages MAL does - sometimes it bundles multiple cours into one
                // continuously-numbered page, confirmed live for Attack on Titan Season 3 Part
                // 2). `localEp` carries this episode's number within its own part - only used
                // backend-side when the malId above actually resolves to that part's own,
                // separate anikoto entry via the fast path; ignored otherwise.
                const nekoOverride = resolveEpisodeSourceOverride(season, episode);
                const query = new URLSearchParams({
                    malId: nekoOverride.malId || malId || '',
                    tmdbId: tmdbId || '',
                    title,
                    type: audioType,
                    season: season || 1,
                    ep: episode || 1,
                    localEp: nekoOverride.localEpisode || episode || 1
                });
                // Synthetic cour-split seasons (e.g. Workshop Battle) need this override -
                // anikoto's own page for one is often titled with the WRONG literal season too
                // (Workshop Battle's own anikoto title says "Season 2", not "Season 3"), so the
                // backend's literal-season-number matching can't find it without an anchor. See
                // resolveExactWatchUrl's overrideSeasonTitle comment for the full story. Uses
                // this episode's own part title (nekoOverride.label) rather than the season's
                // overall label, so a merged season's second+ part gets its OWN title as the
                // anchor instead of always anchoring to the first part's.
                const nekoSeasonGroups = window.__resolvedSeasonGroups || [];
                const nekoSeasonMatch = nekoSeasonGroups.find(g => Number(g.seasonNumber) === Number(season));
                const nekoSeasonTitle = nekoOverride.label || nekoSeasonMatch?.label;
                if (nekoSeasonTitle) query.set('seasonTitle', nekoSeasonTitle);
                const intervalId = setInterval(() => {
                    syncEpisodePanelHeight();
                }, 1000);

                // Stop the timer after 10 seconds (10000 milliseconds)
                setTimeout(() => {
                    clearInterval(intervalId);
                }, 10000);

                let data;
                const preloadedNekoEp = window.__preloadedNekoEpisode;
                // Same "can't trust a preload for a synthetic season" reasoning as KAA's own
                // loader - the page-load-time preload race almost certainly ran before
                // window.__resolvedSeasonGroups existed, so any cached result for one of these
                // seasons never had the override applied at all.
                const isSyntheticSeasonForNeko = !!nekoSeasonMatch;
                if (!isSyntheticSeasonForNeko && window.__preloadedNekoSources && isFreshSourcePreload(preloadedNekoEp) && parseInt(season) === parseInt(preloadedNekoEp.season || 1) && parseInt(episode) === parseInt(preloadedNekoEp.ep || 1) && (preloadedNekoEp.audio || 'sub') === audioType) {
                    console.log('[Neko] Using preloaded sources for S' + season + 'E' + episode);
                    data = window.__preloadedNekoSources;
                    window.__preloadedNekoSources = null;
                    window.__preloadedNekoEpisode = null;
                } else {
                    const res = await fetch(`/api/anime-neko-log?${query.toString()}`);
                    data = await res.json().catch(() => ({}));

                    if (!res.ok) {
                        if (myGen !== playbackRequestGen) return false;
                        console.log('[Fallback] Neko request failed, falling to MegaPlay:', data?.error);
                        return await fallbackFromNekoToMega(episode, audioType);
                    }
                }

                const streamUrl = data?.stream || data?.sources?.file || data?.url;
                if (!streamUrl) {
                    if (myGen !== playbackRequestGen) return false;
                    console.log('[Fallback] Neko had no sources, falling to MegaPlay');
                    return await fallbackFromNekoToMega(episode, audioType);
                }
                // Same skip-intro/outro data as KAA - /api/anime-neko-log now returns it too
                // (keyed by title/season/episode on anime-skip.com's side, not by provider).
                // Everything downstream (overlay render, timeupdate wiring, 10s auto-hide) is
                // already generic/shared with KAA, this just needs to populate the markers.
                currentKaaSkipMarkers = Array.isArray(data.skipSegments) ? data.skipSegments : [];
                currentKaaSkipSegments = buildKaaPlaybackSegments(currentKaaSkipMarkers, 0);
                window.currentKaaSkipSegments = currentKaaSkipSegments;
                let borrowedKaaSubtitles = await fetchKaaSubtitlesForEpisode(episode, audioType, season);
                // /api/anime-neko-log falls back to MegaPlay server-side when anikoto's own
                // VidTube server doesn't have this audio type - that fallback's own subtitle
                // tracks (data.tracks) are the last resort if even the KAA/MegaPlay borrow chain
                // above came back empty.
                // Already pre-tokenized in {url, lang, default} shape server-side (see
                // tokenizeMegaplayTracks) - no raw .file field to build a proxy URL from here.
                if (!borrowedKaaSubtitles.length && Array.isArray(data.tracks) && data.tracks.length) {
                    borrowedKaaSubtitles = data.tracks;
                }
                currentNekoDownloads = {
                    sub2: data?.downloads?.sub2 || null,
                    dub2: data?.downloads?.dub2 || null
                };
                if (myGen !== playbackRequestGen) return false;
                // /api/anime-neko-log now hands back an already-tokenized /api/m3u8-proxy
                // link (see buildM3u8ProxyUrl server-side) instead of the raw CDN URL - the
                // real stream address never reaches the browser at all anymore, and the
                // correct Referer (vidtube.site, or megaplay.buzz for the MegaPlay fallback)
                // is baked into that token server-side instead of appended here.
                const proxiedStreamUrl = streamUrl;
                const ok = showVideoPlayer(
                    proxiedStreamUrl, // <--- PASS THE PROXIED URL HERE
                    borrowedKaaSubtitles,
                    {
                        provider: 'nekostream',
                        title: document.getElementById('title')?.textContent.trim() || 'Unknown Anime',
                        season,
                        episode,
                        audio: audioType
                    }
                );

                if (ok) {
                    window.updateDownloadButtons(streamUrl);
                    const episodeKey = buildEpisodeKey(season, episode);
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? `NekoStream: Loaded HLS [${audioType.toUpperCase()}]`
                        : 'NekoStream: HLS playback is not supported in this browser.';
                }

                return ok;
            } catch (err) {
                console.error('[NekoStream] playback error:', err);
                currentNekoDownloads = { sub2: null, dub2: null };
                if (myGen !== playbackRequestGen) return false;
                console.log('[Fallback] Neko threw, falling to MegaPlay:', err?.message || err);
                return await fallbackFromNekoToMega(episode, audioType);
            }
        }

        // Neko -> MegaPlay -> KAA is the full auto-fallback chain (see updateSource's default
        // `currentServer` for anime). Small shared helper so all of Neko's own failure points
        // above (bad response, no stream, thrown error) hand off to MegaPlay identically instead
        // of duplicating the UI-highlight + showServerInfo + call dance three times.
        async function fallbackFromNekoToMega(episode, audioType) {
            document.querySelectorAll('.server-btn').forEach(btn => btn.classList.toggle('active', btn.id === 'srvMega1'));
            window.currentServer = 'srvMega1';
            showServerInfo('srvMega1');
            return await loadMegaPlayFrame(episode, audioType);
        }


        // NewStream (animego/aniboom) only carries a single Russian audio track per
        // translation group -- there's no separate sub/dub to pick, so this ignores
        // currentAudioMode entirely (the SUB/DUB row is hidden for this server in updateSource).
        async function loadNewStreamVideo(episode, season) {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');
            if (infoDiv) infoDiv.textContent = 'RU - MV: Loading stream...';

            try {
                stopKaaContinueWatching();

                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                const title =
                    animeTitle || document.getElementById('title')?.textContent.trim() || '';
                const query = new URLSearchParams({
                    malId: malId || '',
                    tmdbId: tmdbId || '',
                    title,
                    season: season || 1,
                    ep: episode || 1
                });

                let data;
                const preloadedNewEp = window.__preloadedNewEpisode;
                if (window.__preloadedNewSources && isFreshSourcePreload(preloadedNewEp) && parseInt(season) === parseInt(preloadedNewEp.season || 1) && parseInt(episode) === parseInt(preloadedNewEp.ep || 1)) {
                    console.log('[NewStream] Using preloaded sources for S' + season + 'E' + episode);
                    data = window.__preloadedNewSources;
                    window.__preloadedNewSources = null;
                    window.__preloadedNewEpisode = null;
                } else {
                    const res = await fetch(`/api/anime-new-log?${query.toString()}`);
                    data = await res.json().catch(() => ({}));

                    if (!res.ok || !data?.stream) {
                        if (infoDiv) infoDiv.textContent = 'RU - MV: Stream unavailable.';
                        return false;
                    }
                }

                if (!data?.stream) {
                    if (infoDiv) infoDiv.textContent = 'RU - MV: Not available yet.';
                    return false;
                }

                // Same skip-intro/outro data as KAA/Neko - /api/anime-new-log now returns it
                // too (keyed by title/season/episode on anime-skip.com's side, not by
                // provider). Overlay render/timeupdate wiring/10s auto-hide are shared already.
                currentKaaSkipMarkers = Array.isArray(data.skipSegments) ? data.skipSegments : [];
                currentKaaSkipSegments = buildKaaPlaybackSegments(currentKaaSkipMarkers, 0);
                window.currentKaaSkipSegments = currentKaaSkipSegments;

                // NewStream doesn't carry its own caption tracks either -- same trick as
                // Neko, borrow KAA's (English) subs for this episode if it has any.
                const borrowedKaaSubtitles = await fetchKaaSubtitlesForEpisode(episode, 'sub', season);
                if (myGen !== playbackRequestGen) return false;
                // /api/anime-new-log now hands back an already-tokenized /api/m3u8-proxy link
                // (see buildM3u8ProxyUrl server-side) - no raw CDN URL to wrap here anymore.
                const proxiedStreamUrl = data.stream;
                const ok = showVideoPlayer(
                    proxiedStreamUrl,
                    borrowedKaaSubtitles,
                    {
                        provider: 'newstream',
                        title: document.getElementById('title')?.textContent.trim() || 'Unknown Anime',
                        season,
                        episode,
                        audio: 'ru'
                    }
                );

                if (ok) {
                    const episodeKey = buildEpisodeKey(season, episode);
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? `RU - MV: Loaded HLS [${data.translationTitle || 'RU'}]`
                        : 'RU - MV: HLS playback is not supported in this browser.';
                }
                return ok;
            } catch (err) {
                console.error('[NewStream] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'RU - MV: Failed to load stream.';
                return false;
            }
        }

        // RU Movie (kinogo.mu/cinemar.cc) -- movies only, single Russian dub track,
        // same "ignore sub/dub" deal as the anime RU server.
        async function loadRuMovieVideo() {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');
            if (isSeries) {
                if (infoDiv) infoDiv.textContent = 'RU - MV: Not available for TV shows yet.';
                return false;
            }
            if (infoDiv) infoDiv.textContent = 'RU - MV: Loading stream...';

            try {
                stopKaaContinueWatching();

                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                const title = document.getElementById('title')?.textContent.trim() || '';
                const query = new URLSearchParams({
                    tmdbId: tmdbId || '',
                    title
                });

                const res = await fetch(`/api/movie-ru-log?${query.toString()}`);
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data?.stream) {
                    if (infoDiv) infoDiv.textContent = 'RU - MV: Stream unavailable.';
                    return false;
                }

                if (myGen !== playbackRequestGen) return false;
                // /api/movie-ru-log now hands back an already-tokenized /api/m3u8-proxy link -
                // no raw CDN URL to wrap here.
                const proxiedStreamUrl = data.stream;
                const ok = showVideoPlayer(
                    proxiedStreamUrl,
                    [],
                    {
                        provider: 'kinogo',
                        title,
                        audio: 'ru'
                    }
                );

                if (ok) {
                    const episodeKey = 'movie';
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId,
                            itemType: 'movie'
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? `RU - MV: Loaded HLS [${data.translationTitle || 'RU'}]`
                        : 'RU - MV: HLS playback is not supported in this browser.';
                }
                return ok;
            } catch (err) {
                console.error('[RU Movie] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'RU - MV: Failed to load stream.';
                return false;
            }
        }

        // Kino (vidsrcme.ru -> cloudorchestranova.com) -- movies only, English HLS. Extracted
        // server-side via plain HTTP requests (~0.9s typically - see vidscr.txt), with a
        // Puppeteer/headless-browser extraction kept as an automatic fallback if that stops
        // working (~6-7s in that case). window.preloadEpisodeSources() kicks this off in the
        // background shortly after page load (same pattern as KAA/Neko) regardless, so by the
        // time someone actually picks this server it's often already resolved. No sub/dub
        // toggle, same "ignore audio mode" deal as the RU sources.
        async function loadKinoVideo() {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');
            if (isSeries) {
                if (infoDiv) infoDiv.textContent = 'Kino: Use the Kino button in the TV Shows row for series.';
                return false;
            }

            try {
                stopKaaContinueWatching();

                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                const subtitlesPromise = window.fetchKinoSubtitleTracks(tmdbId, 'movie');

                let data;
                const preloaded = window.__preloadedKinoSource;
                if (isFreshSourcePreload(preloaded) && String(preloaded.tmdbId) === String(tmdbId) && preloaded.data?.stream) {
                    if (infoDiv) infoDiv.textContent = 'Kino: Loading (preloaded)...';
                    data = preloaded.data;
                    window.__preloadedKinoSource = null;
                } else {
                    if (infoDiv) infoDiv.textContent = 'Kino: Resolving stream...';
                    const query = new URLSearchParams({ tmdbId: tmdbId || '' });
                    const res = await fetch(`/api/movie-kino-log?${query.toString()}`);
                    data = await res.json().catch(() => ({}));
                    if (!res.ok || !data?.stream) {
                        if (infoDiv) infoDiv.textContent = 'Kino: Stream unavailable.';
                        return false;
                    }
                }

                const subtitles = await subtitlesPromise;
                if (myGen !== playbackRequestGen) return false;
                // /api/movie-kino-log now hands back an already-tokenized /api/m3u8-proxy
                // link (see buildM3u8ProxyUrl server-side) - no raw CDN URL to wrap here.
                const proxiedStreamUrl = data.stream;
                const ok = showVideoPlayer(
                    proxiedStreamUrl,
                    subtitles,
                    {
                        provider: 'kino',
                        title: document.getElementById('title')?.textContent.trim() || '',
                        audio: 'en'
                    }
                );

                if (ok) {
                    const episodeKey = 'movie';
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId,
                            itemType: 'movie'
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? 'Kino: Loaded HLS'
                        : 'Kino: HLS playback is not supported in this browser.';
                }
                return ok;
            } catch (err) {
                console.error('[Kino] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'Kino: Failed to load stream.';
                return false;
            }
        }

        // Kino TV -- same vidsrcme.ru extraction as loadKinoVideo(), just the
        // /embed/tv/{id}/{season}/{episode} path instead of /embed/movie/{id}.
        // preloadKinoTvSource() (fired from preloadEpisodeSources() shortly
        // after page load, using the continue-from season/episode) warms this
        // the same way KAA/Neko/movie-Kino are warmed.
        async function loadKinoTvVideo(episode, season) {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');
            if (!isSeries) {
                if (infoDiv) infoDiv.textContent = 'Kino: Use the Kino button in the Movies row for movies.';
                return false;
            }

            try {
                stopKaaContinueWatching();

                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                const subtitlesPromise = window.fetchKinoSubtitleTracks(tmdbId, 'tv', season, episode);

                let data;
                const preloaded = window.__preloadedKinoTvSource;
                if (isFreshSourcePreload(preloaded) && String(preloaded.tmdbId) === String(tmdbId)
                    && parseInt(preloaded.season) === parseInt(season || 1)
                    && parseInt(preloaded.episode) === parseInt(episode || 1)
                    && preloaded.data?.stream) {
                    if (infoDiv) infoDiv.textContent = 'Kino: Loading (preloaded)...';
                    data = preloaded.data;
                    window.__preloadedKinoTvSource = null;
                } else {
                    if (infoDiv) infoDiv.textContent = 'Kino: Resolving stream...';
                    const query = new URLSearchParams({
                        tmdbId: tmdbId || '',
                        season: season || 1,
                        episode: episode || 1
                    });
                    const res = await fetch(`/api/tv-kino-log?${query.toString()}`);
                    data = await res.json().catch(() => ({}));
                    if (!res.ok || !data?.stream) {
                        if (infoDiv) infoDiv.textContent = 'Kino: Stream unavailable.';
                        return false;
                    }
                }

                const subtitles = await subtitlesPromise;
                if (myGen !== playbackRequestGen) return false;
                // /api/tv-kino-log now hands back an already-tokenized /api/m3u8-proxy link -
                // no raw CDN URL to wrap here.
                const proxiedStreamUrl = data.stream;
                const ok = showVideoPlayer(
                    proxiedStreamUrl,
                    subtitles,
                    {
                        provider: 'kinotv',
                        title: document.getElementById('title')?.textContent.trim() || '',
                        season,
                        episode,
                        audio: 'en'
                    }
                );

                if (ok) {
                    const episodeKey = buildEpisodeKey(season, episode);
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId,
                            itemType: 'tv'
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? 'Kino: Loaded HLS'
                        : 'Kino: HLS playback is not supported in this browser.';
                }
                return ok;
            } catch (err) {
                console.error('[Kino TV] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'Kino: Failed to load stream.';
                return false;
            }
        }

        // T1M (api.shows.st) - single endpoint covers both movies and TV, unlike Kino's
        // separate loadKinoVideo/loadKinoTvVideo. Its API hands back a fully plaintext HLS
        // manifest already resolved server-side (see /api/t1m-servers's own comment) - `stream`
        // here is already our own /api/t1m-master.m3u8 URL, not a raw upstream one, so there's
        // no extraction/token step to do client-side at all, same shape as Kino's own `stream`.
        async function loadT1mVideo(episode, season) {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');

            try {
                stopKaaContinueWatching();
                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                if (infoDiv) infoDiv.textContent = 'T1M: Resolving stream...';
                const query = new URLSearchParams({
                    tmdbId: tmdbId || '',
                    type: isSeries ? 'tv' : 'movie',
                    season: season || 1,
                    episode: episode || 1
                });
                const res = await fetch(`/api/t1m-servers?${query.toString()}`);
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.ok || !data.stream) {
                    if (infoDiv) infoDiv.textContent = `T1M: ${data?.error || 'Stream unavailable.'}`;
                    return false;
                }

                if (myGen !== playbackRequestGen) return false;
                const ok = showVideoPlayer(
                    data.stream,
                    Array.isArray(data.tracks) ? data.tracks : [],
                    {
                        provider: 't1m',
                        title: document.getElementById('title')?.textContent.trim() || '',
                        season,
                        episode,
                        audio: 'en'
                    }
                );

                if (ok) {
                    const episodeKey = buildEpisodeKey(season, episode);
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId,
                            itemType: isSeries ? 'tv' : 'movie'
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? `T1M: Loaded HLS${data.tracks?.length ? ' · subtitles' : ''}`
                        : 'T1M: HLS playback is not supported in this browser.';
                }
                return ok;
            } catch (err) {
                console.error('[T1M] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'T1M: Failed to load stream.';
                return false;
            }
        }

        // Small anchored menu letting the user pick a quality instead of always getting the
        // best one - one instance reused for both RU movie and RU TV downloads. Built as a
        // plain positioned <div> (no existing dropdown component on this page to reuse) styled
        // with the same theme.js CSS variables apiDocs.css and the rest of the site rely on, so
        // it matches dark/light theme automatically.
        let activeQualityMenu = null;
        function closeRuQualityMenu() {
            if (activeQualityMenu) {
                activeQualityMenu.remove();
                activeQualityMenu = null;
                document.removeEventListener('click', onRuQualityMenuOutsideClick, true);
                document.removeEventListener('keydown', onRuQualityMenuEscape, true);
            }
        }
        function onRuQualityMenuOutsideClick(e) {
            if (activeQualityMenu && !activeQualityMenu.contains(e.target)) closeRuQualityMenu();
        }
        function onRuQualityMenuEscape(e) {
            if (e.key === 'Escape') closeRuQualityMenu();
        }
        function showRuQualityMenu(anchorBtn, links) {
            closeRuQualityMenu();
            const menu = document.createElement('div');
            menu.style.cssText = `
                position: absolute; z-index: 10000; min-width: 160px;
                background: var(--bg-card, #1c1c1c); border: 1px solid var(--border-color, #333);
                border-radius: 8px; padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            `;
            links.forEach(link => {
                const item = document.createElement('button');
                item.type = 'button';
                const label = link.hint ? `${link.quality} · ${link.hint}` : (link.quality || 'Download');
                item.textContent = label;
                item.style.cssText = `
                    display: block; width: 100%; text-align: left; background: none; border: none;
                    color: var(--text-primary, #fff); font-size: 0.88rem; padding: 8px 10px;
                    border-radius: 6px; cursor: pointer;
                `;
                item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-hover, #2a2a2a)'; });
                item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
                item.addEventListener('click', () => {
                    window.open(link.url, '_blank', 'noopener,noreferrer');
                    closeRuQualityMenu();
                });
                menu.appendChild(item);
            });
            document.body.appendChild(menu);
            const rect = anchorBtn.getBoundingClientRect();
            const top = rect.bottom + window.scrollY + 6;
            let left = rect.left + window.scrollX;
            const maxLeft = window.scrollX + document.documentElement.clientWidth - menu.offsetWidth - 8;
            if (left > maxLeft) left = Math.max(8, maxLeft);
            menu.style.top = `${top}px`;
            menu.style.left = `${left}px`;
            activeQualityMenu = menu;
            // Deferred so the click that opened the menu doesn't immediately close it via the
            // capturing listener below.
            setTimeout(() => {
                document.addEventListener('click', onRuQualityMenuOutsideClick, true);
                document.addEventListener('keydown', onRuQualityMenuEscape, true);
            }, 0);
        }

        // Mirrors cinemar's own download button: resolves the same title, then asks
        // cinemar.cc for direct progressive-MP4 links (one per quality) and lets the user pick.
        async function downloadRuMovie(btn) {
            if (isSeries) {
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('RU movie downloads are not available for TV shows.');
                }
                return;
            }
            const originalLabel = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Resolving...';
            try {
                const title = document.getElementById('title')?.textContent.trim() || '';
                const query = new URLSearchParams({ tmdbId: tmdbId || '', title });
                const res = await fetch(`/api/movie-ru-download?${query.toString()}`);
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !Array.isArray(data?.links) || data.links.length === 0) {
                    if (typeof window.showLimitToast === 'function') {
                        window.showLimitToast(data?.error || 'No download link available for this movie.');
                    }
                    return;
                }

                // Links come back best-quality first (site's own ordering) - menu keeps that order.
                showRuQualityMenu(btn, data.links);
            } catch (err) {
                console.error('[RU Movie Download] error:', err);
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('Failed to resolve a download link.');
                }
            } finally {
                btn.disabled = false;
                btn.textContent = originalLabel;
            }
        }
        // The delegated click listener on playerSection is registered at
        // DOMContentLoaded time, outside this closure -- expose globally so it can
        // reach this function, same pattern as window.downloadKAAEpisode.
        window.downloadRuMovie = downloadRuMovie;

        // RU TV (kinogo/cinemar series tree) -- same "one Russian track, no sub/dub
        // toggle" deal as the anime and movie RU sources.
        async function loadRuTvVideo(episode, season) {
            const myGen = playbackRequestGen;
            const infoDiv = document.getElementById('serverInfoText');
            if (!isSeries) {
                if (infoDiv) infoDiv.textContent = 'RU - MV: Not available for movies.';
                return false;
            }
            if (infoDiv) infoDiv.textContent = 'RU - MV: Loading stream...';

            try {
                stopKaaContinueWatching();

                if (!watchHistoryCache && typeof window.getActivityUID === 'function') {
                    const activityUID = window.getActivityUID();
                    await fetchWatchHistory(activityUID, tmdbId).then(setWatchHistoryCache);
                }

                const title = document.getElementById('title')?.textContent.trim() || '';
                const query = new URLSearchParams({
                    tmdbId: tmdbId || '',
                    title,
                    season: season || 1,
                    episode: episode || 1
                });

                const res = await fetch(`/api/tv-ru-log?${query.toString()}`);
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data?.stream) {
                    if (infoDiv) infoDiv.textContent = 'RU - MV: Stream unavailable.';
                    return false;
                }

                if (myGen !== playbackRequestGen) return false;
                // /api/tv-ru-log now hands back an already-tokenized /api/m3u8-proxy link -
                // no raw CDN URL to wrap here.
                const proxiedStreamUrl = data.stream;
                const ok = showVideoPlayer(
                    proxiedStreamUrl,
                    [],
                    {
                        provider: 'kinogotv',
                        title,
                        season,
                        episode,
                        audio: 'ru'
                    }
                );

                if (ok) {
                    const episodeKey = buildEpisodeKey(season, episode);
                    const videoEl = document.getElementById('moviePlayerVideo');
                    if (videoEl) {
                        const resumeSeconds = getWatchHistoryResumeSeconds(episodeKey);
                        if (Number.isFinite(resumeSeconds) && resumeSeconds > 5) {
                            showKaaResumeOverlay(episodeKey, resumeSeconds, () => applyResumeToVideo(videoEl, resumeSeconds), () => {});
                        }
                        const activityUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
                        startKaaContinueWatching(videoEl, {
                            episodeKey,
                            userUID: activityUID,
                            movieId: tmdbId,
                            itemType: 'tv'
                        });
                    }
                }

                if (infoDiv) {
                    infoDiv.textContent = ok
                        ? `RU - MV: Loaded HLS [${data.translationTitle || 'RU'}]`
                        : 'RU - MV: HLS playback is not supported in this browser.';
                }
                return ok;
            } catch (err) {
                console.error('[RU TV] playback error:', err);
                if (infoDiv) infoDiv.textContent = 'RU - MV: Failed to load stream.';
                return false;
            }
        }

        async function downloadRuTv(btn) {
            if (!isSeries) {
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('RU TV downloads are not available for movies.');
                }
                return;
            }
            const originalLabel = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Resolving...';
            try {
                const title = document.getElementById('title')?.textContent.trim() || '';
                const seasonSelectEl = document.getElementById('seasonSelect');
                const selectedSeason = seasonSelectEl?.value === 'all'
                    ? (seasonSelectEl?.dataset.playSeason || 1)
                    : (seasonSelectEl?.value || 1);
                const episode = document.getElementById('episodeSelect')?.value || 1;
                const query = new URLSearchParams({ tmdbId: tmdbId || '', title, season: selectedSeason, episode });
                const res = await fetch(`/api/tv-ru-download?${query.toString()}`);
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !Array.isArray(data?.links) || data.links.length === 0) {
                    if (typeof window.showLimitToast === 'function') {
                        window.showLimitToast(data?.error || 'No download link available for this episode.');
                    }
                    return;
                }

                showRuQualityMenu(btn, data.links);
            } catch (err) {
                console.error('[RU TV Download] error:', err);
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('Failed to resolve a download link.');
                }
            } finally {
                btn.disabled = false;
                btn.textContent = originalLabel;
            }
        }
        window.downloadRuTv = downloadRuTv;

        // 4. Update Source Logic
        function updateSource(server) {
            playbackRequestGen++;
            showPlayerLoadingOverlay();
            currentServer = server;
            window.currentServer = server;
            // hsub exists on NekoStream only - switching to any other server while it's the
            // active mode would otherwise silently request an audio type that server can't
            // serve, so fall back to plain sub and keep the button row honest.
            if (currentAudioMode === 'hsub' && server !== 'srvNeko1') {
                currentAudioMode = 'sub';
                window.currentAudioType = 'sub';
            }
            window.__syncHsubVisibility?.();
            document.getElementById('btnSub')?.classList.toggle('active', currentAudioMode === 'sub');
            document.getElementById('btnDub')?.classList.toggle('active', currentAudioMode === 'dub');
            document.getElementById('btnHsub')?.classList.toggle('active', currentAudioMode === 'hsub');
            console.log('[updateSource] start', {
                server,
                season: document.getElementById('seasonSelect')?.value,
                playSeason: document.getElementById('seasonSelect')?.dataset?.playSeason,
                episode: document.getElementById('episodeSelect')?.value,
                audio: currentAudioMode
            });

            updateKaaControlsVisibility();
            const subDubRow = document.getElementById('subDubToggleRow');
            if (subDubRow) subDubRow.style.display = server === 'srvNew1' ? 'none' : 'flex';
            const seasonSelectEl = document.getElementById('seasonSelect');
            const selectedSeason = seasonSelectEl?.value || 1;
            let s = selectedSeason === 'all'
                ? (seasonSelectEl?.dataset.playSeason || 1)
                : selectedSeason;
            let e = document.getElementById('episodeSelect')?.value || 1;
            let url = '';

            // Update the UI Episode number box
            const epNumDisplay = document.getElementById('episodeNum');
            if(epNumDisplay) epNumDisplay.textContent = e;

            // Let other scripts (comments section) know which anime episode is now active.
            // malId only resolves after Watch Now is clicked, same as the rest of playback.
            if (isAnime && malId) {
                window.__currentAnimeMalId = malId;
                window.__currentAnimeSeason = parseInt(s, 10) || 1;
                window.__currentAnimeEpisode = parseInt(e, 10) || 1;
                window.dispatchEvent(new CustomEvent('anime-episode-changed', {
                    detail: { malId, season: window.__currentAnimeSeason, episode: window.__currentAnimeEpisode, title: animeTitle || document.getElementById('title')?.textContent.trim() || '' }
                }));
                // Same SUB/DUB(KAA)/RU-MV/HSUB availability check the download panel uses,
                // fired here too so it's usually already cached (dlAvailabilityCache, keyed by
                // malId+season+episode) by the time someone opens that panel, and so the live
                // SUB/DUB/RU-MV buttons themselves reflect it instead of only ever failing
                // silently when clicked. dlCheckAvailability is declared further down in this
                // same scope but only actually runs once updateSource() is invoked (a click
                // handler or the one-time kickoff call at the bottom of this block), by which
                // point that declaration has long since executed - not a temporal-dead-zone issue.
                dlCheckAvailability?.();
            }

            // Update Active Highlight on the visual List
            document.querySelectorAll('.episode-list-item').forEach(item => {
                const itemSeason = item.getAttribute('data-season') || String(s);
                if(item.getAttribute('data-ep') == e && String(itemSeason) === String(s)) {
                    item.classList.add('active');
                    item.scrollIntoView({behavior: "smooth", block: "nearest"}); // Auto-scroll list to active episode
                } else {
                    item.classList.remove('active');
                }
            });
            if (server === 'srvNeko1') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadNekoStreamVideo(
                    e,
                    currentAudioMode,
                    s
                );
                return;
            }
            if (server === 'srvNew1') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadNewStreamVideo(e, s);
                return;
            }
            if (server === 'srvRuMovie') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadRuMovieVideo();
                return;
            }
            if (server === 'srvKino') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadKinoVideo();
                return;
            }
            if (server === 'srvRuTv') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadRuTvVideo(e, s);
                return;
            }
            if (server === 'srvKinoTv') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadKinoTvVideo(e, s);
                return;
            }
            if (server === 'srvT1mM' || server === 'srvT1mTV') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadT1mVideo(e, s);
                return;
            }
            if (server === 'srvPahe1') {
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === server);
                });
                showServerInfo(server);
                loadKickAssAnimeVideo(
                    e,
                    currentAudioMode
                );
                return;
            }
            // Map TV buttons to their base server logic
            let logicalServer = server;
            if (server === 'srvMegaTV') logicalServer = 'srvMega';
            if (server === 'srvUpTV') logicalServer = 'srvUp';
            if (server === 'srvTTV') logicalServer = 'srvT';
            if (server === 'srvMoviesApiM') logicalServer = 'srvMoviesApi';
            if (server === 'srv111MoviesM') logicalServer = 'srv111Movies';
            if (server === 'srvNontonGoM') logicalServer = 'srvNontonGo';

            if (logicalServer === 'srvMega') {
                url = isSeries
                    ? `https://vidsrcme.su/embed/tv/${tmdbId}/${s}/${e}`
                    : `https://vidsrcme.su/embed/movie/${tmdbId}`;
            } else if (logicalServer === 'srvUp') {
                url = isSeries
                    ? `https://vidsrcme.ru/embed/tv/${tmdbId}/${s}/${e}`
                    : `https://vidsrcme.ru/embed/movie/${tmdbId}`;
            } else if (logicalServer === 'srvT') {
                url = isSeries
                    ? `https://vidsrc-embed.su/embed/tv/${tmdbId}/${s}/${e}`
                    : `https://vidsrc-embed.su/embed/movie/${tmdbId}`;
            } else if (logicalServer === 'server2embed') {
                url = isSeries ? `https://www.2embed.cc/embed/tv/${tmdbId}/${s}/${e}` : `https://www.2embed.cc/embed/${imdbId}`;
            } else if (logicalServer === 'serverSuperembed') {
                url = isSeries ? `https://multiembed.mov/?video_id=tmdb-${tmdbId}-S${s}-E${e}` : `https://multiembed.mov/?video_id=${imdbId}`;
            } else if (logicalServer === 'srvMoviesApi') {
                url = isSeries ? `https://moviesapi.club/tv/${tmdbId}-${s}-${e}` : `https://moviesapi.club/movie/${tmdbId}`;
            } else if (logicalServer === 'srv111Movies') {
                url = isSeries ? `https://111movies.com/tv/${tmdbId}/${s}/${e}` : `https://111movies.com/movie/${tmdbId}`;
            } else if (logicalServer === 'srvNontonGo') {
                url = isSeries ? `https://www.NontonGo.win/embed/tv/${tmdbId}/${s}/${e}` : `https://www.NontonGo.win/embed/movie/${tmdbId}`;
            } else if (logicalServer === 'srvMega1') {
                url = '__async__';
                showIframePlayer('about:blank');
                const infoDiv = document.getElementById('serverInfoText');
                if (infoDiv) infoDiv.textContent = 'MegaPlay: Loading...';
                const audioType = currentAudioMode === 'dub' ? 'dub' : 'sub';
                loadMegaPlayFrame(e, audioType).then(ok => {
                    if (!ok && infoDiv) infoDiv.textContent = 'MegaPlay: Failed to load. Try another source.';
                });
            }

            if (isAnime && currentAudioMode === 'dub' && url && url !== '__async__') {
                const paramStarter = url.includes('?') ? '&' : '?';
                url += `${paramStarter}audio=dub&lang=en`;
            }

            if (url !== '__async__') {
                if (moviesBtns.has(server)) {
                    console.log('[moviePlayer] Movie server request URL:', {
                        server,
                        logicalServer,
                        requestedType,
                        tmdbId,
                        season: s,
                        episode: e,
                        isSeries,
                        url
                    });
                }
                showIframePlayer(url);
            }

            document.querySelectorAll('.server-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === server);
            });
            showServerInfo(server);
        }

        // 5. Bind Listeners
        document.getElementById('btnSub').onclick = function() {
            currentAudioMode = 'sub';
            window.currentAudioType = currentAudioMode;
            localStorage.setItem('preferredAudio', 'sub');
            applyAudioButtonState(currentAudioMode);
            updateSource(currentServer);
            startEpisodePanelHeightSyncBurst();
        };
        
        document.getElementById('btnDub').onclick = function() {
            currentAudioMode = 'dub';
            window.currentAudioType = currentAudioMode;
            localStorage.setItem('preferredAudio', 'dub');
            applyAudioButtonState(currentAudioMode);
            updateSource(currentServer);
            startEpisodePanelHeightSyncBurst();
        };

        // Deliberately NOT persisted to preferredAudio: hsub only exists on one server and
        // only for some titles, so remembering it would leave users stuck on a mode that
        // silently falls back everywhere else. It stays a per-session choice.
        document.getElementById('btnHsub')?.addEventListener('click', function() {
            currentAudioMode = 'hsub';
            window.currentAudioType = currentAudioMode;
            applyAudioButtonState(currentAudioMode);
            // hsub only exists on NekoStream - the button is visible on every server now, so
            // route through Neko regardless of what's currently selected. updateSource's own
            // guard would otherwise immediately revert this back to 'sub' on any other server.
            updateSource('srvNeko1');
            startEpisodePanelHeightSyncBurst();
        });

        // ── Download Anime panel ────────────────────────────────────────────────
        // One button opens a picker: which server, and sub/dub/hsub. Real subtitle BURNING
        // (picking a language, or skipping) is NOT built here - it's the existing modal
        // (ensureDownloadModal/#downloadSubsPicker in downloadEpisode.js) that already pops up
        // automatically once a download actually starts via downloadKAAEpisode/
        // downloadKinoEpisode, reading whatever's active in window.currentVideo.subtitles.
        //
        // KAA / MegaPlay / NekoStream / RU-MV all go through THAT existing client-side
        // ffmpeg.wasm pipeline (burn-capable, no server bandwidth) - but it only ever operates
        // on whatever's CURRENTLY LOADED, so picking a source that isn't already active
        // switches the player to it first, waits for it to actually load, then downloads.
        // Which of the two existing download functions to use is NOT the same per source -
        // verified live by fetching each source's real master.m3u8 rather than assuming:
        //   KAA and RU-MV  both carry a separate #EXT-X-MEDIA audio track -> downloadKAAEpisode
        //     (it hard-requires master.audios.length >= 1 and throws "No matching audio
        //     playlist found" otherwise - confirmed this breaks on the other two)
        //   MegaPlay and NekoStream both mux audio+video together per variant, same shape as
        //     Kino -> downloadKinoEpisode (no separate-track assumption at all)
        // Kiwi (external) has no burn capability - it's a link to a third-party download page.
        const DL_SOURCE_INFO = {
            kaa:      { server: 'srvPahe1', provider: 'kickassanime', fn: 'downloadKAAEpisode' },
            megaplay: { server: 'srvMega1', provider: 'megaplay',     fn: 'downloadKinoEpisode' },
            neko:     { server: 'srvNeko1', provider: 'nekostream',   fn: 'downloadKinoEpisode' },
            rumv:     { server: 'srvNew1',  provider: 'newstream',    fn: 'downloadKAAEpisode' }
        };

        const dlPanel = document.getElementById('animeDownloadPanel');
        let dlSource = 'kaa', dlLang = 'sub', dlQuality = '1080p';

        // Checking the box with the picker still on "Skip" silently downgrades "burn
        // subtitles" back into a no-op (burnEnabled requires a real value, not '') -
        // default to English so checking the box alone actually does something.
        const dlAutoPickSubsLanguage = () => {
            const picker = document.getElementById('dlSubsPicker');
            if (!picker || picker.value !== '') return;
            const options = Array.from(picker.options).filter(o => o.value !== '');
            const english = options.find(o => /english|^eng$/i.test(o.textContent.trim()));
            const pick = english || options[0];
            if (pick) picker.value = pick.value;
        };

        // The burn checkbox+picker mirror what ensureDownloadModal()'s own
        // #downloadIncludeSubs/#downloadSubsPicker do inside the progress dialog - duplicated
        // here so the choice can be made up-front in the panel instead of after the download
        // (and, for a source that isn't loaded yet, after switching) has already started.
        // Only reflects real options once the picked source is actually the one loaded, since
        // window.currentVideo.subtitles belongs to whatever's currently playing.
        const dlPopulateSubsPicker = () => {
            const picker = document.getElementById('dlSubsPicker');
            const checkbox = document.getElementById('dlBurnCheckbox');
            if (!picker || !checkbox) return;
            const info = DL_SOURCE_INFO[dlSource];
            const isActive = info && window.currentServer === info.server && window.currentVideo?.provider === info.provider;
            const tracks = isActive && Array.isArray(window.currentVideo?.subtitles)
                ? window.currentVideo.subtitles.filter(t => t?.url) : [];
            picker.innerHTML = '';
            const skipOpt = document.createElement('option');
            skipOpt.value = '';
            skipOpt.textContent = tracks.length ? 'Skip' : 'No subtitles available';
            picker.appendChild(skipOpt);
            tracks.forEach((track, index) => {
                const opt = document.createElement('option');
                opt.value = String(index);
                opt.textContent = track.lang || track.language || `Subtitle ${index + 1}`;
                picker.appendChild(opt);
            });
            // The checkbox itself stays enabled even with nothing to pick yet (e.g. the panel
            // just opened and the chosen source hasn't been switched to) - disabling it here
            // made it unclickable until a source happened to already be active with subtitles,
            // which for the default/most sources is never true until the actual download runs
            // its own switch. The picker below is what actually reflects "nothing to burn yet".
            picker.disabled = !checkbox.checked;
            // Clearing innerHTML above always resets the select back to its first option
            // ("Skip") even if the user had already picked a language and checked the box
            // before switching servers - re-apply the same auto-pick so that choice survives
            // the repopulate that happens after the panel's own source switch.
            if (checkbox.checked) dlAutoPickSubsLanguage();
        };

        document.getElementById('dlBurnCheckbox')?.addEventListener('change', (e) => {
            const picker = document.getElementById('dlSubsPicker');
            if (!picker) return;
            picker.disabled = !e.target.checked;
            if (e.target.checked) dlAutoPickSubsLanguage();
        });

        // Server/type availability for the panel - HSUB (Neko only), SUB/DUB on KAA specifically
        // (the source that's actually flaky about it - see vidscr.txt), and whether RU-MV has
        // this title at all. All three reuse the exact same server-side caches real playback
        // already writes to, so a cold check costs exactly what actually switching to that
        // source would anyway. Cached again here per (malId, season, episode) so reopening the
        // panel for the same episode doesn't refire any of these - that's the actual "too many
        // requests" fix, since the server-side caches alone still cost a round trip each time.
        const dlAvailabilityCache = new Map();
        let dlAvailability = { hsub: false, kaaSub: true, kaaDub: true, rumv: true };

        const dlCurrentEpisodeKey = () => {
            const seasonSelectEl = document.getElementById('seasonSelect');
            const season = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || 1;
            const episode = document.getElementById('episodeSelect')?.value
                || document.getElementById('episodeNum')?.textContent || 1;
            return { season, episode, key: `${malId || ''}:${season}:${episode}` };
        };

        const dlApplyAvailability = () => {
            const hsubOpt = document.getElementById('dlHsubOption');
            if (hsubOpt) hsubOpt.style.display = dlAvailability.hsub ? 'inline-block' : 'none';
            if (!dlAvailability.hsub && dlLang === 'hsub') {
                dlLang = 'sub';
                document.querySelectorAll('#dlLanguageRow [data-dl-lang]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlLang === 'sub'));
            }

            const rumvBtn = document.querySelector('#dlSourceRow [data-dl-source="rumv"]');
            if (rumvBtn) rumvBtn.disabled = !dlAvailability.rumv;
            if (!dlAvailability.rumv && dlSource === 'rumv') {
                dlSource = 'kaa';
                document.querySelectorAll('#dlSourceRow [data-dl-source]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlSource === 'kaa'));
            }

            // KAA has neither - disable the server entirely (same treatment as RU-MV above)
            // rather than leaving SUB "chosen" on a source that can't serve either language.
            const kaaBtn = document.querySelector('#dlSourceRow [data-dl-source="kaa"]');
            const kaaHasNothing = !dlAvailability.kaaSub && !dlAvailability.kaaDub;
            if (kaaBtn) kaaBtn.disabled = kaaHasNothing;
            if (kaaHasNothing && dlSource === 'kaa') {
                dlSource = 'megaplay';
                document.querySelectorAll('#dlSourceRow [data-dl-source]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlSource === 'megaplay'));
            }

            // SUB/DUB availability is only meaningful for whichever source is actually
            // selected - MegaPlay/NekoStream aren't checked (KAA's the flaky one), so their
            // buttons just stay enabled regardless of dlAvailability.kaaSub/kaaDub.
            const kaaSelected = dlSource === 'kaa';
            const subBtn = document.querySelector('#dlLanguageRow [data-dl-lang="sub"]');
            const dubBtn = document.querySelector('#dlLanguageRow [data-dl-lang="dub"]');
            if (subBtn) subBtn.disabled = kaaSelected && !dlAvailability.kaaSub;
            if (dubBtn) dubBtn.disabled = kaaSelected && !dlAvailability.kaaDub;
            if (kaaSelected && dlLang === 'sub' && !dlAvailability.kaaSub && dlAvailability.kaaDub) {
                dlLang = 'dub';
                document.querySelectorAll('#dlLanguageRow [data-dl-lang]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlLang === 'dub'));
            } else if (kaaSelected && dlLang === 'dub' && !dlAvailability.kaaDub && dlAvailability.kaaSub) {
                dlLang = 'sub';
                document.querySelectorAll('#dlLanguageRow [data-dl-lang]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlLang === 'sub'));
            }
        };

        // Same availability data, applied to the LIVE server/SUB/DUB buttons (not the download
        // panel) - passive only (disables what won't work, never auto-switches what's already
        // playing), since loadKickAssAnimeVideo already has its own synchronous KAA-empty
        // fallback to Neko/MegaPlay and this check resolves well after that's already decided.
        const dlApplyLiveAvailability = () => {
            const liveRuMv = document.getElementById('srvNew1');
            if (liveRuMv) liveRuMv.disabled = !dlAvailability.rumv;
            const kaaActive = window.currentServer === 'srvPahe1';
            const liveSub = document.getElementById('btnSub');
            const liveDub = document.getElementById('btnDub');
            if (liveSub) liveSub.disabled = kaaActive && !dlAvailability.kaaSub;
            if (liveDub) liveDub.disabled = kaaActive && !dlAvailability.kaaDub;
        };

        const dlCheckAvailability = async () => {
            const { season, episode, key } = dlCurrentEpisodeKey();
            if (dlAvailabilityCache.has(key)) {
                dlAvailability = dlAvailabilityCache.get(key);
                dlApplyAvailability();
                dlApplyLiveAvailability();
                return;
            }
            const title = animeTitle || document.getElementById('title')?.textContent.trim() || '';
            if (!title) return;
            const tmdbParam = tmdbId ? `&tmdbId=${encodeURIComponent(tmdbId)}` : '';
            const malParam = malId ? `&malId=${encodeURIComponent(malId)}` : '';
            const [hsubRes, kaaRes, rumvRes] = await Promise.allSettled([
                fetch(`/api/anime-neko-hsub-check?title=${encodeURIComponent(title)}&season=${encodeURIComponent(season)}&ep=${encodeURIComponent(episode)}`).then(r => r.json()),
                fetch(`/api/anime-kaa-availability?season=${encodeURIComponent(season)}&ep=${encodeURIComponent(episode)}&title=${encodeURIComponent(title)}${tmdbParam}${malParam}`).then(r => r.json()),
                fetch(`/api/anime-rumv-availability?title=${encodeURIComponent(title)}&season=${encodeURIComponent(season)}${tmdbParam}${malParam}`).then(r => r.json())
            ]);
            // Any single check failing (network hiccup, etc.) fails OPEN for kaaSub/kaaDub/rumv
            // so a probe error never blocks a source that might genuinely work - only hsub
            // fails closed, matching its pre-existing default-hidden behavior.
            dlAvailability = {
                hsub: hsubRes.status === 'fulfilled' ? Boolean(hsubRes.value?.available) : false,
                kaaSub: kaaRes.status === 'fulfilled' && kaaRes.value?.ok ? Boolean(kaaRes.value.sub) : true,
                kaaDub: kaaRes.status === 'fulfilled' && kaaRes.value?.ok ? Boolean(kaaRes.value.dub) : true,
                rumv: rumvRes.status === 'fulfilled' ? Boolean(rumvRes.value?.available) : true
            };
            dlAvailabilityCache.set(key, dlAvailability);
            dlApplyAvailability();
            dlApplyLiveAvailability();
        };

        const dlSyncRowsForSource = () => {
            const qualityWrap = document.getElementById('dlQualityWrap');
            const langWrap = document.getElementById('dlLanguageWrap');
            const burnWrap = document.getElementById('dlBurnWrap');
            // Kiwi links are picked by quality directly (no burn step, no per-server switch),
            // so quality still applies to it - it's everything else in this row that doesn't.
            if (qualityWrap) qualityWrap.style.display = 'block';
            if (burnWrap) burnWrap.style.display = (dlSource === 'external') ? 'none' : 'block';
            // RU-MV is a single Russian audio track - the whole app already hides the SUB/DUB
            // row for it (subDubToggleRow in updateSource) for the same reason.
            if (langWrap) langWrap.style.display = (dlSource === 'rumv') ? 'none' : 'block';
            if (dlLang === 'hsub' && dlSource !== 'neko') {
                dlLang = 'sub';
                document.querySelectorAll('#dlLanguageRow [data-dl-lang]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlLang === 'sub'));
            }
            dlApplyAvailability();
            dlPopulateSubsPicker();
        };

        document.getElementById('btnDownloadAnime')?.addEventListener('click', () => {
            if (!dlPanel) return;
            const opening = dlPanel.style.display === 'none';
            dlPanel.style.display = opening ? 'block' : 'none';
            if (opening) { dlSyncRowsForSource(); dlCheckAvailability(); startEpisodePanelHeightSyncBurst(); }
        });
        document.getElementById('btnCloseDownloadPanel')?.addEventListener('click', () => {
            if (dlPanel) dlPanel.style.display = 'none';
        });

        document.getElementById('dlSourceRow')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-dl-source]');
            if (!btn) return;
            dlSource = btn.dataset.dlSource;
            document.querySelectorAll('#dlSourceRow [data-dl-source]').forEach(b => b.classList.toggle('active', b === btn));
            dlSyncRowsForSource();
        });
        document.getElementById('dlLanguageRow')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-dl-lang]');
            if (!btn) return;
            dlLang = btn.dataset.dlLang;
            document.querySelectorAll('#dlLanguageRow [data-dl-lang]').forEach(b => b.classList.toggle('active', b === btn));
            // HSUB only ever comes from NekoStream - picking it here should mean "download the
            // hardsub from Neko," whatever server happened to be highlighted before this click.
            if (dlLang === 'hsub' && dlSource !== 'neko') {
                dlSource = 'neko';
                document.querySelectorAll('#dlSourceRow [data-dl-source]').forEach(b =>
                    b.classList.toggle('active', b.dataset.dlSource === 'neko'));
                dlSyncRowsForSource();
            }
        });
        document.getElementById('dlQualityRow')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-dl-quality]');
            if (!btn) return;
            dlQuality = btn.dataset.dlQuality;
            document.querySelectorAll('#dlQualityRow [data-dl-quality]').forEach(b => b.classList.toggle('active', b === btn));
        });

        // Waits for updateSource()'s async load to actually finish (window.currentVideo.provider
        // flips to match) rather than firing the downloader against whatever was there before -
        // updateSource() itself returns immediately, the real work happens in its async load*()
        // call, and playbackRequestGen (see above) already guards against a stale one winning.
        function waitForProvider(expectedProvider, timeoutMs = 20000) {
            return new Promise((resolve) => {
                const startedAt = Date.now();
                const check = () => {
                    if (window.currentVideo?.provider === expectedProvider) return resolve(true);
                    if (Date.now() - startedAt > timeoutMs) return resolve(false);
                    setTimeout(check, 300);
                };
                check();
            });
        }

        document.getElementById('btnDownloadGo')?.addEventListener('click', async () => {
            const statusEl = document.getElementById('dlStatusText');
            const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
            const seasonSelectEl = document.getElementById('seasonSelect');
            const dlSeason = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || 1;
            const dlEpisode = document.getElementById('episodeSelect')?.value
                || document.getElementById('episodeNum')?.textContent || 1;

            if (dlSource === 'external') {
                if (!malId) { setStatus('MAL ID unavailable for this title.'); return; }
                setStatus('Looking up link...');
                try {
                    const r = await fetch(`/api/anime-download-links?malId=${encodeURIComponent(malId)}&episode=${encodeURIComponent(dlEpisode)}`);
                    const j = await r.json();
                    const bucket = (dlLang === 'dub' ? j?.dub : j?.sub) || {};
                    const url = bucket[dlQuality] || (dlLang === 'dub' ? j?.bestDub : j?.bestSub);
                    if (!j?.ok || !url) {
                        setStatus(`No ${dlLang.toUpperCase()} link available for this episode.`);
                        return;
                    }
                    window.open(url, '_blank', 'noopener,noreferrer');
                    setStatus('Opened - the download page runs in the new tab.');
                } catch (err) {
                    setStatus('Could not fetch the download link.');
                }
                return;
            }

            const info = DL_SOURCE_INFO[dlSource];
            if (!info) return;

            const alreadyActive = window.currentServer === info.server && window.currentVideo?.provider === info.provider;
            if (!alreadyActive) {
                setStatus(`Switching to ${dlSource === 'rumv' ? 'RU-MV' : dlSource.toUpperCase()}...`);
                if (dlSource !== 'rumv') {
                    currentAudioMode = dlLang;
                    window.currentAudioType = dlLang;
                    applyAudioButtonState(dlLang);
                }
                updateSource(info.server);
                const ready = await waitForProvider(info.provider);
                if (!ready) {
                    setStatus(`${dlSource.toUpperCase()} didn't load in time - try again or pick another source.`);
                    return;
                }
                dlPopulateSubsPicker();
            }

            const fn = window[info.fn];
            if (typeof fn !== 'function') { setStatus('Download function unavailable.'); return; }

            // downloadKAAEpisode/downloadKinoEpisode read the picker inside their OWN progress
            // modal (#downloadIncludeSubs/#downloadSubsPicker), not this panel's copies - the
            // panel's picker is what the user actually set, so hand it off. window.currentSubtitleTrackIndex
            // is read as the fallback default the very first time the progress modal is built
            // for this page load, which is also what the modal's own populateSubtitlePicker()
            // uses to pick an initial selection - setting it before fn() means that initial
            // selection already matches what was chosen here.
            const dlBurnCheckbox = document.getElementById('dlBurnCheckbox');
            const dlSubsPicker = document.getElementById('dlSubsPicker');
            const burnEnabled = dlBurnCheckbox?.checked === true && dlSubsPicker?.value !== '';
            if (burnEnabled) window.currentSubtitleTrackIndex = Number(dlSubsPicker.value || 0);
            fn(parseInt(dlQuality, 10) || undefined);
            const modalCheckbox = document.getElementById('downloadIncludeSubs');
            const modalPicker = document.getElementById('downloadSubsPicker');
            if (modalCheckbox) {
                modalCheckbox.checked = burnEnabled;
                modalCheckbox.dispatchEvent(new Event('change'));
            }
            if (modalPicker && burnEnabled) modalPicker.value = String(window.currentSubtitleTrackIndex || 0);
            // downloadKAAEpisode and downloadKinoEpisode both read the same
            // #downloadIncludeSubs/#downloadSubsPicker now, so this applies to either path.
            const subsChoiceEl = document.getElementById('downloadSubsChoice');
            const burnSectionEl = document.getElementById('downloadSubtitleBurnSection');
            if (subsChoiceEl) subsChoiceEl.style.display = burnEnabled ? '' : 'none';
            if (burnSectionEl) burnSectionEl.style.display = burnEnabled ? '' : 'none';
            setStatus(burnEnabled ? 'Started - burning subtitles in, see the download dock.' : 'Started - see the download dock.');
        });

        const back10 = document.getElementById('btnBack10');
        const forward10 = document.getElementById('btnForward10');
        const pipButton = document.getElementById('btnPiP');

        back10?.addEventListener('click', () => {
            const video = document.getElementById('moviePlayerVideo');
            if (!video) return;
            video.currentTime = Math.max(0, video.currentTime - 10);
        });

        forward10?.addEventListener('click', () => {
            const video = document.getElementById('moviePlayerVideo');
            if (!video) return;
            video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
        });

        pipButton?.addEventListener('click', async () => {
            const video = document.getElementById('moviePlayerVideo');
            if (!video) return;
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    await video.requestPictureInPicture();
                }
            } catch (err) {
                console.error(err);
            }
        });

        document.addEventListener('keydown', e => {
            const active = document.activeElement;
            if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
            const video = document.getElementById('moviePlayerVideo');
            if (!video) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - 10);
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
            }
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                video.paused ? video.play() : video.pause();
            }
        });

// --- CLIENT-SIDE FFmpeg DOWNLOAD LOGIC ---
// --- CLIENT-SIDE FFmpeg DOWNLOAD LOGIC ---
        // const openAnimeDownload = async (type) => {
        //     const epText = document.getElementById('episodeNum')?.textContent || '1';
        //     const epNum = parseInt(epText, 10) || 1;
        //     if (!malId) {
        //         alert('MAL ID unavailable. MegaPlay downloads require a mapped anime title.');
        //         return;
        //     }

        //     const modal = document.getElementById('downloadModal');
        //     const statusText = document.getElementById('downloadStatusText');
        //     const progressBar = document.getElementById('downloadProgressBar');
            
        //     try {
        //         modal.style.display = 'flex';
        //         statusText.textContent = `Fetching ${type.toUpperCase()} stream link...`;
        //         progressBar.style.width = '5%';

        //         const res = await fetch(`/api/megaplay/extract/${malId}/${epNum}/${type}`);
        //         const data = await res.json();

        //         if (!data.sourceUrl) throw new Error('Failed to extract raw video stream.');

        //         statusText.textContent = 'Loading video processor...';
        //         progressBar.style.width = '15%';

        //         const { FFmpeg } = window.FFmpeg || await import('@ffmpeg.wasm/main'); 
        //         const ffmpeg = new FFmpeg();
                
        //         ffmpeg.on('progress', ({ progress }) => {
        //             const percent = Math.min(Math.round(progress * 100), 100);
        //             const uiPercent = 15 + (percent * 0.85); 
        //             progressBar.style.width = `${uiPercent}%`;
        //             statusText.textContent = `Processing Video: ${percent}%`;
        //         });

        //         await ffmpeg.load();

        //         statusText.textContent = 'Stitching stream segments...';
        //         await ffmpeg.exec(['-i', data.sourceUrl, '-c', 'copy', 'output.mp4']);

        //         statusText.textContent = 'Finalizing file...';
        //         const fileData = await ffmpeg.readFile('output.mp4');
        //         const blob = new Blob([fileData.buffer], { type: 'video/mp4' });
                
        //         const downloadLink = document.createElement('a');
        //         downloadLink.href = URL.createObjectURL(blob);
        //         downloadLink.download = `${animeTitle.replace(/[^a-zA-Z0-9]/g, '_')}_EP${epNum}_${type.toUpperCase()}.mp4`;
        //         downloadLink.click();

        //         URL.revokeObjectURL(downloadLink.href);
        //         setTimeout(() => { modal.style.display = 'none'; }, 1500);

        //     } catch (err) {
        //         console.error("Download Error:", err);
        //         statusText.textContent = 'Download failed.';
        //         statusText.style.color = '#ff4444';
        //         progressBar.style.backgroundColor = '#ff4444';
                
        //         setTimeout(() => {
        //             modal.style.display = 'none';
        //             statusText.style.color = '#ccc'; 
        //             progressBar.style.backgroundColor = '#ff8000'; 
        //         }, 3000);
        //     }
        // };

        // Bindings
        const btnDownloadSub = document.getElementById('btnDownloadSub');
        const btnDownloadDub = document.getElementById('btnDownloadDub');

        const moviesBtns = new Set(['server2embed', 'srvMega', 'srvUp', 'srvT', 'serverSuperembed', 'srvMoviesApiM', 'srv111MoviesM', 'srvNontonGoM', 'srvRuMovie', 'srvKino', 'srvT1mM']);
        const animeTVBtns = new Set(['srvKinoTv', 'srvMegaTV', 'srvRuTv', 'srvUpTV', 'srvTTV', 'srvMoviesApi', 'srv111Movies', 'srvNontonGo', 'srvT1mTV']);
        const animeDubBtns = new Set(['srvMega1', 'srvPahe1', 'srvNeko1', 'srvNew1']);
        const sectionToasts = {
            movies: 'ⓘ Currently supports movies and a few series',
            animeTV: 'ⓘ Currently supports nearly all series and animes. Sub/dub switching may be unstable for most anime titles.',
            animeDub: 'ⓘ Currently supports anime streaming via MegaPlay, KickAssAnime and NekoStream. (KickAssAnime is primarily for Sub/Jap)'
        };

        [...moviesBtns, ...animeTVBtns, ...animeDubBtns].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.onclick = () => {
                updateSource(id);
                startEpisodePanelHeightSyncBurst();
                const msg = moviesBtns.has(id) ? sectionToasts.movies
                          : animeTVBtns.has(id) ? sectionToasts.animeTV
                          : sectionToasts.animeDub;
                showSectionToast(msg);
            };
        });

        // srvAniTaku is wired via the forEach above

        // Section info toasts (used by both labels and server buttons)
        function showSectionToast(msg) {
            if (typeof showLimitToast === 'function') showLimitToast(msg);
        }

        // Section label clicks (same messages as buttons)
        document.getElementById('labelMovies').onclick = () => showSectionToast(sectionToasts.movies);
        document.getElementById('labelAnimeTV').onclick = () => showSectionToast(sectionToasts.animeTV);
        document.getElementById('labelAnimeDub').onclick = () => showSectionToast(sectionToasts.animeDub);

        document.getElementById('closeMoviePlayer').onclick = function() {
            playerSection.style.display = 'none';
            destroyCurrentHls();
            document.getElementById('moviePlayerFrame').src = ''; 
            playerSection.innerHTML = ''; 
        };

        document.getElementById('btnFullscreen').onclick = function() {
            const frame = document.getElementById('moviePlayerFrame');
            const video = document.getElementById('moviePlayerVideo');
            const wrap = document.getElementById('moviePlayerFrameWrap');
            const activeVideo = video && video.style.display !== 'none';
            const target = activeVideo ? video : frame;
            const el = target?.requestFullscreen ? target : wrap;
            if (el.requestFullscreen) el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
        };

        const syncEpisodePanelHeight = () => {
            const wrap = document.getElementById('moviePlayerFrameWrap');
            const panel = document.getElementById('dynamicEpisodeSection');
            if (!wrap || !panel || panel.style.display === 'none') return;
            const h = Math.round(wrap.getBoundingClientRect().height || 0);
            if (h > 0) panel.style.height = `${h}px`;
        };

        const startEpisodePanelHeightSyncBurst = () => {
            const intervalId = setInterval(() => {
                syncEpisodePanelHeight();
            }, 1000);

            setTimeout(() => {
                clearInterval(intervalId);
            }, 10000);
        };

        // 6. TMDB Fetcher & Dropdown Builder
        try {
            // type=anime is TV-shaped (seasons/episodes) the same as type=tv - anime just
            // never had this whole block's worth of logic (episode list, season picker,
            // genre-based server selection) built out under its own name. Without this, an
            // anime opened as type=anime fell straight into the type=movie `else` branch below
            // - no episode list, no season picker, and a hardcoded Kino server instead of the
            // KAA server real anime should get, confirmed live on "Kakushite! Makina-san!!".
            if (requestedType === 'tv' || requestedType === 'anime') {
                const tvRes = await fetch(`/api/tmdb-proxy/tv/${tmdbId}`);
                if (!tvRes.ok) {
                    throw new Error(`TV metadata fetch failed: ${tvRes.status}`);
                }
                const data = await tvRes.json();
                animeTitle = data.name || data.original_name || '';
                isAnime = !!(data && (Array.isArray(data.genres) && data.genres.some(g => (g.name || '').toLowerCase() === 'animation')) && ((data.original_language || '').toLowerCase() === 'ja' || (Array.isArray(data.origin_country) && data.origin_country.includes('JP'))));
                useAnimeSeasonUX = isAnime && animeLeverActive;
                // Kino has no Russian-language content at all, so defaulting a Russian series to
                // it just gets the user a dead/wrong-language stream every time - RU - MV is the
                // only server that actually has this. TMDB's own origin_country is the signal,
                // straight off the same /tv/{id} response already fetched above - no extra
                // request, no caching needed (this only ever runs once per page load).
                const isRussianSeries = !isAnime && Array.isArray(data.origin_country) && data.origin_country.includes('RU');
                if (isRussianSeries) {
                    currentServer = 'srvRuTv';
                }
                const animePosterThumb = data.poster_path ? `https://image.tmdb.org/t/p/w342${data.poster_path}` : '/img/LOGO_Short.png';
                window.currentAnimePosterThumb = animePosterThumb;
                const animeNotReleasedYet = !!(data.first_air_date && new Date(data.first_air_date) > new Date());
                const setReleaseStatusLine = (showData) => {
                    const episodeStatusLine = document.getElementById('episodeStatusLine');
                    if (!episodeStatusLine) return;
                    const statusRaw = String(showData?.status || '').toLowerCase();
                    const isCompleted = statusRaw.includes('ended') || statusRaw.includes('cancelled') || statusRaw.includes('canceled');

                    if (isCompleted) {
                        episodeStatusLine.textContent = 'Anime complete';
                        episodeStatusLine.style.color = '#7fd48a';
                        return;
                    }

                    const nextEp = showData?.next_episode_to_air;
                    if (nextEp?.episode_number && nextEp?.air_date) {
                        const d = new Date(nextEp.air_date);
                        const pretty = Number.isNaN(d.getTime())
                            ? nextEp.air_date
                            : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                        episodeStatusLine.textContent = `EP ${nextEp.episode_number} releases on ${pretty}`;
                        episodeStatusLine.style.color = '#ffb15a';
                        return;
                    }

                    episodeStatusLine.textContent = 'Next episode release date not announced yet';
                    episodeStatusLine.style.color = '#9d9d9d';
                };

                const fetchJsonSafe = async (url) => {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
                    return res.json();
                };

                const buildTmdbRelatedSeasonGroups = async (baseTitle) => {
                    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                    const baseNorm = norm(baseTitle);
                    const baseTokens = baseNorm.split(' ').filter(t => t.length >= 3);
                    const query = encodeURIComponent(baseTitle || animeTitle || '');
                    const search = await fetchJsonSafe(`/api/tmdb-proxy/search/tv?query=${query}&language=en-US&page=1`);
                    const raw = Array.isArray(search?.results) ? search.results : [];

                    // A sequel season is always the same Japanese production, so gate on that first.
                    // Without it, English shows with similar-looking titles get pulled in as "Season 1"
                    // (e.g. "Eighty-Sixed" tmdb:78803 hijacking "86 EIGHTY-SIX" tmdb:100565).
                    const isJapanese = (r) => (r?.original_language || '').toLowerCase() === 'ja' ||
                        (Array.isArray(r?.origin_country) && r.origin_country.includes('JP'));

                    const similar = raw.filter(r => {
                        if (!isJapanese(r)) return false;
                        const n = norm(r?.name || r?.original_name || '');
                        if (!n) return false;
                        // Dropped the baseNorm.startsWith(n) direction - confirmed live it was
                        // exactly the "spinoff swallowed into the parent's sequel chain" bug
                        // (tmdb 70590, Sword Oratoria, a DanMachi spin-off): the base show's own
                        // TMDB title, "Is It Wrong to Try to Pick Up Girls in a Dungeon?", is a
                        // literal PREFIX of the spinoff's full title "...On the Side: Sword
                        // Oratoria", so every one of the base show's own real sequels (II/III/IV/
                        // etc, each a separate TMDB entry) matched here too, turning a genuine
                        // single-season spin-off into a fake 6+ season dropdown. n.startsWith(
                        // baseNorm) is still safe to keep (candidate is a superset of the query,
                        // e.g. a real "...Final Season" sequel) - only the reverse direction,
                        // where the CANDIDATE is missing words the query has, was ever wrong.
                        if (n === baseNorm || n.startsWith(baseNorm)) return true;
                        // Whole-token match only. Substring matching lets "six" hit "sixed".
                        const nTokens = new Set(n.split(' '));
                        return baseTokens.length > 0 && baseTokens.every(t => nTokens.has(t));
                    });

                    const ids = [Number(tmdbId), ...similar.map(r => Number(r.id))]
                        .filter(id => Number.isFinite(id) && id > 0)
                        .filter((id, idx, arr) => arr.indexOf(id) === idx)
                        .slice(0, 6);

                    const rows = [];
                    for (const id of ids) {
                        let details;
                        try {
                            details = await fetchJsonSafe(`/api/tmdb-proxy/tv/${id}?language=en-US`);
                        } catch {
                            continue;
                        }
                        const seasons = Array.isArray(details?.seasons) ? details.seasons.filter(s => Number(s?.season_number) > 0) : [];
                        for (const s of seasons) {
                            const seasonNum = Number(s.season_number);
                            try {
                                const sd = await fetchJsonSafe(`/api/tmdb-proxy/tv/${id}/season/${seasonNum}?language=en-US`);
                                const eps = Array.isArray(sd?.episodes) ? sd.episodes : [];
                                if (!eps.length) continue;
                                rows.push({
                                    sortDate: Date.parse(sd?.air_date || details?.first_air_date || '') || 0,
                                    title: details?.name || details?.original_name || `TV ${id}`,
                                    seasonNum,
                                    episodes: eps
                                });
                            } catch {
                                continue;
                            }
                        }
                    }

                    rows.sort((a, b) => a.sortDate - b.sortDate || a.seasonNum - b.seasonNum);
                    return rows.map((r, idx) => ({
                        seasonNumber: idx + 1,
                        label: `${r.title} · S${r.seasonNum}`,
                        episodes: r.episodes
                    }));
                };

                setReleaseStatusLine(data);
                // Update server: anime (TV or movie) defaults to Neko, falling back through
                // MegaPlay then KAA on failure (see loadNekoStreamVideo/loadMegaPlayFrame/
                // loadKickAssAnimeVideo's own fallback wiring for the actual chain).
                if (isAnime) {
                    currentServer = 'srvNeko1';
                } else if (isRussianSeries) {
                    currentServer = 'srvRuTv'; // Kino has no Russian content - keep the earlier default
                } else if (data.seasons && data.seasons.length > 0) {
                    currentServer = 'srvKinoTv'; // TV shows use Kino
                }
                // else: keep default (srvKino for movies)

                // Move the highlight now. updateSource() only runs after season resolution,
                // which can take seconds, and until then the markup still shows srvKino active.
                document.querySelectorAll('.server-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === currentServer);
                });

                if (data.seasons && data.seasons.length > 0) {
                    isSeries = true;
                    syncDownloadVisibility();

                    const dynamicEpisodeSection = document.getElementById('dynamicEpisodeSection');
                    dynamicEpisodeSection.style.display = 'flex'; // Show the list UI
                    requestAnimationFrame(syncEpisodePanelHeight);
                    setTimeout(syncEpisodePanelHeight, 120);
                    if (!window.__episodePanelResizeBound) {
                        window.__episodePanelResizeBound = true;
                        window.addEventListener('resize', syncEpisodePanelHeight);
                    }
                    
                    const seasonSelect = document.getElementById('seasonSelect');
                    const episodeSelect = document.getElementById('episodeSelect');
                    const episodeListContainer = document.getElementById('episodeListContainer');
                    const episodeSearchInput = document.getElementById('episodeSearchInput');
                    const seasonPickerWrap = document.getElementById('seasonPickerWrap');

                    const wireEpisodeSearch = () => {
                        if (!episodeSearchInput || episodeSearchInput.dataset.wired === '1') return;
                        episodeSearchInput.dataset.wired = '1';
                        episodeSearchInput.addEventListener('input', () => {
                            const q = (episodeSearchInput.value || '').toLowerCase().trim();
                            document.querySelectorAll('.episode-list-item').forEach(item => {
                                const txt = (item.textContent || '').toLowerCase();
                                item.classList.toggle('hidden-by-search', !!q && !txt.includes(q));
                            });
                        });
                    };

                    let seasonEntries = data.seasons.filter(s => s.season_number > 0).sort((a, b) => a.season_number - b.season_number);
                    let resolvedSeasonGroups = null;

                    // Primary fallback for anime lever mode: backend MAL/Jikan (+ last-resort MAL-
                    // search) cached season groups. Always attempted for anime and trusted whenever
                    // it resolves (a 404/error throws below and is caught, leaving TMDB's own list
                    // untouched) - NOT gated on being more granular than TMDB, since TMDB can go
                    // wrong in both directions: it can bundle a split-cour season into ONE combined
                    // "Season N" while providers key episodes to separate MAL ids per cour (Tower of
                    // God's Season 2 case - MegaPlay 404s on "Season 2 episode 14" because the second
                    // cour's MAL id was never resolved), OR it can OVER-split into extra "seasons" for
                    // specials/cour artifacts that MAL/AniList correctly collapse (Jobless
                    // Reincarnation: TMDB reports 5 seasons, MAL/AniList correctly resolve ~4). Only
                    // the first case had fewer TMDB entries than MAL/AniList groups, so gating on
                    // `groups.length > seasonEntries.length` silently discarded the correct answer
                    // for the second case instead of just being redundant.
                    if (useAnimeSeasonUX) {
                        try {
                            const malGroups = await fetchJsonSafe(`/api/anime-season-groups?tmdbId=${tmdbId}`);
                            const groups = Array.isArray(malGroups?.groups) ? malGroups.groups : [];
                            if (groups.length > 0) {
                                resolvedSeasonGroups = groups;
                                // Split-cour seasons are separate MAL entries (e.g. "86" vs "86
                                // Part 2") with their own local episode numbering. Providers keyed
                                // by MAL id need this season's id, not the base show's.
                                window.__resolvedSeasonGroups = groups;
                                seasonEntries = groups.map(g => ({ season_number: g.seasonNumber }));
                            }
                        } catch (e) {
                            console.warn('MAL/Jikan season fallback unavailable:', e);
                        }
                    }

                    // Secondary fallback: TMDB sometimes exposes sequel seasons as separate TV entries.
                    // If MAL/Jikan grouping did not resolve multiple seasons, stitch related TMDB entries.
                    if (useAnimeSeasonUX && seasonEntries.length <= 1) {
                        try {
                            const groups = await buildTmdbRelatedSeasonGroups(animeTitle || data?.name || data?.original_name || '');
                            if (groups.length > 1) {
                                resolvedSeasonGroups = groups;
                                seasonEntries = groups.map(g => ({ season_number: g.seasonNumber }));
                            }
                        } catch (e) {
                            console.warn('TMDB related-season fallback unavailable:', e);
                        }
                    }

                    // TODO: Specials (Season 0) not available on NekoStream yet - comment out until available
                    // const hasSpecials = data.seasons && data.seasons.some(s => s.season_number === 0);
                    // let specialsOption = '';
                    // if (hasSpecials && useAnimeSeasonUX) {
                    //     specialsOption = '<option value="specials">Specials</option>';
                    // }

                    // Anime keeps its existing lever-gated "All eps" behavior untouched.
                    // Non-anime shows get the same "All eps" option whenever there's actually
                    // more than one season to pick from.
                    const showAllEpsOption = useAnimeSeasonUX || (!isAnime && seasonEntries.length > 1);
                    seasonSelect.innerHTML = showAllEpsOption
                        ? `<option value="all">All eps</option>${seasonEntries.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('')}`
                        : seasonEntries.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('');
                    if (seasonPickerWrap) {
                        seasonPickerWrap.style.display = showAllEpsOption ? 'flex' : 'none';
                    }

                    // NEW DYNAMIC POPULATOR
                    const populateEpisodes = async (sNumRaw) => {
                        const rawMode = sNumRaw || seasonSelect.value || (useAnimeSeasonUX ? 'all' : '1');
                        const mode = String(rawMode).trim().toLowerCase();
                        console.log(`[Episodes] Populating with mode: "${mode}" (raw: "${rawMode}")`);
                        // Display loading state in list
                        episodeListContainer.innerHTML = '<li style="padding: 20px; color:#fff; text-align:center;">Loading episodes...</li>';

                        try {
                            const bySeason = [];
                            // TODO: Specials handling disabled - not available on NekoStream
                            // if (mode === 'specials') {
                            //     console.log('[Episodes] Fetching Season 0 (Specials)...');
                            //     const seasonRes = await fetch(`/api/tmdb-proxy/tv/${tmdbId}/season/0`);
                            //     const seasonData = await seasonRes.json();
                            //     console.log(`[Episodes] Season 0 fetched: ${Array.isArray(seasonData?.episodes) ? seasonData.episodes.length : 0} episodes`);
                            //     bySeason.push({ seasonNumber: 0, episodes: Array.isArray(seasonData?.episodes) ? seasonData.episodes : [] });
                            // } else
                            if (mode === 'all' && showAllEpsOption) {
                                if (resolvedSeasonGroups && resolvedSeasonGroups.length > 0) {
                                    bySeason.push(...resolvedSeasonGroups.map(g => ({ seasonNumber: g.seasonNumber, episodes: g.episodes })));
                                } else {
                                    for (const sEntry of seasonEntries) {
                                        const sNum = Number(sEntry.season_number);
                                        const seasonRes = await fetch(`/api/tmdb-proxy/tv/${tmdbId}/season/${sNum}`);
                                        const seasonData = await seasonRes.json();
                                        bySeason.push({ seasonNumber: sNum, episodes: Array.isArray(seasonData?.episodes) ? seasonData.episodes : [] });
                                    }
                                }
                            } else {
                                const selectedSeasonNum = Number(mode) || 1;
                                if (resolvedSeasonGroups && resolvedSeasonGroups.length > 0) {
                                    const g = resolvedSeasonGroups.find(x => Number(x.seasonNumber) === selectedSeasonNum);
                                    bySeason.push({ seasonNumber: selectedSeasonNum, episodes: Array.isArray(g?.episodes) ? g.episodes : [] });
                                } else {
                                    const seasonRes = await fetch(`/api/tmdb-proxy/tv/${tmdbId}/season/${selectedSeasonNum}`);
                                    const seasonData = await seasonRes.json();
                                    bySeason.push({ seasonNumber: selectedSeasonNum, episodes: Array.isArray(seasonData?.episodes) ? seasonData.episodes : [] });
                                }
                            }

                            const flatEpisodes = [];
                            bySeason.forEach(group => {
                                (group.episodes || []).forEach(ep => flatEpisodes.push({ ...ep, _season_number: group.seasonNumber }));
                            });

                            if (flatEpisodes.length > 0) {
                                const first = flatEpisodes[0];
                                seasonSelect.dataset.playSeason = String(first._season_number || 1);
                                episodeSelect.innerHTML = flatEpisodes.map(ep => `<option value="${ep.episode_number}">Episode ${ep.episode_number}</option>`).join('');
                                // Skip episode 0 (specials/prelude) and use episode 1 as default
                                const defaultEp = flatEpisodes.find(ep => ep.episode_number === 1) || first;
                                episodeSelect.value = String(defaultEp.episode_number || 1);

                                // LOAD USER WATCH HISTORY FOR WATCHED STATES
                                window.__watchedStates = [];
                                try {
                                    if (typeof window.getActivityUID === 'function') {
                                        const activityUID = window.getActivityUID();
                                        const historyRow = await fetchWatchHistory(activityUID, tmdbId);
                                        console.log('[WatchHistory] Fetched:', historyRow);
                                        setWatchHistoryCache(historyRow);
                                        if (historyRow && historyRow.finished) {
                                            try {
                                                window.__watchedStates = JSON.parse(historyRow.finished);
                                                console.log('[WatchHistory] Parsed watched states:', window.__watchedStates);
                                            } catch (e) {
                                                console.error('[WatchHistory] Failed to parse finished:', e);
                                            }
                                        } else {
                                            console.log('[WatchHistory] No finished field');
                                        }
                                        if (historyRow && historyRow.continue_from) {
                                            console.log('[WatchHistory] continue_from:', historyRow.continue_from);
                                            const contMatch = String(historyRow.continue_from).match(/S(\d+)E(\d+)/);
                                            if (contMatch) {
                                                seasonSelect.dataset.playSeason = contMatch[1];
                                                episodeSelect.value = contMatch[2];
                                                window.__continueFromSeason = parseInt(contMatch[1]);
                                                window.__continueFromEpisode = parseInt(contMatch[2]);
                                                console.log('[WatchHistory] Set continue_from:', { season: contMatch[1], episode: contMatch[2] });
                                            }
                                        } else {
                                            console.log('[WatchHistory] No continue_from field');
                                        }
                                    }
                                } catch(e) { console.error('Failed restoring watched episodes:', e); }

                                // Filler/canon ribbon (anime only). animefillerlist.com numbers
                                // episodes GLOBALLY across the whole continuous run (e.g. Bleach
                                // 1-366), not per-season/per-cour like our own ep.episode_number
                                // (flatEpisodes keeps each season's LOCAL numbering even when
                                // "All eps" concatenates several seasons together) -- so every
                                // season needs its own cumulative offset (total episodes in every
                                // season before it) to translate local -> animefillerlist's global
                                // numbering, looked up per-episode below via ep._season_number.
                                let fillerTypeByGlobalEpisode = {};
                                let fillerSeasonOffsets = {};
                                const fillerLegendEl = document.getElementById('fillerLegend');
                                if (fillerLegendEl) fillerLegendEl.style.display = isAnime ? 'flex' : 'none';
                                if (isAnime) {
                                    let running = 0;
                                    if (resolvedSeasonGroups && resolvedSeasonGroups.length > 0) {
                                        for (const g of resolvedSeasonGroups) {
                                            fillerSeasonOffsets[g.seasonNumber] = running;
                                            running += (g.episodes || []).length;
                                        }
                                    } else {
                                        for (const sEntry of seasonEntries) {
                                            fillerSeasonOffsets[sEntry.season_number] = running;
                                            running += Number(sEntry.episode_count) || 0;
                                        }
                                    }
                                    try {
                                        const isOngoing = data?.status === 'Returning Series' || data?.status === 'In Production' || data?.status === 'Planned';
                                        const fillerTitle = animeTitle || document.getElementById('title')?.textContent.trim() || '';
                                        const fillerRes = await fetch(`/api/anime-filler-status?title=${encodeURIComponent(fillerTitle)}&ongoing=${isOngoing}`);
                                        const fillerData = await fillerRes.json().catch(() => ({}));
                                        if (fillerData?.status === 'ready') fillerTypeByGlobalEpisode = fillerData.episodes || {};
                                    } catch (e) {
                                        console.warn('[FillerStatus] fetch failed:', e.message);
                                    }
                                }

                                let firstThumb = null;
                                let listHTML = '';
                                console.log('[Episode List] Starting render with continue_from:', {
                                    season: window.__continueFromSeason,
                                    episode: window.__continueFromEpisode
                                });
                                flatEpisodes.forEach((ep, idx) => {
                                    const epName = ep.name || `Episode ${ep.episode_number}`;
                                    // A real thumbnail (TMDB still or a full external URL from AniList's
                                    // streamingEpisodes) wins regardless of air_date — synthetic seasons
                                    // never carry an air_date, so treating a missing one as "unreleased"
                                    // was masking real thumbnails behind the generic poster every time.
                                    const isFullUrl = /^https?:\/\//i.test(ep.still_path || '');
                                    let thumb;
                                    if (ep.still_path && isFullUrl) {
                                        thumb = ep.still_path;
                                    } else {
                                        const epIsUnreleased = !ep.air_date || new Date(ep.air_date) > new Date();
                                        thumb = (animeNotReleasedYet || epIsUnreleased)
                                            ? animePosterThumb
                                            : (ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : animePosterThumb);
                                    }

                                    // Capture first episode's thumb
                                    if (idx === 0) firstThumb = thumb;

                                    const airDate = ep.air_date
                                        ? new Date(ep.air_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                        : 'TBA';

                                    // Use nullish coalescing to preserve season 0 (specials)
                                    const seasonNum = ep._season_number !== undefined ? ep._season_number : 1;
                                    const epIdStr = `S${seasonNum}E${ep.episode_number}`;
                                    const isWatched = window.__watchedStates && window.__watchedStates.includes(epIdStr) ? ' watched' : '';

                                    // Check if this is the continue_from episode (safe number comparison)
                                    const isContinueFrom = (
                                        window.__continueFromSeason && window.__continueFromEpisode &&
                                        parseInt(window.__continueFromSeason) === parseInt(seasonNum) &&
                                        parseInt(window.__continueFromEpisode) === parseInt(ep.episode_number)
                                    ) ? ' active' : '';

                                    if (idx < 5 || isContinueFrom) {
                                        console.log(`[Episode List] EP${idx}: ${epIdStr} - isWatched="${isWatched}" isContinueFrom="${isContinueFrom}" (season: ${seasonNum} vs ${window.__continueFromSeason}, ep: ${ep.episode_number} vs ${window.__continueFromEpisode})`);
                                    }
                                    if (isContinueFrom) {
                                        console.log('[Episode List] ✓ Marked as active:', epIdStr);
                                    }

                                    // Non-anime gets no ribbon at all (empty data-filler-type).
                                    // Anime with no match for this exact episode (title not on
                                    // animefillerlist, or an ongoing show's newest episode not
                                    // indexed there yet) falls back to "Unknown" (purple) rather
                                    // than silently showing nothing.
                                    const globalEpNum = (fillerSeasonOffsets[seasonNum] || 0) + Number(ep.episode_number);
                                    const fillerType = isAnime ? (fillerTypeByGlobalEpisode[globalEpNum] || 'Unknown') : '';

                                    listHTML += `
                                        <li class="episode-list-item${isWatched}${isContinueFrom}" data-season="${seasonNum}" data-ep="${ep.episode_number}" data-filler-type="${fillerType}" onclick="window.__handleEpisodeItemClick && window.__handleEpisodeItemClick(this)">
                                            <span class="episode-num">${ep.episode_number}</span>
                                            <img class="episode-thumb" src="${thumb}" alt="Episode ${ep.episode_number}" loading="lazy" decoding="async" onerror="this.src='/img/LOGO_Short.png'">
                                            <div class="episode-text">
                                                <span class="episode-title">S${seasonNum} · ${epName}</span>
                                                <span class="episode-meta">${airDate}</span>
                                            </div>
                                            <span class="episode-play">▶</span>
                                        </li>
                                    `;
                                });
                                episodeListContainer.innerHTML = listHTML;
                                window.currentEpisodeThumb = firstThumb || animePosterThumb;
                                window.currentAnimePosterThumb = animePosterThumb;

                                // Apply .active class to continue_from episode AFTER DOM is rendered
                                requestAnimationFrame(() => {
                                    const continueS = window.__continueFromSeason;
                                    const continueE = window.__continueFromEpisode;
                                    if (continueS && continueE) {
                                        const activeItem = document.querySelector(`.episode-list-item[data-season="${continueS}"][data-ep="${continueE}"]`);
                                        if (activeItem) {
                                            document.querySelectorAll('.episode-list-item.active').forEach(el => el.classList.remove('active'));
                                            activeItem.classList.add('active');
                                            console.log(`[Episode List] ✓ Applied .active to S${continueS}E${continueE}`);
                                        } else {
                                            console.log(`[Episode List] Could not find S${continueS}E${continueE} in DOM`);
                                        }
                                    } else {
                                        console.log(`[Episode List] continue_from not set when applying .active`);
                                    }
                                });

                                wireEpisodeSearch();

                            }
                        } catch(e) {
                            console.error('Failed to load specific season episodes:', e);
                        }
                    };
                    
                    // Initial load
                    await populateEpisodes(seasonSelect.value || (useAnimeSeasonUX ? 'all' : 1));
                    
                    // Switching the Season dropdown should only filter the episode LIST -
                    // populateEpisodes resets episodeSelect to that season's first episode
                    // (or a saved continue_from) purely as internal bookkeeping for "which
                    // episode plays if you click Play without picking one," not as a signal the
                    // user wants playback to jump there. Calling updateSource here reloaded the
                    // player on every season switch even though the user hadn't clicked any
                    // episode - only an actual episode click (__handleEpisodeItemClick above)
                    // should ever trigger a reload.
                    seasonSelect.onchange = async () => {
                        await populateEpisodes(seasonSelect.value);
                        requestAnimationFrame(syncEpisodePanelHeight);
                    };
                    
                    // Keep fallback select change just in case
                    episodeSelect.onchange = () => {
                        updateSource(currentServer);
                    };
                } else {
                    // Requested TV item but no seasons found; fall back to movie-style embed format.
                    isSeries = false;
                    currentServer = 'srvKino';
                    syncDownloadVisibility();
                }
            } else {
                // For type=movie, never run TV season logic.
                isSeries = false;
                currentServer = 'srvKino';
                syncDownloadVisibility();
                const movieRes = await fetch(`/api/tmdb-proxy/movie/${tmdbId}/external_ids`);
                if (movieRes.ok) {
                    const movieData = await movieRes.json();
                    imdbId = movieData.imdb_id;
                }
            }

            malId = await lookupMalId();
        } catch (e) {
            console.error('Metadata Fetch Error:', e);
        }

        updateSource(currentServer);
    });
});
