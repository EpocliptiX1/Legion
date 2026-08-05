console.log("mainPageControls LOADED");
console.log("before assignment:", window.showLongToast);
// Scroll a horizontal row left (-1) or right (1) by one viewport of cards
function scrollRow(id, dir) {
    if (id === 'rowRecommended' && typeof window.__browseRecommendedPage === 'function') {
        const handled = window.__browseRecommendedPage(dir);
        if (handled) return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollBy({ left: dir * 900, behavior: 'smooth' });
}

// --- SETTINGS/ACCOUNT/API STATUS INIT FOR MOVIEINFO ---
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('settingsModal')) {
        const nameInput = document.getElementById('settingsUsername');
        const navName = document.getElementById('navUsername');
        const username = localStorage.getItem('username') || 'Guest';
        if (nameInput) nameInput.value = username;
        if (navName) navName.innerText = username;

        const sourceInput = document.getElementById('settingsMovieSource');
        if (sourceInput && localStorage.getItem('movieSource')) {
            sourceInput.value = localStorage.getItem('movieSource');
        }

        const statView = document.getElementById('statView');
        if (statView) statView.innerText = localStorage.getItem('views') || '0/3';



        const apiStatusText = document.getElementById('apiStatusText');
        if (apiStatusText) {
            apiStatusText.innerText = 'Checking API...';
            setTimeout(() => {
                apiStatusText.innerText = 'Online';
                apiStatusText.style.color = '#46d369';
            }, 500);
        }
    }
});
/* =========================================
   1. DYNAMIC HERO SLIDER LOGIC
   ========================================= */
let heroMovies = []; 
let currentSlide = 0;
let _heroInitStarted = false;

const HERO_TRAILER_CUTOFF_RATIO = 0.8;
const HERO_AUDIO_FADE_MS = 3000;
const HERO_AUDIO_TARGET_VOLUME = 100;
let heroYouTubeApiPromise = null;
let heroTrailerPlayer = null;
const heroAudioState = {
    fadeTimer: null,
    isHeroInView: true,
    observerBound: false,
    hintShown: false
};
const heroTrailerMonitor = {
    iframe: null,
    frameWindow: null,
    pollTimer: null,
    readyTimer: null,
    errorTimer: null,
    cutoffTimer: null,
    initAttempts: 0,
    currentTime: 0,
    duration: 0,
    trailerKey: '',
    timerStarted: false,
    reached90Logged: false,
    reached100Logged: false,
    cutoffReached: false,
    onCutoff: null,
    onUnavailable: null
};

const hoverTrailerMonitor = {
    iframe: null,
    player: null,
    keys: [],
    currentIndex: 0,
    currentKey: '',
    ready: false,
    active: false,
    pendingTimeout: null,
    onUnavailable: null
};

function clearHoverTrailerMonitor() {
    if (hoverTrailerMonitor.pendingTimeout) {
        clearTimeout(hoverTrailerMonitor.pendingTimeout);
        hoverTrailerMonitor.pendingTimeout = null;
    }
    hoverTrailerMonitor.keys = [];
    hoverTrailerMonitor.currentIndex = 0;
    hoverTrailerMonitor.currentKey = '';
    hoverTrailerMonitor.ready = false;
    hoverTrailerMonitor.active = false;
    hoverTrailerMonitor.onUnavailable = null;
    if (hoverTrailerMonitor.player) {
        try {
            hoverTrailerMonitor.player.destroy();
        } catch (_) {
        }
        hoverTrailerMonitor.player = null;
    }
    hoverTrailerMonitor.iframe = null;
}

function advanceHoverTrailerCandidate() {
    if (!hoverTrailerMonitor.active) return;
    hoverTrailerMonitor.currentIndex += 1;
    if (hoverTrailerMonitor.currentIndex >= hoverTrailerMonitor.keys.length) {
        hoverTrailerMonitor.active = false;
        if (typeof hoverTrailerMonitor.onUnavailable === 'function') {
            hoverTrailerMonitor.onUnavailable();
        }
        return;
    }
    if (hoverTrailerMonitor.player) {
        try {
            hoverTrailerMonitor.player.stopVideo();
        } catch (_) {
        }
    }
    hoverTrailerMonitor.ready = false;
    loadHoverTrailerCandidate();
}

function loadHoverTrailerCandidate() {
    const iframe = hoverTrailerMonitor.iframe;
    const keys = hoverTrailerMonitor.keys;
    const idx = hoverTrailerMonitor.currentIndex;
    if (!iframe || !Array.isArray(keys) || idx >= keys.length) {
        if (iframe) iframe.src = '';
        return;
    }

    const candidate = keys[idx];
    if (!candidate) {
        if (typeof hoverTrailerMonitor.onUnavailable === 'function') {
            hoverTrailerMonitor.onUnavailable();
        }
        return;
    }

    hoverTrailerMonitor.currentKey = candidate;
    hoverTrailerMonitor.ready = false;
    hoverTrailerMonitor.active = true;

    const origin = encodeURIComponent(window.location.origin);
    const embedUrl = `https://www.youtube.com/embed/${candidate}?autoplay=1&mute=1&controls=0&loop=1&playlist=${candidate}&rel=0&enablejsapi=1&playsinline=1&modestbranding=1&origin=${origin}`;
    iframe.src = embedUrl;

    if (hoverTrailerMonitor.pendingTimeout) {
        clearTimeout(hoverTrailerMonitor.pendingTimeout);
        hoverTrailerMonitor.pendingTimeout = null;
    }
    hoverTrailerMonitor.pendingTimeout = setTimeout(() => {
        if (!hoverTrailerMonitor.ready && hoverTrailerMonitor.currentKey === candidate) {
            advanceHoverTrailerCandidate();
        }
    }, 12000);

    const initPlayer = () => {
        if (!hoverTrailerMonitor.active || hoverTrailerMonitor.currentKey !== candidate) return;
        try {
            if (!hoverTrailerMonitor.player) {
                hoverTrailerMonitor.player = new window.YT.Player(iframe, {
                    videoId: candidate,
                    playerVars: {
                        autoplay: 1,
                        mute: 1,
                        controls: 0,
                        rel: 0,
                        loop: 1,
                        playlist: candidate,
                        modestbranding: 1,
                        iv_load_policy: 3,
                        disablekb: 1,
                        fs: 0,
                        playsinline: 1,
                        origin: window.location.origin
                    },
                    events: {
                        onReady: (event) => {
                            hoverTrailerMonitor.ready = true;
                            if (hoverTrailerMonitor.pendingTimeout) {
                                clearTimeout(hoverTrailerMonitor.pendingTimeout);
                                hoverTrailerMonitor.pendingTimeout = null;
                            }
                            try {
                                event.target.mute();
                                event.target.setVolume(0);
                                event.target.playVideo();
                            } catch (_) {
                            }
                        },
                        onStateChange: (event) => {
                            if (event?.data === 1) {
                                hoverTrailerMonitor.ready = true;
                                if (hoverTrailerMonitor.pendingTimeout) {
                                    clearTimeout(hoverTrailerMonitor.pendingTimeout);
                                    hoverTrailerMonitor.pendingTimeout = null;
                                }
                            }
                        },
                        onError: () => {
                            advanceHoverTrailerCandidate();
                        }
                    }
                });
            } else {
                try {
                    hoverTrailerMonitor.player.loadVideoById({ videoId: candidate, startSeconds: 0 });
                } catch (_) {
                }
            }
        } catch (_) {
        }
    };

    if (window.YT && typeof window.YT.Player === 'function') {
        initPlayer();
    } else {
        ensureHeroYouTubeApi().then(initPlayer).catch(() => {
            // No further action, use iframe timeout fallback.
        });
    }
}

function setHoverTrailerSource(iframe, keys = [], onUnavailable = null) {
    clearHoverTrailerMonitor();
    if (!iframe || !Array.isArray(keys) || keys.length === 0) {
        if (iframe) iframe.src = '';
        return;
    }
    hoverTrailerMonitor.iframe = iframe;
    hoverTrailerMonitor.keys = [...keys];
    hoverTrailerMonitor.currentIndex = 0;
    hoverTrailerMonitor.onUnavailable = typeof onUnavailable === 'function' ? onUnavailable : null;
    loadHoverTrailerCandidate();
}

function ensureHeroYouTubeApi() {
    if (window.YT && typeof window.YT.Player === 'function') {
        return Promise.resolve();
    }
    if (heroYouTubeApiPromise) return heroYouTubeApiPromise;

    heroYouTubeApiPromise = new Promise((resolve) => {
        const prevReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (typeof prevReady === 'function') {
                try { prevReady(); } catch (_) { }
            }
            console.log('[HeroTrailer] YouTube IFrame API ready');
            resolve();
        };

        const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
        if (!existing) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.async = true;
            document.head.appendChild(tag);
        }

        // Safety fallback if callback does not fire but API is present.
        const watch = setInterval(() => {
            if (window.YT && typeof window.YT.Player === 'function') {
                clearInterval(watch);
                resolve();
            }
        }, 250);
        setTimeout(() => clearInterval(watch), 12000);
    });

    return heroYouTubeApiPromise;
}

function clearHeroTrailerMonitor() {
    if (heroTrailerMonitor.pollTimer) {
        clearInterval(heroTrailerMonitor.pollTimer);
        heroTrailerMonitor.pollTimer = null;
    }
    if (heroTrailerMonitor.readyTimer) {
        clearTimeout(heroTrailerMonitor.readyTimer);
        heroTrailerMonitor.readyTimer = null;
    }
    if (heroTrailerMonitor.cutoffTimer) {
        clearTimeout(heroTrailerMonitor.cutoffTimer);
        heroTrailerMonitor.cutoffTimer = null;
    }
    heroTrailerMonitor.currentTime = 0;
    heroTrailerMonitor.duration = 0;
    heroTrailerMonitor.trailerKey = '';
    heroTrailerMonitor.timerStarted = false;
    heroTrailerMonitor.reached90Logged = false;
    heroTrailerMonitor.reached100Logged = false;
    heroTrailerMonitor.initAttempts = 0;
    heroTrailerMonitor.cutoffReached = false;
    heroTrailerMonitor.onCutoff = null;
    heroTrailerMonitor.onUnavailable = null;
    heroTrailerMonitor.frameWindow = null;
    heroTrailerMonitor.iframe = null;
    if (heroTrailerMonitor.errorTimer) {
        clearTimeout(heroTrailerMonitor.errorTimer);
        heroTrailerMonitor.errorTimer = null;
    }
}

function stopHeroAudioFade() {
    if (heroAudioState.fadeTimer) {
        clearInterval(heroAudioState.fadeTimer);
        heroAudioState.fadeTimer = null;
    }
}

function isHeroAudioMutedByPreference() {
    return localStorage.getItem('muteHeroAudio') === 'true';
}

function muteHeroTrailerImmediate() {
    stopHeroAudioFade();
    if (!heroTrailerPlayer) return;
    try { heroTrailerPlayer.setVolume(0); } catch (_) { }
    try { heroTrailerPlayer.mute(); } catch (_) { }
}

function fadeInHeroTrailerAudio(durationMs = HERO_AUDIO_FADE_MS) {
    stopHeroAudioFade();
    if (!heroTrailerPlayer || !heroAudioState.isHeroInView || isHeroAudioMutedByPreference()) return;

    let playerState = -1;
    try { playerState = heroTrailerPlayer.getPlayerState(); } catch (_) { }
    if (playerState !== 1) return; // Only fade while actively playing

    const steps = 15;
    const stepDelay = Math.max(60, Math.floor(durationMs / steps));
    let step = 0;

    try { heroTrailerPlayer.setVolume(0); } catch (_) { }
    try { heroTrailerPlayer.unMute(); } catch (_) { }

    heroAudioState.fadeTimer = setInterval(() => {
        if (!heroTrailerPlayer || !heroAudioState.isHeroInView) {
            muteHeroTrailerImmediate();
            return;
        }

        step += 1;
        const ratio = Math.min(1, step / steps);
        const nextVolume = Math.round(HERO_AUDIO_TARGET_VOLUME * ratio);

        try {
            heroTrailerPlayer.unMute();
            heroTrailerPlayer.setVolume(nextVolume);
        } catch (_) { }

        if (ratio >= 1) {
            stopHeroAudioFade();
        }
    }, stepDelay);
}

function handleHeroVisibilityChange(isInView) {
    heroAudioState.isHeroInView = !!isInView;
    if (!heroAudioState.isHeroInView || isHeroAudioMutedByPreference()) {
        muteHeroTrailerImmediate();
        return;
    }
    fadeInHeroTrailerAudio();
}

function bindHeroVisibilityAudioControl() {
    if (heroAudioState.observerBound) return;
    const heroSection = document.getElementById('heroSection');
    if (!heroSection) return;
    heroAudioState.observerBound = true;

    const showHeroAudioHint = () => {
        if (heroAudioState.hintShown) return;
        heroAudioState.hintShown = true;
        if (document.querySelector('.hero-audio-hint')) return;

        const hint = document.createElement('div');
        hint.className = 'limit-toast hero-audio-hint';
        hint.textContent = 'U can mute the volume in personal settings';

        const progress = document.createElement('div');
        progress.className = 'toast-progress';
        hint.appendChild(progress);

        document.body.appendChild(hint);
        setTimeout(() => {
            hint.style.opacity = '0';
            hint.style.transform = 'translate(-50%, -8px)';
            setTimeout(() => {
                if (hint.parentNode) hint.parentNode.removeChild(hint);
            }, 320);
        }, 4200);
    };

    const evaluateVisibility = () => {
        const rect = heroSection.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const visiblePx = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
        const ratio = rect.height > 0 ? visiblePx / rect.height : 0;
        const isVisible = ratio >= 0.55 && rect.bottom > 120 && rect.top < (vh * 0.7);
        handleHeroVisibilityChange(isVisible);
    };

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!entry || !entry.isIntersecting) {
                handleHeroVisibilityChange(false);
                return;
            }
            evaluateVisibility();
        }, { threshold: [0, 0.2, 0.35, 0.6, 1] });
        observer.observe(heroSection);
    }

    window.addEventListener('scroll', evaluateVisibility, { passive: true });
    window.addEventListener('resize', evaluateVisibility);
    evaluateVisibility();

    // On indexBrowse the page-loading overlay covers the screen for ~2 s,
    // so delay the hint until the overlay has had time to fade out.
    const isBrowse = window.location.pathname.includes('indexBrowse.html');
    if (isBrowse) {
        setTimeout(showHeroAudioHint, 2800);
    } else {
        showHeroAudioHint();
    }
}

