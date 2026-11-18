import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Confirmed by the owner against the historical production deployment
// dpl_3hRmFmcdnr2sSHGSyfgqwRsJhwto (2026-11-17). GitHub's current main
// is missing these features and must not replace that approved design.
const required = [
  "app/api/checkout/route.ts",
  "components/AmbientDotField.tsx",
  "components/PricingBuyButton.tsx",
  "components/PricingPanels.tsx",
  "components/SupportChat.tsx",
  "lib/bounded-json.ts",
  "lib/checkout-url.ts",
  "lib/support-media.ts",
];

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const missing = required.filter(path => !existsSync(resolve(projectRoot, path)));

if (missing.length) {
  console.error("CORTEX WEB RELEASE BLOCKED: the owner-approved site is absent from GitHub.");
  for (const file of missing) console.error(`  missing: cortex-web/${file}`);
  console.error("Restore the confirmed Vercel source, review it, then re-run this gate.");
  process.exitCode = 1;
} else {
  console.log("Approved CORTEX web feature files are present. Continue with visual and API verification.");
}
