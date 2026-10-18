---
name: ul-check-suite
description: Check Suite for Roblox work - one gate for both Check-UI (screens, buttons, windows, HUDs, menus; 13 rules, Shop, Codes, Rebirth, Settings and Daily Rewards archetypes, GothamBlack, slate canvas, responsive UIScale) and Check-Code (Luau scripts, modules, remotes, DataStore, Config, cleanup; 18 rules). Use on every UI change and every Luau change, and whenever someone asks whether UI or code is finished. Writes one table with PASS, FAIL, WARN, NOT APPLICABLE or UNVERIFIED, and runs check_code.py.
---

# Check Suite - one gate for UI and code

One standard, one gate, one table. Part 1 is Check-UI (every screen, button, window, HUD and menu).
Part 2 is Check-Code (every Luau script, module, remote, data change and Config change).

## The gate (mandatory, no exceptions)

1. For UI, build from the Check-UI modules or the closest example, then check UI-1 to UI-13.
   For code, check CODE-1 to CODE-18 for every changed file.
2. Write one Check Suite table. Use the row labels UI-1 to UI-13 and CODE-1 to CODE-18 so they cannot clash.
   Each row: label, PASS / FAIL / WARN / NOT APPLICABLE / UNVERIFIED, where (file:line, or screen and part), and a note.
3. Run `check_code.py` on changed Luau files when you can, and paste its table in. Run the gui-verify numbers for
   screens. Take screen captures when Studio is present, at a phone size and a PC size if the window can be resized.
4. A FAIL in either part means the item is not done. WARN items must be fixed or explained.
5. Anything that could not be checked is UNVERIFIED, and the report says what the user must run or look at.

A UI or code answer without the Check Suite table is incomplete.
The gate is a rule the assistant must follow. A prompt cannot enforce it, so the user should check the table and the scanner output.

## Part 1 - Check-UI — Clean Roblox UI Design System & Implementation Skill

### 1. Skill Overview & Purpose

**Check-UI** is the definitive design system standard for modern Roblox cartoon, simulator, and tycoon games (inspired by top-tier titles like Pet Simulator 99, Anime Champions, and Blade Ball).

This skill equips any AI agent or human developer with the exact mathematical proportions, color formulas, component architectures, Luau implementations, and responsive scaling mechanisms required to produce pixel-perfect, cohesive, and non-generic Roblox interfaces.

### Core Tenets (Non-Negotiable Rules)
1. **Zero AI Slop / Generic Looks**: Every frame must have intentional cartoon depth, high-contrast borders, pastel highlight strokes, and tactile micro-interactions.
2. **Strict Typography**: Every title, label, counter, button, and text box **must** use `Enum.Font.GothamBlack` with black outline `UIStroke` (thickness proportional to font size: 2.0px to 3.5px).
3. **Solid Canvas (`#3b5866`)**: Never make window backgrounds semi-transparent. Always use solid slate blue `Color3.fromRGB(59, 88, 102)` with `UICorner` (4px) and outer `UIStroke` (3.5px, `#181e22`).
4. **Signature 3D Beveled Square Close Button `[X]`**: Exact 38x38px square with a dark burgundy bottom bevel extrusion (`#730010`), shifted face with vibrant crimson/pink gradient (`#ff7daf` to `#ff1428`), inner pastel stroke highlight, GothamBlack "X", and centered `UIScale`.
5. **2-Tier 3D Header Shadow Divider**: Every header must end with a 2-line separator: an upper 3px dark thematic accent bar + a lower 3px solid black bar.
6. **Seamless Checkerboard (Damier) Fade**: Full-height texture overlay (`rbxassetid://385956923`) with a vertical `UIGradient` transparency sequence (`1 -> 0.82 -> 0.35 -> 0.10`) to eliminate hard cutoff lines.
7. **Aspect Ratio Preservation**: Icons must **never** be stretched. Always set `ScaleType = Enum.ScaleType.Fit`.
8. **Universal Responsive Scaling**: All modal windows and HUDs must be governed by dynamic `UIScale` responsive calculations based on `camera.ViewportSize` (baseline `1050 x 620`, clamped `[0.52, 1.18]`).
9. **Center-Anchored Interactions**: ALL hover, click, and scale animations MUST originate from the exact geometric center via `AnchorPoint = Vector2.new(0.5, 0.5)` + child `UIScale`.
10. **The 5 Canonical Menu Archetypes**: All game interfaces should follow one of the 5 canonical specifications: Shop, Codes, Rebirth, Settings, or Daily Rewards.
11. **Iconless Button Mandate**: Whenever a button WITHOUT an icon is requested (Throw, Action, Jump, Redeem, Confirm, etc.), it MUST ALWAYS strictly follow the Studio-Verified Canonical Standard: sharp 90° rectangular geometry (no UICorner), 3px solid `#0C141A` outer border, 90° color gradient, black checkerboard overlay (`0.91 -> 0.62` fade), TRIPLE glass specular inner highlight frames (`InnerHighlight1`, `2`, `3`), and centered GothamBlack white text with 3px `#11171A` contextual stroke & 1px optical offset.

