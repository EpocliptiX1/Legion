// Standalone landing/search page (html/landingSearch.html). The search box itself (#mainSearch +
// #searchResults) is wired up entirely by enhancedSearch.js - the exact same live-dropdown/
// Enter-to-search system indexMain.html and indexBrowse.html already use, reused as-is rather
// than reimplemented here. This file only handles what's unique to this page: the clickable
// "Popular:" terms.
(function () {
    'use strict';

    // A mix of anime and movies - static/hand-picked rather than pulled live, so this is worth
    // refreshing by hand every so often as new titles get popular instead of going stale forever.
    const POPULAR_TERMS = [
        'Solo Leveling', 'One Piece', 'That Time I Got Reincarnated as a Slime',
        'Sakamoto Days', 'Bleach', 'Jujutsu Kaisen',
        'Deadpool & Wolverine', 'Dune: Part Two', 'Wicked', 'Moana 2'
    ];

    function goToSearch(query) {
        const q = String(query || '').trim();
        if (!q) return;
        window.location.href = '/html/searchQueryResult.html?q=' + encodeURIComponent(q);
    }

    // enhancedSearch.js's own init (already run by the time this executes - see below) always
    // relocates #searchResults to <body> and marks it .search-results-modal, which style.css
    // then renders as a giant fixed, near-full-viewport overlay - built for the persistent nav
    // bar on indexMain/indexBrowse, not this compact card layout. Move it back into
    // landing-card-right so landingSearch.css's own override (scoped to #searchResults there)
    // can bound it to that block instead of covering the whole screen.
    function relocateSearchResults() {
        const resultsMenu = document.getElementById('searchResults');
        const target = document.querySelector('.landing-card-right');
        if (!resultsMenu || !target || resultsMenu.parentElement === target) return;
        target.appendChild(resultsMenu);
    }

    function renderPopularTerms() {
        const wrap = document.getElementById('landingPopularTerms');
        if (!wrap) return;
        wrap.innerHTML = '';
        POPULAR_TERMS.forEach((term, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'landing-popular-term';
            btn.textContent = term;
            btn.addEventListener('click', () => goToSearch(term));
            wrap.appendChild(btn);
            if (i < POPULAR_TERMS.length - 1) wrap.appendChild(document.createTextNode(', '));
        });
    }

    function init() {
        renderPopularTerms();
        relocateSearchResults();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Deferred scripts run in document order after parsing but before DOMContentLoaded, so
        // readyState is already past 'loading' here - and enhancedSearch.js (loaded before this
        // file) has by now already run its own init synchronously, including the body-relocate
        // this function undoes.
        init();
    }
})();
