/* TMDB Frontend Config */
window.TMDB_API_KEY = 'f4705f0e34fafba5ccef5cc38a703fc5';
window.TMDB_BASE_URL = 'https://api.themoviedb.org/3';
window.TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

window.tmdbBuildUrl = function(path, params = {}) {
    const url = new URL(`${window.TMDB_BASE_URL}${path}`);
    url.searchParams.set('api_key', window.TMDB_API_KEY);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    return url.toString();
};

console.log('✅ TMDB frontend config loaded');