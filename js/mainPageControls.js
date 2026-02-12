// this has been unspeakable torture
// --- SETTINGS/ACCOUNT/API STATUS INIT FOR MOVIEINFO ---
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('settingsModal')) {
        const nameInput = document.getElementById('settingsUsername');
        const navName = document.getElementById('navUsername');
        const username = localStorage.getItem('username') || 'Guest';
        if (nameInput) nameInput.value = username;
        if (navName) navName.innerText = username;

        const langInput = document.getElementById('settingsLanguage');
        if (langInput && localStorage.getItem('userLanguage')) {
            langInput.value = localStorage.getItem('userLanguage');
        }

        const sourceInput = document.getElementById('settingsMovieSource');
        if (sourceInput && localStorage.getItem('movieSource')) {
            sourceInput.value = localStorage.getItem('movieSource');
        }

        const statView = document.getElementById('statView');
        if (statView) statView.innerText = localStorage.getItem('views') || '0/3';

        const userTier = localStorage.getItem('userTier');
        if (userTier === 'Gold' || userTier === 'Premium') {
            const adSection = document.getElementById('adSection');
            if (adSection) adSection.style.display = 'none';
        }

        const apiStatusText = document.getElementById('apiStatusText');
        if (apiStatusText) {
            apiStatusText.innerText = 'Checking API...';
            setTimeout(() => {
                apiStatusText.innerText = 'Online';
                apiStatusText.style.color = '#46d369';
            }, 500);
        }
    }
});
/* =========================================
   1. DYNAMIC HERO SLIDER LOGIC
   ========================================= */
let heroMovies = []; 
let currentSlide = 0;

async function initHero() {
    try {
        const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
        let movies = [];

        if (isBrowsePage && window.recommendationsSystem?.generateRecommendations) {
            movies = await window.recommendationsSystem.generateRecommendations(5);
        }

        if (!movies || movies.length === 0) {
            const baseUrl = 'http://localhost:3000/movies/library?limit=5&sort=date_desc';
            const source = window.getMovieSource ? window.getMovieSource() : 'local';
            const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
            const response = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
            movies = await response.json();
        }

        heroMovies = movies.map(movie => {
            let stars = movie.Stars || "";
            if (!stars && movie.credits && Array.isArray(movie.credits.cast)) {
                stars = movie.credits.cast.map(actor => actor.name).join(', ');
            }
            return {
                id: movie.ID,
                title: movie['Movie Name'],
                imdbId: movie.imdb_id || "", 
                rating: movie.Rating,
                year: movie.Year || movie.release_date?.split('-')[0] || "N/A",
                runtime: movie.Runtime || "-- min",
                plot: movie.Plot || "No plot summary available for this title.",
                stars,
                searchName: movie['Movie Name']
            };
        });

        const heroTag = document.getElementById('heroTag');
        if (heroTag && isBrowsePage) {
            heroTag.textContent = 'Recommended for you';
        }

        if (heroMovies.length > 0) {
            updateHero();
            updateDots();
        }
    } catch (err) {
        console.error("Hero Init Error:", err);
    }
    
}

async function updateHero() {
    if (heroMovies.length === 0) return;
    const movie = heroMovies[currentSlide];
    
    const content = document.querySelector('.hero-content');
    if (content) content.style.opacity = '0'; 

    if (window.fetchYTId) {
        const tId = await window.fetchYTId(movie.title);
        movie.currentTrailerId = tId;

        const iframe = document.getElementById('heroTrailerFrame');
        if (iframe && tId) {
            const lowDataMode = localStorage.getItem('lowDataMode') === 'true';
            
            if (lowDataMode) {
                iframe.src = '';
                console.log('[Low Data Mode] Skipping trailer autoplay');
            } else {
                iframe.src = `https://www.youtube.com/embed/${tId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${tId}`;
            }
        }
    }

    setTimeout(() => {
        const titleEl = document.getElementById('heroTitle');
        const ratingEl = document.getElementById('statRating'); 
        const dateEl = document.getElementById('statDate');     
        const runtimeEl = document.getElementById('statRuntime'); 
        const descEl = document.getElementById('heroDesc');     

        if (titleEl) titleEl.innerText = movie.title;
        if (ratingEl) ratingEl.innerText = movie.rating || "--";
        if (dateEl) dateEl.innerText = movie.year || "----";
        if (runtimeEl) runtimeEl.innerText = movie.runtime || "-- min";
        if (descEl) descEl.innerText = movie.plot;
        
        if (content) content.style.opacity = '1';
        updateDots();
    }, 300);
}
// ARROW LOGIC (Fixed global scope)
window.nextSlide = function() {
    currentSlide = (currentSlide + 1) % heroMovies.length;
    updateHero();
};

window.prevSlide = function() {
                localStorage.setItem('movieSource', 'api');
    currentSlide = (currentSlide - 1 + heroMovies.length) % heroMovies.length;
    updateHero();
};

window.goToSlide = function(index) {
    currentSlide = index;
    updateHero();
};

function updateDots() {
    const dotsContainer = document.getElementById('sliderDots');
    if(dotsContainer) {
        dotsContainer.innerHTML = heroMovies.map((_, i) => 
            `<span class="dot ${i === currentSlide ? 'active' : ''}" onclick="goToSlide(${i})"></span>`
        ).join('');
    }
}

/* =========================================
   2. MOVIE OVERLAY & PLAY LOGIC
   ========================================= */