---

### 2. Palette & Visual Constants

### 2.1 Universal Theme Colors

| Element | Color3 (RGB) | Hex | Purpose / Notes |
|:---|:---|:---|:---|
| **Window Background** | `59, 88, 102` | `#3B5866` | Solid, opaque cartoon slate blue canvas |
| **Outer Border Stroke** | `24, 30, 34` | `#181E22` | 3.5px outer window outline (`ApplyStrokeMode.Border`) |
| **Card / Container BG** | `26, 44, 52` | `#1A2C34` | Recessed dark container for items, codes, settings |
| **Card Inner Highlight**| `75, 125, 145` | `#4B7D91` | 1.2px inner highlight stroke (transparency 0.4) |
| **Requirements Box** | `20, 34, 42` | `#14222A` | Recessed container for Rebirth/Quest requirements |
| **Requirements Border** | `85, 140, 160` | `#558CA0` | 1.2px solid highlight border for requirements box |
| **Close Btn Base (3D)** | `115, 0, 16` | `#730010` | 3D extrusion bottom bevel for `[X]` button |
| **Close Btn Sep Line** | `70, 0, 10` | `#46000A` | 1px horizontal separator line at bottom bevel |
| **Close Inner Highlight**| `255, 210, 235`| `#FFD2EB` | 1.2px pastel highlight stroke on close face |

### 2.2 The 5 Canonical Header Themes

Each modal possesses a distinct header gradient while sharing the identical 60px height, 2-tier 3D divider bar, top highlight, and fading damier:

```lua
-- 1. SHOP (Magenta / Crimson)
HeaderGradient = { Color3.fromRGB(255, 20, 150), Color3.fromRGB(225, 0, 25) }
TopHighlight   = Color3.fromRGB(255, 200, 225)
DamierColor    = Color3.fromRGB(150, 0, 20)
DivDarkColor   = Color3.fromRGB(125, 0, 18)

-- 2. CODES (Cyan / Electric Blue)
HeaderGradient = { Color3.fromRGB(0, 205, 255), Color3.fromRGB(0, 130, 245) }
TopHighlight   = Color3.fromRGB(180, 240, 255)
DamierColor    = Color3.fromRGB(0, 75, 150)
DivDarkColor   = Color3.fromRGB(0, 50, 110)

-- 3. SETTINGS (Silver / Metallic White)
HeaderGradient = { Color3.fromRGB(255, 255, 255), Color3.fromRGB(215, 222, 232) }
TopHighlight   = Color3.fromRGB(255, 255, 255)
DamierColor    = Color3.fromRGB(110, 120, 135)
DivDarkColor   = Color3.fromRGB(90, 100, 112)

-- 4. REBIRTH (Royal Purple / Violet)
HeaderGradient = { Color3.fromRGB(160, 0, 255), Color3.fromRGB(96, 0, 200) }
TopHighlight   = Color3.fromRGB(224, 160, 255)
DamierColor    = Color3.fromRGB(96, 0, 144)
DivDarkColor   = Color3.fromRGB(80, 0, 120)

-- 5. DAILY REWARDS (Lime Neon Green)
HeaderGradient = { Color3.fromRGB(152, 255, 0), Color3.fromRGB(80, 208, 0) }
TopHighlight   = Color3.fromRGB(224, 255, 176)
DamierColor    = Color3.fromRGB(53, 128, 0)
DivDarkColor   = Color3.fromRGB(37, 96, 0)
```

### 2.3 The Button State Triad & Specialized Buttons

```lua
-- CLAIM / BUY / REDEEM (Lime Green)
ClaimGrad      = { Color3.fromRGB(180, 255, 25), Color3.fromRGB(105, 225, 0) }
ClaimBevel     = Color3.fromRGB(15, 120, 15)       -- #0F780F 3D bottom bevel
ClaimHighlight = Color3.fromRGB(235, 255, 130)     -- #EBFF82 Pastel lime stroke
ClaimDamier    = Color3.fromRGB(40, 160, 20)

-- CLAIMED / DISABLED (Metallic Silver)
ClaimedGrad      = { Color3.fromRGB(216, 222, 228), Color3.fromRGB(148, 160, 176) }
ClaimedBevel     = Color3.fromRGB(72, 82, 96)      -- #485260 Dark slate bevel
ClaimedHighlight = Color3.fromRGB(255, 255, 255)
ClaimedDamier    = Color3.fromRGB(96, 104, 112)

-- LOCKED / DESTRUCTIVE (Crimson Red)
LockedGrad      = { Color3.fromRGB(255, 32, 80), Color3.fromRGB(208, 0, 32) }
LockedBevel     = Color3.fromRGB(112, 0, 16)       -- #700010 Burgundy bevel
LockedHighlight = Color3.fromRGB(255, 176, 200)
LockedDamier    = Color3.fromRGB(144, 0, 24)

-- SKIP (Header Action Button - Golden Amber)
SkipGrad      = { Color3.fromRGB(255, 208, 0), Color3.fromRGB(255, 140, 0) }
SkipBevel     = Color3.fromRGB(153, 76, 0)         -- #994C00 Dark amber bevel
SkipHighlight = Color3.fromRGB(255, 240, 160)
SkipDamier    = Color3.fromRGB(176, 96, 0)

-- MUSIC ON / FEATURE (Hot Pink / Magenta)
MusicOnGrad      = { Color3.fromRGB(255, 20, 128), Color3.fromRGB(212, 0, 85) }
MusicOnBevel     = Color3.fromRGB(120, 10, 45)     -- #780A2D
MusicOnHighlight = Color3.fromRGB(255, 176, 208)
MusicOnDamier    = Color3.fromRGB(160, 0, 64)
```

