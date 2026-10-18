#!/usr/bin/env python3
"""Search the Roblox Creator Store (Studio's own toolbox) for audio.

No API key, no cookie, no upload, no quota. These are the endpoints Studio's
toolbox uses itself and they take no auth at all:

    toolbox-service/v1/marketplace/3?keyword=...   ids for assetType 3 = Audio
    toolbox-service/v1/items/details?assetIds=...  metadata for those ids

Nothing here proves a sound is usable. The toolbox `duration` field is WRONG
often enough to be dangerous (measured: a real 0.500s sound reported 0), and a
listing says nothing about whether the asset resolves in a place. Studio is the
only ground truth, so this script only ever produces CANDIDATES; probe.lua and
pick.py decide.

    find_sfx.py search --query "sheep bleat" --kind SoundEffect --limit 20
    find_sfx.py spec examples/spec.example.json --out work/candidates.json
    find_sfx.py details --ids 1234,5678
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MARKETPLACE = "https://apis.roblox.com/toolbox-service/v1/marketplace/3"
DETAILS = "https://apis.roblox.com/toolbox-service/v1/items/details"

# sortType 3 is what Studio's audio tab sends for "Relevance". 0 is Popular.
SORT_RELEVANCE = 3
SORT_POPULAR = 0

ROBLOX_CREATOR_ID = 1
UA = "Mozilla/5.0 (roblox-sfx skill)"

STOP = {"a", "an", "the", "of", "and", "sound", "sfx", "audio", "effect", "noise"}


def _get(url: str, params: dict, tries: int = 3) -> dict:
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}"
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"toolbox request failed after {tries} tries: {full}\n  {last}")


def search_ids(keyword: str, limit: int = 30, sort: int = SORT_RELEVANCE) -> list[int]:
    """Ids only. The marketplace endpoint returns no metadata whatsoever."""
    out: list[int] = []
    cursor = ""
    while len(out) < limit:
        params = {"limit": min(30, limit - len(out)), "keyword": keyword, "sortType": sort}
        if cursor:
            params["cursor"] = cursor
        page = _get(MARKETPLACE, params)
        rows = page.get("data") or []
        if not rows:
            break
        out.extend(int(r["id"]) for r in rows)
        cursor = page.get("nextPageCursor") or ""
        if not cursor:
            break
    return out[:limit]


def fetch_details(ids: list[int]) -> list[dict]:
    """Details in batches. Returns one flat dict per asset."""
    flat: list[dict] = []
    for i in range(0, len(ids), 30):
        chunk = ids[i : i + 30]
        page = _get(DETAILS, {"assetIds": ",".join(str(x) for x in chunk)})
        for row in page.get("data") or []:
            asset = row.get("asset") or {}
            audio = asset.get("audioDetails") or {}
            creator = row.get("creator") or {}
            voting = row.get("voting") or {}
            product = row.get("fiatProduct") or {}
            flat.append(
                {
                    "id": asset.get("id"),
                    "name": asset.get("name") or audio.get("title") or "",
                    "audioType": audio.get("audioType") or "",
                    "artist": audio.get("artist") or "",
                    # KEEP THE NAME listed_duration. It is a listing claim, not a
                    # measurement, and pick.py must never gate on it.
                    "listed_duration": asset.get("duration"),
                    "created": (asset.get("createdUtc") or "")[:10],
                    "creator_id": creator.get("id"),
                    "creator": creator.get("name") or "",
                    "creator_verified": bool(creator.get("isVerifiedCreator")),
                    "up_votes": voting.get("upVotes") or 0,
                    "up_percent": voting.get("upVotePercent"),
                    "free": bool(product.get("isFree", True)),
                }
            )
    return flat


def tokens(text: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", text.lower()) if t and t not in STOP}


def score(row: dict, query: str, kind: str | None) -> float:
    """Rank on what the listing can actually tell us. Deliberately boring.

    Every term here is a fact in the payload. Nothing here is a guess about how
    the sound SOUNDS, because a listing cannot carry that and pretending
    otherwise is how you ship a 'sheep bleat' that is nine minutes of dubstep.
    """
    want = tokens(query)
    have = tokens(row["name"]) | tokens(row["artist"])
    if not want:
        overlap = 0.0
    else:
        overlap = len(want & have) / len(want)

    s = overlap * 10.0
    if want and want <= have:
        s += 3.0  # every query word present
    if kind and row["audioType"] == kind:
        s += 4.0
    elif kind and row["audioType"] and row["audioType"] != kind:
        s -= 6.0  # a Music track where a SoundEffect was asked for
    if row["creator_id"] == ROBLOX_CREATOR_ID:
        s += 3.0  # Roblox's own stock library: consistent, always permitted
    elif row["creator_verified"]:
        s += 0.5
    if not row["free"]:
        s -= 100.0  # hard reject, kept as a score so it stays visible in output
    if row["up_votes"]:
        s += min(2.0, row["up_votes"] / 50.0)
    return round(s, 3)


def candidates_for(role: dict, per_role: int) -> dict:
    query = role["query"]
    kind = role.get("kind", "SoundEffect")
    ids = search_ids(query, limit=role.get("search", 30))
    rows = fetch_details(ids)
    for r in rows:
        r["score"] = score(r, query, kind)
    rows = [r for r in rows if r["free"]]
    rows.sort(key=lambda r: -r["score"])
    return {
        "role": role["name"],
        "query": query,
        "kind": kind,
        "min_len": role.get("min_len", 0.05),
        "max_len": role.get("max_len", 10.0),
        "volume": role.get("volume", 0.5),
        "looped": bool(role.get("looped", False)),
        "candidates": rows[:per_role],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="one query, printed as a table")
    s.add_argument("--query", required=True)
    s.add_argument("--kind", default="SoundEffect", choices=["SoundEffect", "Music", "any"])
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--json", help="write full rows here")

    p = sub.add_parser("spec", help="run every role in a spec file")
    p.add_argument("spec")
    p.add_argument("--out", default="work/candidates.json")
    p.add_argument("--per-role", type=int, default=6)

    d = sub.add_parser("details", help="raw details for ids")
    d.add_argument("--ids", required=True)

    a = ap.parse_args()

    if a.cmd == "search":
        kind = None if a.kind == "any" else a.kind
        ids = search_ids(a.query, limit=a.limit)
        rows = fetch_details(ids)
        for r in rows:
            r["score"] = score(r, a.query, kind)
        rows.sort(key=lambda r: -r["score"])
        print(f"{'score':>6}  {'id':>16}  {'type':<12} {'listed':>6}  name")
        for r in rows:
            print(
                f"{r['score']:>6.2f}  {r['id']:>16}  {r['audioType']:<12} "
                f"{str(r['listed_duration']):>6}  {r['name'][:52]}  [{r['creator']}]"
            )
        print("\nlisted duration is a CLAIM, not a measurement. Probe in Studio.")
        if a.json:
            Path(a.json).parent.mkdir(parents=True, exist_ok=True)
            Path(a.json).write_text(json.dumps(rows, indent=1), encoding="utf-8")
        return 0

    if a.cmd == "details":
        ids = [int(x) for x in a.ids.split(",") if x.strip()]
        print(json.dumps(fetch_details(ids), indent=1))
        return 0

    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    roles = spec["roles"]
    out = {"spec": str(a.spec), "name": spec.get("name", "sfx"), "roles": []}
    for role in roles:
        print(f"searching {role['name']:<22} {role['query']!r} ...", file=sys.stderr)
        out["roles"].append(candidates_for(role, a.per_role))
    dest = Path(a.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(r["candidates"]) for r in out["roles"])
    print(f"\n{len(roles)} roles, {total} candidates -> {dest}")
    print("next: emit_probe.py, then execute_luau probe.lua + report.lua, then pick.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
