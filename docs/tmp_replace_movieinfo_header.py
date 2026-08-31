from pathlib import Path

source_path = Path('html/movieInfo.html')
source = source_path.read_text(encoding='utf-8')

sidebar_marker = '<div class="left-sidebar bottom-sidebar" id="leftSidebar">'
navbar_marker = '<nav class="navbar">'
nav_end_marker = '</nav>'

sidebar_start = source.find(sidebar_marker)
if sidebar_start == -1:
    raise SystemExit('Source sidebar marker not found')
nav_start = source.find(navbar_marker, sidebar_start)
if nav_start == -1:
    raise SystemExit('Source navbar marker not found')
nav_end = source.find(nav_end_marker, nav_start)
if nav_end == -1:
    raise SystemExit('Source nav end marker not found')
nav_end += len(nav_end_marker)

sidebar_block = source[sidebar_start:nav_start]
navbar_block = source[nav_start:nav_end]
source_block = source[sidebar_start:nav_end]

files = [
    'html/allMovies.html',
    'html/forum.html',
    'html/indexBrowse.html',
    'html/indexMain.html',
    'html/personalList.html',
    'html/customPlaylists.html',
    'html/searchQueryResult.html'
]

for file_path in files:
    path = Path(file_path)
    if not path.exists():
        print(f'SKIP missing {file_path}')
        continue
    data = path.read_text(encoding='utf-8')
    if sidebar_marker in data:
        start = data.index(sidebar_marker)
        nav = data.index(navbar_marker, start)
        end = data.index(nav_end_marker, nav) + len(nav_end_marker)
        data = data[:start] + source_block + data[end:]
        path.write_text(data, encoding='utf-8')
        print(f'UPDATED {file_path} (sidebar+navbar)')
    elif navbar_marker in data:
        nav = data.index(navbar_marker)
        end = data.index(nav_end_marker, nav) + len(nav_end_marker)
        data = data[:nav] + source_block + data[end:]
        path.write_text(data, encoding='utf-8')
        print(f'UPDATED {file_path} (sidebar+navbar inserted)')
    else:
        print(f'SKIP no navbar in {file_path}')
