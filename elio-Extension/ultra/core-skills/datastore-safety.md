# datastore-safety

Use when: saving or loading player data, leaderboards, inventories or any DataStore use.

Player data is the most expensive thing to lose. Protect it first.
- Use UpdateAsync for read-modify-write. Never read, change, then SetAsync: two servers
  can overwrite each other.
- Wrap every DataStore call in pcall. On failure, retry with backoff (a short wait that
  doubles each attempt, with a fixed maximum number of tries).
- If a load fails, do not write defaults back. Keep the session in a read-only state or
  block saves until the load succeeds. Overwriting real data with defaults is the worst bug.
- Save on meaningful events (purchase, level up, leave, server shutdown via BindToClose),
  not on every change. Batch small changes in memory.
- Keep keys versioned (for example "PlayerData_v2") so a schema change does not read bad data.
- Say in the report which DataStore calls were checked by reading and which need a
  Studio test with real data.
