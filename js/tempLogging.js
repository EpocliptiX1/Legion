// Logs TMDB IDs and titles of mini-cards in horizontal-scroll-row when they load
(function() {
    const maxWaitTime = 30000;
    const checkInterval = 500;
    let elapsedTime = 0;

    const waitForCards = setInterval(async () => {
        elapsedTime += checkInterval;

        const scrollRow = document.querySelector('.horizontal-scroll-row');
        if (!scrollRow) {
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: .horizontal-scroll-row not found');
                clearInterval(waitForCards);
            }
            return;
        }

        const cards = scrollRow.querySelectorAll('.mini-card');
        if (!cards || cards.length === 0) {
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: No mini-cards found in scroll row');
                clearInterval(waitForCards);
            }
            return;
        }

        clearInterval(waitForCards);

        const recommendations = [];
        cards.forEach((card) => {
            const title = card.querySelector('h4')?.innerText || 'Unknown';
            const onclickStr = card.onclick?.toString() || '';
            const match = onclickStr.match(/id=(\d+)/);
            const tmdbId = match ? match[1] : null;

            if (tmdbId) {
                recommendations.push({ tmdbId, title });
            }
        });

        if (recommendations.length === 0) {
            console.log('[tempLogging] No valid TMDB IDs found');
            return;
        }

        console.log('[tempLogging] Logged recommendations:', recommendations);

        try {
            const res = await fetch('/api/temp-logging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    currentPageId: new URLSearchParams(window.location.search).get('id'),
                    recommendations
                })
            });

            if (res.ok) {
                const data = await res.json();
                console.log('[tempLogging] Saved to file:', data);
            } else {
                console.warn('[tempLogging] Server error:', res.status);
            }
        } catch (err) {
            console.error('[tempLogging] Failed to log:', err.message);
        }
    }, checkInterval);
})();
