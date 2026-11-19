# CORTEX FIRST EXPERIENCE

Android-only, local first-run demonstration. No language model, OpenRouter request,
speech synthesis or simulated calculator is used by the feature.

## Entry and ownership

- Completing all initial setup pages marks the native first-experience setup flag.
  Closing setup early or opening an individual permission page does not mark it.
- The offer appears after setup when Accessibility, the existing island overlay,
  orientation and screen state permit it. Microphone and cloud screen consent are
  not required for this local demonstration.
- Show consumes the offer durably before starting; Later consumes it without running.
  Neither completion nor process restart automatically repeats a consumed offer.
- Settings → «Повторить знакомство с CORTEX» opens it explicitly.
- `CortexFirstExperience` owns one process session and the shared `CortexActionState`
  task lease. Activity recreation only reconnects presentation; it cannot restart
  the action script. Native state, not JavaScript timers, advances each stage.
- The existing `CortexIslandService` temporarily displays a wider monochrome capsule
  with live statuses and its existing Stop control, including when the saved mode
  is off. Saved island appearance, mode and placement preferences are preserved.
  Wake recognition pauses during the session and resumes using the previous settings.

## Service startup ordering (beta.4)

The controller waits for the current session ID to be acknowledged by the island's
onStartCommand before accepting an attached, fully visible Stop control. A view
created by report() before the queued intent is handled is not a startup acknowledgement.
After startup, cosmetic opacity is not a permission or service-health signal. Ordinary
saved-mode off synchronization is deferred until the demo lease ends. Real loss causes
remain immediate cancellations and are reported separately; brightness cleanup is unchanged.

## Real calculator

`FirstExperienceCalculator` resolves the installed native calculator, confirms the
real Home screen, holds it for two seconds, launches that exact installed package,
awaits its keypad and holds for another two seconds before acting. This fixed local
launch script replaces the launcher-search race. Buttons come from fresh accessibility
trees and are pressed by the shared gesture executor. No guessed coordinates or AI
planning are used.

Keypad identity and enabled state are separate: Samsung/OEM calculators may disable
equals or clear after C without ceasing to be recognized. Only the requested key must
be enabled. An empty editable formula is not replaced by its accessibility help text;
its clear acknowledgement takes precedence over an old live-preview result. A formula
serialization is not an OEM-independent protocol: digits/operators use the actual
identity-checked gesture acknowledgement and bounded context checks. No blind retries.
Only the requested fresh key must remain enabled after initial full-keypad recognition.
Every equality must independently show the expected real integer; preview/history/keypad
values cannot confirm it. Read-only values refresh without requiring an unchanged label
or an enabled TextView, while action-target validation remains strict. Final fields take
precedence over primary values; localized descriptions are anchored whole-number results.
Failures report the key/result that could not be confirmed without exporting screen text.
Keys are spaced by 650 ms;
each calculation has a two-second preparation and a 2.2-second result hold.

Recognized package candidates include Samsung, Google/AOSP, Xiaomi, Huawei/HONOR,
OPPO/OnePlus and ASUS. This is a candidate list, **not a claim of physical device
compatibility**. Exact recognized keypad identities and display IDs are required;
unknown interfaces, ambiguous controls or unverified results stop/skip the step.
Editable calculator display text is read locally without changing the general
visual frame's editable-text redaction or cloud model payload.

The example verifies 588 on the actual display. Prediction performs four separately
visible calculations for integers 1–99. Each equality result must be confirmed before
the next operation. The number prompt is independent of first-example success:
prediction gets a fresh launch/clear. The sealed card remains visible for 2.4 seconds;
the five card is only revealed after all four real confirmations.

Each subsequent calculation clears and explicitly re-enters the previous VERIFIED result
before its operator. Thus the visible sequence is 17×2=34, C→34+10=44, C→44÷2=22,
C→22−17=5 even if the OEM discards its editing state after equality. This is actual UI input.

If accessible result text is absent, the existing bundled local OCR engine reads only a
recognized primary/final display rectangle that does not intersect any keypad control.
Two separate confident captures must agree after the real = gesture. Captures are recycled,
not exported or sent to a model. Unknown/secure displays still skip safely.

## Brightness transaction

