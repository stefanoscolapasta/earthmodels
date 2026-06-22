#!/usr/bin/env python3
"""
Lightweight dev server with on-the-fly gzip + aggressive caching for static assets.

Why not python -m http.server:
- It sends every byte uncompressed. A 38 MB .splat takes ~5-30 s to download even
  on localhost depending on disk cache + headers; on a real network it's worse.
- It sends no Cache-Control, so browser refreshes re-pull the whole file.

What this does instead:
- Compresses .splat / .ply / .js / .css / .html / .svg responses with gzip if the
  client advertises Accept-Encoding: gzip. The .splat file ratios ~2.5x on this
  asset (38 MB → ~15 MB).
- Sends Cache-Control: max-age=31536000, immutable for the static splat asset, so
  hot reloads come from disk cache instantly.
- Sends Content-Length matching the encoded body so the browser shows accurate
  progress bars.

Usage:  python serve.py [port]   (default 8000)
"""

import os
import sys
import gzip
import io
import http.server
import socketserver
import urllib.parse


GZIP_TYPES = {
    ".html", ".js", ".css", ".json", ".svg", ".txt", ".xml",
    ".splat", ".ply", ".ksplat", ".spz",
}
LONG_CACHE_EXTS = {".splat", ".ply", ".ksplat", ".spz", ".jpg", ".png", ".webp"}


class GzipHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Decode and resolve path safely (SimpleHTTPRequestHandler.translate_path
        # is what the base class uses internally; we mirror it).
        parsed = urllib.parse.urlparse(self.path)
        clean = urllib.parse.unquote(parsed.path)
        fs_path = self.translate_path(clean)

        if os.path.isdir(fs_path):
            # Delegate directory listings / index.html resolution to the base.
            return super().do_GET()

        if not os.path.isfile(fs_path):
            self.send_error(404, "Not Found")
            return

        ext = os.path.splitext(fs_path)[1].lower()
        ctype = self.guess_type(fs_path)
        try:
            with open(fs_path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404, "Not Found")
            return

        accept_enc = self.headers.get("Accept-Encoding", "")
        gzip_ok = ("gzip" in accept_enc) and (ext in GZIP_TYPES)

        if gzip_ok:
            buf = io.BytesIO()
            # mtime=0 makes the gzip output deterministic (same bytes for the same
            # file across runs — friendlier to ETag/304 if we add that later).
            with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6, mtime=0) as gz:
                gz.write(body)
            payload = buf.getvalue()
            content_encoding = "gzip"
        else:
            payload = body
            content_encoding = None

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        if content_encoding:
            self.send_header("Content-Encoding", content_encoding)
            self.send_header("Vary", "Accept-Encoding")
        if ext in LONG_CACHE_EXTS:
            # Long-lived cache for big static binaries. Refresh by renaming the
            # file or appending a query string in your HTML if you change them.
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            # Code/HTML: short cache so edits show up after a reload.
            self.send_header("Cache-Control", "public, max-age=60")
        # Permissive CORS so loading from a different origin (e.g. a tunnel) works.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        if self.command != "HEAD":
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionAbortedError):
                pass

    do_HEAD = do_GET

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        # SimpleHTTPRequestHandler doesn't know about these binaries.
        custom = {
            ".splat":  "application/octet-stream",
            ".ply":    "application/octet-stream",
            ".ksplat": "application/octet-stream",
            ".spz":    "application/octet-stream",
            ".js":     "application/javascript",
            ".mjs":    "application/javascript",
        }
        if ext in custom:
            return custom[ext]
        return super().guess_type(path)

    # Quieter logging — one line per request, no full datestamp soup.
    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.address_string(), fmt % args))


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with ThreadedServer(("", port), GzipHandler) as httpd:
        print(f"Serving {os.getcwd()} on http://localhost:{port}  (gzip + long-cache for binaries)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
