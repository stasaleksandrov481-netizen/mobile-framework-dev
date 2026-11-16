import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kotlin = name => readFileSync(new URL(`../app/src/main/java/app/cortex/assistant/${name}.kt`, import.meta.url), "utf8");

test("reminders do not report success if Android rejects the alarm", () => {
  const schedule = kotlin("CortexSchedule");
  assert.match(schedule, /private fun alarm\(context: Context, task: Task\): Boolean/);
  assert.match(schedule, /runCatching \{ manager\.setExactAndAllowWhileIdle\(/);
  assert.match(schedule, /runCatching \{ manager\.setAndAllowWhileIdle\(/);
  assert.match(schedule, /if \(!alarm\(context, task\)\) \{/);
  assert.match(schedule, /if \(old == null\) write\(context, all\(context\)\.filterNot \{ it\.id == task\.id \}\)/);
  assert.match(schedule, /else if \(!alarm\(context, it\)\) block\(context, it/);
  assert.match(schedule, /if \(!alarm\(context, it\)\) block\(context, it/);
});

test("snooze retains the previous reminder if rescheduling fails", () => {
  const handle = kotlin("CortexSchedule").split("fun handle(context:")[1].split("private fun run(context:")[0];
  const setAlarm = handle.indexOf('updated.status == "scheduled" && !alarm(context, updated)');
  const cancelNotification = handle.indexOf("NotificationManager::class.java).cancel(id, NOTIFICATION)");
  assert.ok(setAlarm >= 0 && cancelNotification > setAlarm);
  assert.match(handle, /replace\(context, task\)/);
});

test("foreground islands and support jobs stop cleanly if an OEM denies them", () => {
  const island = kotlin("CortexIslandService");
  const support = kotlin("CortexSupportNotification");
  const bridge = kotlin("CortexIslandBridge");
  const wake = kotlin("CortexWakeService");
  assert.match(island, /if \(!foregroundStarted\) \{\s*stopSelf\(\)\s*return/);
  assert.match(island, /if \(notification == null\) \{\s*stopSelf\(\)\s*return/);
  assert.match(wake, /if \(notification == null\) \{[\s\S]*?stopSelf\(\)\s*return/);
  assert.match(support, /result != JobScheduler\.RESULT_SUCCESS/);
  assert.match(support, /onFailure \{ android\.util\.Log\.w\(/);
  assert.match(bridge, /status\("overlay-mode", false, "Android ограничил запуск островка/);
  assert.match(island, /CortexRuntime\.reportWake\("Android ограничил запуск островка в фоне/);
});
