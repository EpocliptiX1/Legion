/* TMDB Frontend Config — API key is kept server-side via /api/tmdb-proxy */
window.TMDB_BASE_URL = '/api/tmdb-proxy';
window.TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

window.tmdbBuildUrl = function(path, params = {}) {
    const url = new URL(`${window.location.origin}${window.TMDB_BASE_URL}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    return url.toString();
};

console.log('✅ TMDB frontend config loaded');