async function updateHero() {
    if (heroMovies.length === 0) return;
    const movie = heroMovies[currentSlide];
    
    const content = document.querySelector('.hero-content');
    if (content) content.style.opacity = '0';

    if (window.fetchYTId) {
        const tId = await window.fetchYTId(movie.title);
        movie.currentTrailerId = tId; 

        const heroFrame = document.getElementById('heroTrailerFrame');
        if (heroFrame && tId) {
            heroFrame.src = `https://www.youtube.com/embed/${tId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${tId}&rel=0`;
        }
    }

    // 2. UPDATE TEXT: Matching your HTML IDs exactly
    setTimeout(() => {
        if (document.getElementById('heroTitle')) document.getElementById('heroTitle').innerText = movie.title;
        if (document.getElementById('statRating')) document.getElementById('statRating').innerText = movie.rating || "--";
        if (document.getElementById('statDate')) document.getElementById('statDate').innerText = movie.year || "----";
        if (document.getElementById('statRuntime')) document.getElementById('statRuntime').innerText = movie.runtime || "-- min";
        if (document.getElementById('heroDesc')) document.getElementById('heroDesc').innerText = movie.plot;

        if (content) content.style.opacity = '1';
        updateDots();
        if (window.translator && typeof window.translator.translateTextNodes === 'function') {
            const heroSection = document.querySelector('.hero');
            window.translator.translateTextNodes(heroSection || document.body, {
                targetLang: window.translator.getTargetLanguage ? window.translator.getTargetLanguage() : undefined,
                sourceLang: 'EN'
            });
        }
    }, 300);
}
window.openMovie = async function() {
    const movie = heroMovies[currentSlide];
    const overlay = document.getElementById('movieOverlay');
    if(!overlay || !movie) return;
    console.log('[Overlay] Loading movie:', movie);
    const title = movie.title;
    const rating = movie.rating || "--";
    const year = movie.year || "----";
    const runtime = movie.runtime || "-- min";
    const plot = movie.plot;
    const stars = movie.stars;
    console.log('[Overlay] Title:', title);
    console.log('[Overlay] Rating:', rating);
    console.log('[Overlay] Year:', year);
    console.log('[Overlay] Runtime:', runtime);
    console.log('[Overlay] Plot:', plot);
    console.log('[Overlay] Stars:', stars);
    document.getElementById('statTitle').innerText = title;
    document.getElementById('statRatingOverlay').innerText = rating;
    document.getElementById('statDateOverlay').innerText = year;
    document.getElementById('statRuntimeOverlay').innerText = runtime;
    document.getElementById('statPlot').innerText = plot;

    const castList = document.getElementById('castListOverlay');
    if (castList && stars) {
        const cleanedStars = String(stars).replace(/[\[\]']/g, ""); 
        const actors = cleanedStars.split(',').slice(0, 4); 
        console.log('[Overlay] Actors parsed:', actors);
        castList.innerHTML = actors.map(name => `
            <li> <p>${name.trim()}</p></li>
        `).join('');
    } else {
        console.log('[Overlay] No cast found or castList element missing.');
    }

    const maxTrailer = document.getElementById('maxTrailer');
    if (maxTrailer) {
        maxTrailer.src = ""; // Clear old video 
        if (!movie.currentTrailerId && window.fetchYTId) {
            movie.currentTrailerId = await window.fetchYTId(title);
        }
        if (movie.currentTrailerId) {
            maxTrailer.src = `https://www.youtube.com/embed/${movie.currentTrailerId}?autoplay=1&rel=0&enablejsapi=1`;
        }
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.triggerPlay = function() {
    openMovie();
    setTimeout(() => {
        const plot = document.getElementById('statPlot');
        if(plot) plot.scrollIntoView({ behavior: 'auto', block: 'center' });
    }, 100);
};

window.closeMovie = function() {
    document.getElementById('movieOverlay').classList.remove('active');
    document.getElementById('maxTrailer').src = "";
    document.body.style.overflow = 'auto';
};

/* =========================================
   3. REDIRECT & TRAILER FETCH
   ========================================= */
window.openRedirectModal = function() {
    document.getElementById('redirectModal').classList.add('active');
};

window.closeRedirectModal = function() {
    document.getElementById('redirectModal').classList.remove('active');
};

window.proceedToIMDb = function() {
    const movie = heroMovies[currentSlide];
    const url = movie.imdbId 
        ? `https://www.imdb.com/title/${movie.imdbId}/` 
        : `https://www.imdb.com/find?q=${encodeURIComponent(movie.title)}`;
    window.open(url, "_blank");
    closeRedirectModal();
};
 

// TMDB API Key Checker
async function checkTmdbApiKey() {
    const statusCircle = document.getElementById('apiStatusCircle');
    const statusText = document.getElementById('apiStatusText');
    if (!statusCircle || !statusText) return;
    statusCircle.style.background = '#aaa';
    statusText.textContent = 'Checking API...';
    try {
        const url = window.tmdbBuildUrl ? window.tmdbBuildUrl('/movie/550') : null;
        if (!url) throw new Error('No TMDB URL');
        const res = await fetch(url);
        if (res.ok) {
            statusCircle.style.background = '#2ecc40'; // green
            statusText.textContent = 'API Key Valid';
        } else {
            statusCircle.style.background = '#ff4444'; // red
            statusText.textContent = 'API Key Invalid';
        }
    } catch (err) {
        statusCircle.style.background = '#ff4444';
        statusText.textContent = 'API Offline or Invalid';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initHero();
    checkTmdbApiKey();
});

document.addEventListener('DOMContentLoaded', async () => {
    
    initSlider();

    // 2. PLAY BUTTON LOGIC
    const playBtn = document.querySelector('.btn-play');
    if(playBtn) playBtn.onclick = triggerPlay;

    // ===============================================================
    // SEARCH BAR LOGIC (Navbar)
    // ===============================================================
    const searchInput = document.querySelector('.search-box input');
    const searchBox = document.querySelector('.search-box');
    
    if (searchInput && searchBox) {
        let resultsMenu = document.getElementById('searchResults');
        if (!resultsMenu) {
            resultsMenu = document.createElement('div');
            resultsMenu.id = 'searchResults';
            resultsMenu.className = 'search-results-menu';
            searchBox.appendChild(resultsMenu);
        }

        if (resultsMenu.parentElement !== document.body) {
            document.body.appendChild(resultsMenu);
        }
        resultsMenu.classList.add('search-results-modal');

        // Expansion
        searchInput.addEventListener('focus', () => searchBox.classList.add('expanded'));
        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                searchBox.classList.remove('expanded');
                resultsMenu.classList.remove('active');
            }, 250);
        });

        // Dropdown Search
        searchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim();
            if (query.length > 0) {
                resultsMenu.classList.add('active');
                try {
                    const baseUrl = `http://localhost:3000/search?q=${encodeURIComponent(query)}`;
                    const response = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
                    const movies = await response.json();
                    renderSearchResults(movies, resultsMenu);
                } catch (err) {
                    console.error("Backend error:", err);
                    resultsMenu.innerHTML = '<div style="padding:15px; color:red">Backend offline</div>';
                }
            } else {
                resultsMenu.classList.remove('active');
            }
        });

        // Enter Key Redirect
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = e.target.value.trim();
                if (query.length > 0) {
                    window.location.href = `searchQueryResult.html?q=${encodeURIComponent(query)}`;
                }
            }
        });
    }

    // ===============================================================
    // RESULTS PAGE LOGIC (Search Grid with Overlays)
    // ===============================================================
    const fullResultsGrid = document.getElementById('fullResultsGrid');
    
    if (fullResultsGrid) {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        
        if (query) {
            const display = document.getElementById('queryDisplay');
            if(display) display.innerText = query;
            
            try {
                const baseUrl = `http://localhost:3000/search?q=${encodeURIComponent(query)}`;
                const response = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
                const movies = await response.json();
                
                // --- GENERATE HTML ---
                fullResultsGrid.innerHTML = movies.map(movie => `
                    <div class="movie-card" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">                        
                        <div style="position: relative; width: 100%; height: 270px;">
                            <img src="${movie.poster_full_url}" 
                                    alt="${movie['Movie Name']}" 
                                    style="width:100%; height:100%; object-fit:cover;"
                                    onerror="this.src='/img/LOGO_Short.png'">
                            
                            <div class="card-overlay">
                                <svg class="play-icon-svg" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/> 
                                </svg>
                            </div>
                        </div>

                        <div class="movie-card-info">
                            <h3>${movie['Movie Name']}</h3>
                            <p>${movie.release_date ? movie.release_date.split('-')[0] : (movie.Year || 'N/A')} • ⭐ ${getMovieRating(movie)}</p>
                        </div>
                    </div>
                `).join('');
                
            } catch (err) {
                console.error("Failed to load results:", err);
                fullResultsGrid.innerHTML = '<p style="color:red; text-align:center;">Could not connect to database.</p>';
            }
        }
    }
});

// Helper Functions
function renderSearchResults(movies, container) {
    if (movies.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:#888; text-align:center;">No results found.</div>';
        return;
    }

    container.innerHTML = movies.map(movie => `
        <div class="search-item" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">
            <img src="${movie.poster_full_url}" alt="poster" onerror="this.src='/img/LOGO_Short.png'">
            <div class="search-info">
                <h5>${movie['Movie Name']}</h5>
                <p>${movie.release_date ? movie.release_date.split('-')[0] : (movie.Year || 'N/A')} • ⭐ ${getMovieRating(movie)} IMDb</p>
            </div>
        </div>
    `).join('');
}

function getMovieRating(movie) {
    if (!movie || typeof movie !== 'object') return 'N/A';
    const raw = movie.Rating ?? movie.imdb_rating ?? movie.vote_average ?? movie['IMDb Rating'] ?? movie['IMDB Rating'];
    if (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) return 'N/A';
    const num = Number(raw);
    return Number.isFinite(num) ? num.toFixed(1) : String(raw);
}

