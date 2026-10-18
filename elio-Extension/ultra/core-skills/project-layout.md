# project-layout

Use when: starting a project, adding a system, or deciding where code belongs.

- Pure logic goes in src/shared/Core/. Core code takes plain numbers, not Vector3 or
  CFrame, so it can be tested without Studio. Build the Vector3 at the edge, in a Service
  or Controller.
- Instances live at the edges: Services (server) and Controllers (client).
- Every remote event is declared in one Net module, with its name in one place.
- Every tunable number lives in a Config module under src/shared/Config/. A balance
  change should be an edit to that table, never to a service.
- Disk is the source of truth. Keep code in scripts and do not rely on edits made by
  hand inside Studio.
- Anything the game must keep has to be in the source files Rojo serves. Rojo removes
  instances in its folders that are not in source, and it does this on every connect,
  so a runtime-created instance in those folders is lost the next time Studio syncs.
