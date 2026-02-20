// Handles movie player logic for movieInfo.html

document.addEventListener('DOMContentLoaded', function() {
    const watchNowBtn = document.getElementById('watchNowBtn');
    if (!watchNowBtn) return;

    // Insert player container if not present
    let playerSection = document.getElementById('moviePlayerSection');
    if (!playerSection) {
        playerSection = document.createElement('div');
        playerSection.id = 'moviePlayerSection';
        playerSection.style = 'width:100%;margin-top:32px;display:none;flex-direction:column;';
        playerSection.innerHTML = `
            <div style="background:#111;padding:24px;border-radius:16px;box-shadow:0 2px 24px #0007;display:flex;flex-direction:column;align-items:center;">
                <h2 style="color:#f96d00;margin-bottom:18px;font-size:2rem;align-self:flex-start;">Now Playing</h2>
                <div id="episodeSelector" style="display:none; gap:10px; margin-bottom:15px; flex-wrap:wrap; justify-content:center;">
                    <select id="seasonSelect" style="background:#222; color:#fff; padding:8px; border-radius:5px;"></select>
                    <select id="episodeSelect" style="background:#222; color:#fff; padding:8px; border-radius:5px;"></select>
                </div>
                <div id="audioSelector" style="display:none; gap:10px; margin-bottom:15px; justify-content:center;">
                    <button id="btnSub" class="audio-btn active" style="background:#f96d00;color:#fff;padding:8px 24px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">SUB</button>
                    <button id="btnDub" class="audio-btn" style="background:#222;color:#fff;padding:8px 24px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">DUB</button>
                </div>
                <div style="display:flex;gap:12px;margin-bottom:18px; flex-wrap:wrap; justify-content:center;">
                    <button id="server2embed" class="server-btn" style="background:#222;color:#fff;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">2Embed</button>
                    <button id="srvMega" class="server-btn active" style="background:#f96d00;color:#fff;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">MegaCloud (S1)</button>
                    <button id="srvUp" class="server-btn" style="background:#222;color:#fff;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">UpCloud (S2)</button>
                    <button id="srvT" class="server-btn" style="background:#222;color:#fff;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">T-Cloud (S3)</button>
                    <button id="serverSuperembed" class="server-btn" style="background:#222;color:#fff;padding:8px 18px;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">SuperEmbed</button>
                    <button id="serverVidlink" class="server-btn" style="background:linear-gradient(90deg,#0f2027,#2c5364,#00c6ff);color:#fff;padding:8px 18px;border:none;border-radius:12px;cursor:pointer;font-size:1rem;font-weight:bold;box-shadow:0 2px 8px #00c6ff55,0 1.5px 4px #0004;letter-spacing:1px;transition:background 0.2s,box-shadow 0.2s;">VidLink</button>
                </div>
                <div id="serverInfoText" style="min-height:28px;margin-bottom:10px;color:#bbb;font-size:1rem;text-align:center;"></div>
                <div id="moviePlayerFrameWrap" style="width:100%;aspect-ratio:16/9;max-width:100%;background:#000;border-radius:12px;overflow:hidden;">
                    <iframe id="moviePlayerFrame" src="" allowfullscreen allow="autoplay; encrypted-media;" frameborder="0" style="width:100%;height:700px;min-height:500px;border:none;"></iframe>
                    <video id="megacloudPlayer" controls style="width:100%;height:700px;min-height:500px;border:none;display:none;border-radius:12px;"></video>
                </div>
                
                <button id="closeMoviePlayer" style="margin-top:24px;background:#222;color:#fff;padding:12px 32px;border:none;border-radius:8px;cursor:pointer;font-size:1.1rem;">Close Player</button>
            </div>
        `;
        const movieContent = document.querySelector('.movie-content');
        if (movieContent && movieContent.parentNode) {
            movieContent.parentNode.insertBefore(playerSection, movieContent.nextSibling);
        } else {
            document.body.appendChild(playerSection);
        }
    }

    watchNowBtn.addEventListener('click', async function() {
        // --- 1. Get Params & Setup State ---
        const urlParams = new URLSearchParams(window.location.search);
        const tmdbId = urlParams.get('id');
        const type = (urlParams.get('type') || '').toLowerCase();
        
        if (!tmdbId) return alert('No movie/series id found in the URL!');

        let currentAudioMode = 'sub';
        let currentServer = 'srvMega'; // Hoisted to the top so audio buttons can access it
        let imdbId = ''; // Used later if it's a movie

        const genreText = document.getElementById('genre')?.innerText.toLowerCase() || "";
        const isAnime = type === 'anime' || genreText.includes('animation');
        const isSeries = (type === 'tv' || type === 'series' || isAnime);

        // --- 2. Setup Player UI ---
        playerSection.style.display = 'block';
        playerSection.scrollIntoView({behavior: 'smooth'});
        document.getElementById('moviePlayerFrame').style.display = 'block';
        document.getElementById('megacloudPlayer').style.display = 'none';

        const audioSelector = document.getElementById('audioSelector');
        if (audioSelector) audioSelector.style.display = isAnime ? 'flex' : 'none';

        const serverInfo = {
            server2embed: '2Embed: vpls, v srcc, vsrc (2embed one)',
            srvMega: 'MegaCloud (S1): autoembed.co',
            srvUp: 'UpCloud (S2): vidsrc.to',
            srvT: 'T-Cloud (S3): vidsrc.net',
            serverSuperembed: 'SuperEmbed: vipstream A, vidsrc, voe, vidstream B and S',
            serverVidlink: 'VidLink: Fast loading, fallback',
        };

        function showServerInfo(serverKey) {
            let info = serverInfo[serverKey] || '';
            if (isAnime && currentAudioMode === 'dub') {
                info += ' | Note: If English audio does not play automatically, click the 🎧/⚙️ icon inside the player to switch to Dub.';
            }
            const infoTextDiv = document.getElementById('serverInfoText');
            if (infoTextDiv) infoTextDiv.textContent = info;
        }

        // --- 3. The Master Source Updater ---
        function updateSource(server) {
            currentServer = server; // Save state
            
            let s = document.getElementById('seasonSelect')?.value || 1;
            let e = document.getElementById('episodeSelect')?.value || 1;
            let url = '';

            // Routing Logic
            if (server === 'srvMega') {
                url = isSeries ? `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}` : `https://autoembed.co/movie/tmdb/${tmdbId}`;
            } else if (server === 'srvUp') {
                url = isSeries ? `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}` : `https://vidsrc.to/embed/movie/${tmdbId}`;
            } else if (server === 'srvT') {
                url = isSeries ? `https://vidsrc.net/embed/tv?tmdb=${tmdbId}&season=${s}&episode=${e}` : `https://vidsrc.net/embed/movie?tmdb=${tmdbId}`;
            } else if (server === 'server2embed') {
                url = isSeries ? `https://www.2embed.cc/embed/tv/${tmdbId}/${s}/${e}` : `https://www.2embed.cc/embed/${imdbId}`;
            } else if (server === 'serverSuperembed') {
                url = isSeries ? `https://multiembed.mov/?video_id=tmdb-${tmdbId}-S${s}-E${e}` : `https://multiembed.mov/?video_id=${imdbId}`;
            } else if (server === 'serverVidlink') {
                url = isSeries ? `https://vidlink.pro/tv/${tmdbId}/${s}/${e}` : `https://vidlink.pro/movie/${imdbId}`;
            }

            // Append Dub parameters
            if (isAnime && currentAudioMode === 'dub' && url) {
                const paramStarter = url.includes('?') ? '&' : '?';
                url += `${paramStarter}audio=dub&lang=en&ds_lang=en`;
            }

            document.getElementById('moviePlayerFrame').src = url;

            // UI Styles
            document.querySelectorAll('.server-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === server);
                btn.style.background = (btn.id === server) ? '#f96d00' : '#222';
            });
            showServerInfo(server);
        }

        // --- 4. Button Event Listeners ---
        document.getElementById('btnSub').onclick = function() {
            currentAudioMode = 'sub';
            document.getElementById('btnSub').style.background = '#f96d00';
            document.getElementById('btnDub').style.background = '#222';
            updateSource(currentServer);
        };
        
        document.getElementById('btnDub').onclick = function() {
            currentAudioMode = 'dub';
            document.getElementById('btnDub').style.background = '#f96d00';
            document.getElementById('btnSub').style.background = '#222';
            updateSource(currentServer);
        };

        // Bind all server buttons natively
        ['srvMega', 'srvUp', 'srvT', 'server2embed', 'serverSuperembed', 'serverVidlink'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onclick = () => updateSource(id);
        });

        // --- 5. Fetch Content Data (Seasons or IMDb ID) ---
        const tmdbApiKey = 'f4705f0e34fafba5ccef5cc38a703fc5';
        
        if (isSeries) {
            try {
                const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbApiKey}`);
                const data = await res.json();
                
                let selectorDiv = document.getElementById('episodeSelector');
                if (selectorDiv && data.seasons) {
                    selectorDiv.style.display = 'flex';
                    const seasonSelect = document.getElementById('seasonSelect');
                    const episodeSelect = document.getElementById('episodeSelect');
                    
                    seasonSelect.innerHTML = data.seasons.filter(s => s.season_number > 0).map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('');
                    
                    const populateEpisodes = (sNum) => {
                        const season = data.seasons.find(s => s.season_number == sNum);
                        const count = season ? season.episode_count : 1;
                        episodeSelect.innerHTML = Array.from({length: count}, (_, i) => `<option value="${i+1}">Episode ${i+1}</option>`).join('');
                    };
                    
                    populateEpisodes(seasonSelect.value || 1);
                    
                    seasonSelect.onchange = () => { populateEpisodes(seasonSelect.value); updateSource(currentServer); };
                    episodeSelect.onchange = () => updateSource(currentServer);
                }
            } catch (e) { console.error('Failed TMDB TV fetch:', e); }
        } else {
            try {
                const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${tmdbApiKey}`);
                if (res.ok) {
                    const data = await res.json();
                    imdbId = data.imdb_id;
                }
            } catch (e) { console.error('Failed TMDB Movie fetch:', e); }
        }

        // --- 6. Start the Player ---
        updateSource(currentServer);
    });

    // --- Close logic ---
    const closeBtn = document.getElementById('closeMoviePlayer');
    if (closeBtn) {
        closeBtn.onclick = function() {
            const playerSection = document.getElementById('moviePlayerSection');
            if (playerSection) playerSection.style.display = 'none';
            const frame = document.getElementById('moviePlayerFrame');
            if (frame) frame.src = ''; 
        };
    }
});