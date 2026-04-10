from http.server import HTTPServer, SimpleHTTPRequestHandler
import argparse


def build_handler(cross_origin_isolated: bool):
    class MirisHandler(SimpleHTTPRequestHandler):
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
