// TMDB API Key Status Checker (shared for all settings UIs)
(function() {
    function checkTmdbApiStatusShared(circle, text) {
        if (!circle || !text) return;
        text.textContent = 'Checking...';
        circle.style.background = '#aaa';
        fetch('/api/tmdb-key-status')
            .then(res => res.json())
            .then(data => {
                if (data.valid) {
                    circle.style.background = '#3ec46d';
                    text.textContent = 'Valid';
                } else {
                    circle.style.background = '#e74c3c';
                    text.textContent = 'Invalid';
                }
            })
            .catch(() => {
                circle.style.background = '#e74c3c';
                text.textContent = 'Error';
            });
    }

    function injectTmdbStatusIfNeeded() {
        // Find all TMDB Global Database labels in settings
        const labels = Array.from(document.querySelectorAll('label'));
        labels.forEach(label => {
            if (label.textContent.trim() === 'TMDB Global Database' && !label.dataset.tmdbStatusInjected) {
                label.dataset.tmdbStatusInjected = '1';
                const circle = document.createElement('span');
                circle.style.cssText = 'width:14px;height:14px;border-radius:50%;display:inline-block;background:#aaa;border:1px solid #333;margin-left:10px;vertical-align:middle;';
                circle.className = 'tmdb-api-status-circle';
                const text = document.createElement('span');
                text.style.cssText = 'font-size:0.95em;color:#888;margin-left:6px;vertical-align:middle;';
                text.className = 'tmdb-api-status-text';
                text.textContent = 'Checking API...';
                label.parentNode.insertBefore(circle, label.nextSibling);
                label.parentNode.insertBefore(text, circle.nextSibling);
                checkTmdbApiStatusShared(circle, text);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', injectTmdbStatusIfNeeded);
})();
