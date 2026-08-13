let currentPage = 1;
const limit = 50;
let isLoading = false;
// While an AniList-filtered anime view is showing, the scroll-triggered loadMovies() (default
// AniList row path) must not fire -- it would append unrelated, unfiltered results underneath.
let anilistFilteredViewActive = false;

function isAnimeLibraryMode() {
    return localStorage.getItem('animeMode') === 'true';
}

function getLibrarySearchQuery() {
    const mainSearch = document.getElementById('mainSearch');
    const searchInput = document.getElementById('searchInput');
    const raw = (mainSearch && mainSearch.value) || (searchInput && searchInput.value) || '';
    return raw.trim();
}

async function resolveTmdbAnimeByTitle(title, preferredType) {
    const tryTypes = preferredType === 'movie' ? ['movie', 'tv'] : ['tv', 'movie'];
    for (const t of tryTypes) {
        try {
            const r = await fetch(`/api/tmdb-proxy/search/${t}?query=${encodeURIComponent(title)}&language=en-US&page=1`);
            if (!r.ok) continue;
            const d = await r.json();
            const match = d && d.results && d.results[0];
            if (match && match.id) return { id: match.id, type: t };
        } catch (_) {}
    }
    return null;
}

window.openAnimeFromLibrary = async function(title, preferredType) {
    const found = await resolveTmdbAnimeByTitle(title, preferredType || 'tv');
    if (!found) {
        if (typeof showLimitToast === 'function') showLimitToast('Could not open this anime right now.');
        return;
    }
    window.location.href = `movieInfo.html?id=${found.id}&type=${found.type}`;
};

window.toggleMyListAnimeByTitle = async function(title, name, preferredType) {
    const found = await resolveTmdbAnimeByTitle(title, preferredType || 'tv');
    if (!found) {
        if (typeof showLimitToast === 'function') showLimitToast('Could not add this anime to My List.');
        return;
    }
    window.toggleMyList(String(found.id), name || title, found.type);
};

const tmdbGenreMap = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Anime": 16, 
    "Comedy": 35, "Crime": 80, "Documentary": 99, "Drama": 18,
    "Family": 10751, "Fantasy": 14, "History": 36, "Horror": 27,
    "Music": 10402, "Mystery": 9648, "Romance": 10749, 
    "Science Fiction": 878, "TV Movie": 10770, "Thriller": 53,
    "War": 10752, "Western": 37
};

// Store current filters, added ID slots for Actor/Director
let activeFilters = {
    sort: 'popularity.desc', 
    minYear: 1930,
    maxYear: 2026,
    genre: '',
    actorId: null,
    directorId: null
};

