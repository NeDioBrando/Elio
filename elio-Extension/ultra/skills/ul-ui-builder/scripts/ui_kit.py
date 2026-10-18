"""The component kit. This file IS the design language.

    from ui_kit import pill, window, shop_tile, slot, bar, toggle, slider

A project supplies CONTENT - which crops, which quests, which prices. It should
never re-decide what a button looks like, because the thing that makes a set of
screens read as one game is that the tile on the shop page and the slot in the
inventory were built by the same function.

Every construction here traces to a measured value in references/ui-recipes.md.
Where a number looks arbitrary it is not: it came off a Roblox staff post or a
community guide.

THE RULES THIS KIT ENFORCES SO THE CALLER CANNOT GET THEM WRONG

  - dark text on a light panel gets NO stroke. The theme's stroke of 4 is a
    HEADING value; on 24px brown body text it reads as mud.
  - a price is green and carries the currency icon. Stated as a convention in the
    source, not a preference.
  - a progress fill carries no outline. At a 22px bar the 5px dark stroke eats the
    fill entirely and a COMPLETED quest renders as an empty bar.
  - a window is one frame, modal, with the close button declared as an overhang so
    the overflow check does not cry wolf about it.
  - grid cells carry an aspect constraint, or tiles distort on another screen.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_THEME = HERE.parent / "references" / "theme.json"


def load_theme(path=None) -> dict:
    return json.loads(Path(path or DEFAULT_THEME).read_text(encoding="utf-8"))


# --------------------------------------------------------------------- primitives

# Text colours are THEME NAMES, never literals.
#
# Found by a replication test: building a dark sci-fi UI from this kit produced
# perfect layout with UNREADABLE item names, because shop_tile had INK
# hardcoded - a brown chosen for a cream panel. Any component that names a
# colour literally is only portable to the theme it was written against.
INK = "ink"          # dark text, for use on a light panel
INK_SOFT = "inkSoft"  # the same, de-emphasised
ON_DARK = "onDark"    # light text, for use on a saturated or dark panel
LIGHT_TEXT = {ON_DARK, "#FFFFFF", "#FFF", "white"}


def label(text, size, colour=ON_DARK, align="center", scale=0.62, **kw):
    """Text. Stroke defaults by contrast, not by taste - see the module docstring."""
    kw.setdefault("textStroke", 4 if colour in LIGHT_TEXT else 0)
    return {"type": "label", "text": text, "size": size, "textColour": colour,
            "align": align, "textScale": scale, **kw}


def icon(name, size, **kw):
    return {"type": "icon", "icon": name, "size": size, **kw}


def frame(name, size, colour=None, **kw):
    node = {"type": "frame", "name": name, "size": size, **kw}
    if colour:
        node["colour"] = colour
    else:
        node["transparent"] = True
    return node


def row_layout(gap=8, direction="x", align="start"):
    return {"type": "list", "dir": direction, "gap": gap, "align": align}


def grid_layout(cell, cols=None, gap=12):
    lay = {"type": "grid", "cell": list(cell), "gap": gap}
    if cols:
        lay["cols"] = cols
    return lay


# --------------------------------------------------------------------- readouts

def pill(name, icon_name, text, w=196, h=56, colour="panel"):
    """A currency or stat readout: icon plus number.

    The UIListLayout is the point. It keeps the pair together when the number
    grows from 86 to 1,240, which is the stated use case for a list layout on a
    two-element row.
    """
    return {"type": "panel", "name": name, "colour": colour,
            "size": [0, w, 0, h], "padding": 9,
            "layout": row_layout(8),
            "children": [icon(icon_name, [0, h - 18, 0, h - 18]),
                         label(text, [0, w - h - 14, 0, h - 22], INK,
                               align="left", scale=0.95)]}


def bar(value, w, h=26, colour="green", track="slot"):
    return {"type": "frame", "name": "Track", "colour": track,
            "size": [0, w, 0, h], "corner": 0.5,
            "children": [{"type": "frame", "name": "Fill", "colour": colour,
                          "size": [value, -8, 1, -8], "corner": 0.5,
                          "outline": False,
                          "pos": [0, 4, 0.5, 0], "anchor": [0, 0.5]}]}


def well(size, icon_name=None, colour="slot", **kw):
    """The recessed square an item image sits in. One shape, used by the shop
    tile, the inventory slot and the quest row, which is most of why those three
    look related."""
    kids = []
    if icon_name:
        kids.append(icon(icon_name, [1, -16, 1, -16],
                         pos=[0.5, 0, 0.5, 0], anchor=[0.5, 0.5]))
    return {"type": "frame", "name": "Well", "colour": colour,
            "size": size, "children": kids, **kw}


# --------------------------------------------------------------------- controls

def button(name, colour, size, children=None, **kw):
    return {"type": "button", "name": name, "colour": colour, "size": size,
            "children": children or [], **kw}


# The minimum height for anything tappable, at the 1280x720 reference. 44pt on a
# 640x360 phone means 44/0.5 = 88px here. verify_ui derives and enforces it.
TOUCH_H = 88


def text_button(name, text, colour, w, h=TOUCH_H, scale=0.42):
    return button(name, colour, [0, w, 0, h],
                  [label(text, [1, 0, 1, 0], scale=scale)])


def icon_button(name, icon_name, colour, side=TOUCH_H, pad=16, opens=None):
    """A HUD button. `opens` names the page it toggles, and is emitted as an
    ATTRIBUTE rather than baked into a script, so one controller drives any set of
    pages without knowing their names."""
    kw = {"opens": opens} if opens else {}
    return button(name, colour, [0, side, 0, side],
                  [icon(icon_name, [1, 0, 1, 0])], padding=pad, **kw)


def tab(name, text, active, w=170, h=TOUCH_H, accent="green"):
    return text_button(name, text, accent if active else "panelAlt", w, h)


def price_button(text, w, h=TOUCH_H, currency="coin"):
    """Green, always, and always carrying the currency icon.

    Both are conventions the source states outright: green is the colour of money,
    and the currency icon is there so it is instantly clear what is being spent.
    """
    return button("Buy", "green", [0, w, 0, h], [
        icon(currency, [0, h - 20, 0, h - 20]),
        label(text, [0, w - h - 24, 0, h - 18], scale=0.9)],
        padding=7, layout=row_layout(6, align="center"))


def toggle(text, on, h=100):
    return {"type": "panel", "name": "Row", "colour": "panelAlt",
            "size": [1, 0, 0, h], "padding": 12,
            "children": [
                label(text, [0, 420, 1, -20], INK, align="left",
                      scale=0.52, pos=[0, 8, 0, 10]),
                button("Switch", "green" if on else "grey", [0, 150, 0, TOUCH_H],
                       [label("ON" if on else "OFF", [1, 0, 1, 0], scale=0.42)],
                       pos=[1, -60, 0.5, 0], anchor=[1, 0.5], corner=0.5)]}


def slider(text, value, h=100, w=300):
    return {"type": "panel", "name": "Row", "colour": "panelAlt",
            "size": [1, 0, 0, h], "padding": 12,
            "children": [
                label(text, [0, 300, 1, -20], INK, align="left",
                      scale=0.52, pos=[0, 8, 0, 10]),
                {**bar(value, w, 26, "blue"),
                 "pos": [1, -8, 0.5, 0], "anchor": [1, 0.5]}]}


# --------------------------------------------------------------------- collections

def price_tag(text, w, h=46, currency="coin"):
    """A price READOUT. Same look as price_button, no interaction."""
    return {"type": "panel", "name": "Price", "colour": "green",
            "size": [0, w, 0, h], "padding": 7,
            "layout": row_layout(6, align="center"),
            "children": [icon(currency, [0, h - 20, 0, h - 20]),
                         label(text, [0, w - h - 24, 0, h - 18], scale=0.9)]}


def shop_tile(icon_name, name, price, w=210, h=250, currency="coin"):
    return {"type": "button", "name": f"Tile{name}", "colour": "panelAlt",
            "size": [0, w, 0, h], "aspect": round(w / h, 4), "padding": 12,
            "children": [
                well([1, -24, 0, 124], icon_name),
                label(name, [1, -24, 0, 36], INK, scale=0.68,
                      pos=[0, 0, 0, 136]),
                {**price_tag(price, w - 40, currency=currency),
                 "pos": [0.5, 0, 0, 180], "anchor": [0.5, 0]}]}


def slot(icon_name, count, side=104):
    return {"type": "panel", "name": f"Slot{icon_name}", "colour": "slot",
            "size": [0, side, 0, side], "aspect": 1.0, "padding": 8,
            "children": [icon(icon_name, [1, -16, 1, -16]),
                         label(count, [0, 56, 0, 34], ON_DARK, scale=0.92,
                               pos=[1, -4, 1, -4], anchor=[1, 1], textStroke=3)]}


def list_row(icon_name, text, progress=None, reward=None, h=92, text_w=380):
    """The quest / mission row: art, title, optional progress, optional reward."""
    kids = [well([0, 68, 1, -24], icon_name, pos=[0, 0, 0.5, 0], anchor=[0, 0.5]),
            label(text, [0, text_w, 0, 32], INK, align="left", scale=0.74,
                  pos=[0, 84, 0, 6 if progress is not None else 28])]
    if progress is not None:
        kids.append({**bar(progress, text_w, 22,
                           "green" if progress < 1 else "gold"),
                     "pos": [0, 84, 0, 44]})
    if reward:
        reward_icon, reward_text = reward
        kids.append({"type": "panel", "name": "Reward", "colour": "cream",
                     "size": [0, 128, 0, 52], "pos": [1, 0, 0.5, 0],
                     "anchor": [1, 0.5], "padding": 8,
                     "layout": row_layout(6, align="center"),
                     "children": [icon(reward_icon, [0, 34, 0, 34]),
                                  label(reward_text, [0, 60, 0, 30], INK,
                                        scale=0.85)]})
    return {"type": "panel", "name": "Row", "colour": "panelAlt",
            "size": [1, 0, 0, h], "padding": 12, "children": kids}


# --------------------------------------------------------------------- containers

def window(title, w, h, accent, body, close=True, corner=0.06):
    """A modal page. ONE frame, so a scripter toggles one .Visible.

    Both guides make this point from opposite directions, and one of them
    admits that they should have made the frame at the start instead of
    wrapping everything at the end.
    """
    kids = [
        {"type": "panel", "name": "Header", "colour": accent,
         "size": [1, -24, 0, 78], "pos": [0.5, 0, 0, 14], "anchor": [0.5, 0],
         "children": [label(title, [1, 0, 1, 0], scale=0.58)]},
        body,
    ]
    if close:
        # Sits PROUD of the corner on purpose. "overhang" declares that to
        # verify_ui so the overflow check stays worth reading.
        kids.append(button("Close", "red", [0, TOUCH_H, 0, TOUCH_H],
                           [icon("close", [1, 0, 1, 0])],
                           pos=[1, 2, 0, -10], anchor=[1, 0], padding=16, z=3,
                           overhang=True, closes=True))
    return {"type": "panel", "name": "Window", "colour": "panel", "modal": True,
            "size": [0, w, 0, h], "pos": [0.5, 0, 0.5, 0], "anchor": [0.5, 0.5],
            "corner": corner, "children": kids}


def window_body(children, layout=None, top=118, side=52, bottom=134):
    """The area under a window header. Kept as a function so every page indents
    its content by the same amount."""
    node = {"type": "frame", "name": "Body", "transparent": True,
            "size": [1, -side, 1, -bottom], "pos": [0.5, 0, 0, top],
            "anchor": [0.5, 0], "children": children}
    if layout:
        node["layout"] = layout
    return node


def page(name, children=None, theme="theme.json", resolution=(1280, 720),
         kind="page"):
    """kind="hud" is the always-visible overlay; kind="page" starts hidden and is
    opened by a HUD button."""
    return {"name": name, "theme": theme, "resolution": list(resolution),
            "kind": kind, "children": children}