function postHeroTrailerCommand(func, args = []) {
    const target = heroTrailerMonitor.frameWindow;
    if (!target) return;
    try {
        target.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch (_) { }
}

function normalizeDurationToSeconds(rawDuration) {
    if (typeof rawDuration === 'number' && Number.isFinite(rawDuration)) return rawDuration;
    if (typeof rawDuration === 'string') {
        const trimmed = rawDuration.trim();
        if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

        // Accept ISO-8601 durations such as PT1M30S
        const m = trimmed.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
        if (m) {
            const h = Number(m[1] || 0);
            const min = Number(m[2] || 0);
            const s = Number(m[3] || 0);
            return h * 3600 + min * 60 + s;
        }
    }
    return 0;
}

function maybeStartHeroCutoffTimer() {
    if (heroTrailerMonitor.timerStarted || heroTrailerMonitor.cutoffReached) return;
    const totalSeconds = normalizeDurationToSeconds(heroTrailerMonitor.duration);
    if (!(totalSeconds > 0)) return;

    const cutoffSeconds = totalSeconds * HERO_TRAILER_CUTOFF_RATIO;
    const nowSeconds = Math.max(0, normalizeDurationToSeconds(heroTrailerMonitor.currentTime));
    const delayMs = Math.max(0, (cutoffSeconds - nowSeconds) * 1000);

    heroTrailerMonitor.timerStarted = true;
    console.log(`[HeroTrailer] duration raw=${heroTrailerMonitor.duration} normalized=${totalSeconds.toFixed(2)}s for ${heroTrailerMonitor.trailerKey || 'unknown'}`);
    console.log(`[HeroTrailer] starting 90% timer at ${cutoffSeconds.toFixed(2)}s (remaining ${(delayMs / 1000).toFixed(2)}s)`);

    heroTrailerMonitor.cutoffTimer = setTimeout(() => {
        const at = Math.round((heroTrailerMonitor.currentTime || cutoffSeconds) * 10) / 10;
        const total = Math.round(totalSeconds * 10) / 10;
        console.log(`[HeroTrailer] timer fired at ${at}s / ${total}s -> nextSlide()`);
        triggerHeroTrailerCutoff();
    }, delayMs);
}

function triggerHeroTrailerCutoff() {
    if (heroTrailerMonitor.cutoffReached) return;
    heroTrailerMonitor.cutoffReached = true;
    if (!heroTrailerMonitor.reached90Logged) {
        heroTrailerMonitor.reached90Logged = true;
        const p = Math.round((heroTrailerMonitor.currentTime || 0) * 10) / 10;
        const d = Math.round((heroTrailerMonitor.duration || 0) * 10) / 10;
        console.log(`[HeroTrailer] 90% reached (${p}s / ${d}s) for ${heroTrailerMonitor.trailerKey || 'unknown'}`);
    }
    const callback = heroTrailerMonitor.onCutoff;
    clearHeroTrailerMonitor();
    if (typeof callback === 'function') callback();
}

function setHeroTrailerSource(iframe, trailerKey, onCutoff, onUnavailable = null) {
    clearHeroTrailerMonitor();
    if (!iframe || !trailerKey) {
        console.log('[HeroTrailer] cleared source');
        if (heroTrailerPlayer && typeof heroTrailerPlayer.stopVideo === 'function') {
            try { heroTrailerPlayer.stopVideo(); } catch (_) { }
        }
        if (iframe) iframe.src = '';
        return;
    }

    console.log(`[HeroTrailer] loading trailer ${trailerKey}`);

    iframe.classList.remove('trailer-ready');

    const origin = encodeURIComponent(window.location.origin);
    iframe.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailerKey}&rel=0&enablejsapi=1&playsinline=1&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&origin=${origin}`;

    heroTrailerMonitor.iframe = iframe;
    heroTrailerMonitor.onCutoff = onCutoff;
    heroTrailerMonitor.onUnavailable = typeof onUnavailable === 'function' ? onUnavailable : null;
    heroTrailerMonitor.trailerKey = trailerKey;

    ensureHeroYouTubeApi().then(() => {
        if (heroTrailerMonitor.trailerKey !== trailerKey || heroTrailerMonitor.cutoffReached) return;

        const onPlayerStateChange = (e) => {
            if (e?.data === 1) {
                if (isHeroAudioMutedByPreference() || !heroAudioState.isHeroInView) {
                    muteHeroTrailerImmediate();
                } else {
                    fadeInHeroTrailerAudio();
                }
            }
            if (e?.data === 0 && !heroTrailerMonitor.reached100Logged) {
                heroTrailerMonitor.reached100Logged = true;
                const p = Math.round((heroTrailerMonitor.currentTime || 0) * 10) / 10;
                const d = Math.round((heroTrailerMonitor.duration || 0) * 10) / 10;
                console.log(`[HeroTrailer] 100% reached (${p}s / ${d}s) for ${heroTrailerMonitor.trailerKey || 'unknown'} [YT API]`);
                if (!heroTrailerMonitor.cutoffReached) triggerHeroTrailerCutoff();
            }
        };

        const onHeroPlayerError = (event) => {
            console.warn('[HeroTrailer] YT player error', event?.data, heroTrailerMonitor.trailerKey);
            if (heroTrailerMonitor.errorTimer) {
                clearTimeout(heroTrailerMonitor.errorTimer);
                heroTrailerMonitor.errorTimer = null;
            }
            if (typeof heroTrailerMonitor.onUnavailable === 'function') {
                heroTrailerMonitor.onUnavailable(event?.data);
            }
        };

        if (!heroTrailerPlayer) {
            heroTrailerPlayer = new window.YT.Player('heroTrailerFrame', {
                videoId: trailerKey,
                playerVars: {
                    autoplay: 1,
                    mute: 1,
                    controls: 0,
                    rel: 0,
                    playsinline: 1,
                    loop: 1,
                    playlist: trailerKey,
                    modestbranding: 1,
                    iv_load_policy: 3,
                    disablekb: 1,
                    fs: 0,
                    origin: window.location.origin
                },
                events: {
                    onReady: (ev) => {
                        if (heroTrailerMonitor.errorTimer) {
                            clearTimeout(heroTrailerMonitor.errorTimer);
                            heroTrailerMonitor.errorTimer = null;
                        }
                        try { ev.target.mute(); } catch (_) { }
                        try { ev.target.setVolume(0); } catch (_) { }
                        try { ev.target.playVideo(); } catch (_) { }
                        console.log(`[HeroTrailer] YT player ready for ${trailerKey}`);
                        const fr = document.getElementById('heroTrailerFrame');
                        if (fr) fr.classList.add('trailer-ready');
                    },
                    onStateChange: onPlayerStateChange,
                    onError: onHeroPlayerError
                }
            });
        } else {
            try {
                if (heroTrailerMonitor.errorTimer) {
                    clearTimeout(heroTrailerMonitor.errorTimer);
                    heroTrailerMonitor.errorTimer = null;
                }
                heroTrailerPlayer.loadVideoById({ videoId: trailerKey, startSeconds: 0 });
                heroTrailerPlayer.setVolume(0);
                heroTrailerPlayer.mute();
                heroTrailerPlayer.playVideo();
                console.log(`[HeroTrailer] YT player loadVideoById ${trailerKey}`);
            } catch (_) { }
        }
    }).catch(() => {
        console.log('[HeroTrailer] YT API fallback failed; using postMessage path');
    });

    const initHeroTrailerApi = () => {
        if (!heroTrailerMonitor.iframe || heroTrailerMonitor.cutoffReached) return;
        heroTrailerMonitor.frameWindow = iframe.contentWindow;
        heroTrailerMonitor.initAttempts += 1;
        console.log(`[HeroTrailer] init attempt ${heroTrailerMonitor.initAttempts} for ${trailerKey}`);
        postHeroTrailerCommand('addEventListener', ['onStateChange']);
        postHeroTrailerCommand('getDuration');
        postHeroTrailerCommand('getCurrentTime');

        if (heroTrailerMonitor.initAttempts < 8 && heroTrailerMonitor.duration <= 0) {
            heroTrailerMonitor.readyTimer = setTimeout(initHeroTrailerApi, 400);
        }
    };

    iframe.onload = () => {
        console.log(`[HeroTrailer] iframe loaded for ${trailerKey}`);
        initHeroTrailerApi();

        if (heroTrailerMonitor.errorTimer) {
            clearTimeout(heroTrailerMonitor.errorTimer);
            heroTrailerMonitor.errorTimer = null;
        }

        heroTrailerMonitor.errorTimer = setTimeout(() => {
            if (heroTrailerMonitor.trailerKey === trailerKey && !iframe.classList.contains('trailer-ready')) {
                console.warn('[HeroTrailer] trailer still not ready after timeout', trailerKey);
                if (typeof heroTrailerMonitor.onUnavailable === 'function') {
                    heroTrailerMonitor.onUnavailable('timeout');
                }
            }
        }, 9000);

        heroTrailerMonitor.pollTimer = setInterval(() => {
            if (heroTrailerPlayer && typeof heroTrailerPlayer.getDuration === 'function') {
                try {
                    const d = Number(heroTrailerPlayer.getDuration()) || 0;
                    const t = Number(heroTrailerPlayer.getCurrentTime()) || 0;
                    if (d > 0) heroTrailerMonitor.duration = d;
                    if (t >= 0) heroTrailerMonitor.currentTime = t;
                } catch (_) { }
            }

            postHeroTrailerCommand('getCurrentTime');
            postHeroTrailerCommand('getDuration');
            maybeStartHeroCutoffTimer();

            const { currentTime, duration } = heroTrailerMonitor;
            if (duration > 0 && currentTime / duration >= HERO_TRAILER_CUTOFF_RATIO) {
                triggerHeroTrailerCutoff();
            }
        }, 1000);
    };
}

if (!window.__heroTrailerMessageBound) {
    window.addEventListener('message', (event) => {
        const src = String(event.origin || '');
        if (!src.includes('youtube.com') && !src.includes('youtube-nocookie.com')) return;
        if (heroTrailerMonitor.frameWindow && event.source !== heroTrailerMonitor.frameWindow) return;

        let payload = event.data;
        if (typeof payload === 'string') {
            try {
                payload = JSON.parse(payload);
            } catch (_) {
                return;
            }
        }

        if (!payload) return;

        if (payload.event === 'onStateChange' && payload.info === 0 && !heroTrailerMonitor.reached100Logged) {
            heroTrailerMonitor.reached100Logged = true;
            const p = Math.round((heroTrailerMonitor.currentTime || 0) * 10) / 10;
            const d = Math.round((heroTrailerMonitor.duration || 0) * 10) / 10;
            console.log(`[HeroTrailer] 100% reached (${p}s / ${d}s) for ${heroTrailerMonitor.trailerKey || 'unknown'}`);
            if (!heroTrailerMonitor.cutoffReached) triggerHeroTrailerCutoff();
            return;
        }

        if (payload.event !== 'infoDelivery' || !payload.info) return;
        const info = payload.info || {};
        if (typeof info.currentTime === 'number') {
            heroTrailerMonitor.currentTime = info.currentTime;
        }
        if (typeof info.duration === 'number') {
            const wasUnknown = heroTrailerMonitor.duration <= 0;
            heroTrailerMonitor.duration = info.duration;
            if (wasUnknown && info.duration > 0) {
                console.log(`[HeroTrailer] duration detected: ${Math.round(info.duration * 10) / 10}s for ${heroTrailerMonitor.trailerKey || 'unknown'}`);
            }
        }
        maybeStartHeroCutoffTimer();

        const { currentTime, duration } = heroTrailerMonitor;
        if (duration > 0 && currentTime / duration >= HERO_TRAILER_CUTOFF_RATIO) {
            if (!heroTrailerMonitor.reached90Logged) {
                heroTrailerMonitor.reached90Logged = true;
                const p = Math.round(currentTime * 10) / 10;
                const d = Math.round(duration * 10) / 10;
                console.log(`[HeroTrailer] 90% reached (${p}s / ${d}s) for ${heroTrailerMonitor.trailerKey || 'unknown'}`);
            }
            triggerHeroTrailerCutoff();
        }
    });
    window.__heroTrailerMessageBound = true;
}

window.setHeroTrailerSource = setHeroTrailerSource;
window.fadeInHeroTrailerAudio = fadeInHeroTrailerAudio;
window.muteHeroTrailerImmediate = muteHeroTrailerImmediate;

async function initHero() {
    if (_heroInitStarted) return;
    _heroInitStarted = true;
    bindHeroVisibilityAudioControl();
    if (window.__animeMode) return;
    try {
        const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
        let movies = [];

        if (isBrowsePage && window.recommendationsSystem?.generateRecommendations) {
            movies = await window.recommendationsSystem.generateRecommendations(8);
        }

        if (!movies || movies.length === 0) {
            const baseUrl = '/movies/library?limit=8&sort=popularity_desc';
            const source = window.getMovieSource ? window.getMovieSource() : 'local';
            const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
            const response = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
            movies = await response.json();
        }

        heroMovies = movies.map(movie => {
            let stars = movie.Stars || "";
            if (!stars && movie.credits && Array.isArray(movie.credits.cast)) {
                stars = movie.credits.cast.map(actor => actor.name).join(', ');
            }
            return {
                id: movie.ID,
                title: movie['Movie Name'],
                imdbId: movie.imdb_id || "", 
                rating: movie.Rating,
                year: movie.Year || (movie.release_date ? (movie.release_date.match(/\b(19|20)\d{2}\b/) || [])[0] : '') || "N/A",
                runtime: movie.Runtime || "-- min",
                plot: movie.Plot || "No plot summary available for this title.",
                stars,
                searchName: movie['Movie Name'],
                poster: movie.Poster || (movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : '')
            };
        });

        const heroTag = document.getElementById('heroTag');
        if (heroTag && isBrowsePage) {
            heroTag.textContent = 'Recommended for you';
        }

        if (heroMovies.length > 0) {
            updateHero();
            updateDots();
        }
    } catch (err) {
        console.error("Hero Init Error:", err);
    }
    
}

// ARROW LOGIC (Fixed global scope)
window.nextSlide = function() {
    currentSlide = (currentSlide + 1) % heroMovies.length;
    updateHero();
};

window.prevSlide = function() {
    currentSlide = (currentSlide - 1 + heroMovies.length) % heroMovies.length;
    updateHero();
};

window.goToSlide = function(index) {
    currentSlide = index;
    updateHero();
};

function bindHeroSwipe() {
    const heroSection = document.getElementById('heroSection');
    if (!heroSection) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    const threshold = 40;

    heroSection.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        tracking = true;
    }, { passive: true });

    heroSection.addEventListener('touchend', (event) => {
        if (!tracking) return;
        tracking = false;

        const touch = event.changedTouches[0];
        if (!touch) return;

        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;

        if (dx < 0) {
            if (typeof window.nextSlide === 'function') window.nextSlide();
        } else {
            if (typeof window.prevSlide === 'function') window.prevSlide();
        }
    }, { passive: true });
}

document.addEventListener('DOMContentLoaded', bindHeroSwipe);

function updateDots() {
    const dotsContainer = document.getElementById('sliderDots');
    if(dotsContainer) {
        dotsContainer.innerHTML = heroMovies.map((_, i) => 
            `<span class="dot ${i === currentSlide ? 'active' : ''}" onclick="goToSlide(${i})"></span>`
        ).join('');
    }
}

/* =========================================
   2. MOVIE OVERLAY & PLAY LOGIC
   ========================================= */
function clampHeroTitleHeight() {
    const titleEl = document.getElementById('heroTitle');
    if (!titleEl || !titleEl.parentElement) return;

    const parentHeight = titleEl.parentElement.getBoundingClientRect().height;
    if (parentHeight <= 0) {
        titleEl.classList.remove('hero-title-clamped');
        titleEl.style.maxHeight = '';
        return;
    }

    const maxAllowed = parentHeight * 0.4;
    titleEl.classList.remove('hero-title-clamped');
    titleEl.style.maxHeight = '';

    const titleHeight = titleEl.getBoundingClientRect().height;
    if (titleHeight > maxAllowed) {
        titleEl.classList.add('hero-title-clamped');
    }
}

async function updateHero(_skipCount = 0) {
    if (heroMovies.length === 0) return;
    const movie = heroMovies[currentSlide];
    
    const content = document.querySelector('.hero-content');
    if (content) content.style.opacity = '0';

    if (window.fetchYTId) {
        const searchQuery = movie.year ? `${movie.title} ${movie.year}` : movie.title;
        const tId = await window.fetchYTId(searchQuery);
        movie.currentTrailerId = tId;

        // If no trailer found, silently advance to next slide (max one full cycle)
        if (!tId && _skipCount < heroMovies.length - 1) {
            currentSlide = (currentSlide + 1) % heroMovies.length;
            return updateHero(_skipCount + 1);
        }

        const heroFrame = document.getElementById('heroTrailerFrame');
        const heroTrailerSide = document.querySelector('.hero-trailer-side');
        if (heroFrame) {
            if (tId) {
                setHeroTrailerSource(heroFrame, tId, () => {
                    if (typeof window.nextSlide === 'function') window.nextSlide();
                });
                if (heroTrailerSide) heroTrailerSide.style.display = '';
            } else {
                setHeroTrailerSource(heroFrame, '', null);
                if (heroTrailerSide) heroTrailerSide.style.display = 'none';
            }
        }
    }

    // 2. UPDATE TEXT: Matching your HTML IDs exactly
    setTimeout(() => {
        if (document.getElementById('heroTitle')) document.getElementById('heroTitle').innerText = movie.title;
        if (document.getElementById('statRating')) document.getElementById('statRating').innerText = movie.rating || "--";
        if (document.getElementById('statDate')) document.getElementById('statDate').innerText = movie.year || "----";
        if (document.getElementById('statRuntime')) document.getElementById('statRuntime').innerText = movie.runtime || "-- min";
        if (document.getElementById('heroDesc')) document.getElementById('heroDesc').innerText = movie.plot;
        clampHeroTitleHeight();

        // Poster card (indexMain hero-main-poster)
        const heroPosterImg = document.getElementById('heroPosterImg');
        if (heroPosterImg) {
            if (movie.poster) {
                heroPosterImg.src = movie.poster;
                heroPosterImg.style.display = 'block';
            } else {
                heroPosterImg.style.display = 'none';
            }
        }

        if (content) content.style.opacity = '1';
        updateDots();
        if (window.translator && typeof window.translator.translateTextNodes === 'function') {
            const heroSection = document.querySelector('.hero');
            window.translator.translateTextNodes(heroSection || document.body, {
                targetLang: window.translator.getTargetLanguage ? window.translator.getTargetLanguage() : undefined,
                sourceLang: 'EN'
            });
        }
    }, 300);
}
window.openMovie = async function() {
    const movie = heroMovies[currentSlide];
    const overlay = document.getElementById('movieOverlay');
    if(!overlay || !movie) return;
    console.log('[Overlay] Loading movie:', movie);
    const title = movie.title;
    const rating = movie.rating || "--";
    const year = movie.year || "----";
    const runtime = movie.runtime || "-- min";
    const plot = movie.plot;
    const stars = movie.stars;
    console.log('[Overlay] Title:', title);
    console.log('[Overlay] Rating:', rating);
    console.log('[Overlay] Year:', year);
    console.log('[Overlay] Runtime:', runtime);
    console.log('[Overlay] Plot:', plot);
    console.log('[Overlay] Stars:', stars);
    document.getElementById('statTitle').innerText = title;
    document.getElementById('statRatingOverlay').innerText = rating;
    document.getElementById('statDateOverlay').innerText = year;
    document.getElementById('statRuntimeOverlay').innerText = runtime;
    document.getElementById('statPlot').innerText = plot;

    const castList = document.getElementById('castListOverlay');
    if (castList && stars) {
        const cleanedStars = String(stars).replace(/[\[\]']/g, ""); 
        const actors = cleanedStars.split(',').slice(0, 4); 
        console.log('[Overlay] Actors parsed:', actors);
        castList.innerHTML = actors.map(name => `
            <li> <p>${name.trim()}</p></li>
        `).join('');
    } else {
        console.log('[Overlay] No cast found or castList element missing.');
    }

    const maxTrailer = document.getElementById('maxTrailer');
    if (maxTrailer) {
        maxTrailer.src = ""; // Clear old video 
        if (!movie.currentTrailerId && window.fetchYTId) {
            movie.currentTrailerId = await window.fetchYTId(title);
        }
        if (movie.currentTrailerId) {
            maxTrailer.src = `https://www.youtube.com/embed/${movie.currentTrailerId}?autoplay=1&rel=0&enablejsapi=1`;
        }
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.triggerPlay = function() {
    openMovie();
    setTimeout(() => {
        const plot = document.getElementById('statPlot');
        if(plot) plot.scrollIntoView({ behavior: 'auto', block: 'center' });
    }, 100);
};

window.closeMovie = function() {
    document.getElementById('movieOverlay').classList.remove('active');
    document.getElementById('maxTrailer').src = "";
    document.body.style.overflow = 'auto';
};

