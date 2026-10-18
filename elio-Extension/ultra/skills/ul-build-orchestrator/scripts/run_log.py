#!/usr/bin/env python3
"""Ledger for a timed Roblox build run.

Three jobs, and they are all the same data:

  1. The intervention counter. How autonomous a run was is a number (how many
     times a human had to step in), and a number you reconstruct afterwards from
     memory is not evidence.
  2. The stall rule. The 30-minute rule is the rule most likely to be broken in
     the moment, so it needs something outside the moment to enforce it.
  3. The fan-out decision. Whether the asset block needs subagents is a question
     about measured stage durations, and this is where those get measured.

Events are append-only JSONL. Nothing is ever rewritten, so the ledger survives a
crash mid-run and can be replayed.

Usage
-----
  run_log.py init  --run dry-run-1 [--mode solo|fanout] [--plan default]
  run_log.py start --stage 3d-meshes
  run_log.py end   --stage 3d-meshes [--status ok|failed|fell-back|skipped]
  run_log.py event --kind intervention|fallback|stall|note \
                   [--stage S] --note "what happened"
  run_log.py counter            # one status line (also written to counter.txt)
  run_log.py status             # what is running and how long it has left
  run_log.py report             # stage table, interventions, budget variance
  run_log.py decide             # solo vs fan-out recommendation from measured data
  run_log.py debts              # what the run left broken - the post-run fix list

All commands take --dir (default ./build-runs) and use the most recent run unless
--run is given.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Suggested budgets in minutes for a one-day build. Edit them to suit your own run.
# "parallelisable" marks stages that are independent of each other and downstream
# of the design spec, which is the only set the fan-out decision applies to.
DEFAULT_PLAN = [
    {"stage": "market-research", "budget_min": 45, "parallelisable": True},
    {"stage": "design-spec", "budget_min": 45, "parallelisable": False},
    {"stage": "code", "budget_min": 120, "parallelisable": False},
    {"stage": "3d-meshes", "budget_min": 50, "parallelisable": True},
    {"stage": "materials", "budget_min": 15, "parallelisable": True},
    {"stage": "ui", "budget_min": 25, "parallelisable": True},
    {"stage": "animation", "budget_min": 60, "parallelisable": True},
    {"stage": "sfx", "budget_min": 45, "parallelisable": True},
    {"stage": "assembly-playtest", "budget_min": 60, "parallelisable": False},
    {"stage": "publish", "budget_min": 15, "parallelisable": False},
]

STALL_MINUTES = 30  # the hard stall rule


# ---------------------------------------------------------------- plumbing

def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def run_dir(base: Path, run: str | None) -> Path:
    if run:
        return base / run
    if not base.exists():
        sys.exit(f"no runs found under {base}. Run `run_log.py init --run <name>` first.")
    runs = sorted((p for p in base.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime)
    if not runs:
        sys.exit(f"no runs found under {base}. Run `run_log.py init --run <name>` first.")
    return runs[-1]


def append(d: Path, obj: dict) -> None:
    obj["ts"] = now_iso()
    with (d / "events.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(obj, ensure_ascii=False) + "\n")


def load(d: Path) -> tuple[dict, list[dict]]:
    meta_path = d / "meta.json"
    if not meta_path.exists():
        sys.exit(f"{d} is not a run directory (no meta.json).")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    events = []
    ev_path = d / "events.jsonl"
    if ev_path.exists():
        for line in ev_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return meta, events


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def stage_spans(events: list[dict]) -> dict[str, dict]:
    """Collapse start/end pairs into per-stage spans. Open stages get end=None."""
    spans: dict[str, dict] = {}
    for e in events:
        st = e.get("stage")
        if not st:
            continue
        if e["kind"] == "start":
            spans.setdefault(st, {"start": e["ts"], "end": None, "status": "running"})
            spans[st]["start"] = e["ts"]
            spans[st]["end"] = None
            spans[st]["status"] = "running"
        elif e["kind"] == "end" and st in spans:
            spans[st]["end"] = e["ts"]
            spans[st]["status"] = e.get("status", "ok")
    return spans


def elapsed_min(span: dict) -> float:
    start = parse_ts(span["start"])
    end = parse_ts(span["end"]) if span["end"] else datetime.now(timezone.utc).astimezone()
    return (end - start).total_seconds() / 60.0


def budget_for(meta: dict, stage: str) -> int | None:
    for row in meta["plan"]:
        if row["stage"] == stage:
            return row["budget_min"]
    return None


def fmt_min(m: float) -> str:
    return f"{int(m)}m" if m < 60 else f"{int(m // 60)}h{int(m % 60):02d}m"


# ---------------------------------------------------------------- commands

def cmd_init(args) -> None:
    base = Path(args.dir)
    d = base / args.run
    if d.exists() and any(d.iterdir()):
        sys.exit(f"{d} already exists and is not empty. Pick another --run name.")
    d.mkdir(parents=True, exist_ok=True)
    meta = {
        "run": args.run,
        "mode": args.mode,
        "started": now_iso(),
        "plan": DEFAULT_PLAN,
        "stall_minutes": STALL_MINUTES,
    }
    (d / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    append(d, {"kind": "run-start", "mode": args.mode})
    total = sum(r["budget_min"] for r in DEFAULT_PLAN)
    print(f"run '{args.run}' initialised at {d}")
    print(f"mode: {args.mode}   budgeted: {fmt_min(total)} across {len(DEFAULT_PLAN)} stages")
    print(f"stall rule: {STALL_MINUTES} minutes - it protects the RUN, not the FIX")
    print("this run is not finished until `debts` is clean. Falling back keeps the")
    print("run moving; healing the cause is not optional and is not deferred to")
    print("some other kind of run, because there is no other kind of run.")


def cmd_start(args) -> None:
    d = run_dir(Path(args.dir), args.run)
    meta, _ = load(d)
    b = budget_for(meta, args.stage)
    if b is None:
        print(f"warning: '{args.stage}' is not in the plan, logging it anyway", file=sys.stderr)
    append(d, {"kind": "start", "stage": args.stage})
    print(f"[start] {args.stage}" + (f"  budget {b}m" if b else ""))


def cmd_end(args) -> None:
    d = run_dir(Path(args.dir), args.run)
    meta, events = load(d)
    spans = stage_spans(events)
    if args.stage not in spans:
        sys.exit(f"'{args.stage}' was never started.")
    append(d, {"kind": "end", "stage": args.stage, "status": args.status})
    meta, events = load(d)
    span = stage_spans(events)[args.stage]
    used = elapsed_min(span)
    b = budget_for(meta, args.stage)
    line = f"[end]   {args.stage}  {fmt_min(used)}  ({args.status})"
    if b:
        delta = used - b
        line += f"  budget {b}m  {'+' if delta >= 0 else ''}{int(delta)}m"
    print(line)


def cmd_event(args) -> None:
    d = run_dir(Path(args.dir), args.run)
    rec = {"kind": args.kind, "stage": args.stage, "note": args.note}
    if args.kind == "fix":
        # A fix that names no debt is a note. Refuse it, because an unattached
        # fix makes `debts --strict` pass while the debt is still open.
        if not args.fixes:
            sys.exit("--kind fix needs --fixes <N>, the debt number from `debts`")
        if not args.level:
            sys.exit("--kind fix needs --level code|gate|doc|external")
        rec["fixes"] = args.fixes
        rec["level"] = args.level
    append(d, rec)
    tail = f" (fixes {args.fixes} at {args.level})" if args.kind == "fix" else ""
    print(f"[{args.kind}] {args.stage or '-'}: {args.note}{tail}")


def cmd_counter(args) -> None:
    """One status line. Also written to counter.txt, so anything can tail the file."""
    d = run_dir(Path(args.dir), args.run)
    meta, events = load(d)
    interventions = sum(1 for e in events if e["kind"] == "intervention")
    fallbacks = sum(1 for e in events if e["kind"] == "fallback")
    start = parse_ts(meta["started"])
    elapsed = (datetime.now(timezone.utc).astimezone() - start).total_seconds() / 60.0
    line = f"INTERVENTIONS: {interventions}   FALLBACKS: {fallbacks}   ELAPSED: {fmt_min(elapsed)}"
    print(line)
    (d / "counter.txt").write_text(line + "\n", encoding="utf-8")


def cmd_status(args) -> None:
    d = run_dir(Path(args.dir), args.run)
    meta, events = load(d)
    spans = stage_spans(events)
    running = [(s, sp) for s, sp in spans.items() if sp["end"] is None]
    if not running:
        print("no stage currently running")
        return
    for stage, sp in running:
        used = elapsed_min(sp)
        b = budget_for(meta, stage)
        msg = f"{stage}: {fmt_min(used)} elapsed"
        if b:
            msg += f" of {b}m budget ({fmt_min(max(0, b - used))} left)"
        if used >= meta["stall_minutes"]:
            msg += f"  <-- PAST THE {meta['stall_minutes']}m STALL RULE, log it and move on"
        print(msg)


def cmd_report(args) -> None:
    d = run_dir(Path(args.dir), args.run)
    meta, events = load(d)
    spans = stage_spans(events)

    print(f"\nRUN: {meta['run']}   mode: {meta['mode']}   started {meta['started']}")
    print("=" * 74)
    print(f"{'stage':<20}{'used':>8}{'budget':>9}{'delta':>8}   status")
    print("-" * 74)
    # Only stages that actually ran count toward the total. Summing the whole
    # plan's budget against a partial run reads as a huge underspend and hides
    # the overrun that matters, which is the opposite of useful mid-run.
    total_used = total_budget = 0.0
    for row in meta["plan"]:
        stage = row["stage"]
        b = row["budget_min"]
        if stage not in spans:
            print(f"{stage:<20}{'-':>8}{b:>8}m{'-':>8}   not run")
            continue
        total_budget += b
        used = elapsed_min(spans[stage])
        total_used += used
        delta = used - b
        flag = "  OVER" if delta > 0 else ""
        print(f"{stage:<20}{fmt_min(used):>8}{b:>8}m{('+' if delta >= 0 else '') + str(int(delta)) + 'm':>8}"
              f"   {spans[stage]['status']}{flag}")
    print("-" * 74)
    print(f"{'RAN SO FAR':<20}{fmt_min(total_used):>8}{int(total_budget):>8}m"
          f"{('+' if total_used - total_budget >= 0 else '') + str(int(total_used - total_budget)) + 'm':>8}")
    plan_total = sum(r["budget_min"] for r in meta["plan"])
    remaining = plan_total - total_budget
    print(f"{'PLAN REMAINING':<20}{'':>8}{int(remaining):>8}m"
          f"   ({fmt_min(plan_total)} budgeted for the full run)")

    for kind, label in (("intervention", "INTERVENTIONS"), ("fallback", "FALLBACKS"), ("stall", "STALLS")):
        rows = [e for e in events if e["kind"] == kind]
        print(f"\n{label} ({len(rows)})")
        if not rows:
            print("  none")
        for e in rows:
            print(f"  {e['ts'][11:19]}  {e.get('stage') or '-':<18} {e.get('note') or ''}")
    print()


def cmd_decide(args) -> None:
    """The fan-out recommendation, from measured data rather than intuition.

    UPDATED: fan-out is now the default and this command no longer
    decides WHETHER to fan out - the asset block always does. It reports whether
    the split paid off, so the stage boundaries can be retuned.

    The old rule was that solo wins by default and fan-out must be earned by an
    overrun in the parallelisable stages. That was measured against wall-clock,
    which turned out to be the wrong meter: the real cost of a long solo run is
    that every tool call re-sends the whole conversation, so cost grows closer to
    quadratic than linear in the number of calls, and per-agent model tiering
    only applies inside a subagent. A run can finish comfortably inside its
    wall-clock budget and still cost several times what it needed to.
    """
    d = run_dir(Path(args.dir), args.run)
    meta, events = load(d)
    spans = stage_spans(events)

    par = [r for r in meta["plan"] if r["parallelisable"]]
    measured = [(r["stage"], elapsed_min(spans[r["stage"]]), r["budget_min"])
                for r in par if r["stage"] in spans and spans[r["stage"]]["end"]]

    print(f"\nFAN-OUT DECISION for run '{meta['run']}' (mode was {meta['mode']})")
    print("=" * 74)

    if not measured:
        print("No parallelisable stage has completed yet. Nothing to decide on.")
        print("Run the dry run to completion first; the measurement is the input.")
        return

    used = sum(m[1] for m in measured)
    budget = sum(m[2] for m in measured)
    overruns = [m for m in measured if m[1] > m[2]]
    stalls = [e for e in events if e["kind"] == "stall"]

    print(f"parallelisable stages measured: {len(measured)} of {len(par)}")
    print(f"  used {fmt_min(used)} against {int(budget)}m budgeted "
          f"({'+' if used - budget >= 0 else ''}{int(used - budget)}m)")
    print(f"  stages over their own budget: {len(overruns)}"
          + (f"  ({', '.join(m[0] for m in overruns)})" if overruns else ""))
    print(f"  stalls logged: {len(stalls)}")
    print()

    if used <= budget and not stalls:
        print("RECOMMENDATION: stay solo.")
        print("  The single-threaded run fits the budget. Adding agents to a task one")
        print("  agent already handles is the case that measurably degrades, and on a")
        print("  one-shot run it also adds an untested variable that makes a bad result")
        print("  harder to diagnose. Keep the ledger and the stall rule; drop the roster.")
    elif used > budget * 1.5 or len(overruns) >= 2:
        print("RECOMMENDATION: fan out the asset block.")
        print(f"  The parallelisable stages ran {int(used - budget)}m over. That is the")
        print("  shape fan-out is actually for: independent, generation-heavy work behind")
        print("  one shared input. Workers write files only; one thread touches Studio.")
        print("  Rehearse the roster on a practice run first, so it is tested before")
        print("  a run you care about depends on it.")
    else:
        print("RECOMMENDATION: marginal, prefer solo and fix the slow stage instead.")
        print(f"  {int(used - budget)}m over is within the range a prompt or tool fix")
        print("  usually recovers, and that fix is cheaper and lower risk than a roster.")
        if overruns:
            worst = max(overruns, key=lambda m: m[1] - m[2])
            print(f"  Start with '{worst[0]}' ({int(worst[1] - worst[2])}m over).")
    print()


# ---------------------------------------------------------------- cli

FIX_LEVELS = {
    "code": "the defect is now unrepresentable. Cannot regress",
    "gate": "it can still happen, but fails loudly and early",
    "doc": "a future session is told, if it reads it",
    "external": "not ours to fix. A DESIGNED fallback, not an accidental one",
    "resolved": "not a defect - the run completed it later and left nothing behind",
}


def collect_debts(events: list[dict]) -> tuple[list[dict], dict[str, dict]]:
    """Index the debts. NOT by timestamp: three debts landed in the same second
    in one run and would have shared a key, so closing one would have closed
    all three. The events file is append-only, so position is stable."""
    debts = [e for e in events if e.get("kind") in ("fallback", "stall", "intervention")]
    for i, e in enumerate(debts, 1):
        e["_key"] = str(i)
    fixes: dict[str, dict] = {}
    for e in events:
        if e.get("kind") == "fix" and e.get("fixes"):
            fixes[e["fixes"]] = e
    return debts, fixes


def cmd_debts(args) -> None:
    """What did this run leave broken, and is any of it still open?

    THE GAP THIS CLOSES. The ledger recorded seven fallbacks and two stalls
    faithfully and in real time, and then nothing turned any of them
    into a fix. They were fixed hours later because a human asked why they had not
    been fixed, not because anything surfaced them. Recording an issue feels like
    handling it: that is the failure mode of every honest log.

    THE SHARPER POINT. "One prompt, a full game" is incompatible with a
    pipeline that carries open debts from run to run. A fallback that fires is
    a run that did not finish its job - in one run the mesh stage fell back and
    the game shipped with Cylinder coins, and the fix turned out to be a missing
    `import os`. One hour, once, and every run afterwards has real meshes.

    So the stall rule is not wrong, it is MODE-BLIND. In a time-capped run "log
    it and move on" protects the cap. Afterwards it is the opposite of the
    point. Gating on open debts is what makes that enforceable.
    """
    d = run_dir(Path(args.dir), args.run)
    meta, events = load(d)
    debts, fixes = collect_debts(events)

    print("")
    print(f"DEBTS FROM RUN: {meta['run']}")
    print("=" * 74)

    if not debts:
        print("")
        print("Nothing fell back, nothing stalled, nothing needed a human.")
        print("That is either a clean run or a ledger nobody wrote to - check the")
        print("stage table before believing it.")
        return

    groups = (
        ("FELL BACK", "fallback",
         "the ambitious path failed and the run took the cheaper one"),
        ("STALLED", "stall",
         "something ate time and was abandoned rather than solved"),
        ("NEEDED A HUMAN", "intervention",
         "the counter's whole point - each one is a thing to automate"),
    )

    open_debts: list[dict] = []
    weak_fixes: list[tuple[dict, dict]] = []

    for label, kind, why in groups:
        rows = [e for e in debts if e.get("kind") == kind]
        if not rows:
            continue
        print("")
        print(f"{label}  ({len(rows)})   {why}")
        print("-" * 74)
        for e in rows:
            key = e["_key"]
            fix = fixes.get(key)
            note = " ".join((e.get("note") or "").split())
            stage = e.get("stage") or "-"
            if fix:
                lvl = fix.get("level", "?")
                mark = f"FIXED[{lvl}]"
                if lvl == "doc":
                    weak_fixes.append((e, fix))
            else:
                mark = "OPEN"
                open_debts.append(e)
            print(f"  #{key:<3} {mark:<14} [{stage}] {note[:290]}")
            if fix:
                print(f"           -> {' '.join((fix.get('note') or '').split())[:280]}")

    print("")
    print("=" * 74)
    print("Close each one with the STRONGEST fix that applies:")
    for lvl, why in FIX_LEVELS.items():
        print(f"  --level {lvl:<9} {why}")
    print("")
    print("  run_log.py event --kind fix --fixes <N> --level code \\")
    print('      --note \"what changed, and how it was verified\"')
    print("")
    print("A GATE IS ONLY REAL ONCE IT HAS FAILED ON A KNOWN-BAD INPUT.")
    print("An untested gate is a comfort, not a check.")

    print("")
    print(f"OPEN: {len(open_debts)}    doc-only: {len(weak_fixes)}    "
          f"total: {len(debts)}")

    # --list is the ONLY way to see this without it gating, and it exists for
    # reading mid-run. It is not a way to finish a run with debts open.
    if getattr(args, "list_only", False):
        return

    problems = []
    for e in open_debts:
        problems.append(f"#{e['_key']} [{e.get('stage') or '-'}] is still OPEN")
    for e, _f in weak_fixes:
        problems.append(
            f"#{e['_key']} [{e.get('stage') or '-'}] is closed at DOC level only - "
            f"if a code fix or a gate was possible, it will happen again")
    if problems:
        print("")
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  FAIL  {p}")
        print("")
        print("THE RUN IS NOT FINISHED. One prompt cannot equal a full game while the")
        print("pipeline is still carrying defects it has already diagnosed. Heal these,")
        print("then re-run. There is no mode in which shipping them is acceptable.")
        sys.exit(1)

    print("")
    print("every debt is closed at code, gate or external level. The pipeline is")
    print("carrying nothing it already knows about.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    # --dir/--run live on every subcommand rather than the top level, so that the
    # natural form (`run_log.py start --stage ui --run foo`) works. Putting them
    # only at the top level makes flags order-sensitive, which is a bad property
    # for something typed under time pressure.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dir", default="build-runs",
                        help="base directory for runs (default: build-runs)")
    common.add_argument("--run", default=None, help="run name (default: most recent)")

    s = sub.add_parser("init", help="start a new run", parents=[common])
    s.add_argument("--mode", choices=["solo", "fanout"], default="fanout")
    s.add_argument("--plan", default="default")
    s.set_defaults(func=cmd_init)

    s = sub.add_parser("start", help="mark a stage as started", parents=[common])
    s.add_argument("--stage", required=True)
    s.set_defaults(func=cmd_start)

    s = sub.add_parser("end", help="mark a stage as finished", parents=[common])
    s.add_argument("--stage", required=True)
    s.add_argument("--status", default="ok",
                   choices=["ok", "failed", "fell-back", "skipped", "partial"])
    s.set_defaults(func=cmd_end)

    s = sub.add_parser("event", help="log an intervention, fallback, stall or note", parents=[common])
    s.add_argument("--kind", required=True,
                   choices=["intervention", "fallback", "stall", "note", "fix"])
    s.add_argument("--fixes", default=None,
                   help="fix only: the debt number (#N) shown by `debts`")
    s.add_argument("--level", default=None, choices=["code", "gate", "doc", "external", "resolved"],
                   help="fix only: how strongly it is closed")
    s.add_argument("--stage", default=None)
    s.add_argument("--note", required=True)
    s.set_defaults(func=cmd_event)

    for name, fn, helptext in (
        ("counter", cmd_counter, "one-line status counter (also writes counter.txt)"),
        ("status", cmd_status, "what is running now and whether it has stalled"),
        ("report", cmd_report, "stage timing table and event lists"),
        ("decide", cmd_decide, "solo vs fan-out recommendation from measured data"),
    ):
        s = sub.add_parser(name, help=helptext, parents=[common])
        s.set_defaults(func=fn)

    s = sub.add_parser("debts", help="what this run left broken, as a post-run fix list",
                       parents=[common])
    # This GATES by default. Healing is the rule; there is no build-day exception.
    s.add_argument("--list", dest="list_only", action="store_true",
                   help="print without gating - for reading mid-run only")
    s.add_argument("--strict", action="store_true",
                   help=argparse.SUPPRESS)  # retained as a no-op: gating is the default now
    s.set_defaults(func=cmd_debts)

    args = p.parse_args()
    if args.cmd == "init" and args.run is None:
        p.error("init requires --run <name>")
    args.func(args)


if __name__ == "__main__":
    main()
