"""Validate Android release identity before building and after downloading GitHub assets."""

import argparse
from dataclasses import dataclass
import json
import pathlib
import re
import subprocess


VERSION = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-beta\.[1-9][0-9]*)?"


@dataclass(frozen=True)
class Release:
    version: str
    code: int

    @property
    def tag(self):
        return "v" + self.version

    @property
    def name(self):
        return f"CORTEX-{self.version}.apk"

    @property
    def prerelease(self):
        return "-beta." in self.version


def read_release(source):
    names = re.findall(r'^\s*versionName\s*=\s*"([^"\n]+)"\s*$', source, re.MULTILINE)
    codes = re.findall(r'^\s*versionCode\s*=\s*([0-9]+)\s*$', source, re.MULTILINE)
    if len(names) != 1 or not re.fullmatch(VERSION, names[0]) or len(codes) != 1:
        raise ValueError("Declare one valid Android versionName and versionCode in app/build.gradle.kts.")
    code = int(codes[0])
    if not 0 < code <= 2_100_000_000:
        raise ValueError("Android versionCode is outside its supported positive range.")
    return Release(names[0], code)


def git(root, *args, optional=False):
    result = subprocess.run(["git", "-C", str(root), *args], text=True, capture_output=True)
    if result.returncode:
        if optional:
            return None
        raise ValueError("Cannot resolve the release source or published tag. Fetch complete repository tags.")
    return result.stdout.strip()


def validate_publish(release, commit, root, published_tags=()):
    head = git(root, "rev-parse", "--verify", "--end-of-options", commit + "^{commit}")
    existing = git(root, "rev-parse", "--verify", "--quiet", f"refs/tags/{release.tag}^{{commit}}", optional=True)
    if existing is not None and existing != head:
        raise ValueError(f"{release.tag} already points to a different commit. Increment both Android versionName and versionCode.")
    for tag in published_tags:
        if not re.fullmatch("v" + VERSION, tag):
            continue
        previous = read_release(git(root, "show", f"refs/tags/{tag}:app/build.gradle.kts"))
        # Re-running exactly the same published commit is permitted; downgrades are not.
        if tag == release.tag and existing == head:
            continue
        if release.code <= previous.code:
            raise ValueError(f"versionCode {release.code} must exceed published {tag} (code {previous.code}).")


def verify_response(release, response, commit, tag_commit):
    if response.get("tag_name") != release.tag or response.get("draft") is not False:
        raise ValueError("GitHub did not return the requested published release.")
    if response.get("prerelease") is not release.prerelease:
        raise ValueError("GitHub release channel does not match the Android version.")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or tag_commit != commit:
        raise ValueError("The published tag does not resolve to the built commit.")
    for name in (release.name, "SHA256SUMS.txt"):
        assets = [asset for asset in response.get("assets", []) if asset.get("name") == name]
        if len(assets) != 1 or assets[0].get("state") != "uploaded" or assets[0].get("size", 0) <= 0:
            raise ValueError(f"GitHub did not confirm one complete {name} asset.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "verify"))
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path.cwd())
    parser.add_argument("--commit", default="HEAD")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--published-tags", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--response", type=pathlib.Path)
    parser.add_argument("--tag-commit")
    args = parser.parse_args()
    try:
        release = read_release((args.root / "app/build.gradle.kts").read_text())
        if args.command == "verify":
            if not args.response or not args.tag_commit:
                raise ValueError("Release response and resolved tag commit are required for verification.")
            verify_response(release, json.loads(args.response.read_text()), args.commit, args.tag_commit)
        else:
            if args.publish:
                tags = args.published_tags.read_text().splitlines() if args.published_tags else ()
                validate_publish(release, args.commit, args.root, tags)
            values = {"version": release.version, "code": str(release.code), "tag": release.tag,
                      "name": release.name, "prerelease": str(release.prerelease).lower()}
            if args.output:
                with args.output.open("a") as output:
                    output.writelines(f"{key}={value}\n" for key, value in values.items())
            print(json.dumps(values))
    except (OSError, ValueError) as error:
        parser.exit(1, f"::error::{error}\n")


if __name__ == "__main__":
    main()