/* =========================================
   3. REDIRECT & TRAILER FETCH
   ========================================= */
window.openRedirectModal = function() {
    document.getElementById('redirectModal').classList.add('active');
};

window.closeRedirectModal = function() {
    document.getElementById('redirectModal').classList.remove('active');
};

window.proceedToIMDb = function() {
    const movie = heroMovies[currentSlide];
    const url = movie.imdbId 
        ? `https://www.imdb.com/title/${movie.imdbId}/` 
        : `https://www.imdb.com/find?q=${encodeURIComponent(movie.title)}`;
    window.open(url, "_blank");
    closeRedirectModal();
};
 

// TMDB API Key Checker
async function checkTmdbApiKey() {
    const statusCircle = document.getElementById('apiStatusCircle');
    const statusText = document.getElementById('apiStatusText');
    if (!statusCircle || !statusText) return;
    statusCircle.style.background = '#aaa';
    statusText.textContent = 'Checking API...';
    try {
        const url = window.tmdbBuildUrl ? window.tmdbBuildUrl('/movie/550') : null;
        if (!url) throw new Error('No TMDB URL');
        const res = await fetch(url);
        if (res.ok) {
            statusCircle.style.background = '#2ecc40'; // green
            statusText.textContent = 'API Key Valid';
        } else {
            statusCircle.style.background = '#ff4444'; // red
            statusText.textContent = 'API Key Invalid';
        }
    } catch (err) {
        statusCircle.style.background = '#ff4444';
        statusText.textContent = 'API Offline or Invalid';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initHero();
    checkTmdbApiKey();
});

document.addEventListener('DOMContentLoaded', async () => {
    
    initSlider();

    // 2. PLAY BUTTON LOGIC
    const playBtn = document.querySelector('.btn-play');
    if(playBtn) playBtn.onclick = triggerPlay;

    // ===============================================================
    // SEARCH BAR LOGIC (Navbar)
    // ===============================================================
    const searchInput = document.querySelector('.search-box input');
    const searchBox = document.querySelector('.search-box');
    
    if (searchInput && searchBox) {
        let resultsMenu = document.getElementById('searchResults');
        if (!resultsMenu) {
            resultsMenu = document.createElement('div');
            resultsMenu.id = 'searchResults';
            resultsMenu.className = 'search-results-menu';
            searchBox.appendChild(resultsMenu);
        }

        if (resultsMenu.parentElement !== document.body) {
            document.body.appendChild(resultsMenu);
        }
        resultsMenu.classList.add('search-results-modal');

        // Expansion
        searchInput.addEventListener('focus', () => searchBox.classList.add('expanded'));
        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                searchBox.classList.remove('expanded');
                resultsMenu.classList.remove('active');
            }, 250);
        });

        // Dropdown Search
        searchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            if (query.length > 0) {
                resultsMenu.classList.add('active');
                try {
                    const baseUrl = `/search?q=${encodeURIComponent(query)}`;
                    const response = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
                    const movies = await response.json();
                    renderSearchResults(movies, resultsMenu);
                } catch (err) {
                    console.error("Backend error:", err);
                    resultsMenu.innerHTML = '<div style="padding:15px; color:red">Backend offline</div>';
                }
            } else {
                resultsMenu.classList.remove('active');
            }
        });

        // Enter Key Redirect
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = e.target.value.trim();
                if (query.length > 0) {
                    window.location.href = `searchQueryResult.html?q=${encodeURIComponent(query)}`;
                }
            }
        });
    }

    // ===============================================================
    // RESULTS PAGE LOGIC (Search Grid with Overlays)
    // ===============================================================
    const fullResultsGrid = document.getElementById('fullResultsGrid');
    
    if (fullResultsGrid) {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        
        if (query) {
            const display = document.getElementById('queryDisplay');
            if(display) display.innerText = query;
            
            try {
                const baseUrl = `/search?q=${encodeURIComponent(query)}`;
                const response = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
                const movies = await response.json();
                
                // --- GENERATE HTML ---
                fullResultsGrid.innerHTML = movies.map(movie => `
                    <div class="movie-card" onclick="window.location.href='movieInfo.html?id=${movie.ID}&type=movie'">                        
                        <div style="position: relative; width: 100%; height: 270px;">
                            <img src="${movie.poster_full_url}" 
                                    alt="${movie['Movie Name']}" 
                                    style="width:100%; height:100%; object-fit:cover;"
                                    onerror="this.src='/img/LOGO_Short.png'">
                            
                            <div class="card-overlay">
                                <svg class="play-icon-svg" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/> 
                                </svg>
                            </div>
                        </div>

                        <div class="movie-card-info">
                            <h3>${movie['Movie Name']}</h3>
                            <p>${movie.release_date ? movie.release_date.split('-')[0] : (movie.Year || 'N/A')} • ⭐ ${getMovieRating(movie)}</p>
                        </div>
                    </div>
                `).join('');
                
            } catch (err) {
                console.error("Failed to load results:", err);
                fullResultsGrid.innerHTML = '<p style="color:red; text-align:center;">Could not connect to database.</p>';
            }
        }
    }
});

// Helper Functions
function renderSearchResults(movies, container) {
    if (movies.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:#888; text-align:center;">No results found.</div>';
        return;
    }

    container.innerHTML = movies.map(movie => `
        <div class="search-item" onclick="window.location.href='movieInfo.html?id=${movie.ID}&type=movie'">
            <img src="${movie.poster_full_url}" alt="poster" onerror="this.src='/img/LOGO_Short.png'">
            <div class="search-info">
                <h5>${movie['Movie Name']}</h5>
                <p>${movie.release_date ? movie.release_date.split('-')[0] : (movie.Year || 'N/A')} • ⭐ ${getMovieRating(movie)} IMDb</p>
            </div>
        </div>
    `).join('');
}

function getMovieRating(movie) {
    if (!movie || typeof movie !== 'object') return 'N/A';
    const raw = movie.Rating ?? movie.imdb_rating ?? movie.vote_average ?? movie['IMDb Rating'] ?? movie['IMDB Rating'];
    if (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) return 'N/A';
    const num = Number(raw);
    return Number.isFinite(num) ? num.toFixed(1) : String(raw);
}

function initSlider() {
    const dotsContainer = document.getElementById('sliderDots');
    if (!dotsContainer) return;
    dotsContainer.innerHTML = '';
    heroMovies.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.classList.add('dot');
        if (index === 0) dot.classList.add('active');
        dot.onclick = () => goToSlide(index);
        dotsContainer.appendChild(dot);
    });
}
// hero updater
function updateHeroUI() {
    if (isAnimating) return;
    isAnimating = true;
    const textSection = document.querySelector('.hero-content');
    const trailerSection = document.querySelector('.hero-trailer-side');
    if (textSection && trailerSection) {
        textSection.classList.add('content-hidden');
        trailerSection.classList.add('content-hidden');
    }
    setTimeout(() => {
        const movie = heroMovies[currentSlide];
        document.getElementById('heroTitle').innerText = movie.title;
        document.getElementById('statRating').innerText = movie.rating;
        document.getElementById('statDate').innerText = movie.year;
        document.getElementById('statRuntime').innerText = movie.runtime;
        document.getElementById('heroDesc').innerText = movie.plot;
        clampHeroTitleHeight();
        const trailerFrame = document.getElementById('heroTrailerFrame');
        if (trailerFrame) {
            setHeroTrailerSource(trailerFrame, movie.trailerId, () => {
                if (typeof window.nextSlide === 'function') window.nextSlide();
            });
        }
        const dots = document.querySelectorAll('.dot');
        dots.forEach(d => d.classList.remove('active'));
        if(dots[currentSlide]) dots[currentSlide].classList.add('active');
        if (textSection && trailerSection) {
            textSection.classList.remove('content-hidden');
            trailerSection.classList.remove('content-hidden');
        }
        isAnimating = false;
    }, 400); 
}
function nextSlide() {
    if (isAnimating) return;
    currentSlide = (currentSlide + 1) % heroMovies.length;
    updateHeroUI();
}
function prevSlide() {
    if (isAnimating) return;
    currentSlide = (currentSlide - 1 + heroMovies.length) % heroMovies.length;
    updateHeroUI();
}
function goToSlide(index) {
    if (isAnimating || index === currentSlide) return;
    currentSlide = index;
    updateHeroUI();
}
 
function closeMovie() {
    const overlay = document.getElementById('movieOverlay');
    if(overlay) overlay.classList.remove('active');
    setTimeout(() => {
        const trailer = document.getElementById('maxTrailer');
        if(trailer) trailer.src = "";
    }, 400);
}
window.onclick = function(event) {
    let overlay = document.getElementById('movieOverlay');
    if (event.target == overlay) {
        closeMovie();
    }
}
function triggerPlay() {
    openMovie();

    // "Teleport" to the Plot Text
    setTimeout(() => {
        const plotElement = document.getElementById('statPlot');
        if (plotElement) {
            plotElement.scrollIntoView({ behavior: 'auto', block: 'center' });
            
            plotElement.style.transition = "color 0.2s";
            const oldColor = plotElement.style.color;
            plotElement.style.color = "#f96d00";
            
            setTimeout(() => {
                plotElement.style.color = oldColor || "#ccc";
            }, 800);
        }
    }, 50); 
}
function openRedirectModal() {
    const modal = document.getElementById('redirectModal');
    if(modal) {
        modal.classList.add('active'); 
    }
}

// This is the method that offs the menu
function closeRedirectModal() {
    const modal = document.getElementById('redirectModal');
    if(modal) {
        modal.classList.remove('active');
    }
}

// This handles the actual navigation
function proceedToIMDb() {
    const currentMovie = heroMovies[currentSlide];
    
    if (currentMovie && currentMovie.imdbId) {
        window.open(`https://www.imdb.com/title/${currentMovie.imdbId}/`, "_blank");
        closeRedirectModal();
    } else {
        alert("IMDb link not available for this title.");
    }
}

function dismissPageLoadingOverlay(overlayId = 'pageLoadingOverlay') {
    const overlay = document.getElementById(overlayId);
    if (!overlay || overlay.dataset.dismissed) return;

    overlay.dataset.dismissed = '1';

    const spinner = overlay.querySelector('.loading-spinner');
    const ring = overlay.querySelector('.loading-ring');
    const shownAt = Number(overlay.dataset.shownAt || performance.now());
    const minVisibleMs = 1100;
    const elapsed = performance.now() - shownAt;
    const waitForMinVisible = Math.max(0, minVisibleMs - elapsed);

    const beginCollapse = () => {
        if (spinner) spinner.classList.add('grow');

        setTimeout(() => {
            if (spinner) {
                spinner.classList.remove('grow');
                spinner.classList.add('collapse');
            }
            setTimeout(() => {
                overlay.classList.add('fade-out');
                setTimeout(() => {
                    overlay.style.display = 'none';
                }, 500);
            }, 350);
        }, 300);
    };

    setTimeout(() => {
        if (!ring) {
            beginCollapse();
            return;
        }

        let collapseStarted = false;
        const startOnce = () => {
            if (collapseStarted) return;
            collapseStarted = true;
            beginCollapse();
        };

        const fallbackTimer = setTimeout(startOnce, 800);
        ring.addEventListener('animationiteration', () => {
            clearTimeout(fallbackTimer);
            startOnce();
        }, { once: true });
    }, waitForMinVisible);
}

window.dismissPageLoadingOverlay = dismissPageLoadingOverlay;

// Keep movie source helpers available even if other scripts load later.
window.getMovieSource = window.getMovieSource || function() {
    return localStorage.getItem('movieSource') || 'api';
};

window.withMovieSource = window.withMovieSource || function(url) {
    const source = window.getMovieSource ? window.getMovieSource() : 'api';
    if (source !== 'api') return url;
    return `${url}${url.includes('?') ? '&' : '?'}source=api`;
};

window.__signalBrowseCriticalReady = function() {
    dismissPageLoadingOverlay();
};

function initBrowsePageOverlay() {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
    if (!isBrowsePage) return;

    const overlay = document.getElementById('pageLoadingOverlay');
    if (!overlay || overlay.dataset.overlayBound) return;
    overlay.dataset.overlayBound = '1';
    overlay.dataset.shownAt = overlay.dataset.shownAt || String(performance.now());

    // Fallback only: primary dismissal is now driven by critical-data-ready signals.
    setTimeout(() => dismissPageLoadingOverlay(), 7000);
}

document.addEventListener('DOMContentLoaded', async () => {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
    const pageOverlay = document.getElementById('pageLoadingOverlay');
    if (pageOverlay && !pageOverlay.dataset.shownAt) {
        pageOverlay.dataset.shownAt = String(performance.now());
    }

    initBrowsePageOverlay();

    const rowCalls = [
        { id: 'rowTrending', sort: 'rating_desc' },
        { id: 'rowPopular', sort: 'clicks_desc' },
        { id: 'rowNewest', sort: 'date_desc' },
        { id: 'rowAction', sort: 'rating_desc', opts: { genre: 'Action' } },
        { id: 'rowDrama', sort: 'rating_desc', opts: { genre: 'Drama' } },
        { id: 'rowComedy', sort: 'rating_desc', opts: { genre: 'Comedy' } },
        { id: 'rowSciFi', sort: 'rating_desc', opts: { genre: 'Sci-Fi' } },
        { id: 'rowThriller', sort: 'rating_desc', opts: { genre: 'Thriller' } },
        { id: 'rowAnimation', sort: 'rating_desc', opts: { genre: 'Animation' } },
        { id: 'rowAdventure', sort: 'rating_desc', opts: { genre: 'Adventure' } },
        { id: 'rowRomance', sort: 'rating_desc', opts: { genre: 'Romance' } },
        { id: 'rowCrime', sort: 'rating_desc', opts: { genre: 'Crime' } },
        { id: 'rowHorror', sort: 'rating_desc', opts: { genre: 'Horror' } },
        { id: 'rowMystery', sort: 'rating_desc', opts: { genre: 'Mystery' } },
        { id: 'rowFantasy', sort: 'rating_desc', opts: { genre: 'Fantasy' } },
        { id: 'rowFamily', sort: 'rating_desc', opts: { genre: 'Family' } },
        { id: 'rowRecentHits', sort: 'rating_desc', opts: { year: 2020 } },
        { id: 'rowDocumentary', sort: 'rating_desc', opts: { genre: 'Documentary' } },
        { id: 'rowHistoryEpic', sort: 'rating_desc', opts: { genre: 'History' } },
        { id: 'rowMusic', sort: 'rating_desc', opts: { genre: 'Music' } },
        { id: 'rowWar', sort: 'rating_desc', opts: { genre: 'War' } },
        { id: 'rowWestern', sort: 'rating_desc', opts: { genre: 'Western' } },
        { id: 'rowHiddenGems', sort: 'rating_desc', opts: { offset: 80 } },
        { id: 'rowLongest', sort: 'duration_desc' },
        { id: 'rowGrossing', sort: 'success_desc' },
        { id: 'rowBinge', sort: 'duration_desc', opts: { offset: 25 } }
    ];

    if (isBrowsePage) {
        try {
            await initPersonalRows();
        } catch (err) {
            console.warn('[Browse] initPersonalRows failed, continuing with discovery rows:', err);
        }
        if (window.__animeMode) {
            document.querySelectorAll('[data-browse-discovery="true"]').forEach(section => {
                section.style.display = 'none';
            });
            console.info('[Browse] anime mode active — movie discovery rows disabled');
        } else {
            await scheduleRowLoad(rowCalls);
            // In movie mode, critical rows are ready here; anime mode signals from animePage.js.
            if (window.__signalBrowseCriticalReady) {
                window.__signalBrowseCriticalReady();
            }
        }
    } else {
        rowCalls.forEach(call => fetchRow(call.id, call.sort, call.opts || {}));
    }

    setupMarquee();
});

function scheduleRowLoad(calls) {
    if (!Array.isArray(calls) || calls.length === 0) return Promise.resolve();

    const eagerCount = 3;
    const eagerPromises = calls.slice(0, eagerCount)
        .map(call => fetchRow(call.id, call.sort, call.opts || {}));

    const lazyCalls = calls.slice(eagerCount);
    if (lazyCalls.length === 0) return Promise.all(eagerPromises);

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const targetId = entry.target?.id;
                const match = lazyCalls.find(call => call.id === targetId);
                if (match) {
                    fetchRow(match.id, match.sort, match.opts || {});
                }
                obs.unobserve(entry.target);
            });
        }, { root: null, rootMargin: '200px 0px', threshold: 0.1 });

        lazyCalls.forEach(call => {
            const el = document.getElementById(call.id);
            if (el) observer.observe(el);
        });
        return Promise.all(eagerPromises);
    }

    lazyCalls.forEach((call, index) => {
        setTimeout(() => {
            fetchRow(call.id, call.sort, call.opts || {});
        }, index * 120);
    });

    return Promise.all(eagerPromises);
}

document.addEventListener('DOMContentLoaded', () => {
    initHeroPreferencesPanel();
    initHoverModalInteractions();
});

const TMDB_GENRE_NAME_TO_ID = {
    Action: 28,
    Adventure: 12,
    Animation: 16,
    Comedy: 35,
    Crime: 80,
    Documentary: 99,
    Drama: 18,
    Family: 10751,
    Fantasy: 14,
    History: 36,
    Horror: 27,
    Music: 10402,
    Mystery: 9648,
    Romance: 10749,
    'Sci-Fi': 878,
    Thriller: 53,
    War: 10752,
    Western: 37
};

