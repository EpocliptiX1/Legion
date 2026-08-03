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
            // click replay and sync its actual paused/currentTime state instead.
            doc.addEventListener('click', (e) => {
                if (!iHaveControl || e.target.closest?.('#moviePlayerFrameWrap')) return;
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
                requestBtn.textContent = '🙋 Request to Interact';
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
            requestBtn.textContent = '🙋 Request to Interact';
        }
    }

    async function poll() {
        if (!localStorage.getItem('authToken')) return;

        try {
            const res = await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/state`, {
                headers: authHeaders()
            });
            if (!res.ok) return;
            const data = await res.json();
            if (!data) return;

            const nowHasControl = data.controlOwner === 'friend';
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
            }
        } catch (e) {}
    }

    updateStatusBar();
    poll();
    setInterval(poll, 800);
})();
