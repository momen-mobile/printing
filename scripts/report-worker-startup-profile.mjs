#!/usr/bin/env node
/**
 * Print a concise, SAFE summary of a Cloudflare Worker startup CPU profile.
 *
 * Searches: .wrangler/tmp/startup-profile-<id>/worker.cpuprofile
 * Parses a Chrome DevTools CPU profile (.cpuprofile JSON) and prints the top
 * functions by SELF sampled CPU time, derived from `samples` + `timeDeltas`.
 *
 * Prints ONLY: function name, source URL/module, self CPU time, total sampled
 * CPU time. It NEVER prints environment variables, secrets, source code, or any
 * unrelated file contents. Missing/malformed profile => clear message, exit 0.
 *
 * Dependency-free Node.js. Reads only the profile file. Cannot fail the
 * deployment itself; callers preserve the original deployment exit code.
 */
import fs from "node:fs";
import path from "node:path";

const TOP_N = 30;
const TMP_ROOT = path.join(process.cwd(), ".wrangler", "tmp");
const DIR_PREFIX = "startup-profile-";
const PROFILE_FILENAME = "worker.cpuprofile";

function findProfiles(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(DIR_PREFIX)) continue;
    const candidate = path.join(root, entry.name, PROFILE_FILENAME);
    try {
      if (fs.statSync(candidate).isFile()) found.push(candidate);
    } catch {
      /* ignore */
    }
  }
  found.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return found;
}

/** Safe module label. Never returns embedded source; strips query/fragment. */
function moduleLabel(url) {
  if (!url || typeof url !== "string") return "(no module)";
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const meta = (comma >= 0 ? url.slice(5, comma) : url.slice(5)).split(";")[0];
    return `data:${meta || "embedded"}:(embedded source hidden)`;
  }
  const noQuery = url.split(/[?#]/)[0];
  return noQuery || "(no module)";
}

function fnName(frame) {
  const name = frame && typeof frame.functionName === "string" ? frame.functionName : "";
  return name.trim() || "(anonymous)";
}

function fmtMs(us) {
  return (us / 1000).toFixed(3) + "ms";
}

function main() {
  const profiles = findProfiles(TMP_ROOT);
  if (profiles.length === 0) {
    console.log(
      "[startup-profile] No Cloudflare Worker startup CPU profile found at " +
        path.join(TMP_ROOT, DIR_PREFIX + "*", PROFILE_FILENAME) +
        ". Nothing to summarize; skipping."
    );
    return; // exit safely (0)
  }

  const profilePath = profiles[0];
  console.log("[startup-profile] Reading profile:", profilePath);

  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (err) {
    console.log(
      "[startup-profile] Could not parse profile JSON (" +
        (err && err.message ? err.message : "unknown error") +
        "). Skipping."
    );
    return; // exit safely (0)
  }

  const nodes = Array.isArray(profile.nodes) ? profile.nodes : [];
  const samples = Array.isArray(profile.samples) ? profile.samples : [];
  const timeDeltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [];

  const byId = new Map();
  for (const node of nodes) {
    if (node && typeof node.id === "number") byId.set(node.id, node);
  }

  // ---- self CPU time per node id (microseconds), from samples + timeDeltas ----
  const selfUs = new Map();
  let totalSampledUs = 0;
  const sampleCount = samples.length;
  for (let i = 0; i < sampleCount; i++) {
    const id = samples[i];
    const dt = Number(timeDeltas[i]) || 0; // microseconds
    totalSampledUs += dt;
    selfUs.set(id, (selfUs.get(id) || 0) + dt);
  }

  // ---- aggregate SELF time by function + module ----
  const keyOf = (id) => {
    const node = byId.get(id);
    const frame = (node && node.callFrame) || {};
    return fnName(frame) + "\u0000" + moduleLabel(frame.url);
  };

  const aggSelf = new Map();
  const aggMeta = new Map();

  // seed keys so aggregation is stable
  for (const node of nodes) {
    const key = keyOf(node.id);
    if (!aggMeta.has(key)) {
      const frame = node.callFrame || {};
      aggMeta.set(key, { fn: fnName(frame), module: moduleLabel(frame.url) });
    }
    if (!aggSelf.has(key)) aggSelf.set(key, 0);
  }
  for (const [id, us] of selfUs) {
    const key = keyOf(id);
    aggSelf.set(key, (aggSelf.get(key) || 0) + us);
  }

  // ---- rank by self CPU time; top 30 ----
  const rows = [...aggMeta.keys()]
    .map((key) => ({
      fn: aggMeta.get(key).fn,
      module: aggMeta.get(key).module,
      selfUs: aggSelf.get(key) || 0,
    }))
    .filter((r) => r.selfUs > 0)
    .sort((a, b) => b.selfUs - a.selfUs || a.fn.localeCompare(b.fn))
    .slice(0, TOP_N);

  // ---- output (no secrets / no source / no env / no unrelated files) ----
  console.log("[startup-profile] totalSampledCPU=" + fmtMs(totalSampledUs) +
    " samples=" + sampleCount + " nodes=" + nodes.length);
  console.log("[startup-profile] total sampled CPU time = " + fmtMs(totalSampledUs));
  console.log("[startup-profile] Top " + rows.length + " functions by self CPU time:");
  console.log("#\tselfCPU\ttotalSampledCPU\tfunction\tmodule");

  if (rows.length === 0) {
    console.log("(no samples in profile)");
  } else {
    rows.forEach((r, i) => {
      console.log(
        (i + 1) + "\t" +
        fmtMs(r.selfUs) + "\t" +
        fmtMs(totalSampledUs) + "\t" +   // totalSampledCPU (whole profile)
        r.fn + "\t" +
        r.module
      );
    });
  }
}

main();
