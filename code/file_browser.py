#!/usr/bin/env python3
"""
Simple web application to browse files in the current directory.
Uses Python's built-in http.server - no external dependencies needed.
"""

import http.server
import socketserver
import os
import html
import secrets
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs
from datetime import datetime

PORT = 5000
BASE_DIR = Path('/home/ubuntu')

# Hardcoded credentials
USERNAME = 'admin'
PASSWORD = 'admin123'

# Session management
sessions = {}

TEXT_EXTENSIONS = {'.md', '.txt', '.py', '.js', '.html', '.css', '.json', '.yaml', '.yml', '.xml', '.sh', '.bash', '.log'}
MARKDOWN_EXTENSIONS = {'.md'}
DIRECT_VIEW_EXTENSIONS = {'.html', '.htm', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.pdf', '.xls', '.xlsx'}


def get_file_type(filename):
    """Get the type of file for display."""
    if any(filename.endswith(ext) for ext in MARKDOWN_EXTENSIONS):
        return 'markdown'
    elif any(filename.endswith(ext) for ext in TEXT_EXTENSIONS):
        return 'text'
    else:
        return 'binary'


def format_file_size(size):
    """Format file size in human readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


class FileBrowserHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def check_auth(self):
        """Check if user is authenticated via session cookie."""
        cookie_header = self.headers.get('Cookie', '')
        for cookie in cookie_header.split(';'):
            if cookie.strip().startswith('session='):
                session_id = cookie.split('=')[1].strip()
                if session_id in sessions:
                    return True
        return False

    def generate_login_html(self, error=None, next_path='/'):
        """Generate login page HTML."""
        error_msg = f'<p style="color:red;">{error}</p>' if error else ''
        return f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - File Browser</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; margin: 0; }}
        .login-box {{ background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 100%; max-width: 350px; }}
        h1 {{ color: #333; text-align: center; margin-bottom: 30px; }}
        input {{ width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }}
        button {{ width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }}
        button:hover {{ background: #0056b3; }}
        .error {{ color: #dc3545; text-align: center; margin-bottom: 15px; }}
    </style>
</head>
<body>
    <div class="login-box">
        <h1>🔐 File Browser</h1>
        {error_msg}
        <form method="POST" action="/login">
            <input type="hidden" name="next" value="{next_path}">
            <input type="text" name="username" placeholder="Username" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>'''

    def do_GET(self):
        """Handle GET requests."""
        path = unquote(self.path)

        # Login page is always accessible
        if path == '/login' or path.startswith('/login?'):
            # Extract 'next' query parameter
            if '?' in path:
                parsed = urlparse(path)
                qs = parse_qs(parsed.query)
                next_path = qs.get('next', ['/'])[0]
            else:
                next_path = '/'
            login_html = self.generate_login_html(next_path=next_path)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(login_html))
            self.end_headers()
            self.wfile.write(login_html.encode())
            return

        # Logout - clear session
        if path == '/logout':
            cookie_header = self.headers.get('Cookie', '')
            for cookie in cookie_header.split(';'):
                if cookie.strip().startswith('session='):
                    session_id = cookie.split('=')[1].strip()
                    sessions.pop(session_id, None)
            self.send_response(302)
            self.send_header('Location', '/login')
            self.send_header('Set-Cookie', 'session=; Path=/; Max-Age=0')
            self.end_headers()
            return

        # Check authentication for all other requests
        if not self.check_auth():
            # Redirect to login page with the original path as 'next' parameter
            next_path = path if path != '/login' else '/'
            encoded_next = next_path if next_path == '/' else next_path
            self.send_response(302)
            self.send_header('Location', f'/login?next={encoded_next}')
            self.end_headers()
            return

        if path == '/':
            self.serve_index('.')
        elif path.startswith('/view/'):
            # View file content
            filepath = path[5:].lstrip('/')  # Remove '/view/' prefix and leading slash
            # Serve HTML and image files directly - redirect to path without /view/
            if any(filepath.endswith(ext) for ext in DIRECT_VIEW_EXTENSIONS):
                self.send_response(302)
                self.send_header('Location', '/' + filepath)
                self.end_headers()
            else:
                self.serve_file_content(filepath)
        elif path.startswith('/download/'):
            # Download file
            filepath = path[10:]  # Remove '/download/' prefix
            self.download_file(filepath)
        else:
            # Let default handler serve static files
            super().do_GET()

    def do_POST(self):
        """Handle POST requests for login."""
        if self.path == '/login':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')

            # Parse form data
            params = {}
            for pair in post_data.split('&'):
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    params[key] = unquote(value)

            username = params.get('username', '')
            password = params.get('password', '')

            if username == USERNAME and password == PASSWORD:
                # Create session
                session_id = secrets.token_hex(16)
                sessions[session_id] = True

                # Get redirect target from 'next' field, default to '/'
                redirect_to = params.get('next', '/')

                # Redirect to original page with session cookie
                self.send_response(302)
                self.send_header('Location', redirect_to)
                self.send_header('Set-Cookie', f'session={session_id}; Path=/')
                self.end_headers()
            else:
                # Login failed - preserve the 'next' parameter
                next_path = params.get('next', '/')
                login_html = self.generate_login_html('Invalid username or password', next_path=next_path)
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', len(login_html))
                self.end_headers()
                self.wfile.write(login_html.encode())
        else:
            self.send_error(405, 'Method not allowed')

    def serve_index(self, rel_path):
        """Serve the file listing page."""
        dir_path = BASE_DIR / rel_path

        # Security check
        try:
            if not dir_path.resolve().is_relative_to(BASE_DIR):
                self.send_error(403, "Access denied")
                return
        except:
            self.send_error(403, "Access denied")
            return

        items = []

        # Add parent directory link if not at root
        if BASE_DIR != Path('/') and dir_path != BASE_DIR.parent:
            items.append({
                'name': '..',
                'type': 'dir',
                'size': '',
                'link': '/' if rel_path == '.' or dir_path.parent == BASE_DIR else f'/view/{dir_path.parent.relative_to(BASE_DIR)}',
                'mtime': ''
            })

        try:
            entries = sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        except PermissionError:
            self.send_error(403, "Permission denied")
            return

        for item in entries:
            item_rel = item.relative_to(BASE_DIR)
            item_type = 'dir' if item.is_dir() else get_file_type(item.name)
            item_size = format_file_size(item.stat().st_size) if item.is_file() else ''
            item_link = f'/view/{item_rel}'
            item_mtime = datetime.fromtimestamp(item.stat().st_mtime).strftime('%Y-%m-%d %H:%M')

            items.append({
                'name': item.name,
                'type': item_type,
                'size': item_size,
                'link': item_link,
                'mtime': item_mtime
            })

        html_content = self.generate_index_html(items)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(html_content))
        self.end_headers()
        self.wfile.write(html_content.encode())

    def serve_file_content(self, filepath):
        """Serve the content of a file."""
        file_path = BASE_DIR / filepath

        # Security check
        try:
            if not file_path.resolve().is_relative_to(BASE_DIR):
                self.send_error(403, "Access denied")
                return
        except:
            self.send_error(403, "Access denied")
            return

        if not file_path.exists():
            self.send_error(404, "File not found")
            return

        if file_path.is_dir():
            self.serve_index(filepath)
            return

        file_type = get_file_type(file_path.name)

        try:
            content = file_path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            try:
                content = file_path.read_text(encoding='latin-1')
            except:
                self.send_error(500, "Unable to decode file")
                return

        if file_type == 'markdown':
            # Simple markdown to HTML conversion
            html_content = self.markdown_to_html(content, filepath)
        else:
            # Escape HTML for text files
            html_content = self.generate_text_viewer(content, filepath, file_path.name, file_type)

        html_bytes = html_content.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(html_bytes))
        self.end_headers()
        self.wfile.write(html_bytes)

    def download_file(self, filepath):
        """Download a file."""
        # URL decode the filepath (since / is encoded as %2F)
        filepath = unquote(filepath)
        file_path = BASE_DIR / filepath

        # Security check
        try:
            if not file_path.resolve().is_relative_to(BASE_DIR):
                self.send_error(403, "Access denied")
                return
        except:
            self.send_error(403, "Access denied")
            return

        if not file_path.exists() or file_path.is_dir():
            self.send_error(404, "File not found")
            return

        # Read file content and send with proper headers
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
        except IOError:
            self.send_error(500, "Cannot read file")
            return

        # Guess content type
        import mimetypes
        content_type, _ = mimetypes.guess_type(str(file_path))
        if content_type is None:
            content_type = 'application/octet-stream'

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', len(content))
        self.send_header('Content-Disposition', f'attachment; filename="{file_path.name}"')
        self.end_headers()
        self.wfile.write(content)

    def markdown_to_html(self, content, filepath):
        """Simple markdown to HTML conversion."""
        import re

        # Escape HTML first
        lines = content.split('\n')
        html_lines = []

        in_code_block = False
        in_table = False
        seen_separator = False  # Track if we've seen the |---| separator in current table
        entry_counter = 0  # Counter for auto-numbering h2 entries

        for line in lines:
            # Code blocks
            if line.strip().startswith('```'):
                if not in_code_block:
                    in_code_block = True
                    html_lines.append('<pre><code>')
                else:
                    in_code_block = False
                    html_lines.append('</code></pre>')
                continue

            if in_code_block:
                html_lines.append(html.escape(line))
                continue

            # Headers
            if line.startswith('#### '):
                html_lines.append(f'<h4>{html.escape(line[5:])}</h4>')
            elif line.startswith('### '):
                html_lines.append(f'<h3>{html.escape(line[4:])}</h3>')
            elif line.startswith('## '):
                html_lines.append(f'<h2>{html.escape(line[3:])}</h2>')
            elif line.startswith('# '):
                html_lines.append(f'<h1>{html.escape(line[2:])}</h1>')
            # Horizontal rule
            elif line.strip() == '---' or line.strip() == '***' or line.strip() == '___':
                html_lines.append('<hr>')
            # Blockquotes
            elif line.startswith('> '):
                html_lines.append(f'<blockquote>{html.escape(line[2:])}</blockquote>')
            # Unordered lists
            elif line.startswith('- ') or line.startswith('* '):
                html_lines.append(f'<li>{html.escape(line[2:])}</li>')
            # Ordered lists
            elif line and line[0].isdigit() and '. ' in line[:4]:
                html_lines.append(f'<li>{html.escape(line[line.index(". ")+2:])}</li>')
            # Table detection
            elif '|' in line and line.strip().startswith('|'):
                # Check if this is a separator line (|---|---|---)
                cells = [c.strip() for c in line.split('|') if c.strip()]
                # A separator cell contains only dashes and optional colons (e.g., ---, :--, --:, :--:, :-:)
                is_separator = cells and all(re.match(r'^:?-+:?$', c) for c in cells if c)

                if is_separator:
                    if in_table:
                        # Skip separator line but don't close table - mark that we've seen it
                        seen_separator = True
                        continue
                    else:
                        # Separator before any row - just skip it
                        continue

                # This is a header or data row
                cells = [c.strip() for c in line.split('|') if c.strip()]
                if cells:
                    # First row in table is header (<th>), rows after separator are data (<td>)
                    tag = 'th' if (not in_table and not seen_separator) else 'td'
                    if not in_table:
                        html_lines.append('<table>')
                        in_table = True
                        seen_separator = False
                    html_lines.append('<tr>')
                    for cell in cells:
                        # Convert markdown links to placeholder, escape HTML, then restore links
                        placeholder = '___LINK{}___'
                        links = []
                        def link_replace(m):
                            links.append(m.group(0))
                            return placeholder.format(len(links))
                        cell = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link_replace, cell)
                        cell = html.escape(cell)
                        for i, link in enumerate(links):
                            link_html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', link)
                            cell = cell.replace(placeholder.format(i+1), link_html)
                        html_lines.append(f'<{tag}>{cell}</{tag}>')
                    html_lines.append('</tr>')
            else:
                # Convert markdown links first, then escape remaining text
                line = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', line)
                # Bold and italic
                if '**' in line:
                    if in_table:
                        html_lines.append('</table>')
                        in_table = False
                    line = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', line)
                    html_lines.append(f'<p>{line}</p>')
                elif '*' in line:
                    if in_table:
                        html_lines.append('</table>')
                        in_table = False
                    line = re.sub(r'\*(.+?)\*', r'<em>\1</em>', line)
                    html_lines.append(f'<p>{line}</p>')
                # Inline code
                elif '`' in line:
                    if in_table:
                        html_lines.append('</table>')
                        in_table = False
                    line = re.sub(r'`(.+?)`', r'<code>\1</code>', line)
                    html_lines.append(f'<p>{line}</p>')
                # Empty lines - close table if open
                elif line.strip() == '':
                    if in_table:
                        html_lines.append('</table>')
                        in_table = False
                    html_lines.append('<br>')
                # Regular paragraphs - close table if open, then process
                else:
                    if in_table:
                        html_lines.append('</table>')
                        in_table = False
                    html_lines.append(f'<p>{line}</p>')

        # Close any open table
        if in_table:
            html_lines.append('</table>')

        body_content = '\n'.join(html_lines)

        # Encode filepath for URL
        encoded_filepath = filepath.replace('/', '%2F')

        # Add back/links header
        header = f'''
        <div style="max-width:1200px;margin:10px auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:15px;background:#f8f9fa;border-radius:8px;">
                <div>
                    <h1 style="margin:0;color:#333;">📄 {html.escape(filepath.split('/')[-1])} <span style="font-size:0.5em;background:#d4edda;color:#155724;padding:2px 8px;border-radius:4px;vertical-align:middle;">MARKDOWN</span></h1>
                </div>
                <div style="display:flex;gap:10px;">
                    <a href="/" style="color:#007bff;text-decoration:none;padding:8px 16px;background:white;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">← 返回列表</a>
                    <a href="/download/{encoded_filepath}" style="color:#28a745;text-decoration:none;padding:8px 16px;background:white;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.1);border:1px solid #28a745;">⬇ 下载</a>
                </div>
            </div>
        </div>
        '''

        return f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(filepath.split('/')[-1])}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 0; }}
        .content {{ background: white; padding: 15px 25px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 1200px; margin: 10px auto; }}
        .content br {{ display: none; }}
        h1 {{ color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; margin-bottom: 12px; font-size: 1.8rem; }}
        h2 {{ color: #333; border-bottom: 1px solid #dee2e6; padding-bottom: 3px; margin: 12px 0 8px 0; font-size: 1.4rem; }}
        p {{ margin: 4px 0; line-height: 1.5; }}
        pre {{ background: #1e1e1e; color: #d4d4d4; padding: 8px; border-radius: 5px; overflow-x: auto; margin: 8px 0; font-size: 0.9rem; }}
        code {{ background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: Consolas, monospace; font-size: 0.9em; }}
        pre code {{ background: transparent; color: inherit; padding: 0; }}
        blockquote {{ border-left: 4px solid #007bff; margin: 8px 0; padding-left: 10px; color: #666; font-style: italic; }}
        table {{ border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 0.95rem; }}
        th, td {{ border: 1px solid #ddd; padding: 5px 8px; text-align: left; }}
        th {{ background: #f8f9fa; }}
        li {{ margin: 0.1em 0; }}
        hr {{ border: none; border-top: 1px solid #ddd; margin: 12px 0; }}
    </style>
</head>
<body>
    {header}
    <div class="content">
        {body_content}
    </div>
</body>
</html>'''

    def generate_text_viewer(self, content, filepath, filename, filetype):
        """Generate HTML for text file viewing."""
        escaped_content = html.escape(content)
        encoded_filepath = filepath.replace('/', '%2F')

        header = f'''
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding:15px;background:#f8f9fa;border-radius:8px;">
            <div>
                <h1 style="margin:0;color:#333;">📄 {html.escape(filename)} <span style="font-size:0.5em;background:#d1ecf1;color:#0c5460;padding:2px 8px;border-radius:4px;vertical-align:middle;">TEXT</span></h1>
            </div>
            <div style="display:flex;gap:10px;">
                <a href="/" style="color:#007bff;text-decoration:none;padding:8px 16px;background:white;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">← 返回列表</a>
                <a href="/download/{encoded_filepath}" style="color:#28a745;text-decoration:none;padding:8px 16px;background:white;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.1);border:1px solid #28a745;">⬇ 下载</a>
            </div>
        </div>
        '''

        return f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(filename)}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
        .content {{ background: white; padding: 30px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        pre {{ background: #f8f9fa; padding: 20px; border-radius: 4px; overflow-x: auto; line-height: 1.5; font-family: Consolas, Monaco, Courier New, monospace; white-space: pre-wrap; word-wrap: break-word; }}
    </style>
</head>
<body>
    {header}
    <div class="content">
        <pre>{escaped_content}</pre>
    </div>
</body>
</html>'''

    def generate_index_html(self, items):
        """Generate HTML for file listing."""
        rows = []
        for item in items:
            if item['name'] == '..':
                type_badge = '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:4px;font-size:0.8em;">Parent</span>'
                icon = '📁'
            elif item['type'] == 'dir':
                type_badge = '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:4px;font-size:0.8em;">Directory</span>'
                icon = '📁'
            elif item['type'] == 'markdown':
                type_badge = '<span style="background:#d4edda;color:#155724;padding:2px 8px;border-radius:4px;font-size:0.8em;">Markdown</span>'
                icon = '📝'
            elif item['type'] == 'text':
                type_badge = '<span style="background:#d1ecf1;color:#0c5460;padding:2px 8px;border-radius:4px;font-size:0.8em;">Text</span>'
                icon = '📄'
            else:
                type_badge = '<span style="background:#e2e3e5;color:#383d41;padding:2px 8px;border-radius:4px;font-size:0.8em;">Binary</span>'
                icon = '📎'

            rows.append(f'''
            <tr>
                <td><a href="{item['link']}">{icon} {html.escape(item['name'])}</a></td>
                <td>{type_badge}</td>
                <td style="color:#666;">{item['size']}</td>
                <td style="color:#666;">{item.get('mtime', '')}</td>
            </tr>''')

        rows_html = '\n'.join(rows)

        return f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Browser</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
        .header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }}
        h1 {{ color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; margin: 0; }}
        .logout {{ color: #dc3545; text-decoration: none; padding: 8px 16px; background: white; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .logout:hover {{ background: #f8f9fa; }}
        table {{ width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }}
        th {{ background: #007bff; color: white; padding: 12px 15px; text-align: left; }}
        td {{ padding: 12px 15px; border-bottom: 1px solid #eee; }}
        tr:hover {{ background: #f8f9fa; }}
        tr:last-child td {{ border-bottom: none; }}
        a {{ color: #007bff; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>📂 File Browser</h1>
        <a href="/logout" class="logout">Logout</a>
    </div>
    <table>
        <thead>
            <tr>
                <th>文件名</th>
                <th>类型</th>
                <th>大小</th>
                <th>修改时间</th>
            </tr>
        </thead>
        <tbody>
            {rows_html}
        </tbody>
    </table>
</body>
</html>'''


Handler = FileBrowserHandler

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"=" * 60)
    print(f"File Browser Started at http://localhost:{PORT}")
    print(f"Serving files from: {BASE_DIR}")
    print(f"=" * 60)
    print("\nOpen your browser and navigate to:")
    print(f"  http://localhost:{PORT}")
    print("\nPress Ctrl+C to stop the server")
    print("=" * 60)
    httpd.serve_forever()
