(function () {
    const sessionId = new URLSearchParams(window.location.search).get('session');
    const frame = document.getElementById('w2gFrame');
    const waitingEl = document.getElementById('w2gWaiting');
    const statusText = document.getElementById('w2gStatusText');
    const requestBtn = document.getElementById('w2gRequestBtn');

    let lastPath = null;
    let pendingScrollY = null;
    let iHaveControl = false;
    let controlExpiresAt = 0;
    let iframeListenersBound = false;
    let reportThrottle = null;
    let pendingClickSelector = null;
    let lastReplayedClickAt = 0;
    let hostHasReported = false;
    let lastAppliedSearch = null;
    let searchThrottle = null;

    const REQUEST_CONTROL_LABEL = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 1 .198-.471 1.575 1.575 0 1 0-2.228-2.228 3.818 3.818 0 0 0-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0 1 16.35 15m.002 0h-.002" /></svg> Request to Interact`;

    if (!sessionId) {
        statusText.textContent = 'Missing session — close this tab and try again.';
        requestBtn.style.display = 'none';
        return;
    }

    function authHeaders(json) {
        const token = localStorage.getItem('authToken');
        const headers = { 'Authorization': `Bearer ${token}` };
        if (json) headers['Content-Type'] = 'application/json';
        return headers;
    }

    function applyScroll(y) {
        try { frame.contentWindow.scrollTo(0, y); } catch (e) {}
    }

    // Same selector strategy as the host side (mainPageControls.js) -- both sides are viewing
    // identical markup for a given path, so an nth-of-type chain is stable enough to replay.
    function buildSelector(doc, el) {
        if (!el || el === doc.body || el === doc.documentElement) return null;
        if (el.id) return `#${CSS.escape(el.id)}`;

        const parts = [];
        let node = el;
        for (let depth = 0; node && node !== doc.body && depth < 6; depth++) {
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

    function bindIframeListeners() {
        if (iframeListenersBound) return;
        try {
            const win = frame.contentWindow;
            const doc = frame.contentDocument;
            win.addEventListener('scroll', () => {
                clearTimeout(reportThrottle);
                reportThrottle = setTimeout(reportOwnState, 250);
            }, { passive: true });
            // Native <video controls> has no clickable DOM node -- exclude the player from
            // click replay and sync its actual paused/currentTime state instead. Hero carousel
            // arrows are excluded the same way mainPageControls.js excludes them on the host
            // side (see that file's own comment) - it has its own dedicated heroData sync, and
            // replaying the raw click too would double-apply it against the other party's own
            // independent hero state once control passes back and forth.
            doc.addEventListener('click', (e) => {
                if (!iHaveControl || e.target.closest?.('#moviePlayerFrameWrap') || e.target.closest?.('#heroSection')) return;
                const selector = buildSelector(doc, e.target);
                if (selector) {
                    pendingClickSelector = selector;
                    reportOwnState();
                }
            }, { capture: true });
            ['play', 'pause', 'seeked'].forEach(evt => {
                doc.addEventListener(evt, (e) => {
                    if (iHaveControl && e.target?.id === 'moviePlayerVideo') reportOwnState();
                }, { capture: true });
            });
            doc.addEventListener('input', (e) => {
                if (!iHaveControl || e.target?.id !== 'mainSearch') return;
                clearTimeout(searchThrottle);
                searchThrottle = setTimeout(reportOwnState, 300);
            });
            iframeListenersBound = true;
        } catch (e) {}
    }

    async function reportOwnState() {
        if (!iHaveControl) return;
        let path, scrollY;
        try {
            path = frame.contentWindow.location.pathname + frame.contentWindow.location.search;
            scrollY = frame.contentWindow.scrollY;
        } catch (e) { return; }

        const body = { path, scrollY };
        if (pendingClickSelector) {
            body.clickSelector = pendingClickSelector;
            pendingClickSelector = null;
        }
        try {
            const video = frame.contentDocument.getElementById('moviePlayerVideo');
            if (video) {
                body.videoPaused = video.paused;
                body.videoTime = video.currentTime;
            }
            const searchBox = frame.contentDocument.getElementById('mainSearch');
            if (searchBox) body.searchQuery = searchBox.value;
        } catch (e) {}

        try {
            const res = await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/state`, {
                method: 'POST',
                headers: authHeaders(true),
                body: JSON.stringify(body)
            });
            if (res.status === 403) iHaveControl = false; // control window expired server-side
        } catch (e) {}
    }

    frame.addEventListener('load', () => {
        iframeListenersBound = false;
        if (iHaveControl) {
            bindIframeListeners();
            reportOwnState();
        } else if (pendingScrollY != null) {
            applyScroll(pendingScrollY);
        }
    });

    // Previously just window.close() -- the tab closing told the backend nothing, so the
    // participant row stuck around and the host kept seeing this person listed as still present.
    window.leaveWatch2GetherSession = async function () {
        try {
            await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/leave`, {
                method: 'POST',
                headers: authHeaders()
            });
        } catch (e) {}
        window.close();
    };

    window.requestWatch2GetherControl = async function () {
        requestBtn.disabled = true;
        requestBtn.textContent = 'Request sent...';
        try {
            await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/request-control`, {
                method: 'POST',
                headers: authHeaders()
            });
        } catch (e) {}
        setTimeout(() => {
            if (!iHaveControl) {
                requestBtn.disabled = false;
                requestBtn.innerHTML = REQUEST_CONTROL_LABEL;
            }
        }, 8000);
    };

    function updateStatusBar() {
        if (iHaveControl) {
            const secondsLeft = Math.max(0, controlExpiresAt - Math.floor(Date.now() / 1000));
            statusText.textContent = `You're in control — ${secondsLeft}s left`;
            requestBtn.style.display = 'none';
        } else if (!hostHasReported) {
            statusText.textContent = 'Waiting for your friend to start...';
            requestBtn.style.display = 'none';
        } else {
            statusText.textContent = 'Watching along with your friend';
            requestBtn.style.display = '';
            requestBtn.disabled = false;
            requestBtn.innerHTML = REQUEST_CONTROL_LABEL;
        }
    }

    let removedFromSession = false;

    async function poll() {
        if (!localStorage.getItem('authToken') || removedFromSession) return;

        try {
            const res = await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/state`, {
                headers: authHeaders()
            });
            if (res.status === 403) {
                // Kicked specifically -- the session itself still exists, just not for you.
                removedFromSession = true;
                statusText.textContent = 'You were removed from this session by the host.';
                requestBtn.style.display = 'none';
                return;
            }
            if (res.status === 404) {
                // Session row no longer exists at all -- /session/:id/end deletes/archives it
                // once the host actually ends the stream (as opposed to 403, which only means
                // your participant row was removed but the session is still running for others).
                removedFromSession = true;
                statusText.textContent = 'This session has ended.';
                requestBtn.style.display = 'none';
                return;
            }
            if (!res.ok) return;
            const data = await res.json();
            if (!data) return;

            const myUID = localStorage.getItem('userUID');
            const nowHasControl = !!myUID && data.controlOwner === myUID;
            if (nowHasControl !== iHaveControl) {
                iHaveControl = nowHasControl;
                if (iHaveControl) bindIframeListeners();
            }
            controlExpiresAt = data.controlExpiresAt || 0;
            updateStatusBar();

            if (iHaveControl) return; // we're the source of truth right now, don't overwrite ourselves

            if (!hostHasReported) {
                // No real report from the host yet -- don't guess, just wait. Showing the DB's
                // placeholder path here is exactly what caused "friend lands on indexMain while
                // host is on movieInfo": that placeholder isn't real data, it's just what an
                // unstarted session happens to default to.
                if (data.updatedAt <= data.createdAt) return;
                hostHasReported = true;
                waitingEl.style.display = 'none';
                frame.style.display = '';
            }

            if (!data.path) return;
            pendingScrollY = data.scrollY || 0;

            // TEMP DEBUG -- tracking down the spam-refresh report. Remove once resolved.
            console.log('[W2G DEBUG]', { incoming: data.path, lastPath, changed: data.path !== lastPath, updatedAt: data.updatedAt });

            if (data.path !== lastPath) {
                lastPath = data.path;
                frame.src = data.path;
            } else {
                applyScroll(pendingScrollY);
                if (data.clickSelector && data.clickAt > lastReplayedClickAt) {
                    lastReplayedClickAt = data.clickAt;
                    try { frame.contentDocument.querySelector(data.clickSelector)?.click(); } catch (e) {}
                }
                if (typeof data.videoPaused === 'boolean') {
                    try {
                        const video = frame.contentDocument.getElementById('moviePlayerVideo');
                        if (video) {
                            if (Math.abs(video.currentTime - (data.videoTime || 0)) > 1.5) video.currentTime = data.videoTime || 0;
                            if (data.videoPaused && !video.paused) video.pause();
                            if (!data.videoPaused && video.paused) video.play().catch(() => {});
                        }
                    } catch (e) {}
                }
                if (typeof data.searchQuery === 'string' && data.searchQuery !== lastAppliedSearch) {
                    lastAppliedSearch = data.searchQuery;
                    try {
                        const searchBox = frame.contentDocument.getElementById('mainSearch');
                        if (searchBox) {
                            searchBox.value = data.searchQuery;
                            searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    } catch (e) {}
                }
                // Hero pick + Recommended-for-You row: indexMain.html/indexBrowse.html compute
                // both independently per account, so without this a friend following along sees
                // their OWN version instead of the host's. Re-applied every poll tick (not just
                // once) so it wins even if this iframe's own async initHero()/loadRecommendedRow()
                // resolves afterward and briefly overwrites it - see the hooks' own comments in
                // mainPageControls.js for why that's safe to just keep stomping.
                if (data.heroData) {
                    try { frame.contentWindow.__w2gApplyHero?.(data.heroData); } catch (e) {}
                }
                if (Array.isArray(data.recommendedData) && data.recommendedData.length) {
                    try { frame.contentWindow.__w2gApplyRecommended?.(data.recommendedData); } catch (e) {}
                }
            }
        } catch (e) {}
    }

    updateStatusBar();
    poll();
    setInterval(poll, 800);
})();