function normalizeTmdbForRow(item) {
    const isTv = item.media_type === 'tv' || item.first_air_date !== undefined;
    return {
        ID: item.id,
        'Movie Name': item.title || item.name || item.original_name || 'Unknown',
        poster_full_url: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '/img/LOGO_Short.png',
        Poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '/img/LOGO_Short.png',
        Rating: item.vote_average ? item.vote_average.toFixed(1) : '--',
        Genre: Array.isArray(item.genre_ids) ? item.genre_ids.map(id => TMDB_GENRE_NAME_TO_ID[id] || '').filter(Boolean).join(', ') : '',
        Year: (item.release_date || item.first_air_date || '').slice(0, 4) || '----',
        Runtime: '-- min',
        Plot: item.overview || 'No plot summary available.',
        _type: isTv ? 'tv' : 'movie'
    };
}

async function fetchRow(containerId, sortType, options = {}) {
    if (window.__animeMode) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const {
        limit = 20,
        offset = 0,
        genre = '',
        year = 1900,
        actor = '',
        director = ''
    } = options;

    try {
        if (window.tmdbBuildUrl) {
            const page = Math.max(1, Math.floor(offset / 20) + 1);
            const params = {
                language: 'en-US',
                include_adult: false,
                page,
                with_original_language: 'en',
                sort_by: 'popularity.desc'
            };

            switch (sortType) {
                case 'rating_desc': params.sort_by = 'vote_average.desc'; break;
                case 'clicks_desc': params.sort_by = 'popularity.desc'; break;
                case 'date_desc': params.sort_by = 'release_date.desc'; break;
                case 'duration_desc': params.sort_by = 'runtime.desc'; break;
                case 'success_desc': params.sort_by = 'revenue.desc'; break;
                default: params.sort_by = 'popularity.desc';
            }

            params['vote_count.gte'] = 670;
            const tenYearsAgo = new Date();
            tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
            params['primary_release_date.gte'] = tenYearsAgo.toISOString().slice(0, 10);

            if (genre) {
                const genreId = TMDB_GENRE_NAME_TO_ID[genre] || genre;
                params.with_genres = genreId;
            }
            if (year && Number(year) > 1900) {
                params.primary_release_year = String(year);
            }

            const url = window.tmdbBuildUrl('/discover/movie', params);
            const res = await fetch(url);
            const data = await res.json();
            const movies = Array.isArray(data.results) ? data.results : [];
            container.innerHTML = movies.map(movie => createCard(normalizeTmdbForRow(movie))).join('');
            return;
        }

        const params = new URLSearchParams({
            sort: sortType,
            limit: String(limit),
            offset: String(offset),
            year: String(year)
        });

        if (genre) params.set('genre', genre);
        if (actor) params.set('actor', actor);
        if (director) params.set('director', director);

        const baseUrl = `/movies/library?${params.toString()}`;
        const source = window.getMovieSource ? window.getMovieSource() : 'local';
        const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
        const res = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
        const movies = await res.json();

        container.innerHTML = movies.map(movie => createCard(movie)).join('');
    } catch (err) {
        console.error('Error fetching row:', err);
    }
}

async function loadMyListRow() {
    const section = document.getElementById('myListRowSection');
    const container = document.getElementById('rowMyList');
    if (!section || !container) return;

    let rawList = [];
    try {
        rawList = JSON.parse(localStorage.getItem('myList') || '[]');
    } catch (e) {
        rawList = [];
    }

    // Support both legacy "id" entries and modern { id, type } entries.
    const savedItems = rawList.map(item =>
        typeof item === 'object' && item !== null ? item : { id: String(item), type: 'movie' }
    );

    const movieIds = savedItems
        .filter(item => (item.type || 'movie') === 'movie')
        .map(item => item.id)
        .slice(0, 12);

    if (movieIds.length === 0) {
        section.style.display = 'none';
        return;
    }

    const movies = await fetchMoviesByIds(movieIds);
    if (!movies || movies.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = movies.map(movie => createCard(movie)).join('');
    applyBrowseRowBg('myListRowSection');
}

async function loadMyPlaylistsRow() {
    const section = document.getElementById('myPlaylistsRowSection');
    const container = document.getElementById('rowMyPlaylists');
    // Keep as a no-op when this row is not present in current browse layout.
    if (!section || !container) return;

    try {
        const userUID = parseInt(localStorage.getItem('userUID'), 10) || 0;
        if (!userUID) {
            section.style.display = 'none';
            return;
        }

        const res = await fetch('/playlists');
        const playlists = await res.json();
        const owned = (playlists || []).filter(p => parseInt(p.ownerUID, 10) === userUID);

        if (!owned.length) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = owned.slice(0, 10).map(pl => `
            <a class="grid-card" href="/html/customPlaylists.html" aria-label="Open playlist ${pl.name || ''}">
                <img src="/img/LOGO_Short.png" alt="Playlist">
                <div class="card-meta">
                    <div class="card-title">${pl.name || 'Untitled Playlist'}</div>
                    <div class="card-sub">${(pl.movies || []).length} items</div>
                </div>
            </a>
        `).join('');
    } catch (err) {
        console.error('[Browse] Failed to load playlists row:', err);
        section.style.display = 'none';
    }
}

function buildContinueWatchingCard(row, tmdb) {
    const id = String(row.movie_id);
    const type = row.type === 'tv' ? 'tv' : 'movie';
    const title = tmdb.title || tmdb.name || 'Unknown';
    const rating = Number.isFinite(Number(tmdb.vote_average)) ? Number(tmdb.vote_average).toFixed(1) : '--';
    const year = (type === 'movie' ? tmdb.release_date : tmdb.first_air_date || tmdb.first_air_date) || '';
    const yearLabel = year ? String(year).slice(0, 4) : '----';
    const poster = tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : '/img/noposter.jpg';
    const targetUrl = `/html/movieInfo.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`;

    return `
        <article class="continue-watching-card">
            <button class="continue-watching-card-poster" type="button" aria-label="Continue watching ${title}" onclick="window.location.href='${targetUrl}'">
                <img src="${poster}" alt="${title} poster">
            </button>
            <div class="continue-watching-card-body">
                <div class="continue-watching-card-title">${title}</div>
                <div class="continue-watching-card-meta">
                    <span class="continue-watching-meta-item">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                        </svg>
                        <span>${rating}</span>
                    </span>
                    <span class="continue-watching-meta-item">${yearLabel}</span>
                    <span class="continue-watching-meta-item">${type === 'tv' ? 'TV' : 'Movie'}</span>
                </div>
            </div>
            <button class="continue-watching-play-btn" type="button" aria-label="Open ${title} details" onclick="window.location.href='${targetUrl}'">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
            </button>
        </article>
    `;
}

async function loadContinueWatching() {
    const section = document.getElementById('continueWatchingSection');
    const list = document.getElementById('continueWatchingList');
    if (!section || !list) return;

    section.style.display = 'none';
    list.innerHTML = '';

    const userUID = window.recommendationsSystem?.getActivityUID ? window.recommendationsSystem.getActivityUID() : localStorage.getItem('userUID');
    if (!userUID) return;

    try {
        const res = await fetch(`/activity/continueWatching?userUID=${encodeURIComponent(userUID)}`);
        if (!res.ok) throw new Error('Continue watching request failed');

        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) return;

        const fetches = rows.map(row => {
            const id = String(row.movie_id);
            const endpoint = row.type === 'tv'
                ? `/api/tmdb-proxy/tv/${encodeURIComponent(id)}`
                : `/api/tmdb-proxy/movie/${encodeURIComponent(id)}`;
            return fetch(endpoint)
                .then(response => {
                    if (!response.ok) throw new Error('TMDB request failed');
                    return response.json();
                })
                .then(tmdb => ({ row, tmdb }));
        });

        const settled = await Promise.allSettled(fetches);
        const cards = settled
            .filter(r => r.status === 'fulfilled' && r.value && r.value.tmdb)
            .map(r => buildContinueWatchingCard(r.value.row, r.value.tmdb));

        if (cards.length === 0) return;

        list.innerHTML = cards.join('');
        section.style.display = 'block';
    } catch (err) {
        section.style.display = 'none';
    }
}

async function initPersonalRows() {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
    if (!isBrowsePage) return;

    // My List & playlists load in all modes (filtered per mode inside each loader)
    await Promise.allSettled([loadMyListRow(), loadMyPlaylistsRow()]);
    await loadContinueWatching();

    if (window.__animeMode) return; // animePage.js handles history + recommended rows in anime mode

    // Movie mode only
    await Promise.allSettled([
        loadRecommendedRow(),
        loadHistoryRow(),
        loadBecauseYouWatchedRow(),
        //=====BECAUSE YOU LIKED THIS GENRE DEPRECATED====
        // loadTopGenreRow()
    ]);
}

// Sets the blurred poster backdrop on browse personal rows
function applyBrowseRowBg(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const bg = section.querySelector('.browse-row-bg');
    if (!bg) return;
    const img = section.querySelector('img');
    if (!img) return;
    const apply = () => {
        if (!img.src || img.src.endsWith('/')) return;
        bg.style.backgroundImage = `url('${img.src}')`;
        bg.classList.add('active');
    };
    if (img.complete && img.naturalWidth > 0) { apply(); }
    else { img.addEventListener('load', apply, { once: true }); }
}
window.applyBrowseRowBg = applyBrowseRowBg;

function mapTmdbMovieForCard(item) {
    if (!item || !item.id) return null;
    return {
        ID: item.id,
        'Movie Name': item.title || item.name || 'Unknown',
        poster_full_url: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '/img/LOGO_Short.png',
        Rating: item.vote_average ? item.vote_average.toFixed(1) : '--',
        release_date: item.release_date || item.first_air_date || '',
        _type: 'movie'
    };
}

// Seeds "Recommended for You" off TMDB's own /recommendations (falling back to /similar) for
// the user's most recently watched movie -- a real per-title signal instead of guessing from
// clicked genres. Anime mode has its own recommendation logic (animePage.js), so this only
// runs in movie mode. Falls back to the local genre+year engine if there's no watch history yet
// (new user) or the TMDB lookup comes back empty.
async function loadRecommendedRow() {
    const section = document.getElementById('recommendedSection');
    const container = document.getElementById('rowRecommended');
    if (!section || !container) return;
    if (window.__animeMode) return;

    let movies = [];

    try {
        const history = window.recommendationsSystem?.fetchActivityHistory
            ? await window.recommendationsSystem.fetchActivityHistory(5)
            : [];
        const seed = (history || []).find(h => (h.item_type || 'movie') === 'movie' && h.movie_id);
        if (seed) {
            // Cache-first via movieCache.db (falls back to /similar server-side on miss).
            const recRes = await fetch(`/api/movie-recommendations?tmdbId=${seed.movie_id}&type=movie`);
            const recData = recRes.ok ? await recRes.json() : null;
            movies = (recData?.results || []).map(mapTmdbMovieForCard).filter(Boolean);
        }
    } catch (e) {
        console.warn('[Recommended] TMDB-based seed failed, falling back:', e.message);
    }

    if (!movies.length && window.recommendationsSystem?.generateRecommendations) {
        movies = await window.recommendationsSystem.generateRecommendations(6);
    }

    if (!movies || movies.length === 0) {
        section.style.display = 'none';
        return;
    }
    container.innerHTML = movies.slice(0, 6).map(movie => createCard(movie)).join('');
    applyBrowseRowBg('recommendedSection');
}

// Genre rows built from localStorage click history (works from first movie click)
function isGenericTopGenreLabel(label) {
    const v = String(label || '').trim().toLowerCase();
    return v === 'animation' || v === 'anime' || v === 'tv movie' || v === 'family' || v === 'kids';
}

async function loadPersonalGenreRows() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}'); } catch(e) {}
    const genreClicks = prefs.genreClicks || {};
    const rankedGenres = Object.entries(genreClicks)
        .sort((a, b) => b[1] - a[1])
        .map(e => e[0]);
    const nonGeneric = rankedGenres.filter(g => !isGenericTopGenreLabel(g));
    const topGenres = [...nonGeneric, ...rankedGenres.filter(g => isGenericTopGenreLabel(g))].slice(0, 2);
    if (topGenres.length === 0) return;

    const rowIds = [
        { sId: 'topGenreRow1Section', tId: 'topGenreRow1Title', cId: 'rowForYouGenre1' },
        { sId: 'topGenreRow2Section', tId: 'topGenreRow2Title', cId: 'rowForYouGenre2' }
    ];
    for (let i = 0; i < topGenres.length; i++) {
        const genre = topGenres[i];
        const { sId, tId, cId } = rowIds[i];
        const section = document.getElementById(sId);
        const titleEl = document.getElementById(tId);
        const container = document.getElementById(cId);
        if (!section || !container) continue;
        if (titleEl) titleEl.textContent = `Because You Love ${genre}`;
        try {
            const baseUrl = `/movies/library?sort=rating_desc&limit=20&genre=${encodeURIComponent(genre)}`;
            const res = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
            const movies = await res.json();
            if (!movies || movies.length === 0) continue;
            section.style.display = 'block';
            container.innerHTML = movies.slice(0, 15).map(movie => createCard(movie)).join('');
        } catch(e) {}
    }
}

async function loadHistoryRow() {
    const section = document.getElementById('historyRowSection');
    const container = document.getElementById('rowHistory');
    if (!section || !container) return;

    let historyRows = [];
    if (window.recommendationsSystem?.fetchActivityHistory) {
        historyRows = await window.recommendationsSystem.fetchActivityHistory(12) || [];
    }
    if (historyRows.length === 0) return;

    const typeMap = Object.fromEntries(historyRows.map(h => [String(h.movie_id), h.item_type || 'movie']));
    const movieItems = historyRows.filter(h => (h.item_type || 'movie') === 'movie');
    const tvItems    = historyRows.filter(h => h.item_type === 'tv' || h.item_type === 'anime');
    const allCards = [];

    if (movieItems.length > 0) {
        const localMovies = await fetchMoviesByIds(movieItems.map(h => h.movie_id));
        localMovies.forEach(m => {
            m._type = typeMap[String(m.ID)] || 'movie';
            allCards.push({ sortKey: historyRows.findIndex(h => String(h.movie_id) === String(m.ID)), card: createCard(m) });
        });
    }
    for (const h of tvItems) {
        try {
            const res = await fetch(`/api/tmdb-proxy/tv/${h.movie_id}`);
            const tv = await res.json();
            if (tv && (tv.name || tv.title)) {
                const m = {
                    ID: h.movie_id,
                    'Movie Name': tv.name || tv.title,
                    poster_full_url: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : '/img/LOGO_Short.png',
                    Rating: tv.vote_average ? tv.vote_average.toFixed(1) : '--',
                    Genre: (tv.genres || []).map(g => g.name).join(', '),
                    Year: (tv.first_air_date || '').slice(0, 4),
                    _type: h.item_type || 'tv'
                };
                allCards.push({ sortKey: historyRows.findIndex(hr => String(hr.movie_id) === String(h.movie_id)), card: createCard(m) });
            }
        } catch(e) {}
    }
    if (allCards.length === 0) return;
    allCards.sort((a, b) => a.sortKey - b.sortKey);
    section.style.display = 'block';
    container.innerHTML = allCards.map(c => c.card).join('');
    applyBrowseRowBg('historyRowSection');
}

async function loadBecauseYouWatchedRow() {
    const section = document.getElementById('becauseYouWatchedSection');
    const container = document.getElementById('rowBecauseYouWatched');
    const titleEl = document.getElementById('becauseYouWatchedTitle');
    if (!section || !container) return;

    if (!window.recommendationsSystem?.fetchActivityHistory) {
        section.style.display = 'none';
        return;
    }

    const history = await window.recommendationsSystem.fetchActivityHistory(5);
    if (!history || history.length === 0) {
        section.style.display = 'none';
        return;
    }

    const isAnimeMode = window.__animeMode === true;
    const isAnimeEntry = (entry) => {
        const type = String(entry?.item_type || entry?.type || '').toLowerCase();
        const genre = String(entry?.genre || '').toLowerCase();
        return type === 'tv' || type === 'anime' || genre.includes('anime') || genre.includes('animation');
    };
    const isMovieEntry = (entry) => {
        const type = String(entry?.item_type || entry?.type || '').toLowerCase();
        const genre = String(entry?.genre || '').toLowerCase();
        if (type === 'movie' || type === 'film') return true;
        if (type === 'tv' || type === 'anime') return false;
        return !genre.includes('anime') && !genre.includes('animation');
    };

    const seed = history.find(entry => isAnimeMode ? isAnimeEntry(entry) : isMovieEntry(entry));
    if (!seed) {
        section.style.display = 'none';
        return;
    }

    if (titleEl) titleEl.textContent = `Because you watched "${seed.title || 'a recent film'}"`;

    // Use ALL seed genres (up to 4) — fetch per-genre then score by overlap count
    // so a movie must share multiple genres to rank high, avoiding unrelated hits
    const seedGenres = (seed.genre || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 4);
    if (seedGenres.length === 0) { section.style.display = 'none'; return; }

    try {
        const genreFetches = seedGenres.map(async g => {
            const baseUrl = `/movies/library?sort=rating_desc&limit=40&genre=${encodeURIComponent(g)}`;
            const url = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
            try { const r = await fetch(url); return r.ok ? await r.json() : []; }
            catch { return []; }
        });
        const genreResults = await Promise.all(genreFetches);

        // Score each movie by how many seed genres it appears in
        const scoreMap = new Map();
        for (const list of genreResults) {
            for (const m of list) {
                if (String(m.ID) === String(seed.movie_id)) continue;
                const key = String(m.ID);
                const entry = scoreMap.get(key) || { movie: m, score: 0 };
                entry.score += 1;
                scoreMap.set(key, entry);
            }
        }

        // Sort: most genre overlap first, then by rating
        let movies = [...scoreMap.values()]
            .sort((a, b) => b.score - a.score || parseFloat(b.movie.Rating || 0) - parseFloat(a.movie.Rating || 0))
            .map(e => e.movie);

        // If all genres returned 0 matches or seed only has 1 genre, accept any score; 
        // otherwise require at least 2 matching genres for better relevance
        if (seedGenres.length > 1) {
            const multiMatch = movies.filter(m => (scoreMap.get(String(m.ID))?.score || 0) >= 2);
            if (multiMatch.length >= 3) movies = multiMatch;
        }

        if (movies.length === 0) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        container.innerHTML = movies.slice(0, 15).map(movie => createCard(movie)).join('');
        applyBrowseRowBg('becauseYouWatchedSection');
    } catch (err) {
        section.style.display = 'none';
    }
}

