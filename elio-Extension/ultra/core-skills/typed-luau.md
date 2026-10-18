# typed-luau

Use when: writing new modules, shared code, remote payloads or config tables, or when the project uses --!strict.

Types catch bugs before the game runs. Use them where they pay off.
- Put --!strict at the top of new modules when the project allows it. Check the project's
  existing mode first; do not switch an existing file's mode silently.
- Define shapes with export type, so the server, client and config agree on the same data.
    export type PlayerStats = { coins: number, level: number }
- Type the arguments and return values of every function that crosses a module or a remote.
- Use generics only when a second caller needs them. Do not add generics for one use.
- Type-annotate remote payloads at both ends, and the Config table at its definition.
- Use the type checker: when an annotation is wrong, the code is wrong. Fix the code.
  Do not cast with :: to silence a real error. A cast needs a comment saying why it is safe.
- Check whether --!optimize 2 is in the project before adding it. It changes how the code
  behaves in debugging, so note it in the report if you add it.
- Verify the type syntax against the Luau docs page before use, if you are not certain of it.
