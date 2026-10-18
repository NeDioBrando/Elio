# api-watchlist

Use when: any task that uses one of the APIs listed below, or the first Luau code written in a session.

These APIs are used often. Their exact names, arguments and return types are the
most likely places for a mistake, so they follow a stricter rule.
- Before the first use of any API below in a task, fetch its docs page with fetch_roblox_doc
  and quote the signature in the plan. Do not write it from memory, even if it looks familiar.
- The list (fetch and confirm each one you use):
  task.spawn, task.defer, task.delay, task.wait, task.cancel, task.desynchronize, task.synchronize
  table.create, table.move, table.concat, table.freeze, table.clear
  string.format, string.rep, string.find
  os.clock, os.time, debug.profilebegin, debug.profileend
  buffer (any buffer.* function you use)
  game:GetService, Instance.new, Instance:FindFirstChild, Instance:WaitForChild,
  Instance:GetDescendants, Instance:GetChildren, Instance:Destroy
  RunService.Heartbeat, RunService.PreSimulation, RunService.PostSimulation
  CollectionService:GetTagged, CollectionService:GetInstanceAddedSignal
  RemoteEvent:FireServer, RemoteEvent:FireClient, RemoteEvent.OnServerEvent
  DataStoreService:GetDataStore, DataStore:UpdateAsync, DataStore:GetAsync
  Players.PlayerAdded, Players.PlayerRemoving, Players:GetPlayers
  Actor, Actor:SendMessage, task.desynchronize, task.synchronize
- Record the page URL and the exact signature in the report. If a page cannot be fetched,
  the API is unverified: mark each use with a comment: -- UNVERIFIED: <API name>.
- Do not add an API to this list from memory. Add it only after its page has been read.
