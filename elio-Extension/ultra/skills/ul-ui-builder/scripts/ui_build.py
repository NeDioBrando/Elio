"""One UI spec -> a PNG mockup, a Rojo .model.json, and a Luau builder.

    python ui_build.py spec.json --out build/ --icons icons/ --png --model --luau

THE POINT OF THIS FILE. A mockup drawn in a design tool is a PICTURE of a UI, and
it drifts from the thing that ships. Here the mockup and the instance tree are
rendered from THE SAME RESOLVED TREE, so the PNG cannot disagree with the
.model.json about a size, a colour or a layout. The PNG is a fast local probe -
sub-second, no Studio, no plugin - and the Studio screenshot stays the ground
truth for anything the renderer approximates (font metrics, gradient banding).

LAYOUT IS ROBLOX'S, NOT CSS. Sizes and positions are UDim2 [sx, ox, sy, oy],
AnchorPoint moves the origin within the element, and containers may carry a
UIListLayout or UIGridLayout that overrides child positions. Implementing
Roblox's rules rather than a convenient approximation is what makes the preview
worth trusting.

EVERY VISIBLE ELEMENT IS THE DEPTH STACK from references/ui-recipes.md:

    Shadow   same rect, offset DOWN, darker and hue-shifted toward blue,
             UICorner + dark outer UIStroke
    Face     UICorner + UIGradient (Rotation -90, brighter at the top)
             + dark outer UIStroke

THE EDGE HIGHLIGHT IS OFF BY DEFAULT, and that is a correction. The guide adds
a thin bright inner stroke and calls it the detail that surprised them most - but
it is drawn in Figma on a SATURATED button, where a lighter line reads as a lit
edge. Reproduced in Roblox as an inset frame it becomes a second border with a
visible gap between it and the dark outline, and on a cream panel that line is
almost white. On a real screen it read as white lines drawn on everything.
The UIGradient already carries the top-light, which is what the highlight was for.
Turn it back on per element, or theme-wide with "highlight": true.
"""

from __future__ import annotations

import argparse
import colorsys
import copy
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import patterns as _patterns

HERE = Path(__file__).resolve().parent
FONT_DIR = HERE.parent / "references" / "fonts"
ICON_IDS: dict[str, int] = {}
# spec-node id() -> resolved pixel height at the reference resolution. Filled by
# measure_heights() so the Roblox emitter can cap text at the size the renderer
# actually drew, for scale-sized labels as well as offset ones.
RESOLVED_H: dict[int, float] = {}


# THEME STYLE FIELDS. A theme may
# set "font", "fontStyle" and "flat"; set_style() copies them here so the
# renderer and the emitter read ONE value - the same-tree rule, applied to the
# theme. The preview face is the closest LOCAL font to the Roblox family, so for
# anything but Fredoka the PNG's metrics are an approximation and Studio is truth.
FONTS = {
    #  name         preview TTF (references/fonts or C:/Windows/Fonts)  Roblox family      weight
    "FredokaOne":  ("FredokaOne-Regular.ttf", "FredokaOne", "Regular"),
    "BuilderSans": ("arialbd.ttf", "BuilderSans", "Bold"),
    "SourceSans":  ("arialbd.ttf", "SourceSansPro", "Bold"),
    "Merriweather": ("georgiab.ttf", "Merriweather", "Bold"),
    "Montserrat":  ("segoeuib.ttf", "Montserrat", "Bold"),
}
STYLE = {"font": "FredokaOne", "fontStyle": "Normal", "flat": False, "motion": {}}



def resolve_theme_path(spec_dir, theme):
    """A theme path is tried next to the spec first, then in the skill's references/.
    "default" (or a missing file) falls back to the skill's own references/theme.json."""
    skill_refs = Path(__file__).resolve().parent.parent / "references"
    for cand in (Path(spec_dir) / theme, skill_refs / theme, skill_refs / "theme.json"):
        if cand.is_file():
            return cand
    raise FileNotFoundError(f"theme {theme!r} not found next to the spec or in {skill_refs}")

def set_style(theme: dict) -> None:
    STYLE["font"] = theme.get("font", "FredokaOne") if theme.get("font") in FONTS else "FredokaOne"
    STYLE["fontStyle"] = theme.get("fontStyle", "Normal")
    STYLE["flat"] = bool(theme.get("flat", False))
    STYLE["motion"] = dict(theme.get("motion") or {})


# MOTION. A theme's
# "motion" block - and a node's own "motion" to override it, or false to opt out -
# becomes ATTRIBUTES that references/UIController.client.lua plays:
#   hover: {scale, rotate (deg, clockwise), time (s), style (EasingStyle)}
#   press: {scale, time}            the pop on click; up returns to the hover state
#   open:  {style: "pop"|"instant", from (start scale), time}   on the ScreenGui
# The PNG cannot show motion, so these are the one part of a spec the preview
# does not prove; the controller is where they are verified, in a playtest.
def motion_attrs(spec) -> dict:
    m = STYLE["motion"]
    own = spec.get("motion")
    if own is False:
        return {}
    if isinstance(own, dict):
        m = {**m, **own}
    out = {}
    h, p = m.get("hover"), m.get("press")
    if h:
        out.update({"HoverScale": float(h.get("scale", 1)), "HoverRotate": float(h.get("rotate", 0)),
                    "HoverTime": float(h.get("time", 0.1)), "HoverStyle": str(h.get("style", "Quad"))})
    if p:
        out.update({"PressScale": float(p.get("scale", 1)), "PressTime": float(p.get("time", 0.07))})
    return out


def font_face() -> dict:
    _, fam, weight = FONTS[STYLE["font"]]
    return {"Font": {"family": f"rbxasset://fonts/families/{fam}.json",
                     "weight": weight, "style": STYLE["fontStyle"]}}


def measure_heights(root_spec, theme, size):
    node = resolve(root_spec, (0, 0, size[0], size[1]), theme)
    for n in walk(node):
        RESOLVED_H[id(n.spec)] = n.rect[3]
SS = 2  # supersample factor: PIL's rounded_rectangle is aliased, so draw big


# --------------------------------------------------------------------------- colour

def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def shade(rgb, dv: float = -0.34, dh: float = 0.05, ds: float = 0.06):
    """Darken toward the shadow colour the guides actually pick.

    NOT a lerp to black. The improve-UI guide darkens the face colour AND pushes
    the hue toward blue, which is why hand-tuned Roblox UI reads warmer than a
    programmatic Color3:Lerp(c, black). A green button gets a dark blue-green
    shadow, not a dark green one.
    """
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h = (h + dh * (1 if h < 0.6 else -1)) % 1.0
    s = min(1.0, s + ds)
    v = max(0.0, v * (1 + dv))
    return tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(h, s, v))


def lighten(rgb, dv: float = 0.30):
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return tuple(int(round(c * 255))
                 for c in colorsys.hsv_to_rgb(h, max(0.0, s - 0.10), min(1.0, v + dv)))


def resolve_colour(value, palette):
    """'green' | '#RRGGBB' | ['#top', '#bottom'] -> (top_rgb, bottom_rgb)."""
    if value is None:
        return None
    if isinstance(value, str):
        value = palette.get(value, value)
    if isinstance(value, str):
        base = hex_rgb(value)
        # flat styles (solid-colour tabs) have no top-light: the gradient
        # is emitted with two equal stops, so Studio and the PNG both draw solid
        return (base, base) if STYLE["flat"] else (lighten(base, 0.14), base)
    return hex_rgb(value[0]), hex_rgb(value[1])


