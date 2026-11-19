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

## Real calculator

`FirstExperienceCalculator` resolves an installed native calculator, uses the existing
verified launcher navigation with an 18-second budget and awaits its keypad. Each
button comes from a fresh accessibility tree and is pressed by the shared gesture
executor. No guessed coordinates or AI planning are used.

Recognized package candidates include Samsung, Google/AOSP, Xiaomi, Huawei/HONOR,
OPPO/OnePlus and ASUS. This is a candidate list, **not a claim of physical device
compatibility**. Exact recognized keypad identities and display IDs are required;
unknown interfaces, ambiguous controls or unverified results stop/skip the step.
Editable calculator display text is read locally without changing the general
visual frame's editable-text redaction or cloud model payload.

The example verifies 588 on the actual display. Prediction performs four separately
visible calculations for integers 1–99. Each equality result must be confirmed before
the next operation. The five card is only revealed after all four confirmations.

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
  verification, provider failures and invalid snapshots.
- `node --test qa/first-experience.test.mjs`: native-only UI progression, input limits,
  duplicate requests/snapshots, setup gating, stop, skip, focus/inert cleanup and escaping.
- `cd qa/browser && npm ci && npx playwright install chromium && npm test`: renders the
  actual WebView assets at four sizes and captures six pages per size. The bridge is a
  **test fixture**; screenshots do not prove Android device actions work.
- New GitHub UI workflow saves those screenshots. Existing Android workflow includes
  the feature's Node tests and all Android unit tests; security workflow remains enabled.
- Before public APK release: physically test Samsung A23 plus at least one Xiaomi and
  HONOR device; verify calculator controls/results, full Quick Settings visibility,
  auto/manual brightness, Stop during every stage, screen lock, accessibility/overlay
  revocation, activity recreation and killed-session recovery. Do not advertise an OEM
  as supported solely because its package is listed.

This branch does not change server code, database state, production website, signing,
version number, release tag or published APK. Keep the previous signed APK as rollback.
