# docs-lookup

Use when: any Roblox API, property, event, method, enum or service you are not certain of, or any question about what Roblox currently does.

Fetch the page before any code depends on it.
- Fetch with fetch_roblox_doc. Class and enum reference: create.roblox.com/docs/reference/engine/classes/<ClassName>.
  Luau pages: create.roblox.com/docs/luau. If the exact path is unknown, fetch the section
  index and follow the link.
- Only create.roblox.com and developer.roblox.com addresses can be fetched.
- If a page fails to load, the API is unverified. Say so and ask the user to paste it.
- Record in the plan: the page URL, the exact signature, argument and return types, and
  whether it runs on the server, the client, or both.
- If the page and your memory disagree, the page wins, and you say so.