function initSlider() {
    const dotsContainer = document.getElementById('sliderDots');
    if (!dotsContainer) return;
    dotsContainer.innerHTML = '';
    heroMovies.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.classList.add('dot');
        if (index === 0) dot.classList.add('active');
        dot.onclick = () => goToSlide(index);
        dotsContainer.appendChild(dot);
    });
}
// hero updater
function updateHeroUI() {
    if (isAnimating) return;
    isAnimating = true;
    const textSection = document.querySelector('.hero-content');
    const trailerSection = document.querySelector('.hero-trailer-side');
    if (textSection && trailerSection) {
        textSection.classList.add('content-hidden');
        trailerSection.classList.add('content-hidden');
    }
    setTimeout(() => {
        const movie = heroMovies[currentSlide];
        document.getElementById('heroTitle').innerText = movie.title;
        document.getElementById('statRating').innerText = movie.rating;
        document.getElementById('statDate').innerText = movie.year;
        document.getElementById('statRuntime').innerText = movie.runtime;
        document.getElementById('heroDesc').innerText = movie.plot;
        const trailerFrame = document.getElementById('heroTrailerFrame');
        if (trailerFrame) {
            trailerFrame.src = `https://www.youtube.com/embed/${movie.trailerId}?start=15&autoplay=1&mute=1&controls=0&loop=1&playlist=${movie.trailerId}`;
        }
        const dots = document.querySelectorAll('.dot');
        dots.forEach(d => d.classList.remove('active'));
        if(dots[currentSlide]) dots[currentSlide].classList.add('active');
        if (textSection && trailerSection) {
            textSection.classList.remove('content-hidden');
            trailerSection.classList.remove('content-hidden');
        }
        isAnimating = false;
    }, 400); 
}
function nextSlide() {
    if (isAnimating) return;
    currentSlide = (currentSlide + 1) % heroMovies.length;
    updateHeroUI();
}
function prevSlide() {
    if (isAnimating) return;
    currentSlide = (currentSlide - 1 + heroMovies.length) % heroMovies.length;
    updateHeroUI();
}
function goToSlide(index) {
    if (isAnimating || index === currentSlide) return;
    currentSlide = index;
    updateHeroUI();
}
 
function closeMovie() {
    const overlay = document.getElementById('movieOverlay');
    if(overlay) overlay.classList.remove('active');
    setTimeout(() => {
        const trailer = document.getElementById('maxTrailer');
        if(trailer) trailer.src = "";
    }, 400);
}
window.onclick = function(event) {
    let overlay = document.getElementById('movieOverlay');
    if (event.target == overlay) {
        closeMovie();
    }
}
function triggerPlay() {
    openMovie();

    // "Teleport" to the Plot Text
    setTimeout(() => {
        const plotElement = document.getElementById('statPlot');
        if (plotElement) {
            plotElement.scrollIntoView({ behavior: 'auto', block: 'center' });
            
            plotElement.style.transition = "color 0.2s";
            const oldColor = plotElement.style.color;
            plotElement.style.color = "#f96d00";
            
            setTimeout(() => {
                plotElement.style.color = oldColor || "#ccc";
            }, 800);
        }
    }, 50); 
}
function openRedirectModal() {
    const modal = document.getElementById('redirectModal');
    if(modal) {
        modal.classList.add('active'); 
    }
}

// This is the method that offs the menu
function closeRedirectModal() {
    const modal = document.getElementById('redirectModal');
    if(modal) {
        modal.classList.remove('active');
    }
}

// This handles the actual navigation
function proceedToIMDb() {
    const currentMovie = heroMovies[currentSlide];
    
    if (currentMovie && currentMovie.imdbId) {
        window.open(`https://www.imdb.com/title/${currentMovie.imdbId}/`, "_blank");
        closeRedirectModal();
    } else {
        alert("IMDb link not available for this title.");
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');

    const rowCalls = [
        { id: 'rowTrending', sort: 'rating_desc' },
        { id: 'rowPopular', sort: 'clicks_desc' },
        { id: 'rowNewest', sort: 'date_desc' },
        { id: 'rowAction', sort: 'rating_desc', opts: { genre: 'Action' } },
        { id: 'rowDrama', sort: 'rating_desc', opts: { genre: 'Drama' } },
        { id: 'rowComedy', sort: 'rating_desc', opts: { genre: 'Comedy' } },
        { id: 'rowSciFi', sort: 'rating_desc', opts: { genre: 'Sci-Fi' } },
        { id: 'rowThriller', sort: 'rating_desc', opts: { genre: 'Thriller' } },
        { id: 'rowAnimation', sort: 'rating_desc', opts: { genre: 'Animation' } },
        { id: 'rowAdventure', sort: 'rating_desc', opts: { genre: 'Adventure' } },
        { id: 'rowRomance', sort: 'rating_desc', opts: { genre: 'Romance' } },
        { id: 'rowHiddenGems', sort: 'rating_desc', opts: { offset: 80 } },
        { id: 'rowLongest', sort: 'duration_desc' },
        { id: 'rowGrossing', sort: 'success_desc' },
        { id: 'rowBinge', sort: 'duration_desc', opts: { offset: 25 } },
        { id: 'rowKazakh', sort: 'rating_desc' }
    ];

    if (isBrowsePage) {
        await initPersonalRows();
        scheduleRowLoad(rowCalls);
    } else {
        rowCalls.forEach(call => fetchRow(call.id, call.sort, call.opts || {}));
    }

    setupMarquee();
});

function scheduleRowLoad(calls) {
    if (!Array.isArray(calls) || calls.length === 0) return;

    const eagerCount = 3;
    calls.forEach((call, index) => {
        if (index < eagerCount) {
            fetchRow(call.id, call.sort, call.opts || {});
        }
    });

    const lazyCalls = calls.slice(eagerCount);
    if (lazyCalls.length === 0) return;

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const targetId = entry.target?.id;
                const match = lazyCalls.find(call => call.id === targetId);
                if (match) {
                    fetchRow(match.id, match.sort, match.opts || {});
                }
                obs.unobserve(entry.target);
            });
        }, { root: null, rootMargin: '200px 0px', threshold: 0.1 });

        lazyCalls.forEach(call => {
            const el = document.getElementById(call.id);
            if (el) observer.observe(el);
        });
        return;
    }

    lazyCalls.forEach((call, index) => {
        setTimeout(() => {
            fetchRow(call.id, call.sort, call.opts || {});
        }, index * 120);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initHeroPreferencesPanel();
    initHoverModalInteractions();
});

async function fetchRow(containerId, sortType, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const {
        limit = 20,
        offset = 0,
        genre = '',
        year = 1900,
        actor = '',
        director = ''
    } = options;

    try {
        const params = new URLSearchParams({
            sort: sortType,
            limit: String(limit),
            offset: String(offset),
            year: String(year)
        });

        if (genre) params.set('genre', genre);
        if (actor) params.set('actor', actor);
        if (director) params.set('director', director);

        const baseUrl = `http://localhost:3000/movies/library?${params.toString()}`;
        const source = window.getMovieSource ? window.getMovieSource() : 'local';
        const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
        const res = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
        const movies = await res.json();

        container.innerHTML = movies.map(movie => createCard(movie)).join('');
    } catch (err) {
        console.error("Error fetching row:", err);
    }
}

async function initPersonalRows() {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
    if (!isBrowsePage) return;

    await Promise.all([
        loadMyListRow(),
        loadHistoryRow()
    ]);
}

