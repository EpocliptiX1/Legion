let currentPage = 0;
const limit = 50;
let isLoading = false;

// Store current filters
let activeFilters = {
    sort: 'popularity_desc',
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
        // Set default selected to Most Popular if present
        if (source === 'api') {
            sortBy.value = 'popularity_desc';
        } else {
            // For local, you can set another default if needed
        }
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

    // Use TMDB multi-search for both movies and series
    try {
        const searchInput = document.getElementById('searchInput');
        const query = searchInput && searchInput.value ? searchInput.value : '';
        if (!query) {
            grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">Enter a search term to find movies or series.</p>';
            isLoading = false;
            return;
        }
        const response = await fetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error("Server Error");
        let items = await response.json();
        // Filter by year if needed
        items = items.filter(item => {
            const y = parseInt(item.year);
            if (isNaN(y)) return true;
            return y >= activeFilters.minYear && y <= activeFilters.maxYear;
        });
        if (items.length === 0) {
            grid.innerHTML = '<p style="text-align:center; width:100%; padding:40px; color:#888;">No movies or series match these filters.</p>';
            isLoading = false;
            return;
        }
        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'grid-card';
            card.setAttribute('data-type', item.type);
            const plusIconSVG = `
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" fill="currentColor"/> 
                </svg>`;
            const safeName = item.title ? item.title.replace(/'/g, "\\'") : "Unknown Title";
            let posterUrl = item.poster || '/img/default_poster.png';
            let year = item.year || '';
            let typeLabel = item.type === 'tv' ? 'TV Series' : 'Movie';
            card.innerHTML = `
                <img src="${posterUrl}" onclick="window.location.href='movieInfo.html?id=${item.id}&type=${item.type}'" alt="${safeName}">
                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${item.id}&type=${item.type}'">▶</button>
                        <button class="hover-add" onclick="toggleMyList('${item.id}', '${safeName}')">
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