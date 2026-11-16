import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Android 8+ feature detection avoids assumptions about phone manufacturers", () => {
  const build = source("app/build.gradle.kts");
  const compat = source("app/src/main/java/app/cortex/assistant/CortexAndroidCompatibility.kt");
  assert.match(build, /minSdk = 26/);
  for (const hardware of ["FEATURE_CAMERA_ANY", "FEATURE_CAMERA_FLASH", "FEATURE_WIFI",
    "FEATURE_BLUETOOTH", "FEATURE_NFC", "FEATURE_TELEPHONY"]) {
    assert.ok(compat.includes(hardware), `${hardware} must be detected at runtime`);
  }
  assert.match(compat, /Build\.VERSION\.SDK_INT >= 31/);
  assert.match(compat, /isOnDeviceRecognitionAvailable\(context\)/);
  assert.match(compat, /runCatching \{ SpeechRecognizer\.isRecognitionAvailable\(context\) \}/);
  assert.match(source("app/src/main/java/app/cortex/assistant/CortexDeviceBridge.kt"), /CortexAndroidCompatibility\.report\(context\)/);
});

test("missing manufacturer-specific settings screens fall back to generic Android settings", () => {
  const phone = source("app/src/main/java/app/cortex/assistant/CortexPhoneActions.kt");
  assert.match(phone, /\(candidates\.toList\(\) \+ Settings\.ACTION_SETTINGS\)\.distinct\(\)/);
  assert.match(phone, /for \(\(index, action\) in actions\.withIndex\(\)\)/);
  assert.match(phone, /openSettings\(true, action, alternative, Settings\.ACTION_WIRELESS_SETTINGS\)/);
  assert.match(phone, /"fallback", index != 0/);
  assert.match(phone, /generic market intent also works with non-Google app stores/);
  assert.match(phone, /launch\(intent\) \|\| \(app != null && launch\(Intent\(action\)\)\)/);
});

test("an obsolete WebView shows a recoverable screen instead of a nonfunctional app", () => {
  const main = source("app/src/main/java/app/cortex/assistant/MainActivity.kt");
  assert.match(main, /if \(!WebViewFeature\.isFeatureSupported\(WebViewFeature\.WEB_MESSAGE_LISTENER\)\)/);
  assert.match(main, /showRendererError\("Системный WebView слишком старый/);
  assert.match(main, /WebView\.getCurrentWebViewPackage\(\)/);
  assert.match(main, /if \(!rendererFailed && ::island\.isInitialized\)/);
  assert.doesNotMatch(main, /addJavascriptInterface/);
});

test("capability diagnostics are escaped and do not promise unsupported hardware", () => {
  const ui = runInNewContext(source("app/src/main/assets/web/screens.js") + "\nCortexUI;", {
    Cortex: {}, CortexIcons: () => "<svg></svg>", CortexSubscription: {}
  });
  const html = ui.page("permissions", {
    permissions: {},
    compatibility: { manufacturer: "<script>alert(1)</script>", model: "Test", sdk: 35,
      speech: true, offlineWake: false, camera: true, flashlight: false, wifi: true,
      bluetooth: true, nfc: false, telephony: true }
  });
  assert.match(html, /Совместимость с этим телефоном/);
  assert.match(html, /Фоновый вызов по имени/);
  assert.match(html, /Нет системной поддержки или компонента/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});
