# toolbox

Use when: an item needs a ready-made model, mesh, sound, icon, interface kit or texture, or the user asks to use the Toolbox.

Plan the asset, search for it, check it, then bring it in.
- Plan first: each asset is a row with its name, what it is for, and why the item needs it. If you
  cannot write a reason, drop the row.
- Search with specific terms, such as "shop UI template" or "wooden crate, low poly", not one word.
  Compare at least three results by name, creator and type (Model, MeshPart, Sound, Decal, GUI kit).
  Say why you chose one.
- Check before you insert. Note the creator. Before you insert, look for Script and LocalScript
  objects inside it. A free model or GUI can carry hidden code. Read every script and remove any the
  game does not need.
- Insert with the Toolbox insert tool in your tool list. Then measure the world-space size and the
  pivot before you place it. For placement, see map-placement. For GUI, see expert-gui.
- Anything the game must keep belongs in the source files Rojo serves (an .rbxmx file in src/).
  Code that creates it at runtime does not survive a sync.
- Keep asset IDs in a Config module, not in a script. Never invent an ID.
- If the search finds nothing, or an asset does not load, say so. Use a clearly named placeholder
  and list it as missing. Never leave a silent gap.
- In the report, list each asset: name, creator, asset ID, what it is used for, and what you changed.
