#!/usr/bin/env node
/** Start the production server and probe in one process namespace, then clean up. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const port = 3100;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [resolve(root, "cortex-web/node_modules/next/dist/bin/next"),
  "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: resolve(root, "cortex-web"),
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => { serverLog = (serverLog + chunk.toString()).slice(-3000); });
}

try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited early: ${serverLog}`);
    try {
      const response = await fetch(`${base}/api/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* Server still starting. */ }
    await pause(100);
  }
  if (!ready) throw new Error(`Server did not start: ${serverLog}`);

  const probe = spawn(process.execPath, [resolve(root, "qa/load-cortex.mjs"), base], {
    cwd: root,
    stdio: "inherit",
  });
  const [code] = await once(probe, "exit");
  process.exitCode = code === 0 ? 0 : 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), pause(3000)]);
}