async function loadMyListRow() {
    const section = document.getElementById('myListRowSection');
    const container = document.getElementById('rowMyList');
    if (!section || !container) return;

    const list = JSON.parse(localStorage.getItem('myList') || '[]');
    if (!Array.isArray(list) || list.length === 0) {
        section.style.display = 'none';
        return;
    }

    const movies = await fetchMoviesByIds(list.slice(0, 12));
    if (movies.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = movies.map(movie => createCard(movie)).join('');
}

async function loadHistoryRow() {
    const section = document.getElementById('historyRowSection');
    const container = document.getElementById('rowHistory');
    if (!section || !container) return;

    const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    const recent = JSON.parse(localStorage.getItem('recentMovieClicks') || '[]');
    const history = Array.from(new Set([...(prefs.clickedMovies || []), ...recent]));

    if (!Array.isArray(history) || history.length === 0) {
        section.style.display = 'none';
        return;
    }

    const movies = await fetchMoviesByIds(history.slice(0, 12));
    if (movies.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = movies.map(movie => createCard(movie)).join('');
}

async function fetchMoviesByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const uniqueIds = Array.from(new Set(ids.map(id => String(id))));

    const requests = uniqueIds.map(id => {
        const baseUrl = `http://localhost:3000/movie/${id}`;
        const requestUrl = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
        return fetch(requestUrl).then(res => res.ok ? res.json() : null);
    });

    const results = await Promise.allSettled(requests);
    return results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
}

function createCard(movie) {
    const plusIconSVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6v-2z" fill="currentColor"/></svg>`;
    const year = movie.release_date ? String(movie.release_date).slice(-4) : (movie.Year || '----');
    const runtime = movie.Runtime || '-- min';
    const rating = movie.Rating || movie.imdb_rating || '--';
    const plot = movie.Plot || 'No plot summary available.';

    return `
        <div class="grid-card" data-id="${movie.ID}" data-title="${movie['Movie Name']}" data-year="${year}" data-runtime="${runtime}" data-rating="${rating}" data-plot="${plot}" onmouseenter="handleCardHover(this)" onmouseleave="handleCardLeave(this)">
            <img src="${movie.poster_full_url}" loading="lazy" onclick="window.location.href='movieInfo.html?id=${movie.ID}'" onerror="this.src='/img/LOGO_Short.png'">
            <div class="card-hover-info">
                <div class="hover-preview">
                    <iframe class="card-trailer" title="Trailer" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
                </div>
                <div class="hover-meta">
                    <div class="hover-meta-title">${movie['Movie Name']}</div>
                    <div class="hover-meta-stats">
                        <span>⭐ ${rating}</span>
                        <span>${year}</span>
                        <span>${runtime}</span>
                    </div>
                    <p class="hover-meta-desc">${plot}</p>
                    <div class="hover-meta-actions">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">▶</button>
                        <a class="hover-info" href="movieInfo.html?id=${movie.ID}">More Info</a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.handleCardHover = async function(card) {
    if (!card) return;
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer) return;

    if (window.__hoverModalHideTimer) {
        clearTimeout(window.__hoverModalHideTimer);
        window.__hoverModalHideTimer = null;
    }

    if (window.__hoverModalShowTimer) {
        clearTimeout(window.__hoverModalShowTimer);
        window.__hoverModalShowTimer = null;
    }

    window.__hoverCardTarget = card;

    window.__hoverModalShowTimer = setTimeout(async () => {
        if (window.__hoverCardTarget !== card) return;

        const title = card.dataset.title || 'Title';
        const year = card.dataset.year || '----';
        const runtime = card.dataset.runtime || '-- min';
        const rating = card.dataset.rating || '--';
        const plot = card.dataset.plot || 'No plot summary available.';
        const movieId = card.dataset.id || '';

        const titleEl = document.getElementById('hoverModalTitle');
        const ratingEl = document.getElementById('hoverModalRating');
        const yearEl = document.getElementById('hoverModalYear');
        const runtimeEl = document.getElementById('hoverModalRuntime');
        const descEl = document.getElementById('hoverModalDesc');

        if (titleEl) titleEl.textContent = title;
        if (ratingEl) ratingEl.textContent = `⭐ ${rating}`;
        if (yearEl) yearEl.textContent = year;
        if (runtimeEl) runtimeEl.textContent = runtime;
        if (descEl) descEl.textContent = plot;

        const moreInfo = document.getElementById('hoverModalMoreInfo');
        if (moreInfo) {
            moreInfo.href = movieId ? `movieInfo.html?id=${movieId}` : 'movieInfo.html';
        }

        modal.classList.add('active');

        if (card.dataset.trailerId) {
            modalTrailer.src = `https://www.youtube.com/embed/${card.dataset.trailerId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${card.dataset.trailerId}&rel=0`;
            return;
        }

        if (!window.fetchYTId) return;

        try {
            const tId = await window.fetchYTId(title);
            if (tId) {
                card.dataset.trailerId = tId;
                modalTrailer.src = `https://www.youtube.com/embed/${tId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${tId}&rel=0`;
            }
        } catch (err) {
            console.warn('Trailer fetch failed:', err);
        }
    }, 3000);
};

window.handleCardLeave = function(card) {
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer) return;

    if (window.__hoverCardTarget === card) {
        window.__hoverCardTarget = null;
    }

    if (window.__hoverModalShowTimer) {
        clearTimeout(window.__hoverModalShowTimer);
        window.__hoverModalShowTimer = null;
    }

    if (!window.__hoverModalHovered) {
        window.__hoverModalHideTimer = setTimeout(() => {
            modal.classList.remove('active');
            modalTrailer.src = '';
        }, 120);
    }
};

function initHoverModalInteractions() {
    const modal = document.getElementById('hoverModal');
    const modalTrailer = document.getElementById('hoverModalTrailer');
    if (!modal || !modalTrailer) return;

    modal.addEventListener('mouseenter', () => {
        window.__hoverModalHovered = true;
        if (window.__hoverModalHideTimer) {
            clearTimeout(window.__hoverModalHideTimer);
            window.__hoverModalHideTimer = null;
        }
    });

    modal.addEventListener('mouseleave', () => {
        window.__hoverModalHovered = false;
        if (window.__hoverModalHideTimer) {
            clearTimeout(window.__hoverModalHideTimer);
        }
        window.__hoverModalHideTimer = setTimeout(() => {
            modal.classList.remove('active');
            modalTrailer.src = '';
        }, 120);
    });
}

// --- MARQUEE LOGIC ---
async function setupMarquee() {
    const marquee = document.getElementById('promoMarquee');
    if (!marquee) return;

    const baseUrl = `http://localhost:3000/movies/library?limit=20`;
    const source = window.getMovieSource ? window.getMovieSource() : 'local';
    const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
    const res = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
    const movies = await res.json();

    const combined = [...movies, ...movies]; 

    marquee.innerHTML = combined.map(m => `
        <div class="marquee-card">
            <img src="${m.poster_full_url}" alt="Poster">
        </div>
    `).join('');
}
// --- SIGNUP MODAL LOGIC ---
// --- ON PAGE LOAD: CHECK FOR USER ---
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('username')) {
        const promo = document.querySelector('.promo-section');
        if (promo) promo.style.display = 'none';
    }

    const user = localStorage.getItem('username');
    if (user && !sessionStorage.getItem('greeted')) {
        setTimeout(() => {
            const toast = document.getElementById('notification-toast');
            if (toast) {
                toast.innerText = `Hello again, ${user}!`;
                toast.classList.remove('toast-hidden');
                setTimeout(() => toast.classList.add('toast-hidden'), 3000);
            }
        }, 1000);
        sessionStorage.setItem('greeted', 'true');
    }
});

