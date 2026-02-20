// Handles filtering of search results by type (movie/series) on the search results page

document.addEventListener('DOMContentLoaded', function() {
    const typeFilter = document.getElementById('typeFilter');
    const resultsGrid = document.getElementById('fullResultsGrid');
    if (!typeFilter || !resultsGrid) return;

    // Helper to filter and show/hide cards
    function filterResults() {
        const selected = (typeFilter.value || '').toLowerCase();
        const cards = resultsGrid.querySelectorAll('.grid-card');
        console.log(`[Filter] Filtering for: ${selected}`);
        cards.forEach(card => {
            let cardType = (card.getAttribute('data-type') || '').toLowerCase();
            // Normalize: treat 'tv' and 'series' as the same
            if (cardType === 'tv') cardType = 'series';
            if (selected === 'tv') selected = 'series';
            if (selected === 'all' || cardType === selected) {
                card.style.setProperty('display', '', 'important');
            } else {
                card.style.setProperty('display', 'none', 'important');
            }
        });
    }

    typeFilter.addEventListener('change', filterResults);
    filterResults();

    // Observe DOM changes to re-apply filter when new results are added
    const observer = new MutationObserver(filterResults);
    observer.observe(resultsGrid, { childList: true, subtree: true });
});
