import { FFmpeg } from "/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

let totalSegments = 0;
let completedSegments = 0;
let downloadedBytes = 0;
let downloadInProgress = false;
let downloadBeforeUnloadBound = false;
let downloadTaskSeq = 0;
let downloadDockBound = false;
let downloadTaskMap = new Map();

function bindDownloadBeforeUnload() {
    if (downloadBeforeUnloadBound) return;
    downloadBeforeUnloadBound = true;
    window.addEventListener('beforeunload', (event) => {
        if (!downloadInProgress) return;
        event.preventDefault();
        event.returnValue = '';
        window.showLongToast?.(
            'Do you want us to cancel your download? Closing now will stop the subtitle burn and lose progress.',
            12000
        );
        return '';
    });
}

function ensureDownloadDock() {
    if (downloadDockBound) return;
    downloadDockBound = true;
    if (document.getElementById('downloadDock')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="downloadDock" class="download-dock"></div>
    `);
}

function createDownloadTaskCard(meta = {}) {
    ensureDownloadDock();
    const taskId = `dl-${++downloadTaskSeq}`;
    const dock = document.getElementById('downloadDock');
    const title = meta.title || 'Unknown Anime';
    const episodeLabel = meta.episode ? `S${String(meta.season || '1').padStart(2, '0')}E${String(meta.episode).padStart(2, '0')}` : '';
    const thumb = meta.thumbnail || window.currentDownloadContext?.thumbnail || window.currentAnimePosterThumb || '/img/LOGO_Short.png';

    const wrap = document.createElement('div');
    wrap.className = 'download-dock-card';
    wrap.dataset.downloadTaskId = taskId;
    wrap.innerHTML = `
        <div class="download-dock-card-row">
            <img class="download-dock-thumb" src="${thumb}" alt="">
            <div class="download-dock-meta">
                <div class="download-dock-title">${escapeHtml(title)}</div>
                <div class="download-dock-episode">${escapeHtml(episodeLabel)}</div>
                <div class="download-dock-status" data-role="status">Queued...</div>
            </div>
            <button type="button" class="download-dock-collapse" data-role="collapse">_</button>
        </div>
        <div class="download-dock-body">
            <div class="download-progress-track">
                <div class="download-progress-fill" data-role="combined"></div>
            </div>
            <div class="download-dock-subline" data-role="subline">Waiting...</div>
        </div>
    `;
    dock?.appendChild(wrap);
    const taskRecord = {
        id: taskId,
        title,
        episodeLabel,
        thumb,
        el: wrap
    };
    downloadTaskMap.set(taskId, taskRecord);

    const body = wrap.querySelector('.download-dock-body');
    const collapseBtn = wrap.querySelector('[data-role="collapse"]');
    const restoreTaskModal = () => {
        const task = downloadTaskMap.get(taskId) || taskRecord;
        console.log('[DownloadDock] restore task modal', { taskId, title, episodeLabel, task });
        const modal = document.getElementById('downloadModal');
        if (!modal) return;

        modal.classList.remove('collapsed');
        modal.style.display = 'flex';
        modal.dataset.taskId = taskId;

        const statusText = document.getElementById('downloadStatusText');
        const segmentText = document.getElementById('downloadSegmentText');
        const sizeText = document.getElementById('downloadSizeText');
        const subtitleBar = document.getElementById('downloadSubtitleProgressBar');
        const mainBar = document.getElementById('downloadProgressBar');
        const thumb = task?.thumb || wrap.querySelector('.download-dock-thumb')?.src || '';
        const currentStatus = wrap.querySelector('[data-role="status"]')?.textContent || 'Downloading...';
        const currentSubline = wrap.querySelector('[data-role="subline"]')?.textContent || '';
        const combined = wrap.querySelector('[data-role="combined"]')?.style.width || '0%';

        if (statusText) statusText.textContent = currentStatus;
        if (segmentText) segmentText.textContent = task?.episodeLabel ? `Task ${task.episodeLabel}` : `Task ${taskId}`;
        if (sizeText) sizeText.textContent = currentSubline || task?.title || title;
        if (mainBar) mainBar.style.width = combined;
        if (subtitleBar) subtitleBar.style.width = combined;

        if (thumb) {
            const modalTitle = modal.querySelector('.download-modal-title');
            if (modalTitle && task?.title) modalTitle.textContent = task.title;
        }
    };

    collapseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[DownloadDock] maximize clicked', { taskId });
      restoreTaskModal();
    });
    wrap.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        console.log('[DownloadDock] card clicked', { taskId });
        restoreTaskModal();
    });

    return {
        id: taskId,
        el: wrap,
        body,
        setStatus(text) {
            const node = wrap.querySelector('[data-role="status"]');
            if (node) node.textContent = text;
        },
        setCombinedProgress(percent) {
            const bar = wrap.querySelector('[data-role="combined"]');
            if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
        },
        setSubline(text) {
            const node = wrap.querySelector('[data-role="subline"]');
            if (node) node.textContent = text;
        },
        setThumbnail(src) {
            const img = wrap.querySelector('.download-dock-thumb');
            if (img && src) img.src = src;
        },
        finish(ok = true) {
            wrap.classList.toggle('done', ok);
            setTimeout(() => {
                downloadTaskMap.delete(taskId);
                wrap.classList.add('collapsed');
                wrap.remove();
                const modal = document.getElementById('downloadModal');
                if (modal && modal.dataset.taskId === taskId) {
                    modal.classList.remove('collapsed');
                    modal.style.display = 'none';
                }
            }, 900);
        },
        remove() {
            downloadTaskMap.delete(taskId);
            wrap.remove();
        }
    };
}
function ensureDownloadModal() {
    if (document.getElementById("downloadModal")) return;

    document.body.insertAdjacentHTML("beforeend", `
      
                <div id="downloadModal" class="download-modal-overlay">
                    <div class="download-modal-content">
                        <h3 class="download-modal-title">Downloading Episode</h3>

                        <div id="downloadStatusText" class="download-modal-text">
                            Initializing...
                        </div>

                        <div id="downloadSegmentText" class="download-modal-text">
                            Video/Audio: 0 / 0 (0%)
                        </div>

                        <div id="downloadSizeText" class="download-modal-text">
                            Downloaded: 0 MB
                        </div>

                        <label id="downloadSubsChoice" class="download-subs-choice">
                            <input id="downloadIncludeSubs" type="checkbox" />
                            Burn subtitles into video
                        </label>

                        <div id="downloadSubsPickerWrap" class="download-subs-picker-wrap" style="display:none;">
                            <div class="download-modal-subheading" style="margin-top:10px;">Subtitle Language</div>
                            <select id="downloadSubsPicker" class="download-subs-picker"></select>
                        </div>

                        <div id="downloadSubsHint" class="download-modal-text download-subs-hint" style="display:none;">
                            Warning: this will re-encode the video and can take a long time.
                        </div>

                        <div class="download-modal-subheading">Video + Audio</div>
                        <div class="download-progress-track">
                            <div id="downloadProgressBar" class="download-progress-fill"></div>
                        </div>

                        <div class="download-modal-subheading">Subtitle Burn</div>
                        <div class="download-progress-track">
                            <div id="downloadSubtitleProgressBar" class="download-progress-fill download-progress-fill-secondary"></div>
                        </div>

                        <div class="download-modal-warning">
                            ⚠ Do not close this tab or spam the download button. Spamming will block your access, and download speed depends on your CPU and internet. Please be patient!                        
                        </div>
                    </div>
                </div>
    `);
}

function showDownloadModal() {
    const modal = document.getElementById("downloadModal");
    if (modal) modal.style.display = "flex";
    bindDownloadBeforeUnload();
    if (modal && !modal.dataset.bound) {
        modal.dataset.bound = '1';
        modal.addEventListener('click', (event) => {
            if (event.target !== modal) return;
            modal.classList.add('collapsed');
            modal.style.display = 'none';
            window.showLongToast?.(
                'Download dock minimized. Your task card stays pinned at the bottom-right.',
                8000
            );
        });
    }
    const checkbox = document.getElementById('downloadIncludeSubs');
    const hint = document.getElementById('downloadSubsHint');
    const pickerWrap = document.getElementById('downloadSubsPickerWrap');
    const picker = document.getElementById('downloadSubsPicker');

    const populateSubtitlePicker = () => {
        if (!picker) return;
        const tracks = Array.isArray(window.currentVideo?.subtitles) ? window.currentVideo.subtitles.filter(track => track?.url) : [];
        picker.innerHTML = '';
        if (!tracks.length) {
            picker.innerHTML = '<option value="">No subtitles available</option>';
            picker.disabled = true;
            return;
        }
        picker.disabled = false;
        tracks.forEach((track, index) => {
            const opt = document.createElement('option');
            opt.value = String(index);
            opt.textContent = `${track.lang || track.language || `Subtitle ${index + 1}`}`;
            picker.appendChild(opt);
        });
        const preferredIndex = Math.max(0, Math.min(tracks.length - 1, Number(window.currentSubtitleTrackIndex || 0)));
        picker.value = String(preferredIndex);
    };

    if (checkbox && !checkbox.dataset.bound) {
        checkbox.dataset.bound = '1';
        checkbox.addEventListener('change', () => {
            const enabled = checkbox.checked === true;
            if (hint) hint.style.display = enabled ? 'block' : 'none';
            if (pickerWrap) pickerWrap.style.display = enabled ? 'block' : 'none';
            if (enabled) populateSubtitlePicker();
            if (enabled) {
                window.showLongToast?.(
                    'Warning: burning subtitles will re-encode the video and may take a long time.',
                    12000
                );
            }
        });
    }
    if (picker && !picker.dataset.bound) {
        picker.dataset.bound = '1';
        picker.addEventListener('change', () => {
            window.currentSubtitleTrackIndex = Number(picker.value || 0);
        });
    }
    populateSubtitlePicker();
}

function hideDownloadModal() {
    const modal = document.getElementById("downloadModal");
    if (modal) {
        modal.style.display = "none";
    }
}

function setDownloadStatus(text) {
    
    document.getElementById("downloadStatusText").textContent = text;
}

function setSubtitleProgress(label, percent) {
    const bar = document.getElementById('downloadSubtitleProgressBar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    const segmentText = document.getElementById('downloadSegmentText');
    if (segmentText && label) segmentText.textContent = label;
}

function normalizeSubtitlePayload(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!raw) return { text: '', filename: '' };

    const body = /^WEBVTT\b/i.test(raw) ? raw.replace(/^WEBVTT[^\n]*\n+/i, '') : raw;
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    const cues = [];
    let currentText = [];
    let currentStart = null;
    let currentEnd = null;

    const flushCue = () => {
        if (!currentStart || !currentEnd) {
            currentText = [];
            currentStart = null;
            currentEnd = null;
            return;
        }
        const payload = currentText
            .map(line => String(line || '').trim())
            .filter(line => line.length > 0)
            .map(line => line
                .replace(/<ruby>(.*?)<rt>.*?<\/rt><\/ruby>/gi, '$1')
                .replace(/<rt>.*?<\/rt>/gi, '')
                .replace(/<[^>]+>/g, '')
            )
            .join('\n')
            .trim();
        if (!payload) {
            currentText = [];
            currentStart = null;
            currentEnd = null;
            return;
        }
        cues.push(`${cues.length + 1}\n${currentStart} --> ${currentEnd}\n${payload}`);
        currentText = [];
        currentStart = null;
        currentEnd = null;
    };

    for (const rawLine of lines) {
        const line = String(rawLine || '').trim();
        if (!line) {
            if (currentStart && currentEnd) flushCue();
            continue;
        }
        if (/^WEBVTT\b/i.test(line)) continue;
        if (/^NOTE\b/i.test(line)) continue;

        if (line.includes('-->')) {
            flushCue();
            const match = line.match(
                /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/
            );
            if (!match) continue;
            currentStart = match[1].replace(/\./g, ',');
            currentEnd = match[2].replace(/\./g, ',');
            currentText = [];
            continue;
        }

        if (/^\d+$/.test(line) && !currentStart) {
            continue;
        }

        if (currentStart && currentEnd) {
            currentText.push(line);
        }
    }
    flushCue();

    const cleaned = cues.join('\n\n');
    console.log('[Download][SubsParse]', {
        rawChars: raw.length,
        cleanedChars: cleaned.length,
        cueCount: cues.length,
        firstCue: cues[0] || '',
        secondCue: cues[1] || ''
    });
    return { text: cleaned ? cleaned + '\n\n' : '', filename: 'subs.srt' };
}

function triggerBrowserDownload(filename, text, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseSubtitleCues(text) {
    const cues = [];
    const source = String(text || '').trim().replace(/\r\n/g, '\n');
    const blocks = source.split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        if (!lines.length) continue;
        const timeLineIndex = lines.findIndex(line => line.includes('-->'));
        if (timeLineIndex < 0) continue;
        const timeMatch = lines[timeLineIndex].match(
            /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/
        );
        if (!timeMatch) continue;
        const toSeconds = (value) => {
            const normalized = value.replace(',', '.');
            const [h, m, rest] = normalized.split(':');
            const [s, ms = '0'] = String(rest || '0').split('.');
            return (parseInt(h, 10) * 3600) + (parseInt(m, 10) * 60) + parseInt(s, 10) + (parseInt(ms.padEnd(3, '0').slice(0, 3), 10) / 1000);
        };
        const cueText = lines.slice(timeLineIndex + 1).join('\n').replace(/<[^>]+>/g, '').trim();
        if (!cueText) continue;
        cues.push({
            start: toSeconds(timeMatch[1]),
            end: toSeconds(timeMatch[2]),
            text: cueText
        });
    }
    return cues;
}

function getActiveSubtitleCue(cues, currentTime) {
    return cues.find(cue => currentTime >= cue.start && currentTime <= cue.end) || null;
}

async function recordVideoWithCanvasSubtitles(sourceBlob, subtitleText, videoMeta = {}, onProgress = null) {
    const cues = parseSubtitleCues(subtitleText);
    console.log('[CanvasBurn] starting', {
        cueCount: cues.length,
        sourceBytes: sourceBlob?.size || 0,
        title: videoMeta.title || ''
    });

    const sourceUrl = URL.createObjectURL(sourceBlob);
    const video = document.createElement('video');
    video.src = sourceUrl;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('Failed to load source video for canvas burn')));
    });

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const canvasStream = canvas.captureStream(30);
    const videoStream = typeof video.captureStream === 'function' ? video.captureStream() : null;
    const audioTracks = videoStream ? videoStream.getAudioTracks() : [];
    const tracks = [...canvasStream.getVideoTracks(), ...audioTracks];
    const mixedStream = new MediaStream(tracks);

    let mimeType = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
    }

    const chunks = [];
    const recorder = new MediaRecorder(mixedStream, { mimeType });
    recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    const done = new Promise(resolve => {
        recorder.onstop = resolve;
    });
    let lastLogAt = 0;
    let lastCueIndex = -1;
    const updateProgress = () => {
        const currentTime = Number(video.currentTime || 0);
        const duration = Number(video.duration || 0);
        const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
        const cueIndex = cues.findIndex(cue => currentTime >= cue.start && currentTime <= cue.end);
        const cue = cueIndex >= 0 ? cues[cueIndex] : null;
        onProgress?.({
            currentTime,
            duration,
            percent,
            cueIndex: cueIndex >= 0 ? cueIndex + 1 : 0,
            cueCount: cues.length,
            cueText: cue?.text || ''
        });
        const now = Date.now();
        if (now - lastLogAt > 5000 || cueIndex !== lastCueIndex) {
            console.log('[CanvasBurn][progress]', {
                currentTime: currentTime.toFixed(2),
                duration: duration.toFixed(2),
                percent: Number(percent.toFixed(1)),
                cueIndex: cueIndex >= 0 ? cueIndex + 1 : 0,
                cueCount: cues.length,
                cueText: cue?.text?.slice(0, 120) || ''
            });
            lastLogAt = now;
            lastCueIndex = cueIndex;
        }
    };

    const drawFrame = () => {
        if (video.paused || video.ended) return;
        ctx.drawImage(video, 0, 0, width, height);

        const activeCue = getActiveSubtitleCue(cues, video.currentTime);
        if (activeCue) {
            ctx.save();
            ctx.font = 'bold 28px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const lines = activeCue.text.split('\n');
            const padding = 14;
            const lineHeight = 34;
            const blockHeight = (lines.length * lineHeight) + (padding * 2);
            const yBottom = height - 48;
            const boxWidth = Math.min(width * 0.86, 1100);
            const boxX = (width - boxWidth) / 2;
            const boxY = yBottom - blockHeight;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillRect(boxX, boxY, boxWidth, blockHeight);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 4;
            lines.forEach((line, idx) => {
                const y = boxY + padding + ((idx + 1) * lineHeight) - 8;
                ctx.strokeText(line, width / 2, y);
                ctx.fillText(line, width / 2, y);
            });
            ctx.restore();
        }
        updateProgress();

        if (!video.ended) requestAnimationFrame(drawFrame);
    };

    await video.play();
    recorder.start(1000);
    requestAnimationFrame(drawFrame);

    await new Promise(resolve => {
        video.addEventListener('ended', resolve, { once: true });
    });
    recorder.stop();
    await done;

    URL.revokeObjectURL(sourceUrl);

    const outBlob = new Blob(chunks, { type: mimeType });
    console.log('[CanvasBurn] finished', {
        mimeType,
        chunks: chunks.length,
        size: outBlob.size
    });
    return outBlob;
}

function updateDownloadProgress() {
    const percent =
        totalSegments === 0
            ? 0
            : (completedSegments / totalSegments) * 100;

    document.getElementById("downloadStatusText").textContent =
        "Downloading segments...";

    document.getElementById("downloadSegmentText").textContent =
        `${completedSegments}/${totalSegments}`;
    document.getElementById("downloadProgressBar").style.width =
        percent + "%";
    const downloadedMB =
    (downloadedBytes / 1024 / 1024).toFixed(1);

    document.getElementById("downloadSizeText").textContent =
    `Downloaded: ${downloadedMB} MB`;
}

async function updateDownloadButtons(streamUrl) {
    const subBtn = document.getElementById("btnDownloadSub");
    const dubBtn = document.getElementById("btnDownloadDub");

    if (!subBtn || !dubBtn) return;

    subBtn.disabled = true;
    dubBtn.disabled = true;

    subBtn.style.opacity = "0.5";
    dubBtn.style.opacity = "0.5";

    try {
        const playlist = await fetch(streamUrl).then(r => r.text());
        const master = parseMasterPlaylist(playlist);

        const hasAnyAudio = Array.isArray(master.audios) && master.audios.length > 0;
        const hasAnyVideo = Array.isArray(master.videos) && master.videos.length > 0;

        if (hasAnyAudio && hasAnyVideo) {
            subBtn.disabled = false;
            subBtn.style.opacity = "1";
            dubBtn.disabled = false;
            dubBtn.style.opacity = "1";
        }
    } catch (err) {
        console.warn("Download availability check failed:", err);
    }
}

function notifyDownloadCompleteForEpisode(video) {
    const userUID = localStorage.getItem('userUID');
    const token = localStorage.getItem('authToken');
    if (!userUID || !token) return;

    const tmdbId = new URLSearchParams(window.location.search).get('id');
    const title = window.currentDownloadContext?.title || video?.title || 'Your episode';

    fetch('/notifications/download-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
            userUID,
            tmdbId,
            title,
            season: video?.season || window.currentDownloadContext?.season || null,
            episode: video?.episode || window.currentDownloadContext?.episode || null
        })
    }).then(() => {
        window.fetchNotifications?.();
        window.broadcastNotificationRefresh?.();
    }).catch(err => console.warn('[Download] notification create failed:', err.message));
}

async function downloadKAAEpisode() {
    downloadedBytes = 0;
    downloadInProgress = true;
    const video = window.currentVideo;
    const downloadContext = window.currentDownloadContext || {};
    const task = createDownloadTaskCard({
        title: downloadContext.title || video?.title || 'Unknown Anime',
        episode: video?.episode || '',
        season: video?.season || '',
        thumbnail: downloadContext.thumbnail || video?.thumbnail || video?.poster || '/img/LOGO_Short.png'
    });
    console.log('[DownloadDock] task created', {
        title: downloadContext.title || video?.title || 'Unknown Anime',
        thumbnail: downloadContext.thumbnail || video?.thumbnail || video?.poster || '/img/LOGO_Short.png'
    });
    const setTaskStatus = (text) => {
        task.setStatus(text);
        setDownloadStatus(text);
    };
    const setTaskSubtitleProgress = (label, percent) => {
        task.setCombinedProgress(percent);
        task.setSubline(label);
        setSubtitleProgress(label, percent);
    };
    const setTaskCombinedProgress = (percent) => {
        task.setCombinedProgress(percent);
    };
    ensureDownloadModal();
    showDownloadModal();
    try {
        const subtitleCount = Array.isArray(video?.subtitles) ? video.subtitles.length : 0;
        console.log('[Download] subtitleCount=', subtitleCount, 'video=', video);

        const playlist = await fetch(video.playlist).then(r => r.text());
        console.log('playlists u asked for:\n', playlist);
        const master = parseMasterPlaylist(playlist);

        const selectedVideo = master.videos[0];
        console.log("currentAudioType =", window.currentAudioType);

        let selectedAudio = window.currentAudioType === "dub"
            ? master.audios.find(a => {
                const lang = a.language.toLowerCase();
                return [
                    "english", "americana", "england",
                    "eng", "en", "en-us", "en-gb", "en-ca", "en-au",
                    "us", "uk"
                ].some(x =>
                    lang === x ||
                    lang.startsWith(x + "-") ||
                    lang.includes(" " + x) ||
                    (x.length > 2 && lang.includes(x))
                );
            })
            : master.audios.find(a => {
                const lang = a.language.toLowerCase();
                return [
                    "japanese", "nihongo", "nihon",
                    "jpn", "ja", "jp", "jap"
                ].some(x =>
                    lang === x ||
                    lang.startsWith(x + "-") ||
                    lang.includes(" " + x) ||
                    (x.length > 2 && lang.includes(x))
                );
            });

        if (!selectedAudio && master.audios.length === 1) {
            console.warn("Requested audio unavailable. Using the only available audio track.");
            selectedAudio = master.audios[0];
        }

        if (!selectedAudio) {
            throw new Error("No matching audio playlist found.");
        }

        const videoPlaylist = await fetch(selectedVideo.url).then(r => r.text());
        const videoSegments = parseMediaPlaylist(videoPlaylist);

        const audioPlaylist = await fetch(selectedAudio.url).then(r => r.text());
        const audioSegments = parseMediaPlaylist(audioPlaylist);

        const subtitleTracks = Array.isArray(video.subtitles)
            ? video.subtitles.filter(track => track?.url)
            : [];
        const subtitleIndex = Math.max(0, Math.min(subtitleTracks.length - 1, Number(document.getElementById('downloadSubsPicker')?.value || window.currentSubtitleTrackIndex || 0)));
        const subtitleTrack = subtitleTracks[subtitleIndex] || subtitleTracks[0] || null;
        let subtitleText = '';
        let subtitleFilename = '';
        if (subtitleTrack?.url) {
            try {
                setDownloadStatus("Loading subtitles...");
                const fetchedSubtitleText = await fetch(subtitleTrack.url).then(r => r.text());
                console.log('[Download][SubsFetch]', {
                    fetchedChars: fetchedSubtitleText.length,
                    startsWith: fetchedSubtitleText.slice(0, 80),
                    endsWith: fetchedSubtitleText.slice(-80)
                });
                const normalizedSubtitles = normalizeSubtitlePayload(fetchedSubtitleText);
                subtitleText = normalizedSubtitles.text;
                subtitleFilename = normalizedSubtitles.filename;
                console.log('[Download] subtitle fetch ok:', {
                    url: subtitleTrack.url,
                    lang: subtitleTrack.lang || subtitleTrack.language || 'eng',
                    filename: subtitleFilename,
                    chars: subtitleText.length,
                    preview: subtitleText.slice(0, 120)
                });
            } catch (err) {
                console.warn('Subtitle fetch failed, continuing without subs:', err);
                subtitleText = '';
                subtitleFilename = '';
            }
        } else {
            console.warn('[Download] no subtitle track was found on window.currentVideo');
        }

        // 1. Initialize global tracking before starting downloads
        totalSegments = videoSegments.length + audioSegments.length;
        completedSegments = 0;
        showDownloadModal();
        updateDownloadProgress();

        // 2. Download files with tracking callback
        const downloadedVideo = await downloadSegments(
            videoSegments,
            () => {
                const percent = totalSegments === 0 ? 0 : (completedSegments / totalSegments) * 100;
                updateDownloadProgress();
                setTaskCombinedProgress(percent);
            }
        );

        const downloadedAudio = await downloadSegments(
            audioSegments,
            () => {
                const percent = totalSegments === 0 ? 0 : (completedSegments / totalSegments) * 100;
                updateDownloadProgress();
                setTaskCombinedProgress(percent);
            }
        );

        const mergedVideo = mergeSegments(downloadedVideo);
        const mergedAudio = mergeSegments(downloadedAudio);

        // 3. Init FFmpeg
        setTaskStatus("Loading FFmpeg...");
        const ffmpeg = new FFmpeg();
        ffmpeg.on?.('log', ({ message }) => {
            if (!message) return;
            console.log('[FFmpeg][log]', message);
        });
        ffmpeg.on?.('progress', (progress) => {
            if (!progress) return;
            const ratio = typeof progress.ratio === 'number' ? progress.ratio : null;
            const time = progress.time != null ? progress.time : null;
            console.log('[FFmpeg][progress]', {
                ratio: ratio != null ? Number(ratio.toFixed(3)) : null,
                time
            });
        });
        await ffmpeg.load({
            coreURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
            wasmURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"
        });

        await ffmpeg.writeFile("video.ts", mergedVideo);
        await ffmpeg.writeFile("audio.ts", mergedAudio);
        if (subtitleText && subtitleFilename) {
            const subtitleDownloadName = `${video.title} - S${video.season}E${video.episode}.txt`;
            triggerBrowserDownload(subtitleDownloadName, subtitleText, 'text/plain;charset=utf-8');
            const subtitleBytes = new TextEncoder().encode(subtitleText);
            await ffmpeg.writeFile(subtitleFilename, subtitleBytes);
            const subtitleFsCheck = await ffmpeg.readFile(subtitleFilename);
            const subtitleFsText = new TextDecoder().decode(subtitleFsCheck);
            console.log('[Download] Subtitle track prepared:', {
                filename: subtitleFilename,
                bytes: subtitleText.length,
                byteLength: subtitleBytes.byteLength,
                fsBytes: subtitleFsCheck?.byteLength || subtitleFsCheck?.length || 0,
                lang: subtitleTrack?.lang || subtitleTrack?.language || 'eng',
                preview: subtitleText.slice(0, 200),
                tail: subtitleText.slice(-200),
                fsPreview: subtitleFsText.slice(0, 200),
                fsTail: subtitleFsText.slice(-200)
            });
        }

        // 4. Muxing
        const hasSubtitle = Boolean(subtitleText && subtitleFilename) && document.getElementById('downloadIncludeSubs')?.checked === true;
        setTaskStatus(hasSubtitle ? "Rendering subtitles on canvas..." : "Muxing video and audio...");
        document.getElementById("downloadProgressBar").style.width = "100%";
        setTaskSubtitleProgress('Subtitle Burn: queued', 0);

        const outputFilename = "output.mp4";
        const muxArgs = ["-i", "video.ts", "-i", "audio.ts"];

        if (hasSubtitle) {
            muxArgs.push("-c:v", "copy");
            muxArgs.push("-c:a", "copy");
            muxArgs.push("-movflags", "+faststart");
        } else {
            muxArgs.push("-c", "copy");
        }
        muxArgs.push(outputFilename);
        console.log('[Download] mux args:', muxArgs);
        console.log('[Download] mux plan:', {
            hasSubtitle,
            subtitleFilename,
            outputFilename,
            subtitleLang: subtitleTrack?.lang || subtitleTrack?.language || 'eng'
        });

        let finalOutput = outputFilename;
        try {
            await ffmpeg.exec(muxArgs);
            console.log('[Download] ffmpeg mux complete for', finalOutput);
        } catch (muxError) {
            if (hasSubtitle) {
                console.warn('Subtitle burn-in failed, falling back to audio/video-only MP4:', muxError);
                setDownloadStatus("Subtitle burn-in failed. Downloading video/audio only...");
                finalOutput = "output.mp4";
                await ffmpeg.exec(["-i", "video.ts", "-i", "audio.ts", "-c", "copy", finalOutput]);
                console.log('[Download] ffmpeg fallback mux complete for', finalOutput);
            } else {
                throw muxError;
            }
        }

        // 5. Build Download
        setDownloadStatus(hasSubtitle ? "Finalizing subtitle-enabled download..." : "Preparing download...");
        const data = await ffmpeg.readFile(finalOutput);
        console.log('[Download] final output file read:', {
            finalOutput,
            bytes: data?.byteLength || data?.length || 0
        });
        let blob = new Blob([data.buffer], { type: "video/mp4" });
        let downloadExt = "mp4";
        if (hasSubtitle) {
            try {
                setTaskStatus("Rendering subtitles in browser canvas...");
                const canvasBlob = await recordVideoWithCanvasSubtitles(blob, subtitleText, video, (state) => {
                    const current = state?.currentTime || 0;
                    const duration = state?.duration || 0;
                    const percent = state?.percent || 0;
                    const cueLabel = state?.cueIndex ? `${state.cueIndex}/${state.cueCount}` : '0/0';
                    setTaskStatus(`Rendering subtitles in browser canvas... ${current.toFixed(0)}s / ${duration.toFixed(0)}s (${percent.toFixed(1)}%) cue ${cueLabel}`);
                    setTaskSubtitleProgress(`Subtitle Burn: ${current.toFixed(0)}s / ${duration.toFixed(0)}s (${percent.toFixed(1)}%)`, percent);
                    document.getElementById("downloadSizeText").textContent =
                        state?.cueText ? `Cue ${cueLabel}: ${state.cueText.slice(0, 64)}` : `Cue ${cueLabel}`;
                });
                blob = canvasBlob;
                downloadExt = "webm";
            } catch (canvasErr) {
                console.warn('[CanvasBurn] failed, falling back to plain MP4:', canvasErr);
                setTaskStatus("Subtitle canvas render failed. Downloading video/audio only...");
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${video.title} - S${video.season}E${video.episode}.${downloadExt}`;
        document.body.appendChild(a);
        
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        // 6. Complete
        setTaskStatus("Download complete!");
        downloadInProgress = false;
        task.finish(true);
        notifyDownloadCompleteForEpisode(video);
        setTimeout(() => {
            hideDownloadModal();
        }, 1000);

    } catch (err) {
        // 7. Error Handling
        console.error(err);
        setTaskStatus("Download failed.");
        downloadInProgress = false;
        task.finish(false);
        setTimeout(hideDownloadModal, 2000);
    }
}

