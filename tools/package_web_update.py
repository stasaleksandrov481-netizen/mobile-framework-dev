#!/usr/bin/env python3
"""Package a signed WebView update. Private key never leaves the operator's machine."""

import argparse
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets/web"
REQUIRED = {
    "index.html", "app.js", "model.js", "gateway.js", "setup.js", "screens.js",
    "icons.js", "style.css", "planner.js", "planner.css", "cortex-control-client.js",
    "cortex-control.css", "subscription.js", "subscription.css", "transitions.js", "markdown.js",
}
SUFFIXES = {"html", "js", "css", "svg", "png", "webp", "jpg", "jpeg", "woff", "woff2", "ttf", "json", "txt"}


def package(version: int, min_native: int, private_key: pathlib.Path, output: pathlib.Path) -> None:
    if not 0 < version < 10_000_000_000_000 or not 1 <= min_native < 1_000_000:
        raise ValueError("Invalid version")
    if not private_key.is_file():
        raise ValueError("Signing key does not exist")

    files = sorted(path for path in ASSETS.rglob("*") if path.is_file())
    if len(files) > 80:
        raise ValueError("Too many WebView assets")
    names = {path.relative_to(ASSETS).as_posix() for path in files}
    if not REQUIRED.issubset(names):
        raise ValueError(f"Missing critical assets: {REQUIRED - names}")
    total = 0
    for path in files:
        name = path.relative_to(ASSETS).as_posix()
        if (path.is_symlink() or len(name) > 150 or not re.fullmatch(r"[A-Za-z0-9_./-]+", name)
                or any(part in ("", ".", "..") for part in name.split("/"))
                or name.rsplit(".", 1)[-1] not in SUFFIXES):
            raise ValueError(f"Unsafe asset path: {name}")
        total += path.stat().st_size
    if total > 8_000_000:
        raise ValueError("Bundle exceeds unpacked limit")

    output.mkdir(parents=True, exist_ok=True)
    name = f"web-v{version}.zip"
    archive = output / name
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(ASSETS).as_posix(), (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            bundle.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    archive_bytes = archive.read_bytes()
    if len(archive_bytes) > 6_000_000:
        raise ValueError("Bundle exceeds download limit")
    manifest = json.dumps({
        "schema": 1,
        "version": version,
        "min_native": min_native,
        "archive": name,
        "sha256": hashlib.sha256(archive_bytes).hexdigest(),
        "size": len(archive_bytes),
    }, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signed = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(private_key)],
                            input=manifest, capture_output=True, check=True).stdout
    (output / "manifest.json").write_bytes(manifest)
    (output / "manifest.sig").write_text(base64.b64encode(signed).decode("ascii") + "\n", encoding="ascii")
    print(f"Signed WebView bundle v{version}: {len(files)} files, {len(archive_bytes)} bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", type=int, required=True, help="Monotonic WebView version")
    parser.add_argument("--min-native", type=int, required=True, help="Minimum app versionCode")
    parser.add_argument("--private-key", type=pathlib.Path, required=True, help="PEM RSA signing key")
    parser.add_argument("--output", type=pathlib.Path, required=True, help="Host these files via HTTPS")
    args = parser.parse_args()
    package(args.version, args.min_native, args.private_key, args.output)


if __name__ == "__main__":
    main()
