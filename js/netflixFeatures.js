/* =========================================
   NETFLIX-LIKE FEATURES
   - Continue Watching
   - Watch History
   - Smart Recommendations
   - Recently Added
   ========================================= */

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Watch history manager
const WatchHistory = {
    getHistory() {
        try {
            const history = localStorage.getItem('watchHistory');
            return history ? JSON.parse(history) : [];
        } catch (error) {
            console.error('Error getting watch history:', error);
            return [];
        }
    },
    
    addEntry(movieId, movieTitle, poster, watchedPercentage = 0, genre = '') {
        try {
            const history = this.getHistory();
            const timestamp = new Date().toISOString();
            
            const existingIndex = history.findIndex(entry => entry.movieId === movieId);
            
            const entry = {
                movieId,
                movieTitle,
                poster,
                genre,
                watchedPercentage,
                lastWatched: timestamp,
                addedAt: existingIndex >= 0 ? history[existingIndex].addedAt : timestamp
            };
            
            if (existingIndex >= 0) {
                history[existingIndex] = entry;
            } else {
                history.unshift(entry);
            }
            
            const trimmedHistory = history.slice(0, 50);
            localStorage.setItem('watchHistory', JSON.stringify(trimmedHistory));
            
            return true;
        } catch (error) {
            console.error('Error adding to watch history:', error);
            return false;
        }
    },
    
    // Get continue watching items (watched > 5% and < 95%)
    getContinueWatching() {
        const history = this.getHistory();
        return history.filter(entry => 
            entry.watchedPercentage > 5 && entry.watchedPercentage < 95
        ).slice(0, 10);
    },
    
    // Get recently watched (all items, sorted by last watched)
    getRecentlyWatched(limit = 20) {
        return this.getHistory().slice(0, limit);
    },
    
    // Get fully watched movies
    getCompleted() {
        const history = this.getHistory();
        return history.filter(entry => entry.watchedPercentage >= 95);
    },
    
    // Remove entry from history
    removeEntry(movieId) {
        try {
            const history = this.getHistory();
            const filtered = history.filter(entry => entry.movieId !== movieId);
            localStorage.setItem('watchHistory', JSON.stringify(filtered));
            return true;
        } catch (error) {
            console.error('Error removing from watch history:', error);
            return false;
        }
    },
    
    // Clear all history
    clearHistory() {
        localStorage.removeItem('watchHistory');
    },
    
    // Get watch progress for a specific movie
    getProgress(movieId) {
        const history = this.getHistory();
        const entry = history.find(e => e.movieId === movieId);
        return entry ? entry.watchedPercentage : 0;
    },
    
    // Update watch progress
    updateProgress(movieId, percentage) {
        const history = this.getHistory();
        const entry = history.find(e => e.movieId === movieId);
        if (entry) {
            entry.watchedPercentage = Math.min(100, Math.max(0, percentage));
            entry.lastWatched = new Date().toISOString();
            localStorage.setItem('watchHistory', JSON.stringify(history));
        }
    }
};

// Recently added/trending manager
const TrendingManager = {
    trackView(movieId) {
        try {
            const views = this.getViews();
            const today = new Date().toISOString().split('T')[0];
            
            if (!views[movieId]) {
                views[movieId] = { count: 0, lastView: today, dailyViews: {} };
            }
            
            views[movieId].count += 1;
            views[movieId].lastView = today;
            views[movieId].dailyViews[today] = (views[movieId].dailyViews[today] || 0) + 1;
            
            localStorage.setItem('movieViews', JSON.stringify(views));
        } catch (error) {
            console.error('Error tracking view:', error);
        }
    },
    
    getViews() {
        try {
            const views = localStorage.getItem('movieViews');
            return views ? JSON.parse(views) : {};
        } catch (error) {
            return {};
        }
    },
    
    // Get trending movies (most viewed in last 7 days)
    getTrending(limit = 10) {
        const views = this.getViews();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];
        
        const trending = Object.entries(views)
            .map(([movieId, data]) => {
                const recentViews = Object.entries(data.dailyViews)
                    .filter(([date]) => date >= cutoffDate)
                    .reduce((sum, [, count]) => sum + count, 0);
                
                return { movieId, recentViews, totalViews: data.count };
            })
            .filter(item => item.recentViews > 0)
            .sort((a, b) => b.recentViews - a.recentViews)
            .slice(0, limit);
        
        return trending;
    }
};

