(function () {
    const sessionId = new URLSearchParams(window.location.search).get('session');
    const frame = document.getElementById('w2gFrame');
    const statusText = document.getElementById('w2gStatusText');
    const requestBtn = document.getElementById('w2gRequestBtn');

    let lastPath = null;
    let pendingScrollY = null;
    let iHaveControl = false;
    let controlExpiresAt = 0;
    let iframeScrollBound = false;
    let reportThrottle = null;

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

    function bindIframeReporting() {
        if (iframeScrollBound) return;
        try {
            frame.contentWindow.addEventListener('scroll', () => {
                clearTimeout(reportThrottle);
                reportThrottle = setTimeout(reportOwnState, 250);
            }, { passive: true });
            iframeScrollBound = true;
        } catch (e) {}
    }

    async function reportOwnState() {
        if (!iHaveControl) return;
        let path, scrollY;
        try {
            path = frame.contentWindow.location.pathname + frame.contentWindow.location.search;
            scrollY = frame.contentWindow.scrollY;
        } catch (e) { return; }

        try {
            const res = await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/state`, {
                method: 'POST',
                headers: authHeaders(true),
                body: JSON.stringify({ path, scrollY })
            });
            if (res.status === 403) iHaveControl = false; // control window expired server-side
        } catch (e) {}
    }

    frame.addEventListener('load', () => {
        if (iHaveControl) {
            bindIframeReporting();
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
                if (iHaveControl) bindIframeReporting();
            }
            controlExpiresAt = data.controlExpiresAt || 0;
            updateStatusBar();

            if (iHaveControl) return; // we're the source of truth right now, don't overwrite ourselves

            if (!data.path) return;
            pendingScrollY = data.scrollY || 0;

            if (data.path !== lastPath) {
                lastPath = data.path;
                frame.src = data.path;
            } else {
                applyScroll(pendingScrollY);
            }
        } catch (e) {}
    }

    updateStatusBar();
    poll();
    setInterval(poll, 800);
})();
