# UI recipes: the numbers, not the vibes

Collected from public Roblox UI guides. This file exists so that
"make it look like Roblox" is a table of values a generator can honour, not a
judgement call made fresh every time.

Sources at the bottom. Where a source gave a number, the number is here verbatim.
Where a technique came from a worked example rather than a stated number, it is marked **example**.

---

## 1. The two things every good Roblox UI has

From the "10x Better" guide, and it is the most useful frame in all the
research: every element is chasing **identity** and **depth**.

- **Identity** is colour, shape, typography and texture. It is what makes two
  panels from the same game look related.
- **Depth** is what separates a flat rectangle from something that reads as a
  physical button. The same design with and without depth is the entire before
  and after in both community guides.

A generator that gets identity right and depth wrong produces exactly the "flat,
outdated" look both guides open by rejecting.

---

## 2. THE DEPTH STACK

This is the single most transferable technique in the research. Both guides
build every panel, button and tab out of the same five-layer stack, and nothing
else in Roblox UI produces the same result.

For one element, back to front:

| # | Layer | Construction |
|---|---|---|
| 1 | **Shadow** | A duplicate of the element, offset **straight down**, filled a **darker and slightly hue-shifted** version of the face colour. `ZIndex` one below the face. |
| 2 | **Face** | The element itself, `UIGradient` fill. |
| 3 | **Gradient** | Two stops of the **same hue**, brighter toward the **top**. `Rotation = -90`. |
| 4 | **Inner stroke** | `UIStroke`, `ApplyStrokeMode = Border`, **inside**, thickness **5**, colour **brighter than the fill**. This is the "edge highlight" and it is the detail the 10x guide singles out as the one that surprised them most. |
| 5 | **Outer stroke** | `UIStroke` outside, thickness **5**, near-black. Put it on **both** the shadow and the outer container, or the outline does not wrap the composite silhouette. |

Two details that are easy to get wrong and both have caught real builds:

- The shadow's colour is **not** just "the face, darker". The guide picks the
  face colour, darkens it, **and pushes the hue toward blue**. A green button gets
  a dark blue-green shadow, not a dark green one. This is why hand-tuned Roblox UI
  looks warmer than a programmatic `Color3:Lerp(c, black)`.
- The outer stroke must be **the same thickness on every element in the screen**.
  Mixed stroke weights is the single most common tell of AI-generated or
  beginner UI.

**Text gets the same treatment.** A `TextLabel` with a `UIStroke` at thickness
**4 to 5** and, critically, `LineJoinMode = Bevel`. **Example:** on `Round`,
the counters of `O` and `P` do not fill in properly at small sizes. Bevel fixes it.

---

## 3. The numbers

| Property | Value | Source |
|---|---|---|
| `UIStroke.Thickness`, panels and buttons | **5** | improve-UI guide |
| `UIStroke.Thickness`, text | **4 to 5** | improve-UI guide |
| `UIStroke.LineJoinMode`, text | **Bevel** | improve-UI guide |
| `UIGradient.Rotation` for a top-lit face | **-90** | improve-UI guide |
| `UICorner.CornerRadius` | Scale **0.1**, Offset **0** | UI-basics guide, staff post |
| Circle from a square | `UICorner` scale **>= 0.5** | DevForum objects post |
| Background panel `BackgroundTransparency` over a texture | **0.15** | improve-UI guide |
| Stud texture `ImageTransparency` under a panel | **0.75** | improve-UI guide |
| Stud texture `TileSize` | `UDim2(0,100,0,100)`, `ScaleType = Tile` | improve-UI guide |
| Roblox top bar inset | **36 px** (one reply says it is now **58**; treat 36 as the minimum and keep the zone clear either way) | staff post, DevForum objects post |
| Max uploaded image dimension | **1024** (larger is downscaled on upload) | staff post, 10x guide |
| Touch target minimum | **44 pt**; action buttons **70x70** small screens, **120x120** larger | mobile UI guidance |
| Anchor point granularity | steps of **0.5** | UI-basics guide |

`UIStroke` **does not support Scale, only Offset**. That is a stated Roblox
limitation, and it is the one legitimate reason a generator emits a pixel value
where everything else is scale.

---

## 4. Structure conventions

**The CanvasFrame.** Every source that showed a hierarchy used the same root:

```
ScreenGui
└── CanvasFrame        AnchorPoint (0.5, 0.5)
                       Position    {0.5, 0}, {0.5, 0}
                       Size        {1, 0}, {1, 0}
                       BackgroundTransparency 1
    └── <every page>
```

The stated reason is that UI parented straight to a `ScreenGui` "floats", and a
full-size transparent parent gives you one place to swap a background in and one
coordinate space that is genuinely 0 to 1.

**One frame per page, and it is not optional.** Both guides make the same point
from opposite directions: every element of a screen goes inside a single
`BackgroundTransparency = 1` frame so that a scripter toggles one `.Visible`
instead of twelve. The improve-UI guide makes the same
point: make the frame first.

