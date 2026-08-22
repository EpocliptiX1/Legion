console.log('[vertical-height] Script loaded!');

function setVerticalRowHeight() {
    const verticalRow = document.querySelector('.vertical-recommend-row');
    const mainInner = document.querySelector('.movie-header-main-inner');
    if (!verticalRow || !mainInner) {
        console.log('[vertical-height] setVerticalRowHeight: Missing elements', {
            verticalRow: !!verticalRow,
            mainInner: !!mainInner
        });
        return;
    }

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
        console.log('[vertical-height] setVerticalRowHeight APPLIED:', {
            mainInnerHeight: height,
            margin,
            padding,
            total,
            capped,
            applied: capped + 'px'
        });
    } else {
        verticalRow.style.height = '';
        verticalRow.style.maxHeight = '900px';
        console.log('[vertical-height] setVerticalRowHeight: Mobile mode');
    }
}

function setVerticalHeight() {
    const vertical = document.querySelector('.vertical-recommend');
    const mainInner = document.querySelector('.movie-header-main-inner');
    if (!vertical || !mainInner) {
        console.log('[vertical-height] setVerticalHeight: Missing elements', {
            vertical: !!vertical,
            mainInner: !!mainInner
        });
        return;
    }

    const style = window.getComputedStyle(mainInner);
    const height = mainInner.offsetHeight;
    const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const total = height + margin + padding;
    // Was 'height: 100%' (relative to whatever .vertical-recommend's parent
    // happens to resolve to -- not necessarily tied to mainInner at all) instead
    // of a direct pixel value. Match setVerticalRowHeight()'s approach: pin the
    // actual measured height directly, same as the row version already does.
    vertical.style.maxHeight = total + 'px';
    vertical.style.height = total + 'px';
    console.log('[vertical-height] setVerticalHeight APPLIED:', {
        mainInnerHeight: height,
        margin,
        padding,
        total,
        applied: total + 'px',
        verticalCurrentHeight: vertical.offsetHeight
    });
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

    // DIAGNOSTIC (temporary): forcibly re-measure .movie-header-main-inner and
    // pin .vertical-recommend's height directly to it every 100ms for 10s after
    // load -- much more aggressive than syncAllHeights()'s event-driven
    // triggers. If .vertical-recommend consistently matches mainInner's height
    // throughout this window, the height math itself is fine and the real bug
    // is a timing/detection issue (something changes mainInner's height after
    // the normal observers have already fired and nothing re-triggers a sync).
    // If it's STILL short even under this constant forcing, the calculation in
    // setVerticalHeight() itself is wrong (wrong element measured, box-sizing
    // mismatch, etc).
    (function diagnosticForceHeightFor10s() {
        const vertical = document.querySelector('.vertical-recommend');
        const mainInner = document.querySelector('.movie-header-main-inner');
        if (!vertical || !mainInner) {
            console.log('[vertical-height][DIAGNOSTIC] skipped -- missing element(s)', {
                vertical: !!vertical, mainInner: !!mainInner
            });
            return;
        }
        const startedAt = Date.now();
        const intervalId = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            if (elapsed >= 10000) {
                clearInterval(intervalId);
                console.log('[vertical-height][DIAGNOSTIC] done after 10s');
                return;
            }
            const targetHeight = mainInner.offsetHeight;
            vertical.style.maxHeight = targetHeight + 'px';
            vertical.style.height = targetHeight + 'px';
            const actualHeight = vertical.offsetHeight;
            console.log('[vertical-height][DIAGNOSTIC]', {
                elapsedMs: elapsed,
                mainInnerHeight: targetHeight,
                verticalHeightAfterForce: actualHeight,
                matches: actualHeight === targetHeight
            });
        }, 100);
    })();
});