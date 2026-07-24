#!/usr/bin/env python3
"""Static preview server with caching disabled for Bridge Play sandboxes."""

import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Serve workspace files without letting browsers reuse stale assets."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    http.server.ThreadingHTTPServer(
        ("0.0.0.0", port),
        NoCacheHandler,
    ).serve_forever()
