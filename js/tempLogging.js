// Logs TMDB IDs and titles of mini-cards in horizontal-scroll-row when they load
(function() {
    const maxWaitTime = 60000; // 60 seconds max
    const checkInterval = 300; // Check every 300ms
    let elapsedTime = 0;

    const waitForCards = setInterval(async () => {
        elapsedTime += checkInterval;
        console.log('[tempLogging] Checking... (' + elapsedTime + 'ms)');

        const scrollRow = document.querySelector('.horizontal-scroll-row');
        if (!scrollRow) {
            console.log('[tempLogging] .horizontal-scroll-row not found yet');
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: .horizontal-scroll-row never appeared');
                clearInterval(waitForCards);
            }
            return;
        }

        const cards = scrollRow.querySelectorAll('.mini-card');
        console.log('[tempLogging] Found', cards.length, 'cards');

        if (!cards || cards.length === 0) {
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: No mini-cards found');
                clearInterval(waitForCards);
            }
            return;
        }

        // Verify cards have actual content (not just empty DOM elements)
        let validCards = 0;
        const recommendations = [];

        cards.forEach((card) => {
            const titleEl = card.querySelector('h4');
            const title = titleEl?.innerText?.trim() || '';
            const onclickStr = card.onclick?.toString() || '';
            const match = onclickStr.match(/id=(\d+)/);
            const tmdbId = match ? match[1] : null;

            console.log('[tempLogging] Card:', { title, tmdbId, hasOnclick: !!card.onclick });

            // Only count if it has actual title and ID
            if (title && tmdbId) {
                recommendations.push({ tmdbId, title });
                validCards++;
            }
        });

        console.log('[tempLogging] Valid cards:', validCards);

        // Only proceed if we have content
        if (validCards === 0) {
            if (elapsedTime > maxWaitTime) {
                console.log('[tempLogging] Timeout: No valid card data found');
                clearInterval(waitForCards);
            }
            return;
        }

        clearInterval(waitForCards);
        console.log('[tempLogging] SUCCESS - Logging recommendations:', recommendations);

        try {
            const res = await fetch('/api/temp-logging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timestamp: new Date().toISOString(),
                    currentPageId: new URLSearchParams(window.location.search).get('id'),
                    count: recommendations.length,
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
