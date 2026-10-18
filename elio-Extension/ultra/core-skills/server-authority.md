# server-authority

Use when: any feature where a player's action changes game state (damage, purchases, scoring, spawning, inventory, rewards).

The server owns the game. Clients own the display (input, camera, UI, effects).
- Every value that arrives from a client is a request. Check, in this order: type, then
  range, then ownership, then distance or cooldown. Only after all four is it a fact.
- Never trust a client's score, health, currency or position for a reward.
- Movement is the one common exception: fast first-person movement is often client-side.
  If you do that, keep the consequences (score, elimination, rewards) on the server.