- The optional WRITE_SETTINGS special access is requested only by a user pressing
  its settings link. Missing access skips this trick; no system prompt is auto-opened.
- The real Quick Settings panel must expose one uniquely identified brightness
  SeekBar/Slider with live range metadata and ACTION_SET_PROGRESS. Other controls,
  unknown OEM panels and sliders without the action are not touched.
- Original raw brightness, automatic/manual mode and adaptive-brightness adjustment
  are committed to a local recovery journal **before any setting change**.
- Automatic mode is temporarily made manual to avoid changing the user's adaptive
  brightness bias. Slider movement uses its observed OEM range, with target fraction
  35–85%, and a confirmed visible change. Returning to the initial slider position is
  followed by exact system-setting restoration and readback.
- After opening the panel, wait two seconds. Movement takes 2.2 seconds each way in
  60 eased, cancellable ACTION_SET_PROGRESS steps with visible holds. A bounded live
  node handle refreshes and validates the exact slider identity/range/bounds/window
  without traversing the whole UI tree on every tick. It is closed before cleanup.
  Reduce Motion uses one change; missing or changed controls still skip and restore.
- Cancellation, lock, permission loss, timeout and service disappearance run bounded
  `NonCancellable` cleanup. The shared task lease stays held through cleanup.
  Original mode restoration is attempted even if an earlier provider write throws.
- Pending recovery is retried at app/service startup and from the existing system
  receiver. Failed recovery retains the journal and presents recovery/settings controls.
  A killed process cannot execute a finally block; its next component start retries
  the journal. Immediate recovery after force-stop/power loss cannot be guaranteed.
  If the user revokes WRITE_SETTINGS during the trick, Android may require them to
  grant it again or restore brightness themselves; this must not be reported as success.

## Checks and release boundary

- JVM tests: all 99 arithmetic scripts, exact selectors, ambiguous controls, display
  parsing, safe target ranges, stop-on-failure/cancellation, restoration order and
  verification, provider failures and invalid snapshots. Additional regressions cover
  disabled post-clear keys, blank formula with stale preview, actual per-key acknowledgements,
  pacing, retry after a failed example, all 99 complete paced predictions and ramp cancellation.
- `node --test qa/first-experience.test.mjs`: native-only UI progression, input limits,
  duplicate requests/snapshots, setup gating, stop, skip, focus/inert cleanup and escaping.
- `cd qa/browser && npm ci && npx playwright install chromium && npm test`: renders the
  actual WebView assets at four sizes and captures six pages per size. The bridge is a
  **test fixture**; screenshots do not prove Android device actions work.
- New GitHub UI workflow saves those screenshots. Existing Android workflow includes
  the feature's Node tests and all Android unit tests; security workflow remains enabled.
- `CORTEX Android Device Regression` additionally builds a separate `qa-calculator` APK
  and drives real Android windows through the production AccessibilityService/gesture
  adapters on API34. Eight tests cover disabled/changing/description-only/opaque displays,
  delayed equality, false preview, blocked keys, cancellation and real brightness recovery.
  The fixture APK is never included in the production APK or installed as a fallback.
  This exercises native integration, not Samsung firmware or measured device FPS.
- Before declaring OEM compatibility: physically test Samsung A23 plus at least one Xiaomi and
  HONOR device; verify calculator controls/results, full Quick Settings visibility,
  auto/manual brightness, Stop during every stage, screen lock, accessibility/overlay
  revocation, activity recreation and killed-session recovery. Do not advertise an OEM
  as supported solely because its package is listed.

## Island frame pacing (beta.5)

Active border animation follows postInvalidateOnAnimation rather than the old 48 ms
timer (an approximately 20 Hz cap before display scheduling). Its outline measurement
and fitted demo status text are cached until geometry/text changes. No new island,
blur, extra effect or design change is introduced. Actual FPS must still be measured
on the user's device; a frame-clock change alone is not a hardware FPS guarantee.

The beta.7 / code124 audit does not deploy server code, database or production website.
Keep prior APKs as immutable source references; beta.6 still has a real-device report of
failed confirmation after multiplication. Native fixture testing remains distinct from
physical Samsung validation. Do not publish the beta.7 candidate before its device workflow passes.
