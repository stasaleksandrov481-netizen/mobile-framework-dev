#!/usr/bin/env node
/**
 * Reproducible, non-destructive loopback load probe for CORTEX's public routes.
 * It deliberately refuses remote hosts, paid AI endpoints and arbitrary paths.
 * Usage: node qa/load-cortex.mjs http://127.0.0.1:3100
 */
import { performance } from "node:perf_hooks";

const base = new URL(process.argv[2] || "http://127.0.0.1:3100");
if (!(["127.0.0.1", "localhost", "::1"].includes(base.hostname) &&
    ["http:", "https:"].includes(base.protocol) && base.pathname === "/" &&
    !base.username && !base.password && !base.search && !base.hash)) {
  throw new Error("Load simulation is restricted to local CORTEX instances.");
}

const scenarios = [
  { path: "/api/healthz", total: 250, concurrent: 10 },
  { path: "/api/healthz", total: 500, concurrent: 50 },
  { path: "/api/healthz", total: 1000, concurrent: 100 },
  { path: "/api/status", total: 250, concurrent: 10 },
  { path: "/api/status", total: 500, concurrent: 50 },
  { path: "/api/status", total: 1000, concurrent: 100 },
];

const percentile = (samples, part) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * part) - 1)];

async function run({ path, total, concurrent }) {
  const durations = [];
  const statuses = new Map();
  let index = 0;
  const begin = performance.now();
  async function worker() {
    while (index < total) {
      index++;
      const start = performance.now();
      let status;
      try {
        const response = await fetch(new URL(path, base), {
          signal: AbortSignal.timeout(5000), cache: "no-store",
        });
        await response.arrayBuffer();
        status = String(response.status);
      } catch (error) {
        status = error?.name === "TimeoutError" ? "timeout" : "network_error";
      }
      durations.push(performance.now() - start);
      statuses.set(status, (statuses.get(status) || 0) + 1);
    }
  }
  await Promise.all(Array.from({ length: concurrent }, () => worker()));
  const elapsed = performance.now() - begin;
  durations.sort((a, b) => a - b);
  const result = {
    path, requests: total, concurrent, rps: +(total * 1000 / elapsed).toFixed(1),
    p50ms: +percentile(durations, 0.5).toFixed(1),
    p95ms: +percentile(durations, 0.95).toFixed(1),
    p99ms: +percentile(durations, 0.99).toFixed(1),
    statuses: Object.fromEntries(statuses),
  };
  console.log(JSON.stringify(result));
  if (statuses.get("200") !== total) process.exitCode = 1;
}

for (const scenario of scenarios) await run(scenario);
