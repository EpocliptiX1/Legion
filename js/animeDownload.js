// animeDownload.js

// This function handles the actual download trigger
async function downloadStream(m3u8Url, fileName) {
    // FFmpeg is loaded in the client browser here
    const { createFFmpeg, fetchFile } = FFmpeg; // Ensure you import these correctly based on your version
    const ffmpeg = createFFmpeg({ log: true });
    await ffmpeg.load();

    await ffmpeg.run("-i", m3u8Url, "-c", "copy", "output.mp4");

    const data = ffmpeg.FS("readFile", "output.mp4");
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}.mp4`;
    a.click();
}

// Logic for SUB button
document.getElementById('btnSub').addEventListener('click', async () => {
    handleDownload('sub');
});

// Logic for DUB button
document.getElementById('btnDub').addEventListener('click', async () => {
    handleDownload('dub');
});

async function handleDownload(type) {
    const epText = document.getElementById('episodeNum')?.textContent || '1';
    const epNum = parseInt(epText, 10) || 1;
    const imdbIdText = document.getElementById('imdbId')?.innerText || '';
    const match = imdbIdText.match(/MAL\s*(\d+)/i);
    const malId = match?.[1];

    if (!malId) return alert('MAL ID not found!');

    try {
        alert(`Fetching ${type.toUpperCase()} stream...`);
        const response = await fetch(`/api/megaplay/extract/${malId}/${epNum}/${type}`);
        const data = await response.json();

        if (data.sourceUrl) {
            await downloadStream(data.sourceUrl, `Anime_EP${epNum}_${type}`);
        } else {
            alert('Source not found.');
        }
    } catch (err) {
        alert('Download preparation failed.');
    }
}