// --- MODAL CONTROLS ---
function openSignupModal() {
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; 
    }
}

function closeSignupModal() {
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto'; 
    }
}

// Close if clicking outside the box
const signupModal = document.getElementById('signupModal');
if (signupModal) {
    signupModal.addEventListener('click', (e) => {
        if (e.target.id === 'signupModal') closeSignupModal();
    });
}

// --- SIGNUP LOGIC  ---
function handleSignup(e) {
    e.preventDefault(); 
    
    const usernameInput = document.getElementById('signupUser');
    const emailInput = document.getElementById('signupEmail');
    const tierInput = document.getElementById('signupTier'); 
    const passInput = document.getElementById('signupPassword');
    
    const username = usernameInput ? usernameInput.value : "Guest";
    const email = emailInput ? emailInput.value : "email@example.com";
    const tier = tierInput ? tierInput.value : "Free"; 
    const password = passInput ? passInput.value : "";
    
    const btn = document.querySelector('.btn-signup');
    const userLanguage = localStorage.getItem('userLanguage') || (window.i18n ? window.i18n.getCurrentLanguage() : 'en');
    const originalText = btn ? btn.innerText : "Create Account";
    
    if (btn) {
        btn.innerText = "Creating Account...";
        btn.style.opacity = "0.7";
        btn.disabled = true;
    }
    
    setTimeout(async () => {
        try {
            const res = await fetch('http://localhost:3000/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    userEmail: email,
                    userTier: tier,
                    userPassword: password,
                    userLanguage
                })
            });

            if (!res.ok) {
                const msg = await res.json().catch(() => ({}));
                showLimitToast(msg.error || 'Registration failed');
                if (btn) {
                    btn.innerText = originalText;
                    btn.style.opacity = "1";
                    btn.disabled = false;
                }
                return;
            }

            const result = await res.json();
            const user = result.user || result;
            if (result.token) {
                localStorage.setItem('authToken', result.token);
            }

            localStorage.setItem('username', user.username);
            localStorage.setItem('userUID', String(user.userUID));
            localStorage.setItem('userEmail', user.userEmail);
            localStorage.setItem('userTier', user.userTier || tier);
            localStorage.setItem('allUIDs', JSON.stringify(user.allUIDs || []));
            localStorage.setItem('userLanguage', user.userLanguage || userLanguage);
            localStorage.setItem('isAdmin', user.isAdmin ? 'true' : 'false');
            
            localStorage.setItem('searchCount', '0');
            localStorage.setItem('viewCount', '0');
        } catch (err) {
            console.error('Registration error:', err);
            showLimitToast('Registration failed');
            if (btn) {
                btn.innerText = originalText;
                btn.style.opacity = "1";
                btn.disabled = false;
            }
            return;
        }

        closeSignupModal();
        
        const toast = document.getElementById('notification-toast');
        if(toast) {
            toast.innerText = `Welcome ${username}! You are now a ${tier} member.`;
            toast.classList.remove('toast-hidden');
            setTimeout(() => toast.classList.add('toast-hidden'), 4000);
        } else {
            alert(`Welcome ${username}! Your ${tier} account is ready.`);
        }
        
        // CLEANUP UI
        if (btn) {
            btn.innerText = originalText;
            btn.style.opacity = "1";
            btn.disabled = false;
        }
        
        const promo = document.querySelector('.promo-section');
        if(promo) {
            promo.style.display = 'none';
        }
        
        sessionStorage.setItem('greeted', 'true');

        safeReload();
        
    }, 1500);
}
window.navigateToMovie = function(movieId) {
    window.location.href = `movieInfo.html?id=${movieId}`;
};

// Helper to get movie source, fallback to local only if manually picked or API fails
function getMovieSource() {
    const src = localStorage.getItem('movieSource');
    return src === 'local' ? 'local' : 'api';
}

 
function checkUsageLimit(type) {
    const tier = localStorage.getItem('userTier') || 'Free';
    const searches = parseInt(localStorage.getItem('searchCount') || '0');
    const views = parseInt(localStorage.getItem('viewCount') || '0');

    if (tier === 'Gold') return true; 

    if (type === 'search') {
        const limit = tier === 'Premium' ? 50 : 5;
        if (searches >= limit) {
            alert("Search limit reached! Upgrade to Premium or Gold for more.");
            return false;
        }
        localStorage.setItem('searchCount', (searches + 1).toString());
    }

    if (type === 'view') {
        const limit = tier === 'Premium' ? 20 : 3;
        if (views >= limit) {
            alert("Movie view limit reached!");
            return false;
        }
        localStorage.setItem('viewCount', (views + 1).toString());
    }
    return true;
}
// This function handles opening AND closing the sidebar
console.log("✅ MAIN PAGE CONTROLS LOADED");

// Persist current user stats to backend
window.persistUserStats = function() {
    const username = localStorage.getItem('username');
    const userUID = localStorage.getItem('userUID');
    if (!username || !userUID) return;

    const payload = {
        username,
        userUID: parseInt(userUID, 10),
        userEmail: localStorage.getItem('userEmail') || '',
        userTier: localStorage.getItem('userTier') || 'Free',
        userLanguage: localStorage.getItem('userLanguage') || 'en',
        searchCount: parseInt(localStorage.getItem('searchCount') || '0', 10),
        viewCount: parseInt(localStorage.getItem('viewCount') || '0', 10),
        allUIDs: JSON.parse(localStorage.getItem('allUIDs') || '[]')
    };

    const token = localStorage.getItem('authToken');
    if (!token) return;

    fetch('http://localhost:3000/users', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    }).catch(err => console.error('User stats save error:', err));
};

function safeReload() {
    location.reload();
}

