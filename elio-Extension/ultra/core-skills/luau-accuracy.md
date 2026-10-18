# luau-accuracy

Use when: writing or reviewing any Luau code that calls a Roblox or Luau API.

Hallucinated code is the most common failure. Prevent it before it is written.
- Every API call in the code must map to a line in a fetched docs page. Keep a short
  table in the plan: API, page read, signature, side (server, client or both).
- Common mistakes to check against the page, not memory: wrong argument order, a method
  called with a dot instead of a colon (and the reverse), a property that is read-only,
  a property name that is close to a real one but not the same, and an event that
  does not exist on that class.
- Luau is not Lua 5.1. Use Luau syntax: type annotations are optional, compound
  assignment (+=) is valid, and string interpolation is not built in (use string.format
  or ..). Check any standard library function you are not sure of.
- Check return types. Many calls return nil on failure (FindFirstChild, GetService on a
  bad name, DataStore reads). Handle nil before indexing.
- If you cannot find a function on a docs page after two tries, do not replace it with
  a plausible one. Report it as unverified and stop that line.
- Mark any line you could not verify with a comment: -- UNVERIFIED: <API name>. Do not
  ship it silently.