// Smart recommendations based on watch history
const SmartRecommendations = {
    analyzePreferences() {
        const history = WatchHistory.getHistory();
        const preferences = {
            genres: {},
            recentGenres: {},
            averageWatchPercentage: 0
        };
        
        let totalPercentage = 0;
        
        history.forEach((entry, index) => {
            if (entry.genre) {
                const genres = entry.genre.split(',').map(g => g.trim());
                genres.forEach(genre => {
                    preferences.genres[genre] = (preferences.genres[genre] || 0) + 1;
                    
                    if (index < 10) {
                        preferences.recentGenres[genre] = (preferences.recentGenres[genre] || 0) + 1;
                    }
                });
            }
            
            totalPercentage += entry.watchedPercentage || 0;
        });
        
        preferences.averageWatchPercentage = history.length > 0 
            ? totalPercentage / history.length 
            : 0;
        
        preferences.topGenres = Object.entries(preferences.genres)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([genre]) => genre);
        
        return preferences;
    },
    
    async getRecommendations(limit = 20) {
        const preferences = this.analyzePreferences();
        
        if (preferences.topGenres.length === 0) {
            return this.getPopularMovies(limit);
        }
        
        const apiBase = window.location.hostname === 'localhost' 
            ? '' 
            : '';
        
        try {
            const promises = preferences.topGenres.map(genre =>
                (() => {
                    const baseUrl = `${apiBase}/movies/library?genre=${genre}&limit=${Math.ceil(limit / preferences.topGenres.length)}&sort=rating_desc`;
                    const source = window.getMovieSource ? window.getMovieSource() : 'local';
                    const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
                    return fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
                })()
                    .then(res => res.json())
            );
            
            const results = await Promise.all(promises);
            const movies = results.flat();
            
            const watchedIds = new Set(WatchHistory.getHistory().map(e => e.movieId));
            const unique = [];
            const seen = new Set();
            
            movies.forEach(movie => {
                if (!seen.has(movie.ID) && !watchedIds.has(movie.ID)) {
                    seen.add(movie.ID);
                    unique.push(movie);
                }
            });
            
            return unique.slice(0, limit);
        } catch (error) {
            console.error('Error getting recommendations:', error);
            return [];
        }
    },
    
    async getPopularMovies(limit = 20) {
        const apiBase = window.location.hostname === 'localhost' 
            ? '' 
            : '';
            
        try {
            const baseUrl = `${apiBase}/movies/library?limit=${limit}&sort=rating_desc`;
            const source = window.getMovieSource ? window.getMovieSource() : 'local';
            const hydratedUrl = source === 'api' ? `${baseUrl}&hydrate=1` : baseUrl;
            const response = await fetch(window.withMovieSource ? window.withMovieSource(hydratedUrl) : hydratedUrl);
            return await response.json();
        } catch (error) {
            console.error('Error getting popular movies:', error);
            return [];
        }
    }
};

// UI rendering functions
const WatchHistoryUI = {
    renderContinueWatching(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const items = WatchHistory.getContinueWatching();
        
        if (items.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center; padding: 20px;">No movies in progress</p>';
            return;
        }
        
        container.innerHTML = items.map(item => `
            <div class="movie-card" onclick="openMovieById('${escapeHtml(item.movieId)}')">
                <img src="${item.poster || '/img/LOGO_Short.png'}" alt="${escapeHtml(item.movieTitle)}">
                <div class="continue-watching-bar">
                    <div class="continue-watching-progress" style="width: ${item.watchedPercentage}%"></div>
                </div>
                <h4>${escapeHtml(item.movieTitle)}</h4>
                <p class="watch-progress">${Math.round(item.watchedPercentage)}% watched</p>
            </div>
        `).join('');
    },
    
    renderRecentlyWatched(containerId, limit = 10) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const items = WatchHistory.getRecentlyWatched(limit);
        
        if (items.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center; padding: 20px;">No watch history</p>';
            return;
        }
        
        container.innerHTML = items.map(item => `
            <div class="movie-card" onclick="openMovieById('${escapeHtml(item.movieId)}')">
                <img src="${item.poster || '/img/LOGO_Short.png'}" alt="${escapeHtml(item.movieTitle)}">
                ${item.watchedPercentage >= 95 ? '<div class="watched-indicator">✓ Watched</div>' : ''}
                <h4>${escapeHtml(item.movieTitle)}</h4>
                <p class="year">${new Date(item.lastWatched).toLocaleDateString()}</p>
            </div>
        `).join('');
    },
    
    // Render smart recommendations row
    async renderRecommendations(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = Array(6).fill(0).map(() => `
            <div class="skeleton skeleton-card"></div>
        `).join('');
        
        const movies = await SmartRecommendations.getRecommendations(12);
        
        if (movies.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center; padding: 20px;">No recommendations available</p>';
            return;
        }
        
        container.innerHTML = movies.map(movie => `
            <div class="movie-card" onclick="openMovieById('${escapeHtml(movie.ID)}')">
                <img src="${movie.Poster || '/img/LOGO_Short.png'}" alt="${escapeHtml(movie['Movie Name'])}">
                <h4>${escapeHtml(movie['Movie Name'])}</h4>
                <p class="year">${escapeHtml(movie.Year || 'N/A')} • ⭐ ${escapeHtml(movie.Rating || 'N/A')}</p>
            </div>
        `).join('');
    }
};

// Helper function to open movie by ID
window.openMovieById = async function(movieId) {
    try {
        const baseUrl = `/movie/${movieId}`;
        const response = await fetch(window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl);
        const movie = await response.json();
        
        if (movie) {
            TrendingManager.trackView(movieId);
            WatchHistory.addEntry(
                movieId,
                movie['Movie Name'],
                movie.Poster,
                0,
                movie.Genre
            );
            
            if (window.openMovie) {
                window.openMovie(movie);
            }
        }
    } catch (error) {
        console.error('Error opening movie:', error);
    }
};

window.WatchHistory = WatchHistory;
window.TrendingManager = TrendingManager;
window.SmartRecommendations = SmartRecommendations;
window.WatchHistoryUI = WatchHistoryUI;

console.log('✅ Netflix-like features loaded');

