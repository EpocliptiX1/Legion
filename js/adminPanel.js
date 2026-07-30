// --- TMDB API KEY STATUS CHECK ---
async function checkTmdbApiStatus() {
    const circle = document.getElementById('tmdbApiStatusCircle');
    const text = document.getElementById('tmdbApiStatusText');
    if (!circle || !text) return;
    text.textContent = 'Checking...';
    circle.style.background = '#aaa';
    try {
        const res = await fetch('/api/tmdb-key-status');
        const data = await res.json();
        if (data.valid) {
            circle.style.background = '#3ec46d';
            text.textContent = 'Valid';
        } else {
            circle.style.background = '#e74c3c';
            text.textContent = 'Invalid';
        }
    } catch (err) {
        circle.style.background = '#e74c3c';
        text.textContent = 'Error';
    }
}

window.addEventListener('DOMContentLoaded', checkTmdbApiStatus);
const adminMessage = document.getElementById('adminMessage');
const adminContent = document.getElementById('adminContent');
const statsGrid = document.getElementById('statsGrid');
const usersSummary = document.getElementById('usersSummary');
const tierTable = document.getElementById('tierTable');
const reviewsSummary = document.getElementById('reviewsSummary');
const topReviewers = document.getElementById('topReviewers');
const playlistsSummary = document.getElementById('playlistsSummary');
const playlistTop = document.getElementById('playlistTop');
const forumSummary = document.getElementById('forumSummary');
const forumTop = document.getElementById('forumTop');
const likesSummary = document.getElementById('likesSummary');
const likesTable = document.getElementById('likesTable');
const moviesSummary = document.getElementById('moviesSummary');
const refreshBtn = document.getElementById('refreshStats');

let chartUserTiers;
let chartEngagement;
let chartVotes;

function showMessage(text) {
    if (!adminMessage) return;
    adminMessage.style.display = 'block';
    adminMessage.innerText = text;
}

function hideMessage() {
    if (!adminMessage) return;
    adminMessage.style.display = 'none';
    adminMessage.innerText = '';
}

function formatNumber(value) {
    const num = Number(value || 0);
    return new Intl.NumberFormat().format(num);
}

function renderTable(headers, rows) {
    if (!rows || rows.length === 0) {
        return '<div class="admin-empty">No data available.</div>';
    }
    const head = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const body = rows.map(row => `<tr>${row.map(col => `<td>${col}</td>`).join('')}</tr>`).join('');
    return `<table>${head}${body}</table>`;
}

function renderStatsCards(stats) {
    const cards = [
        { label: 'Total Users', value: formatNumber(stats.users.total) },
        { label: 'Admins', value: formatNumber(stats.users.admins) },
        { label: 'Movies', value: formatNumber(stats.movies.total) },
        { label: 'Total Clicks', value: formatNumber(stats.movies.totalClicks) },
        { label: 'Reviews', value: formatNumber(stats.reviews.total) },
        { label: 'Playlists', value: formatNumber(stats.playlists.total) },
        { label: 'Forum Threads', value: formatNumber(stats.forum.threadsTotal) },
        { label: 'Total Likes', value: formatNumber(stats.likes.total) }
    ];

    statsGrid.innerHTML = cards.map(card => (
        `<div class="admin-card"><h3>${card.label}</h3><div class="admin-value">${card.value}</div></div>`
    )).join('');
}

function renderUsers(stats) {
    const tiers = stats.users.byTier || {};
    const rows = Object.keys(tiers).sort().map(tier => [
        tier,
        formatNumber(tiers[tier])
    ]);

    usersSummary.innerHTML = `Total Searches: <span class="admin-pill">${formatNumber(stats.users.totalSearches)}</span> &nbsp; Total Views: <span class="admin-pill">${formatNumber(stats.users.totalViews)}</span>`;
    tierTable.innerHTML = renderTable(['Tier', 'Users'], rows);
}

function renderReviews(stats) {
    reviewsSummary.innerHTML = `Average Rating: <span class="admin-pill">${stats.reviews.averageStars}</span>`;
    const rows = (stats.reviews.topReviewers || []).map(item => [item.user, formatNumber(item.count)]);
    topReviewers.innerHTML = renderTable(['User', 'Reviews'], rows);
}

function renderMovies(stats) {
    if (!moviesSummary) return;
    moviesSummary.innerHTML = `Local database movies: <span class="admin-pill">${formatNumber(stats.movies.total)}</span> &nbsp; Total clicks: <span class="admin-pill">${formatNumber(stats.movies.totalClicks)}</span>`;
}

