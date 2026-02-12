/* =========================================
   ENHANCED SEARCH WITH AUTOCOMPLETE
   ========================================= */

const EnhancedSearch = {
    searchTimeout: null,
    currentQuery: '',
    searchHistory: [],
    maxHistoryItems: 10,
    
    // Initialize enhanced search
    init() {
        this.loadSearchHistory();
        this.ensureResultsPortal();
        this.setupSearchInput();
        console.log('✅ Enhanced search initialized');
    },

    ensureResultsPortal() {
        const resultsMenu = document.getElementById('searchResults');
        if (!resultsMenu) return;
        if (resultsMenu.parentElement !== document.body) {
            document.body.appendChild(resultsMenu);
        }
        resultsMenu.classList.add('search-results-modal');
    },
    
    setupSearchInput() {
        const searchInput = document.getElementById('mainSearch');
        if (!searchInput) return;
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            this.handleSearch(query);
        });
        
        // Show search history on focus
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim() === '') {
                this.showSearchHistory();
            }
        });
        
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = searchInput.value.trim();
                if (query) {
                    this.performFullSearch(query);
                }
            }
        });
    },
    
    handleSearch(query) {
        clearTimeout(this.searchTimeout);
        this.currentQuery = query;
        
        const resultsMenu = document.getElementById('searchResults');
        const searchBox = document.querySelector('.search-box');
        
        if (query.length === 0) {
            if (resultsMenu) {
                resultsMenu.classList.remove('active');
            }
            if (searchBox) {
                searchBox.classList.remove('expanded');
            }
            return;
        }
        
        if (searchBox) {
            searchBox.classList.add('expanded');
        }
        
        if (resultsMenu) {
            resultsMenu.classList.add('active');
            resultsMenu.innerHTML = `
                <div class="search-loading">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text"></div>
                </div>
            `;
        }
        
        this.searchTimeout = setTimeout(() => {
            this.performSearch(query);
        }, 300);
    },
    
    async performSearch(query) {
        try {
            const baseUrl = `http://localhost:3000/search?q=${encodeURIComponent(query)}`;
            const response = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
            const movies = await response.json();
            
            this.displayResults(movies, query);
            
            // Add to search history
            this.addToHistory(query);
        } catch (error) {
            console.error('Search error:', error);
            const resultsMenu = document.getElementById('searchResults');
            if (resultsMenu) {
                resultsMenu.innerHTML = `
                    <div class="search-error">
                        <p style="color: var(--error-color); padding: 20px; text-align: center;">
                            ${window.i18n.t('notif_error')}
                        </p>
                    </div>
                `;
            }
        }
    },
    
    displayResults(movies, query) {
        const resultsMenu = document.getElementById('searchResults');
        if (!resultsMenu) return;
        
        if (movies.length === 0) {
            resultsMenu.innerHTML = `
                <div class="search-empty">
                    <p style="color: var(--text-muted); padding: 20px; text-align: center;">
                        No results found for "${query}"
                    </p>
                    ${this.getSearchSuggestions(query)}
                </div>
            `;
            return;
        }
        
        resultsMenu.innerHTML = movies.map(movie => `
            <div class="search-item" onclick="EnhancedSearch.selectMovie('${movie.ID}')">
                ${(() => {
                    // For local DB, use poster_full_url and fallback to hiding image if missing
                    if (window.getMovieSource && window.getMovieSource() === 'local') {
                        if (movie.poster_full_url) {
                            return `<img src=\"${movie.poster_full_url}\" alt=\"${movie['Movie Name']}\" onerror=\\"this.style.display='none'\\">`;
                        } else {
                            return '';
                        }
                    } else {
                        // For API/external, fallback to LOGO_Short
                        let poster = movie.Poster || '/img/LOGO_Short.png';
                        return `<img src=\"${poster}\" alt=\"${movie['Movie Name']}\" onerror=\\"this.src='/img/LOGO_Short.png'\\">`;
                    }
                })()}
                <div class="search-info">
                    <h5>${this.highlightQuery(movie['Movie Name'], query)}</h5>
                    ${(() => {
                        if (window.getMovieSource && window.getMovieSource() === 'local') {
                            // Hide year and N/A for local DB
                            let genre = movie.Genre || '';
                            let rating = movie.Rating ? `• ⭐ ${movie.Rating}` : '';
                            return `<p>${genre} ${rating}</p>`;
                        } else {
                            return `<p>${movie.Year || 'N/A'} • ${movie.Genre || 'Unknown'} • ⭐ ${movie.Rating || 'N/A'}</p>`;
                        }
                    })()}
                </div>
            </div>
        `).join('');
    },
    
    // Highlight query in results
    highlightQuery(text, query) {
        if (!text || !query) return text;
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark style="background: var(--accent-primary); color: white; padding: 2px 4px; border-radius: 2px;">$1</mark>');
    },
    
    // Get search suggestions
    getSearchSuggestions(query) {
        const suggestions = [
            'Try using different keywords',
            'Check your spelling',
            'Try searching for actors or directors',
            'Browse by genre instead'
        ];
        
        return `
            <div class="search-suggestions" style="padding: 10px 20px; border-top: 1px solid var(--border-light);">
                <p style="color: var(--text-secondary); margin-bottom: 10px; font-size: 0.9rem;">Suggestions:</p>
                <ul style="list-style: none; color: var(--text-muted); font-size: 0.85rem;">
                    ${suggestions.map(s => `<li style="padding: 4px 0;">• ${s}</li>`).join('')}
                </ul>
            </div>
        `;
    },
    
    // Select movie from search results
    selectMovie(movieId) {
        const resultsMenu = document.getElementById('searchResults');
        if (resultsMenu) {
            resultsMenu.classList.remove('active');
        }
        
        const searchInput = document.getElementById('mainSearch');
        if (searchInput) {
            searchInput.value = '';
            searchInput.blur();
        }
        
        if (window.openMovieById) {
            window.openMovieById(movieId);
        } else {
            window.location.href = `/html/movieInfo.html?id=${movieId}`;
        }
    },
    
    // Perform full search (navigate to search results page)
    performFullSearch(query) {
        this.addToHistory(query);
        window.location.href = `/html/searchQueryResult.html?q=${encodeURIComponent(query)}`;
    },
    
    loadSearchHistory() {
        try {
            const history = localStorage.getItem('searchHistory');
            this.searchHistory = history ? JSON.parse(history) : [];
        } catch (error) {
            this.searchHistory = [];
        }
    },
    
    saveSearchHistory() {
        localStorage.setItem('searchHistory', JSON.stringify(this.searchHistory));
    },
    
    addToHistory(query) {
        if (!query || query.length < 2) return;
        
        this.searchHistory = this.searchHistory.filter(item => item !== query);
        
        this.searchHistory.unshift(query);
        
        if (this.searchHistory.length > this.maxHistoryItems) {
            this.searchHistory = this.searchHistory.slice(0, this.maxHistoryItems);
        }
        
        this.saveSearchHistory();
    },
    
    clearHistory() {
        this.searchHistory = [];
        this.saveSearchHistory();
    },
    
    showSearchHistory() {
        const resultsMenu = document.getElementById('searchResults');
        if (!resultsMenu || this.searchHistory.length === 0) return;
        
        resultsMenu.classList.add('active');
        resultsMenu.innerHTML = `
            <div class="search-history">
                <div class="search-history-header" style="padding: 15px 20px; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--text-secondary); font-size: 0.9rem; font-weight: 600;">Recent Searches</span>
                    <button onclick="EnhancedSearch.clearHistory(); this.parentElement.parentElement.remove();" 
                            style="background: none; border: none; color: var(--accent-primary); cursor: pointer; font-size: 0.85rem;">
                        Clear
                    </button>
                </div>
                ${this.searchHistory.map(query => `
                    <div class="search-history-item" 
                         onclick="document.getElementById('mainSearch').value = '${query}'; EnhancedSearch.performSearch('${query}');"
                         style="padding: 12px 20px; cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background 0.2s;">
                        <span style="color: var(--text-primary);">🕒 ${query}</span>
                    </div>
                `).join('')}
            </div>
        `;
        
        const historyItems = resultsMenu.querySelectorAll('.search-history-item');
        historyItems.forEach(item => {
            item.addEventListener('mouseenter', function() {
                this.style.background = 'rgba(255, 255, 255, 0.05)';
            });
            item.addEventListener('mouseleave', function() {
                this.style.background = 'transparent';
            });
        });
    }
};

// Advanced search filters
const SearchFilters = {
    filters: {
        year: null,
        genre: null,
        rating: null,
        duration: null
    },
    applyFilters(movies) {
        let filtered = [...movies];
        
        if (this.filters.year) {
            filtered = filtered.filter(m => {
                const year = parseInt(m.Year || m.release_date?.split('-')[0] || 0);
                return year >= this.filters.year.min && year <= this.filters.year.max;
            });
        }
        
        if (this.filters.genre) {
            filtered = filtered.filter(m => 
                m.Genre && m.Genre.toLowerCase().includes(this.filters.genre.toLowerCase())
            );
        }
        
        if (this.filters.rating) {
            filtered = filtered.filter(m => 
                parseFloat(m.Rating || 0) >= this.filters.rating
            );
        }
        
        if (this.filters.duration) {
            filtered = filtered.filter(m => {
                const runtime = parseInt(m.Runtime || 0);
                return runtime >= this.filters.duration.min && runtime <= this.filters.duration.max;
            });
        }
        
        return filtered;
    },
    
    setFilter(type, value) {
        this.filters[type] = value;
    },
    
    clearFilter(type) {
        this.filters[type] = null;
    },
    
    // Clear all filters
    clearAllFilters() {
        this.filters = {
            year: null,
            genre: null,
            rating: null,
            duration: null
        };
    }
};

// Voice search (experimental)
const VoiceSearch = {
    recognition: null,
    
    // Initialize voice search
    init() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech recognition not supported in this browser.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        let timeoutId = null;
        let isActive = false;

        this.recognition.onresult = (event) => {
            let transcript = event.results[0][0].transcript;
            // Remove trailing period if present
            transcript = transcript.replace(/[.。]+$/, '');
            console.log('Recognized speech:', transcript);
            const searchInput = document.getElementById('mainSearch');
            if (searchInput) {
                searchInput.value = transcript;
                EnhancedSearch.handleSearch(transcript);
            }
            this.stop();
        };

        this.recognition.onerror = (event) => {
            console.error("Voice error:", event.error);
            this.stop();
        };

        this.recognition.onend = () => {
            isActive = false;
            this.updateButtonColor(false);
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            console.log('🎤 Recognition ended');
        };

        // Connect the microphone button
        const voiceBtn = document.getElementById('voiceSearchBtn');
        if (voiceBtn) {
            voiceBtn.addEventListener('click', () => {
                if (isActive) {
                    this.stop();
                } else {
                    this.start();
                }
            });
            console.log('🎤 Voice search connected to button');
        } else {
            console.warn('❌ Could not find #voiceSearchBtn in the HTML');
        }
        this.voiceBtn = voiceBtn;
    },

    // Start voice search
    start() {
        if (this.recognition && !this.recognition._isStarted) {
            try {
                this.recognition.start();
                this.recognition._isStarted = true;
                this.updateButtonColor(true);
                // Timeout after 3 seconds of no speech
                this.timeoutId = setTimeout(() => {
                    if (this.recognition && this.recognition._isStarted) {
                        this.stop();
                        console.log('⏰ Voice search timed out (no speech)');
                    }
                }, 3000);
                console.log('🎤 Listening...');
            } catch (e) {
                console.error("Could not start voice recognition:", e);
            }
        }
    },

    // Stop voice search
    stop() {
        if (this.recognition && this.recognition._isStarted) {
            this.recognition.stop();
            this.recognition._isStarted = false;
            this.updateButtonColor(false);
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
        }
    },

    // Update mic button color
    updateButtonColor(active) {
        if (this.voiceBtn) {
            const svg = this.voiceBtn.querySelector('svg path');
            if (svg) {
                svg.setAttribute('fill', active ? '#ff9800' : '#888');
            }
        }
    },

    // Start voice search
    start() {
        if (this.recognition) {
            // Prevent calling start if already running
            if (this.recognition._isStarted) {
                console.warn('Recognition already started.');
                return;
            }
            try {
                this.recognition.start();
                this.recognition._isStarted = true;
                console.log('🎤 Listening...');
            } catch (e) {
                console.error("Could not start voice recognition:", e);
            }
            // Reset _isStarted when recognition ends
            this.recognition.onend = () => {
                this.recognition._isStarted = false;
                console.log('🎤 Recognition ended');
            };
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        EnhancedSearch.init();
        VoiceSearch.init();
    });
} else {
    EnhancedSearch.init();
    VoiceSearch.init();
}

// Export for use in other scripts
window.EnhancedSearch = EnhancedSearch;
window.SearchFilters = SearchFilters;
window.VoiceSearch = VoiceSearch;

console.log('Enhanced search module nicely loaded');
