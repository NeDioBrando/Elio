"""P21 performance budget: optimisation is a gate, not a clean-up pass.

Every map is checked against numbers before it is built, from the resolved tree
plus what the spec says about its meshes - no Studio needed:

  * unique meshes and unique textures per biome stay under budget - reuse is
    the main optimisation lever, because identical mesh + texture instances batch
  * each mesh's triangles stay under its class budget
  * total estimated triangles, instances and shadow casters stay under budget
  * a mesh with no measured triangle count is UNVERIFIABLE, never PASS

Mesh facts come from the spec's optional "meshes" table (or a JSON file named by
"meshesFile", relative to the spec), keyed by the mesh name a part places:

    "meshes": { "tree_oak": {"tris": 812, "kind": "tree", "textures": ["oak_atlas"]} }

Measure the triangle count from the exported file; never type it from the
generator's parameters (SKILL.md, "never type an asset bound").

Budgets can be raised per map in spec "budget", with a reason.
"""

from __future__ import annotations

import json
import os
import re

TRIS_BY_KIND = {
    "grass": 120, "flower": 120, "kelp": 160,
    "rock": 300, "crate": 300, "barrel": 300, "prop": 300, "lamp": 300, "lantern": 300,
    "bush": 400, "coral": 600, "fence": 300, "post": 200,
    "house": 800, "building": 800,
    "warehouse": 1500, "wall": 800, "roof": 800, "dock": 800, "pier": 800, "hut": 800,
    "pontoon": 600, "bridge": 900, "stall": 600, "crystal": 400, "stalactite": 300,
    "palm": 1200, "ruin": 1200, "column": 600, "arch": 900, "statue": 3000,
    "cliff": 1500, "seastack": 1500,
    "tree": 2500, "tower": 3000,
    "ship": 6000, "creature": 6000, "castle": 8000, "lighthouse": 6000, "keep": 8000,
}
DEFAULT = {
    "uniqueMeshesPerBiome": 40,
    "uniqueTexturesPerBiome": 12,
    "totalTriangles": 1_500_000,
    "instances": 12_000,
    "shadowCasters": 4_000,
}


def kind_of(name):
    """Default kind from a name: strip trailing variant letters/digits.
    tree_oak -> tree, palm_b -> palm, rock3 -> rock, cottage_mesh -> cottage."""
    base = name.lower()
    base = re.sub(r"(_mesh|_[a-z]|_?\d+)$", "", base)
    return base.split("_")[0]


def mesh_table(source):
    """The spec's own mesh facts: inline "meshes", then "meshesFile" over it."""
    table = dict(source.get("meshes") or {})
    rel = source.get("meshesFile")
    if rel:
        path = rel if os.path.isabs(rel) else os.path.join(source.get("__dir__", "."), rel)
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            table.update(data.get("meshes", data))
    return table


def p21_budget(m, Check, PASS, FAIL, WARN, INFO, UNVERIFIABLE):
    budget = dict(DEFAULT, **{k: v for k, v in (m.source.get("budget") or {}).items() if k in DEFAULT})
    lib = mesh_table(m.source)
    placed = [b for b in m.boxes if b.meta.get("mesh")]
    if not placed:
        return Check("P21", "Performance budget", INFO,
                     f"no meshes placed; {len(m.boxes)} instances")

    rows, worst = [], PASS

    def bump(status):
        nonlocal worst
        rank = {FAIL: 0, UNVERIFIABLE: 1, WARN: 2, PASS: 3, INFO: 4}
        if rank[status] < rank[worst]:
            worst = status

    by_biome = {}
    for b in placed:
        by_biome.setdefault(b.meta.get("biome") or m.source.get("biome") or "map", []).append(b)
    for biome, items in sorted(by_biome.items()):
        uniq = {b.meta["mesh"] for b in items}
        tex = set()
        for n in uniq:
            tex.update((lib.get(n) or {}).get("textures") or [])
        if len(uniq) > budget["uniqueMeshesPerBiome"]:
            rows.append(f"{biome}: {len(uniq)} unique meshes (budget {budget['uniqueMeshesPerBiome']})")
            bump(FAIL)
        if len(tex) > budget["uniqueTexturesPerBiome"]:
            rows.append(f"{biome}: {len(tex)} unique textures (budget {budget['uniqueTexturesPerBiome']})")
            bump(FAIL)

    total_tris, unmeasured = 0, set()
    counts = {}
    for b in placed:
        counts[b.meta["mesh"]] = counts.get(b.meta["mesh"], 0) + 1
    for name, n in counts.items():
        e = lib.get(name) or {}
        tris = e.get("tris")
        kind = e.get("kind", kind_of(name))
        if tris is None:
            unmeasured.add(name)
            continue
        # A per-mesh "trisBudget" overrides the kind table, for a model that was
        # built and verified under its own budget. Say why in the spec.
        cap = e.get("trisBudget") or TRIS_BY_KIND.get(kind)
        if cap and tris > cap:
            rows.append(f"{name} ({kind}) has {tris} triangles, class budget {cap}")
            bump(FAIL)
        total_tris += tris * n
    if unmeasured:
        rows.append("triangle count never measured (cannot be verified; add it to the spec's "
                    "\"meshes\" table): " + ", ".join(sorted(unmeasured)))
        bump(UNVERIFIABLE)
    if total_tris > budget["totalTriangles"]:
        rows.append(f"{total_tris:,} placed triangles (budget {budget['totalTriangles']:,})")
        bump(FAIL)

    inst = len(m.boxes)
    casters = sum(1 for b in m.boxes if not (b.meta.get("decor") and max(b.size) < 4.0))
    if inst > budget["instances"]:
        rows.append(f"{inst} instances (budget {budget['instances']})")
        bump(FAIL)
    if casters > budget["shadowCasters"]:
        rows.append(f"{casters} shadow casters (budget {budget['shadowCasters']}) - small foliage "
                    f"must not cast")
        bump(FAIL)

    detail = (f"{len(counts)} unique meshes, {len(placed)} placements, ~{total_tris:,} triangles, "
              f"{inst} instances, {casters} shadow casters")
    return Check("P21", "Performance budget", worst, detail, rows)
