import { FFmpeg } from "/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// Records one completed download into personalList.html's "My Downloads" section
// (activity.db's user_downloads table). Best-effort - a failed write here should never surface
// as a download error, since the actual file already saved successfully by the time this runs.
window.recordDownloadHistory = function(entry) {
    try {
        const userUID = typeof window.getActivityUID === 'function' ? window.getActivityUID() : null;
        if (!userUID) return;
        fetch('/activity/downloads/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userUID, ...entry })
        }).catch(err => console.warn('[DownloadHistory] failed to record:', err));
    } catch (err) {
        console.warn('[DownloadHistory] failed to record:', err);
    }
};

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

                        <div id="downloadSubtitleBurnSection">
                            <div class="download-modal-subheading">Subtitle Burn</div>
                            <div class="download-progress-track">
                                <div id="downloadSubtitleProgressBar" class="download-progress-fill download-progress-fill-secondary"></div>
                            </div>
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
    if (modal) {
        // .collapsed carries !important, so it silently keeps overriding this
        // inline display:flex on every later download unless it's cleared here too.
        modal.classList.remove('collapsed');
        modal.style.display = "flex";
    }
    // Reset to visible on every call - the download panel hides these afterward when its own
    // burn choice was "no" (see moviePlayer.js), but that hide is per-call, not permanent: a
    // plain movie/TV download through the non-panel buttons never runs that step and would
    // otherwise be stuck with whatever an earlier anime-panel download last left this shared
    // modal showing.
    const subsChoiceReset = document.getElementById('downloadSubsChoice');
    const burnSectionReset = document.getElementById('downloadSubtitleBurnSection');
    if (subsChoiceReset) subsChoiceReset.style.display = '';
    if (burnSectionReset) burnSectionReset.style.display = '';
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