### 2.4 Card Background Gradients (Including Day 7 Rainbow)

```lua
-- Cyan Card (Auto Collect, Daily Days 1-3):
ColorSequence.new(Color3.fromRGB(0, 210, 255), Color3.fromRGB(0, 120, 255))

-- Purple Card (Double Money, Daily Day 4):
ColorSequence.new(Color3.fromRGB(176, 32, 255), Color3.fromRGB(112, 0, 224))

-- Lime Card (Products, Rebirth Multipliers):
ColorSequence.new(Color3.fromRGB(180, 255, 25), Color3.fromRGB(105, 225, 0))

-- Magenta Card (Daily Day 5):
ColorSequence.new(Color3.fromRGB(208, 0, 224), Color3.fromRGB(128, 0, 160))

-- Amber Card (Daily Day 6):
ColorSequence.new(Color3.fromRGB(255, 170, 0), Color3.fromRGB(224, 96, 0))

-- Day 7 Signature Rainbow / Spectrum Sequence (Rotation = 45 deg):
ColorSequence.new{
    ColorSequenceKeypoint.new(0.00, Color3.fromRGB(255, 30, 80)),
    ColorSequenceKeypoint.new(0.18, Color3.fromRGB(255, 140, 0)),
    ColorSequenceKeypoint.new(0.35, Color3.fromRGB(255, 230, 0)),
    ColorSequenceKeypoint.new(0.52, Color3.fromRGB(40, 230, 50)),
    ColorSequenceKeypoint.new(0.70, Color3.fromRGB(0, 210, 255)),
    ColorSequenceKeypoint.new(0.85, Color3.fromRGB(90, 60, 255)),
    ColorSequenceKeypoint.new(1.00, Color3.fromRGB(220, 0, 230)),
}
```

### 2.5 Verified Asset IDs

- **Checkerboard Texture (Damier)**: `rbxassetid://385956923`
- **Faded Sunburst Bloom**: `rbxassetid://130563114903838`
- **Cash Stacks Icon**: `rbxassetid://88694661500877`
- **Character / Player Icon**: `rbxassetid://77589096360120`
- **White Robux Icon**: `rbxassetid://132185731364109`
- **Hover SFX**: `rbxassetid://6895079853`
- **Click SFX**: `rbxassetid://6895079853`

---

### 3. Component Construction Recipes

### 3.1 Signature 3D Beveled Square Close Button `[X]`