function parseMasterPlaylist(text) {
    const videos = [];
    const audios = [];
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Audio playlists
        if (line.startsWith("#EXT-X-MEDIA") && line.includes("TYPE=AUDIO")) {
            audios.push({
                language: line.match(/LANGUAGE="([^"]+)"/)?.[1] || "",
                name: line.match(/NAME="([^"]+)"/)?.[1] || "",
                url: line.match(/URI="([^"]+)"/)?.[1] || ""
            });
            continue;
        }

        // Video playlists
        if (line.startsWith("#EXT-X-STREAM-INF")) {
            videos.push({
                resolution: line.match(/RESOLUTION=([^,]+)/)?.[1] || "Unknown",
                url: lines[i + 1].trim()
            });
        }
    }

    videos.sort((a, b) => {
        const ah = parseInt(a.resolution.split("x")[1]);
        const bh = parseInt(b.resolution.split("x")[1]);
        return bh - ah;
    });

    return { videos, audios };
}

function parseMediaPlaylist(text) {
    const segments = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        segments.push(trimmed);
    }
    return segments;
}

// Added progressCallback to signature
async function downloadSegments(segments, progressCallback) {
    const downloaded = new Array(segments.length);
    const CONCURRENCY = 2;

    for (let i = 0; i < segments.length; i += CONCURRENCY) {
        const batch = segments.slice(i, i + CONCURRENCY);

        await Promise.all(
            batch.map(async (url, index) => {
                const res = await fetch(url);
                if (!res.ok)
                    throw new Error(`Failed segment ${i + index}`);

                const data = new Uint8Array(await res.arrayBuffer());

                downloaded[i + index] = data;

                downloadedBytes += data.byteLength;
                completedSegments++;

                progressCallback?.();
            })
        );
    }

    return downloaded;
}

function mergeSegments(segments) {
    let totalLength = 0;
    for (const segment of segments) {
        totalLength += segment.byteLength;
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const segment of segments) {
        merged.set(segment, offset);
        offset += segment.byteLength;
    }
    return merged;
}

// Global exposes
window.downloadKAAEpisode = downloadKAAEpisode;
window.updateDownloadButtons = updateDownloadButtons;
