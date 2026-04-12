#!/usr/bin/env node
// ============================================================================
// run.mjs — TaxGraph test runner
// ----------------------------------------------------------------------------
// Loads every JSON file under ./cases, runs each case through compute1040(),
// compares the result to the case's `expect` map, and prints a diagnostic
// report that distinguishes three failure modes:
//
//   1. ANALYTICAL FAIL  → engine contradicts the law. Fix the engine.
//   2. KNOWN BUG        → documented issue; failure is expected.
//                         A PASS here means the bug was fixed (celebrate).
//   3. SNAPSHOT DRIFT   → engine output changed from the locked snapshot.
//                         A human has to confirm before the new value is
//                         pasted back into the JSON fixture.
//
// Usage:
//   node run.mjs                    # run everything
//   node run.mjs --filter ss-       # only ids matching /ss-/
//   node run.mjs --only analytical  # subset: analytical | known-bug | snapshot
//   node run.mjs --verbose          # also print inputs and full line-by-line on fail
//   node run.mjs --json             # emit machine-readable JSON report instead of text
// ============================================================================

import { readFileSync, readdirSync } from "fs";
import { join, dirname }              from "path";
import { fileURLToPath }               from "url";
import { compute1040 }                 from "../engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(__dirname, "cases");

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = k => args.includes(k);
const arg  = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const VERBOSE = flag("--verbose");
const JSON_OUT = flag("--json");
const FILTER = arg("--filter");
const ONLY = arg("--only"); // analytical | known-bug | snapshot

// ── ANSI colors (no-op if NO_COLOR or --json) ───────────────────────────────
const useColor = !process.env.NO_COLOR && !JSON_OUT && process.stdout.isTTY;
const c = {
  red:    s => useColor ? `\x1b[31m${s}\x1b[0m` : s,
  green:  s => useColor ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: s => useColor ? `\x1b[33m${s}\x1b[0m` : s,
  blue:   s => useColor ? `\x1b[34m${s}\x1b[0m` : s,
  cyan:   s => useColor ? `\x1b[36m${s}\x1b[0m` : s,
  dim:    s => useColor ? `\x1b[2m${s}\x1b[0m` : s,
  bold:   s => useColor ? `\x1b[1m${s}\x1b[0m` : s,
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function fmtVal(v) {
  if (v === undefined) return c.dim("<undefined>");
  if (v === null)      return c.dim("<null>");
  if (typeof v === "number") {
    if (!Number.isInteger(v)) return v.toFixed(4);
    return String(v);
  }
  if (typeof v === "string") return `"${v}"`;
  return JSON.stringify(v);
}

function diffNum(expected, actual) {
  if (typeof expected !== "number" || typeof actual !== "number") return "";
  const d = actual - expected;
  if (d === 0) return "";
  return (d > 0 ? "+" : "") + d;
}

function compare(expected, actual, tol = 1) {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined;
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(actual - expected) <= tol;
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

// ── Load cases ─────────────────────────────────────────────────────────────
function loadCases() {
  const files = readdirSync(CASES_DIR)
    .filter(f => f.endsWith(".json"))
    .sort();
  const all = [];
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"));
    } catch (e) {
      console.error(c.red(`ERROR parsing ${f}: ${e.message}`));
      process.exit(2);
    }
    if (!Array.isArray(data.cases)) {
      console.error(c.red(`ERROR: ${f} has no 'cases' array`));
      process.exit(2);
    }
    for (const cc of data.cases) {
      all.push({ ...cc, category: data.category, file: f });
    }
  }
  return all;
}