```lua
local function createCloseButton(header)
    local CloseBtn = Instance.new("ImageButton")
    CloseBtn.Name = "CloseButton"
    CloseBtn.Size = UDim2.new(0, 38, 0, 38)
    CloseBtn.Position = UDim2.new(1, -34, 0.5, -2)
    CloseBtn.AnchorPoint = Vector2.new(0.5, 0.5)
    CloseBtn.BackgroundColor3 = Color3.fromRGB(115, 0, 16) -- Dark 3D bevel base
    CloseBtn.BorderSizePixel = 0
    CloseBtn.AutoButtonColor = false
    CloseBtn.ClipsDescendants = false
    CloseBtn.ZIndex = 25
    CloseBtn.Parent = header

    local closeStroke = Instance.new("UIStroke")
    closeStroke.Color = Color3.fromRGB(0, 0, 0)
    closeStroke.Thickness = 2.8
    closeStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    closeStroke.Parent = CloseBtn

    -- Upper Face (Shifted up by 4px to reveal bottom bevel)
    local Face = Instance.new("Frame")
    Face.Name = "Face"
    Face.Size = UDim2.new(1, 0, 1, -4)
    Face.Position = UDim2.new(0, 0, 0, 0)
    Face.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    Face.BorderSizePixel = 0
    Face.ZIndex = 26
    Face.Parent = CloseBtn

    local faceGrad = Instance.new("UIGradient")
    faceGrad.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 125, 175)),
        ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 20, 40))
    }
    faceGrad.Rotation = 90
    faceGrad.Parent = Face

    local InnerBorder = Instance.new("Frame")
    InnerBorder.Name = "InnerBorder"
    InnerBorder.Size = UDim2.new(1, -2, 1, -2)
    InnerBorder.Position = UDim2.new(0.5, 0, 0.5, 0)
    InnerBorder.AnchorPoint = Vector2.new(0.5, 0.5)
    InnerBorder.BackgroundTransparency = 1
    InnerBorder.BorderSizePixel = 0
    InnerBorder.ZIndex = 27
    InnerBorder.Parent = Face

    local innerStroke = Instance.new("UIStroke")
    innerStroke.Color = Color3.fromRGB(255, 210, 235)
    innerStroke.Thickness = 1.2
    innerStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    innerStroke.Parent = InnerBorder

    local SepLine = Instance.new("Frame")
    SepLine.Name = "SepLine"
    SepLine.Size = UDim2.new(1, 0, 0, 1)
    SepLine.Position = UDim2.new(0, 0, 1, -4)
    SepLine.BackgroundColor3 = Color3.fromRGB(70, 0, 10)
    SepLine.BorderSizePixel = 0
    SepLine.ZIndex = 27
    SepLine.Parent = CloseBtn

    local closeX = Instance.new("TextLabel")
    closeX.Name = "X"
    closeX.Text = "X"
    closeX.Font = Enum.Font.GothamBlack
    closeX.TextSize = 29
    closeX.TextColor3 = Color3.fromRGB(255, 255, 255)
    closeX.Size = UDim2.new(1, 0, 1, 0)
    closeX.Position = UDim2.new(0.5, 0, 0.5, 0)
    closeX.AnchorPoint = Vector2.new(0.5, 0.5)
    closeX.BackgroundTransparency = 1
    closeX.ZIndex = 28
    closeX.Parent = Face

    local xStroke = Instance.new("UIStroke")
    xStroke.Color = Color3.fromRGB(0, 0, 0)
    xStroke.Thickness = 3.0
    xStroke.Parent = closeX

    local closeScale = Instance.new("UIScale")
    closeScale.Name = "ButtonScale"
    closeScale.Scale = 1
    closeScale.Parent = CloseBtn

    return CloseBtn
end
```

### 3.2 Header Action Button (`Skip`)

```lua
local function createHeaderButton(header, text, offsetRight)
    local btn = Instance.new("ImageButton")
    btn.Name = text .. "Button"
    btn.Size = UDim2.new(0, 84, 0, 36)
    btn.Position = UDim2.new(1, offsetRight or -86, 0.5, -2)
    btn.AnchorPoint = Vector2.new(0.5, 0.5)
    btn.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    btn.BorderSizePixel = 0
    btn.AutoButtonColor = false
    btn.ClipsDescendants = true
    btn.ZIndex = 25
    btn.Parent = header

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 4)
    corner.Parent = btn

    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.fromRGB(0, 0, 0)
    stroke.Thickness = 2.8
    stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    stroke.Parent = btn

    local grad = Instance.new("UIGradient")
    grad.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 208, 0)),
        ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 140, 0))
    }
    grad.Rotation = 90
    grad.Parent = btn

    local bevel = Instance.new("Frame")
    bevel.Name = "Bevel"
    bevel.Size = UDim2.new(1, 0, 0, 3)
    bevel.Position = UDim2.new(0, 0, 1, -3)
    bevel.BackgroundColor3 = Color3.fromRGB(153, 76, 0)
    bevel.BorderSizePixel = 0
    bevel.ZIndex = 26
    bevel.Parent = btn

    local innerHighlight = Instance.new("Frame")
    innerHighlight.Size = UDim2.new(1, -4, 1, -4)
    innerHighlight.Position = UDim2.new(0.5, 0, 0.5, 0)
    innerHighlight.AnchorPoint = Vector2.new(0.5, 0.5)
    innerHighlight.BackgroundTransparency = 1
    innerHighlight.BorderSizePixel = 0
    innerHighlight.ZIndex = 27
    innerHighlight.Parent = btn

    local innerStroke = Instance.new("UIStroke")
    innerStroke.Color = Color3.fromRGB(255, 240, 160)
    innerStroke.Thickness = 1.2
    innerStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    innerStroke.Parent = innerHighlight

    local label = Instance.new("TextLabel")
    label.Text = text
    label.Font = Enum.Font.GothamBlack
    label.TextSize = 24
    label.TextColor3 = Color3.fromRGB(255, 255, 255)
    label.Size = UDim2.new(1, 0, 1, 0)
    label.Position = UDim2.new(0, 0, 0, 0)
    label.BackgroundTransparency = 1
    label.ZIndex = 28
    label.Parent = btn

    local lStroke = Instance.new("UIStroke")
    lStroke.Color = Color3.fromRGB(0, 0, 0)
    lStroke.Thickness = 2.8
    lStroke.Parent = label

    local bScale = Instance.new("UIScale")
    bScale.Name = "ButtonScale"
    bScale.Scale = 1
    bScale.Parent = btn

    return btn
end
```

### 3.3 Progression Bar (Orange-to-Gold Fill with Recessed Trough)

