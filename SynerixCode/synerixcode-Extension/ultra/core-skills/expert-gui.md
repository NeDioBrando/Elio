# expert-gui

Use when: any Roblox interface: architecture, layout, performance, input, responsiveness.

Architecture
- The UI reads state and sends requests. The server decides game state (see the server line in
  check-cycle). Keep UI code in a client Controller and layout code in pure modules where possible.
- One ScreenGui per window or HUD. Set ResetOnSpawn on purpose: false for a persistent HUD, and
  rebuild the parts that must survive respawn.
- Build a screen once and show or hide it with Visible or Enabled. Do not destroy and rebuild
  it on every open.
- Render lists from data. Keep one hidden template, clone it for each item, and update only the
  items whose data changed. Remove the rest.
- Listen to changes (GetAttributeChangedSignal, remote events) instead of polling in a loop.
  Never update text or positions every frame unless the thing really moves each frame.
- Disconnect connections when a screen closes, and destroy what it created.

Performance
- Every GuiObject costs. Use fewer, larger elements. Do not build a 500-cell grid as 500
  hand-made frames when a UIGridLayout does it.
- ClipsDescendants and AutomaticSize cost more on large lists. Use them only where the layout needs them.
- Put decorative UIStroke and UIGradient on a template, not on every item of a long list.
- Use ImageRectOffset and ImageRectSize for sprite sheets, not many images.
- Tween a few things at a time. Keep tweens short. Cancel a tween before starting a new one on the same object.
- Keep ZIndex stable. Changing ZIndex across a big tree forces re-sorting.

Layout
- Use UIListLayout, UIGridLayout and UIPadding. Do not hand-place repeated items.
- Size with UIScale for whole windows (see check-ui-standard for the clamp), UISizeConstraint for
  a range, and UIAspectRatioConstraint for icons and cards.
- Labels: TextScaled with UITextSizeConstraint, or AutomaticSize where the text sets the size.
- Touch targets: keep buttons at least 44 px on a phone. Leave 8 px or more between targets.
- Test at phone portrait, phone landscape and a PC window. Test with 0 items, 1 item and many items.

Input and access
- Buttons respond to Activated, which covers mouse, touch and gamepad.
- Make every button reachable by gamepad: Selectable = true, in a sensible order.
- Show a clear pressed state and a disabled state. Do not rely on hover.
- Respect the top bar and safe areas.

Anti-patterns to reject
- Creating GUI inside a loop without a template. wait() or spawn() (use task.*). Hard-coded
  pixel positions for everything. Changing text every frame. Duplicate ScreenGuis for one
  window. Client-side prices or rewards shown as final before the server confirms.
