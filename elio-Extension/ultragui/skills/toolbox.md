# toolbox

Use this user-provided reference only when it helps the current project request. Adapt paths, assets, style and APIs to the actual project and available elio tools: use the official Roblox docs tools listed by list_commands where it names fetch_roblox_doc, and the Toolbox/Creator Store tools listed by list_commands where it names search_creator_store or insert_from_creator_store. elio can run Studio tools, so verify with them instead of waiting for the user. The current user scope takes priority. Keep working features. Do not impose extra search loops or ask the user to continue after every component. Use actual tests when tools permit; report what remains untested.

When relevant: an item needs a ready-made icon, interface kit, model, mesh or sound.

- Plan the asset first: a name, what it is for, and why the item needs it.
- Search with specific terms: "shop UI template", "inventory grid ui". Compare at least three
  results by name, creator and type, and say why you chose one.
- Before you insert, look for Script and LocalScript objects inside it. Read every one and remove
  any the screen does not need. A free GUI can carry hidden code.
- Insert with insert_from_creator_store. Measure it, then fix anything that touches another
  element, is off centre, or sits under the top bar.
- Anything the game must keep belongs in the source files Rojo serves (.rbxmx). Code that creates it
  at runtime does not survive a sync.
- Keep asset IDs in a Config module, not in a script. Never invent an ID.
- Report each asset: name, creator, asset ID and what you changed.