// --- MARQUEE LOGIC ---
async function setupMarquee() {
    const marquee = document.getElementById('promoMarquee');
    if (!marquee) return;

    const baseUrl = `/movies/library?limit=20`;
    const source = window.getMovieSource ? window.getMovieSource() : 'local';
    const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
    const res = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
    const movies = await res.json();

    const combined = [...movies, ...movies];
    marquee.innerHTML = combined.map(m => `
        <div class="marquee-card">
            <img src="${m.poster_full_url}" alt="Poster">
        </div>
    `).join('');
}

function initHeroPreferencesPanel() {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
    if (!isBrowsePage) return;

    const tag = document.getElementById('heroTag');
    const panel = document.getElementById('heroPrefPanel');
    if (!tag || !panel) return;

    const PREFS_KEY = 'userPreferences';
    let hideTimer;

    const renderPanel = () => {
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        const genreClicks = prefs.genreClicks || {};
        const entries = Object.entries(genreClicks).sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            panel.innerHTML = '<span style="color:#888; font-size:0.85rem;">No genre history yet.</span>';
            return;
        }

        panel.innerHTML = entries.map(([genre, count]) => `
            <span class="hero-pref-chip" data-genre="${genre}">
                ${genre} <strong>${count}</strong>
                <button class="hero-pref-close" data-genre="${genre}" aria-label="Remove ${genre}">✕</button>
            </span>
        `).join('');
    };

    const showPanel = () => {
        clearTimeout(hideTimer);
        renderPanel();
        panel.classList.add('active');
    };

    const hidePanel = () => {
        hideTimer = setTimeout(() => {
            panel.classList.remove('active');
        }, 200);
    };

    tag.addEventListener('mouseenter', showPanel);
    tag.addEventListener('mouseleave', hidePanel);
    panel.addEventListener('mouseenter', showPanel);
    panel.addEventListener('mouseleave', hidePanel);

    panel.addEventListener('click', (event) => {
        const btn = event.target.closest('.hero-pref-close');
        if (!btn) return;

        const genre = btn.dataset.genre;
        if (!genre) return;

        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        if (prefs.genreClicks && prefs.genreClicks[genre] !== undefined) {
            delete prefs.genreClicks[genre];
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
            renderPanel();
        }
    });
}

// Fallback helpers: keep browse/personal pages working even if upstream sections were trimmed.
async function fetchMoviesByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const uniqueIds = Array.from(new Set(ids.map(id => String(id))));
    const requests = uniqueIds.map(id => {
        const baseUrl = `/movie/${id}`;
        const requestUrl = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
        return fetch(requestUrl).then(res => (res.ok ? res.json() : null)).catch(() => null);
    });
    const results = await Promise.allSettled(requests);
    return results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
}

function createCard(movie) {
    const year = movie.release_date ? String(movie.release_date).slice(0, 4) : (movie.Year || '----');
    const runtime = movie.Runtime || '-- min';
    const rating = movie.Rating || movie.imdb_rating || '--';
    const plot = movie.Plot || 'No plot summary available.';
    const genre = movie.Genre || '';

    const rawType = movie._type || movie.Type || 'movie';
    const cardType = (rawType === 'tv' || rawType === 'anime' || rawType === 'TV' || Number(rawType) === 2)
        ? 'tv'
        : 'movie';
    const isTV = cardType === 'tv';
    const tagLabel = isTV ? 'Anime' : 'Movie';
    const navUrl = isTV
        ? `movieInfo.html?id=${movie.ID}&type=tv`
        : `movieInfo.html?id=${movie.ID}&type=movie`;

    return `
        <div class="grid-card" data-id="${movie.ID}" data-title="${movie['Movie Name'] || ''}" data-year="${year}" data-runtime="${runtime}" data-rating="${rating}" data-plot="${plot}" data-genre="${genre}" data-type="${cardType}" onmouseenter="handleCardHover(this)" onmouseleave="handleCardLeave(this)">
            ${rating !== '--' ? `<span class="card-rating-badge"><span style="color:#f5c518;font-size:0.75rem">★</span>${rating}</span>` : ''}
            <img src="${movie.poster_full_url || '/img/LOGO_Short.png'}" loading="lazy" onclick="window.location.href='${navUrl}'" onerror="this.src='/img/LOGO_Short.png'">
            <div class="card-title-label">
                <div class="card-title-name">${movie['Movie Name'] || 'Unknown'}</div>
                <div class="card-title-tag">${tagLabel}</div>
            </div>
            <div class="card-hover-info">
                <div class="hover-preview">
                    <iframe class="card-trailer" title="Trailer" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
                </div>
                <div class="hover-meta">
                    <div class="hover-meta-title">${movie['Movie Name'] || 'Unknown'}</div>
                    <div class="hover-meta-stats">
                        <span>⭐ ${rating}</span>
                        <span>${year}</span>
                        <span>${runtime}</span>
                    </div>
                    <p class="hover-meta-desc">${plot}</p>
                    <div class="hover-meta-actions">
                        <button class="hover-play" onclick="window.location.href='${navUrl}'">▶</button>
                        <a class="hover-info" href="${navUrl}">More Info</a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function closeHoverModal() {
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer) return;

    if (window.__hoverModalShowTimer) {
        clearTimeout(window.__hoverModalShowTimer);
        window.__hoverModalShowTimer = null;
    }
    if (window.__hoverModalHideTimer) {
        clearTimeout(window.__hoverModalHideTimer);
        window.__hoverModalHideTimer = null;
    }

    window.__hoverModalHovered = false;
    window.__hoverModalLocked = false;
    window.__hoverCardTarget = null;
    modal.classList.remove('active');
    modalTrailer.src = '';
}

window.handleCardHover = async function(card) {
    if (!card) return;
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer) return;

    // Keep current popup data stable while open until user clicks outside.
    if (window.__hoverModalLocked && modal.classList.contains('active') && window.__hoverCardTarget !== card) {
        return;
    }

    if (window.__hoverModalHideTimer) {
        clearTimeout(window.__hoverModalHideTimer);
        window.__hoverModalHideTimer = null;
    }
    if (window.__hoverModalShowTimer) {
        clearTimeout(window.__hoverModalShowTimer);
        window.__hoverModalShowTimer = null;
    }

    window.__hoverCardTarget = card;
    window.__hoverModalShowTimer = setTimeout(async () => { // 3-second delay before popup shows
        if (window.__hoverCardTarget !== card) return; // cursor moved away before delay elapsed

        const title = card.dataset?.title || card.getAttribute('data-title') || 'Title';
        const year = card.dataset?.year || card.getAttribute('data-year') || '----';
        const runtime = card.dataset?.runtime || card.getAttribute('data-runtime') || '-- min';
        const rating = card.dataset?.rating || card.getAttribute('data-rating') || '--';
        const plot = card.dataset?.plot || card.getAttribute('data-plot') || 'No plot summary available.';
        const movieId = card.dataset?.id || card.getAttribute('data-id') || '';
        const cardType = card.dataset?.type || card.getAttribute('data-type') || 'movie';

        const titleEl = document.getElementById('hoverModalTitle');
        const ratingEl = document.getElementById('hoverModalRating');
        const yearEl = document.getElementById('hoverModalYear');
        const runtimeEl = document.getElementById('hoverModalRuntime');
        const descEl = document.getElementById('hoverModalDesc');
        const moreInfo = document.getElementById('hoverModalMoreInfo');

        if (titleEl) titleEl.textContent = title;
        if (ratingEl) ratingEl.textContent = `⭐ ${rating}`;
        if (yearEl) yearEl.textContent = year;
        if (runtimeEl) runtimeEl.textContent = runtime;
        if (descEl) descEl.textContent = plot;
        if (moreInfo) moreInfo.href = movieId ? `movieInfo.html?id=${movieId}&type=${cardType}` : 'movieInfo.html';

        modal.classList.add('active');
        window.__hoverModalLocked = true;

        const cleanupHoverTrailer = () => {
            clearHoverTrailerMonitor();
            modalTrailer.src = '';
        };

        if (card.dataset.trailerId) {
            setHoverTrailerSource(modalTrailer, [card.dataset.trailerId], cleanupHoverTrailer);
            return;
        }

        if (!window.fetchYTIds) return;

        try {
            const keys = await window.fetchYTIds(`${title} ${year}`);
            if (window.__hoverCardTarget !== card || !modal.classList.contains('active')) return;
            if (keys && keys.length > 0) {
                setHoverTrailerSource(modalTrailer, keys, cleanupHoverTrailer);
            }
        } catch (err) {
            console.warn('Trailer fetch failed:', err);
            cleanupHoverTrailer();
        }
    }, 3000);
};

window.handleCardLeave = function(card) {
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer) return;

    if (window.__hoverModalLocked && modal.classList.contains('active')) {
        return;
    }

    if (window.__hoverCardTarget === card) {
        window.__hoverCardTarget = null;
    }
    if (window.__hoverModalShowTimer) {
        clearTimeout(window.__hoverModalShowTimer);
        window.__hoverModalShowTimer = null;
    }
};

function initHoverModalInteractions() {
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer || window.__hoverModalInteractionsInit) return;
    window.__hoverModalInteractionsInit = true;

    modal.addEventListener('mouseenter', () => {
        window.__hoverModalHovered = true;
    });

    modal.addEventListener('mouseleave', () => {
        window.__hoverModalHovered = false;
    });

    document.addEventListener('pointerdown', (event) => {
        if (!modal.classList.contains('active')) return;
        if (modal.contains(event.target)) return;
        closeHoverModal();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('active')) {
            closeHoverModal();
        }
    });
}

// ── AUTH HELPERS ───────────────────────────────────────────────────────────────

function safeReload() {
    location.reload();
}

window.showLimitToast = function(message) {
    const existing = document.querySelector('.limit-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'limit-toast';
    toast.innerHTML = `<span>${message}</span><div class="toast-progress"></div>`;
    document.body.appendChild(toast);

    const progressBar = toast.querySelector('.toast-progress');
    if (progressBar) progressBar.style.animation = 'progressShrink 3s linear forwards';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = '0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

window.showLongToast = function(message, durationMs = 8000) {
    const existing = document.querySelector('.limit-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'limit-toast';
    toast.innerHTML = `<span>${message}</span><div class="toast-progress"></div>`;
    document.body.appendChild(toast);

    const progressBar = toast.querySelector('.toast-progress');
    if (progressBar) progressBar.style.animation = `progressShrink ${durationMs / 1000}s linear forwards`;

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = '0.5s';
        setTimeout(() => toast.remove(), 500);
    }, durationMs);
}

window.persistUserStats = function () {
    const username = localStorage.getItem('username');
    const userUID = localStorage.getItem('userUID');
    if (!username || !userUID) return;
    const token = localStorage.getItem('authToken');
    if (!token) return;

    const payload = {
        username,
        userUID: parseInt(userUID, 10),
        userEmail: localStorage.getItem('userEmail') || '',
        userTier: localStorage.getItem('userTier') || 'Free',
        userLanguage: localStorage.getItem('userLanguage') || 'en',
        searchCount: parseInt(localStorage.getItem('searchCount') || '0', 10),
        viewCount: parseInt(localStorage.getItem('viewCount') || '0', 10),
        allUIDs: JSON.parse(localStorage.getItem('allUIDs') || '[]')
    };

    fetch('/users', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    }).catch(err => console.error('User stats save error:', err));
};

window.logout = function () {
    window.persistUserStats();
    const guestUID = localStorage.getItem('guestUID');
    localStorage.clear();
    if (guestUID) localStorage.setItem('guestUID', guestUID);
    localStorage.removeItem('loginCode');
    safeReload();
};

// ── SIGN-UP MODAL ─────────────────────────────────────────────────────────────

function ensureSignupModal() {
    if (document.getElementById('signupModal')) return;
    const modal = document.createElement('div');
    modal.id = 'signupModal';
    modal.className = 'signup-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="signup-box">
            <div class="signup-close" onclick="closeSignupModal()">✕</div>
            <h2>Welcome to Legion Space</h2>
            <p class="signup-subtitle">Create your free account to start watching.</p>
            <form onsubmit="handleSignup(event)">
                <div class="input-group">
                    <input type="text" id="signupUser" required placeholder=" ">
                    <label>Username</label>
                </div>
                <div class="input-group">
                    <input type="email" id="signupEmail" required placeholder=" ">
                    <label>Email Address</label>
                </div>
                <div class="input-group">
                    <input type="password" id="signupPassword" required placeholder=" ">
                    <label>Password</label>
                </div>
                <button type="submit" class="btn-signup">Create Account</button>
            </form>
        </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeSignupModal(); });
    document.body.appendChild(modal);
}

window.openSignupModal = function () {
    const dropdown = document.getElementById('accountDropdown');
    if (dropdown) dropdown.classList.remove('active');
    ensureSignupModal();
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.style.cssText = 'display:flex; position:fixed; top:0; left:0; width:100vw; height:100vh; justify-content:center; align-items:center; z-index:10000; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px);';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
};

window.closeSignupModal = function () {
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.cssText = 'display:none;';
        document.body.style.overflow = 'auto';
    }
};

window.handleSignup = async function (e) {
    e.preventDefault();
    const username = (document.getElementById('signupUser') || {}).value || 'Guest';
    const email = (document.getElementById('signupEmail') || {}).value || '';
    const password = (document.getElementById('signupPassword') || {}).value || '';
    const tier = 'Free';
    const userLanguage = localStorage.getItem('userLanguage') || 'en';

    const btn = document.querySelector('.btn-signup');
    if (btn) { btn.textContent = 'Creating Account…'; btn.disabled = true; btn.style.opacity = '0.7'; }

    try {
        const res = await fetch('/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, userEmail: email, userTier: tier, userPassword: password, userLanguage, guestAccountUID: localStorage.getItem('guestUID') || null })
        });

        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            showLimitToast(msg.error || 'Registration failed');
            if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; btn.style.opacity = '1'; }
            return;
        }

        const result = await res.json();
        const user = result.user || result;
        if (result.token) localStorage.setItem('authToken', result.token);
        if (typeof user.loginCode !== 'undefined' && user.loginCode !== null) {
            localStorage.setItem('loginCode', user.loginCode);
        } else {
            localStorage.removeItem('loginCode');
        }
        localStorage.setItem('username', user.username || username);
        localStorage.setItem('userUID', String(user.userUID || 0));
        if (user.accountUID) {
            localStorage.setItem('guestUID', String(user.accountUID));
        }
        localStorage.setItem('userEmail', user.userEmail || email);
        localStorage.setItem('userTier', user.userTier || tier);
        localStorage.setItem('userLanguage', user.userLanguage || userLanguage);
        localStorage.setItem('is_guest_local', String(user.is_guest === 1 ? 1 : 0));
        localStorage.setItem('searchCount', '0');
        localStorage.setItem('viewCount', '0');
        localStorage.setItem('allUIDs', JSON.stringify(user.allUIDs || []));
    } catch (err) {
        showLimitToast('Registration failed');
        if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; btn.style.opacity = '1'; }
        return;
    }

    closeSignupModal();
    sessionStorage.setItem('greeted', 'true');
    safeReload();
};

// ── SIGN-IN MODAL ─────────────────────────────────────────────────────────────

function ensureSignInModal() {
    if (document.getElementById('signInModal')) return;
    const modal = document.createElement('div');
    modal.id = 'signInModal';
    modal.className = 'signup-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="signup-box">
            <div class="signup-close" onclick="closeSignInModal()">✕</div>
            <h2>Welcome Back</h2>
            <p class="signup-subtitle">Sign in with email/password or login code.</p>
            <form onsubmit="handleSignIn(event)">
                <div class="input-group">
                    <input type="email" id="signInEmail" placeholder=" ">
                    <label>Email Address</label>
                </div>
                <div class="input-group">
                    <input type="password" id="signInPassword" placeholder=" ">
                    <label>Password</label>
                </div>
                <div class="divider">──────── OR ────────</div>
                <div class="input-group">
                    <input type="text" id="signInCode" placeholder="Enter your 10-character login code">
                    <label>Login Code</label>
                </div>
                <button type="submit" class="btn-signup">Sign In</button>
            </form>
        </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeSignInModal(); });
    document.body.appendChild(modal);
}

window.openSignInModal = function () {
    const dropdown = document.getElementById('accountDropdown');
    if (dropdown) dropdown.classList.remove('active');
    ensureSignInModal();
    const modal = document.getElementById('signInModal');
    if (modal) {
        modal.style.cssText = 'display:flex; position:fixed; top:0; left:0; width:100vw; height:100vh; justify-content:center; align-items:center; z-index:10000; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px);';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
};

window.closeSignInModal = function () {
    const modal = document.getElementById('signInModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.cssText = 'display:none;';
        document.body.style.overflow = 'auto';
    }
};

/* ─────────────────────────────────────────────────────────────────────
   MOBILE LOGO INJECTION: Insert logo into navbar on mobile
   ───────────────────────────────────────────────────────────────────── */
function injectLogoIntoNavbar() {
    const sidebar = document.querySelector('.left-sidebar.bottom-sidebar');
    const navbar = document.querySelector('nav.navbar');
    if (!sidebar || !navbar) return;

    const logoWrap = sidebar.querySelector('.sidebar-logo-wrap');
    if (!logoWrap) return;

    const existingNavLogo = navbar.querySelector('.mobile-navbar-logo');
    const isMobile = window.innerWidth <= 620;

    if (isMobile && !existingNavLogo) {
        // Clone the logo and insert it into navbar
        const logoClone = logoWrap.cloneNode(true);
        logoClone.classList.add('mobile-navbar-logo');
        logoClone.style.display = 'flex';
        logoClone.style.position = 'static';
        logoClone.style.top = 'auto';
        logoClone.style.left = 'auto';
        logoClone.style.zIndex = 'auto';
        logoClone.style.width = 'auto';
        logoClone.style.height = 'auto';
        logoClone.style.padding = '12px 16px';
        logoClone.style.border = 'none';
        logoClone.style.background = 'transparent';
        logoClone.style.flexShrink = '0';
        navbar.insertBefore(logoClone, navbar.firstChild);
    } else if (!isMobile && existingNavLogo) {
        // Remove logo from navbar when viewport > 620px
        existingNavLogo.remove();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    injectLogoIntoNavbar();
    window.addEventListener('resize', injectLogoIntoNavbar);
});

function bindHeroClickToPlay() {
    const hero = document.getElementById('heroSection');
    if (!hero) return;

    hero.addEventListener('click', (event) => {
        const blocked = event.target.closest('.slider-arrow, .slider-indicators, .dot, #heroTag, #heroPrefPanel, .hero-pref-chip, .btn-info, .btn-play, .hero-trailer-side, a');
        if (blocked) return;
        if (typeof window.triggerPlay === 'function') {
            window.triggerPlay();
        }
    });
}

document.addEventListener('DOMContentLoaded', bindHeroClickToPlay);

window.handleSignIn = async function (e) {
    e.preventDefault();
    const userEmail = ((document.getElementById('signInEmail') || {}).value || '').trim().toLowerCase();
    const userPassword = (document.getElementById('signInPassword') || {}).value || '';
    const loginCode = ((document.getElementById('signInCode') || {}).value || '').trim();

    const payload = {};
    if (loginCode) {
        payload.loginCode = loginCode;
    } else if (userEmail && userPassword) {
        payload.userEmail = userEmail;
        payload.userPassword = userPassword;
    } else {
        showLimitToast('Please enter either email/password or a login code.');
        return;
    }

    try {
        const res = await fetch('/users/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            showLimitToast(error.error || 'Invalid sign-in credentials');
            return;
        }

        const result = await res.json();
        const user = result.user || result;
        if (result.token) localStorage.setItem('authToken', result.token);
        if (typeof user.loginCode !== 'undefined' && user.loginCode !== null) {
            localStorage.setItem('loginCode', user.loginCode);
        } else {
            localStorage.removeItem('loginCode');
        }
        localStorage.removeItem('guestUID');
        if (user.accountUID) {
            localStorage.setItem('accountUID', String(user.accountUID));
        } else {
            localStorage.removeItem('accountUID');
        }
        localStorage.setItem('username', user.username || '');
        localStorage.setItem('userUID', String(user.userUID || 0));
        localStorage.setItem('userEmail', user.userEmail || userEmail);
        localStorage.setItem('userTier', user.userTier || 'Free');
        localStorage.setItem('userLanguage', user.userLanguage || (localStorage.getItem('userLanguage') || 'en'));
        localStorage.setItem('searchCount', String(user.searchCount || 0));
        localStorage.setItem('viewCount', String(user.viewCount || 0));
        localStorage.setItem('allUIDs', JSON.stringify(user.allUIDs || []));
        localStorage.setItem('is_guest_local', String(user.is_guest === 1 ? 1 : 0));

        closeSignInModal();
        safeReload();
    } catch (err) {
        console.error('Sign-in error:', err);
        showLimitToast('Sign-in failed');
    }
};

// ── SETTINGS MODAL & PREFS ─────────────────────────────────────────────────────

window.openSettings = function () {
    if (!localStorage.getItem('username')) {
        showLimitToast('⚠️ Sign in to access settings!');
        return;
    }
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('active');
        loadCurrentSettings();
    }
};

window.closeSettings = function () {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('active');
};

// ── WATCH2GETHER (v1: friend-code invite + accept/decline, no sync yet) ────────
window.openWatch2GetherModal = async function () {
    if (!localStorage.getItem('username')) {
        showLimitToast('⚠️ Sign in to use Watch2Gether!');
        return;
    }
    const modal = document.getElementById('watch2getherModal');
    if (!modal) return;
    modal.classList.add('active');

    const codeInput = document.getElementById('watch2getherOwnCode');
    const token = localStorage.getItem('authToken');
    if (codeInput && token) {
        try {
            const res = await fetch('/users/watch2gether-code', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = res.ok ? await res.json() : null;
            codeInput.value = data?.code || 'Could not load code';
        } catch (e) {
            codeInput.value = 'Could not load code';
        }
    }

    await _w2gRenderHostingStatus();
    _w2gLoadFriends();
};

// Shared by the friends list and the live participants chips. `img.onerror` swaps in the
// letter fallback so a corrupt/unreadable data URI never leaves a broken-image icon on screen.
function _w2gAvatarHtml(profilePic, username, sizeClass) {
    const cls = sizeClass || '';
    const letter = notifEscapeHtml((username || '?')[0].toUpperCase());
    if (!profilePic) {
        return `<div class="w2g-avatar-fallback ${cls}">${letter}</div>`;
    }
    return `<img class="w2g-avatar ${cls}" src="${notifEscapeHtml(profilePic)}" alt=""
             onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'w2g-avatar-fallback ${cls}', textContent: '${letter}' }))">`;
}

