function setVerticalRowHeight() {
    const verticalRow = document.querySelector('.vertical-recommend-row');
    const mainInner = document.querySelector('.movie-header-main-inner');
    if (!verticalRow || !mainInner) return;

    const isDesktop = window.innerWidth > 1024;
    if (isDesktop) {
        const style = window.getComputedStyle(mainInner);
        const height = mainInner.offsetHeight;
        const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const total = height + margin + padding;
        const capped = Math.min(total, 900);
        verticalRow.style.height = capped + 'px';
        verticalRow.style.maxHeight = '900px';
        console.log('[vertical-height] .vertical-recommend-row height:', capped);
    } else {
        verticalRow.style.height = '';
        verticalRow.style.maxHeight = '900px';
    }
}

function setVerticalHeight() {
    const vertical = document.querySelector('.vertical-recommend');
    const mainInner = document.querySelector('.movie-header-main-inner');
    if (!vertical || !mainInner) return;

    const style = window.getComputedStyle(mainInner);
    const height = mainInner.offsetHeight;
    const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const total = height + margin + padding;
    vertical.style.height = total + 'px';
    vertical.style.maxHeight = total + 'px';
    console.log('[vertical-height] .vertical-recommend height:', total);
}

function setDynamicEpisodeSectionHeight() {
    const wrap = document.getElementById('moviePlayerFrameWrap');
    const panel = document.getElementById('dynamicEpisodeSection');
    if (!wrap || !panel || panel.style.display === 'none') return;
    const height = Math.round(wrap.getBoundingClientRect().height || 0);
    if (height > 0) {
        panel.style.height = height + 'px';
        console.log('[vertical-height] #dynamicEpisodeSection height:', height);
    }
}

function syncAllHeights() {
    setVerticalHeight();
    setVerticalRowHeight();
    setDynamicEpisodeSectionHeight();
}

window.addEventListener('DOMContentLoaded', function() {
    const vertical = document.querySelector('.vertical-recommend');
    if (vertical) {
        vertical.style.height = '0px';
        vertical.style.maxHeight = '0px';

        if ('MutationObserver' in window) {
            const mutationObserver = new MutationObserver(() => {
                console.log('[vertical-height] MutationObserver triggered on .vertical-recommend');
                setTimeout(syncAllHeights, 100);
            });
            mutationObserver.observe(vertical, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    }

    syncAllHeights();

    const mainInner = document.querySelector('.movie-header-main-inner');
    if (mainInner && 'ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(() => {
            console.log('[vertical-height] ResizeObserver triggered on .movie-header-main-inner');
            syncAllHeights();
        });
        resizeObserver.observe(mainInner);
    }

    const moviePlayerWrap = document.getElementById('moviePlayerFrameWrap');
    if (moviePlayerWrap && 'ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(() => {
            console.log('[vertical-height] ResizeObserver triggered on #moviePlayerFrameWrap');
            setDynamicEpisodeSectionHeight();
        });
        resizeObserver.observe(moviePlayerWrap);
    }

    const kaaBtn = document.getElementById('srvPahe1');
    if (kaaBtn) {
        kaaBtn.addEventListener('click', () => {
            console.log('[vertical-height] KAA button clicked, syncing heights');
            syncAllHeights();
        });
    }

    const vidSrcBtn = document.getElementById('watchVidsrcBtn');
    if (vidSrcBtn) {
        vidSrcBtn.addEventListener('click', () => {
            console.log('[vertical-height] VidSrc button clicked, syncing heights after 1.5s');
            setTimeout(syncAllHeights, 1500);
        });
    }

    window.addEventListener('resize', () => {
        console.log('[vertical-height] Window resized, syncing heights');
        syncAllHeights();
    });

    // TEMP: Sync heights every 1 second to test if matching mechanics work
    setInterval(() => {
        syncAllHeights();
    }, 1000);
    console.log('[vertical-height] TEMP: Enabled 1-second polling for testing');
});