```lua
local function createProgressBar(parent, progress, text, size, position)
    local trough = Instance.new("Frame")
    trough.Name = "ProgressTrough"
    trough.Size = size
    trough.Position = position
    trough.AnchorPoint = Vector2.new(0.5, 0)
    trough.BackgroundColor3 = Color3.fromRGB(20, 30, 36)
    trough.BorderSizePixel = 0
    trough.ClipsDescendants = true
    trough.ZIndex = 24
    trough.Parent = parent

    local tStroke = Instance.new("UIStroke")
    tStroke.Color = Color3.fromRGB(12, 18, 22)
    tStroke.Thickness = 2.0
    tStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    tStroke.Parent = trough

    local fill = Instance.new("Frame")
    fill.Name = "ProgressFill"
    local pct = math.clamp(progress, 0, 1)
    fill.Size = UDim2.new(pct, 0, 1, 0)
    fill.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    fill.BorderSizePixel = 0
    fill.ZIndex = 25
    fill.Parent = trough

    local fillGrad = Instance.new("UIGradient")
    fillGrad.Color = ColorSequence.new{
        ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 200, 0)),
        ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 106, 0))
    }
    fillGrad.Rotation = 90
    fillGrad.Parent = fill

    local bevel = Instance.new("Frame")
    bevel.Size = UDim2.new(1, 0, 0, 2)
    bevel.Position = UDim2.new(0, 0, 1, -2)
    bevel.BackgroundColor3 = Color3.fromRGB(153, 60, 0)
    bevel.BorderSizePixel = 0
    bevel.ZIndex = 26
    bevel.Parent = fill

    local label = Instance.new("TextLabel")
    label.Text = text or (string.format("%d%% Completed", math.floor(pct * 100)))
    label.Font = Enum.Font.GothamBlack
    label.TextSize = 22
    label.TextColor3 = Color3.fromRGB(255, 255, 255)
    label.Size = UDim2.new(1, 0, 1, 0)
    label.Position = UDim2.new(0.5, 0, 0.5, 0)
    label.AnchorPoint = Vector2.new(0.5, 0.5)
    label.BackgroundTransparency = 1
    label.ZIndex = 27
    label.Parent = trough

    local lStroke = Instance.new("UIStroke")
    lStroke.Color = Color3.fromRGB(0, 0, 0)
    lStroke.Thickness = 2.6
    lStroke.Parent = label

    return trough
end
```

### 3.4 Canonical Standard Iconless Button (Studio-Verified Blueprint)

> **MANDATORY RULE**: Whenever an AI agent or developer creates a button without an icon (such as Throw, Action, Jump, Redeem, Skip, Confirm, or Ok), it **must always** follow this exact design and layer hierarchy.

```
+-------------------------------------------------------------------------+  <-- ImageButton (176x55, AnchorPoint: (0.5, 0.5), ClipsDescendants: true)
|  OuterStroke (3px #0C141A solid dark charcoal border, ApplyStrokeMode: Border) |
|  ButtonGradient (UIGradient, 90 deg, e.g. #FFE808 -> #FF6800 or Lime/Cyan)     |
|  +-------------------------------------------------------------------+  |
|  | Checkerboard (ImageLabel rbxassetid://385956923, ImageColor3: #000)|  |  <-- Black checkerboard (Tile: 19x19)
|  | DamierGradient (UIGradient, 90 deg, Transparency: 0.91 -> 0.62)    |  |  <-- Subtle vertical fade
|  +-------------------------------------------------------------------+  |
|  +-------------------------------------------------------------------+  |
|  | InnerHighlight1 (Size: 1 - 2px, 1px white border stroke, 25% transp) |  |  <-- Outer specular rim
|  | InnerHighlight2 (Size: 1 - 4px, 1px white border stroke, 45% transp) |  |  <-- Mid specular rim
|  | InnerHighlight3 (Size: 1 - 6px, 1px white border stroke, 80% transp) |  |  <-- Inner soft specular rim
|  +-------------------------------------------------------------------+  |
|                                                                         |
|                         [   THROW   ]                                   |  <-- TextLabel "Throw" (GothamBlack 36px, #FFFFFF)
|                                                                         |      Position: (0.5, 0, 0.5, -1) (1px optical lift)
|                                                                         |      TextStroke: 3px #11171A solid contextual border
|  ButtonScale (UIScale: 1.0 -> 1.06 hover, 0.94 click, Quad.Out/Back.Out)|  |
+-------------------------------------------------------------------------+
```