// Plays the source video and records the canvas it's drawn onto - captureStream()/MediaRecorder
// are inherently wall-clock-bound (that's how they stay in sync at all), so this takes exactly
// as long as the video's own runtime (confirmed live: a 23:37 episode = 23:37 to burn). A
// separate (adjustable) playback-speed feature used to live here too; removed - see git history
// around 2026-08-27 if it's ever wanted back, along with why it kept causing problems.
async function recordVideoWithCanvasSubtitles(sourceBlob, subtitleText, videoMeta = {}, onProgress = null, ffmpeg = null) {
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
    // Explicit, not just relying on the (near-universal but unstated-by-spec) default - a video
    // played back silently to speakers but tapped live via captureStream() still needs correct
    // pitch preservation for the CAPTURED audio track to sound right, muted or not.
    video.preservesPitch = true;
    video.webkitPreservesPitch = true;
    video.mozPreservesPitch = true;

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

    const capturedBlob = new Blob(chunks, { type: mimeType });
    console.log('[CanvasBurn] capture finished', {
        mimeType,
        chunks: chunks.length,
        size: capturedBlob.size
    });

    // MediaRecorder only outputs webm/vp9, never mp4 - transcode container/codec to hand back a
    // real .mp4. No timestamp manipulation involved, just a flat 1:1 frame transcode.
    if (!ffmpeg) return capturedBlob;
    const mp4Name = 'burn_captured' + (mimeType.includes('webm') ? '.webm' : '.mp4');
    const mp4OutName = 'burn_output.mp4';
    try {
        await ffmpeg.writeFile(mp4Name, new Uint8Array(await capturedBlob.arrayBuffer()));
        await ffmpeg.exec([
            '-i', mp4Name,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
            '-c:a', 'aac', '-b:a', '160k',
            '-movflags', '+faststart',
            mp4OutName
        ]);
        const mp4Data = await ffmpeg.readFile(mp4OutName);
        if (!mp4Data || (mp4Data.byteLength || mp4Data.length || 0) === 0) {
            throw new Error('webm-to-mp4 transcode produced an empty file');
        }
        return new Blob([mp4Data.buffer], { type: 'video/mp4' });
    } catch (err) {
        console.error('[CanvasBurn] webm-to-mp4 transcode failed, shipping the raw webm capture instead:', err);
        return capturedBlob;
    } finally {
        for (const f of [mp4Name, mp4OutName]) {
            try { await ffmpeg.deleteFile(f); } catch (_) {}
        }
    }
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

async function downloadKAAEpisode(requestedHeight) {
    // downloadInProgress was only ever set here, never checked -- a second call
    // (double-click, stray repeat event) would race a second FFmpeg() instance
    // against the first's segment fetches/FS writes, which is a plausible source
    // of otherwise-unexplained ErrnoError "FS error" crashes.
    if (downloadInProgress) {
        if (typeof window.showLimitToast === 'function') {
            window.showLimitToast('A download is already in progress. Please wait for it to finish.');
        }
        return;
    }
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
        console.log('[Download][1/8] start', { provider: video?.provider, playlistUrl: video?.playlist, subtitleCount, video });

        const masterRes = await fetch(video.playlist);
        console.log('[Download][2/8] master playlist fetch', { status: masterRes.status, ok: masterRes.ok, url: video.playlist });
        // Deliberately not including video.playlist here - it's a tokenized proxy URL carrying
        // this browser's session token, and this message can end up user-visible (toast/status
        // text) or in a screenshot. The status code is enough to diagnose from.
        if (!masterRes.ok) throw new Error(`Master playlist fetch failed (HTTP ${masterRes.status})`);
        const playlist = await masterRes.text();
        console.log('[Download] master playlist body:\n', playlist);
        const master = parseMasterPlaylist(playlist);
        console.log('[Download][3/8] parsed master', { videoVariants: master.videos.length, audioTracks: master.audios, videos: master.videos });

        const selectedVideo = pickVideoByHeight(master.videos, requestedHeight);
        if (!selectedVideo) throw new Error('Master playlist had no #EXT-X-STREAM-INF video variants');
        console.log('[Download] selectedVideo=', selectedVideo, "currentAudioType =", window.currentAudioType);

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
            console.error('[Download] no audio track matched', { audioTracks: master.audios, currentAudioType: window.currentAudioType });
            throw new Error("No matching audio playlist found.");
        }
        console.log('[Download] selectedAudio=', selectedAudio);

        const videoPlaylistRes = await fetch(selectedVideo.url);
        console.log('[Download][4/8] video media playlist fetch', { status: videoPlaylistRes.status, ok: videoPlaylistRes.ok, url: selectedVideo.url });
        if (!videoPlaylistRes.ok) throw new Error(`Video media playlist fetch failed (HTTP ${videoPlaylistRes.status})`);
        const videoPlaylist = await videoPlaylistRes.text();
        const { segments: videoSegments, initSegmentUrl: videoInitUrl } = parseMediaPlaylist(videoPlaylist);
        console.log('[Download] video segments parsed', { count: videoSegments.length, initSegmentUrl: videoInitUrl, firstSegment: videoSegments[0] });

        const audioPlaylistRes = await fetch(selectedAudio.url);
        console.log('[Download][5/8] audio media playlist fetch', { status: audioPlaylistRes.status, ok: audioPlaylistRes.ok, url: selectedAudio.url });
        if (!audioPlaylistRes.ok) throw new Error(`Audio media playlist fetch failed (HTTP ${audioPlaylistRes.status})`);
        const audioPlaylist = await audioPlaylistRes.text();
        const { segments: audioSegments, initSegmentUrl: audioInitUrl } = parseMediaPlaylist(audioPlaylist);
        console.log('[Download] audio segments parsed', { count: audioSegments.length, initSegmentUrl: audioInitUrl, firstSegment: audioSegments[0] });

        const isFmp4 = Boolean(videoInitUrl || audioInitUrl);
        console.log('[Download] container detection', { isFmp4, videoInitUrl, audioInitUrl });

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
        console.log('[Download][6/8] downloading segments', { videoSegmentCount: videoSegments.length, audioSegmentCount: audioSegments.length });
        const downloadedVideo = await downloadSegments(
            videoSegments,
            () => {
                const percent = totalSegments === 0 ? 0 : (completedSegments / totalSegments) * 100;
                updateDownloadProgress();
                setTaskCombinedProgress(percent);
            }
        );
        console.log('[Download] video segments downloaded', { count: downloadedVideo.length, totalBytes: downloadedVideo.reduce((s, b) => s + (b?.byteLength || 0), 0) });

        const downloadedAudio = await downloadSegments(
            audioSegments,
            () => {
                const percent = totalSegments === 0 ? 0 : (completedSegments / totalSegments) * 100;
                updateDownloadProgress();
                setTaskCombinedProgress(percent);
            }
        );
        console.log('[Download] audio segments downloaded', { count: downloadedAudio.length, totalBytes: downloadedAudio.reduce((s, b) => s + (b?.byteLength || 0), 0) });

        // fMP4 media segments are meaningless without the init (moov) segment they were
        // built against -- prepend it to the byte stream before concatenation so the
        // merged file is actually a valid, standalone fragmented MP4 ffmpeg can read.
        if (videoInitUrl) {
            console.log('[Download] fetching video init segment', videoInitUrl);
            const initRes = await fetch(videoInitUrl);
            console.log('[Download] video init segment fetch', { status: initRes.status, ok: initRes.ok });
            if (!initRes.ok) throw new Error(`Video init segment fetch failed (HTTP ${initRes.status}) for ${videoInitUrl}`);
            const initBytes = new Uint8Array(await initRes.arrayBuffer());
            console.log('[Download] video init segment bytes=', initBytes.byteLength);
            downloadedVideo.unshift(initBytes);
        }
        if (audioInitUrl) {
            console.log('[Download] fetching audio init segment', audioInitUrl);
            const initRes = await fetch(audioInitUrl);
            console.log('[Download] audio init segment fetch', { status: initRes.status, ok: initRes.ok });
            if (!initRes.ok) throw new Error(`Audio init segment fetch failed (HTTP ${initRes.status}) for ${audioInitUrl}`);
            const initBytes = new Uint8Array(await initRes.arrayBuffer());
            console.log('[Download] audio init segment bytes=', initBytes.byteLength);
            downloadedAudio.unshift(initBytes);
        }

        const mergedVideo = mergeSegments(downloadedVideo);
        const mergedAudio = mergeSegments(downloadedAudio);
        console.log('[Download][7/8] merged buffers', { mergedVideoBytes: mergedVideo.byteLength, mergedAudioBytes: mergedAudio.byteLength, isFmp4 });

        // 3. Init FFmpeg
        setTaskStatus("Loading FFmpeg...");
        console.log('[Download] loading ffmpeg.wasm...');
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
        console.log('[Download] ffmpeg.wasm loaded OK');

        // ffmpeg.wasm has no container to sniff from a bare filename the way a real
        // CLI build with libavformat probing does -- it goes by extension, so an fMP4
        // byte stream written as "video.ts" gets demuxed as MPEG-TS and fails/produces
        // garbage. KAA's plain-TS segments are unaffected (isFmp4 stays false for them).
        const videoInputName = isFmp4 ? "video.mp4" : "video.ts";
        const audioInputName = isFmp4 ? "audio.mp4" : "audio.ts";
        console.log('[Download] writing ffmpeg FS inputs', { videoInputName, audioInputName, videoBytes: mergedVideo.byteLength, audioBytes: mergedAudio.byteLength });
        await ffmpeg.writeFile(videoInputName, mergedVideo);
        await ffmpeg.writeFile(audioInputName, mergedAudio);
        console.log('[Download] ffmpeg FS inputs written OK');
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
        const muxArgs = ["-i", videoInputName, "-i", audioInputName];

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
            console.log('[Download][8/8] running ffmpeg mux', muxArgs);
            await ffmpeg.exec(muxArgs);
            console.log('[Download] ffmpeg mux complete for', finalOutput);
        } catch (muxError) {
            console.error('[Download] primary mux failed', { muxArgs, name: muxError?.name, message: muxError?.message, stack: muxError?.stack });
            if (hasSubtitle) {
                console.warn('Subtitle burn-in failed, falling back to audio/video-only MP4:', muxError);
                setDownloadStatus("Subtitle burn-in failed. Downloading video/audio only...");
                finalOutput = "output.mp4";
                const fallbackArgs = ["-i", videoInputName, "-i", audioInputName, "-c", "copy", finalOutput];
                console.log('[Download] running ffmpeg fallback mux', fallbackArgs);
                await ffmpeg.exec(fallbackArgs);
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
        if (!data || (data.byteLength || data.length || 0) === 0) {
            console.error('[Download] final output file is EMPTY -- mux silently produced nothing readable', { finalOutput, muxArgs, isFmp4, videoInputName, audioInputName });
        }
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
                }, ffmpeg);
                blob = canvasBlob;
                downloadExt = "mp4";
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
        // downloadKAAEpisode only ever handles anime sources (KAA/MegaPlay/Neko/RU-MV) - see
        // DL_SOURCE_INFO in moviePlayer.js.
        window.recordDownloadHistory({
            item_type: 'anime',
            title: video.title,
            thumbnail: window.currentDownloadContext?.thumbnail,
            season: video.season,
            episode: video.episode,
            audio: video.audio,
            subsBurned: hasSubtitle
        });
        setTimeout(() => {
            hideDownloadModal();
        }, 1000);

    } catch (err) {
        // 7. Error Handling -- log everything we have so a failed run is diagnosable
        // from console output alone instead of needing to reproduce it live.
        console.error('[Download] FAILED', {
            name: err?.name,
            message: err?.message,
            stack: err?.stack,
            provider: video?.provider,
            playlistUrl: video?.playlist,
            audioType: window.currentAudioType
        });
        setTaskStatus(`Download failed: ${err?.message || 'unknown error'}`);
        if (typeof window.showLimitToast === 'function') {
            window.showLimitToast(`Download failed: ${err?.message || 'unknown error'}`);
        }
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

// `videos` is already sorted highest-resolution-first by parseMasterPlaylist. With no
// requestedHeight, keep the old always-best behavior. With one, pick the best variant that
// still fits within it, or fall back to the lowest available if the source doesn't have
// anything that small (e.g. requesting 360p from a source that only offers 1080p/720p).
function pickVideoByHeight(videos, requestedHeight) {
    if (!requestedHeight || !Array.isArray(videos) || videos.length === 0) return videos[0];
    const withHeight = videos.map(v => ({ ...v, _h: parseInt((v.resolution || '').split('x')[1], 10) || 0 }));
    const fits = withHeight.filter(v => v._h && v._h <= requestedHeight);
    if (fits.length) return fits[0];
    return withHeight[withHeight.length - 1];
}

// fMP4/CMAF HLS streams (e.g. aniboom) split a "moov" init segment out via
// #EXT-X-MAP, which every media segment after it depends on to be a valid
// standalone file -- KAA's plain-MPEG-TS segments never have this tag, so
// initSegmentUrl stays null and nothing downstream changes for that path.
function parseMediaPlaylist(text) {
    const segments = [];
    let initSegmentUrl = null;
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#EXT-X-MAP:')) {
            const m = trimmed.match(/URI="([^"]+)"/);
            if (m) initSegmentUrl = m[1];
            continue;
        }
        if (trimmed.startsWith("#")) continue;
        segments.push(trimmed);
    }
    return { segments, initSegmentUrl };
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