// ── Run one case ───────────────────────────────────────────────────────────
function runCase(cc) {
  const result = compute1040(cc.input);
  const tol = cc.tolerance ?? 1;
  const mismatches = [];

  // check expect map
  for (const [path, expected] of Object.entries(cc.expect || {})) {
    const actual = getPath(result, path);
    if (!compare(expected, actual, tol)) {
      mismatches.push({ path, expected, actual });
    }
  }

  // check notesInclude — each substring must appear in some note
  for (const substr of cc.notesInclude || []) {
    const hit = (result.notes || []).some(n => n.includes(substr));
    if (!hit) {
      mismatches.push({
        path: "notes",
        expected: `includes "${substr}"`,
        actual: (result.notes || []).length
          ? `[${result.notes.map(n => `"${n}"`).join(", ")}]`
          : "<no notes>",
      });
    }
  }

  // check notesExclude — no note may include substring
  for (const substr of cc.notesExclude || []) {
    const hit = (result.notes || []).find(n => n.includes(substr));
    if (hit) {
      mismatches.push({
        path: "notes",
        expected: `does NOT include "${substr}"`,
        actual: `"${hit}"`,
      });
    }
  }

  return { cc, result, mismatches, passed: mismatches.length === 0 };
}

// ── Print one failing case in detail ───────────────────────────────────────
function printFailure({ cc, result, mismatches }) {
  const kindTag = {
    "analytical": c.red("ANALYTICAL FAIL"),
    "known-bug":  c.yellow("KNOWN BUG"),
    "snapshot":   c.yellow("SNAPSHOT DRIFT"),
  }[cc.kind] || c.red("FAIL");

  console.log(`  ${c.red("✗")} ${c.bold(cc.id)}  ${c.dim(cc.name)}`);
  console.log(`      ${kindTag}   ${c.dim(`(${cc.file})`)}`);
  if (cc.citation) console.log(`      ${c.dim("citation:")} ${cc.citation}`);

  // Aligned diff table
  const hdr = ["path", "expected", "actual", "diff"];
  const rows = mismatches.map(m => [
    m.path,
    fmtVal(m.expected),
    fmtVal(m.actual),
    diffNum(m.expected, m.actual),
  ]);
  const widths = hdr.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length))
  );
  const pad = (s, w) => String(s).padEnd(w);
  console.log(
    "      " + c.dim(hdr.map((h, i) => pad(h, widths[i])).join("  "))
  );
  for (const r of rows) {
    console.log(
      "      " + r.map((v, i) => pad(v, widths[i])).join("  ")
    );
  }

  if (cc.rationale) {
    console.log(`      ${c.dim("expected because:")} ${cc.rationale}`);
  }
  if (cc.hints && cc.hints.length) {
    for (const h of cc.hints) {
      console.log(`      ${c.cyan("hint:")} ${h}`);
    }
  }

  if (VERBOSE) {
    console.log(`      ${c.dim("input:")} ${JSON.stringify(cc.input)}`);
    const snap = {
      lines: result.lines,
      d: result.d,
      notes: result.notes,
    };
    console.log(`      ${c.dim("full result:")} ${JSON.stringify(snap)}`);
  }

  if (cc.kind === "snapshot") {
    // print a ready-to-paste fragment for the new snapshot values
    const frag = {};
    for (const { path, actual } of mismatches) {
      frag[path] = actual;
    }
    console.log(`      ${c.dim("to accept, replace these keys in expect:")}`);
    for (const [k, v] of Object.entries(frag)) {
      console.log(`        ${c.dim('"')}${k}${c.dim('": ')}${fmtVal(v)}`);
    }
  }
}