document.addEventListener('DOMContentLoaded', function() {
    function setSortOptions(source) {
        const sortBy = document.getElementById('sortBy');
        if (!sortBy) return;
        let options = '';
        if (isAnimeLibraryMode()) {
            options += '<option value="popularity.desc">🔥 Most Popular</option>';
            options += '<option value="vote_average.desc">⭐ Top Rated</option>';
            options += '<option value="primary_release_date.desc">📅 Newest First</option>';
            sortBy.innerHTML = options;
            sortBy.value = 'popularity.desc';
            return;
        }
        if (source === 'api') {
            options += '<option value="vote_average.desc">⭐ Top Rated</option>'; 
            options += '<option value="revenue.desc">💰 Most Successful (Revenue)</option>';
            options += '<option value="popularity.desc">🔥 Most Popular</option>';
        } else {
            options += '<option value="vote_average.desc">⭐ Highest Rated</option>';
            options += '<option value="revenue.desc">💰 Most Successful</option>';
            options += '<option value="primary_release_date.desc">📅 Newest First</option>';
        }
        sortBy.innerHTML = options;
        if (source === 'api') {
            sortBy.value = 'popularity.desc';
        }
    }

    const source = window.getMovieSource ? window.getMovieSource() : 'api'; 
    setSortOptions(source);
    
    if (window.onMovieSourceChange) {
        window.onMovieSourceChange(setSortOptions);
    }
    
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;

    // Movies and anime get separate filter panels (#filterPanel / #filterPanelAnime) rather
    // than one shared panel with anime-inapplicable fields (Actor/Director) disabled --
    // those don't map to anime the way Format/Status do. Only one panel is ever shown.
    const animeMode = isAnimeLibraryMode();
    const activePanel = document.getElementById(animeMode ? 'filterPanelAnime' : 'filterPanel');
    const inactivePanel = document.getElementById(animeMode ? 'filterPanel' : 'filterPanelAnime');
    if (inactivePanel) {
        inactivePanel.style.display = 'none';
    }

    const toggleBtn = document.getElementById('filterToggle');
    if (toggleBtn && activePanel) {
        toggleBtn.onclick = () => {
            activePanel.classList.toggle('open');
        };
    }

    const applyBtn = document.getElementById('applyFilters');
    const minSel = document.getElementById('yearPickerMin');
    const maxSel = document.getElementById('yearPickerMax');
    let skipDefaultLoad = false;

    if (animeMode) {
        const titleEl = document.querySelector('.list-title');
        if (titleEl) titleEl.textContent = 'Anime Library';

        const applyAnimeFilters = async () => {
            const filters = {
                sort: document.getElementById('animeSortBy')?.value || 'POPULARITY_DESC',
                genre: document.getElementById('animeGenreInput')?.value || '',
                tag: document.getElementById('animeTagInput')?.value || '',
                format: document.getElementById('animeFormatInput')?.value || '',
                status: document.getElementById('animeStatusInput')?.value || '',
                yearMin: document.getElementById('animeYearPickerMin')?.value || '',
                yearMax: document.getElementById('animeYearPickerMax')?.value || ''
            };
            anilistFilteredViewActive = true;
            await loadAnimeLibraryFromAniList(grid, filters);
        };

        const applyBtnAnime = document.getElementById('applyFiltersAnime');
        if (applyBtnAnime) applyBtnAnime.onclick = applyAnimeFilters;

        // Footer category quick-links (e.g. "Isekai", "Popular") land here with
        // ?animeTag=/?animeSort= instead of just dumping the default library --
        // pre-select the matching filter, open the panel so the choice is visible,
        // and apply it immediately.
        const urlParams = new URLSearchParams(window.location.search);
        const paramTag = urlParams.get('animeTag');
        const paramSort = urlParams.get('animeSort');
        if (paramTag || paramSort) {
            const tagSel = document.getElementById('animeTagInput');
            const sortSel = document.getElementById('animeSortBy');
            if (paramTag && tagSel) tagSel.value = paramTag;
            if (paramSort && sortSel) sortSel.value = paramSort;
            if (activePanel) activePanel.classList.add('open');
            applyAnimeFilters();
            skipDefaultLoad = true;
        }
    }

    if (applyBtn) {
        // 🔥 MAKE THIS ASYNC TO FETCH ACTOR/DIRECTOR IDs 🔥
        applyBtn.onclick = async function() {
            // 1. Handle Years
            if (minSel && maxSel) {
                let minYearVal = parseInt(minSel.value, 10);
                let maxYearVal = parseInt(maxSel.value, 10);
                if (!isNaN(minYearVal) && !isNaN(maxYearVal)) {
                    if (minYearVal > maxYearVal) {
                        [minYearVal, maxYearVal] = [maxYearVal, minYearVal];
                        minSel.value = minYearVal;
                        maxSel.value = maxYearVal;
                    }
                    activeFilters.minYear = minYearVal;
                    activeFilters.maxYear = maxYearVal;
                }
            }

            // 2. Handle Sort & Genre
            activeFilters.sort = document.getElementById('sortBy') ? document.getElementById('sortBy').value : 'popularity.desc';
            const genreInput = document.getElementById('genreInput');
            if(genreInput) activeFilters.genre = genreInput.value;

            // 3. Handle Actor & Director ID Translation
            activeFilters.actorId = null;
            activeFilters.directorId = null;
            if (isAnimeLibraryMode()) {
                const grid = document.getElementById('libraryGrid');
                if (grid) grid.innerHTML = '';
                currentPage = 1;
                loadMovies();
                return;
            }
            
            const actorName = document.getElementById('actorInput') ? document.getElementById('actorInput').value.trim() : '';
            const directorName = document.getElementById('directorInput') ? document.getElementById('directorInput').value.trim() : '';

            // Ask TMDB for the Actor's ID
            if (actorName) {
                try {
                    const res = await fetch(`/api/tmdb-proxy/search/person?query=${encodeURIComponent(actorName)}`);
                    const data = await res.json();
                    if (data.results && data.results.length > 0) {
                        activeFilters.actorId = data.results[0].id; // Grab the first person match
                    } else {
                        alert(`Actor "${actorName}" not found!`);
                    }
                } catch(e) { console.error('Actor search failed', e); }
            }

            // Ask TMDB for the Director's ID
            if (directorName) {
                try {
                    const res = await fetch(`/api/tmdb-proxy/search/person?query=${encodeURIComponent(directorName)}`);
                    const data = await res.json();
                    if (data.results && data.results.length > 0) {
                        activeFilters.directorId = data.results[0].id; 
                    } else {
                        alert(`Director "${directorName}" not found!`);
                    }
                } catch(e) { console.error('Director search failed', e); }
            }

            // reset grid & go back to page 1
            const grid = document.getElementById('libraryGrid');
            if(grid) grid.innerHTML = '';
            currentPage = 1;

            loadMovies();
        }
    }

    if (minSel && maxSel) {
        activeFilters.minYear = parseInt(minSel.value) || 1930;
        activeFilters.maxYear = parseInt(maxSel.value) || 2026;
    }

    if (!skipDefaultLoad) loadMovies();

    window.onscroll = function() {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
            if (!isLoading && !anilistFilteredViewActive) loadMovies();
        }
    };
});