function renderPlaylists(stats) {
    playlistsSummary.innerHTML = `Votes: <span class="admin-pill">${formatNumber(stats.playlists.votes.total)}</span> &nbsp; Comments: <span class="admin-pill">${formatNumber(stats.playlists.comments.total)}</span> &nbsp; Movies inside playlists: <span class="admin-pill">${formatNumber(stats.playlists.totalMovies)}</span>`;
    const rows = (stats.playlists.topByScore || []).map(item => [item.name, formatNumber(item.score)]);
    playlistTop.innerHTML = renderTable(['Playlist', 'Score'], rows);
}

function renderForum(stats) {
    forumSummary.innerHTML = `Forum Movies: <span class="admin-pill">${formatNumber(stats.forum.moviesTotal)}</span> &nbsp; Votes: <span class="admin-pill">${formatNumber(stats.forum.votes.total)}</span> &nbsp; Comments: <span class="admin-pill">${formatNumber(stats.forum.comments.total)}</span>`;
    const rows = (stats.forum.topThreads || []).map(item => [item.title, formatNumber(item.score)]);
    forumTop.innerHTML = renderTable(['Thread', 'Score'], rows);
}

function renderLikes(stats) {
    likesSummary.innerHTML = `Total Like Events: <span class="admin-pill">${formatNumber(stats.likes.total)}</span>`;
    const rows = (stats.likes.items || []).map(item => [
        item.type,
        item.entityName || item.parentName || '-',
        item.entityId,
        item.userUID,
        item.vote
    ]);
    likesTable.innerHTML = renderTable(['Type', 'Entity', 'Entity ID', 'User UID', 'Vote'], rows);
}

function renderCharts(stats) {
    const ctxUserTiers = document.getElementById('chartUserTiers');
    const ctxEngagement = document.getElementById('chartEngagement');
    const ctxVotes = document.getElementById('chartVotes');

    if (ctxUserTiers) {
        const tiers = stats.users.byTier || {};
        const tierLabels = Object.keys(tiers);
        const tierValues = tierLabels.map(label => tiers[label]);

        if (chartUserTiers) chartUserTiers.destroy();
        chartUserTiers = new Chart(ctxUserTiers, {
            type: 'doughnut',
            data: {
                labels: tierLabels,
                datasets: [{
                    data: tierValues,
                    backgroundColor: ['#6ae4ff', '#7f9dff', '#f7c843', '#f2758b', '#8bffbd']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#e6e9f2' } }
                }
            }
        });
    }

    if (ctxEngagement) {
        if (chartEngagement) chartEngagement.destroy();
        chartEngagement = new Chart(ctxEngagement, {
            type: 'bar',
            data: {
                labels: ['Searches', 'Views', 'Clicks'],
                datasets: [{
                    label: 'Total',
                    data: [stats.users.totalSearches, stats.users.totalViews, stats.movies.totalClicks],
                    backgroundColor: ['#6ae4ff', '#7f9dff', '#f7c843']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#e6e9f2' } },
                    y: { ticks: { color: '#e6e9f2' } }
                },
                plugins: {
                    legend: { labels: { color: '#e6e9f2' } }
                }
            }
        });
    }

    if (ctxVotes) {
        if (chartVotes) chartVotes.destroy();
        chartVotes = new Chart(ctxVotes, {
            type: 'bar',
            data: {
                labels: ['Playlist Votes', 'Forum Votes', 'Like Events'],
                datasets: [{
                    label: 'Total',
                    data: [stats.playlists.votes.total, stats.forum.votes.total, stats.likes.total],
                    backgroundColor: ['#f7c843', '#6ae4ff', '#7f9dff']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#e6e9f2' } },
                    y: { ticks: { color: '#e6e9f2' } }
                },
                plugins: {
                    legend: { labels: { color: '#e6e9f2' } }
                }
            }
        });
    }
}

async function loadStats() {
    const token = localStorage.getItem('authToken');

    if (!token) {
        adminContent.style.display = 'none';
        showMessage('Access denied. Please sign in with an admin account.');
        return;
    }

    hideMessage();
    adminContent.style.display = 'block';

    try {
        const res = await fetch('/admin/stats', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to load stats');
        }

        const stats = await res.json();
        renderStatsCards(stats);
        renderUsers(stats);
        renderMovies(stats);
        renderReviews(stats);
        renderPlaylists(stats);
        renderForum(stats);
        renderLikes(stats);
        renderCharts(stats);
    } catch (err) {
        adminContent.style.display = 'none';
        showMessage(err.message || 'Unable to load admin stats.');
    }
}

if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadStats());
}

loadStats();

