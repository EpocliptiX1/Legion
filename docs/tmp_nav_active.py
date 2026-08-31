from pathlib import Path

files = [
    'html/movieInfo.html',
    'html/allMovies.html',
    'html/forum.html',
    'html/indexBrowse.html',
    'html/indexMain.html',
    'html/personalList.html',
    'html/customPlaylists.html',
    'html/searchQueryResult.html'
]

script = '''<script id="navActiveScriptInserted">
(function() {
    const currentPath = window.location.pathname.split('/').pop();
    const activeHref = '/html/' + currentPath;
    document.querySelectorAll('.sidebar-nav-link, .navbar-page-links a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === activeHref) {
            if (link.classList.contains('sidebar-nav-link')) {
                link.classList.add('sidebar-active');
            }
            if (link.closest('.navbar-page-links')) {
                link.classList.add('navbar-link-active');
            }
        } else {
            link.classList.remove('sidebar-active');
            link.classList.remove('navbar-link-active');
        }
    });
})();
</script>\n'''

for file_path in files:
    path = Path(file_path)
    if not path.exists():
        print(f'SKIP missing {file_path}')
        continue
    data = path.read_text(encoding='utf-8')
    data = data.replace('class="sidebar-nav-link sidebar-active"', 'class="sidebar-nav-link"')
    data = data.replace("class='sidebar-nav-link sidebar-active'", "class='sidebar-nav-link'")
    data = data.replace('class="navbar-link-active"', '')
    data = data.replace("class='navbar-link-active'", '')
    if 'id="navActiveScriptInserted"' not in data:
        nav_end = data.find('</nav>')
        if nav_end != -1:
            nav_end += len('</nav>')
            data = data[:nav_end] + '\n' + script + data[nav_end:]
            print(f'INSERTED script into {file_path}')
        else:
            print(f'NO NAV found in {file_path}')
            continue
    path.write_text(data, encoding='utf-8')
    print(f'UPDATED {file_path}')
