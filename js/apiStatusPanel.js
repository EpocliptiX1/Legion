// Enhanced API Status Panel for Settings
(function() {
    async function checkTmdbApiStatus(circle, text) {
        text.textContent = 'Checking...';
        circle.style.background = '#aaa';
        try {
            const res = await fetch('/api/tmdb-key-status');
            const data = await res.json();
            if (data.valid) {
                circle.style.background = '#3ec46d';
                text.textContent = 'Online';
            } else {
                circle.style.background = '#e74c3c';
                text.textContent = 'Offline';
            }
        } catch (err) {
            circle.style.background = '#e74c3c';
            text.textContent = 'Error';
        }
    }

    async function checkYoutubeApiStatus(circle, text) {
        text.textContent = 'Checking...';
        circle.style.background = '#aaa';
        try {
            const res = await fetch('/api/youtube-key-status');
            const data = await res.json();
            if (data.valid) {
                circle.style.background = '#3ec46d';
                text.textContent = 'Online';
            } else {
                circle.style.background = '#e74c3c';
                let errorMsg = 'Offline';
                if (data.error) {
                    if (typeof data.error === 'string') {
                        errorMsg = 'Offline: ' + data.error;
                    } else if (typeof data.error === 'object' && data.error.message) {
                        errorMsg = 'Offline: ' + data.error.message;
                    }
                }
                text.textContent = errorMsg;
            }
        } catch (err) {
            circle.style.background = '#e74c3c';
            text.textContent = 'Error';
        }
    }

    async function checkLibreTranslateStatus(circle, text) {
        text.textContent = 'Checking...';
        circle.style.background = '#aaa';
        try {
            const url = '/translate';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: 'hello', target_lang: 'es' })
            });
            const data = await res.json();
            if (res.ok && data.translations && data.translations[0] && data.translations[0].text) {
                circle.style.background = '#3ec46d';
                text.textContent = 'Online';
            } else {
                circle.style.background = '#e74c3c';
                text.textContent = 'Offline';
            }
        } catch (err) {
            circle.style.background = '#e74c3c';
            text.textContent = 'Error';
        }
    }

    function createStatusRow(label, circleId, textId) {
        return `<div class="api-status-row"><span class="api-status-label">${label}</span><span id="${circleId}" class="api-status-circle"></span><span id="${textId}" class="api-status-text">Checking...</span></div>`;
    }

    // Local Database status: online if no external API is used/enabled, otherwise offline
    function checkLocalDatabaseStatus(circle, text) {
        // Assume TMDB API is the external API; if it's offline, local DB is online
        const tmdbCircle = document.getElementById('tmdbApiStatusCircle');
        const tmdbOnline = tmdbCircle && tmdbCircle.style.background === 'rgb(62, 196, 109)';
        if (tmdbOnline) {
            circle.style.background = '#e74c3c';
            text.textContent = 'Offline';
        } else {
            circle.style.background = '#3ec46d';
            text.textContent = 'Online';
        }
    }

    // Cloud Sync API: always unavailable
    function checkCloudSyncStatus(circle, text) {
        circle.style.background = '#aaa';
        text.textContent = 'Unavailable';
    }

    function injectApiStatusPanel() {
        // 1. If a .api-status-panel exists (admin.html), inject rows there
        const adminPanel = document.querySelector('.api-status-panel');
        if (adminPanel && adminPanel.children.length === 0) {
            adminPanel.innerHTML =
                createStatusRow('TMDB API', 'tmdbApiStatusCircle', 'tmdbApiStatusText') +
                createStatusRow('YouTube API', 'ytApiStatusCircle', 'ytApiStatusText') +
                createStatusRow('LibreTranslate', 'ltApiStatusCircle', 'ltApiStatusText') +
                createStatusRow('Local Database', 'localDbStatusCircle', 'localDbStatusText') +
                createStatusRow('Cloud Sync', 'cloudSyncStatusCircle', 'cloudSyncStatusText');
            setTimeout(() => {
                checkTmdbApiStatus(
                    document.getElementById('tmdbApiStatusCircle'),
                    document.getElementById('tmdbApiStatusText')
                );
                checkYoutubeApiStatus(
                    document.getElementById('ytApiStatusCircle'),
                    document.getElementById('ytApiStatusText')
                );
                checkLibreTranslateStatus(
                    document.getElementById('ltApiStatusCircle'),
                    document.getElementById('ltApiStatusText')
                );
                checkLocalDatabaseStatus(
                    document.getElementById('localDbStatusCircle'),
                    document.getElementById('localDbStatusText')
                );
                checkCloudSyncStatus(
                    document.getElementById('cloudSyncStatusCircle'),
                    document.getElementById('cloudSyncStatusText')
                );
            }, 200);
        }
        // 2. Otherwise, fallback to settings-item label search (all settings pages, not just indexBrowse)
        const allSettings = document.querySelectorAll('.setting-item');
        allSettings.forEach(item => {
            const label = item.querySelector('label');
            if (label && label.textContent.trim().toLowerCase().includes('tmdb global database') && !item.querySelector('.api-status-panel')) {
                // Change label text to 'Service Availability Checker'
                label.textContent = 'Service Availability Checker';
                // Remove all children except the label
                Array.from(item.children).forEach(child => {
                    if (child !== label) item.removeChild(child);
                });
                // Insert new status panel
                const panel = document.createElement('div');
                panel.className = 'api-status-panel';
                panel.innerHTML =
                    createStatusRow('TMDB API', 'tmdbApiStatusCircle', 'tmdbApiStatusText') +
                    createStatusRow('YouTube API', 'ytApiStatusCircle', 'ytApiStatusText') +
                    createStatusRow('LibreTranslate', 'ltApiStatusCircle', 'ltApiStatusText') +
                    createStatusRow('Local Database', 'localDbStatusCircle', 'localDbStatusText') +
                    createStatusRow('Cloud Sync', 'cloudSyncStatusCircle', 'cloudSyncStatusText');
                item.appendChild(panel);
                // Style
                item.style.display = 'block';
                item.style.padding = '32px 0 24px 0';
                // Run checks
                setTimeout(() => {
                    checkTmdbApiStatus(
                        document.getElementById('tmdbApiStatusCircle'),
                        document.getElementById('tmdbApiStatusText')
                    );
                    checkYoutubeApiStatus(
                        document.getElementById('ytApiStatusCircle'),
                        document.getElementById('ytApiStatusText')
                    );
                    checkLibreTranslateStatus(
                        document.getElementById('ltApiStatusCircle'),
                        document.getElementById('ltApiStatusText')
                    );
                    // Local DB and Cloud Sync
                    checkLocalDatabaseStatus(
                        document.getElementById('localDbStatusCircle'),
                        document.getElementById('localDbStatusText')
                    );
                    checkCloudSyncStatus(
                        document.getElementById('cloudSyncStatusCircle'),
                        document.getElementById('cloudSyncStatusText')
                    );
                }, 200);
            }
        });
        // Add CSS if not present
        if (!document.getElementById('api-status-style')) {
            const style = document.createElement('style');
            style.id = 'api-status-style';
            style.textContent = `
                .api-status-panel {
                    display: flex;
                    flex-direction: column;
                    gap: 22px;
                    align-items: flex-start;
                    margin: 32px 0 0 0;
                }
                .api-status-row {
                    display: flex;
                    align-items: center;
                    gap: 18px;
                    font-size: 1.13em;
                }
                .api-status-label {
                    min-width: 140px;
                    color: #e0e0e0;
                    font-weight: 500;
                    letter-spacing: 0.02em;
                }
                .api-status-circle {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    display: inline-block;
                    background: #aaa;
                    border: 2px solid #333;
                }
                .api-status-text {
                    margin-left: 8px;
                    color: #aaa;
                    font-size: 1em;
                    min-width: 70px;
                }
            `;
            document.head.appendChild(style);
        }
    }

    document.addEventListener('DOMContentLoaded', injectApiStatusPanel);
})();
