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

        cards.forEach((card, idx) => {
            const titleEl = card.querySelector('h4');
            const title = titleEl?.innerText?.trim() || '';
            const onclickStr = card.onclick?.toString() || '';

            // Try multiple regex patterns
            let tmdbId = null;
            const patterns = [
                /id=(\d+)/,           // id=12345
                /id:\s*(\d+)/,        // id: 12345
                /`id=(\d+)/,          // `id=12345
                /movieInfo\.html\?id=(\d+)/, // movieInfo.html?id=12345
            ];

            for (const pattern of patterns) {
                const match = onclickStr.match(pattern);
                if (match) {
                    tmdbId = match[1];
                    break;
                }
            }

            console.log('[tempLogging] Card', idx, ':', {
                title,
                tmdbId,
                onclickFirst200: onclickStr.substring(0, 200)
            });

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