**`CanvasGroup` is how you clip properly.** It renders all descendants as one
rasterised layer, so `UICorner` and `UIGradient` on the group apply to the whole
group rather than per child. Use it when a header needs to be clipped into a
rounded panel. Note this is a genuinely different mechanism from
`ClipsDescendants`, which **does not clip rotated descendants**. An angled header inside a
clipping parent lints clean and throws diagonal bands across the screen; use a
`UIGradient` with a hard transparency step instead.

**ZIndex layering within one element:** shadow `0`, background `1`, header `2`,
text `3`. Keep the ladder consistent across elements or overlapping panels fight.

---

## 5. Colour

- **Saturated, with the brightest values toward the top** of any gradient.
- The 10x guide's structural advice: pick either **white with details** or
  **semi-transparent black** for a page background, because a neutral ground
  leaves you free to choose the accent colours. Committing the background to a
  hue constrains everything on top of it.
- **Green means money.** Stated flatly as the reason every price button in the
  reference shop is green. Follow the convention rather than being clever.
- Do not default to a dark theme for everything. A cartoon or playful game is a
  legitimate light-theme case.

---

## 6. Typography

- **Fredoka One** is named by both guides as the iconic Roblox font, and
  it is what the reference UIs use. Roblox does not support arbitrary custom
  fonts.
- `TextScaled = true` on labels, then let the container control the size.
- `BackgroundTransparency = 1` on every label. A label is type, not a box.
- Stroke as per section 2.

---

## 7. Textured backgrounds: the stud pattern

Currently the dominant look, per the improve-UI guide, and it is asset-cheap:
one tiling decal behind a semi-transparent panel.

```
ImageLabel   Image      = <stud texture decal>
             ScaleType  = Tile
             TileSize   = UDim2(0, 100, 0, 100)
             ImageTransparency = 0.75
```

Without `ScaleType = Tile` the texture **stretches** when the panel resizes,
which is the failure the guide describes.

**Composition note from the same source:** size panels so their edges land on a
whole stud rather than cutting one in half. Half a stud at the edge reads as
sloppy. This is a real constraint on panel dimensions if you use the pattern.

---

## 8. Shop page composition

The only page in the research that got a full compositional breakdown, and it
transfers directly to any game shop.

- A **top bar that stands out** and is the thing that opens the shop.
- Neutral background, per section 5.
- **The hero item is bigger and comes first.** Then smaller, less attractive
  items after it. This is stated as one of the most important rules in the guide.
- Each item tile carries: **name**, a **short description** if it bundles
  multiple things, a **large image of the item**, and a **green price button**.
- Put a **small currency icon** on the price so it is instantly clear what is
  being spent. The reference uses Robux; your game uses its own coin.
- **Tab buttons along the top** of the panel switch categories. They are built
  from the same depth stack as everything else, recoloured. In the guide, three
  tabs are made by duplicating one.

---

## 9. Icons: the two schools, and which to use

**White-and-tintable.** Export the icon pure white, then drive `ImageColor3` from
Roblox. Two independent sources insist on this. It is the right choice for
**functional UI glyphs**: gear, close, tick, lock, arrows. One asset serves every
colour state, and hover and disabled states become a colour tween with no second
upload.

**Full colour.** The right choice for **content icons**: crops, animals, tools,
currency. A carrot has to be orange. These are the ones worth generating.

A generated set should therefore be split by role, not produced uniformly. The
example manifest in this skill (`references/icons.example.json`) tags each icon with a `group` for exactly this reason.

The one rule that governs a generated set's consistency: **change only the
item noun between prompts and keep the style anchor byte-identical.**

**No drop shadow on a generated icon.** Add it procedurally in Roblox as an
offset darker copy, the same way the depth stack does it for panels. Reasons:
semi-transparent edge pixels blend badly in-engine, a flood-fill cutout cannot
cleanly separate a soft shadow from a background, and a per-image generated
shadow will not share a light direction across a set.

---

## 10. Hard constraints a generator must honour

- **Scale, not Offset**, for size and position. Misusing offset is the number one
  cause of broken mobile UI. The exceptions are `UIStroke.Thickness`, which has no
  scale, and `UIPadding` where a fixed gutter is genuinely wanted.
- **`UIAspectRatioConstraint` inside `UIGridLayout` cells**, or grid tiles distort
  on a different aspect ratio.
- **Respect `ScreenInsets`** for notches and Dynamic Island.
- **Keep the thumbstick zone (bottom left), the jump zone (bottom right) and the
  top bar clear.**
- Grid density **4x4 desktop down to 3x3 mobile**.
- Test in the Studio **Device Emulator**, not just at one window size.

---

## Sources

Roblox DevForum:
- [Designing UI: Tips and Best Practices](https://devforum.roblox.com/t/designing-ui-tips-and-best-practices/3074034), Roblox staff, Engine UI team
- [The Ultimate UI Design Guide](https://devforum.roblox.com/t/the-ultimate-ui-design-guide/1236916)
- [UI Design Objects & Tips](https://devforum.roblox.com/t/ui-design-objects-tips/613948)

Community guides: four independent write-ups on making Roblox UI look better, summarised in the tables above.

**Note on these guides.** Their authors build in Figma or by hand in
Studio. The techniques transfer, the workflow does not: everything above is
reproduced procedurally, because a GUI tool on the critical path is a human
clicking.
