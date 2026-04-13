from http.server import HTTPServer, SimpleHTTPRequestHandler
import argparse
import json
from pathlib import Path


def build_handler(cross_origin_isolated: bool):
    project_root = Path.cwd()
    annotations_path = project_root / "annotations-live.json"

    class MirisHandler(SimpleHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/api/annotations-live":
                self.send_error(404, "Not Found")
                return

            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length <= 0:
                self.send_error(400, "Empty body")
                return

            try:
                raw = self.rfile.read(content_length)
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                self.send_error(400, "Invalid JSON")
                return

            annotations = payload.get("annotations")
            if not isinstance(annotations, dict):
                self.send_error(400, "Missing annotations object")
                return

            try:
                output = json.dumps({"annotations": annotations}, indent=2) + "\n"
                annotations_path.write_text(output, encoding="utf-8")
            except Exception:
                self.send_error(500, "Unable to write annotations-live.json")
                return

            response = json.dumps({"ok": True, "path": str(annotations_path.name)}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            if cross_origin_isolated:
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
            super().end_headers()

    return MirisHandler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("port", nargs="?", default=8080, type=int)
    parser.add_argument(
        "--coi",
        action="store_true",
        help="Enable cross-origin isolation headers (COOP/COEP/CORP).",
    )
    args = parser.parse_args()

    handler_cls = build_handler(args.coi)
    server = HTTPServer(("127.0.0.1", args.port), handler_cls)
    mode = "COI enabled" if args.coi else "COI disabled (compatibility mode)"
    print(f"Serving on http://127.0.0.1:{args.port} [{mode}]")
    server.serve_forever()


if __name__ == "__main__":
    main()
