/*
 * Replaces legacy Unicode UI emoji with the matching Heroicons outline SVG.
 * Icons are inline so they inherit the surrounding text color and work offline.
 * Heroicons: https://heroicons.com (MIT License)
 */
(function () {
    'use strict';

    const paths = {
        'fire': '<path stroke-linecap="round" stroke-linejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 8.05 5.988c.583.19 1.18.335 1.79.428A5.99 5.99 0 0 0 12.607 3.6a5.989 5.989 0 0 1 2.755 1.614Z" />',
        'calendar-days': '<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h12a2.25 2.25 0 0 1 2.25 2.25v11.25M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25M3.75 18.75v-7.5A2.25 2.25 0 0 1 6 9h12a2.25 2.25 0 0 1 2.25 2.25v7.5" />',
        'banknotes': '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.104c1.128.257 2.203-.682 2.203-1.84V4.986c0-.863-.584-1.614-1.421-1.819A60.07 60.07 0 0 0 3.032 1.063 1.875 1.875 0 0 0 .75 2.903v13.112c0 .863.584 1.614 1.5 1.819ZM16.5 6.75h.008v.008H16.5V6.75Zm0 3.75h.008v.008H16.5V10.5Zm0 3.75h.008v.008H16.5v-.008ZM6 6.75h.008v.008H6V6.75Zm0 3.75h.008v.008H6V10.5Zm0 3.75h.008v.008H6v-.008ZM9 6.75h.008v.008H9V6.75Zm0 3.75h.008v.008H9V10.5Zm0 3.75h.008v.008H9v-.008Z" />',
        'film': '<path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375" />',
        'chat': '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />',
        'trash': '<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.916 21H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.134h-3.32c-1.18 0-2.09.954-2.09 2.134v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />',
        'warning': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.949 3.374H4.646c-1.732 0-2.815-1.874-1.949-3.374L10.051 3.39c.866-1.5 3.032-1.5 3.898 0l7.354 12.736ZM12 15.75h.008v.008H12v-.008Z" />',
        'check-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m6.75 2.25a9.75 9.75 0 1 1-19.5 0 9.75 9.75 0 0 1 19.5 0Z" />',
        'x-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5m12-2.25a9.75 9.75 0 1 1-19.5 0 9.75 9.75 0 0 1 19.5 0Z" />',
        'clock': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
        'signal': '<path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0m-10.606 3.182a9.75 9.75 0 0 1 13.788 0M11.42 11.89a.75.75 0 0 1 1.16 0m-7.952 9.48a13.5 13.5 0 0 1 14.744 0" />',
        'bolt': '<path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25-1.5 8.25h7.5L9.75 21.75l1.5-8.25h-7.5Z" />',
        'phone': '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25A2.25 2.25 0 0 0 21.75 19.5v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a1.125 1.125 0 0 0-1.173.417l-.97 1.293c-.282.376-.769.543-1.21.382a12.035 12.035 0 0 1-7.143-7.143c-.161-.441.006-.928.382-1.21l1.293-.97c.34-.255.5-.702.417-1.173L6.963 3.102A1.125 1.125 0 0 0 5.872 2.25H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />',
        'device-phone-mobile': '<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5h3A1.5 1.5 0 0 1 15 3v18a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 21V3a1.5 1.5 0 0 1 1.5-1.5Zm.75 18.75h1.5" />',
        'device-tablet': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75h.008v.008H12v-.008ZM7.5 3.75h9A2.25 2.25 0 0 1 18.75 6v12a2.25 2.25 0 0 1-2.25 2.25h-9A2.25 2.25 0 0 1 5.25 18V6A2.25 2.25 0 0 1 7.5 3.75Z" />',
        'computer-desktop': '<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17.25v2.25m4.5-2.25v2.25m-7.5 0h10.5m-13.5-16.5h16.5v11.25H3.75V3Z" />',
        'tv': '<path stroke-linecap="round" stroke-linejoin="round" d="m15.75 3.75-3.75 3.75-3.75-3.75M3 9.75h18v9.75a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V9.75Z" />',
        'speaker-wave': '<path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M5.25 9.75 9 6.75v10.5l-3.75-3H3v-3h2.25Z" />',
        'speaker-x-mark': '<path stroke-linecap="round" stroke-linejoin="round" d="m17.25 9.75 3 3m0-3-3 3M5.25 9.75 9 6.75v10.5l-3.75-3H3v-3h2.25Z" />',
        'sparkles': '<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.091-3.091L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.091-3.091L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.091 3.091L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.091 3.091ZM18.25 9.75 18 10.5l-.25-.75A2.25 2.25 0 0 0 16.25 8.25l-.75-.25.75-.25a2.25 2.25 0 0 0 1.5-1.5L18 5.5l.25.75a2.25 2.25 0 0 0 1.5 1.5l.75.25-.75.25a2.25 2.25 0 0 0-1.5 1.5Z" />',
        'bell': '<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18.75 9.75V9A6.75 6.75 0 0 0 5.25 9v.75a8.967 8.967 0 0 1-1.56 5.022 23.848 23.848 0 0 0 5.454 1.31m5.713 0a24.255 24.255 0 0 1-5.713 0m5.713 0a3 3 0 1 1-5.713 0" />',
        'stop-circle': '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9.75v4.5m-3.75-4.5v4.5m9.75-2.25a9.75 9.75 0 1 1-19.5 0 9.75 9.75 0 0 1 19.5 0Z" />',
        'user-group': '<path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741.479 3 3 0 0 0-3.741-5.72m0 5.24v-.001c0-1.107-.285-2.148-.786-3.052m0 0A3.003 3.003 0 0 0 12 13.5a3.003 3.003 0 0 0-5.214 2.166m10.428 0A9.094 9.094 0 0 1 12 21a9.094 9.094 0 0 1-5.214-1.634m0 0A3 3 0 0 0 3 19.2a9.094 9.094 0 0 0 3.786-.48m0 0A3 3 0 0 1 6 13.5m12 0a3 3 0 1 0-6 0m-6 0a3 3 0 1 0 6 0" />',
        'hand-raised': '<path stroke-linecap="round" stroke-linejoin="round" d="M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15" />'
        , 'star': '<path stroke-linecap="round" stroke-linejoin="round" d="m11.48 3.499 2.123 5.428 5.818.379-4.476 3.737 1.452 5.646-4.917-3.119-4.917 3.119 1.452-5.646-4.476-3.737 5.818-.379L11.48 3.5Z" />'
        , 'x-mark': '<path stroke-linecap="round" stroke-linejoin="round" d="m6 18 12-12M6 6l12 12" />'
        , 'arrows-pointing-out': '<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 4.5h5.25m0 0L7.5 2.25m2.25 2.25L7.5 6.75M4.5 19.5h5.25m0 0L7.5 17.25m2.25 2.25L7.5 21.75M19.5 4.5h-5.25m0 0 2.25-2.25m-2.25 2.25 2.25 2.25M19.5 19.5h-5.25m0 0 2.25-2.25m-2.25 2.25 2.25 2.25" />'
        , 'play': '<path stroke-linecap="round" stroke-linejoin="round" d="m5.25 5.25 13.5 6.75-13.5 6.75V5.25Z" />'
        , 'arrow-down-tray': '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-4.5-6-4.5 4.5m0 0-4.5-4.5m4.5 4.5V3" />'
        , 'cog': '<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.065.39.33.715.7.913.365.196.807.196 1.172 0l1.2-.638a1.125 1.125 0 0 1 1.371.207l1.833 1.833c.39.39.47.99.207 1.371l-.638 1.2c-.196.365-.196.807 0 1.172.198.37.523.635.913.7l1.281.213c.542.09.94.56.94 1.11v2.592c0 .55-.398 1.02-.94 1.11l-1.281.213c-.39.065-.715.33-.913.7-.196.365-.196.807 0 1.172l.638 1.2a1.125 1.125 0 0 1-.207 1.371l-1.833 1.833a1.125 1.125 0 0 1-1.371.207l-1.2-.638a1.125 1.125 0 0 0-1.172 0c-.37.198-.635.523-.7.913l-.213 1.281c-.09.542-.56.94-1.11.94h-2.592c-.55 0-1.02-.398-1.11-.94l-.213-1.281a1.125 1.125 0 0 0-.7-.913 1.125 1.125 0 0 0-1.172 0l-1.2.638a1.125 1.125 0 0 1-1.371-.207l-1.833-1.833a1.125 1.125 0 0 1-.207-1.371l.638-1.2c.196-.365.196-.807 0-1.172a1.125 1.125 0 0 0-.913-.7l-1.281-.213a1.125 1.125 0 0 1-.94-1.11v-2.592c0-.55.398-1.02.94-1.11l1.281-.213c.39-.065.715-.33.913-.7.196-.365.196-.807 0-1.172l-.638-1.2a1.125 1.125 0 0 1 .207-1.371l1.833-1.833a1.125 1.125 0 0 1 1.371-.207l1.2.638c.365.196.807.196 1.172 0 .37-.198.635-.523.7-.913l.213-1.281ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />'
        , 'lock-closed': '<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 0 0-9 0v3.75m-.75 10.5h10.5A2.25 2.25 0 0 0 19.5 18.75v-6A2.25 2.25 0 0 0 17.25 10.5H6.75a2.25 2.25 0 0 0-2.25 2.25v6A2.25 2.25 0 0 0 6.75 21Z" />'
    };

    const emojiMap = {
        '🔥': ['fire', 'Trending'], '📅': ['calendar-days', 'Calendar'], '🗓': ['calendar-days', 'Calendar'],
        '💰': ['banknotes', 'Revenue'], '🎬': ['film', 'Movies'], '💬': ['chat', 'Comments'],
        '🗑️': ['trash', 'Delete'], '🗑': ['trash', 'Delete'], '⚠️': ['warning', 'Warning'], '⚠': ['warning', 'Warning'],
        '✅': ['check-circle', 'Success'], '✓': ['check-circle', 'Complete'], '❌': ['x-circle', 'Error'],
        '🕒': ['clock', 'History'], '🕘': ['clock', 'History'], '📡': ['signal', 'Airing'], '📶': ['signal', 'Signal'],
        '⚡': ['bolt', 'Trending'], '📞': ['phone', 'Phone'], '📱': ['device-phone-mobile', 'Phone'],
        '📟': ['device-tablet', 'Tablet'], '💻': ['computer-desktop', 'Laptop'], '🖥️': ['computer-desktop', 'Desktop'],
        '📺': ['tv', 'TV'], '🔊': ['speaker-wave', 'Sound on'], '🔇': ['speaker-x-mark', 'Sound off'],
        '✨': ['sparkles', 'Theme'], '🎉': ['sparkles', 'Celebration'], '🎯': ['sparkles', 'Goal'],
        '🔔': ['bell', 'Notifications'], '🛑': ['stop-circle', 'Stopped'], '🤝': ['user-group', 'Friends'],
        '🙋': ['hand-raised', 'Control request'], '🟢': ['signal', 'Online'],
        '✦': ['sparkles', 'Featured'], '★': ['star', 'Rating'], '✕': ['x-mark', 'Close'],
        '⛶': ['arrows-pointing-out', 'Fullscreen'], '▶': ['play', 'Play'], '⬇': ['arrow-down-tray', 'Download'],
        '⚙️': ['cog', 'Settings'], '⚙': ['cog', 'Settings'], '🔒': ['lock-closed', 'Locked']
    };
    const emojiPattern = new RegExp(Object.keys(emojiMap).sort((a, b) => b.length - a.length).join('|'), 'g');

    function icon(name, label) {
        return `<svg class="heroicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-label="${label}" role="img" focusable="false">${paths[name]}</svg>`;
    }

    function replaceEmoji(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !emojiPattern.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
                emojiPattern.lastIndex = 0;
                const parent = node.parentElement;
                return parent && !parent.closest('script, style, textarea, .heroicon') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const fragment = document.createDocumentFragment();
            let last = 0;
            node.nodeValue.replace(emojiPattern, (match, offset) => {
                if (offset > last) fragment.append(document.createTextNode(node.nodeValue.slice(last, offset)));
                const [name, label] = emojiMap[match];
                const wrapper = document.createElement('span');
                wrapper.className = 'heroicon-wrap';
                wrapper.innerHTML = icon(name, label);
                fragment.append(wrapper);
                last = offset + match.length;
            });
            if (last < node.nodeValue.length) fragment.append(document.createTextNode(node.nodeValue.slice(last)));
            node.replaceWith(fragment);
        });
    }

    window.Heroicons = { icon, replaceEmoji };
    document.addEventListener('DOMContentLoaded', () => {
        replaceEmoji(document.body);
        new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) replaceEmoji(node.parentElement);
            else if (node.nodeType === Node.ELEMENT_NODE && !node.matches('.heroicon, .heroicon-wrap')) replaceEmoji(node);
        }))).observe(document.body, { childList: true, subtree: true });
    });
}());
