// Logs TMDB IDs of recommendations when vertical-recommend-row is populated
(function() {
    const maxWaitTime = 30000; // 30 seconds max
    const checkInterval = 500; // Check every 500ms
    let elapsedTime = 0;

    const waitForRecommendations = setInterval(async () => {
        elapsedTime += checkInterval;

        const verticalRow = document.querySelector('.vertical-recommend-row');
        if (!verticalRow) {
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: .vertical-recommend-row not found');
                clearInterval(waitForRecommendations);
            }
            return;
        }

        const cards = verticalRow.querySelectorAll('.mini-card');
        if (!cards || cards.length === 0) {
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: No mini-cards found');
                clearInterval(waitForRecommendations);
            }
            return;
        }

        clearInterval(waitForRecommendations);

        const tmdbIds = [];
        const cardData = [];

        cards.forEach((card, idx) => {
            const href = card.onclick?.toString() || '';
            const match = href.match(/id=(\d+)/);
            const tmdbId = match ? match[1] : null;

            if (tmdbId) {
                tmdbIds.push(tmdbId);
                const title = card.querySelector('h4')?.innerText || 'Unknown';
                cardData.push({ tmdbId, title, index: idx });
            }
        });

        console.log('[tempLogging] Found recommendations:', cardData);

        try {
            const res = await fetch('/api/temp-logging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    pageId: new URLSearchParams(window.location.search).get('id'),
                    tmdbIds,
                    cardData
                })
            });

            if (res.ok) {
                console.log('[tempLogging] Logged to server:', tmdbIds.length, 'recommendations');
            } else {
                console.warn('[tempLogging] Server returned:', res.status);
            }
        } catch (err) {
            console.error('[tempLogging] Failed to log:', err.message);
        }
    }, checkInterval);
})();
