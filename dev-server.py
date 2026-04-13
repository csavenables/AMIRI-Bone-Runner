from http.server import HTTPServer, SimpleHTTPRequestHandler
import argparse
import json
from pathlib import Path
import subprocess
from urllib.parse import urlparse


def build_handler(cross_origin_isolated: bool):
    project_root = Path.cwd()
    annotations_path = project_root / "annotations-live.json"

    class MirisHandler(SimpleHTTPRequestHandler):
        def write_json(self, status_code: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def get_repo_status(self) -> dict:
            status = {
                "available": False,
                "annotationsDirty": None,
                "annotationsTracked": None,
                "branch": None,
                "head": None,
            }
            try:
                branch = subprocess.run(
                    ["git", "branch", "--show-current"],
                    cwd=project_root,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                head = subprocess.run(
                    ["git", "rev-parse", "--short", "HEAD"],
                    cwd=project_root,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                tracked = subprocess.run(
                    ["git", "ls-files", "--error-unmatch", "annotations-live.json"],
                    cwd=project_root,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                dirty = subprocess.run(
                    ["git", "status", "--porcelain", "--", "annotations-live.json"],
                    cwd=project_root,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                status.update(
                    {
                        "available": branch.returncode == 0,
                        "branch": branch.stdout.strip() or None,
                        "head": head.stdout.strip() or None,
                        "annotationsTracked": tracked.returncode == 0,
                        "annotationsDirty": bool((dirty.stdout or "").strip()),
                    }
                )
            except Exception:
                return status
            return status

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path != "/api/repo-status":
                return super().do_GET()

            self.write_json(200, {"ok": True, **self.get_repo_status()})

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path != "/api/annotations-live":
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

            self.write_json(
                200,
                {
                    "ok": True,
                    "path": str(annotations_path.name),
                    **self.get_repo_status(),
                },
            )

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
