(function checkAccess() {
    const user = localStorage.getItem('username');
    
    if (!user) {
        // Create the UI block immediately
        const lockMarkup = `
            <div class="locked-overlay">
                <div class="locked-box">
                    <div class="lock-icon" style="font-size: 50px; margin-bottom: 20px;">🔒</div>
                    <h2>Private Collection</h2>
                    <p style="display: block;margin-bottom: 10px;">This list is only available to registered members.</p>
                    <a href="indexMain.html#promoMarquee">
                        <button class="btn-locked-signin">Sign In / Join</button>
                    </a>
                    <br><br>
                    <a href="indexMain.html" style="color: #666; font-size: 13px; text-decoration: none;">← Back to Home</a>
                </div>
            </div>
        `;

        const injectLock = () => {
            document.body.innerHTML = lockMarkup;
            document.body.style.overflow = 'hidden';
        };

        // If body is ready, inject now. If not, wait for it.
        if (document.body) injectLock();
        else window.addEventListener('DOMContentLoaded', injectLock);

        const keepLocked = () => {
            if (!document.querySelector('.locked-overlay')) {
                injectLock();
            }
        };

        setInterval(keepLocked, 1000);
        
        // STOPPPPPPPPP PLS
        throw new Error("Access Denied: Redirecting to Login UI");
    }
})();


// -----------------------------above is the blocking mechanism, below loading movies goes-----------------------------\\
document.addEventListener('DOMContentLoaded', async () => {
    const username = localStorage.getItem('username');
    const userUID = parseInt(localStorage.getItem('userUID')) || 0;
    const titleElement = document.querySelector('.list-title');
    
    if (username && titleElement) {
        titleElement.innerText = `${username}'s List`;
    }

    const grid = document.getElementById('myListGrid');
    const savedIds = JSON.parse(localStorage.getItem('myList')) || [];

    // If list is empty, just make the suers see add btn
    if (savedIds.length === 0) return; 

    try {
        const baseUrl = 'https://localhost:3000/movies/get-list';
        const requestUrl = window.withMovieSource ? window.withMovieSource(baseUrl) : baseUrl;
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: savedIds })
        });
        const movies = await response.json();

        const movieHtml = movies.map(movie => `
            <div class="grid-card">
                <img src="${movie.poster_full_url}" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">
                
                <div class="card-hover-info">
                    <div class="hover-btns">
                        <button class="hover-play" onclick="window.location.href='movieInfo.html?id=${movie.ID}'">▶</button>
                        
                        <button class="hover-remove" style="padding-top: 3px;" onclick="removeFromList('${movie.ID}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="25px" height="25px" viewBox="0 0 24 24" fill="#f96d00">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M5.29289 5.29289C5.68342 4.90237 6.31658 4.90237 6.70711 5.29289L12 10.5858L17.2929 5.29289C17.6834 4.90237 18.3166 4.90237 18.7071 5.29289C19.0976 5.68342 19.0976 6.31658 18.7071 6.70711L13.4142 12L18.7071 17.2929C19.0976 17.6834 19.0976 18.3166 18.7071 18.7071C18.3166 19.0976 17.6834 19.0976 17.2929 18.7071L12 13.4142L6.70711 18.7071C6.31658 19.0976 5.68342 19.0976 5.29289 18.7071C4.90237 18.3166 4.90237 17.6834 5.29289 17.2929L10.5858 12L5.29289 6.70711C4.90237 6.31658 4.90237 5.68342 5.29289 5.29289Z" fill="#f96d00"/>
                          
                            </svg>
                        </button>
                    </div>

                    <div class="info-text">
                        <h4>${movie['Movie Name']}</h4>
                        <span class="match-score">IMDb ${movie.Rating}</span>
                    </div>
                </div>
            </div>
        `).join('');
        
        grid.insertAdjacentHTML('afterbegin', movieHtml);
        
    } catch (err) { console.error(err); }

    // --- Render owner playlists under My List ---
    const playlistsGrid = document.getElementById('myPlaylistsGrid');
    if (!playlistsGrid || userUID === 0) return;

    try {
        const res = await fetch('https://localhost:3000/playlists');
        const playlists = await res.json();
        const owned = (playlists || []).filter(p => parseInt(p.ownerUID, 10) === userUID);

        if (!owned || owned.length === 0) {
            playlistsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">No playlists yet. Create one to get started!</p>';
        } else {
            const html = owned.map(p => {
                const poster = (p.movies && p.movies[0] && p.movies[0].poster) ? p.movies[0].poster : '/img/LOGO_Short.png';
                const count = (p.movies || []).length;
                return `
                    <div class="playlist-item" onclick="window.location.href='customPlaylists.html'" style="display: flex; gap: 12px; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border: 1px solid var(--border-color);">
                        <img src="${poster}" onerror="this.src='/img/LOGO_Short.png'" style="width: 60px; height: 90px; border-radius: 6px; object-fit: cover;">
                        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                            <h4 style="margin: 0 0 5px 0; font-size: 1rem; color: var(--text-primary);">${p.name}</h4>
                            <span style="font-size: 0.85rem; color: var(--text-muted);">${count} movies</span>
                        </div>
                    </div>
                `;
            }).join('');

            playlistsGrid.innerHTML = html;
        }
    } catch (err) {
        console.error('Playlist load error:', err);
        playlistsGrid.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Could not load playlists.</p>';
    }

    await loadRecentPosts(userUID);
});

