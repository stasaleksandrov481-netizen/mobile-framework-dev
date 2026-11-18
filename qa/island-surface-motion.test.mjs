import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const native = name => readFileSync(new URL(`../app/src/main/java/app/cortex/assistant/${name}`, import.meta.url), "utf8");
const web = name => readFileSync(new URL(`../app/src/main/assets/web/${name}`, import.meta.url), "utf8");

test("CORTEX compact island defaults to solid black and logo-only artwork", () => {
  const style = native("IslandAppearance.kt");
  const surface = native("LiquidIslandView.kt");
  const layout = native("IslandPlacement.kt");
  assert.match(style, /color\("background", "#000000"\)/);
  assert.match(style, /number\("opacity", 100\.0/);
  assert.match(layout, /val width = minOf\(72 \* density/);
  assert.match(surface, /signal\.mark\(canvas, logoX, cy/);
  assert.doesNotMatch(surface, /LinearGradient|drawFace\(|canvas\.drawText\("CORTEX"/);
  assert.match(surface, /postInvalidateDelayed\(if \(isActivePhase\(\)\)/);
});

test("island customization controls rendering and first-step feedback", () => {
  const surface = native("LiquidIslandView.kt");
  assert.match(surface, /if \(style\.face\) drawCompactFace/);
  assert.match(surface, /style\.status && phase == "executing"/);
  assert.match(surface, /canvas\.drawText\("Выполняю"/);
  assert.match(surface, /if \(style\.progress && compactAlpha/);
  const engine = native("CortexActionEngine.kt");
  assert.match(engine, /report\("Выполняю…"\)\s+delay\(1_000L\)/);
  assert.match(engine, /direct != null && reply == null -> \{\s*firstStep\(::report\)\s*executeSystem/);
  assert.match(engine, /!visualAllowed ->/);
  assert.match(native("CortexPhoneActions.kt"), /attempts = 6, interval = 105L/);
});

test("Android Assistant invocation opens the island without loading MainActivity or waking the microphone", () => {
  const manifest = readFileSync(new URL("../app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  assert.match(manifest, /android:name="\.CortexAssistActivity"[\s\S]*?android.intent.action.ASSIST/);
  const activity = native("CortexAssistActivity.kt");
  assert.match(activity, /intent\.action != Intent\.ACTION_ASSIST \|\| !selected\(this\)/);
  assert.match(activity, /Settings\.canDrawOverlays\(this\)/);
  assert.match(activity, /startForegroundService[\s\S]+ACTION_SYSTEM_ASSIST/);
  assert.doesNotMatch(activity, /MainActivity|ACTION_WAKE|intent\.extras|VoiceInteractionService/);
  const service = native("CortexIslandService.kt");
  assert.match(service, /if \(systemRequested\)[\s\S]*?openFromSystem\(\)/);
  assert.match(service, /systemInvocation = true[\s\S]*?setExpanded\(true\)/);
  assert.match(service, /ACTION_SCREEN_OFF && systemInvocation/);
  assert.match(service, /if \(systemInvocation && !busy && !actionBusy\)[\s\S]*?dismissIsland\(power = true\)/);
});

test("window placement is observed before morphs and pending transitions are cancelable", () => {
  const service = native("CortexIslandService.kt");
  const surface = native("LiquidIslandView.kt");
  assert.match(service, /view\.cancelPlacementWait\(\)/);
  assert.match(service, /view\.whenWindowReady\(targetWindow\)/);
  assert.match(service, /generation == layoutGeneration/);
  assert.match(surface, /OnPreDrawListener/);
  assert.match(surface, /width != expected\.width\(\) \|\| height != expected\.height\(\)/);
  assert.match(surface, /pendingPlacementTimeout/);
  assert.match(service, /if \(open\) settle\(\) else view\.postOnAnimation/);
});

test("the shrinking overlay stays centred instead of snapping to a left-gravity anchor", () => {
  const service = native("CortexIslandService.kt");
  assert.match(service, /gravity = Gravity\.TOP or Gravity\.CENTER_HORIZONTAL/);
  assert.match(service, /box\.exactCenterX\(\) - geometry\.screen\.bounds\.exactCenterX\(\)/);
  assert.doesNotMatch(service, /val x = box\.left - geometry\.screen\.bounds\.left/);
  // For a symmetric expand/collapse, the requested overlay centre never moves
  // even when its width changes from a full panel to the compact pill.
  const displayCenter = 540;
  const frames = [{ left: 280, right: 800 }, { left: 485, right: 595 }];
  assert.deepEqual(frames.map(frame => (frame.left + frame.right) / 2 - displayCenter), [0, 0]);
});

test("island Markdown uses safe native text spans without remote HTML", () => {
  const markdown = native("IslandMarkdown.kt");
  const panel = native("IslandConversationPanel.kt");
  for (const supported of ["StyleSpan", "TypefaceSpan", "URLSpan", "StrikethroughSpan", "tableSeparator", "codeBlock"]) {
    assert.match(markdown, new RegExp(supported));
  }
  assert.match(panel, /response\.text = IslandMarkdown\.render\(value, appearance\.accent\)/);
  assert.doesNotMatch(markdown, /WebView\(|loadUrl\(|Html\.fromHtml\(|HttpURLConnection\(/);
  assert.doesNotMatch(panel, /GradientDrawable\.Orientation\.TL_BR/);
});

test("Android and web island presets agree on true black", () => {
  const sandbox = vm.createContext({});
  vm.runInContext(web("island-command.js"), sandbox);
  const commands = vm.runInContext("CortexIslandCommands", sandbox);
  assert.equal(commands.defaults.background, "#000000");
  assert.equal(commands.defaults.opacity, 100);
  assert.equal(commands.parse("Сделай островок чёрным").style.background, "#000000");
  assert.match(web("planner.js"), /background: "#000000", text: "#ffffff"/);
});
