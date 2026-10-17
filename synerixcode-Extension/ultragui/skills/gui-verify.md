# gui-verify

Use this user-provided reference only when it helps the current project request. Adapt paths, assets, style and APIs to the actual project and available synerixcode tools: use the official Roblox docs tools listed by list_commands where it names fetch_roblox_doc, and the Toolbox/Creator Store tools listed by list_commands where it names search_creator_store or insert_from_creator_store. synerixcode can run Studio tools, so verify with them instead of waiting for the user. The current user scope takes priority. Keep working features. Do not impose extra search loops or ask the user to continue after every component. Use actual tests when tools permit; report what remains untested.

When relevant: any screen before it is called done.

Verify by numbers first. In play, the verifier in references/gui-verify/ checks that elements
are on screen, siblings keep 8 px gaps and do not overlap, text fits its box, and elements marked
Centred sit in the middle of their parent. Place gui_rules.lua as a ModuleScript and
verify_gui.client.lua as a LocalScript beside it. Run it in Play with a character alive. Mark
deliberate overlaps Overhang = true.
When it cannot run, check the same things in the code's numbers and say so in the report.
Check every button path, every state (default, hovered, pressed, disabled, empty), the phone and PC
sizes, and that closed screens leave no connections behind.
Say what was checked by numbers, what by reading, and what needs a person in play.
