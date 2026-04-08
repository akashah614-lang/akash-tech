# TaxGraph v4.1 — test suite

A test harness for the `compute1040()` engine inside `engine-source.jsx`
(TaxGraph v4.1, TY2025 + OBBBA).

## What this suite is for

1. **Find bugs.** Every assertion in the analytical cases is derived from a
   citation — IRC, Rev. Proc. 2024-40, OBBBA, or Publication 915. When the
   engine disagrees with one of those, the engine is wrong.
2. **Produce feedback the model can act on.** Every failing case prints a
   diff table, the citation, a plain-English rationale for the expected
   value, and `hints` pointing at the exact spot in `engine.mjs` where the
   likely fix lives.
3. **Catch silent drift.** Snapshot cases lock end-to-end behavior on the
   demo persona. If any line moves, the human has to look — tax code is
   compliance, silent regressions are not acceptable.
4. **Let a human hammer on the engine.** Open `harness.html` in a browser,
   pick a case (or go fully freeform), tweak inputs, watch the 1040 update
   line by line, with pass/fail markers against the case's expected values.

## Layout

```
tax-engine-tests/
├── README.md              ← this file
├── engine-source.jsx      ← engine as originally pasted (for reference)
├── engine.mjs             ← pure-JS extraction — the SUT
├── run.mjs                ← Node test runner + diagnostic reporter
├── harness.html           ← single-file browser playground
└── cases/
    ├── 01-basics.json
    ├── 02-standard-deduction.json
    ├── 03-itemized.json
    ├── 04-credits.json
    ├── 05-self-employment.json
    ├── 06-social-security.json
    ├── 07-investments.json
    ├── 08-obbba-deductions.json
    ├── 09-additional-taxes.json
    └── 10-persona-thompson.json
```

**Keep `engine.mjs` in sync with `engine-source.jsx`.** The extraction is
byte-for-byte faithful to the `compute1040()` pipeline plus its helpers and
constants — only `export` keywords and formatting were added. When the React
component changes, mirror the edits in `engine.mjs`.

## Running

Zero dependencies — pure Node ES modules, ≥ Node 18.

```bash
cd tax-engine-tests
node run.mjs                    # run everything
node run.mjs --filter ss-       # only ids containing "ss-"
node run.mjs --only analytical  # subset: analytical | known-bug | snapshot
node run.mjs --verbose          # also print raw inputs & full results on fail
node run.mjs --json             # machine-readable report
```

Exit codes:
- `0` — clean (passes + documented known bugs, nothing unexpected)
- `1` — at least one analytical failure or snapshot drift (human action needed)
- `2` — loader/parse error in a case file

## Case kinds

Every case declares a `kind` that tells the runner how to classify failures.

| kind         | meaning                                                                                         |
|--------------|-------------------------------------------------------------------------------------------------|
| `analytical` | Expected comes from the law. If it fails, the **engine is wrong**.                              |
| `known-bug`  | Documents a bug. Failing is expected. If it *passes*, someone fixed it — flip kind to `analytical`. |
| `snapshot`   | Expected comes from a prior engine run. Failing = drift, needs **human confirmation**.         |

Report semantics, keyed off kind:

```
✓   analytical pass                          fine
✗   analytical fail                          ← engine bug, fix me
•   known-bug (still broken)                 expected, exit 0
✓   known-bug now passing                    ← flip to 'analytical'
✓   snapshot match                           fine
✗   snapshot drift                           ← human must confirm
```

## Case schema

```jsonc
{
  "category": "Credits",
  "description": "...",
  "cases": [
    {
      "id":         "ctc-phase-out-partial",   // stable, snake-case
      "name":       "Single, 2 kids, AGI $220K",
      "kind":       "analytical",              // or "known-bug" or "snapshot"
      "citation":   "IRC §24(b)",              // authority — required for analytical/known-bug
      "rationale":  "show your work here",     // shown on failure
      "hints":      [                          // fix pointers, shown on failure
        "engine.mjs: see the CTC phase-out block",
        "ceil((L11-200000)/1000) * 50"
      ],
      "input": {                                // exactly what compute1040() receives
        "filing_status": "Single",
        "w2s": [{ "wages": "220000" }],
        "num_kids": "2"
      },
      "expect": {                               // dot-path keys on the result object
        "d.ctc": 3400,
        "lines.L15": 198250
      },
      "tolerance":     1,                       // optional, dollars; default 1
      "notesInclude":  ["Itemizing saves"],     // optional substrings that must appear in notes
      "notesExclude":  ["over-withheld"]        // optional substrings that must NOT appear
    }
  ]
}
```

## Writing a new case

1. Open `harness.html`, dial in the scenario, check the output looks right.
2. Pick the `id` and `kind`. For `analytical`, write the `rationale` first —
   if you can't justify the expected number from law, downgrade to `snapshot`
   or skip it.
3. Drop the case into the most relevant `cases/*.json` (or make a new file).
4. Run `node run.mjs --filter your-id` to confirm.

Prefer **a small number of focused expected values** over asserting every
line of the 1040. A test that checks `d.ctc` is clearer than one that pins
every intermediate line. Save the per-line snapshot style for the
end-to-end persona cases.

## Accepting a snapshot drift

The runner prints a ready-to-paste fragment when snapshots drift:

```
✗ persona-thompson-demo  Michael & Jennifer Thompson
    SNAPSHOT DRIFT
    ...diff table...
    to accept, replace these keys in expect:
      "lines.L12": 41024
      "d.itemized.total": 41024
```

**Do not blind-paste.** Tax code is compliance. Verify the new number is
right (load the case in `harness.html`, cross-check against a worksheet),
then edit `cases/10-persona-thompson.json` to match. Commit the snapshot
update in its own commit so the change is auditable.

## Current status

As of the initial commit, every analytical case passes and the following
**9 known bugs** are documented as failing tests:

| id | file | what's wrong |
|---|---|---|
| `std-over65-mfj-both-full` | 02 | OBBBA senior bonus only added once on MFJ instead of per spouse |
| `std-over65-mfj-spouse-only` | 02 | senior bonus skipped entirely if only the spouse is 65+ |
| `actc-no-earned-income` | 04 | ACTC refund ignores the 15%·(earned−$2,500) limit |
| `actc-earned-income-limits` | 04 | same bug, different input |
| `se-above-ss-base` | 05 | SE tax applies flat 15.3% instead of capping SS at wage base |
| `ss-tier2-single-bug` | 06 | Pub 915 second-tier formula is wrong |
| `ss-tier2-mfj-bug` | 06 | same, plus MFJ second base hard-coded as $41K instead of $44K |
| `exss-multi-employer` | 09 | excess SS withholding computed per W-2 instead of across all |
| `exss-single-employer-spurious` | 09 | single-employer over-withholding wrongly credited on 1040 |

Each case carries `hints` pointing to the specific block in `engine.mjs`
that needs the fix, plus a sketch of the corrected formula. Start there.

## Things this suite does NOT test yet

These are known simplifications in the engine — call them out before
adding tests, because "incorrect" here is ambiguous:

- AMT (not implemented)
- EITC (not implemented)
- Mortgage interest $750K/$1M cap
- Charitable contribution 60% AGI cap
- OBBBA tips/overtime phase-outs (thresholds unclear at the time of writing)
- Dependent filer's reduced standard deduction
- QBI's W-2 wages / SSTB limits
- NIIT/Addl Medicare using MAGI vs AGI distinctions

If you add tests for any of the above, cite the statute you're asserting
against and add to the list in `cases/`.