// Kino (vidsrcme.ru) downloads -- deliberately a separate, simpler function
// rather than a branch inside downloadKAAEpisode, so anime/RU-anime's existing
// behavior is untouched. Kino's HLS shape differs from KAA/aniboom's in ways
// that don't fit that function's assumptions:
//   - no separate audio track to pick: vidsrcme's variants already mux
//     audio+video per segment (no #EXT-X-MEDIA audio rendition to select --
//     downloadKAAEpisode would throw "No matching audio playlist found" here)
//   - quality: optional requestedHeight, same pickVideoByHeight() helper KAA's downloader
//     uses - omit it and this keeps defaulting to videos[0] (the best available), same as before
//   - subtitle burning: same #downloadIncludeSubs/#downloadSubsPicker mechanism as
//     downloadKAAEpisode now (used to just burn whatever caption track Plyr happened to have
//     active live in the player, which meant MegaPlay/NekoStream downloads effectively never
//     burned anything - Plyr's active track isn't wired the same way there)
async function downloadKinoEpisode(requestedHeight) {
    if (downloadInProgress) {
        if (typeof window.showLimitToast === 'function') {
            window.showLimitToast('A download is already in progress. Please wait for it to finish.');
        }
        return;
    }
    downloadedBytes = 0;
    downloadInProgress = true;
    const video = window.currentVideo;
    const downloadContext = window.currentDownloadContext || {};
    const task = createDownloadTaskCard({
        title: downloadContext.title || video?.title || 'Unknown',
        episode: video?.episode || '',
        season: video?.season || '',
        thumbnail: downloadContext.thumbnail || video?.thumbnail || video?.poster || '/img/LOGO_Short.png'
    });
    const setTaskStatus = (text) => {
        task.setStatus(text);
        setDownloadStatus(text);
    };
    const setTaskCombinedProgress = (percent) => {
        task.setCombinedProgress(percent);
    };
    const setTaskSubtitleProgress = (label, percent) => {
        task.setCombinedProgress(percent);
        task.setSubline(label);
        setSubtitleProgress(label, percent);
    };

    ensureDownloadModal();
    showDownloadModal();

    try {
        console.log('[Download][Kino][1/6] start', { provider: video?.provider, playlistUrl: video?.playlist });

        const masterRes = await fetch(video.playlist);
        // Deliberately not including video.playlist here - it's a tokenized proxy URL carrying
        // this browser's session token, and this message can end up user-visible (toast/status
        // text) or in a screenshot. The status code is enough to diagnose from.
        if (!masterRes.ok) throw new Error(`Master playlist fetch failed (HTTP ${masterRes.status})`);
        const playlist = await masterRes.text();
        const master = parseMasterPlaylist(playlist);
        console.log('[Download][Kino][2/6] parsed master', { videoVariants: master.videos.length, videos: master.videos });

        const selectedVideo = pickVideoByHeight(master.videos, requestedHeight);
        if (!selectedVideo) throw new Error('Master playlist had no #EXT-X-STREAM-INF video variants');
        console.log('[Download][Kino] selectedVideo=', selectedVideo);

        const videoPlaylistRes = await fetch(selectedVideo.url);
        if (!videoPlaylistRes.ok) throw new Error(`Video media playlist fetch failed (HTTP ${videoPlaylistRes.status})`);
        const videoPlaylist = await videoPlaylistRes.text();
        const { segments: videoSegments, initSegmentUrl: videoInitUrl } = parseMediaPlaylist(videoPlaylist);
        console.log('[Download][Kino] video segments parsed', { count: videoSegments.length, initSegmentUrl: videoInitUrl });

        const isFmp4 = Boolean(videoInitUrl);

        const subtitleTracks = Array.isArray(video?.subtitles) ? video.subtitles.filter(t => t?.url) : [];
        const subtitleIndex = Math.max(0, Math.min(subtitleTracks.length - 1, Number(document.getElementById('downloadSubsPicker')?.value || window.currentSubtitleTrackIndex || 0)));
        const subtitleTrack = subtitleTracks[subtitleIndex] || null;
        let subtitleText = '';
        let subtitleFilename = '';
        if (subtitleTrack?.url) {
            try {
                setDownloadStatus('Loading subtitles...');
                const fetchedSubtitleText = await fetch(subtitleTrack.url).then(r => r.text());
                const normalizedSubtitles = normalizeSubtitlePayload(fetchedSubtitleText);
                subtitleText = normalizedSubtitles.text;
                subtitleFilename = normalizedSubtitles.filename;
                console.log('[Download][Kino] subtitle fetch ok:', { url: subtitleTrack.url, lang: subtitleTrack.lang, chars: subtitleText.length });
            } catch (err) {
                console.warn('[Download][Kino] subtitle fetch failed, continuing without subs:', err);
                subtitleText = '';
                subtitleFilename = '';
            }
        } else {
            console.log('[Download][Kino] no matching subtitle track -- downloading without subtitles');
        }

        totalSegments = videoSegments.length;
        completedSegments = 0;
        showDownloadModal();
        updateDownloadProgress();

        console.log('[Download][Kino][3/6] downloading segments', { videoSegmentCount: videoSegments.length });
        const downloadedVideo = await downloadSegments(videoSegments, () => {
            const percent = totalSegments === 0 ? 0 : (completedSegments / totalSegments) * 100;
            updateDownloadProgress();
            setTaskCombinedProgress(percent);
        });

        if (videoInitUrl) {
            const initRes = await fetch(videoInitUrl);
            if (!initRes.ok) throw new Error(`Video init segment fetch failed (HTTP ${initRes.status}) for ${videoInitUrl}`);
            const initBytes = new Uint8Array(await initRes.arrayBuffer());
            downloadedVideo.unshift(initBytes);
        }

        const mergedVideo = mergeSegments(downloadedVideo);
        console.log('[Download][Kino][4/6] merged buffer', { mergedVideoBytes: mergedVideo.byteLength, isFmp4 });

        setTaskStatus('Loading FFmpeg...');
        const ffmpeg = new FFmpeg();
        ffmpeg.on?.('log', ({ message }) => { if (message) console.log('[FFmpeg][log]', message); });

        await ffmpeg.load({
            coreURL: '/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js',
            wasmURL: '/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'
        });

        const videoInputName = isFmp4 ? 'video.mp4' : 'video.ts';
        await ffmpeg.writeFile(videoInputName, mergedVideo);

        if (subtitleText && subtitleFilename) {
            const subtitleDownloadName = `${video.title || 'Kino'}${video.episode ? ` - S${video.season}E${video.episode}` : ''}.txt`;
            triggerBrowserDownload(subtitleDownloadName, subtitleText, 'text/plain;charset=utf-8');
            await ffmpeg.writeFile(subtitleFilename, new TextEncoder().encode(subtitleText));
        }

        // Audio's already muxed into the video segments -- this is just a
        // container remux (e.g. fMP4 fragments -> a standalone playable MP4),
        // not a real audio+video combine like KAA needs.
        const hasSubtitle = Boolean(subtitleText && subtitleFilename) && document.getElementById('downloadIncludeSubs')?.checked === true;
        setTaskStatus(hasSubtitle ? 'Rendering subtitles on canvas...' : 'Remuxing video...');
        document.getElementById('downloadProgressBar').style.width = '100%';
        setTaskSubtitleProgress('Subtitle Burn: queued', 0);

        const outputFilename = 'output.mp4';
        const muxArgs = hasSubtitle
            ? ['-i', videoInputName, '-c', 'copy', '-movflags', '+faststart', outputFilename]
            : ['-i', videoInputName, '-c', 'copy', outputFilename];

        console.log('[Download][Kino][5/6] running ffmpeg remux', muxArgs);
        await ffmpeg.exec(muxArgs);

        const data = await ffmpeg.readFile(outputFilename);
        if (!data || (data.byteLength || data.length || 0) === 0) {
            console.error('[Download][Kino] final output file is EMPTY', { muxArgs, isFmp4 });
        }
        let blob = new Blob([data.buffer], { type: 'video/mp4' });
        let downloadExt = 'mp4';

        if (hasSubtitle) {
            try {
                setTaskStatus('Rendering subtitles in browser canvas...');
                const canvasBlob = await recordVideoWithCanvasSubtitles(blob, subtitleText, video, (state) => {
                    const current = state?.currentTime || 0;
                    const duration = state?.duration || 0;
                    const percent = state?.percent || 0;
                    setTaskStatus(`Rendering subtitles in browser canvas... ${current.toFixed(0)}s / ${duration.toFixed(0)}s (${percent.toFixed(1)}%)`);
                    setTaskSubtitleProgress(`Subtitle Burn: ${current.toFixed(0)}s / ${duration.toFixed(0)}s (${percent.toFixed(1)}%)`, percent);
                }, ffmpeg);
                blob = canvasBlob;
                downloadExt = 'mp4';
            } catch (canvasErr) {
                console.warn('[CanvasBurn][Kino] failed, falling back to plain MP4:', canvasErr);
                setTaskStatus('Subtitle canvas render failed. Downloading video only...');
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${video.title || 'Kino'}${video.episode ? ` - S${video.season}E${video.episode}` : ''}.${downloadExt}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        setTaskStatus('Download complete!');
        downloadInProgress = false;
        task.finish(true);
        notifyDownloadCompleteForEpisode(video);
        // downloadKinoEpisode handles Kino/T1M - both movie and TV. No episode number means it
        // was a movie (see the filename line above using the same check).
        window.recordDownloadHistory({
            item_type: video.episode ? 'tv' : 'movie',
            title: video.title,
            thumbnail: window.currentDownloadContext?.thumbnail,
            season: video.season,
            episode: video.episode,
            subsBurned: hasSubtitle
        });
        setTimeout(() => { hideDownloadModal(); }, 1000);

    } catch (err) {
        console.error('[Download][Kino] FAILED', {
            name: err?.name,
            message: err?.message,
            stack: err?.stack,
            provider: video?.provider,
            playlistUrl: video?.playlist
        });
        setTaskStatus(`Download failed: ${err?.message || 'unknown error'}`);
        if (typeof window.showLimitToast === 'function') {
            window.showLimitToast(`Download failed: ${err?.message || 'unknown error'}`);
        }
        downloadInProgress = false;
        task.finish(false);
        setTimeout(hideDownloadModal, 2000);
    }
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
window.downloadKinoEpisode = downloadKinoEpisode;
// The anime/movie/TV download panels mirror their own burn-checkbox state into this modal's
// #downloadIncludeSubs BEFORE calling the download function (see dlApplyBurnChoiceToModal /
// mdlApplyBurnChoiceToModal in moviePlayer.js) - but ensureDownloadModal() only builds that
// element the first time a download modal is shown, so on someone's very first download this
// ever ran on the page, the checkbox didn't exist yet to mirror into and the burn choice was
// silently dropped (worked fine from the second download on, once the modal DOM already
// existed). Exposed so the panel can build the modal DOM before mirroring into it.
window.ensureDownloadModal = ensureDownloadModal;
window.updateDownloadButtons = updateDownloadButtons;
