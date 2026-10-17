# check-ui-standard

Use when: a cartoon, simulator or tycoon look, or when the user names Check-UI. Full text: references/check-ui/SKILL.md.

Non-negotiable rules:
1. Font: every text object uses Enum.Font.GothamBlack, with a black UIStroke of 2.0 to 3.5 px.
2. Window canvas: solid Color3.fromRGB(59, 88, 102), BackgroundTransparency 0, UICorner 4 px,
   outer UIStroke 3.5 px in #181E22. Never semi-transparent.
3. Close button: 38 x 38 px, dark burgundy bevel #730010 under the face, face gradient
   #FF7DAF to #FF1428, white GothamBlack "X", child UIScale.
4. Header: 60 px tall, ending in a two-tone divider: 3 px dark thematic bar, then 3 px black bar.
5. Checkerboard: rbxassetid://385956923 at full height, vertical UIGradient transparency
   1 -> 0.82 -> 0.35 -> 0.10.
6. Icons: ScaleType = Enum.ScaleType.Fit. Never stretched.
7. Responsive: factor = min(ViewportSize.X / 1050, ViewportSize.Y / 620), clamped 0.52 to 1.18.
8. Centre anchor: every interactive element has AnchorPoint (0.5, 0.5) and a child UIScale.
9. Five archetypes: Shop, Codes, Rebirth, Settings, Daily Rewards. Each header is 60 px with the
   same divider and its own gradient (see the reference).
10. Iconless buttons (Throw, Action, Jump, Redeem, Confirm): sharp corners, NO UICorner, a 3 px
    #0C141A border, a 90-degree gradient, a black checkerboard fading 0.91 -> 0.62, three inner
    highlight frames, and a centred white GothamBlack label with a 3 px #11171A stroke.
11. Button states: Claim lime #B4FF19 -> #69E100 (bevel #0F780F). Claimed silver #D8DEE4 ->
    #94A0B0 (bevel #485260). Locked crimson #FF2050 -> #D00020 (bevel #700010). Skip amber
    #FFD000 -> #FF8C00 (bevel #994C00).
12. Every button has a 3 px dark bottom bevel.
13. Sunbursts rotate at 20 degrees per second, only while visible.

Confirm each asset ID loads before use, and keep IDs in a Config module. The reference lists
6895079853 for both hover and click sounds, which looks like a copy error. Define every variable
the samples use (playerGui, RunService, TweenService) before use.