function ensureSignInModal() {
    if (document.getElementById('signInModal')) return;

    const modal = document.createElement('div');
    modal.id = 'signInModal';
    modal.className = 'signup-overlay';
    modal.innerHTML = `
        <div class="signup-box">
            <div class="signup-close" onclick="closeSignInModal()">✕</div>
            <h2>Welcome Back</h2>
            <p class="signup-subtitle">Sign in to continue your stats.</p>
            <form onsubmit="handleSignIn(event)">
                <div class="input-group">
                    <input type="email" id="signInEmail" required placeholder=" ">
                    <label>Email Address</label>
                </div>
                <div class="input-group">
                    <input type="password" id="signInPassword" required placeholder=" ">
                    <label>Password</label>
                </div>
                <button type="submit" class="btn-signup">Sign In</button>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
}

window.openSignInModal = function() {
    ensureSignInModal();
    const modal = document.getElementById('signInModal');
    if (modal) modal.classList.add('active');
};

window.closeSignInModal = function() {
    const modal = document.getElementById('signInModal');
    if (modal) modal.classList.remove('active');
};

window.handleSignIn = async function(e) {
    e.preventDefault();
    const emailInput = document.getElementById('signInEmail');
    const passInput = document.getElementById('signInPassword');
    const userEmail = emailInput ? emailInput.value.trim() : '';
    const userPassword = passInput ? passInput.value : '';

    if (!userEmail || !userPassword) {
        showLimitToast('Enter email and password');
        return;
    }

    try {
        const res = await fetch('http://localhost:3000/users/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userEmail, userPassword })
        });

        if (!res.ok) {
            showLimitToast('Invalid email or password');
            return;
        }

        const result = await res.json();
        const user = result.user || result;
        if (result.token) {
            localStorage.setItem('authToken', result.token);
        }
        localStorage.setItem('username', user.username || '');
        localStorage.setItem('userUID', String(user.userUID || 0));
        localStorage.setItem('userEmail', user.userEmail || userEmail);
        localStorage.setItem('userTier', user.userTier || 'Free');
        localStorage.setItem('userLanguage', user.userLanguage || (localStorage.getItem('userLanguage') || 'en'));
        localStorage.setItem('searchCount', String(user.searchCount || 0));
        localStorage.setItem('viewCount', String(user.viewCount || 0));
        localStorage.setItem('allUIDs', JSON.stringify(user.allUIDs || []));
        localStorage.setItem('isAdmin', user.isAdmin ? 'true' : 'false');

        closeSignInModal();
        safeReload();
    } catch (err) {
        console.error('Sign-in error:', err);
        showLimitToast('Sign-in failed');
    }
};

window.toggleAccountMenu = function() {
    console.log("🎯 CLICK DETECTED: Running toggleAccountMenu...");

    const dropdown = document.getElementById('accountDropdown');
    
    if (!dropdown) {
        console.error("❌ ERROR: Could not find id='accountDropdown'.");
        return;
    }

    // Toggle visibility
    dropdown.classList.toggle('active');

    if (dropdown.classList.contains('active')) {
        const username = localStorage.getItem('username');
        const tier = localStorage.getItem('userTier') || "Free";
        const searches = parseInt(localStorage.getItem('searchCount')) || 0;
        const views = parseInt(localStorage.getItem('viewCount')) || 0;
        const isAdmin = localStorage.getItem('isAdmin') === 'true';

        // --- AUTH CHECK: Disable/Enable Settings and Logout ---
        const settingsLink = dropdown.querySelector('a[onclick="openSettings()"]');
        const logoutLink = dropdown.querySelector('a[onclick="logout()"]');
        const signInLink = dropdown.querySelector('#signInLink');
        const signUpLink = dropdown.querySelector('#signUpLink');
        const isSignedIn = !!username;

        if (!isSignedIn) {
            if (settingsLink) settingsLink.classList.add('link-disabled');
            if (logoutLink) logoutLink.classList.add('link-disabled');
            if (signInLink) signInLink.style.display = '';
            if (signUpLink) signUpLink.style.display = '';
            if (document.getElementById('navUsername')) document.getElementById('navUsername').innerText = "Guest";
        } else {
            if (settingsLink) settingsLink.classList.remove('link-disabled');
            if (logoutLink) logoutLink.classList.remove('link-disabled');
            if (signInLink) signInLink.style.display = 'none';
            if (signUpLink) signUpLink.style.display = 'none';
            if (document.getElementById('navUsername')) document.getElementById('navUsername').innerText = username;
        }

        // --- UPDATE STATS (Using IDs from your snippet) ---
        const sLimit = tier === 'Premium' ? 50 : (tier === 'Gold' ? '∞' : 5);
        const vLimit = tier === 'Premium' ? 20 : (tier === 'Gold' ? '∞' : 3);

        if (document.getElementById('dropTier')) document.getElementById('dropTier').innerText = tier + " Tier";
        if (document.getElementById('statSearch')) document.getElementById('statSearch').innerText = `${searches}/${sLimit}`;
        if (document.getElementById('statView')) document.getElementById('statView').innerText = `${views}/${vLimit}`;

        const existingAdminLink = dropdown.querySelector('#adminPanelLink');
        if (isAdmin && !existingAdminLink) {
            const adminLink = document.createElement('a');
            adminLink.id = 'adminPanelLink';
            adminLink.href = '/html/admin.html';
            adminLink.className = 'drop-link';
            adminLink.innerText = 'Admin Panel';

            const settingsLinkAnchor = dropdown.querySelector('a[onclick="openSettings()"]');
            if (settingsLinkAnchor && settingsLinkAnchor.parentNode) {
                settingsLinkAnchor.parentNode.insertBefore(adminLink, settingsLinkAnchor);
            } else {
                dropdown.appendChild(adminLink);
            }
        }

        if (!isAdmin && existingAdminLink) {
            existingAdminLink.remove();
        }
    }
};

// Create an alias so the "X" button (toggleSidebar) also works
window.toggleSidebar = window.toggleAccountMenu;

window.logout = function() {
    window.persistUserStats();
    localStorage.clear();
    safeReload();
};
// Stop the menu from closing itself when you click inside it
document.addEventListener('DOMContentLoaded', () => {
    const dropdown = document.getElementById('accountDropdown');
    if (dropdown) {
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation(); 
        });
    }
});
function showLimitToast(message) {
    const existing = document.querySelector('.limit-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'limit-toast';
    toast.innerHTML = `
        <span>${message}</span>
        <div class="toast-progress"></div>
    `;

    document.body.appendChild(toast);

    const progressBar = toast.querySelector('.toast-progress');
    progressBar.style.animation = 'progressShrink 3s linear forwards';

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = '0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}
// THE UPLOAD HANDLER (auto resize too)
window.handlePFPUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 150; 
            const scaleSize = MAX_WIDTH / img.width;
            
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            const smallBase64 = canvas.toDataURL('image/jpeg', 0.7);
            
            localStorage.setItem('userPFP', smallBase64);
            
            applyPFPToUI(smallBase64);
            
            console.log("Image resized and saved!");
        };
        img.src = e.target.result;
    };
    
    reader.readAsDataURL(file);
};

// Function to apply the image to all PFP icons on the page
function applyPFPToUI(imagePath) {
    if (!imagePath) return;

    const navPFP = document.querySelector('.grey-profile-pic');
    const sidebarPFP = document.getElementById('sidebarPFP');

    if (navPFP) navPFP.style.backgroundImage = `url(${imagePath})`;
    if (sidebarPFP) sidebarPFP.style.backgroundImage = `url(${imagePath})`;
}

// Initialize PFP on page load
document.addEventListener('DOMContentLoaded', () => {
    const savedName = localStorage.getItem('username');

    if (savedName) {
        if (document.getElementById('navUsername')) {
            document.getElementById('navUsername').innerText = savedName;
        }
        if (document.getElementById('sideUsername')) {
            document.getElementById('sideUsername').innerText = savedName;
        }
    }
    if (typeof ensureSignInModal === 'function') ensureSignInModal();
});


// PEN THE SETTINGS MODAL
window.openSettings = function() {
    if (!localStorage.getItem('username')) {
        showLimitToast("⚠️ Sign in to access settings!");
        return;
    }
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('active');
        loadCurrentSettings();
    }
};

window.getMovieSource = function() {
    return localStorage.getItem('movieSource') || 'local';
};

window.withMovieSource = function(url) {
    const source = window.getMovieSource ? window.getMovieSource() : 'local';
    if (source !== 'api') return url;
    return `${url}${url.includes('?') ? '&' : '?'}source=api`;
};

// Load current settings into the modal
function loadCurrentSettings() {
    const currentTheme = localStorage.getItem('userTheme') || 'dark';
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === currentTheme) {
            btn.classList.add('active');
        }
    });
    
    const lowDataMode = localStorage.getItem('lowDataMode') === 'true';
    const lowDataCheckbox = document.getElementById('lowDataMode');
    if (lowDataCheckbox) lowDataCheckbox.checked = lowDataMode;

    const settingsLang = document.getElementById('settingsLanguage');
    if (settingsLang) {
        const currentLang = localStorage.getItem('userLanguage') || (window.i18n ? window.i18n.getCurrentLanguage() : 'en');
        settingsLang.value = currentLang;
    }

    const settingsSource = document.getElementById('settingsMovieSource');
    if (settingsSource) {
        settingsSource.value = localStorage.getItem('movieSource') || 'local';
    }
    
}

window.selectThemeInSettings = function(themeName) {
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === themeName) {
            btn.classList.add('active');
        }
    });
    
    if (window.themeManager) {
        window.themeManager.applyTheme(themeName);
    }
    
    showLimitToast(`✨ ${themeName.charAt(0).toUpperCase() + themeName.slice(1)} theme applied!`);
};

window.toggleLowDataMode = function() {
    const checkbox = document.getElementById('lowDataMode');
    const enabled = checkbox.checked;
    localStorage.setItem('lowDataMode', enabled);
    window.dispatchEvent(new CustomEvent('lowDataModeChanged', { detail: { enabled } }));
    
    showLimitToast(enabled ? "📶 Low Data Mode enabled" : "📶 Low Data Mode disabled");
};

window.logout = function() {
    if (!localStorage.getItem('username')) return; 
    if (window.persistUserStats) window.persistUserStats();
    localStorage.clear();
    safeReload();
};
//CLOSE THE SETTINGS MODAL
window.closeSettings = function() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.classList.remove('active');
};

//SAVE ACCOUNT CHANGES
window.saveSettings = function() {
    const newName = document.getElementById('settingsUsername').value;
    const passInput = document.getElementById('settingsPassword');
    const emailInput = document.getElementById('settingsEmail');

    if (newName.trim() !== "") {
        localStorage.setItem('username', newName);
        
        const navName = document.getElementById('navUsername');
        const sideName = document.getElementById('sideUsername');
        
        if (navName) navName.innerText = newName;
        if (sideName) sideName.innerText = newName;
        
        console.log("Username updated to:", newName);
    }

    if (emailInput && emailInput.value.trim() !== "") {
        localStorage.setItem('userEmail', emailInput.value);
    }
    
    closeSettings();
    if (window.persistUserStats) window.persistUserStats();
    showLimitToast("✅ Settings Saved!");
};

// --- PFP LOGIC: Targeting Classes properly ---
 
 window.handlePFPUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    
    reader.onloadend = function() {
        const base64Image = reader.result;
        
        localStorage.setItem('userPFP', base64Image);
        
        applyPFPToUI(base64Image);
        
        if (typeof showLimitToast === "function") {
            showLimitToast("✅ Profile Picture Updated!");
        }
    };
    
    reader.readAsDataURL(file);
};
/* =========================================
   CUSTOM TOAST HELPER
   ========================================= */


function applyPFPToUI(imagePath) {
    if (!imagePath) return;

    const icons = document.querySelectorAll('.grey-profile-pic, .large-profile-icon');
    
    icons.forEach(icon => {
        icon.style.backgroundImage = `url('${imagePath}')`;
        icon.style.backgroundSize = 'cover';
        icon.style.backgroundPosition = 'center';
        icon.style.backgroundColor = 'transparent'; 
    });
}

// The Main 'Listener'
document.addEventListener('DOMContentLoaded', () => {
    console.log("🔄 App Initializing..."); 

    const savedPFP = localStorage.getItem('userPFP');
    if (savedPFP) {
        console.log("✅ Restoring PFP from storage");
        applyPFPToUI(savedPFP);
    } else {
        console.log("ℹ️ No PFP found in storage");
    }

    // 2. Restore Username
    const savedName = localStorage.getItem('username');
    const navName = document.getElementById('navUsername');
    if (savedName && navName) {
        navName.innerText = savedName;
    }
    
    // 3. Load other components if they exist
    if (typeof initHero === 'function') initHero();
    if (typeof loadReviews === 'function') loadReviews();
    updateCtaForGuest();
});

function updateCtaForGuest() {
    const ctaStrip = document.getElementById('ctaStrip');
    const primaryBtn = document.getElementById('ctaPrimaryBtn');
    const secondaryBtn = document.getElementById('ctaSecondaryBtn');
    if (!ctaStrip || !primaryBtn || !secondaryBtn) return;

    const userUID = parseInt(localStorage.getItem('userUID')) || 0;
    const username = localStorage.getItem('username');
    const isGuest = !username || username === 'Guest' || userUID === 0;

    if (isGuest) {
        primaryBtn.textContent = 'Create Account';
        primaryBtn.setAttribute('href', '#');
        primaryBtn.onclick = (e) => {
            e.preventDefault();
            if (typeof openSignupModal === 'function') openSignupModal();
        };

        secondaryBtn.textContent = 'Sign In';
        secondaryBtn.setAttribute('href', '#');
        secondaryBtn.onclick = (e) => {
            e.preventDefault();
            if (typeof openSignInModal === 'function') openSignInModal();
        };
    } else {
        primaryBtn.textContent = 'Go to Browse';
        primaryBtn.setAttribute('href', '/html/indexBrowse.html');
        primaryBtn.onclick = null;

        secondaryBtn.textContent = 'Open Public Library';
        secondaryBtn.setAttribute('href', '/html/customPlaylists.html');
        secondaryBtn.onclick = null;
    }
}

//  ssAVE SETTINGS BUTTON LOGIC
window.saveSettings = function() {
    // --- 1. Save Username ---
    const nameInput = document.getElementById('settingsUsername');
    if (nameInput) {
        const newName = nameInput.value;
        if (newName.trim() !== "") {
            localStorage.setItem('username', newName);
            
            const navName = document.getElementById('navUsername');
            if (navName) navName.innerText = newName;
        }
    }

    // --- Save Language ---
    const settingsLang = document.getElementById('settingsLanguage');
    if (settingsLang && settingsLang.value) {
        localStorage.setItem('userLanguage', settingsLang.value);
    }

    const prevSource = localStorage.getItem('movieSource') || 'local';
    const settingsSource = document.getElementById('settingsMovieSource');
    if (settingsSource && settingsSource.value) {
        localStorage.setItem('movieSource', settingsSource.value);
    }

    const settingsModal = document.getElementById('settingsModal') 
                       || document.querySelector('.settings-modal-overlay.active');
    
    if (settingsModal) {
        settingsModal.classList.remove('active');
    }

    const nextSource = localStorage.getItem('movieSource') || 'local';
    if (prevSource !== nextSource && typeof safeReload === 'function') {
        safeReload();
    }

    console.log("Settings Saved & Closed");
};
/* =========================================
   PUSH FORCEFULLY PFP SYNC FUNCTION
   ========================================= */
function syncProfilePic() {
    // 1. Get the raw text data from storage
    const savedPFP = localStorage.getItem('userPFP');
    
    if (!savedPFP) {
        console.log("No PFP found in storage.");
        return; 
    }

    const allProfileIcons = document.querySelectorAll('.grey-profile-pic, .large-profile-icon');

    allProfileIcons.forEach(icon => {
        icon.style.backgroundImage = `url('${savedPFP}')`;
        icon.style.backgroundSize = 'cover';       
        icon.style.backgroundPosition = 'center';   
        icon.style.backgroundColor = 'transparent';  
    });
    
    console.log("✅ PFP Force Synced!");
}

// CALL IT: Run ASAPPP  
syncProfilePic();

document.addEventListener('DOMContentLoaded', syncProfilePic);
/* =========================================
   UNIVERSAL TOAST NOTIFICATION (Self-Repairing)
========================================= */

// 1. Force-Inject the CSS  
(function injectToastStyles() {
    const styleId = 'toast-style-injection';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .custom-toast-popup {
                position: fixed;
                top: -100px;
                left: 50%;
                transform: translateX(-50%);
                background-color: #f96d00; /* Netflix Red */
                color: white;
                padding: 16px 32px;
                border-radius: 4px;
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                font-size: 16px;
                font-weight: bold;
                box-shadow: 0 4px 20px rgba(0,0,0,0.8);
                z-index: 2147483647; /* MAX POSSIBLE Z-INDEX (On top of everything) */
                transition: top 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                display: flex;
                align-items: center;
                gap: 12px;
                min-width: 300px;
                justify-content: center;
            }
            .custom-toast-popup.active {
                top: 40px;
            }
        `;
        document.head.appendChild(style);
        console.log("✅ Toast Styles Injected");
    }
})();