```lua
local function createStandardButton(props)
    -- props: { Name, Size, Position, AnchorPoint, Parent, Text, TextSize, Gradient, DamierColor, ZIndex }
    local zIndex = props.ZIndex or 25
    local btn = Instance.new("ImageButton")
    btn.Name = props.Name or "StandardButton"
    btn.Size = props.Size or UDim2.new(0, 176, 0, 55)
    btn.Position = props.Position or UDim2.new(0.5, 0, 0.5, 0)
    btn.AnchorPoint = props.AnchorPoint or Vector2.new(0.5, 0.5)
    btn.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
    btn.BorderSizePixel = 0
    btn.AutoButtonColor = false
    btn.ClipsDescendants = true
    btn.ZIndex = zIndex
    btn.Parent = props.Parent

    -- 1. Outer Border (3px solid #0C141A)
    local outerStroke = Instance.new("UIStroke")
    outerStroke.Name = "OuterStroke"
    outerStroke.Thickness = 3
    outerStroke.Color = Color3.fromRGB(12, 20, 26) -- #0C141A
    outerStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
    outerStroke.Transparency = 0
    outerStroke.Parent = btn

    -- 2. Button Gradient (90 deg)
    local btnGrad = Instance.new("UIGradient")
    btnGrad.Name = "ButtonGradient"
    btnGrad.Rotation = 90
    btnGrad.Color = props.Gradient or ColorSequence.new{
        ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 232, 8)),  -- #FFE808
        ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 104, 0))   -- #FF6800
    }
    btnGrad.Parent = btn

    -- 3. Black Checkerboard with Vertical Fade (0.91 -> 0.62)
    local checkerboard = Instance.new("ImageLabel")
    checkerboard.Name = "Checkerboard"
    checkerboard.Size = UDim2.new(1, 0, 1, 0)
    checkerboard.Position = UDim2.new(0, 0, 0, 0)
    checkerboard.BackgroundTransparency = 1
    checkerboard.Image = "rbxassetid://385956923"
    checkerboard.ScaleType = Enum.ScaleType.Tile
    checkerboard.TileSize = UDim2.new(0, 19, 0, 19)
    checkerboard.ImageColor3 = props.DamierColor or Color3.fromRGB(0, 0, 0)
    checkerboard.ImageTransparency = 0
    checkerboard.ZIndex = zIndex + 1
    checkerboard.Parent = btn

    local damierGrad = Instance.new("UIGradient")
    damierGrad.Name = "DamierGradient"
    damierGrad.Rotation = 90
    damierGrad.Transparency = NumberSequence.new{
        NumberSequenceKeypoint.new(0, 0.91),
        NumberSequenceKeypoint.new(1, 0.62)
    }
    damierGrad.Parent = checkerboard

    -- 4. Triple Glass Specular Inner Highlight
    local highlights = {
        { Name = "InnerHighlight1", Inset = 2, Transparency = 0.25 },
        { Name = "InnerHighlight2", Inset = 4, Transparency = 0.45 },
        { Name = "InnerHighlight3", Inset = 6, Transparency = 0.80 },
    }
    for _, h in ipairs(highlights) do
        local f = Instance.new("Frame")
        f.Name = h.Name
        f.Size = UDim2.new(1, -h.Inset, 1, -h.Inset)
        f.Position = UDim2.new(0.5, 0, 0.5, 0)
        f.AnchorPoint = Vector2.new(0.5, 0.5)
        f.BackgroundTransparency = 1
        f.BorderSizePixel = 0
        f.ZIndex = zIndex + 2
        f.Parent = btn

        local s = Instance.new("UIStroke")
        s.Thickness = 1
        s.Color = Color3.fromRGB(255, 255, 255)
        s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
        s.Transparency = h.Transparency
        s.Parent = f
    end

    -- 5. Centered GothamBlack White Label (1px upward optical lift)
    local label = Instance.new("TextLabel")
    label.Name = "Label"
    label.Text = props.Text
    label.Font = Enum.Font.GothamBlack
    label.TextSize = props.TextSize or 36
    label.TextColor3 = Color3.fromRGB(255, 255, 255)
    label.Size = UDim2.new(1, 0, 1, 0)
    label.Position = UDim2.new(0.5, 0, 0.5, -1)
    label.AnchorPoint = Vector2.new(0.5, 0.5)
    label.BackgroundTransparency = 1
    label.ZIndex = zIndex + 3
    label.Parent = btn

    local textStroke = Instance.new("UIStroke")
    textStroke.Name = "TextStroke"
    textStroke.Thickness = 3
    textStroke.Color = Color3.fromRGB(17, 23, 26) -- #11171A
    textStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual
    textStroke.Transparency = 0
    textStroke.Parent = label

    -- 6. Center-Anchored ButtonScale for 4-State Micro-Interactions
    local bScale = Instance.new("UIScale")
    bScale.Name = "ButtonScale"
    bScale.Scale = 1
    bScale.Parent = btn

    return btn
end
```

---

### 4. Multi-Device Responsive Scaling Engine

