import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PORT = int(os.environ.get("PORT", "8000"))
STATUS_PATH = Path(os.environ.get("PREFILL_STATUS_PATH", "/tmp/npc-sim-prefill-status.json"))


def read_status():
    if not STATUS_PATH.exists():
        return {"status": "initializing"}
    try:
        return json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"status": "initializing"}


class PrefillStatusHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in {"/", "/ping", "/health"}:
            self.send_response(404)
            self.end_headers()
            return

        payload = read_status()
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200 if payload.get("status") == "ok" else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), PrefillStatusHandler)
    print(f"Prefill status server listening on {PORT}", flush=True)
    server.serve_forever()