# A PAINTABLE face is one a controller recolours at runtime by writing
# BackgroundColor3 (a slot that greys out when unaffordable). UIGradient.Color
# MULTIPLIES the object's colour, so a gradient baked from the design colour
# would tint every runtime colour toward the design one. A paintable face gets a
# NEUTRAL gradient instead - white at the top, PAINT_SHADE grey at the bottom -
# so whatever colour the controller writes shows true, top-lit.
PAINT_SHADE = 0.86


def face_colours(spec, palette):
    """(top, bottom) as the face will actually RENDER, for the PNG."""
    col = resolve_colour(spec.get("colour", "panel"), palette)
    if col and spec.get("paintable"):
        base = col[1]
        return base, tuple(int(round(c * PAINT_SHADE)) for c in base)
    return col


# --------------------------------------------------------------------------- layout

class Node:
    __slots__ = ("spec", "rect", "children", "depth_px")

    def __init__(self, spec, rect):
        self.spec = spec
        self.rect = rect          # (x, y, w, h) floats, screen pixels
        self.children: list[Node] = []


def udim2(v, parent_w, parent_h):
    sx, ox, sy, oy = v
    return sx * parent_w + ox, sy * parent_h + oy


def resolve(spec, parent_rect, theme) -> Node:
    px, py, pw, ph = parent_rect
    w, h = udim2(spec.get("size", [1, 0, 1, 0]), pw, ph)

    ar = spec.get("aspect")           # UIAspectRatioConstraint, dominant axis = height
    if ar:
        w = h * ar

    ox_, oy_ = udim2(spec.get("pos", [0, 0, 0, 0]), pw, ph)
    ax, ay = spec.get("anchor", [0, 0])
    node = Node(spec, (px + ox_ - ax * w, py + oy_ - ay * h, w, h))

    kids = spec.get("children") or []
    if not kids:
        return node

    pad = spec.get("padding", 0)
    inner = (node.rect[0] + pad, node.rect[1] + pad,
             node.rect[2] - 2 * pad, node.rect[3] - 2 * pad)

    lay = spec.get("layout")
    if not lay:
        for k in kids:
            node.children.append(resolve(k, inner, theme))
        return node

    gap = lay.get("gap", 8)
    if lay.get("type") == "grid":
        cw, ch = lay["cell"]
        cols = lay.get("cols") or max(1, int((inner[2] + gap) // (cw + gap)))
        for i, k in enumerate(kids):
            cx = inner[0] + (i % cols) * (cw + gap)
            cy = inner[1] + (i // cols) * (ch + gap)
            node.children.append(resolve(k, (cx, cy, cw, ch), theme))
        return node

    # list
    horiz = lay.get("dir", "y") == "x"
    sizes = []
    for k in kids:
        sizes.append(udim2(k.get("size", [1, 0, 1, 0]), inner[2], inner[3]))
    total = sum(s[0] if horiz else s[1] for s in sizes) + gap * (len(kids) - 1)

    align = lay.get("align", "start")
    run = inner[0] if horiz else inner[1]
    if align == "center":
        run += ((inner[2] if horiz else inner[3]) - total) / 2
    elif align == "end":
        run += (inner[2] if horiz else inner[3]) - total

    # Cross-axis centring, because the emitted UIListLayout carries
    # VerticalAlignment=Center / HorizontalAlignment. Leaving children pinned to
    # the cross-axis start here would make the preview disagree with Studio on
    # every icon-plus-label row, which is most of a HUD.
    for k, (kw, kh) in zip(kids, sizes):
        if horiz:
            cell = (run, inner[1] + (inner[3] - kh) / 2, kw, kh)
        else:
            cell = (inner[0] + (inner[2] - kw) / 2, run, kw, kh)
        child = dict(k)
        child["pos"] = [0, 0, 0, 0]
        child["anchor"] = [0, 0]
        child["size"] = [0, kw, 0, kh]
        node.children.append(resolve(child, cell, theme))
        run += (kw if horiz else kh) + gap
    return node


def walk(node: Node):
    yield node
    for c in node.children:
        yield from walk(c)


# --------------------------------------------------------------------------- render

def load_font(size: int):
    ttf = FONTS[STYLE["font"]][0]
    if STYLE["fontStyle"] == "Italic" and ttf.endswith("bd.ttf"):
        ttf = ttf.replace("bd.ttf", "bi.ttf")
    for p in (FONT_DIR / ttf, Path("C:/Windows/Fonts") / ttf, FONT_DIR / "FredokaOne-Regular.ttf"):
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


LINE_H = 1.08  # wrapped line pitch as a multiple of the font size (Fredoka, LineHeight 1)


def wrap_lines(draw, txt, font, avail_w, stroke):
    """Greedy word wrap, which is what TextWrapped does. One word wider than the
    box stays on its own line (Roblox breaks it; the fit loop then shrinks)."""
    lines, cur = [], ""
    for word in txt.split():
        trial = f"{cur} {word}".strip()
        bb = draw.textbbox((0, 0), trial, font=font, stroke_width=stroke)
        if cur and (bb[2] - bb[0]) > avail_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines or [""]


def fit_text_size(draw, txt, font_size, box, stroke, floor=6, wrap=False):
    """Largest size <= font_size at which `txt` fits `box`. Mirrors TextScaled.

    Returned rather than clamped in place so verify_ui can call it too and report
    HOW FAR a label had to shrink, which is the number that matters.

    `wrap` mirrors TextScaled + TextWrapped: the text may break onto several lines
    and the size is the largest at which the WRAPPED block fits. A long hint on one
    line shrinks to a smear; the same hint on two lines stays readable, and a label
    that ships TextWrapped must be measured the way Roblox will lay it out.
    """
    w, h = box
    avail_w = max(1, w - 2 * stroke)
    size = int(font_size)
    while size > floor:
        f = load_font(size)
        if wrap:
            lines = wrap_lines(draw, txt, f, avail_w, stroke)
            widest = max(draw.textbbox((0, 0), ln, font=f, stroke_width=stroke)[2]
                         - draw.textbbox((0, 0), ln, font=f, stroke_width=stroke)[0]
                         for ln in lines)
            tall = size * LINE_H * (len(lines) - 1) + (
                draw.textbbox((0, 0), "Ag", font=f, stroke_width=stroke)[3]
                - draw.textbbox((0, 0), "Ag", font=f, stroke_width=stroke)[1])
            if widest <= avail_w and tall <= h:
                break
        else:
            bb = draw.textbbox((0, 0), txt, font=f, stroke_width=stroke)
            if (bb[2] - bb[0]) <= avail_w and (bb[3] - bb[1]) <= h:
                break
        size -= 1
    return max(floor, size)


def rounded(draw, box, r, fill=None, outline=None, width=0):
    x, y, w, h = box
    r = max(0, min(r, w / 2, h / 2))
    if fill is None and (outline is None or width < 0.5):
        return  # stroke 0 themes: PIL would still draw a 1px line
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill,
                           outline=outline if width >= 0.5 else None,
                           width=max(1, int(round(width))))


def v_gradient(size, top, bottom):
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    g = Image.new("RGB", (1, h))
    px = g.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(round(top[i] + (bottom[i] - top[i]) * t)) for i in range(3))
    return g.resize((w, h))


def _pattern(img, s, box, r, palette, surface_alpha=0.0):
    """The texture layer (patterns.py): tinted, faded, clipped to the face.

    Spec: "pattern": {"name": "clouds", "colour": "#FFFFFF", "opacity": 0.2,
                      "tile": 128, "fade": "right"}
    Emitted as an ImageLabel with the SAME numbers, so the PNG and the model agree.
    """
    p = s.get("pattern")
    if not p:
        return
    x, y, w, h = box
    W, H = int(w), int(h)
    if W <= 0 or H <= 0:
        return
    t = _patterns.tile(p["name"])
    if p["name"] in _patterns.STRETCH:
        layer = t.resize((W, H), Image.LANCZOS)
    else:
        ts = max(4, int(p.get("tile", 128) * SS))
        tt = t.resize((ts, ts), Image.LANCZOS)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for yy in range(0, H, ts):
            for xx in range(0, W, ts):
                layer.alpha_composite(tt, (xx, yy))
    colour = resolve_colour(p.get("colour", "#FFFFFF"), palette)[1]
    tint = Image.new("RGBA", (W, H), colour + (255,))
    alpha = layer.getchannel("A").point(lambda v, o=float(p.get("opacity", 0.2)): int(v * o))
    fade = p.get("fade", "none")
    if fade != "none":
        ramp = Image.linear_gradient("L").rotate({"right": 90, "left": -90, "down": 180, "up": 0}[fade])
        alpha = Image.composite(alpha, Image.new("L", (W, H), 0), ramp.resize((W, H)))
    mask = Image.new("L", (W, H), 0)
    rounded(ImageDraw.Draw(mask), (0, 0, w - 1, h - 1), r, fill=255)
    if surface_alpha > 0:
        mask = mask.point(lambda v, a=surface_alpha: int(v * (1 - a)))
    alpha = Image.composite(alpha, Image.new("L", (W, H), 0), mask)
    tint.putalpha(alpha)
    img.alpha_composite(tint, (int(x), int(y)))


def draw_node(img, draw, node, theme, palette, icons):
    s = node.spec
    kind = s.get("type", "frame")
    x, y, w, h = (v * SS for v in node.rect)
    if w <= 0 or h <= 0:
        return

    stroke = theme["stroke"] * SS
    corner = s.get("corner", theme["corner"])
    r = corner * min(w, h) if corner <= 1 else corner * SS
    dark = hex_rgb(theme["outline"])

    if kind == "label":
        _text(img, draw, s, (x, y, w, h), theme, palette)
        return
    if kind == "icon":
        _icon(img, s, (x, y, w, h), icons)
        return
    if kind == "frame":
        col = resolve_colour(s.get("colour"), palette)
        if col and not s.get("transparent"):
            face = v_gradient((w, h), *col)
            mask = Image.new("L", (int(w), int(h)), 0)
            rounded(ImageDraw.Draw(mask), (0, 0, w - 1, h - 1), r, fill=255)
            # `alpha` is BackgroundTransparency, 0 opaque to 1 invisible. Added
            # for the one case a boolean `transparent` cannot express: a modal
            # SCRIM, which has to dim the 3D world without hiding it. Emitted as
            # the real property, so the PNG and the .model.json still agree.
            a = float(s.get("alpha", 0.0))
            if a > 0:
                mask = mask.point(lambda v, a=a: int(v * (1 - a)))
            img.paste(face, (int(x), int(y)), mask)
            _pattern(img, s, (x, y, w, h), r, palette, a)
            if s.get("outline", True):
                rounded(draw, (x, y, w, h), r, outline=dark, width=stroke)
        return

    # panel / button / pill: the depth stack
    col = face_colours(s, palette)
    off = s.get("depth", theme["shadowOffset"]) * SS
    sh = shade(resolve_colour(s.get("colour", "panel"), palette)[1])

    if off:
        rounded(draw, (x, y + off, w, h), r, fill=sh, outline=dark, width=stroke)

    face = v_gradient((w, h), *col)
    mask = Image.new("L", (int(w), int(h)), 0)
    rounded(ImageDraw.Draw(mask), (0, 0, w - 1, h - 1), r, fill=255)
    a = float(s.get("alpha", 0.0))  # translucent panels (glass-style panels)
    if a > 0:
        mask = mask.point(lambda v, a=a: int(v * (1 - a)))
    img.alpha_composite(Image.composite(face.convert("RGBA"), Image.new("RGBA", face.size, (0, 0, 0, 0)), mask),
                        (int(x), int(y)))
    _pattern(img, s, (x, y, w, h), r, palette, a)
    rounded(draw, (x, y, w, h), r, outline=dark, width=stroke)

    if s.get("highlight", theme.get("highlight", False)):
        inset = stroke * 1.6
        rounded(draw, (x + inset, y + inset, w - 2 * inset, h - 2 * inset),
                max(0, r - inset), outline=lighten(col[0], 0.34), width=max(1, stroke // 2))

    # The button's own label, drawn ON the depth stack. The emitter grew a
    # matching TextLabel at the same time; if only one of the two had been fixed
    # the preview would once again disagree with what ships, which is the single
    # thing this file exists to prevent.
    if kind == "button" and str(s.get("text", "")):
        _text(img, draw, {**s, "align": "center"}, (x, y, w, h), theme, palette)


def _icon(img, s, box, icons):
    x, y, w, h = box
    name = s["icon"]
    p = icons.get(name)
    if not p:
        return
    side = int(min(w, h))
    if side <= 0:
        return
    im = Image.open(p).convert("RGBA").resize((side, side), Image.LANCZOS)
    if s.get("shadow", True):
        # The generated icon deliberately carries NO drop shadow, so it is added
        # here, once, with one light direction for the whole screen.
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sh.putalpha(im.getchannel("A").point(lambda a: int(a * 0.34)))
        img.alpha_composite(sh, (int(x + (w - side) / 2), int(y + (h - side) / 2 + side * 0.05)))
    img.alpha_composite(im, (int(x + (w - side) / 2), int(y + (h - side) / 2)))


def _text(img, draw, s, box, theme, palette):
    x, y, w, h = box
    txt = str(s.get("text", ""))
    if not txt:
        return
    size = int(h * s.get("textScale", 0.62))
    if size < 6:
        return
    font = load_font(size)
    colour = resolve_colour(s.get("textColour", "#FFFFFF"), palette)[1]

    # Stroke thickness is EXPLICIT in the spec, never derived from the rendered
    # glyph size. Roblox sets UIStroke.Thickness in pixels while TextScaled
    # changes the glyph size at runtime, so any derivation here would be a number
    # the .model.json cannot reproduce. 0 means no stroke, which is the right
    # answer for small dark text on a light panel - the theme's 4 is a heading
    # value and it turns 24px body text to mud.
    sw = int(round(s.get("textStroke", theme["textStroke"]) * SS))

    if s.get("wrap"):
        size = fit_text_size(draw, txt, font_size=size, box=(w, h), stroke=sw, wrap=True)
        font = load_font(size)
        lines = wrap_lines(draw, txt, font, max(1, w - 2 * sw), sw)
        ref = draw.textbbox((0, 0), "Ag", font=font, stroke_width=sw)
        block = size * LINE_H * (len(lines) - 1) + (ref[3] - ref[1])
        top = y + (h - block) / 2 - ref[1]
        align = s.get("align", "center")
        for i, ln in enumerate(lines):
            bb = draw.textbbox((0, 0), ln, font=font, stroke_width=sw)
            tw = bb[2] - bb[0]
            tx = {"center": x + (w - tw) / 2, "left": x, "right": x + w - tw}[align]
            draw.text((tx - bb[0], top + i * size * LINE_H), ln, font=font, fill=colour,
                      stroke_width=sw, stroke_fill=hex_rgb(theme["outline"]))
        return

    # SHRINK TO FIT, because that is what TextScaled does.
    #
    # Drawing at height*textScale regardless of WIDTH let the PNG show text
    # spilling out of a box that Roblox would silently have shrunk - the preview
    # was pessimistic where Studio was fine, and it hid the real problem, which is
    # not overflow but ILLEGIBILITY: TextScaled will happily shrink to unreadable
    # rather than overflow. verify_ui's text_fit check measures that shrink and
    # fails when it goes too far.
    size = fit_text_size(draw, txt, font_size=size, box=(w, h), stroke=sw)
    font = load_font(size)

    # Centre on the INK, not the em box. Fredoka's ascent leaves a large gap above
    # the caps, so centring on the nominal size lifts every label off centre and
    # clips the tall glyphs.
    bbox = draw.textbbox((0, 0), txt, font=font, stroke_width=sw)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    align = s.get("align", "center")
    tx = {"center": x + (w - tw) / 2, "left": x, "right": x + w - tw}[align]
    draw.text((tx - bbox[0], y + (h - th) / 2 - bbox[1]), txt, font=font,
              fill=colour, stroke_width=sw, stroke_fill=hex_rgb(theme["outline"]))


def render(root: Node, theme, palette, icons, size) -> Image.Image:
    w, h = int(size[0] * SS), int(size[1] * SS)
    bd = theme.get("backdrop", "#7FB2E5")
    if theme.get("backdropImage"):
        # PREVIEW ONLY: a screenshot of your own game world, so the UI is
        # judged over the scene it has to sit on. Never emitted - a ScreenGui has
        # no backdrop; the 3D world is behind it.
        img = Image.open(theme["backdropImage"]).convert("RGBA").resize((w, h), Image.LANCZOS)
    elif isinstance(bd, list):
        img = v_gradient((w, h), hex_rgb(bd[0]), hex_rgb(bd[1])).convert("RGBA")
    else:
        img = Image.new("RGBA", (w, h), hex_rgb(bd) + (255,))
    draw = ImageDraw.Draw(img)

    # Painter's order follows the TREE. z only reorders SIBLINGS. Sorting every
    # node by a flat z instead puts a z=0 child behind its own z=5 parent, which
    # renders as the child silently vanishing - and the .model.json, where ZIndex
    # is genuinely global under Sibling behaviour, would then disagree with the
    # preview. Keeping z sibling-local is what keeps the two consistent.
    # ROTATION IS RENDERED HERE AND EMITTED IN to_instances, IN THE SAME CHANGE.
    # Added 2026-09-09 for the held-trigger cast HUD, whose panels sit on an arc.
    # Before this, `rotation` was a key verify_ui knew about (it checks the
    # ClipsDescendants trap) and ui_build silently DROPPED - so a spec asking for
    # an arc produced a flat row in the PNG *and* a flat row in the .model.json.
    # The two agreed, which is exactly why it would have shipped: the preview
    # cannot flag a value neither half of the pipeline implements.
    #
    # A rotated node takes its whole subtree with it, which is Roblox's own
    # behaviour, so the subtree is painted to its own transparent layer and the
    # layer is rotated about the node's centre. PIL rotates counter-clockwise and
    # Roblox's Rotation is clockwise, hence the negation.
    def paint(n, target, tdraw):
        if n.spec.get("type") != "root":
            draw_node(target, tdraw, n, theme, palette, icons)
        for c in sorted(n.children, key=lambda k: k.spec.get("z", 0)):
            rot = float(c.spec.get("rotation", 0) or 0)
            if not rot:
                paint(c, target, tdraw)
                continue
            layer = Image.new("RGBA", target.size, (0, 0, 0, 0))
            paint(c, layer, ImageDraw.Draw(layer))
            cx = (c.rect[0] + c.rect[2] / 2) * SS
            cy = (c.rect[1] + c.rect[3] / 2) * SS
            target.alpha_composite(
                layer.rotate(-rot, resample=Image.BICUBIC, center=(cx, cy)))

    paint(root, img, draw)
    return img.resize((int(size[0]), int(size[1])), Image.LANCZOS)


# --------------------------------------------------------------------------- roblox

def udim2_tag(v):
    sx, ox, sy, oy = v
    return {"UDim2": [[sx, int(round(ox))], [sy, int(round(oy))]]}


def col3(rgb):
    return {"Color3": [round(c / 255, 4) for c in rgb]}


def instance(name, cls, props=None, children=None, attributes=None):
    n = {"className": cls}
    if name:
        n["name"] = name
    if props:
        n["properties"] = props
    if attributes:
        n["attributes"] = attributes
    if children:
        n["children"] = children
    return n


def to_instances(spec, theme, palette, counter=None):
    """Spec node -> a list of Rojo .model.json nodes.

    One spec element can become several instances: the depth stack is a Shadow
    frame, a Face frame and a Highlight frame, which is exactly what a person
    builds by hand in the guides.
    """
    counter = counter if counter is not None else [0]
    kind = spec.get("type", "frame")
    counter[0] += 1
    name = spec.get("name") or f"{kind.capitalize()}{counter[0]}"
    size, pos = spec.get("size", [1, 0, 1, 0]), spec.get("pos", [0, 0, 0, 0])
    anchor = spec.get("anchor", [0, 0])
    z = spec.get("z", 0)

    base = {"Size": udim2_tag(size), "Position": udim2_tag(pos),
            "AnchorPoint": {"Vector2": anchor}, "ZIndex": z}

    # The emitter half of the rotation change described in render(). Only
    # written when non-zero, so every existing spec stays byte-identical.
    if float(spec.get("rotation", 0) or 0):
        base["Rotation"] = float(spec["rotation"])

    # `visible: false` ships an element hidden. Only emitted when explicitly
    # asked for, so every existing spec is byte-identical to before.
    #
    # Added 2026-08-31: a result banner had no way to ship hidden, so it appeared
    # for the quarter-second before the first state push reached the controller
    # and hid it. The PNG renderer keeps drawing it on purpose - a mockup exists
    # to show you the element, and a hidden one you cannot see is not a preview.
    # That is the one place the "same tree" guarantee is deliberately relaxed.
    if spec.get("visible") is False:
        base["Visible"] = False

    kids = []
    for order, k in enumerate(spec.get("children") or []):
        made = to_instances(k, theme, palette, counter)
        # LAYOUTORDER IS NOT OPTIONAL under a UIListLayout or UIGridLayout.
        # SortOrder is LayoutOrder and every child defaulted to 0, so Roblox was
        # free to order them however it liked - the shop grid came back as
        # Tomato, Wheat, Carrot, Pumpkin against a spec that says Wheat, Carrot,
        # Tomato, Pumpkin. The PNG renderer walks the children in spec order and
        # therefore never showed it: another case where the two agreed on every
        # value and disagreed on arrangement.
        if made and spec.get("layout"):
            made[0].setdefault("properties", {})["LayoutOrder"] = order
        kids.extend(made)

    if spec.get("layout"):
        kids.insert(0, _layout_instance(spec["layout"]))
    if spec.get("padding"):
        p = {"UDim": [0, int(spec["padding"])]}
        kids.insert(0, instance("Padding", "UIPadding", {
            "PaddingTop": p, "PaddingBottom": p, "PaddingLeft": p, "PaddingRight": p}))
    depth_stack = kind in ("panel", "button")
    if spec.get("aspect") and not depth_stack:
        kids.insert(0, instance("Aspect", "UIAspectRatioConstraint",
                                {"AspectRatio": spec["aspect"],
                                 "DominantAxis": "Height"}))

    if kind == "label":
        tstroke = spec.get("textStroke", theme["textStroke"])
        return [instance(name, "TextLabel", {
            **base, "BackgroundTransparency": 1,
            "Text": str(spec.get("text", "")), "TextScaled": True,
            "FontFace": font_face(),
            "TextColor3": col3(resolve_colour(spec.get("textColour", "#FFFFFF"), palette)[1]),
            "TextXAlignment": {"center": "Center", "left": "Left",
                               "right": "Right"}[spec.get("align", "center")],
            **({"TextWrapped": True} if spec.get("wrap") else {}),
        }, ([_stroke(tstroke, theme["outline"], "Bevel")] if tstroke else [])
           + _text_cap(spec) + kids)]

    if kind == "icon":
        # A real asset id when one is known, a NAMED placeholder otherwise. The
        # placeholder is deliberately not a valid id: a wrong-but-valid id renders
        # some other creator's image and reads as a design mistake, whereas this
        # renders nothing and greps out of the file in one line.
        asset = ICON_IDS.get(spec["icon"])
        props = {**base, "BackgroundTransparency": 1, "ScaleType": "Fit",
                 "Image": f"rbxassetid://{asset}" if asset else ""}
        # An EMPTY image, not a fake id: an invalid rbxassetid spams the output
        # with load failures while empty renders nothing quietly. The ATTRIBUTE is
        # what makes the gap findable - and it has to be a real Rojo `attributes`
        # field, not a property called "Attributes", which Rojo rejects outright.
        # THE ATTRIBUTE IS CLEARED, NOT OMITTED, once the id is known.
        #
        # Rojo updates a PROPERTY that changed in source but does not necessarily
        # remove an ATTRIBUTE that has disappeared from it, so emitting nothing
        # here left a resolved icon still carrying PendingIcon="move_e" from an
        # earlier unresolved build - a live pass then reports a placeholder that
        # was fixed hours ago, and the next person believes the report. Writing
        # the empty string overwrites the stale value on the same sync.
        # IconName is ALWAYS emitted, resolved or not. It is what lets the icon
        # id be applied at RUNTIME instead of travelling through Rojo - see
        # strip_content_for_rojo below for why that became necessary.
        attrs = {"PendingIcon": spec["icon"] if not asset else "",
                 "IconName": spec["icon"]}
        return [instance(name, "ImageLabel", props, kids, attributes=attrs)]

    # A transparent frame needs no colour. Resolving one first crashed every theme
    # without a "panel" key (the default theme always had one).
    if kind == "frame" and (spec.get("transparent") or not spec.get("colour")):
        return [instance(name, "Frame", {**base, "BackgroundTransparency": 1}, kids)]
    col = resolve_colour(spec.get("colour", "panel"), palette)
    corner = spec.get("corner", theme["corner"])
    corner_inst = instance("Corner", "UICorner",
                           {"CornerRadius": {"UDim": [corner if corner <= 1 else 0,
                                                      0 if corner <= 1 else int(corner)]}})

    if kind == "frame":
        props = {**base}
        if spec.get("transparent") or not spec.get("colour"):
            props["BackgroundTransparency"] = 1
            return [instance(name, "Frame", props, kids)]
        # WHITE under the gradient: UIGradient.Color MULTIPLIES the background, so
        # the base colour here plus a base-to-light gradient rendered base*base in
        # Studio - darker and more saturated than the PNG, which draws the
        # gradient's own colours. White x gradient = the gradient, which is what
        # the renderer shows.
        props["BackgroundColor3"] = col3((255, 255, 255))
        if spec.get("alpha"):
            props["BackgroundTransparency"] = float(spec["alpha"])
        extra = [corner_inst, _gradient(col)]
        if spec.get("outline", True):
            extra.append(_stroke(theme["stroke"], theme["outline"]))
        return [instance(name, "Frame", props,
                         extra + _patterned(spec, palette, corner_inst, z, kids))]

    # DEPTH STACK, WRAPPED. The shadow and the face MUST live inside a container
    # that is itself the single layout item.
    #
    # THE BUG THIS FIXES, and only a Studio render could show it: emitting Shadow
    # and Face as SIBLINGS works fine when the parent positions children by
    # Position, and breaks completely under a UIListLayout or UIGridLayout, which
    # lays out EVERY child - so four tabs became eight cells, each shadow claiming
    # its own slot, and the row overflowed the panel. The PNG renderer draws the
    # shadow as a paint operation rather than a node, so it never saw the
    # duplication. Same tree, different instance COUNT: that is the one way the
    # preview and the emitted model could still disagree, and this closes it.
    #
    # For a button the WRAPPER is the TextButton, so the clickable region is the
    # whole element and a scripter finds it under the name they asked for, with
    # Shadow and Face as inert decoration inside it.
    # THREE OPTIONS, all for the same reason: a controller that already binds to
    # this UI BY NAME decides which instance must carry the name.
    #
    #   wrapperClass  "TextButton" (default) or "ImageButton". A controller that
    #                 writes `.Text` on whatever it found writes the WRAPPER's own
    #                 text - which renders BEHIND the Face, invisibly - while the
    #                 caption the player sees stays stale. An ImageButton has no
    #                 Text, so such a controller falls through to a child called
    #                 "Text" instead (pair it with captionName "Text").
    #   captionName   the name of the caption TextLabel (default "Label").
    #   selfFace      the NAMED instance is the FACE button itself, and the shadow
    #                 moves to a transparent `<name>Cell` frame around it. For a
    #                 control whose controller recolours it by writing
    #                 BackgroundColor3/BackgroundTransparency on the named node: on
    #                 the default wrapper that paints a square box behind the
    #                 rounded face. Pair with "paintable": true so the gradient is
    #                 neutral and the runtime colour shows true.
    # The PNG draws all of these identically - they change which instance holds
    # the name, not a pixel - so the preview and the model still agree.
    off = spec.get("depth", theme["shadowOffset"])
    is_button = kind == "button"
    cls = spec.get("wrapperClass", "TextButton") if is_button else "Frame"
    self_face = bool(spec.get("selfFace"))
    if spec.get("paintable"):
        grey = int(round(255 * PAINT_SHADE))
        grad = _gradient(((255, 255, 255), (grey, grey, grey)))
        face_bg = col3(col[1])
    else:
        # WHITE under the gradient: UIGradient.Color MULTIPLIES the background
        # colour. See the note on `frame` above.
        grad = _gradient(col)
        face_bg = col3((255, 255, 255))

    def button_props(props):
        if cls == "TextButton":
            props.update({"Text": "", "AutoButtonColor": False})
        elif cls == "ImageButton":
            props.update({"AutoButtonColor": False})
        return props

    shadow = None
    if off:
        shadow = instance("Shadow", "Frame", {
            "Size": {"UDim2": [[1, 0], [1, 0]]},
            "Position": {"UDim2": [[0, 0], [0, int(off)]]},
            "ZIndex": z, "BackgroundColor3": col3(shade(col[1])),
        }, [corner_inst, _stroke(theme["stroke"], theme["outline"])])

    face_kids = [corner_inst, grad, _stroke(theme["stroke"], theme["outline"])]

    # The highlight is a SIBLING of the face, not a child of it.
    #
    # Same bug as the shadow, one level down and it survived the first fix: a
    # UIListLayout lays out every GuiObject child, so a decorative Highlight frame
    # inside the face claimed a slot in the row and shoved the price text out past
    # the button. UICorner, UIGradient and UIStroke are not GuiObjects so the
    # layout ignores them - only a Frame is caught, which is exactly why this one
    # was easy to miss and only a Studio render showed it.
    highlight = None
    if spec.get("highlight", theme.get("highlight", False)):
        t = theme["stroke"]
        highlight = instance("Highlight", "Frame", {
            "Size": {"UDim2": [[1, -int(3.2 * t)], [1, -int(3.2 * t)]]},
            "Position": {"UDim2": [[0.5, 0], [0.5, 0]]},
            "AnchorPoint": {"Vector2": [0.5, 0.5]},
            "BackgroundTransparency": 1, "ZIndex": z + 3,
        }, [corner_inst, _stroke(max(1, t // 2), None, colour=lighten(col[0], 0.34))])

    # A BUTTON'S LABEL. Without this a `button` node carrying "text" emitted a
    # TextButton whose Text was hard-coded to "" and no label anywhere, so every
    # button in the game shipped as a blank coloured rectangle - STABLE, the shop
    # prices and LEAVE FOR THE PASS all invisible. The mockup agreed with the
    # model because both are built from this same tree, and verify_ui.py passed
    # it because that checks LAYOUT, not content. Caught 2026-09-09 by reading
    # the emitted model.json rather than by any gate.
    #
    # The label is a SIBLING of the face rather than a child of it, for the same
    # reason the highlight is: a UIListLayout lays out every GuiObject child, so
    # a label inside the face would claim a layout slot and shove the content out.
    caption = None
    if is_button and str(spec.get("text", "")):
        tstroke = spec.get("textStroke", theme["textStroke"])
        caption = instance(spec.get("captionName", "Label"), "TextLabel", {
            "Size": {"UDim2": [[1, 0], [1, 0]]},
            "Position": {"UDim2": [[0, 0], [0, 0]]},
            "ZIndex": z + 2, "BackgroundTransparency": 1,
            "Text": str(spec["text"]), "TextScaled": True,
            "FontFace": font_face(),
            "TextColor3": col3(resolve_colour(spec.get("textColour", "#FFFFFF"), palette)[1]),
            "TextXAlignment": "Center",
            **({"TextWrapped": True} if spec.get("wrap") else {}),
        }, ([_stroke(tstroke, theme["outline"], "Bevel")] if tstroke else []) + _text_cap(spec))

    aspect = None
    if spec.get("aspect"):
        aspect = instance("Aspect", "UIAspectRatioConstraint",
                          {"AspectRatio": spec["aspect"], "DominantAxis": "Height"})

    attrs = motion_attrs(spec) if is_button else {}
    if spec.get("opens"):
        attrs["OpensPage"] = spec["opens"]
    if spec.get("closes"):
        attrs["ClosesPage"] = True
    if spec.get("toggles"):
        attrs["TogglesPage"] = spec["toggles"]

    if self_face:
        # The named node IS the face: the controller's BackgroundColor3 write lands
        # on the rounded, stroked, gradient-lit surface the player sees. Children
        # (content, caption) render above its own background, as a face's should.
        face_props = button_props({
            "Size": {"UDim2": [[1, 0], [1, 0]]},
            "Position": {"UDim2": [[0, 0], [0, 0]]},
            "ZIndex": z + 1, "BackgroundColor3": face_bg,
            **({"BackgroundTransparency": float(spec["alpha"])} if spec.get("alpha") else {})})
        face = instance(name, cls, face_props,
                        face_kids + _patterned(spec, palette, corner_inst, z, kids)
                        + [c for c in (caption, highlight) if c],
                        attributes=attrs or None)
        cell = [c for c in (aspect, shadow) if c] + [face]
        return [instance(spec.get("cellName", f"{name}Cell"), "Frame",
                         {**base, "BackgroundTransparency": 1}, cell)]

    # DEPTH STACK, WRAPPED (the default). The shadow and the face MUST live inside
    # a container that is itself the single layout item: emitted as SIBLINGS, a
    # UIListLayout gave each shadow its own cell and four tabs became eight. For a
    # button the wrapper IS the button, so the clickable region is the whole
    # element and a scripter finds it under the name they asked for.
    wrapper_props = button_props({**base, "BackgroundTransparency": 1})
    inner = [c for c in (aspect, shadow) if c]
    # Padding, layout and the content all belong to the FACE, because that is the
    # rect the content is meant to sit inside.
    inner.append(instance("Face", "Frame", {
        "Size": {"UDim2": [[1, 0], [1, 0]]},
        "Position": {"UDim2": [[0, 0], [0, 0]]},
        "ZIndex": z + 1, "BackgroundColor3": face_bg,
        **({"BackgroundTransparency": float(spec["alpha"])} if spec.get("alpha") else {}),
    }, face_kids + _patterned(spec, palette, corner_inst, z, kids)))
    inner += [c for c in (caption, highlight) if c]
    return [instance(name, cls, wrapper_props, inner, attributes=attrs or None)]


def _text_cap(spec):
    """Cap TextScaled at the size the PNG was designed to.

    TextScaled fills the WHOLE label box while the renderer draws at
    height * textScale, so Studio text comes out visibly larger. A
    UITextSizeConstraint keeps TextScaled's shrink-to-fit behaviour - which is what
    stops long text overflowing - and caps the grown size at the designed one.

    The height comes from RESOLVED_H, filled by resolving the tree at the
    reference resolution before emitting. The first version only handled labels
    whose height was pure offset, which silently skipped every scale-sized label -
    the shop tabs among them, and they were the most visibly wrong things on the
    screen.
    """
    h = RESOLVED_H.get(id(spec))
    if h is None:
        size = spec.get("size", [1, 0, 1, 0])
        if size[2] != 0 or not size[3]:
            return []
        h = abs(size[3])
    px = int(h * spec.get("textScale", 0.62))
    if px < 6:
        return []
    return [instance("SizeCap", "UITextSizeConstraint", {"MaxTextSize": px})]


FADE_ROTATION = {"right": 0, "left": 180, "down": 90, "up": -90}


def _patterned(spec, palette, corner_inst, z, kids):
    """Pattern layer + content, for a surface that has a pattern.

    THE LAYOUT TRAP AGAIN: the pattern is an ImageLabel, a GuiObject, so inside a
    face with a UIListLayout it would be laid out as one more item - the same bug
    that made four tabs render as eight. So a patterned surface holds the Pattern
    and a transparent "Content" frame, and the padding, layout and children move
    into Content. Without a pattern nothing changes, so existing name contracts
    hold; with one, a controller must find children recursively (FindFirstChild
    with recursive=true), which every controller in this skill already does.
    """
    p = spec.get("pattern")
    if not p:
        return kids
    stretch = p["name"] in _patterns.STRETCH
    key = f"pattern_{p['name']}"
    asset = ICON_IDS.get(key)
    props = {"Size": {"UDim2": [[1, 0], [1, 0]]}, "BackgroundTransparency": 1,
             "ZIndex": z + 1, "Image": f"rbxassetid://{asset}" if asset else "",
             "ImageColor3": col3(resolve_colour(p.get("colour", "#FFFFFF"), palette)[1]),
             "ImageTransparency": round(1 - float(p.get("opacity", 0.2)), 3),
             "ScaleType": "Stretch" if stretch else "Tile"}
    if not stretch:
        t = int(p.get("tile", 128))
        props["TileSize"] = {"UDim2": [[0, t], [0, t]]}
    pk = [corner_inst]
    fade = p.get("fade", "none")
    if fade != "none":
        pk.append(instance("Fade", "UIGradient", {
            "Rotation": FADE_ROTATION[fade],
            "Transparency": {"NumberSequence": {"keypoints": [
                {"time": 0, "value": 1, "envelope": 0},
                {"time": 1, "value": 0, "envelope": 0}]}}}))
    pattern = instance("Pattern", "ImageLabel", props, pk,
                       attributes=None if asset else {"PatternName": key})
    content = instance("Content", "Frame", {"Size": {"UDim2": [[1, 0], [1, 0]]},
                                            "BackgroundTransparency": 1, "ZIndex": z + 1}, kids)
    return [pattern, content]


def _gradient(col):
    top, bottom = col
    return instance("Gradient", "UIGradient", {
        "Rotation": -90,
        "Color": {"ColorSequence": {"keypoints": [
            {"time": 0, "color": col3(bottom)["Color3"]},
            {"time": 1, "color": col3(top)["Color3"]}]}},
    })


def _stroke(thickness, outline_hex, join=None, colour=None):
    props = {"Thickness": thickness, "ApplyStrokeMode": "Border",
             "Color": col3(colour if colour else hex_rgb(outline_hex))}
    if join:
        props["LineJoinMode"] = join
    return instance("Stroke", "UIStroke", props)


def _layout_instance(lay):
    if lay.get("type") == "grid":
        cw, ch = lay["cell"]
        gap = lay.get("gap", 8)
        return instance("Layout", "UIGridLayout", {
            "CellSize": {"UDim2": [[0, int(cw)], [0, int(ch)]]},
            "CellPadding": {"UDim2": [[0, int(gap)], [0, int(gap)]]},
            "SortOrder": "LayoutOrder"})
    return instance("Layout", "UIListLayout", {
        "FillDirection": "Horizontal" if lay.get("dir") == "x" else "Vertical",
        "Padding": {"UDim": [0, int(lay.get("gap", 8))]},
        "SortOrder": "LayoutOrder",
        "HorizontalAlignment": {"start": "Left", "center": "Center",
                                "end": "Right"}[lay.get("align", "start")],
        "VerticalAlignment": "Center"})


# --------------------------------------------------------------------------- luau

def luau(root):
    """The ScreenGui instance tree as a script that builds it in place.

    Same transport choice as ul-animation's to_roblox.py, and for the same
    reason: a UI tree is dozens of instances, so execute_luau needs no Rojo
    session and no plugin, and there is no live connection to wedge.

    IT TAKES THE WHOLE ROOT, the same dict the .model.json is written from. The
    root's properties used to be hardcoded here while the .model.json path set
    `Enabled` from the page kind - installed through Rojo you got a hidden page,
    installed through execute_luau every page was Enabled at once. Later the
    CanvasFrame was missing from this path too. Emitting from the one root makes
    both impossible.

    A same-named ScreenGui already in StarterGui is replaced, so re-pasting a
    page does not stack two copies.
    """
    name = root["name"]
    lines = ["-- generated by ui_build.py; paste into execute_luau",
             "local StarterGui = game:GetService('StarterGui')",
             f"local old = StarterGui:FindFirstChild('{name}')",
             "if old then old:Destroy() end",
             ""]
    idx = [0]

    def emit(node, parent):
        idx[0] += 1
        v = f"o{idx[0]}"
        lines.append(f"local {v} = Instance.new('{node['className']}')")
        if node.get("name"):
            lines.append(f"{v}.Name = {lua_value(node['name'], prop='Name')}")
        for k, val in (node.get("properties") or {}).items():
            lines.append(f"{v}.{k} = {lua_value(val, prop=k)}")
        for k, val in (node.get("attributes") or {}).items():
            # An attribute can NEVER be an Enum - SetAttribute does not accept
            # one - so the enum guess must not run here at all.
            lines.append(f'{v}:SetAttribute("{k}", {lua_value(val, is_attribute=True)})')
        if parent:
            lines.append(f"{v}.Parent = {parent}")
        for c in node.get("children") or []:
            emit(c, v)
        return v

    top = emit(root, None)
    lines += ["", f"{top}.Parent = StarterGui",
              f"print('[ui] built {name} with', #{top}:GetDescendants(), 'descendants')"]
    return "\n".join(lines)


# Properties whose value is ALWAYS a plain string, never an enum shorthand.
# Deciding by property name is the only correct way: an all-caps label like
# "VICTORY" is indistinguishable from an enum member by shape alone, and the old
# value-shape heuristic turned it into `Enum.VICTORY`.
STRING_PROPS = {
    "Text", "Image", "Name", "PlaceholderText", "TextureID", "Texture",
    "SoundId", "Value", "Title", "ImageRectOffset", "ContentId",
}

# An enum shorthand is one or more CamelCase tokens joined by dots. BOTH forms
# occur in a spec: the bare member ("Fit", "Sibling") and the fully qualified
# path ("ApplyStrokeMode.Border", "TextXAlignment.Center"), because Enum.<v>
# produces valid Luau either way. An earlier version of this pattern allowed
# only the bare form, which sent every qualified enum down the string branch and
# made Roblox reject it at ASSIGN time with
#   Unable to assign property ApplyStrokeMode. Invalid value
#   "ApplyStrokeMode.Border" for enum ApplyStrokeMode
# - a failure that parses cleanly and only shows up when the script actually runs.
_ENUM_TOKEN = __import__("re").compile(r"^[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$")


# Content-typed properties CANNOT travel through a live Rojo session.
#
# Measured 2026-09-06, with the exact error kept because the symptom is so
# misleading: connecting a session died with
#
#   RbxDom.EncodedValue:196: unexpected Content value 'rbxassetid://1234567890'
#
# and NOTHING synced - no code, no GUI, an untouched place. `rojo build` (the
# Rust CLI) accepts the same file happily, so every offline gate passed. The
# mismatch is between the CLI's encoder and the PLUGIN's bundled Lua decoder for
# Roblox's newer Content type, and it is not fixable from the spec: tagging it as
# {"Content": "..."} fails identically, because the CLI re-encodes it either way.
#
# So the .model.json - the file Rojo serves - carries NO Content property at all.
# The icon's NAME rides along as an attribute instead, and the id is applied at
# runtime from a generated bank. The PNG mockup and the Luau builder are
# unaffected and still carry the real id.
CONTENT_PROPS = {"Image", "TextureID", "Texture", "SoundId", "MeshId", "ContentId"}


# WHICH LAYER DRAWS ON TOP. Every ScreenGui shipped at DisplayOrder 0, which
# does not mean "in spec order" - it means UNDEFINED, and Roblox is free to
# draw a modal page underneath the HUD. It did: the fighter-select scrim
# rendered BELOW the round timer, so a "NEXT ROUND / 0:06" panel sat on top of
# "CHOOSE YOUR FIGHTER" and the select screen read as broken UI rather than as
# a modal. Nothing catches this offline - the tree is correct, the mockup is
# correct (it composites in spec order), and only the engine disagrees.
#
# The order is the obvious one: the HUD is the floor, transient overlays sit
# above it, and a modal page that takes input covers everything.
DISPLAY_ORDER = {"hud": 1, "overlay": 5, "page": 10}


def strip_content_for_rojo(node):
    """Remove Content-typed properties from the tree Rojo will serve, in place."""
    if not isinstance(node, dict):
        return node
    props = node.get("properties")
    if isinstance(props, dict):
        for k in list(props):
            if k in CONTENT_PROPS:
                props.pop(k)
    for child in node.get("children") or []:
        strip_content_for_rojo(child)
    return node


def lua_value(v, prop: str | None = None, is_attribute: bool = False):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        # THREE REASONS A STRING IS NEVER AN ENUM, all of which shipped invalid
        # Luau before this was fixed (2026-09-05, four of five screens failed to
        # COMPILE with "Expected identifier, got ')'"):
        #   1. An EMPTY string. "" passed every clause of the old shape
        #      heuristic and emitted the bare token `Enum.`, which is a syntax
        #      error. It reached the emitter through Text="" and, ironically,
        #      through the PendingIcon="" that exists to overwrite a stale Rojo
        #      attribute - so the fix for one defect created another.
        #   2. An ATTRIBUTE. SetAttribute cannot take an Enum at all.
        #   3. A property that is always textual - see STRING_PROPS.
        if not v or is_attribute or prop in STRING_PROPS:
            return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
        # A bare string property is either a real string or an enum shorthand.
        if "://" in v or " " in v or not _ENUM_TOKEN.match(v):
            return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
        return f"Enum.{v}"
    if isinstance(v, dict):
        if "UDim2" in v:
            (sx, ox), (sy, oy) = v["UDim2"]
            return f"UDim2.new({sx}, {ox}, {sy}, {oy})"
        if "UDim" in v:
            s, o = v["UDim"]
            return f"UDim.new({s}, {o})"
        if "Color3" in v:
            r, g, b = v["Color3"]
            return f"Color3.new({r}, {g}, {b})"
        if "Vector2" in v:
            x, y = v["Vector2"]
            return f"Vector2.new({x}, {y})"
        if "ColorSequence" in v:
            kps = ", ".join(
                f"ColorSequenceKeypoint.new({k['time']}, Color3.new({k['color'][0]}, "
                f"{k['color'][1]}, {k['color'][2]}))" for k in v["ColorSequence"]["keypoints"])
            return f"ColorSequence.new({{{kps}}})"
        if "NumberSequence" in v:  # pattern fades (added with patterns.py)
            kps = ", ".join(
                f"NumberSequenceKeypoint.new({k['time']}, {k['value']}, {k.get('envelope', 0)})"
                for k in v["NumberSequence"]["keypoints"])
            return f"NumberSequence.new({{{kps}}})"
        if "Font" in v:
            return ("Font.new(\"rbxasset://fonts/families/FredokaOne.json\", "
                    "Enum.FontWeight.Regular, Enum.FontStyle.Normal)")
    return "nil"


# --------------------------------------------------------------------------- enum fix

ENUM_PROPS = {"ScaleType", "TextXAlignment", "ApplyStrokeMode", "LineJoinMode",
              "ZIndexBehavior", "TextYAlignment",
              "SortOrder", "FillDirection", "HorizontalAlignment",
              "VerticalAlignment", "DominantAxis"}


def qualify_enums(node):
    """Rojo takes enums as bare strings; Luau needs Enum.Prop.Value.

    Kept as a separate pass so the .model.json stays in Rojo's dialect and only
    the Luau emitter sees the qualified form.
    """
    for k, v in (node.get("properties") or {}).items():
        if k in ENUM_PROPS and isinstance(v, str) and not v.startswith("Enum."):
            node["properties"][k] = f"{k}.{v}"
    for c in node.get("children") or []:
        qualify_enums(c)
    return node


# --------------------------------------------------------------------------- cli

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--out", required=True)
    ap.add_argument("--icons", default=None)
    ap.add_argument("--png", action="store_true")
    ap.add_argument("--model", action="store_true")
    ap.add_argument("--luau", action="store_true")
    ap.add_argument("--icon-map", default=None,
                    help="icons.json from upload_icons.py; without it the emitted "
                         "tree carries named placeholders instead of asset ids")
    ap.add_argument("--keep-content", action="store_true",
                    help="keep Image ids in the .model.json (default strips them; "
                         "see strip_content_for_rojo for the live-sync risk)")
    args = ap.parse_args()
    if not (args.png or args.model or args.luau):
        args.png = args.model = args.luau = True  # no output named = build all three

    if args.icon_map and Path(args.icon_map).exists():
        ICON_IDS.update({k: v for k, v in
                         json.loads(Path(args.icon_map).read_text()).items()
                         if not k.startswith("_")})
    elif args.icon_map:
        print(f"[icons] {args.icon_map} not found; emitting empty images")

    spec_path = Path(args.spec)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    theme = spec["theme"]
    if isinstance(theme, str):
        theme = json.loads(resolve_theme_path(spec_path.parent, theme).read_text(encoding="utf-8"))
    palette = theme.get("palette", {})
    set_style(theme)
    size = spec.get("resolution", [1280, 720])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = spec.get("name", Path(args.spec).stem)

    icons = {}
    if args.icons:
        icons = {p.stem: p for p in Path(args.icons).glob("*.png")}

    root_spec = {"type": "root", "name": stem, "size": [1, 0, 1, 0],
                 "children": spec["children"]}

    if args.png:
        root = resolve(root_spec, (0, 0, size[0], size[1]), theme)
        img = render(root, theme, palette, icons, size)
        img.convert("RGB").save(out / f"{stem}.png")
        print(f"[png]   {out / f'{stem}.png'}  {size[0]}x{size[1]}"
              f"  {sum(1 for _ in walk(root))} nodes")

    if args.model or args.luau:
        # Measure BEFORE emitting: the emitter needs resolved pixel heights.
        measure_heights(root_spec, theme, size)
        tree = [i for c in spec["children"] for i in to_instances(c, theme, palette)]
        root = build_root(spec, stem, tree)
        # ONE ROOT, TWO TRANSPORTS, and the copy is the point. The .model.json and
        # the Luau builder used to be assembled separately: the Luau had NO
        # CanvasFrame at all (so a pasted page and a Rojo page were different
        # trees), and strip_content_for_rojo mutated the SHARED tree in place, so
        # with --model --luau together the Luau builder silently lost every icon
        # id as well. Found while building a real game.
        if args.model:
            rojo_root = copy.deepcopy(root)
            # --keep-content ships the real rbxassetid in the .model.json. `rojo
            # build` accepts it; the measured risk is the LIVE plugin (7.2.1 here),
            # which died on a Content value and synced nothing. IconName still
            # rides along, so a runtime applier works either way.
            if not args.keep_content:
                strip_content_for_rojo(rojo_root)
            # The root's name comes from the FILE name; Rojo 6+ ignores (and
            # warns on) a top-level name field, once per screen.
            rojo_root.pop("name", None)
            (out / f"{stem}.model.json").write_text(json.dumps(rojo_root, indent=2))
            print(f"[model] {out / f'{stem}.model.json'}")
        if args.luau:
            (out / f"{stem}.lua").write_text(luau(qualify_enums(copy.deepcopy(root))))
            print(f"[luau]  {out / f'{stem}.lua'}")
    return 0


def _open_attrs() -> dict:
    o = STYLE["motion"].get("open")
    if not o:
        return {}
    return {"OpenStyle": str(o.get("style", "pop")), "OpenFrom": float(o.get("from", 0.85)),
            "OpenTime": float(o.get("time", 0.16))}


def build_root(spec, stem, tree):
    """The ScreenGui instance tree both transports emit.

    The CanvasFrame convention: one full-size transparent parent so the page
    never floats on the ScreenGui and 0-1 means the screen. RESPONSIVENESS lives
    in ONE UIScale, mapping the reference resolution to the player's viewport.

    `scaleOn` says where that UIScale goes:
      "canvas" (default)  under the CanvasFrame, driven by the skill's
                          references/UIController.client.lua.
      "screen"            directly under the ScreenGui. For a game whose own
                          controller does `screen:FindFirstChildOfClass("UIScale")
                          or Instance.new("UIScale")` - shipping it on the canvas
                          there gives TWO UIScales, which multiply.

    `enabled` overrides the page-kind default (only "hud" starts Enabled), for a
    screen that must start exactly as some existing code expects.
    """
    ref = spec.get("resolution", [1280, 720])
    page_kind = spec.get("kind", "page")
    scale = instance("Scale", "UIScale", {"Scale": 1})
    on_screen = spec.get("scaleOn", "canvas") == "screen"
    canvas = instance("CanvasFrame", "Frame", {
        "Size": {"UDim2": [[1, 0], [1, 0]]},
        "Position": {"UDim2": [[0.5, 0], [0.5, 0]]},
        "AnchorPoint": {"Vector2": [0.5, 0.5]},
        "BackgroundTransparency": 1},
        ([] if on_screen else [scale]) + tree,
        attributes={"RefWidth": ref[0], "RefHeight": ref[1]})
    enabled = spec.get("enabled", page_kind == "hud")
    return instance(stem, "ScreenGui", {
        "DisplayOrder": spec.get("displayOrder",
                                 DISPLAY_ORDER.get(page_kind, DISPLAY_ORDER["page"])),
        "ResetOnSpawn": False,
        "ZIndexBehavior": "Sibling",
        "IgnoreGuiInset": bool(spec.get("ignoreGuiInset", False)),
        "Enabled": bool(enabled)},
        ([scale] if on_screen else []) + [canvas],
        # Page-level attributes pass straight through, so a spec can tell the
        # client something about the SCREEN that no element carries.
        attributes={"UIKind": page_kind, **_open_attrs(), **(spec.get("attributes") or {})})


if __name__ == "__main__":
    raise SystemExit(main())