```lua
local camera = workspace.CurrentCamera

local function getDeviceScale()
    local viewport = camera.ViewportSize
    if viewport.X <= 0 or viewport.Y <= 0 then return 1 end
    -- Baseline resolution: 1050 x 620
    local scaleX = viewport.X / 1050
    local scaleY = viewport.Y / 620
    local factor = math.min(scaleX, scaleY)
    -- Clamped between 0.52 (smartphones) and 1.18 (desktop)
    return math.clamp(factor, 0.52, 1.18)
end

local function updateAllDeviceScales()
    local currentScale = getDeviceScale()
    for _, gui in ipairs(playerGui:GetChildren()) do
        if gui:IsA("ScreenGui") then
            for _, frame in ipairs(gui:GetChildren()) do
                local sc = frame:FindFirstChild("WindowScale")
                if sc and sc:IsA("UIScale") and frame.Visible then
                    sc.Scale = currentScale
                end
            end
        end
    end
end

camera:GetPropertyChangedSignal("ViewportSize"):Connect(updateAllDeviceScales)
```

---

### 5. Center-Anchored Animation Rules & Micro-Interactions

### 5.1 The Center-Anchor Mandate
ALL interactive elements MUST use `AnchorPoint = Vector2.new(0.5, 0.5)`. Scaling then animates uniformly from the visual center.

```lua
local function bindButtonAnimations(btn, scaleObj, hoverFactor, clickFactor)
    assert(btn.AnchorPoint == Vector2.new(0.5, 0.5),
        "[Check-UI] Button '" .. btn.Name .. "' must have AnchorPoint (0.5, 0.5)!")

    local tweenInfoHover = TweenInfo.new(0.08, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
    local tweenInfoClick = TweenInfo.new(0.05, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
    local tweenInfoRelease = TweenInfo.new(0.12, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

    btn.MouseEnter:Connect(function()
        playSound(hoverSound)
        TweenService:Create(scaleObj, tweenInfoHover, { Scale = hoverFactor or 1.05 }):Play()
    end)
    btn.MouseLeave:Connect(function()
        TweenService:Create(scaleObj, tweenInfoHover, { Scale = 1.0 }):Play()
    end)
    btn.MouseButton1Down:Connect(function()
        playSound(clickSound)
        TweenService:Create(scaleObj, tweenInfoClick, { Scale = clickFactor or 0.94 }):Play()
    end)
    btn.MouseButton1Up:Connect(function()
        TweenService:Create(scaleObj, tweenInfoRelease, { Scale = hoverFactor or 1.05 }):Play()
    end)
end
```

---

### 6. Continuous Rotating Sunbursts

```lua
local SUNBURST_SPEED = 20 -- degrees per second
RunService.RenderStepped:Connect(function(dt)
    if modalWindow.Visible then
        local delta = SUNBURST_SPEED * dt
        for _, sb in ipairs(sunbursts) do
            sb.Rotation = (sb.Rotation + delta) % 360
        end
    end
end)
```

---

### 7. CheckUIIcons — Production HD Icon Registry (1,022 Icons)

Check-UI ships with **1,022 production-grade HD icons (256px)** pre-uploaded as `rbxassetid://` across 10 categories:
- **Animal** (12), **Currency** (110), **Exclusive** (32), **Food** (48), **Item** (326), **Main** (236), **Nature** (86), **Player** (74), **Social** (24), **UI** (74).

```lua
local CheckUIIcons = require(game.ReplicatedStorage.CheckUI.CheckUIIcons)

-- Direct lookup
local cash = CheckUIIcons.Currency.Cash.Golden_Cash_1st
local player = CheckUIIcons.Player.Player.Player_1st

-- Path lookup
local sword = CheckUIIcons.Get("Item/Sword/Sword 1st")

-- Fuzzy search
local results = CheckUIIcons.Search("diamond")
```

---

### 8. Implementation Checklist

When building any Check-UI interface:
- [ ] **Font**: ALL text uses `Enum.Font.GothamBlack` — no exceptions
- [ ] **Canvas**: Window background is solid `#3B5866` with `BackgroundTransparency = 0`
- [ ] **Close Button**: Uses the exact 38x38 3D beveled square recipe from §3.1
- [ ] **Header Divider**: 2-tier shadow (thematic dark line 3px + pure black 3px)
- [ ] **Damier**: Full-height with 4-point vertical `UIGradient` (no horizontal cutoffs)
- [ ] **Icons**: `ScaleType = Enum.ScaleType.Fit` — never stretched
- [ ] **AnchorPoints**: ALL interactive elements use `AnchorPoint = (0.5, 0.5)` with centered `UIScale`
- [ ] **Button State Triad**: Uses the appropriate color/bevel for `Claim` (Lime), `Claimed` (Silver), `Locked` (Red)
- [ ] **Responsive**: Governed by dynamic `UIScale` based on `ViewportSize` [0.52, 1.18]
- [ ] **Sunbursts**: Rotating at 20°/sec, paused when hidden
- [ ] **Bevels**: 3px dark bottom extrusion on all buttons

## Part 2 - Check-Code (Roblox Luau standard)

Check-Code is the code counterpart of Check-UI. Each rule is short, testable and has a reason.
A piece of code is done only when every rule is PASS or NOT APPLICABLE, and every rule that could not be
checked is written down as UNVERIFIED.

### The gate

