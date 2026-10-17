# lifecycle-cleanup

Use when: any code that creates connections, tasks, Instances or UI for a character, round, match, player or tool that later ends.

Everything created for something that ends must be released when it ends.
- Keep a single cleanup list per owner: connections, spawned tasks, temporary Instances.
  Release all of them in one function. A Janitor or Maid style module is a good fit when
  the project already has one. Check the project before adding a new one.
- Disconnect every signal connection you created. Destroying an Instance does not
  disconnect connections made to other objects, so do this explicitly.
- Cancel a task you started with task.delay or task.spawn when its owner ends, by keeping
  the thread handle and calling task.cancel on it.
- Respawn is the common leak. Connections made on CharacterAdded must be removed on the
  character's Died or AncestryChanged, or they stack up on every respawn.
- Remove the players table entries on PlayerRemoving, after the data save is complete.
- Test the cleanup path, not only the happy path: a player who leaves mid-round, a round
  that ends while a timer runs, a tool that is dropped mid-use.
- In the report, say which connections and tasks are released where, and which you could
  not confirm by reading.
