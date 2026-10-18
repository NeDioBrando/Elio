# parallel-luau

Use when: a task has heavy computation that could block the main thread, or the user asks for multi-threaded or parallel work, or a server runs too many expensive calculations per tick.

Parallel Luau runs work on other threads. Use it only when the work is heavy and self-contained.
- Work must be parallel-safe. Code that runs in parallel cannot freely read or change most
  Instances and game state. Pure math on plain numbers, tables and vectors is the good case.
- Keep the data flow explicit. Send inputs in, get results back, and apply the results to
  the game on the normal thread. Do not mutate the world from parallel code.
- Structure the work with Actors: an Actor holds its own parallel scripts. Pass messages
  between the main thread and an Actor. Check the exact message and binding functions on
  the docs page before use (Actor and its message methods) and quote them in the plan.
- Use task.desynchronize() and task.synchronize() to move the current thread between the
  parallel phase and the normal phase. Verify their exact behaviour on the docs page first.
- Do not parallelize small or cheap work. The overhead of moving data costs more than it saves.
- Measure before and after with luau-profiling. If there is no gain, remove the parallel path.
- Mark any parallel code that touched an instance or a Roblox service as UNVERIFIED until a
  docs page or a Studio run confirms it works.
