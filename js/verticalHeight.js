// Dynamically set .vertical-recommend-row height to match .movie-header-main-inner after page load (for mobile/stacked layout)
function setVerticalRowHeight() {
    var verticalRow = document.querySelector('.vertical-recommend-row');
    var mainInner = document.querySelector('.movie-header-main-inner');
    if (verticalRow && mainInner) {
        // Only set fixed height if desktop (sidebar visible)
        var isDesktop = window.innerWidth > 1024; // adjust breakpoint as needed
        if (isDesktop) {
            var style = window.getComputedStyle(mainInner);
            var height = mainInner.offsetHeight;
            var margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
            var padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
            var total = height + margin + padding;
            var capped = Math.min(total, 900);
            verticalRow.style.height = capped + 'px';
            verticalRow.style.maxHeight = '900px';
            // Force flexbox reflow for children
            var row = verticalRow.querySelector('.horizontal-scroll-row');
            if (row) {
                row.style.display = 'none';
                void row.offsetHeight;
                row.style.display = '';
            }
            // Debug log
            console.log('[vertical-height] (desktop) .vertical-recommend-row height set:', capped);
        } else {
            // Mobile/stacked: let it auto-size, but cap max height
            verticalRow.style.height = '';
            verticalRow.style.maxHeight = '900px';
            // Debug log
            console.log('[vertical-height] (mobile) .vertical-recommend-row maxHeight set to 900px');
        }
    } else {
        if (!verticalRow) console.log('[vertical-height] .vertical-recommend-row not found');
        if (!mainInner) console.log('[vertical-height] .movie-header-main-inner not found');
    }
}
// Dynamically set .vertical-recommend height to match .movie-header-main-inner after page load

function setVerticalHeight() {
    var vertical = document.querySelector('.vertical-recommend');
    var mainInner = document.querySelector('.movie-header-main-inner');
    if (vertical && mainInner) {
        var style = window.getComputedStyle(mainInner);
        var height = mainInner.offsetHeight;
        var margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
        var padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        var total = height + margin + padding;
        vertical.style.height = total + 'px';
        vertical.style.maxHeight = total + 'px';
        // Force flexbox reflow for children
        var row = vertical.querySelector('.horizontal-scroll-row');
        if (row) {
            row.style.display = 'none';
            void row.offsetHeight;
            row.style.display = '';
        }
        // Detailed debug log
        console.log('[vertical-height] Matching .vertical-recommend to .movie-header-main-inner');
        console.log('[vertical-height] .movie-header-main-inner offsetHeight:', height);
        console.log('[vertical-height] .movie-header-main-inner margin:', margin);
        console.log('[vertical-height] .movie-header-main-inner padding:', padding);
        console.log('[vertical-height] Total height set:', total);
    } else {
        if (!vertical) console.log('[vertical-height] .vertical-recommend not found');
        if (!mainInner) console.log('[vertical-height] .movie-header-main-inner not found');
    }
}

function setDynamicEpisodeSectionHeight() {
    var wrap = document.getElementById('moviePlayerFrameWrap');
    var panel = document.getElementById('dynamicEpisodeSection');
    if (!wrap || !panel || panel.style.display === 'none') return;
    var height = Math.round(wrap.getBoundingClientRect().height || 0);
    if (height > 0) {
        panel.style.height = height + 'px';
        console.log('[vertical-height] Synced #dynamicEpisodeSection height to moviePlayerFrameWrap:', height);
    }
}

(function waitForKaaButton() {
    const interval = setInterval(() => {
        const btn = document.getElementById("srvPahe1");

        if (!btn) return;

        clearInterval(interval);

        btn.addEventListener("click", () => {
            let count = 0;

            // Call immediately
            setVerticalHeight();
            setVerticalRowHeight();
            setDynamicEpisodeSectionHeight();
            count++;

            const timer = setInterval(() => {
                setVerticalHeight();
                setVerticalRowHeight();
                setDynamicEpisodeSectionHeight();

                console.log(`[waitForKaaButton] Called vertical & dynamic height sync ${count} times`);
                count++;

                if (count >= 11) {
                    clearInterval(timer);
                }
            }, 1100);
        });
    }, 100);
})();
window.addEventListener('DOMContentLoaded', function() {
    var vertical = document.querySelector('.vertical-recommend');
    if (vertical) {
        vertical.style.height = '0px';
        vertical.style.maxHeight = '0px';
    }
    setTimeout(setVerticalHeight, 1000);
    setTimeout(setVerticalRowHeight, 1000);
    setTimeout(setDynamicEpisodeSectionHeight, 1000);

    // Update on button clicks
    document.body.addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            setTimeout(setVerticalHeight, 100);
            setTimeout(setVerticalRowHeight, 100);
            setTimeout(setDynamicEpisodeSectionHeight, 100);
        }
    });

    // Special: Update 1.5s after clicking #watchVidsrcBtn
    var vidSrcBtn = document.getElementById('watchVidsrcBtn');
    if (vidSrcBtn) {
        vidSrcBtn.addEventListener('click', function() {
            setTimeout(setVerticalHeight, 1500);
            setTimeout(setVerticalRowHeight, 1500);
            setTimeout(setDynamicEpisodeSectionHeight, 1500);
        });
    }

    // Update on resize
    window.addEventListener('resize', function() {
        setTimeout(setVerticalHeight, 100);
        setTimeout(setVerticalRowHeight, 100);
        setTimeout(setDynamicEpisodeSectionHeight, 100);
    });
});