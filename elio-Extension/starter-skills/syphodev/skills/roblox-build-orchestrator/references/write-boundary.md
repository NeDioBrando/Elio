# Why one thread owns every write

Read this once. It is the constraint that makes the rest of the design safe, and
it is the one most likely to get quietly relaxed on a bad afternoon.

## The general rule

Read actions parallelise. Write actions do not. When several agents write to
shared state at once they make implicitly conflicting decisions, and reconciling
those decisions afterwards costs more than doing the work serially would have.

This is the one point every serious practitioner account agrees on. Cognition
published *Don't Build Multi-Agents*, then reversed to shipping them, and the only
thing that changed was making writes single-threaded. LangChain frames it as a
property of the actions themselves. Anthropic's own research system fans out for
reading and then does synthesis in a single main agent in one unified call.

## Why it binds harder here

The Roblox DataModel is a single shared mutable tree. There is no merge, no
transaction, and no conflict detection. Two agents calling `execute_luau` against
the same place are not racing over a file that a diff could reconcile later; they
are mutating one live object graph, and the loser of the race leaves no trace.

This failure has already happened twice in practice, from two different causes:

- **The robloxstudio-mcp duplicate-server deadlock.** Two servers long-polling for
  commands produced a timeout deadlock that only cleared by killing all of them and
  respawning exactly one. Hence the rule of exactly one MCP server connected.
- **Rojo double-connection duplicates.** Two plugin connections doubled every new
  file, which produced duplicate ModuleScripts, which made `Knit.AddControllers`
  throw, which killed every controller and made the guns vanish. The visible
  symptom was three layers away from the cause.

Both were single-agent bugs caused purely by *two connections*. Adding a second
agent that writes is the same fault with an extra source of nondeterminism on top.

A third precedent from a different domain is the same lesson: two parallel
browser-automation runs once put six headless browsers into contention, which produced thin
page renders, which produced unreliable reads, which silently dropped real
results. Parallelism has to be capped exactly where it corrupts the inputs. This
is that cap.

## What this means in practice

**Workers produce files.** Meshes, `.model.json`, KeyframeSequence specs, audio,
texture maps, findings documents. Files are diffable, inspectable, and safe to
produce concurrently because the filesystem has real isolation and each worker owns
a distinct path.

**One thread does every Studio interaction.** `execute_luau`, `insert_asset`,
`mass_create_objects`, assembly, playtest, publish. It reads the manifests the
workers wrote and applies them in a known order.

This costs nothing to adopt, because the existing skills already emit files rather
than mutating Studio directly. `roblox-ui` emits a `.model.json` and a Luau
builder. `roblox-3d-model` emits meshes. `roblox-animation` emits a spec. The
boundary was already there; this just stops anything from crossing it.

## Enforce it with the allowlist, not the prompt

Every worker definition carries `disallowedTools: mcp__robloxstudio-mcp`. That is
deliberate and it is not redundant with the instructions in the body of the file.

A prompt is a request, and a model under time pressure with a blocked task and a
Studio tool visible in its list will eventually reach for it, entirely reasonably,
because from inside that context it looks like the helpful thing to do. An
allowlist is a boundary the harness enforces, so the question never arises.

If you add a worker, copy the `disallowedTools` line first and write the body
second.

## The one exception worth naming

The publish step and the Open Cloud audio upload are also single-writer, for a
different reason: the audio upload quota is create-only and monthly, so every
regeneration permanently burns a slot. A worker that could upload would be able to
exhaust the quota without the manager knowing. That is why `roblox-asset-sfx`
gathers files and records licences but never uploads.
