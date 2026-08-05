
document.addEventListener('DOMContentLoaded', function() {
    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
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

    let watchHistoryCache = null;
    let watchHistoryMap = {};
    let kaaContinueState = null;
    let currentKaaSkipMarkers = [];
    let currentKaaSkipSegments = [];
    let currentNekoDownloads = { sub2: null, dub2: null };

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

    function buildKaaPlaybackSegments(markers, duration) {
        if (!Array.isArray(markers)) return [];
        const sorted = markers.slice().sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
        const maxDuration = Number(duration);
        return sorted
            .map((current, index) => {
                const next = sorted[index + 1];
                const start = Number(current.at || current.start || 0);
                let end = next ? Number(next.at || next.start || 0) : (Number.isFinite(maxDuration) ? maxDuration : Infinity);
                if (Number.isFinite(maxDuration) && end > maxDuration) {
                    end = maxDuration;
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

        if (introButton) {
            introButton.style.display = currentIntro ? '' : 'none';
            introButton.disabled = !currentIntro;
        }
        if (outroButton) {
            outroButton.style.display = currentOutro ? '' : 'none';
            outroButton.disabled = !currentOutro;
        }

        if (!currentIntro && !currentOutro) {
            overlay.style.display = 'none';
            return;
        }

        overlay.style.display = 'flex';
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

    function movePlyrTopControls() {
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
            document.body.appendChild(overlay);
            overlay.querySelector('#kaaResumeConfirmBtn').addEventListener('click', () => {
                overlay.style.display = 'none';
                onResume();
            });
            overlay.querySelector('#kaaResumeRestartBtn').addEventListener('click', () => {
                overlay.style.display = 'none';
                onRestart();
            });
        } else {
            const message = overlay.querySelector('#kaaResumeMessage');
            if (message) message.innerHTML = `Resume ${episodeKey} from <strong>${seconds}s</strong>?`;
        }
        overlay.style.display = 'flex';
    }

    async function saveKaaContinue({ episodeKey, seconds, userUID, movieId }) {
        if (!episodeKey || !Number.isFinite(seconds) || !userUID || !movieId) return null;
        const payload = {
            userUID,
            movie_id: String(movieId),
            item_type: 'tv',
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
                    movieId: kaaContinueState.movieId
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
                movieId: kaaContinueState.movieId
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
            const link = target.id === 'btnDownloadSub2'
                ? currentNekoDownloads.sub2
                : currentNekoDownloads.dub2;
            if (!link) {
                if (typeof window.showLimitToast === 'function') {
                    window.showLimitToast('This external download link is not available for the current episode.');
                }
                return;
            }
            window.open(link, '_blank', 'noopener,noreferrer');
        }
    });

    // Background preload function for anime episodes
    window.preloadEpisodeSources = async function() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const tmdbId = urlParams.get('id');
            const typeParam = (urlParams.get('type') || 'movie').toLowerCase();
            const isAnime = typeParam === 'anime' || typeParam === 'tv';

            if (!tmdbId || !isAnime) {
                console.log('[Preload] Skipping - not anime or no tmdbId');
                return;
            }

            let episode = 1;
            let season = 1;
            let audioType = 'sub';

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

            // Preload KAA sources
            const kaaUrl = `/api/anime-kaa-servers?malId=${encodeURIComponent(malId)}&tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&ep=${encodeURIComponent(episode)}&audio=${encodeURIComponent(audioType)}&itemType=tv&title=${encodeURIComponent(title)}`;
            console.log('[Preload] KAA fetch URL:', kaaUrl);
            fetch(kaaUrl).then(res => res.json()).then(data => {
                if (data?.sources?.length > 0) {
                    window.__preloadedKaaSources = data;
                    window.__preloadedKaaEpisode = { season, ep: episode };
                    console.log('[Preload] ✓ KAA sources cached for S' + season + 'E' + episode, { sourceCount: data.sources.length });
                } else {
                    console.log('[Preload] ✗ KAA returned no sources:', data);
                }
            }).catch(err => console.log('[Preload] ✗ KAA preload failed:', err));

            // Preload Neko sources
            const nekoQuery = new URLSearchParams({
                malId: malId || '',
                tmdbId: tmdbId || '',
                title,
                type: audioType,
                season: season || 1,
                ep: episode || 1
            });
            const nekoUrl = `/api/anime-neko-log?${nekoQuery.toString()}`;
            console.log('[Preload] Neko fetch URL:', nekoUrl);
            fetch(nekoUrl).then(res => res.json()).then(data => {
                if (data?.stream || data?.sources?.file) {
                    window.__preloadedNekoSources = data;
                    window.__preloadedNekoEpisode = { season, ep: episode };
                    console.log('[Preload] ✓ Neko sources cached for S' + season + 'E' + episode, { hasStream: !!data.stream });
                } else {
                    console.log('[Preload] ✗ Neko returned no stream:', data);
                }
            }).catch(err => console.log('[Preload] ✗ Neko preload failed:', err));

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

        // Default server: anime uses KAA, TV uses MegaTV, movies use Mega
        let currentServer = isAnime ? 'srvPahe1' : (requestedType === 'tv' ? 'srvMegaTV' : 'srvMega');

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
                .player-section { background:#080808; padding:16px 18px; border-radius:14px; box-shadow:0 2px 24px #000a; display:flex; flex-direction:column; align-items:center; width:95%; }
                .player-title { color:#ff8000; margin-bottom:12px; font-size:1.3rem; font-weight:900; letter-spacing:1px; }
                .player-label { color:#ff8000; font-size:1rem; margin-bottom:6px; font-weight:700; }
                .player-block {  border-radius:10px; padding:12px 16px; margin-bottom:10px; width:100%; display:flex; align-items:center; }
                .player-block-left { padding-right: 20px; width:20%; color:#fff; font-size:1rem; font-weight:600; text-align:left; height:100%; display:flex; flex-direction:column; justify-content:center; }
                .player-block-right { flex:1; display:flex; flex-direction:column; }
                .server-group { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:0; justify-content:flex-start; }
                .server-btn { background:#222; color:#fff; padding:6px 14px; border:none; border-radius:8px; cursor:pointer; font-size:0.95rem; font-weight:bold; margin:0 6px 6px 0; box-shadow:0 2px 8px #ff800033,0 1.5px 4px #0004; letter-spacing:0.5px; transition:background 0.2s,box-shadow 0.2s; }
                .server-btn.active { background:#ff8000; color:#fff; box-shadow:0 2px 12px #ff800055; }
                .player-section-divider { width:100%; height:2px; background:#ff8000; margin:12px 0 8px 0; border-radius:2px; opacity:0.7; }
                .player-episode { width:28%;  background:#ff8000; color:#fff; border-radius:8px; padding:8px 16px; font-size:1rem; font-weight:700; margin-right:16px; min-width: 120px;}
                .player-info { color:#fff; font-size:0.95rem; margin-bottom:6px; }
                .player-select { background:#222; color:#fff; padding:6px 12px; border-radius:8px; border:none; font-size:0.95rem; margin:0 0px; box-shadow:0 1px 6px #ff800033; }
                .audio-btn { background:#222; color:#fff; padding:6px 18px; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:0.95rem; margin:0 6px; transition:background 0.2s; box-shadow:0 2px 8px #ff800033; }
                .audio-btn.active { background:#ff8000; color:#fff; }
                .player-layout { width:100%; display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:14px; margin-top:10px; align-items:start; }
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
                /* Custom Scrollbar for Episode List */
                .episode-list::-webkit-scrollbar { width: 8px; }
                .episode-list::-webkit-scrollbar-track { background: #181818; }
                .episode-list::-webkit-scrollbar-thumb { background: #ff8000; border-radius: 4px; }
                @media (max-width: 1100px) {
                    .player-layout { grid-template-columns: 1fr; }
                }
            </style>
            <div class="player-section">
            
                <div class="player-block" style="margin-bottom:14px;">
                                        <div class="player-block-left">
                                            <div class="player-block-meta">
                                                <div class="player-episode"><p>Episode </p> <span id="episodeNum">1</span></div>
                                                <div class="player-info">If current server doesn't work<br>please try other servers beside. KickAssAnime is ours, most stable, yet slower to load initially, Neko is run through us, faster than KickAssAnime but may be unavailable later on</div>
                                            </div>
                                            <div class="player-block-downloads">
                                                <div id="animeDownloadWrap" style="display:none;margin-top:auto;padding-top:10px;">
                                                    <div class="downloadTextNextoBtn" style="font-size:0.85rem;color:#ffb366;margin-bottom:6px;">Anime Downloads</div>
                                                    <div class="downloadButtonMovieInfoParent" style="display:flex;gap:8px;flex-wrap:wrap;">
                                                        <button id="btnDownloadSub" class="audio-btn" style="margin:0;padding:6px 12px;">Download SUB (Internal KickAA)</button>
                                                        <button id="btnDownloadDub" class="audio-btn" style="margin:0;padding:6px 12px;">Download DUB (Internal KickAA)</button>
                                                        <button id="btnDownloadSub2" class="audio-btn" style="margin:0;padding:6px 12px;">Download SUB (External Neko)</button>
                                                        <button id="btnDownloadDub2" class="audio-btn" style="margin:0;padding:6px 12px;">Download DUB (External Neko)</button>
                                                    </div>
                                                </div>
                                                <div id="movieDownloadWrap" style="display:none;margin-top:auto;padding-top:10px;">
                                                    <div style="font-size:0.85rem;color:#ffb366;margin-bottom:6px;">Movie Download</div>
                                                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                                        <button id="btnDownloadMovie" class="audio-btn" style="margin:0;padding:6px 12px;">Download Movie</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                    <div class="player-block-right">
                        <div class="player-label" id="labelMovies" style="cursor:pointer;" title="Click for info">Movies: <span style="font-size:0.75rem;opacity:0.5;font-weight:400;">ⓘ</span></div>
                        <div class="server-group">
                            <button id="server2embed" class="server-btn">2Embed</button>
                            <button id="srvMega" class="server-btn active">MegaCloud (S1)</button>
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
                            <button id="srvMegaTV" class="server-btn">MegaCloud (S1)</button>
                            <button id="srvUpTV" class="server-btn">UpCloud (S2)</button>
                            <button id="srvTTV" class="server-btn">T-Cloud (S3)</button>
                            <button id="srvMoviesApi" class="server-btn">MoviesAPI</button>
                            <button id="srv111Movies" class="server-btn">111Movies</button>
                            <button id="srvNontonGo" class="server-btn">NontonGo</button>
                        </div>
                        <div class="player-section-divider"></div>
                        <div class="player-label" id="labelAnimeDub" style="cursor:pointer;" title="Click for info">Anime Sub/Dub: <span style="font-size:0.75rem;opacity:0.5;font-weight:400;">ⓘ</span></div>
                        <div class="server-group">
                            <button id="srvMega1" class="server-btn">MegaVid</button>
                            <button id="srvPahe1" class="server-btn">
                                KickAssAnime
                            </button>
                            <button id="srvNeko1" class="server-btn">
                                NekoStream
                            </button>
                        </div>
                        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
                            <button id="btnSub" class="audio-btn active">SUB</button>
                            <button id="btnDub" class="audio-btn">DUB</button>
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
                        <ul id="episodeListContainer" class="episode-list">
                        </ul>
                    </div>
                </div>

                <button id="closeMoviePlayer" style=" display:none ;margin-top:16px;background:#222;color:#fff;padding:10px 24px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">Close Player</button>
            </div>

        `;

        attachKaaDownloadDebugButtons();
        playerSection.scrollIntoView({behavior: 'smooth'});

        document.getElementById('btnSub').style.display = 'inline-block';
        document.getElementById('btnDub').style.display = 'inline-block';

        const btnSubEl = document.getElementById('btnSub');
        const btnDubEl = document.getElementById('btnDub');
        const applyAudioButtonState = (mode) => {
            const isDub = mode === 'dub';
            btnSubEl?.classList.toggle('active', !isDub);
            btnDubEl?.classList.toggle('active', isDub);
        };
        applyAudioButtonState(currentAudioMode);

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
        const syncDownloadVisibility = () => {
            if (animeDownloadWrap) animeDownloadWrap.style.display = 'block';
            if (movieDownloadWrap) movieDownloadWrap.style.display = 'block';
        };
        syncDownloadVisibility();

        const serverInfo = {
            server2embed: '2Embed: High Compatibility',
            srvMega: 'MegaCloud (S1): Fast Streaming',
            srvUp: 'UpCloud (S2): Stable Mirror',
            srvPahe1: 'KickAssAnime: HLS stream',
            srvNeko1: 'NekoStream: HLS stream, or Injected, depends',
            srvT: 'T-Cloud (S3): Reliable Backup',
            serverSuperembed: 'SuperEmbed: Multi-source aggregator',
            srvMegaTV: 'MegaCloud TV: Fast Streaming',
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

        function resetSharedVideoPlayer() {
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
        }

        function showVideoPlayer(streamUrl, subtitles = [], metadata = {}) {
            console.log('SHOWVIDEOPLAYER CALLED');

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
                    ]
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

                video.addEventListener('timeupdate', () => {
                    updateKaaSkipOverlay();
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

            video.play().catch(() => {});
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
            if (window.__preloadedNekoSources && already && parseInt(season) === parseInt(already.season || 1) && parseInt(episode) === parseInt(already.ep || 1)) {
                return;
            }
            if (window.__nekoPreloadInFlight.has(key)) return;
            window.__nekoPreloadInFlight.add(key);

            const title = animeTitle || document.getElementById('title')?.textContent.trim() || '';
            const query = new URLSearchParams({ malId: malId || '', tmdbId: tmdbId || '', title, type: audioType, season: season || 1, ep: episode || 1 });
            fetch(`/api/anime-neko-log?${query.toString()}`).then(res => res.json()).then(data => {
                if (data?.stream || data?.sources?.file) {
                    window.__preloadedNekoSources = data;
                    window.__preloadedNekoEpisode = { season, ep: episode };
                    console.log(`[Preload] ✓ Neko ready for S${season}E${episode}`);
                }
            }).catch(() => {}).finally(() => window.__nekoPreloadInFlight.delete(key));
        }

        async function loadKickAssAnimeVideo(
            episode,
            audioType
        ) {
            window.currentAudioType = audioType;
            const infoDiv = document.getElementById('serverInfoText');
            if (!malId) return false;

            try {
                if (infoDiv) infoDiv.textContent = 'KickAssAnime: Loading stream...';
                const seasonSelectEl = document.getElementById('seasonSelect');
                const selectedSeason = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || 1;
                // Race a Neko resolution in parallel with KAA. If KAA turns out empty below,
                // there's a good chance this has already finished by then.
                preloadNekoForEpisode(selectedSeason, episode, audioType);
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
                if (window.__preloadedKaaSources && preloadedEp && parseInt(selectedSeason) === parseInt(preloadedEp.season || 1) && parseInt(episode) === parseInt(preloadedEp.ep || 1)) {
                    console.log('[KAA] Using preloaded sources for S' + selectedSeason + 'E' + episode);
                    data = window.__preloadedKaaSources;
                    window.__preloadedKaaSources = null;
                    window.__preloadedKaaEpisode = null;
                } else {
                    const res = await fetch(
                        `/api/anime-kaa-servers?malId=${encodeURIComponent(malId)}&tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(selectedSeason)}&ep=${encodeURIComponent(episode)}&audio=${encodeURIComponent(audioType)}&itemType=${encodeURIComponent(requestedType)}&title=${encodeURIComponent(title)}`
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
                    // KAA has nothing for this episode. Prefer Neko if the parallel preload
                    // above already resolved it (KAA and Neko are ours — real HLS we control).
                    // Only fall to Megaplay, an external embed, if Neko isn't ready either.
                    if (infoDiv) infoDiv.textContent = 'Loading stream...';

                    // Note: only window.currentServer (used for KAA-specific UI gating, like
                    // the skip-segment overlay) is updated here. The local `currentServer`
                    // variable deliberately stays 'srvPahe1' — it's what the next episode's
                    // updateSource(currentServer) call reads, and KAA should get a fresh
                    // attempt on every new episode rather than sticking to whatever this one
                    // fell back to.
                    const preloadedNekoEp = window.__preloadedNekoEpisode;
                    if (window.__preloadedNekoSources && preloadedNekoEp && parseInt(selectedSeason) === parseInt(preloadedNekoEp.season || 1) && parseInt(episode) === parseInt(preloadedNekoEp.ep || 1)) {
                        console.log('[Fallback] KAA had no sources, using preloaded Neko instead');
                        document.querySelectorAll('.server-btn').forEach(btn => btn.classList.toggle('active', btn.id === 'srvNeko1'));
                        window.currentServer = 'srvNeko1';
                        showServerInfo('srvNeko1');
                        return await loadNekoStreamVideo(episode, audioType, selectedSeason);
                    }

                    const seasonGroups = window.__resolvedSeasonGroups || [];
                    const seasonMatch = seasonGroups.find(g => Number(g.seasonNumber) === Number(selectedSeason));
                    const megaplayMalId = seasonMatch?.malId || malId;
                    try {
                        const mpRes = await fetch(`/api/stream/mal/${encodeURIComponent(megaplayMalId)}/${encodeURIComponent(episode)}/${encodeURIComponent(audioType)}`);
                        const mpData = await mpRes.json().catch(() => ({}));
                        if (mpRes.ok && mpData?.embedUrl) {
                            console.log('[Megaplay fallback] KAA had no sources, using Megaplay embed:', mpData.embedUrl);
                            document.querySelectorAll('.server-btn').forEach(btn => btn.classList.toggle('active', btn.id === 'srvMega1'));
                            window.currentServer = 'srvMega1';
                            showIframePlayer(mpData.embedUrl);
                            if (infoDiv) infoDiv.textContent = 'Megaplay: Streaming.';
                            return true;
                        }
                    } catch (e) {
                        console.warn('[Megaplay fallback] request failed:', e.message);
                    }
                    if (infoDiv) infoDiv.textContent = 'KickAssAnime: No playable stream found.';
                    return false;
                }

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

        async function fetchKaaSubtitlesForEpisode(episode, audioType, season) {
            try {
                if (String(audioType || '').toLowerCase() !== 'sub') return [];
                const seasonSelectEl = document.getElementById('seasonSelect');
                const selectedSeason = seasonSelectEl?.dataset?.playSeason || seasonSelectEl?.value || season || 1;
                const title = document.getElementById('title')?.textContent.trim() || '';
                const query = new URLSearchParams({
                    malId: malId || '',
                    tmdbId: tmdbId || '',
                    season: selectedSeason,
                    ep: episode || 1,
                    type: 'sub',
                    title
                });
                const res = await fetch(`/api/anime-kaa-servers?${query.toString()}`);
                if (!res.ok) return [];
                const data = await res.json().catch(() => ({}));
                return Array.isArray(data?.subtitles) ? data.subtitles : [];
            } catch (err) {
                console.warn('[NekoStream] Failed to borrow KAA subtitles:', err);
                return [];
            }
        }

        async function loadMegaPlayFrame(episode, audioType) {
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
            const seasonGroups = window.__resolvedSeasonGroups || [];
            const seasonMatch = seasonGroups.find(g => Number(g.seasonNumber) === Number(selectedSeason));
            const megaplayMalId = seasonMatch?.malId || malId;
            try {
                const res = await fetch(`/api/stream/mal/${encodeURIComponent(megaplayMalId)}/${encodeURIComponent(episode)}/${encodeURIComponent(audioType)}`);
                if (!res.ok) {
                    if (infoDiv) infoDiv.textContent = 'MegaPlay: Failed to resolve stream.';
                    return false;
                }
                const data = await res.json();
                if (!data?.embedUrl) {
                    if (infoDiv) infoDiv.textContent = 'MegaPlay: Invalid response from backend.';
                    return false;
                }
                frame.src = data.embedUrl;
                if (infoDiv) infoDiv.textContent = `MegaPlay: Loaded [${audioType.toUpperCase()}]`;
                return true;
            } catch (err) {
                if (infoDiv) infoDiv.textContent = 'MegaPlay: Failed to resolve stream.';
                console.error('[MegaPlay] playback error:', err);
                return false;
            }
        }
        async function loadNekoStreamVideo(episode, audioType, season) {
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
                const query = new URLSearchParams({
                    malId: malId || '',
                    tmdbId: tmdbId || '',
                    title,
                    type: audioType,
                    season: season || 1,
                    ep: episode || 1
                });
                const intervalId = setInterval(() => {
                    syncEpisodePanelHeight();
                }, 1000);

                // Stop the timer after 10 seconds (10000 milliseconds)
                setTimeout(() => {
                    clearInterval(intervalId);
                }, 10000);

                let data;
                const preloadedNekoEp = window.__preloadedNekoEpisode;
                if (window.__preloadedNekoSources && preloadedNekoEp && parseInt(season) === parseInt(preloadedNekoEp.season || 1) && parseInt(episode) === parseInt(preloadedNekoEp.ep || 1)) {
                    console.log('[Neko] Using preloaded sources for S' + season + 'E' + episode);
                    data = window.__preloadedNekoSources;
                    window.__preloadedNekoSources = null;
                    window.__preloadedNekoEpisode = null;
                } else {
                    const res = await fetch(`/api/anime-neko-log?${query.toString()}`);
                    data = await res.json().catch(() => ({}));

                    if (!res.ok) {
                        if (infoDiv) infoDiv.textContent = `NekoStream: ${data?.error || 'Failed to resolve stream.'}`;
                        return false;
                    }
                }

                const streamUrl = data?.stream || data?.sources?.file || data?.url;
                if (!streamUrl) {
                    if (infoDiv) infoDiv.textContent = 'NekoStream: No playable stream found.';
                    return false;
                }
                const borrowedKaaSubtitles = await fetchKaaSubtitlesForEpisode(episode, audioType, season);
                currentNekoDownloads = {
                    sub2: data?.downloads?.sub2 || null,
                    dub2: data?.downloads?.dub2 || null
                };
                const proxiedStreamUrl = `/api/m3u8-proxy?url=${encodeURIComponent(streamUrl)}`;
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
                if (infoDiv) infoDiv.textContent = 'NekoStream: Failed to load stream.';
                return false;
            }
        }


        // 4. Update Source Logic
        function updateSource(server) {
            currentServer = server; 
            window.currentServer = server;
            console.log('[updateSource] start', {
                server,
                season: document.getElementById('seasonSelect')?.value,
                playSeason: document.getElementById('seasonSelect')?.dataset?.playSeason,
                episode: document.getElementById('episodeSelect')?.value,
                audio: currentAudioMode
            });

            updateKaaControlsVisibility();
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
        const btnDownloadMovie = document.getElementById('btnDownloadMovie');

        // Movie downloads disabled — all public sources are either malware or obfuscated
        // Anime downloads work fine via KickAA/Neko
        // if (btnDownloadMovie) { ... }

        const moviesBtns = new Set(['server2embed', 'srvMega', 'srvUp', 'srvT', 'serverSuperembed', 'srvMoviesApiM', 'srv111MoviesM', 'srvNontonGoM']);
        const animeTVBtns = new Set(['srvMegaTV', 'srvUpTV', 'srvTTV', 'srvMoviesApi', 'srv111Movies', 'srvNontonGo']);
        const animeDubBtns = new Set(['srvMega1', 'srvPahe1', 'srvNeko1']);
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
            if (requestedType === 'tv') {
                const tvRes = await fetch(`/api/tmdb-proxy/tv/${tmdbId}`);
                if (!tvRes.ok) {
                    throw new Error(`TV metadata fetch failed: ${tvRes.status}`);
                }
                const data = await tvRes.json();
                animeTitle = data.name || data.original_name || '';
                isAnime = !!(data && (Array.isArray(data.genres) && data.genres.some(g => (g.name || '').toLowerCase() === 'animation')) && ((data.original_language || '').toLowerCase() === 'ja' || (Array.isArray(data.origin_country) && data.origin_country.includes('JP'))));
                useAnimeSeasonUX = isAnime && animeLeverActive;
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
                        if (n === baseNorm || n.startsWith(baseNorm) || baseNorm.startsWith(n)) return true;
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
                // Update server: anime (TV or movie) uses KAA
                if (isAnime) {
                    currentServer = 'srvPahe1';
                } else if (data.seasons && data.seasons.length > 0) {
                    currentServer = 'srvMegaTV'; // TV shows use MegaTV
                }
                // else: keep default (srvMega for movies)

                // Move the highlight now. updateSource() only runs after season resolution,
                // which can take seconds, and until then the markup still shows srvMega active.
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

                    // Primary fallback for anime lever mode: backend MAL/Jikan cached season groups.
                    if (useAnimeSeasonUX && seasonEntries.length <= 1) {
                        try {
                            const malGroups = await fetchJsonSafe(`/api/anime-season-groups?tmdbId=${tmdbId}`);
                            const groups = Array.isArray(malGroups?.groups) ? malGroups.groups : [];
                            if (groups.length > 1) {
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

                    seasonSelect.innerHTML = useAnimeSeasonUX
                        ? `<option value="all">All eps</option>${seasonEntries.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('')}`
                        : seasonEntries.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('');
                    if (seasonPickerWrap) {
                        seasonPickerWrap.style.display = useAnimeSeasonUX ? 'flex' : 'none';
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
                            if (mode === 'all' && useAnimeSeasonUX) {
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
                                episodeSelect.value = String(first.episode_number || 1);

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

                                    listHTML += `
                                        <li class="episode-list-item${isWatched}${isContinueFrom}" data-season="${seasonNum}" data-ep="${ep.episode_number}" onclick="window.__handleEpisodeItemClick && window.__handleEpisodeItemClick(this)">
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
                    
                    // When season changes, fetch new episodes, then update video source
                    seasonSelect.onchange = async () => { 
                        await populateEpisodes(seasonSelect.value); 
                        updateSource(currentServer);
                        requestAnimationFrame(syncEpisodePanelHeight);
                    };
                    
                    // Keep fallback select change just in case
                    episodeSelect.onchange = () => {
                        updateSource(currentServer);
                    };
                } else {
                    // Requested TV item but no seasons found; fall back to movie-style embed format.
                    isSeries = false;
                    currentServer = 'srvMega';
                    syncDownloadVisibility();
                }
            } else {
                // For type=movie, never run TV season logic.
                isSeries = false;
                currentServer = 'srvMega';
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