// Load recent forum posts for the user
async function loadRecentPosts(userUID) {
    const container = document.getElementById('recentPostsContainer');
    if (!container || userUID === 0) return;

    const API_BASE = window.location.origin.includes('localhost') 
        ? 'https://localhost:3000' 
        : window.location.origin;

    try {
        const response = await fetch(`${API_BASE}/forum/movies`);
        const forumMovies = await response.json();
        
        const threadPromises = forumMovies.map(async (movie) => {
            try {
                const threadsRes = await fetch(`${API_BASE}/forum/threads?movieId=${movie.movieId}`);
                const threads = await threadsRes.json();
                
                return threads
                    .filter(t => parseInt(t.userUID) === userUID)
                    .map(t => ({ ...t, movieTitle: movie.movieTitle, movieId: movie.movieId }));
            } catch (err) {
                console.error(`Error fetching threads for movie ${movie.movieId}:`, err);
                return [];
            }
        });

        const threadArrays = await Promise.all(threadPromises);
        const userThreads = threadArrays.flat();

        userThreads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const recentThreads = userThreads.slice(0, 5);

        if (recentThreads.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">No forum posts yet. Share your thoughts on the forum!</p>';
            return;
        }

        container.innerHTML = recentThreads.map(thread => {
            const timeAgo = formatTimeAgo(thread.createdAt);
            return `
                <div class="post-item" onclick="window.location.href='/html/forum.html'" style="padding: 12px; background: var(--bg-tertiary); border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: start; gap: 10px; margin-bottom: 8px;">
                        <span style="font-size: 1.2rem;">💬</span>
                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; color: var(--text-primary); font-weight: 600;">${escapeHtml(thread.title)}</h4>
                            <p style="margin: 0 0 6px 0; font-size: 0.85rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                                ${escapeHtml(thread.description || '').substring(0, 100)}${thread.description && thread.description.length > 100 ? '...' : ''}
                            </p>
                            <div style="display: flex; gap: 12px; font-size: 0.8rem; color: var(--text-muted);">
                                <span>🎬 ${escapeHtml(thread.movieTitle)}</span>
                                <span>📅 ${timeAgo}</span>
                                <span>💬 ${thread.commentCount || 0} comments</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading recent posts:', err);
        container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">Could not load recent posts.</p>';
    }
}

// Format time ago
function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// HTML escape function
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---   GLOBAL REMOVE FUNCTION ---
window.removeFromList = function(id) {
    let list = JSON.parse(localStorage.getItem('myList')) || [];
    
    list = list.filter(item => String(item) !== String(id));
    
    localStorage.setItem('myList', JSON.stringify(list));
    
    location.reload(); 
};