// Shared by the modal's "Currently Hosting" card and the persistent host bar -- a participant
// chip with a Kick button and a "Give" (control) button, usable even when nobody requested it.
function _w2gParticipantChipHtml(sessionId, p, controlOwner) {
    const hasControl = controlOwner === p.userUID;
    const controlBtn = hasControl
        ? `<span class="w2g-chip-label">In control</span>`
        : `<button class="w2g-chip-give" title="Give ${notifEscapeHtml(p.username)} control" onclick="grantWatch2GetherControlDirect('${sessionId}','${p.userUID}')">Give</button>`;
    return `
        <span class="w2g-chip">
            ${_w2gAvatarHtml(p.profilePic, p.username)}
            <span class="w2g-chip-name">${notifEscapeHtml(p.username)}</span>
            ${controlBtn}
            <button class="w2g-chip-kick" title="Remove ${notifEscapeHtml(p.username)}" onclick="kickWatch2GetherParticipant('${sessionId}','${p.userUID}')">&times;</button>
        </span>
    `;
}

window.grantWatch2GetherControlDirect = async function (sessionId, granteeUID) {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        const res = await fetch(`/watch2gether/session/${sessionId}/grant-control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ granteeUID })
        });
        if (!res.ok) {
            showLimitToast('⚠️ Could not grant control.');
            return;
        }
        showLimitToast('They have control for 60 seconds.');
        _w2gRenderHostingStatus();
        _w2gRenderHostBar();
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
};

// Returns { sessionId, participants, controlOwner } for the session currently being hosted, or
// null if not hosting -- shared by every UI surface (modal card, host bar, friends lists) that
// needs to know who's already in the session.
async function _w2gGetActiveSessionInfo() {
    const sessionId = localStorage.getItem('w2gHostingSessionId');
    const token = localStorage.getItem('authToken');
    if (!sessionId || !token) return null;
    try {
        const res = await fetch(`/watch2gether/session/${sessionId}/state`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return null;
        const data = await res.json();
        return { sessionId, participants: data.participants || [], controlOwner: data.controlOwner };
    } catch (e) {
        return null;
    }
}

async function _w2gRenderHostingStatus() {
    const statusRow = document.getElementById('watch2getherHostingStatus');
    if (!statusRow) return;
    if (!localStorage.getItem('w2gHostingSessionId') || !localStorage.getItem('authToken')) {
        statusRow.innerHTML = '';
        return;
    }

    const info = await _w2gGetActiveSessionInfo();
    const participants = info?.participants || [];
    const chips = participants.map(p => _w2gParticipantChipHtml(info.sessionId, p, info.controlOwner)).join('')
        || `<span class="w2g-friend-status">Nobody has joined yet.</span>`;

    statusRow.innerHTML = `
        <div class="w2g-live-card">
            <div class="w2g-live-head">
                <span class="w2g-live-dot"></span>
                <span class="w2g-live-title">Currently Hosting</span>
            </div>
            <div class="w2g-participants">${chips}</div>
            <button class="btn-small" onclick="stopWatch2GetherHosting(); closeWatch2GetherModal();">Stop Hosting</button>
        </div>
    `;
}

window.kickWatch2GetherParticipant = async function (sessionId, targetUID) {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        const res = await fetch(`/watch2gether/session/${sessionId}/kick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ targetUID })
        });
        if (!res.ok) {
            showLimitToast('⚠️ Could not remove them.');
            return;
        }
        showLimitToast('Removed from the session.');
        _w2gRenderHostingStatus();
        _w2gRenderHostBar();
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
};

// ── Persistent host bar -- like the viewer's "Watching along with your friend" status bar,
// but for the host: shows while `w2gHostingSessionId` is set, on every page, not just the modal.
let _w2gHostBarEl = null;

function _w2gEnsureHostBar() {
    if (_w2gHostBarEl) return _w2gHostBarEl;
    const el = document.createElement('div');
    el.id = 'w2gHostBar';
    el.className = 'w2g-hostbar';
    el.innerHTML = `
        <div class="w2g-hostbar-head" onclick="document.getElementById('w2gHostBar').classList.toggle('expanded')">
            <span class="w2g-live-dot"></span>
            <span class="w2g-hostbar-title">Hosting Watch2Gether</span>
            <span class="w2g-hostbar-count" id="w2gHostBarCount">0</span>
        </div>
        <div class="w2g-hostbar-body" id="w2gHostBarBody"></div>
    `;
    document.body.appendChild(el);
    _w2gHostBarEl = el;
    return el;
}

async function _w2gRenderHostBar() {
    if (!localStorage.getItem('w2gHostingSessionId') || !localStorage.getItem('authToken')) {
        if (_w2gHostBarEl) { _w2gHostBarEl.remove(); _w2gHostBarEl = null; }
        return;
    }
    _w2gEnsureHostBar();
    const info = await _w2gGetActiveSessionInfo();
    if (!info) return;

    const countEl = document.getElementById('w2gHostBarCount');
    if (countEl) countEl.textContent = String(info.participants.length);

    const body = document.getElementById('w2gHostBarBody');
    if (!body) return;
    const chips = info.participants.map(p => _w2gParticipantChipHtml(info.sessionId, p, info.controlOwner)).join('')
        || `<span class="w2g-friend-status">Waiting for someone to join...</span>`;
    body.innerHTML = `<div class="w2g-participants">${chips}</div><button class="btn-small" onclick="stopWatch2GetherHosting()">Stop Hosting</button>`;
}

// Steam-style: online/offline grouped with a header, status shown as a corner badge on the
// avatar + a colored name rather than a full separate status line per row.
function _w2gFriendRowHtml(f, inSessionUIDs) {
    const inSession = !!inSessionUIDs && inSessionUIDs.has(String(f.userUID));
    const statusLabel = f.online ? 'Online' : (f.lastSeen ? 'Last online ' + notifTimeAgo(f.lastSeen) : 'Offline');
    return `
        <div class="w2g-friend-row${f.online ? '' : ' offline'}">
            <div class="w2g-avatar-badge">
                ${_w2gAvatarHtml(f.profilePic, f.username)}
                <span class="w2g-status-dot${f.online ? ' online' : ''}"></span>
            </div>
            <div class="w2g-friend-info">
                <span class="w2g-friend-name${f.online ? ' online' : ''}">${notifEscapeHtml(f.username)}</span>
                <span class="w2g-friend-status">${statusLabel}</span>
            </div>
            <button class="btn-small" ${inSession ? 'disabled' : ''} onclick="inviteFriendToWatch2Gether('${f.userUID}')">${inSession ? 'In Session' : 'Invite'}</button>
        </div>
    `;
}

async function _w2gLoadFriends() {
    const list = document.getElementById('watch2getherFriendsList');
    const token = localStorage.getItem('authToken');
    if (!list || !token) return;
    try {
        const [friendsRes, sessionInfo] = await Promise.all([
            fetch('/users/friends', { headers: { 'Authorization': `Bearer ${token}` } }),
            _w2gGetActiveSessionInfo()
        ]);
        const data = friendsRes.ok ? await friendsRes.json() : { friends: [] };
        const friends = data.friends || [];
        const inSessionUIDs = new Set((sessionInfo?.participants || []).map(p => String(p.userUID)));
        if (!friends.length) {
            list.innerHTML = `<p class="setting-hint">No friends yet -- add one with their code above.</p>`;
            return;
        }
        const online = friends.filter(f => f.online);
        const offline = friends.filter(f => !f.online);
        let html = '';
        if (online.length) {
            html += `<div class="w2g-group-header">Online Friends (${online.length})</div>`;
            html += online.map(f => _w2gFriendRowHtml(f, inSessionUIDs)).join('');
        }
        if (offline.length) {
            html += `<div class="w2g-group-header">Offline (${offline.length})</div>`;
            html += offline.map(f => _w2gFriendRowHtml(f, inSessionUIDs)).join('');
        }
        list.innerHTML = html;
    } catch (e) {
        list.innerHTML = `<p class="setting-hint">Could not load friends.</p>`;
    }
}

window.inviteFriendToWatch2Gether = async function (friendUID) {
    await _w2gSendInvite({ friendUIDs: [friendUID] });
};

window.addWatch2GetherFriend = async function () {
    const input = document.getElementById('watch2getherAddFriendCode');
    const friendCode = (input?.value || '').trim();
    if (!friendCode) {
        showLimitToast('⚠️ Enter their code first.');
        return;
    }
    const token = localStorage.getItem('authToken');
    if (!token) {
        showLimitToast('⚠️ Sign in to use Watch2Gether!');
        return;
    }
    try {
        const res = await fetch('/users/friends/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ friendCode })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showLimitToast(`⚠️ ${data.error || 'Could not send friend request.'}`);
            return;
        }
        showLimitToast(`✅ Friend request sent to ${data.targetUsername || 'them'}!`);
        if (input) input.value = '';
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
};

window.respondFriendRequest = async function (notificationId, accept) {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        const res = await fetch('/users/friends/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ notificationId, accept })
        });
        if (!res.ok) {
            showLimitToast('⚠️ Could not respond to friend request.');
            return;
        }
        showLimitToast(accept ? '✅ Friend added!' : 'Request declined.');
        window.fetchNotifications?.();
        _w2gLoadFriends();
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
};

// Periodic presence ping so friends' "online now" status is actually meaningful.
let _w2gHeartbeatStarted = false;
function _w2gEnsureHeartbeat() {
    if (_w2gHeartbeatStarted) return;
    _w2gHeartbeatStarted = true;
    const ping = () => {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        fetch('/users/heartbeat', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }).catch(() => {});
    };
    ping();
    setInterval(ping, 60 * 1000);
}
if (localStorage.getItem('authToken')) _w2gEnsureHeartbeat();

// ── Floating Friends overlay (Shift+Tab) -- Steam-style, freely draggable ──────
let _floatingFriendsEl = null;
let _floatingFriendsDragState = null;
let _floatingFriendsInterval = null;

function _ensureFloatingFriendsPanel() {
    if (_floatingFriendsEl) return _floatingFriendsEl;
    const el = document.createElement('div');
    el.id = 'w2gFloatingFriends';
    el.innerHTML = `
        <div class="w2g-float-header" id="w2gFloatHeader">
            <span>Friends</span>
            <button class="w2g-float-close" onclick="toggleFriendsOverlay(false)">&times;</button>
        </div>
        <div class="w2g-float-body" id="w2gFloatBody">
            <p class="setting-hint">Loading...</p>
        </div>
    `;
    document.body.appendChild(el);

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('w2gFloatingPos') || 'null'); } catch (e) {}
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        el.style.left = saved.left + 'px';
        el.style.top = saved.top + 'px';
        el.style.right = 'auto';
    }

    const header = el.querySelector('#w2gFloatHeader');
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.w2g-float-close')) return;
        const rect = el.getBoundingClientRect();
        _floatingFriendsDragState = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        el.style.right = 'auto';
        document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!_floatingFriendsDragState) return;
        const x = Math.min(Math.max(0, e.clientX - _floatingFriendsDragState.offsetX), window.innerWidth - el.offsetWidth);
        const y = Math.min(Math.max(0, e.clientY - _floatingFriendsDragState.offsetY), window.innerHeight - el.offsetHeight);
        el.style.left = x + 'px';
        el.style.top = y + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!_floatingFriendsDragState) return;
        _floatingFriendsDragState = null;
        document.body.style.userSelect = '';
        const rect = el.getBoundingClientRect();
        localStorage.setItem('w2gFloatingPos', JSON.stringify({ left: rect.left, top: rect.top }));
    });

    _floatingFriendsEl = el;
    return el;
}

