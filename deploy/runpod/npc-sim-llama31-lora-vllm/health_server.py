import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import urlopen


PORT = int(os.environ.get("PORT_HEALTH", "8080"))
VLLM_HEALTH_URL = os.environ.get(
    "VLLM_HEALTH_URL",
    f"http://127.0.0.1:{os.environ.get('PORT', '8000')}/health",
)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in {"/ping", "/health"}:
            self.send_response(404)
            self.end_headers()
            return

        if is_vllm_ready():
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ready")
            return

        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        return


def is_vllm_ready():
    try:
        with urlopen(VLLM_HEALTH_URL, timeout=2) as response:
            return 200 <= response.status < 300
    except (OSError, URLError):
        return False


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), HealthHandler)
    print(f"Runpod health server listening on {PORT}, probing {VLLM_HEALTH_URL}", flush=True)
    server.serve_forever()
