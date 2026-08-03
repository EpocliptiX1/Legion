(function () {
    const sessionId = new URLSearchParams(window.location.search).get('session');
    const frame = document.getElementById('w2gFrame');
    let lastPath = null;
    let pendingScrollY = null;

    if (!sessionId) {
        document.querySelector('.w2g-bar-label').textContent = 'Missing session — close this tab and try again.';
        return;
    }

    function applyScroll(y) {
        try {
            frame.contentWindow.scrollTo(0, y);
        } catch (e) {
            // Cross-origin or not-yet-loaded -- ignore, next poll will retry.
        }
    }

    frame.addEventListener('load', () => {
        if (pendingScrollY != null) applyScroll(pendingScrollY);
    });

    async function poll() {
        const token = localStorage.getItem('authToken');
        if (!token) return;

        try {
            const res = await fetch(`/watch2gether/session/${encodeURIComponent(sessionId)}/state`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (!data?.path) return;

            pendingScrollY = data.scrollY || 0;

            if (data.path !== lastPath) {
                lastPath = data.path;
                frame.src = data.path;
            } else {
                applyScroll(pendingScrollY);
            }
        } catch (e) {
            // Silent -- just retry on the next tick.
        }
    }

    poll();
    setInterval(poll, 800);
})();