async function _floatingFriendsRender() {
    const body = document.getElementById('w2gFloatBody');
    const token = localStorage.getItem('authToken');
    if (!body || !token) return;
    try {
        const [friendsRes, sessionInfo] = await Promise.all([
            fetch('/users/friends', { headers: { 'Authorization': `Bearer ${token}` } }),
            _w2gGetActiveSessionInfo()
        ]);
        const data = friendsRes.ok ? await friendsRes.json() : { friends: [] };
        const friends = data.friends || [];
        const inSessionUIDs = new Set((sessionInfo?.participants || []).map(p => String(p.userUID)));
        if (!friends.length) {
            body.innerHTML = `<p class="setting-hint">No friends yet -- add one from the Watch2Gether menu.</p>`;
            return;
        }
        const online = friends.filter(f => f.online);
        const offline = friends.filter(f => !f.online);
        let html = '';
        if (online.length) {
            html += `<div class="w2g-group-header">Online Friends (${online.length})</div>`;
            html += online.map(f => _w2gFriendRowHtml(f, inSessionUIDs)).join('');
        }
        if (offline.length) {
            html += `<div class="w2g-group-header">Offline (${offline.length})</div>`;
            html += offline.map(f => _w2gFriendRowHtml(f, inSessionUIDs)).join('');
        }
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<p class="setting-hint">Could not load friends.</p>`;
    }
}

window.toggleFriendsOverlay = function (force) {
    if (!localStorage.getItem('authToken')) return;
    const el = _ensureFloatingFriendsPanel();
    const show = force !== undefined ? force : !el.classList.contains('active');
    el.classList.toggle('active', show);
    if (show) {
        _floatingFriendsRender();
        if (!_floatingFriendsInterval) _floatingFriendsInterval = setInterval(_floatingFriendsRender, 15000);
    } else if (_floatingFriendsInterval) {
        clearInterval(_floatingFriendsInterval);
        _floatingFriendsInterval = null;
    }
};

function _ensureShortcutsHelper() {
    if (document.getElementById('w2gShortcutsHelper')) return;
    const el = document.createElement('div');
    el.id = 'w2gShortcutsHelper';
    el.className = 'w2g-shortcuts-overlay';
    el.innerHTML = `
        <div class="w2g-shortcuts-box">
            <div class="w2g-shortcuts-head">
                <span>Keyboard Shortcuts</span>
                <button class="w2g-float-close" onclick="toggleShortcutsHelper(false)">&times;</button>
            </div>
            <div class="w2g-shortcuts-list">
                <div class="w2g-shortcut-row"><span class="w2g-shortcut-keys"><kbd>Shift</kbd> + <kbd>Tab</kbd></span><span>Toggle the Friends panel</span></div>
                <div class="w2g-shortcut-row"><span class="w2g-shortcut-keys"><kbd>Shift</kbd> + <kbd>?</kbd></span><span>Show this help</span></div>
            </div>
        </div>
    `;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) toggleShortcutsHelper(false); });
}

window.toggleShortcutsHelper = function (force) {
    _ensureShortcutsHelper();
    const el = document.getElementById('w2gShortcutsHelper');
    const show = force !== undefined ? force : !el.classList.contains('active');
    el.classList.toggle('active', show);
};

document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (typing) return;

    if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        toggleFriendsOverlay();
    } else if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        toggleShortcutsHelper();
    } else if (e.key === 'Escape') {
        toggleFriendsOverlay(false);
        toggleShortcutsHelper(false);
    }
});

window.closeWatch2GetherModal = function () {
    const modal = document.getElementById('watch2getherModal');
    if (modal) modal.classList.remove('active');
};

window.hostWatch2Gether = async function () {
    const input = document.getElementById('watch2getherFriendCode');
    const friendCode = (input?.value || '').trim();
    if (!friendCode) {
        showLimitToast('⚠️ Enter your friend\'s code first.');
        return;
    }
    await _w2gSendInvite({ friendCode }, () => { if (input) input.value = ''; });
};

// Shared by both the manual friend-code box and the Friends-list invite buttons.
// payload is { friendCode } or { friendUIDs: [...] }.
async function _w2gSendInvite(payload, onSuccess) {
    const token = localStorage.getItem('authToken');
    if (!token) {
        showLimitToast('⚠️ Sign in to use Watch2Gether!');
        return;
    }
    try {
        const res = await fetch('/watch2gether/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showLimitToast(`⚠️ ${data.error || 'Could not send invite.'}`);
            return;
        }
        const names = (data.invited || []).join(', ') || 'your friend';
        showLimitToast(`✅ Invite sent to ${names}!`);
        onSuccess?.(data);
        closeWatch2GetherModal();
        // Poll fast for a couple minutes waiting for the response -- the normal 3-minute
        // notification poll is way too slow to notice an accept in any reasonable time.
        localStorage.setItem('w2gPendingInviteUntil', String(Date.now() + 2 * 60 * 1000));
        window.fetchNotifications?.();
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
}

window.respondWatch2Gether = async function (notificationId, accept) {
    const userUID = localStorage.getItem('userUID');
    const token = localStorage.getItem('authToken');
    if (!userUID || !token) return;

    try {
        const res = await fetch('/watch2gether/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ notificationId, accept })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showLimitToast('⚠️ Could not respond to invite.');
            return;
        }
        if (accept && data.sessionId) {
            window.open(`/html/watch2getherViewer.html?session=${data.sessionId}`, '_blank');
            showLimitToast('✅ Invite accepted! Following along in the new tab.');
        } else if (accept) {
            showLimitToast('✅ Invite accepted!');
        } else {
            showLimitToast('Invite declined.');
        }
        window.fetchNotifications?.();
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
};

// ── Watch2Gether host-side broadcasting ─────────────────────────────────────
// Reports the host's current path + scroll position periodically so the friend's
// viewer tab can mirror it. Persists across page loads via localStorage since
// the host keeps navigating the real site while hosting (not a single page).
// When the friend has been granted temporary control (see below), this flips
// into "follow mode" instead -- the host's real page gets steered to match
// whatever the friend is doing in their viewer, for up to 60 seconds.
let _w2gScrollThrottle = null;
let _w2gFollowing = false;
let _w2gLastAppliedPath = null;
let _w2gPendingClickSelector = null;
let _w2gLastReplayedClickAt = 0;

// Builds a selector stable enough to find the same element again on the other side's copy of
// the same page (host and friend are both viewing identical markup for a given path). Prefers
// #id when present; otherwise walks up an nth-child chain to a reasonably short, precise path.
function w2gBuildSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts = [];
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 6; depth++) {
        if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
        const parent = node.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        const index = siblings.indexOf(node) + 1;
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
        node = parent;
    }
    return parts.length ? parts.join(' > ') : null;
}

// Only ever broadcast from the tab the user is actually looking at -- otherwise every open tab
// of the site independently reports its own (possibly stale) page, and whichever tab's report
// happens to land last in the database "wins", regardless of which one the host is using.
function _w2gIsActiveTab() {
    return document.visibilityState === 'visible';
}

// The video player uses native <video controls> -- native play/pause/fullscreen/seek controls
// live in browser-rendered UI with no clickable DOM node, so they can never be captured via
// click-selector replay. Clicks landing inside the player are ignored here; real playback state
// (paused/currentTime) is synced separately via the video element's own events instead.
function _w2gIsInsidePlayer(el) {
    return !!el.closest?.('#moviePlayerFrameWrap');
}

document.addEventListener('click', (e) => {
    if (!localStorage.getItem('w2gHostingSessionId') || _w2gFollowing || !_w2gIsActiveTab()) return;
    if (_w2gIsInsidePlayer(e.target)) return;
    const selector = w2gBuildSelector(e.target);
    if (selector) {
        _w2gPendingClickSelector = selector;
        _w2gReportState();
    }
}, { capture: true });

['play', 'pause', 'seeked'].forEach(evt => {
    document.addEventListener(evt, (e) => {
        if (e.target?.id === 'moviePlayerVideo') _w2gReportState();
    }, { capture: true });
});

function _w2gReportState() {
    const sessionId = localStorage.getItem('w2gHostingSessionId');
    const token = localStorage.getItem('authToken');
    if (!sessionId || !token || _w2gFollowing || !_w2gIsActiveTab()) return;

    const body = { path: window.location.pathname + window.location.search, scrollY: window.scrollY };
    if (_w2gPendingClickSelector) {
        body.clickSelector = _w2gPendingClickSelector;
        _w2gPendingClickSelector = null;
    }
    const video = document.getElementById('moviePlayerVideo');
    if (video) {
        body.videoPaused = video.paused;
        body.videoTime = video.currentTime;
    }
    const searchBox = document.getElementById('mainSearch');
    if (searchBox && !_w2gApplyingRemoteSearch) {
        body.searchQuery = searchBox.value;
    }

    fetch(`/watch2gether/session/${sessionId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
    }).then(res => {
        if (res.status === 403) _w2gFollowing = true; // friend just took control -- stop pushing, start following
    }).catch(() => {});
}

let _w2gSearchThrottle = null;
let _w2gApplyingRemoteSearch = false;
let _w2gLastAppliedSearch = null;
document.addEventListener('input', (e) => {
    if (e.target?.id !== 'mainSearch' || _w2gApplyingRemoteSearch) return;
    if (!localStorage.getItem('w2gHostingSessionId') || _w2gFollowing || !_w2gIsActiveTab()) return;
    clearTimeout(_w2gSearchThrottle);
    _w2gSearchThrottle = setTimeout(_w2gReportState, 300);
});