// 2. The Toast Function
window.showToast = function(message, isError = false) {
    const existing = document.querySelector('.custom-toast-popup');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'custom-toast-popup';
    
    const icon = isError ? '❌' : '✅';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    
    if (isError) {
        toast.style.borderLeft = "5px solid #ff4444"; // Red accent for errors
        toast.style.backgroundColor = "#1a1a1a";     // Darker background
    } else {
        toast.style.borderLeft = "5px solid #f96d00"; // Your signature Orange
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('active');
    }, 10);

    setTimeout(() => {
        toast.classList.remove('active');
        setTimeout(() => toast.remove(), 500); 
    }, 3500);
};

// MOBILE MENU TOGGLE(hbamburger)
 window.toggleMobileMenu = function() {
    const nav = document.getElementById('navLinks');
    const burger = document.querySelector('.hamburger');
    const overlay = document.querySelector('.nav-overlay');

    if (!nav) return;

    const isOpen = !nav.classList.contains('active');
    nav.classList.toggle('active', isOpen);
    if (overlay) {
        overlay.classList.toggle('active', isOpen);
    }

    if (burger) {
        burger.classList.toggle('toggle-burger', isOpen);
    }
};
/* =========================================
   MOBILE SWIPE LOGIC (Global Scope)
   ========================================= */