function printFixedKnownBug(cc) {
  console.log(`  ${c.green("✓")} ${c.bold(cc.id)}  ${c.dim(cc.name)}`);
  console.log(`      ${c.green("KNOWN BUG APPEARS FIXED")} ${c.dim(`(${cc.file})`)}`);
  console.log(
    `      ${c.dim("→ verify intentional, then flip 'kind' from 'known-bug' to 'analytical'")}`
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const all = loadCases();

  const cases = all.filter(cc => {
    if (FILTER && !cc.id.includes(FILTER)) return false;
    if (ONLY && cc.kind !== ONLY) return false;
    return true;
  });

  if (cases.length === 0) {
    console.log(c.yellow("No cases match the given filters."));
    return;
  }

  const stats = {
    total: cases.length,
    passed: 0,
    analyticalFail: [],
    knownBugConfirmed: 0,
    knownBugFixed: [],
    snapshotDrift: [],
  };

  const byFile = {};
  for (const cc of cases) {
    (byFile[cc.file] ??= []).push(cc);
  }

  if (!JSON_OUT) {
    console.log();
    console.log(c.bold("TaxGraph v4.1 — test suite"));
    console.log(c.dim(`${cases.length} case${cases.length === 1 ? "" : "s"} across ${Object.keys(byFile).length} file${Object.keys(byFile).length === 1 ? "" : "s"}\n`));
  }

  const allResults = [];

  for (const [file, grp] of Object.entries(byFile)) {
    if (!JSON_OUT) {
      const header = grp[0].category ? `${grp[0].category}  ${c.dim(`(${file})`)}` : file;
      console.log(c.bold(header));
    }
    for (const cc of grp) {
      const r = runCase(cc);
      allResults.push({ id: cc.id, kind: cc.kind, passed: r.passed, mismatches: r.mismatches });

      if (r.passed) {
        if (cc.kind === "known-bug") {
          stats.knownBugFixed.push(cc.id);
          if (!JSON_OUT) printFixedKnownBug(cc);
        } else {
          stats.passed++;
          if (!JSON_OUT) {
            console.log(`  ${c.green("✓")} ${c.bold(cc.id)}  ${c.dim(cc.name)}`);
          }
        }
      } else {
        if (cc.kind === "known-bug") {
          stats.knownBugConfirmed++;
          if (!JSON_OUT) {
            console.log(`  ${c.yellow("•")} ${c.bold(cc.id)}  ${c.dim(cc.name)}`);
            console.log(`      ${c.yellow("KNOWN BUG")} (still broken) ${c.dim(`— ${cc.citation || ""}`)}`);
            if (VERBOSE) {
              for (const m of r.mismatches) {
                console.log(`        ${m.path}: expected ${fmtVal(m.expected)}, got ${fmtVal(m.actual)} ${diffNum(m.expected, m.actual)}`);
              }
            }
          }
        } else if (cc.kind === "snapshot") {
          stats.snapshotDrift.push(cc.id);
          if (!JSON_OUT) printFailure(r);
        } else {
          stats.analyticalFail.push(cc.id);
          if (!JSON_OUT) printFailure(r);
        }
      }
    }
    if (!JSON_OUT) console.log();
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ stats, results: allResults }, null, 2));
    return;
  }

  // summary
  console.log(c.bold("Summary"));
  console.log("─".repeat(60));
  console.log(`  ${c.green("passed")}               ${stats.passed}`);
  console.log(`  ${c.yellow("known bugs (expected)")} ${stats.knownBugConfirmed}`);
  if (stats.knownBugFixed.length) {
    console.log(`  ${c.green("known bugs now PASSING")} ${stats.knownBugFixed.length}  ${c.dim("← flip kind to 'analytical'")}`);
    for (const id of stats.knownBugFixed) console.log(`      ${c.green("→")} ${id}`);
  }
  if (stats.snapshotDrift.length) {
    console.log(`  ${c.yellow("snapshot drift")}       ${stats.snapshotDrift.length}  ${c.dim("← review and re-lock if intended")}`);
    for (const id of stats.snapshotDrift) console.log(`      ${c.yellow("→")} ${id}`);
  }
  if (stats.analyticalFail.length) {
    console.log(`  ${c.red("analytical fails")}      ${stats.analyticalFail.length}  ${c.dim("← engine bugs")}`);
    for (const id of stats.analyticalFail) console.log(`      ${c.red("→")} ${id}`);
  }
  console.log();

  // exit codes: 0 = all clean, 1 = analytical or snapshot fail, 2 = loader error
  if (stats.analyticalFail.length > 0 || stats.snapshotDrift.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
