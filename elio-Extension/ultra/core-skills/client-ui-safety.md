# client-ui-safety

Use when: building or changing any UI, HUD, menu or client-side display.

The client shows state. The server decides it.
- Never let a UI value decide gameplay: a button sends a request, the server answers.
- Always pass a timeout to WaitForChild on PlayerGui and on any UI child you depend on,
  and handle the case where it returns nil.
- Connect events to Instances that are guaranteed to exist. Disconnect connections when
  the UI is destroyed, or they pile up on respawn.
- Do not read text or numbers back from UI labels to compute anything. Keep the value in
  a Lua variable and update the label from it.
- Respect ScreenGui.ResetOnSpawn and check it on every respawn, so the UI rebuilds
  correctly rather than leaving stale state.