async function loadMovies() {
    isLoading = true;
    const grid = document.getElementById('libraryGrid');
    if (!grid) {
        isLoading = false;
        return;
    }

    if (isAnimeLibraryMode()) {
        await loadAnimeLibraryDefault(grid);
        return;
    }

    try {
        const query = getLibrarySearchQuery();
        
        let fetchUrl = '';
        let isDirectTMDB = false;

        if (query) {
            fetchUrl = `/api/tmdb/search?q=${encodeURIComponent(query)}&page=${currentPage}`;
        } else {
            isDirectTMDB = true;
            
            let endpoint = 'movie'; 
            let dateParam = 'primary_release_date';
            let extraFilters = '';

            // 🔥 INJECT ACTOR / DIRECTOR IDs 🔥
            if (activeFilters.actorId) extraFilters += `&with_cast=${activeFilters.actorId}`;
            if (activeFilters.directorId) extraFilters += `&with_crew=${activeFilters.directorId}`;

            if (activeFilters.genre === 'Anime') {
                endpoint = 'tv';
                dateParam = 'first_air_date'; 
                extraFilters += '&with_original_language=ja&without_genres=10762,10751';                
                if (activeFilters.sort === 'revenue.desc') activeFilters.sort = 'popularity.desc';
            }

            fetchUrl = `/api/tmdb-proxy/discover/${endpoint}?language=en-US&sort_by=${activeFilters.sort}&${dateParam}.gte=${activeFilters.minYear}-01-01&${dateParam}.lte=${activeFilters.maxYear}-12-31&page=${currentPage}${extraFilters}`;
            
            if (activeFilters.genre && tmdbGenreMap[activeFilters.genre]) {
                const genreId = tmdbGenreMap[activeFilters.genre];
                fetchUrl += `&with_genres=${genreId}`;
            }
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error("Network response was not ok");
        
        let data = await response.json();
        let items = isDirectTMDB ? data.results : data; 

        if (!items || items.length === 0) {
            if (currentPage === 1) {
                grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">No movies/shows match these filters.</p>';
            }
            isLoading = false;
            return;
        }

        items.forEach(item => {
            const id = item.id;
            const title = item.title || item.name || "Unknown Title";
            const safeName = title.replace(/'/g, "\\'");
            const posterPath = item.poster_path || item.poster;
            const posterUrl = posterPath ? (posterPath.startsWith('http') ? posterPath : `https://image.tmdb.org/t/p/w500${posterPath}`) : '/img/default_poster.png';
            
            let year = item.year;
            if(!year) {
               const rawDate = item.release_date || item.first_air_date;
               year = rawDate ? rawDate.split('-')[0] : '';
            }
            
            const type = item.type || (item.first_air_date ? 'tv' : 'movie');
            const typeLabel = type === 'tv' ? 'TV Series' : 'Movie';

            const card = document.createElement('div');
            card.className = 'grid-card';
            card.setAttribute('data-type', type);
            
            const plusIconSVG = `
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" fill="currentColor"/> 
                </svg>`;
            
            card.innerHTML = `
                <img src="${posterUrl}" loading="lazy" decoding="async" onclick="window.location.href='movieInfo.html?id=${id}&type=${type}'" alt="${safeName}">
                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${id}&type=${type}'">▶</button>
                        <button class="hover-add" onclick="toggleMyList('${id}', '${safeName}')">
                            ${plusIconSVG}
                        </button>
                    </div>
                    <div class="info-text">
                        <h4>${safeName}</h4>
                        <span class="match-score">${year ? year : ''} ${typeLabel}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
        
        currentPage++;
        isLoading = false;
    } catch (err) {
        console.error("Library failed to load:", err);
        if(currentPage === 1) {
             grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Error loading data. Check console.</p>';
        }
        isLoading = false;
    }
}

// --- MY LIST LOGIC ---
// Normalizes any entry (old bare string or new {id,type} object) to {id, type}
function _normalizeListEntry(item) {
    if (typeof item === 'object' && item !== null) return item;
    return { id: String(item), type: 'movie' };
}

window.toggleMyList = function(id, name, type) {
    id = String(id);
    type = type || 'movie';
    let raw = JSON.parse(localStorage.getItem('myList')) || [];
    // Normalize legacy bare-string entries
    let list = raw.map(_normalizeListEntry);
    let message = '';

    const idx = list.findIndex(item => item.id === id);
    if (idx !== -1) {
        list.splice(idx, 1);
        message = `Removed ${name}`;
        // Persist removal to DB
        if (window.recommendationsSystem?.persistMyListChange) {
            window.recommendationsSystem.persistMyListChange(id, type, 'remove');
        }
    } else {
        list.push({ id, type });
        message = `Added ${name} to My List`;
        // Persist addition to DB
        if (window.recommendationsSystem?.persistMyListChange) {
            window.recommendationsSystem.persistMyListChange(id, type, 'add');
        }
    }

    localStorage.setItem('myList', JSON.stringify(list));

    if (typeof showToast === 'function') {
        showToast(message);
    } else if (typeof showLimitToast === 'function') {
        showLimitToast(message);
    } else {
        console.log(message);
    }

    if (typeof updateInfoButtonUI === 'function') updateInfoButtonUI(id);
}

// Powers the anime filter panel's Apply Filters button. Used to hit AniList
// directly from the browser on every single request -- no caching at all, and
// every result still needed its own separate /api/anime-tmdb-id round trip
// afterward just to be clickable. Now goes through /api/anime-library, which
// caches the whole result set server-side (keyed by sort + every active
// filter, same anime_row_cache/anime_cache tables the homepage's curated rows
// already use) and resolves+embeds tmdbId server-side too, so a cache hit
// needs zero extra requests per item. Genres/tags/full airdate/format/status
// all come back on every item now as well (see ANIME_LIBRARY_QUERY server-side).
async function fetchAniListFilteredAnime(filters, page = 1, perPage = 30) {
    const params = new URLSearchParams({
        sort: filters.sort || 'POPULARITY_DESC',
        page,
        perPage
    });
    if (filters.search) params.set('search', filters.search);
    if (filters.genre) params.set('genre', filters.genre);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.format) params.set('format', filters.format);
    if (filters.status) params.set('status', filters.status);
    if (filters.yearMin) params.set('yearMin', filters.yearMin);
    if (filters.yearMax) params.set('yearMax', filters.yearMax);

    const res = await fetch(`/api/anime-library?${params.toString()}`);
    if (!res.ok) throw new Error(`Anime library fetch failed (${res.status})`);
    const items = await res.json();
    return Array.isArray(items) ? items : [];
}

async function loadAnimeLibraryFromAniList(grid, filters) {
    if (!grid) return;
    grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Loading filtered anime…</p>';

    try {
        const mediaList = await fetchAniListFilteredAnime(filters);
        if (!mediaList.length) {
            grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">No anime match these filters.</p>';
            return;
        }

        // tmdbId is already resolved+embedded server-side (/api/anime-library) --
        // no more per-item /api/anime-tmdb-id round trip needed here at all.
        const results = mediaList.filter(media => media.tmdbId);
        if (!results.length) {
            grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Found matching anime, but couldn\'t link any to a TMDB entry.</p>';
            return;
        }

        const plusIconSVG = `
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" fill="currentColor"/>
            </svg>`;

        grid.innerHTML = '';
        results.forEach((media) => {
            const tmdbId = media.tmdbId;
            const title = media.title?.english || media.title?.romaji || 'Unknown';
            const safeName = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const posterUrl = media.coverImage?.extraLarge || media.coverImage?.large || '/img/default_poster.png';
            const year = media.startDate?.year || media.seasonYear || '';
            const inferredType = media.format === 'MOVIE' ? 'movie' : 'anime';
            const typeLabel = media.format || 'Anime';

            const card = document.createElement('div');
            card.className = 'grid-card';
            card.setAttribute('data-type', inferredType);
            card.innerHTML = `
                <img src="${posterUrl}" loading="lazy" decoding="async" onclick="window.location.href='movieInfo.html?id=${tmdbId}&type=${inferredType}'" alt="${safeName}">
                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${tmdbId}&type=${inferredType}'">▶</button>
                        <button class="hover-add" onclick="toggleMyList('${tmdbId}', '${safeName}', '${inferredType}')">
                            ${plusIconSVG}
                        </button>
                    </div>
                    <div class="info-text">
                        <h4>${safeName}</h4>
                        <span class="match-score">${year ? year : ''} ${typeLabel}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (err) {
        console.error('AniList filtered anime library failed to load:', err);
        grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Error loading filtered anime. Check console.</p>';
    }
}

// Powers the anime library's default (unfiltered) view -- initial page load and infinite
// scroll. Both this and the filtered path above now go through the same
// /api/anime-library cache, keyed primarily by sort (this file's #sortBy
// dropdown uses TMDB-style values since it's shared with the movie library
// UI -- mapped to AniList's own sort enum here so both paths land on
// identical, shareable cache entries instead of two different keys for the
// same underlying result set).
const ANIME_DEFAULT_SORT_MAP = {
    'popularity.desc': 'POPULARITY_DESC',
    'vote_average.desc': 'SCORE_DESC',
    'primary_release_date.desc': 'START_DATE_DESC'
};
function getDefaultAnimeSort() {
    return ANIME_DEFAULT_SORT_MAP[activeFilters.sort] || 'POPULARITY_DESC';
}

async function loadAnimeLibraryDefault(grid) {
    try {
        const query = getLibrarySearchQuery();
        const mediaList = await fetchAniListFilteredAnime(
            { sort: getDefaultAnimeSort(), search: query || undefined },
            currentPage,
            25
        );

        if (!mediaList.length) {
            if (currentPage === 1) {
                grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">No anime match these filters.</p>';
            }
            isLoading = false;
            return;
        }

        // tmdbId is already resolved+embedded server-side (/api/anime-library) --
        // no more per-item /api/anime-tmdb-id round trip needed here at all.
        const results = mediaList.filter(media => media.tmdbId);
        if (!results.length) {
            if (currentPage === 1) {
                grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Found matching anime, but couldn\'t link any to a TMDB entry.</p>';
            }
            isLoading = false;
            return;
        }

        const plusIconSVG = `
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" fill="currentColor"/>
            </svg>`;

        results.forEach((media) => {
            const tmdbId = media.tmdbId;
            const title = media.title?.english || media.title?.romaji || 'Unknown';
            const safeName = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const posterUrl = media.coverImage?.extraLarge || media.coverImage?.large || '/img/default_poster.png';
            const year = media.startDate?.year || media.seasonYear || '';
            const inferredType = media.format === 'MOVIE' ? 'movie' : 'anime';
            const typeLabel = media.format || 'Anime';

            const card = document.createElement('div');
            card.className = 'grid-card';
            card.setAttribute('data-type', inferredType);

            card.innerHTML = `
                <img src="${posterUrl}" loading="lazy" decoding="async" onclick="window.location.href='movieInfo.html?id=${tmdbId}&type=${inferredType}'" alt="${safeName}">
                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${tmdbId}&type=${inferredType}'">▶</button>
                        <button class="hover-add" onclick="toggleMyList('${tmdbId}', '${safeName}', '${inferredType}')">
                            ${plusIconSVG}
                        </button>
                    </div>
                    <div class="info-text">
                        <h4>${safeName}</h4>
                        <span class="match-score">${year ? year : ''} ${typeLabel}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });

        currentPage++;
        isLoading = false;
    } catch (err) {
        console.error('Anime library failed to load:', err);
        if (currentPage === 1) {
            grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Error loading anime data. Check console.</p>';
        }
        isLoading = false;
    }
}