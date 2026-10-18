# check-cycle

Use this user-provided reference only when it helps the current project request. Adapt paths, assets, style and APIs to the actual project and available elio tools: use the official Roblox docs tools listed by list_commands where it names fetch_roblox_doc, and the Toolbox/Creator Store tools listed by list_commands where it names search_creator_store or insert_from_creator_store. elio can run Studio tools, so verify with them instead of waiting for the user. The current user scope takes priority. Keep working features. Do not impose extra search loops or ask the user to continue after every component. Use actual tests when tools permit; report what remains untested.

When relevant: every item, before it is marked done.

Read the item's code against this list. Say pass or fail for each line.
- It parses: every function, if, for and do is closed, and no stray characters remain.
- Names exist: every require path, service name and instance name is spelled the same place it is defined.
- Remote arguments match at all three ends: the sender, the server handler and the receiver.
- The server validates every client value: type, range, ownership, then distance or cooldown.
- Every tunable number, such as prices, sizes or timers, comes from a Config module.
- No wait(), spawn() or delay(). Use task.wait, task.spawn and task.delay.
- Every connection is kept or disconnected. Nothing rebuilds a whole screen every frame.
- Every Roblox API the item uses was looked up in this cycle, or is listed as unverified.
- A check that cannot find its target fails. "Not found" is a fail, not a pass.
If any line fails, fix it and run this list again.