window.moveSlide = function(direction) {
    if (heroMovies.length === 0) return;

    currentSlide += direction;

    if (currentSlide >= heroMovies.length) {
        currentSlide = 0; 
    } else if (currentSlide < 0) {
        currentSlide = heroMovies.length - 1;
    }

    updateHero(); 
    updateDots();
};
let touchStartX = 0;
let touchEndX = 0;

function handleSwipe() {
    const swipeThreshold = 50; 
    const change = touchStartX - touchEndX;

    if (change > swipeThreshold) {
        moveSlide(1); 
    } else if (change < -swipeThreshold) {
        moveSlide(-1); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const heroSection = document.querySelector('.hero');
    if (heroSection) {
        heroSection.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        heroSection.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
    }
});
/* =========================================
   THEME AND LANGUAGE CONTROLS
   ========================================= */

function toggleSiteTheme() {
    const newTheme = window.themeManager.toggleTheme();
    updateThemeButton(newTheme);
}

function updateThemeButton(theme) {
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (!icon || !label) return;
    
    if (theme === 'dark') {
        icon.textContent = '🌙';
        label.textContent = 'Dark';
    } else {
        icon.textContent = '☀️';
        label.textContent = 'Light';
    }
}

// Initialize theme button on page load
window.addEventListener('DOMContentLoaded', () => {
    if (window.themeManager && typeof window.themeManager.getCurrentTheme === 'function') {
        const currentTheme = window.themeManager.getCurrentTheme();
        updateThemeButton(currentTheme);
    }
});

// Language selection functions
function toggleLanguageMenu() {
    const dropdown = document.getElementById('languageDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('active');
}

function selectLanguage(lang) {
    localStorage.setItem('userLanguage', lang);
    window.i18n.changeLanguage(lang);
    updateLanguageButton(lang);
    if (lang === 'ru') {
        console.log('🔤 Language switched to Russian');
    }
    if (window.translator && typeof window.translator.translatePageAuto === 'function') {
        if (lang === 'en') {
            if (typeof window.translator.resetAll === 'function') {
                window.translator.resetAll();
            }
            if (typeof window.translator.clearCache === 'function') {
                window.translator.clearCache();
            }
            if (typeof window.translator.setTargetLanguage === 'function') {
                window.translator.setTargetLanguage('EN');
            }
        } else {
            window.translator.translatePageAuto();
        }
    }
    toggleLanguageMenu();
}

function updateLanguageButton(lang) {
    const flags = {
        'en': { flag: '��🇧', code: 'EN' },
        'ru': { flag: '🇷🇺', code: 'RU' }
    };
    
    const currentFlag = document.getElementById('currentFlag');
    const currentLangCode = document.getElementById('currentLangCode');
    if (!currentFlag || !currentLangCode) return;
    
    if (flags[lang]) {
        currentFlag.textContent = flags[lang].flag;
        currentLangCode.textContent = flags[lang].code;
    }
    
    document.querySelectorAll('.language-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    const selectedOption = document.querySelector(`.language-option[onclick*="${lang}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
}

// Initialize language button on page load
window.addEventListener('DOMContentLoaded', () => {
    const currentLang = window.i18n.getCurrentLanguage();
    updateLanguageButton(currentLang);
    const settingsLang = document.getElementById('settingsLanguage');
    if (settingsLang) {
        settingsLang.value = currentLang;
    }
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.language-selector')) {
        const dropdown = document.getElementById('languageDropdown');
        if (dropdown) {
            dropdown.classList.remove('active');
        }
    }
});

console.log('✅ Theme and language controls loaded');

/* =========================================
   NETFLIX FEATURES INITIALIZATION
   ========================================= */

// Initialize continue watching section
function initContinueWatching() {
    if (window.WatchHistoryUI) {
        const continueWatchingItems = window.WatchHistory.getContinueWatching();
        const section = document.getElementById('continueWatchingSection');
        
        if (continueWatchingItems.length > 0 && section) {
            section.style.display = 'block';
            window.WatchHistoryUI.renderContinueWatching('rowContinueWatching');
        } else if (section) {
            section.style.display = 'none';
        }
    }
}

// Add to page initialization
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(initContinueWatching, 500);
});


function initHeroPreferencesPanel() {
    const isBrowsePage = window.location.pathname.includes('indexBrowse.html');
    if (!isBrowsePage) return;

    const tag = document.getElementById('heroTag');
    const panel = document.getElementById('heroPrefPanel');
    if (!tag || !panel) return;

    const PREFS_KEY = 'userPreferences';
    let hideTimer;

    const renderPanel = () => {
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        const genreClicks = prefs.genreClicks || {};
        const entries = Object.entries(genreClicks).sort((a, b) => b[1] - a[1]);

        if (entries.length === 0) {
            panel.innerHTML = '<span style="color:#888; font-size:0.85rem;">No genre history yet.</span>';
            return;
        }

        panel.innerHTML = entries.map(([genre, count]) => `
            <span class="hero-pref-chip" data-genre="${genre}">
                ${genre} <strong>${count}</strong>
                <button class="hero-pref-close" data-genre="${genre}" aria-label="Remove ${genre}">✕</button>
            </span>
        `).join('');
    };

    const showPanel = () => {
        clearTimeout(hideTimer);
        renderPanel();
        panel.classList.add('active');
    };

    const hidePanel = () => {
        hideTimer = setTimeout(() => {
            panel.classList.remove('active');
        }, 200);
    };

    tag.addEventListener('mouseenter', showPanel);
    tag.addEventListener('mouseleave', hidePanel);
    panel.addEventListener('mouseenter', showPanel);
    panel.addEventListener('mouseleave', hidePanel);

    panel.addEventListener('click', (event) => {
        const btn = event.target.closest('.hero-pref-close');
        if (!btn) return;

        const genre = btn.dataset.genre;
        if (!genre) return;

        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        if (prefs.genreClicks && prefs.genreClicks[genre] !== undefined) {
            delete prefs.genreClicks[genre];
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
            renderPanel();
        }
    });
}

// Refresh continue watching when user interacts with movies
window.addEventListener('movieViewed', () => {
    setTimeout(initContinueWatching, 1000);
});