1. Read the change, file by file. For each file, go through rules 1 to 18 in order.
2. Write the Check-Code table (format below). Each row: rule, PASS / FAIL / WARN / NOT APPLICABLE / UNVERIFIED,
   and the file and line that shows it.
3. If `check_code.py` can run (see below), run it on the changed files and copy its table into your report.
   Its results count. Do not argue with a FAIL from the scanner. Fix it, or explain why the rule does not apply.
4. Fix every FAIL and run the table again. A change with any FAIL is not done.
5. WARN items are not blockers, but each one must be fixed or named in the report with a reason.
6. Where the project has `ul-luau-code` gates (rojo build, lune test, selene, stylua), run those too.
7. In Studio, when the tools are present: run the change with `execute_luau` only if it is safe (no DataStore
   writes, no reward changes), then read `get_console_output` after a `start_stop_play` run. Report what it showed.

### The rules

1. **Server owns state.** Any change to health, currency, score, inventory, rewards, spawning or purchases is
   decided on the server. A client value is a request, never a fact.
2. **Every remote handler validates.** Check, in order: type, range, ownership, then cooldown or distance.
   Only after all four does the server act.
3. **No deprecated globals.** Use `task.wait`, `task.spawn`, `task.delay`. Never `wait()`, `spawn()`, `delay()`.
   Use `os.clock()` for timing in new code, not `tick()`.
4. **Every `WaitForChild` has a timeout** and handles `nil`. A wait with no timeout can hang forever.
5. **Every lookup is nil-checked** before it is indexed: `FindFirstChild`, `GetService` on a fallible name,
   DataStore reads, `Players:GetPlayerFromCharacter`, any value that can be `nil`.
6. **Every connection has an owner.** Each `:Connect` is stored and disconnected when its owner ends, or the
   code says why it lives forever (for example, a server-wide `PlayerAdded`). See the `lifecycle-cleanup` skill.
7. **No hidden loops.** Every `while true do` has a `task.wait` in it, a way to stop, and a stop when its owner ends.
8. **No per-frame waste.** Code in `Heartbeat`, `PreSimulation`, `PostSimulation` or `RenderStepped` does no
   allocation of tables or closures, no `GetService` or `FindFirstChild` lookups, and no whole-world scans.
   Cache them outside the loop.
9. **DataStore is safe.** Read-modify-write uses `UpdateAsync`, not `GetAsync` then `SetAsync`. Every call is in
   `pcall` with retry and backoff. A failed load never writes defaults over real data.
10. **Remotes match at every end.** Each remote name is defined once (the Net module). The sender, the server
    handler and the receiver use the same argument count and types.
11. **Tunables live in Config.** Balance numbers (prices, health, speeds, timers, spawn rates, sizes) come from a
    Config table. A number in a service body is a FAIL unless it is a structural constant, such as an index or a
    pixel offset, and the code says so.
12. **Every `pcall` reports its error.** `pcall` that discards the error is a FAIL. Capture it and `warn` it, or
    return it to the caller.
13. **Pure logic is pure.** Calculations live in Core modules that take plain numbers and tables, with no
    Instance, service or remote calls, so they can be tested without Studio.
14. **Typed where it counts.** New modules use `--!strict` when the project allows it. Remote payloads and shared
    data shapes have an `export type`. Casts with `::` have a comment saying why they are safe.
15. **No invented APIs.** Every Roblox or Luau call in the change has a line in the API table with its docs page
    and signature, or is marked `-- UNVERIFIED: <API name>`. Memory is not a source.
16. **Clients do not write server state.** A client script never sets a server-owned attribute, value, or
    position that changes gameplay. Attributes that the server sets are read-only on the client by convention.
17. **Effects cannot break gameplay.** Visual and sound code is wrapped so its failure cannot stop a gameplay path.
18. **No leftovers.** No `print` debugging, no commented-out code, no unused locals, no globals created by
    accident. Selene and the scanner check these; a human checks the rest.

### API table (part of the report)

| API | Docs page read | Signature used | Side (server / client / both) |
|---|---|---|---|

Any row missing a docs page is UNVERIFIED, and every use of it is marked in the code.

### Table format

| # | Rule | Result | Where (file:line) | Note |
|---|---|---|---|---|
| 1 | Server owns state | PASS | Services/Reward.luau:12 | |

### What the scanner can and cannot do

`check_code.py` is a pattern scanner. It finds rule 3 (deprecated globals), rule 4 (WaitForChild with no timeout),
rule 5 (indexing a `FindFirstChild` result on the same line), rule 7 (`while true` with no wait nearby), rule 9
(`GetAsync` and `SetAsync` in one file), rule 12 (`pcall` with no capture), rule 18 (`print`, unused-looking
leftovers, `tick()`), and rule 14 (missing `--!strict`). It does not parse Luau, so it cannot prove rules 1, 2, 6,
8, 10, 11, 13, 15, 16 or 17. Those need a human or the model reading the code, and the table must say so.
A scanner PASS does not mean the code works. Say "passes Check-Code scan" and nothing more.