async function _w2gPollForFollowOrControl() {
    const sessionId = localStorage.getItem('w2gHostingSessionId');
    const token = localStorage.getItem('authToken');
    if (!sessionId || !token || !_w2gIsActiveTab()) return;

    try {
        const res = await fetch(`/watch2gether/session/${sessionId}/state`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();

        if (data.controlOwner && data.controlOwner !== 'host') {
            _w2gFollowing = true;
            if (data.path !== _w2gLastAppliedPath) {
                _w2gLastAppliedPath = data.path;
                if (window.location.pathname + window.location.search !== data.path) {
                    window.location.href = data.path;
                    return;
                }
            }
            window.scrollTo(0, data.scrollY || 0);
            if (data.clickSelector && data.clickAt > _w2gLastReplayedClickAt) {
                _w2gLastReplayedClickAt = data.clickAt;
                try { document.querySelector(data.clickSelector)?.click(); } catch (e) {}
            }
            const video = document.getElementById('moviePlayerVideo');
            if (video && typeof data.videoPaused === 'boolean') {
                if (Math.abs(video.currentTime - (data.videoTime || 0)) > 1.5) video.currentTime = data.videoTime || 0;
                if (data.videoPaused && !video.paused) video.pause();
                if (!data.videoPaused && video.paused) video.play().catch(() => {});
            }
            if (typeof data.searchQuery === 'string' && data.searchQuery !== _w2gLastAppliedSearch) {
                _w2gLastAppliedSearch = data.searchQuery;
                const searchBox = document.getElementById('mainSearch');
                if (searchBox) {
                    _w2gApplyingRemoteSearch = true;
                    searchBox.value = data.searchQuery;
                    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                    _w2gApplyingRemoteSearch = false;
                }
            }
        } else if (_w2gFollowing) {
            // Control window expired -- hand back to normal host broadcasting.
            _w2gFollowing = false;
            _w2gLastAppliedPath = null;
        }
    } catch (e) {}
}

// Idempotent -- safe to call both at page load (if hosting was already active before this
// page load happened) and mid-session (when hosting starts via an accepted-invite notification,
// which fires long after DOMContentLoaded already ran). Previously the interval/scroll-listener
// setup only lived inside the DOMContentLoaded handler, so hosting that started mid-session sent
// exactly one report and then never updated again until the host happened to load a new page.
let _w2gLoopsStarted = false;
function _w2gEnsureLoopsRunning() {
    if (_w2gLoopsStarted) return;
    _w2gLoopsStarted = true;
    setInterval(_w2gReportState, 1500);
    setInterval(_w2gPollForFollowOrControl, 1000);
    setInterval(_w2gRenderHostBar, 5000);
    window.addEventListener('scroll', () => {
        clearTimeout(_w2gScrollThrottle);
        _w2gScrollThrottle = setTimeout(_w2gReportState, 250);
    }, { passive: true });
}

window.startWatch2GetherHosting = function (sessionId, silent) {
    localStorage.setItem('w2gHostingSessionId', String(sessionId));
    _w2gReportState();
    _w2gEnsureLoopsRunning();
    _w2gRenderHostBar();
    if (!silent) showLimitToast('📡 Now hosting Watch2Gether — your friend will see what you see.');
};

window.stopWatch2GetherHosting = function () {
    localStorage.removeItem('w2gHostingSessionId');
    _w2gFollowing = false;
    _w2gRenderHostBar();
    showLimitToast('Stopped hosting Watch2Gether.');
};

window.grantWatch2GetherControl = async function (notificationId, sessionId, granteeUID) {
    const token = localStorage.getItem('authToken');
    if (!token || !granteeUID) return;
    try {
        const res = await fetch(`/watch2gether/session/${sessionId}/grant-control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ granteeUID })
        });
        if (!res.ok) {
            showLimitToast('⚠️ Could not grant control.');
            return;
        }
        showLimitToast('🙋 They have control for 60 seconds.');
        const userUID = localStorage.getItem('userUID');
        if (userUID) {
            fetch('/notifications/mark-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userUID, id: notificationId })
            }).catch(() => {});
        }
        window.fetchNotifications?.();
        _w2gRenderHostBar();
        _w2gRenderHostingStatus();
    } catch (e) {
        showLimitToast('⚠️ Could not reach server.');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('w2gHostingSessionId')) return;
    _w2gReportState();
    _w2gEnsureLoopsRunning();
    _w2gRenderHostBar();
});

function loadCurrentSettings() {
    const currentTheme = localStorage.getItem('userTheme') || 'dark';
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === currentTheme) {
            btn.classList.add('active');
        }
    });

    const lowDataMode = localStorage.getItem('lowDataMode') === 'true';
    const lowDataCheckbox = document.getElementById('lowDataMode');
    if (lowDataCheckbox) lowDataCheckbox.checked = lowDataMode;

    const settingsSource = document.getElementById('settingsMovieSource');
    if (settingsSource) {
        settingsSource.value = localStorage.getItem('movieSource') || 'local';
    }

    const muteAudioCheckbox = document.getElementById('muteAudio');
    if (muteAudioCheckbox) {
        muteAudioCheckbox.checked = isHeroAudioMutedByPreference();
    }

    const nameInput = document.getElementById('settingsUsername');
    if (nameInput) nameInput.value = localStorage.getItem('username') || 'Guest';

    // Load mode toggle setting
    const modeToggle = document.getElementById('settingsModeToggle');
    if (modeToggle) {
        modeToggle.value = window.__animeMode ? 'anime' : 'movie';
    }
}

window.selectThemeInSettings = function (themeName) {
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === themeName) {
            btn.classList.add('active');
        }
    });

    if (window.themeManager) {
        window.themeManager.applyTheme(themeName);
    }

    showLimitToast(`✨ ${themeName.charAt(0).toUpperCase() + themeName.slice(1)} theme applied!`);
};

window.toggleLowDataMode = function () {
    const checkbox = document.getElementById('lowDataMode');
    const enabled = checkbox.checked;
    localStorage.setItem('lowDataMode', enabled);
    window.dispatchEvent(new CustomEvent('lowDataModeChanged', { detail: { enabled } }));
    showLimitToast(enabled ? '📶 Low Data Mode enabled' : '📶 Low Data Mode disabled');
};

window.toggleMuteAudio = function (forceValue = null, silent = false) {
    const checkbox = document.getElementById('muteAudio');
    const muted = typeof forceValue === 'boolean'
        ? forceValue
        : (checkbox ? !!checkbox.checked : isHeroAudioMutedByPreference());

    localStorage.setItem('muteHeroAudio', muted ? 'true' : 'false');
    if (checkbox) checkbox.checked = muted;

    if (muted || !heroAudioState.isHeroInView) {
        muteHeroTrailerImmediate();
        postHeroTrailerCommand('setVolume', [0]);
        postHeroTrailerCommand('mute');
    } else {
        postHeroTrailerCommand('unMute');
        fadeInHeroTrailerAudio();
    }

    if (!silent) {
        showLimitToast(muted ? '🔇 Hero trailer muted' : '🔊 Hero trailer unmuted');
    }
};

window.saveSettings = function () {
    const newName = document.getElementById('settingsUsername').value;
    const emailInput = document.getElementById('settingsEmail');

    if (newName.trim() !== '') {
        localStorage.setItem('username', newName);
        const navName = document.getElementById('navUsername');
        const sideName = document.getElementById('sideUsername');
        if (navName) navName.innerText = newName;
        if (sideName) sideName.innerText = newName;
    }

    if (emailInput && emailInput.value.trim() !== '') {
        localStorage.setItem('userEmail', emailInput.value);
    }

    const muteAudioCheckbox = document.getElementById('muteAudio');
    if (muteAudioCheckbox) {
        window.toggleMuteAudio(!!muteAudioCheckbox.checked, true);
    }

    closeSettings();
    if (window.persistUserStats) window.persistUserStats();
    showLimitToast('✅ Settings Saved!');
};

window.changePassword = async function () {
    const currentInput = document.getElementById('settingsCurrentPassword');
    const newInput = document.getElementById('settingsNewPassword');
    const confirmInput = document.getElementById('settingsConfirmPassword');
    const currentPassword = currentInput?.value || '';
    const newPassword = newInput?.value || '';
    const confirmPassword = confirmInput?.value || '';

    if (!currentPassword || !newPassword) {
        showLimitToast('⚠️ Enter your current and new password.');
        return;
    }
    if (newPassword !== confirmPassword) {
        showLimitToast('⚠️ New password and confirmation do not match.');
        return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
        showLimitToast('⚠️ You must be logged in to change your password.');
        return;
    }

    try {
        const res = await fetch('/users/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showLimitToast(`⚠️ ${data.error || 'Could not change password.'}`);
            return;
        }
        if (currentInput) currentInput.value = '';
        if (newInput) newInput.value = '';
        if (confirmInput) confirmInput.value = '';
        showLimitToast('✅ Password Updated!');
    } catch (err) {
        console.error('Password change error:', err);
        showLimitToast('⚠️ Could not reach server.');
    }
};

window.mergeGuestIntoAccount = async function () {
    const token = localStorage.getItem('authToken');
    if (!token) {
        showLimitToast('⚠️ Sign in first, then merge a guest session into your account.');
        return;
    }
    const guestUID = localStorage.getItem('guestUID');
    if (!guestUID) {
        showLimitToast('⚠️ No guest session found on this device.');
        return;
    }

    try {
        const res = await fetch('/users/merge-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ guestUID })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showLimitToast(`⚠️ ${data.error || 'Could not merge guest activity.'}`);
            return;
        }
        localStorage.removeItem('guestUID');
        showLimitToast('✅ Guest activity merged into this account!');
    } catch (err) {
        console.error('Guest merge error:', err);
        showLimitToast('⚠️ Could not reach server.');
    }
};

window.mergeOtherAccount = async function () {
    const emailInput = document.getElementById('mergeOtherEmail');
    const passwordInput = document.getElementById('mergeOtherPassword');
    const sourceEmail = (emailInput?.value || '').trim();
    const sourcePassword = passwordInput?.value || '';

    if (!sourceEmail || !sourcePassword) {
        showLimitToast('⚠️ Enter the other account\'s email and password.');
        return;
    }

    const token = localStorage.getItem('authToken');
    if (!token) {
        showLimitToast('⚠️ Sign in to the account you want to keep first.');
        return;
    }

    if (!confirm(`This will permanently delete the account for ${sourceEmail} after moving its watch history and list into this one. Continue?`)) {
        return;
    }

    try {
        const res = await fetch('/users/merge-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ sourceEmail, sourcePassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showLimitToast(`⚠️ ${data.error || 'Could not merge that account.'}`);
            return;
        }
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        showLimitToast('✅ Account merged and removed!');
    } catch (err) {
        console.error('Account merge error:', err);
        showLimitToast('⚠️ Could not reach server.');
    }
};

window.handlePFPUpload = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async function () {
        const base64Image = reader.result;
        // localStorage keeps the same-session instant-apply behavior; the backend save is
        // what actually survives a refresh/new device -- previously this only ever wrote to
        // localStorage, so it looked "reset" the moment a fresh page load didn't happen to
        // re-read it (which nothing did -- applyPFPToUI was never called on page load either).
        localStorage.setItem('userPFP', base64Image);
        applyPFPToUI(base64Image);

        const token = localStorage.getItem('authToken');
        if (token) {
            try {
                const res = await fetch('/users/profile-picture', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ profilePic: base64Image })
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showLimitToast(`⚠️ Saved locally, but server save failed: ${data.error || 'unknown error'}`);
                    return;
                }
            } catch (err) {
                console.error('Profile picture save error:', err);
                showLimitToast('⚠️ Saved locally, but could not reach server.');
                return;
            }
        }
        showLimitToast('✅ Profile Picture Updated!');
    };
    reader.readAsDataURL(file);
};

function applyPFPToUI(imagePath) {
    if (!imagePath) return;
    const icons = document.querySelectorAll('.grey-profile-pic, .large-profile-icon');
    icons.forEach(icon => {
        icon.style.backgroundImage = `url('${imagePath}')`;
        icon.style.backgroundSize = 'cover';
        icon.style.backgroundPosition = 'center';
        icon.style.backgroundColor = 'transparent';
    });
}

// Re-apply the saved profile picture on every page load -- previously nothing called
// applyPFPToUI() except right after an upload, so the picture looked "reset" on refresh
// even when it was still sitting in localStorage untouched.
async function restoreProfilePicture() {
    const cached = localStorage.getItem('userPFP');
    if (cached) applyPFPToUI(cached);

    const token = localStorage.getItem('authToken');
    if (!token) return;
    try {
        const res = await fetch('/users/profile-picture', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (data.profilePic && data.profilePic !== cached) {
            localStorage.setItem('userPFP', data.profilePic);
            applyPFPToUI(data.profilePic);
        }
    } catch (err) {
        console.warn('Profile picture restore failed, using local cache if present:', err.message);
    }
}
document.addEventListener('DOMContentLoaded', restoreProfilePicture);

// ── MODE SWITCHER ─────────────────────────────────────────────────────────────

window.switchContentMode = function (mode) {
    if (mode === 'anime') {
        window.__toggleAnimeMode && window.__toggleAnimeMode();
    } else if (mode === 'movie' && window.__animeMode) {
        window.__toggleAnimeMode && window.__toggleAnimeMode();
    }
    showLimitToast(`Switched to ${mode === 'anime' ? '⛩️ Anime' : '🎬 Movies'} mode`);
};

// ── NOTIFICATIONS DROPDOWN ──────────────────────────────────────────────────────
// Backed by GET /notifications (continue-watching nudges, new-episode alerts, and
// download-ready pings, generated server-side) -- polled on load and periodically.

window.__notifications = [];

const NOTIF_ICON_WATCH2GETHER_INVITE = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>`;
const NOTIF_ICON_REMOVED = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>`;
const NOTIF_ICON_FRIEND_REQUEST = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" /></svg>`;
const NOTIF_ICONS = { continue_watching: '▶', new_episode: '⛩', download_ready: '⬇', watch2gether_invite: NOTIF_ICON_WATCH2GETHER_INVITE, watch2gether_accepted: '🎉', watch2gether_control_request: '🙋', watch2gether_kicked: NOTIF_ICON_REMOVED, friend_request: NOTIF_ICON_FRIEND_REQUEST, friend_accepted: '🤝', friend_online: '🟢' };

function notifEscapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;');
}

function notifTimeAgo(unixSeconds) {
    const diff = Date.now() - (unixSeconds * 1000);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function renderNotificationBadge(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function renderNotificationList() {
    const list = document.getElementById('notifList');
    if (!list) return;
    const items = window.__notifications || [];
    if (!items.length) {
        list.innerHTML = '<p class="notif-empty">No notifications yet</p>';
        return;
    }
    list.innerHTML = items.map(n => {
        const icon = NOTIF_ICONS[n.type] || '🔔';

        if (n.type === 'watch2gether_invite' && !n.read) {
            return `<div class="notif-item unread">
                <div class="notif-item-icon">${icon}</div>
                <div class="notif-item-body">
                    <div class="notif-item-title">${notifEscapeHtml(n.title)}</div>
                    <div class="notif-item-desc">${notifEscapeHtml(n.body)}</div>
                    <div class="notif-item-time">${notifTimeAgo(n.created_at)}</div>
                    <div style="display:flex;gap:8px;margin-top:6px;">
                        <button class="btn-small" onclick="event.stopPropagation(); respondWatch2Gether(${n.id}, true)">Accept</button>
                        <button class="btn-small" onclick="event.stopPropagation(); respondWatch2Gether(${n.id}, false)">Decline</button>
                    </div>
                </div>
            </div>`;
        }

        if (n.type === 'watch2gether_accepted' && n.data?.sessionId) {
            const isHosting = localStorage.getItem('w2gHostingSessionId') === String(n.data.sessionId);
            return `<div class="notif-item${n.read ? '' : ' unread'}">
                <div class="notif-item-icon">${icon}</div>
                <div class="notif-item-body">
                    <div class="notif-item-title">${notifEscapeHtml(n.title)}</div>
                    <div class="notif-item-desc">${notifEscapeHtml(n.body)}</div>
                    <div class="notif-item-time">${notifTimeAgo(n.created_at)}</div>
                    <div style="margin-top:6px;">
                        <button class="btn-small" onclick="event.stopPropagation(); startWatch2GetherHosting(${n.data.sessionId})" ${isHosting ? 'disabled' : ''}>
                            ${isHosting ? 'Hosting...' : 'Start Hosting'}
                        </button>
                    </div>
                </div>
            </div>`;
        }

        if (n.type === 'watch2gether_control_request' && !n.read && n.data?.sessionId) {
            return `<div class="notif-item unread">
                <div class="notif-item-icon">${icon}</div>
                <div class="notif-item-body">
                    <div class="notif-item-title">${notifEscapeHtml(n.title)}</div>
                    <div class="notif-item-desc">${notifEscapeHtml(n.body)}</div>
                    <div class="notif-item-time">${notifTimeAgo(n.created_at)}</div>
                    <div style="display:flex;gap:8px;margin-top:6px;">
                        <button class="btn-small" onclick="event.stopPropagation(); grantWatch2GetherControl(${n.id}, ${n.data.sessionId}, '${n.data.requesterUID || ''}')">Accept</button>
                        <button class="btn-small" onclick="event.stopPropagation(); markNotificationRead(${n.id})">Decline</button>
                    </div>
                </div>
            </div>`;
        }

        if (n.type === 'friend_request' && !n.read) {
            return `<div class="notif-item unread">
                <div class="notif-item-icon">${icon}</div>
                <div class="notif-item-body">
                    <div class="notif-item-title">${notifEscapeHtml(n.title)}</div>
                    <div class="notif-item-desc">${notifEscapeHtml(n.body)}</div>
                    <div class="notif-item-time">${notifTimeAgo(n.created_at)}</div>
                    <div style="display:flex;gap:8px;margin-top:6px;">
                        <button class="btn-small" onclick="event.stopPropagation(); respondFriendRequest(${n.id}, true)">Accept</button>
                        <button class="btn-small" onclick="event.stopPropagation(); respondFriendRequest(${n.id}, false)">Decline</button>
                    </div>
                </div>
            </div>`;
        }

        const href = n.link || '#';
        return `<a class="notif-item${n.read ? '' : ' unread'}" href="${href}">
            <div class="notif-item-icon">${icon}</div>
            <div class="notif-item-body">
                <div class="notif-item-title">${notifEscapeHtml(n.title)}</div>
                <div class="notif-item-desc">${notifEscapeHtml(n.body)}</div>
                <div class="notif-item-time">${notifTimeAgo(n.created_at)}</div>
            </div>
        </a>`;
    }).join('');
}

window.markNotificationRead = function (notificationId) {
    const userUID = localStorage.getItem('userUID');
    if (!userUID) return;
    fetch('/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userUID, id: notificationId })
    }).then(() => window.fetchNotifications?.()).catch(() => {});
};

window.fetchNotifications = async function () {
    const userUID = localStorage.getItem('userUID');
    const token = localStorage.getItem('authToken');
    if (!userUID || !token) return;

    try {
        const res = await fetch(`/notifications?userUID=${encodeURIComponent(userUID)}`);
        if (!res.ok) return;
        const data = await res.json();
        const currCount = data.unread || 0;
        window.__notifications = data.notifications || [];
        renderNotificationBadge(currCount);
        renderNotificationList();
        const bellIcon = document.querySelector('.notif-bell-icon');
        if (bellIcon && currCount > 0) {
            bellIcon.classList.add('notif-pulsing');
        }

        // Auto-start hosting the instant we learn our invite was accepted -- previously this
        // required the host to notice the notification and click "Start Hosting" themselves,
        // which meant nothing synced until they did (looked like a broken feature).
        const freshAccept = window.__notifications.find(n => n.type === 'watch2gether_accepted' && !n.read && n.data?.sessionId);
        if (freshAccept) {
            window.startWatch2GetherHosting(freshAccept.data.sessionId, true);
            fetch('/notifications/mark-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userUID, id: freshAccept.id })
            }).catch(() => {});
        }
    } catch (err) {
        console.warn('Notifications fetch failed:', err.message);
    }
};

window.toggleNotificationsMenu = function (event) {
    if (event) event.stopPropagation();

    const dropdown = document.getElementById('notifDropdown');
    if (!dropdown) {
        console.error("❌ ERROR: Could not find id='notifDropdown'.");
        return;
    }

    dropdown.classList.toggle('active');
    const bellIcon = document.querySelector('.notif-bell-icon');
    if (bellIcon && dropdown.classList.contains('active')) {
        bellIcon.classList.remove('notif-pulsing');
    }

    if (dropdown.classList.contains('active')) {
        renderNotificationList();

        const userUID = localStorage.getItem('userUID');
        if (userUID && window.__notifications.some(n => !n.read)) {
            setTimeout(() => {
                fetch('/notifications/mark-read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userUID })
                }).then(() => renderNotificationBadge(0)).catch(() => {});
            }, 1500);
        }

        const closeOnOutsideClick = (e) => {
            if (!dropdown.contains(e.target) && !e.target.closest('.notif-trigger')) {
                dropdown.classList.remove('active');
                document.removeEventListener('pointerdown', closeOnOutsideClick, true);
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', closeOnOutsideClick, true), 0);
    }
};

// Lets any open tab refresh its bell the instant something happens in another tab (e.g. a
// download finishing on movieInfo.html) instead of waiting up to 3 minutes for the next poll.
const notifChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('legion-notifications') : null;
notifChannel?.addEventListener('message', (event) => {
    if (event.data === 'refresh') window.fetchNotifications();
});
window.broadcastNotificationRefresh = function () {
    notifChannel?.postMessage('refresh');
};

// Self-rescheduling instead of a fixed interval so it can speed up around
// Watch2Gether events (waiting on an invite response, or actively hosting where a
// control-request could arrive any time) without polling fast forever for everyone.
function scheduleNextNotificationPoll() {
    const pendingInviteUntil = Number(localStorage.getItem('w2gPendingInviteUntil')) || 0;
    const isHosting = !!localStorage.getItem('w2gHostingSessionId');
    const fastWindow = isHosting || Date.now() < pendingInviteUntil;
    const delay = fastWindow ? 2500 : 10 * 1000; // 10 seconds for live notifications

    setTimeout(async () => {
        await window.fetchNotifications();
        scheduleNextNotificationPoll();
    }, delay);
}

document.addEventListener('DOMContentLoaded', () => {
    window.fetchNotifications();
    scheduleNextNotificationPoll();
});

// ── ACCOUNT DROPDOWN ───────────────────────────────────────────────────────────

window.toggleAccountMenu = function () {
    const dropdown = document.getElementById('accountDropdown');
    if (!dropdown) {
        console.error("❌ ERROR: Could not find id='accountDropdown'.");
        return;
    }

    dropdown.classList.toggle('active');

    if (dropdown.classList.contains('active')) {
        const username = localStorage.getItem('username');
        const searches = parseInt(localStorage.getItem('searchCount')) || 0;
        const views = parseInt(localStorage.getItem('viewCount')) || 0;
        const isSignedIn = !!username;

        const settingsLink = dropdown.querySelector('a[onclick="openSettings()"]');
        const logoutLink = dropdown.querySelector('a[onclick="logout()"]');
        const signInLink = dropdown.querySelector('#signInLink');
        const signUpLink = dropdown.querySelector('#signUpLink');

        if (!isSignedIn) {
            if (settingsLink) settingsLink.classList.add('link-disabled');
            if (logoutLink) logoutLink.classList.add('link-disabled');
            if (signInLink) signInLink.style.display = '';
            if (signUpLink) signUpLink.style.display = '';
            if (document.getElementById('navUsername')) document.getElementById('navUsername').innerText = 'Guest';
        } else {
            if (settingsLink) settingsLink.classList.remove('link-disabled');
            if (logoutLink) logoutLink.classList.remove('link-disabled');
            if (signInLink) signInLink.style.display = 'none';
            if (signUpLink) signUpLink.style.display = 'none';
            if (document.getElementById('navUsername')) document.getElementById('navUsername').innerText = username;
        }

        if (document.getElementById('dropTier')) document.getElementById('dropTier').innerText = 'Free Member';
        if (document.getElementById('statSearch')) document.getElementById('statSearch').innerText = searches;
        if (document.getElementById('statView')) document.getElementById('statView').innerText = views;

        const loginCode = localStorage.getItem('loginCode');
        const loginRow = dropdown.querySelector('#loginCodeRow');
        const loginValue = dropdown.querySelector('#loginCodeValue');
        const loginToggle = dropdown.querySelector('.code-visibility-toggle');
        if (loginRow && loginValue && isSignedIn) {
            loginRow.classList.remove('hidden');
            if (loginCode && loginToggle) {
                loginValue.textContent = maskLoginCode(loginCode);
                loginToggle.style.display = 'inline-flex';
                loginToggle.dataset.visible = 'false';
                loginToggle.setAttribute('aria-pressed', 'false');
                loginToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>`;
                loginToggle.style.background = 'transparent';
                loginToggle.style.border = 'none';
                loginToggle.style.padding = '0';
            } else if (loginToggle) {
                loginValue.textContent = 'No login code saved';
                loginToggle.style.display = 'none';
            }
        } else if (loginRow) {
            loginRow.classList.add('hidden');
        }

        // Close when clicking outside
        const closeOnOutsideClick = (e) => {
            if (!dropdown.contains(e.target) && !e.target.closest('.account-trigger')) {
                dropdown.classList.remove('active');
                document.removeEventListener('pointerdown', closeOnOutsideClick, true);
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', closeOnOutsideClick, true), 0);
    }
};

window.toggleLoginCodeVisibility = function (event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget || event.target;
    const button = target.closest && target.closest('button.code-visibility-toggle') ? target.closest('button.code-visibility-toggle') : target;
    console.log('pressed show/hide login code', { button });
    if (!button) return;
    const row = button.closest('.login-code-row');
    console.log({ row });

    const valueEl = row?.querySelector('#loginCodeValue');
    console.log({ valueEl });

    const loginCode = localStorage.getItem('loginCode');
    console.log({ loginCode });

    const visible = button.dataset.visible === 'true';
    console.log({ visible });

    if (!row) return;
    if (!valueEl) return;
    if (!loginCode) return;
    if (visible) {
        valueEl.textContent = maskLoginCode(loginCode);
        button.dataset.visible = 'false';
        button.setAttribute('aria-pressed', 'false');
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>`;
    } else {
        valueEl.textContent = loginCode;
        button.dataset.visible = 'true';
        button.setAttribute('aria-pressed', 'true');
        button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /> <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>`;
    }
    console.log({ button });

};
function maskLoginCode(code) {
    if (!code) return '';
    const visibleChars = 4;
    const maskedPart = 'X'.repeat(Math.max(0, code.length - visibleChars));
    return `${maskedPart}${code.slice(-visibleChars)}`;
}

// Alias so any "X" button wired to toggleSidebar also works
window.toggleSidebar = window.toggleAccountMenu;

