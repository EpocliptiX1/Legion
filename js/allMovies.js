let currentPage = 0;
const limit = 50;
let isLoading = false;

// Store current filters
let activeFilters = {
    sort: 'rating_desc',
    minYear: 1930,
    maxYear: 2026,
    genre: '',
    actor: '',
    director: ''
};

document.addEventListener('DOMContentLoaded', function() {
    // ---  Sort Dropdown ---
    function setSortOptions(source) {
        const sortBy = document.getElementById('sortBy');
        if (!sortBy) return;
        let options = '';
        if (source === 'api') {
            options += '<option value="rating_desc">⭐ Top Rated</option>';
            options += '<option value="success_desc">💰 Most Successful (Revenue)</option>';
            options += '<option value="popularity_desc">🔥 Most Popular</option>';
        } else {
            options += '<option value="rating_desc">⭐ Highest Rated</option>';
            options += '<option value="rating_income_desc">📊 Best Rated / Gross Income</option>';
            options += '<option value="date_desc">📅 Newest First</option>';
            options += '<option value="duration_desc">⏳ Longest Duration</option>';
            options += '<option value="success_desc">💰 Most Successful</option>';
        }
        sortBy.innerHTML = options;
    }

    const source = window.getMovieSource ? window.getMovieSource() : 'local';
    setSortOptions(source);
    if (window.onMovieSourceChange) {
        window.onMovieSourceChange(setSortOptions);
    }
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;

    // 1. Toggle Panel
    const toggleBtn = document.getElementById('filterToggle');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            document.getElementById('filterPanel').classList.toggle('open');
        };
    }


    //  Apply Button 
    const applyBtn = document.getElementById('applyFilters');
    const minSel = document.getElementById('yearPickerMin');
    const maxSel = document.getElementById('yearPickerMax');

    if (!applyBtn) {
        console.error('Missing apply button');
        return;
    }

    applyBtn.onclick = function() {
        // Defensive check inside the click handler
        if (!minSel || !maxSel) {
            console.error('Year pickers not found in DOM');
            return;
        }

        let minYearVal = parseInt(minSel.value, 10);
        let maxYearVal = parseInt(maxSel.value, 10);

        if (isNaN(minYearVal) || isNaN(maxYearVal)) {
            alert("Please select both years.");
            return;
        }

        if (minYearVal > maxYearVal) {
            [minYearVal, maxYearVal] = [maxYearVal, minYearVal];
            minSel.value = minYearVal;
            maxSel.value = maxYearVal;
        }

        console.log(`Applying filters: Years ${minYearVal}-${maxYearVal}`);
            
        activeFilters.sort = document.getElementById('sortBy').value;
        activeFilters.minYear = minYearVal;
        activeFilters.maxYear = maxYearVal;
        activeFilters.genre = document.getElementById('genreInput').value;
        activeFilters.actor = document.getElementById('actorInput').value.trim();
        activeFilters.director = document.getElementById('directorInput').value.trim();

        // reset
        const grid = document.getElementById('libraryGrid');
        if(grid) grid.innerHTML = '';
        currentPage = 0;

        loadMovies();
    }

    if (minSel && maxSel) {
        activeFilters.minYear = parseInt(minSel.value) || 1930;
        activeFilters.maxYear = parseInt(maxSel.value) || 2026;
    }
    loadMovies();

    // inf Scroll
    window.onscroll = function() {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
            if (!isLoading) loadMovies();
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

    // Build URL Params
    const params = new URLSearchParams({
        offset: currentPage * limit,
        limit: limit,
        sort: activeFilters.sort,
        minYear: activeFilters.minYear,
        maxYear: activeFilters.maxYear,
        genre: activeFilters.genre,
        actor: activeFilters.actor,
        director: activeFilters.director
    });

    try {
        const source = window.getMovieSource ? window.getMovieSource() : 'local';
        const baseUrl = `http://localhost:3000/movies/library?${params}`;
        const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
        const requestUrl = window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl;
        console.log("Fetching:", requestUrl);
        const response = await fetch(requestUrl);
        if (!response.ok) throw new Error("Server Error"); 
        let movies = await response.json();

        if (source === 'local' && activeFilters.minYear && activeFilters.maxYear) {
            movies = movies.filter(movie => {
                let y = movie.Year || movie.year || (movie.release_date ? movie.release_date.split('/').pop() : null);
                y = parseInt(y);
                if (isNaN(y)) return true; // If no year found, keep it to be safe
                return y >= activeFilters.minYear && y <= activeFilters.maxYear;
            });
        }
        if (movies.length === 0) {
            if (currentPage === 0) {
                grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">No movies match these filters.</p>';
            }
            isLoading = false;
            return;
        }

        movies.forEach(movie => {
            const card = document.createElement('div');
            card.className = 'grid-card';

            const plusIconSVG = `
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" fill="currentColor"/> 
                </svg>`;

            // Safely escape quotes in movie name
            const safeName = movie['Movie Name'] ? movie['Movie Name'].replace(/'/g, "\\'") : "Unknown Title";

            // Fix: For local DB, ensure poster and year are not overwritten after render
            let posterUrl = movie.poster_full_url || '/img/default_poster.png';
            let year = movie.Year || movie.year || (movie.release_date ? movie.release_date.split('/').pop() : '');
            if (window.getMovieSource && window.getMovieSource() === 'local') {
                // If poster is missing or looks like a logo, use fallback
                if (!movie.poster_full_url || /logo/i.test(movie.poster_full_url)) {
                    posterUrl = '/img/default_poster.png';
                }
                // If year is missing or invalid, show blank instead of N/A
                if (!year || isNaN(parseInt(year))) {
                    year = '';
                }
            }

            card.innerHTML = `
                <img src="${posterUrl}" onclick="window.location.href='movieInfo.html?id=${movie.ID}'" alt="${safeName}">
                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">▶</button>
                        <button class="hover-add" onclick="toggleMyList('${movie.ID}', '${safeName}')">
                            ${plusIconSVG}
                        </button>
                    </div>
                    <div class="info-text">
                        <h4>${movie['Movie Name']}</h4>
                        <span class="match-score">${year ? year : ''} IMDb ${movie.Rating || 'N/A'}</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });

        currentPage++;
        isLoading = false;
    } catch (err) { 
        console.error("Library failed to load:", err); 
        isLoading = false; 
    }
}

// --- MY LIST LOGIC ---
window.toggleMyList = function(id, name) {
    let list = JSON.parse(localStorage.getItem('myList')) || [];
    let message = "";

    // Convert id to string to ensure matching works
    id = String(id);

    if (list.includes(id)) {
        list = list.filter(item => item !== id);
        message = `Removed ${name}`;
    } else {
        list.push(id);
        message = `Added ${name} to My List`;
    }
    
    localStorage.setItem('myList', JSON.stringify(list));
    
    // Notification logic
    if (typeof showToast === 'function') {
        showToast(message);
    } else if (typeof showLimitToast === 'function') {
        showLimitToast(message);
    } else {
        console.log(message);
    }
    
    if (typeof updateInfoButtonUI === "function") updateInfoButtonUI(id);
}