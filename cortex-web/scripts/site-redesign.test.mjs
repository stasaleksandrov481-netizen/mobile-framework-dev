import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = path => readFileSync(join(root, path), "utf8");

function sources(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? sources(rel) : /\.(tsx|ts)$/.test(name) ? [rel] : [];
  });
}

test("APK download is closed in code: no link, env switch or launch timer", () => {
  const cta = read("components/DownloadCTA.tsx");
  assert.doesNotMatch(cta, /href=|process\.env|setTimeout|reload\(/);
  assert.match(cta, /Скачивание закрыто/);
  const home = read("app/page.tsx");
  assert.match(home, /<DownloadCTA \/>/);
  assert.doesNotMatch(home, /ANDROID_DOWNLOAD_URL|PUBLIC_DOWNLOAD_ENABLED|\.apk/);
});

test("No user-facing page promises the withdrawn 20 November launch date", () => {
  for (const file of [...sources("app"), ...sources("components")]) {
    if (file.includes("api")) continue; // server-only release guards may keep historical dates
    assert.doesNotMatch(read(file), /20 ноябр|2026-11-20/i, file);
  }
});

test("Liquid glass has solid fallbacks for browsers and accessibility settings", () => {
  const css = read("app/globals.css");
  assert.match(css, /@supports \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /-webkit-backdrop-filter: blur\(18px\)/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  const forms = read("app/pages.css");
  assert.match(forms, /font-size: 16px; \/\* 16px stops iOS Safari/);
});

test("External links opened in a new tab never expose window.opener", () => {
  for (const file of [...sources("app"), ...sources("components")]) {
    const text = read(file);
    for (const match of text.matchAll(/<a[^>]*target="_blank"[^>]*>/g)) {
      assert.match(match[0], /rel="noopener noreferrer"/, file);
    }
  }
});
