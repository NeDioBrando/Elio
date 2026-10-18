"""Static checks on a UI spec, before anything renders.

    python verify_ui.py specs/*.json [--strict]

WHY STATIC AND NOT A SCREENSHOT. A screenshot answers "does this look right at
1280x720", which is the question you can already answer by eye. These checks
answer the questions a render CANNOT: what happens on a phone, what happens under
the player's thumb, and whether a construction is one Roblox silently refuses to
draw. Every one of them has a recorded failure behind it.

THE CHECKS

  offset_size      Size or Position in OFFSET where scale was meant. The number
                   one cause of broken mobile UI, and it looks perfect on the
                   machine it was authored on. Offset is legitimate for a fixed
                   gutter, so this reports rather than fails unless --strict.
  touch_target     Any button under 44pt on the WORST supported device, measured
                   at the reference resolution times that device's UIScale. This
                   is the check that stops "add a UIScale" being mistaken for a
                   mobile strategy: uniform downscaling takes a 68px button to
                   39pt on a handset, and 39pt is a missed tap.
  viewport_fit     The scaled page does not fit the device at all.
  safe_zone        Anything inside the thumbstick zone, the jump zone, or the
                   36px Roblox top bar inset. Skipped inside a "modal": true
                   window, because those controls are not drawn while a dialog
                   is up.
  rotated_clip     A rotated element inside a ClipsDescendants parent. Roblox
                   DOES NOT CLIP ROTATED DESCENDANTS: it lints clean, exits 0,
                   and throws diagonal bands across the viewport.
  stroke_mix       More than one outer stroke thickness on one page. Mixed stroke
                   weight is the clearest tell of beginner or generated UI.
  grid_aspect      A UIGridLayout with no UIAspectRatioConstraint on its cells.
  missing_icon     An icon the icon folder does not contain, which renders as
                   nothing at all rather than as an error.
  text_fit         A label whose text does not fit its box at the designed size.
                   Roblox's TextScaled does NOT overflow - it SHRINKS, without
                   limit, so the real symptom is not text outside a frame but text
                   that has quietly become unreadable. This measures the shrink
                   with the real font and fails when the on-device result drops
                   below a legible size.
  overflow         A child whose resolved rect leaves its parent. Set
                   "overhang": true on an element that is MEANT to sit proud of
                   its parent, such as a close button on a window corner - a
                   check that cries wolf stops being read.

A check that cannot fail is not a check. `--self-test` sabotages a spec in each
of these ways and asserts every one goes red.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ui_build  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

# One throwaway canvas to measure text against. Measuring needs a draw context and
# the real font, which is the whole point: a width check done with an assumed
# character width is a guess, and Fredoka is much wider than most.
_measure_draw = ImageDraw.Draw(Image.new("RGB", (8, 8)))

# Real viewports, not round numbers. These are what the checks are evaluated at,
# because "does it work on mobile" is not answerable at one size.
DEVICES = [
    ("phone-small", 640, 360),      # the floor worth supporting, landscape
    ("phone", 896, 414),            # a modern handset, landscape
    ("tablet", 1024, 768),
    ("desktop", 1920, 1080),
]
SMALL = (640, 360)
TOUCH_MIN = 44
TOPBAR = 36

# The pages are authored at a reference resolution in OFFSET and mapped to the
# viewport by ONE UIScale on the CanvasFrame - see ui_build.py. These bounds must
# match UIController.client.lua exactly or the checker is measuring a UI that does
# not ship.
#
# The cap exists because uncapped scaling makes a 1440p screen's UI enormous.
#
# THERE IS DELIBERATELY NO FLOOR. A floor was tried at 0.60 and it was the wrong
# lever: it made the page render at 768x432 on a 640x360 phone, so it no longer
# FIT, which is worse than being small. Touch targets are protected by making the
# base controls big enough at the reference resolution instead - which is what
# "mobile first" actually costs - and the touch_target check below is what says by
# how much.
SCALE_MIN, SCALE_MAX = 0.0, 1.25

# Smallest text worth shipping, in points on the WORST supported device. Below
# this a label is present but not readable, which is the failure TextScaled hides
# by shrinking instead of overflowing.
MIN_TEXT_PT = 11
# A label forced below this fraction of its designed size is a layout problem even
# if it is still legible - the design asked for a size the box cannot give.
MIN_TEXT_RATIO = 0.55


def ui_scale(vw: int, vh: int, ref_w: int, ref_h: int) -> float:
    return max(SCALE_MIN, min(SCALE_MAX, min(vw / ref_w, vh / ref_h)))
# Fractions of the screen, from mobile control-zone measurements. The thumbstick sits bottom-left and
# the jump button bottom-right, and both are drawn by Roblox over your UI.
THUMBSTICK = (0.0, 0.62, 0.30, 1.0)
JUMPZONE = (0.76, 0.68, 1.0, 1.0)
# Roblox draws its own PLAYER LIST in the top-right corner of every experience
# unless the game turns it off. This checker did not know that, so a combo
# counter pinned to the top-right corner passed every zone check and was then
# completely hidden behind the roster the moment a second player joined - a
# defect that is INVISIBLE in a solo playtest and in every mockup, because
# neither draws the CoreGui. Roughly 260x220 at a 1280x720 reference, and it
# grows with longer usernames, so the zone is generous on purpose.
PLAYERLIST = (0.79, 0.0, 1.0, 0.31)


# --------------------------------------------------------------- layout hygiene
#
# THREE THINGS A HUMAN NOTICES IMMEDIATELY AND NO EXISTING CHECK COULD SEE.
# Every one of them was reported by eye on a build where this checker said the
# page was clean, which is the definition of a missing check.
#
# MIN_GAP_PX  Sibling elements must not touch. Two controls with zero space
#             between them read as one control with a line through it, and at
#             the smallest supported scale a 1px gap is 0px. Measured at the
#             REFERENCE resolution, so it survives scaling.
# CENTRE_TOL  "Centred" is not a property, it is a measurement: the rendered
#             centre against the parent's centre. The classic Roblox bug is a
#             0.5 scale position with no 0.5 anchor, which lands the element
#             half its own size off centre and looks almost right.
# WRAP_TIGHT  A container drawn tight around a single child reads as a BOX
#             around it - the box-behind-the-button defect. A frame
#             that exists only to position something must be transparent.
MIN_GAP_PX = 8
CENTRE_TOL_PX = 1.5
WRAP_TIGHT_PX = 6


def rects(spec, theme, size):
    root = {"type": "root", "size": [1, 0, 1, 0], "children": spec["children"]}
    node = ui_build.resolve(root, (0, 0, size[0], size[1]), theme)
    return node


def overlaps(rect, zone, size):
    x, y, w, h = rect
    zx0, zy0, zx1, zy1 = (zone[0] * size[0], zone[1] * size[1],
                          zone[2] * size[0], zone[3] * size[1])
    return not (x + w <= zx0 or x >= zx1 or y + h <= zy0 or y >= zy1)


def check(spec, theme, icons, path):
    issues = []

    def add(level, code, msg):
        issues.append({"level": level, "check": code, "where": path, "msg": msg})

    ref = spec.get("resolution", [1280, 720])
    big = rects(spec, theme, ref)
    small = rects(spec, theme, SMALL)

    # Every device the design claims to support, and the worst case across them.
    scales = {name: ui_scale(vw, vh, ref[0], ref[1]) for name, vw, vh in DEVICES}
    worst_dev, worst_scale = min(scales.items(), key=lambda kv: kv[1])

    for name, vw, vh in DEVICES:
        sc = scales[name]
        page_w, page_h = ref[0] * sc, ref[1] * sc
        if page_w > vw + 1 or page_h > vh + 1:
            add("fail", "viewport_fit",
                f"at {name} {vw}x{vh} the page scales to {page_w:.0f}x{page_h:.0f} "
                f"and does not fit; the UIScale floor of {SCALE_MIN} is too high "
                f"for this reference resolution")

    strokes = set()

    def visit(node, parent_spec, small_node, in_modal=False):
        s = node.spec
        in_modal = in_modal or bool(s.get("modal"))
        kind = s.get("type", "frame")
        name = s.get("name") or kind

        sz, po = s.get("size", [1, 0, 1, 0]), s.get("pos", [0, 0, 0, 0])
        if kind in ("panel", "button", "frame") and s.get("children"):
            if sz[0] == 0 and sz[2] == 0 and sz[1] and sz[3]:
                add("info", "offset_size",
                    f"{name} is sized purely in offset ({sz[1]}x{sz[3]}); it will not "
                    "scale with the screen")

        # TEXT FIT. Measured for a label AND for a button's own caption (a caption
        # written as a button's "text" used to be skipped, so it could shrink to a
        # smear unchecked), and for every declared SAMPLE as well as the text.
        #
        # SAMPLES exist because of the sentinel rule: a dynamic label ships as
        # "<unbound>", nine characters, so measuring only the shipped text proves
        # nothing about "Wasps fly! Only Soda Cannons, Bug Zappers and the
        # Magnifying Glass hit them". "samples": [...] lists the longest strings
        # the live code will actually write; they are measured, never shipped.
        texts = []
        # The sentinel itself is never what the player reads, so it is not measured:
        # declare "samples" for a dynamic label instead (the sentinel gate still runs).
        if kind in ("label", "button") and str(s.get("text", "")) and s.get("text") != "<unbound>":
            texts.append(str(s["text"]))
        if kind in ("label", "button"):
            texts += [str(t) for t in s.get("samples") or []]
        for txt in texts:
            _, _, rw, rh = node.rect
            designed = int(rh * s.get("textScale", 0.62))
            if designed < 6 or rw <= 0:
                continue
            stroke = int(s.get("textStroke", theme["textStroke"]))
            fitted = ui_build.fit_text_size(_measure_draw, txt, designed, (rw, rh),
                                            stroke, wrap=bool(s.get("wrap")))
            on_device = fitted * worst_scale
            if fitted < designed * MIN_TEXT_RATIO:
                add("fail", "text_fit",
                    f"{name}: {txt!r} only fits at {fitted}px in a "
                    f"{rw:.0f}x{rh:.0f} box, down from the designed {designed}px "
                    f"({fitted / designed:.0%}). Widen the box or shorten the text.")
            elif on_device < MIN_TEXT_PT:
                add("fail", "text_fit",
                    f"{name}: {txt!r} renders at {on_device:.0f}pt on "
                    f"{worst_dev} - under the {MIN_TEXT_PT}pt legibility floor.")

        if kind == "button":
            # Measure at the REFERENCE size and apply the UIScale, which is how the
            # element actually gets to the device. Resolving the tree at 640x360
            # instead would model a page that reflows, and this one does not.
            _, _, rw, rh = node.rect
            eff = min(rw, rh) * worst_scale
            if eff < TOUCH_MIN:
                add("fail", "touch_target",
                    f"{name} is {min(rw, rh):.0f}px at the {ref[0]}x{ref[1]} "
                    f"reference, which is {eff:.0f}pt on {worst_dev} "
                    f"(scale {worst_scale:.2f}) - under the {TOUCH_MIN}pt minimum. "
                    f"It needs to be at least {TOUCH_MIN / worst_scale:.0f}px.")
            # The thumbstick and jump button only exist while the player is
            # DRIVING. A modal window is on top and movement is not the task, so
            # the zones apply to HUD-style overlay elements, not to dialogs.
            # Without this the check fires on the bottom-right control of every
            # centred window, which is most of them, and stops being read.
            if not in_modal:
                # Map the REFERENCE rect onto the device the same way the UIScale
                # does: scale it, then centre the scaled page in the viewport.
                # Re-resolving the tree at the device size instead would model a
                # page that reflows, and this one does not - which is why the
                # sabotage test stopped tripping when touch_target moved to the
                # scale model and this did not.
                for dev, vw, vh in DEVICES:
                    sc = scales[dev]
                    ox = (vw - ref[0] * sc) / 2
                    oy = (vh - ref[1] * sc) / 2
                    rx, ry, rw, rh = node.rect
                    dev_rect = (ox + rx * sc, oy + ry * sc, rw * sc, rh * sc)
                    for zone, label in ((THUMBSTICK, "thumbstick"),
                                        (JUMPZONE, "jump button"),
                                        (PLAYERLIST, "Roblox player list")):
                        if overlaps(dev_rect, zone, (vw, vh)):
                            add("fail", "safe_zone",
                                f"{name} sits in the {label} zone on {dev} "
                                f"({vw}x{vh})")
                            break
                    else:
                        continue
                    break
            if not in_modal and small_node.rect[1] < TOPBAR:
                add("warn", "safe_zone",
                    f"{name} runs into the {TOPBAR}px Roblox top bar inset")

        if s.get("rotation") and parent_spec and parent_spec.get("clips"):
            add("fail", "rotated_clip",
                f"{name} is rotated inside a ClipsDescendants parent. Roblox does not "
                "clip rotated descendants; use a UIGradient hard step instead")

        if kind in ("panel", "button") or (kind == "frame" and s.get("outline", True)
                                           and s.get("colour")):
            strokes.add(s.get("stroke", theme["stroke"]))

        lay = s.get("layout")
        if lay and lay.get("type") == "grid":
            kids = s.get("children") or []
            if kids and not any(k.get("aspect") for k in kids):
                add("warn", "grid_aspect",
                    f"{name} is a grid whose cells carry no aspect constraint; tiles "
                    "distort on a different screen ratio")

        if kind == "icon" and icons is not None and s["icon"] not in icons:
            add("fail", "missing_icon",
                f"icon '{s['icon']}' is not in the icon folder; it renders as nothing")

        if parent_spec is not None and not s.get("overhang"):
            px, py, pw, ph = node_parent_rect[id(node)]
            x, y, w, h = node.rect
            if x < px - 1 or y < py - 1 or x + w > px + pw + 1 or y + h > py + ph + 1:
                add("warn", "overflow",
                    f"{name} leaves its parent by "
                    f"{max(px - x, py - y, x + w - px - pw, y + h - py - ph):.0f}px")


        # --- SIBLINGS MUST NOT TOUCH OR OVERLAP -----------------------------
        # Overlap is a defect; a gap under MIN_GAP_PX is a defect that looks
        # like a design choice until someone sees it on a phone. Elements that
        # deliberately sit on top of things opt out with "overhang" or "modal".
        kids = [
            k for k in node.children
            if not k.spec.get("overhang") and not k.spec.get("modal")
        ]
        for i, a in enumerate(kids):
            ax0, ay0, aw, ah = a.rect
            for b in kids[i + 1:]:
                bx0, by0, bw, bh = b.rect
                ox = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
                oy = min(ay0 + ah, by0 + bh) - max(ay0, by0)
                an = a.spec.get("name") or a.spec.get("type", "element")
                bn = b.spec.get("name") or b.spec.get("type", "element")
                if ox > 0 and oy > 0:
                    add("fail", "sibling_overlap",
                        f"{an} and {bn} overlap by {min(ox, oy):.0f}px inside "
                        f"{name}; mark one 'overhang' if that is intended")
                elif ox > -MIN_GAP_PX and oy > -MIN_GAP_PX:
                    gap = max(-ox, -oy)
                    add("warn", "sibling_gap",
                        f"{an} and {bn} are {gap:.0f}px apart inside {name} "
                        f"(minimum {MIN_GAP_PX}px); elements should never touch")

        # --- CENTRED MEANS MEASURED CENTRED ---------------------------------
        # Checked on anything asking to be centred on an axis, either by saying
        # so or by sitting at 0.5 scale.
        for axis, idx, anchor_i in (("horizontally", 0, 0), ("vertically", 2, 1)):
            # "centre": false is the written-down opt-out for an element placed
            # at 0.5 scale PLUS a deliberate offset (a hotbar nudged clear of the
            # thumbstick zone). Like "overhang", it turns "off centre" into a
            # decision somebody recorded rather than a silenced check.
            if s.get("centre") is False:
                continue
            wants = s.get("centre") or s.get("centred") or (
                po[idx] == 0.5 and s.get("size", [1, 0, 1, 0])[idx] != 1
            )
            if not wants or parent_spec is None:
                continue
            px_, py_, pw_, ph_ = node_parent_rect[id(node)]
            x, y, w, h = node.rect
            mine = (x + w / 2) if idx == 0 else (y + h / 2)
            theirs = (px_ + pw_ / 2) if idx == 0 else (py_ + ph_ / 2)
            if abs(mine - theirs) > CENTRE_TOL_PX:
                off = mine - theirs
                hint = ""
                if abs(abs(off) - (w if idx == 0 else h) / 2) < 2:
                    hint = (" - that is exactly half its own size, which is a "
                            "0.5 position with no 0.5 anchor")
                add("fail", "off_centre",
                    f"{name} asks to be centred {axis} but its centre is "
                    f"{off:+.0f}px from its parent's{hint}")

        # --- NO BOX DRAWN ROUND A CONTROL -----------------------------------
        # A visible container hugging one child is not a container, it is an
        # outline the designer did not ask for.
        if (
            len(node.children) == 1
            and not s.get("transparent")
            and s.get("colour")
            and not s.get("text")
            and not s.get("icon")
            and kind in ("frame", "panel")
        ):
            cx, cy, cw, ch = node.children[0].rect
            x, y, w, h = node.rect
            pad = min(cx - x, cy - y, x + w - cx - cw, y + h - cy - ch)
            # A LABEL FILLING A COLOURED PANEL IS A CHIP, NOT A WRAPPER.
            # Narrowed 2026-09-09. The two cases this check was written for are
            # a box drawn round a BUTTON and a bar's track hugging its FILL, and
            # both still fire. Text sitting on a coloured surface is neither: it
            # is how every chip, badge, pill and header bar is built, and the
            # tell was that ui_kit's OWN window() header tripped its own check.
            # It fired ~30 times across three real pages, every one of them
            # a legitimate chip, and a gate that cries wolf gets switched off.
            # Insetting the label is not the fix either: pad is a min() over all
            # four sides, so silencing it means shrinking the label box, which
            # pushes the rendered text back under the text_fit floor. The two
            # rules only look contradictory because this one was too broad.
            if node.children[0].spec.get("type") == "label":
                pad = None
            if pad is not None and -1 <= pad <= WRAP_TIGHT_PX:
                child = node.children[0].spec
                add("warn", "wrapper_box",
                    f"{name} is an opaque frame {pad:.0f}px around "
                    f"{child.get('name') or child.get('type', 'its child')}, so it "
                    f"draws a box around it; a frame that only positions "
                    f"something needs \"transparent\": true")

        for c, sc in zip(node.children, small_node.children):
            node_parent_rect[id(c)] = node.rect
            visit(c, s, sc, in_modal)

    node_parent_rect = {}
    for c, sc in zip(big.children, small.children):
        node_parent_rect[id(c)] = big.rect
        # A TOP-LEVEL element has no parent spec, so the overflow check below
        # skipped it - which let a 726px-tall window sit on a 720px reference and
        # get clipped at both ends with nothing reported. The screen edge is a
        # parent like any other.
        x, y, w, h = c.rect
        if w > ref[0] + 1 or h > ref[1] + 1:
            add("fail", "overflow",
                f"{c.spec.get('name', 'element')} is {w:.0f}x{h:.0f}, larger than "
                f"the {ref[0]}x{ref[1]} reference screen, so it is clipped")
        visit(c, None, sc)

    if len(strokes) > 1:
        add("warn", "stroke_mix",
            f"{len(strokes)} different stroke thicknesses on one page: "
            f"{sorted(strokes)}")
    return issues


def load(path: Path):
    spec = json.loads(path.read_text(encoding="utf-8"))
    if "theme" not in spec or "children" not in spec:
        # specs/*.json also matches theme.json, which is not a page. Skipping it is
        # friendlier than a KeyError traceback that looks like a broken spec.
        return None, None
    theme = spec["theme"]
    if isinstance(theme, str):
        theme = json.loads(ui_build.resolve_theme_path(path.parent, theme).read_text(encoding="utf-8"))
    return spec, theme


def run(paths, icons, strict):
    total = []
    for p in paths:
        spec, theme = load(p)
        if spec is None:
            continue
        issues = check(spec, theme, icons, p.name)
        total += issues
        fails = [i for i in issues if i["level"] == "fail"]
        print(f"\n{p.name}: {len(fails)} fail, "
              f"{sum(1 for i in issues if i['level'] == 'warn')} warn, "
              f"{sum(1 for i in issues if i['level'] == 'info')} info")
        for i in issues:
            if i["level"] != "info" or strict:
                print(f"  [{i['level']:<4}] {i['check']:<14} {i['msg']}")
    return total


def self_test(base: Path, icons) -> int:
    """Prove each check can go red. A verifier nobody has seen fail is a decoration."""
    spec, theme = load(base)
    cases = {}

    def sab(fn):
        s = copy.deepcopy(spec)
        fn(s)
        return s

    def first(s, kind):
        out = []

        def w(n):
            if n.get("type") == kind:
                out.append(n)
            for c in n.get("children") or []:
                w(c)
        for c in s["children"]:
            w(c)
        return out[0] if out else None

    # A spec need not contain a button at all - a cast HUD can be three
    # `panel`s driven by gamepad face buttons, and on that spec this sabotage
    # crashed with a TypeError on None, taking the WHOLE self-test down before a
    # single check had been proven. A self-test that cannot run is worth less
    # than no self-test, because it reads as "checked". Sabotage a button the
    # spec actually has, and otherwise plant one.
    def shrink(s):
        b = first(s, "button")
        if b is None:
            b = {"type": "button", "name": "SelfTestTarget", "colour": "red",
                 "pos": [0.5, 0, 0.5, 0], "anchor": [0.5, 0.5]}
            s["children"].append(b)
        b["size"] = [0, 20, 0, 20]
    cases["touch_target"] = sab(shrink)

    def zone(s):
        # A NEW top-level button. Moving an existing one does not work: the first
        # button in the HUD lives inside a UIListLayout, which overrides child
        # positions, so the sabotage was silently undone and the test passed by
        # accident for a while.
        s["children"].append({"type": "button", "name": "Thumbstick",
                              "colour": "red", "size": [0, 120, 0, 120],
                              "pos": [0, 10, 1, -10], "anchor": [0, 1]})
    cases["safe_zone"] = sab(zone)

    def rot(s):
        s["children"].append({"type": "panel", "name": "Chevron", "clips": True,
                              "size": [0, 200, 0, 80], "pos": [0, 20, 0, 200],
                              "children": [{"type": "frame", "name": "Slant",
                                            "colour": "gold", "rotation": 20,
                                            "size": [1, 0, 1, 0]}]})
    cases["rotated_clip"] = sab(rot)

    def strokes(s):
        # A SECOND panel at an odd thickness: re-stroking the only panel a small
        # spec has leaves one thickness on the page, which is not a mix.
        p = first(s, "panel")
        if p is not None:
            p["stroke"] = 11
        s["children"].append({"type": "panel", "name": "OtherStroke", "colour": "panel",
                              "stroke": 3, "size": [0, 120, 0, 60], "pos": [0, 600, 0, 100]})
    cases["stroke_mix"] = sab(strokes)

    # wrapper_box had NO self-test case at all until 2026-09-09, which is how it
    # went unnoticed that it was firing on every coloured chip in a page. The
    # sabotage is the exact complaint it exists for: an opaque frame hugging a
    # BUTTON. A label child is deliberately not caught any more, so sabotaging
    # with a label would now pass and prove nothing.
    def wrapped_button(s):
        s["children"].append({
            "type": "frame", "name": "AccidentalWrapper", "colour": "gold",
            "size": [0, 140, 0, 100], "pos": [0, 400, 0, 300],
            "children": [{"type": "button", "name": "Trapped", "colour": "red",
                          "size": [1, 0, 1, 0]}]})
    cases["wrapper_box"] = sab(wrapped_button)

    def squeeze(s):
        # A long string in a box built for a short one. TextScaled would shrink it
        # to a smear rather than overflow, which is exactly what must be caught.
        s["children"].append({"type": "panel", "name": "Cramped", "colour": "panel",
                              "size": [0, 90, 0, 40], "pos": [0, 300, 0, 300],
                              "children": [{"type": "label", "textScale": 0.7,
                                            "text": "a very long line of text that "
                                                    "cannot possibly fit in here",
                                            "size": [1, 0, 1, 0]}]})
    cases["text_fit"] = sab(squeeze)

    def ghost(s):
        s["children"].append({"type": "icon", "icon": "definitely_not_an_icon",
                              "size": [0, 40, 0, 40], "pos": [0, 400, 0, 400]})
    cases["missing_icon"] = sab(ghost)

    def spill(s):
        p = first(s, "panel")
        (p.setdefault("children", [])).append(
            {"type": "frame", "name": "Spill", "colour": "red",
             "size": [1, 400, 1, 0]})
    cases["overflow"] = sab(spill)

    bad = 0
    for code, s in cases.items():
        # With no --icons folder, prove missing_icon against an empty icon set.
        use = icons if (icons is not None or code != "missing_icon") else set()
        found = {i["check"] for i in check(s, theme, use, f"sabotage:{code}")}
        ok = code in found
        print(f"  {'PASS' if ok else 'MISS'}  {code:<14} "
              f"{'' if ok else 'sabotage did not trip the check'}")
        bad += 0 if ok else 1

    clean = {i["check"] for i in check(spec, theme, icons, "clean")
             if i["level"] == "fail"}
    print(f"  {'PASS' if not clean else 'MISS'}  {'baseline':<14} "
          f"{'' if not clean else f'clean spec failed: {clean}'}")
    return bad + (1 if clean else 0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("specs", nargs="+")
    ap.add_argument("--icons", default=None)
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    paths = [Path(p) for p in args.specs]
    icons = None
    if args.icons:
        icons = {p.stem for p in Path(args.icons).glob("*.png")}

    if args.self_test:
        print("self-test: each check must go red on a sabotaged copy")
        bad = self_test(paths[0], icons)
        print(f"\n{'self-test PASSED' if not bad else f'self-test FAILED ({bad})'}")
        return 1 if bad else 0

    issues = run(paths, icons, args.strict)
    fails = sum(1 for i in issues if i["level"] == "fail")
    print(f"\n{len(paths)} specs, {fails} failures")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
