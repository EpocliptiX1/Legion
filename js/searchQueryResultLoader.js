// Loads and renders search results for searchQueryResult.html using the new /api/tmdb/search endpoint

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

document.addEventListener('DOMContentLoaded', function() {
    const resultsGrid = document.getElementById('fullResultsGrid');
    const queryDisplay = document.getElementById('queryDisplay');
    const typeFilter = document.getElementById('typeFilter');

    // Get query from URL
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q') || '';
    if (queryDisplay) queryDisplay.textContent = query;

    async function loadResults() {
        if (!resultsGrid) return;
        resultsGrid.innerHTML = '<div class="loading-text">Searching database...</div>';
        try {
            const response = await fetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
            const items = await response.json();
            if (!Array.isArray(items) || items.length === 0) {
                resultsGrid.innerHTML = '<div class="loading-text">No results found.</div>';
                return;
            }
            resultsGrid.innerHTML = '';
            items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'grid-card';
                card.setAttribute('data-type', item.type);
                // Anime TV cards need the provider-backed sub/dub/total lookup. Generic TV
                // intentionally shows TMDB's episode total in all three badge slots instead.
                const badgeType = item.type === 'movie' ? 'movie' : (item.isAnime ? 'anime' : 'tv');
                card.innerHTML = `
                    ${window.buildEpisodeCountBadgesPlaceholder ? window.buildEpisodeCountBadgesPlaceholder({ type: badgeType, title: item.title, tmdbId: item.id }) : ''}
                    <img src="${item.poster || '/img/default_poster.png'}" alt="${escapeHtml(item.title)}">
                    <div class="card-hover-info">
                        <div class="info-text">
                            <h4>${escapeHtml(item.title)}</h4>
                            <span class="match-score">${escapeHtml(item.year || '')} ${escapeHtml(item.type === 'tv' ? 'Series' : 'Movie')}</span>
                        </div>
                    </div>
                `;
                card.onclick = () => {
                    window.location.href = `movieInfo.html?id=${escapeHtml(item.id)}&type=${escapeHtml(item.type)}`;
                };
                resultsGrid.appendChild(card);
            });
            window.mountEpisodeCountBadges?.(resultsGrid);
        } catch (err) {
            resultsGrid.innerHTML = '<div class="loading-text">Error loading results.</div>';
            console.error('[searchQueryResultLoader] Error:', err);
        }
    }

    loadResults();
});
