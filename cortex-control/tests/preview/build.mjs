// Local design-review build with demo data: node tests/preview/build.mjs
// Output: preview-dist/ (git-ignored). Production uses build.mjs only.
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const mock = fileURLToPath(new URL("./mock-supabase.js", import.meta.url));
await cp("public", "preview-dist", { recursive: true });
await build({
  entryPoints: ["app.js"], bundle: true, outfile: "preview-dist/app.js", target: "es2022",
  alias: { "@supabase/supabase-js": mock }
});
console.log("preview-dist ready");
