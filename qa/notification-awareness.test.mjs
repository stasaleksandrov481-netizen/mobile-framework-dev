import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Android explicitly requests notification-listener access", () => {
  const manifest = source("app/src/main/AndroidManifest.xml");
  const bridge = source("app/src/main/java/app/cortex/assistant/CortexDeviceBridge.kt");
  assert.match(manifest, /CortexNotificationListener/);
  assert.match(manifest, /BIND_NOTIFICATION_LISTENER_SERVICE/);
  assert.match(bridge, /ACTION_NOTIFICATION_LISTENER_SETTINGS/);
  assert.match(bridge, /notificationAccess.*CortexNotificationJournal\.accessGranted/);
});

test("notification events are handled before cloud AI and respect lockscreen privacy", () => {
  const engine = source("app/src/main/java/app/cortex/assistant/CortexActionEngine.kt");
  const journal = source("app/src/main/java/app/cortex/assistant/CortexNotificationJournal.kt");
  assert.ok(engine.indexOf("CortexNotificationJournal(context).answer(text)") < engine.indexOf("val network = NetworkRequest.parse(text)"));
  assert.match(journal, /isDeviceLocked/);
  assert.match(journal, /AndroidKeyStore/);
  assert.match(journal, /Notification\.EXTRA_TITLE/);
  assert.match(journal, /\.put\("app", notification\.packageName/);
  assert.doesNotMatch(journal.slice(journal.indexOf("fun record("), journal.indexOf("fun clear(")), /EXTRA_TEXT|EXTRA_TITLE|EXTRA_BIG_TEXT/);
});

test("users can revoke access or erase stored metadata from settings", () => {
  const screens = source("app/src/main/assets/web/screens.js");
  const app = source("app/src/main/assets/web/app.js");
  const bridge = source("app/src/main/java/app/cortex/assistant/CortexDeviceBridge.kt");
  assert.match(screens, /Чтение уведомлений/);
  assert.match(screens, /Очистить журнал уведомлений/);
  assert.match(app, /"notification-journal-clear"/);
  assert.match(app, /sendDevice\("private-data-clear"\)/);
  assert.match(bridge, /CortexPrivateMemory\(context\)\.wipeDevice\(\)/);
});
