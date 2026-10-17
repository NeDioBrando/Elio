# luau-profiling

Use when: checking whether a change made the game faster or slower, finding what is slow, or before and after any optimization claim.

Measure first, change second, measure again.
- Time a block with os.clock() before and after the code. Run it many times in a loop so
  the number is not noise, then divide to get a per-run cost. One run tells you nothing.
- Label sections for the Microprofiler with debug.profilebegin("label") and
  debug.profileend(). Name them so the report can point at them.
- If execute_luau is present, run the benchmark there: a small snippet that loads the
  function, runs it N times, and prints the average. Never benchmark with a DataStore write,
  a reward change or a change to the user's place.
- Remove benchmark instances and temporary code afterward. Confirm the place is clean.
- Compare the same test before and after: same N, same inputs, same map. Report both numbers.
- If a playtest is needed to see the real cost (many players, real network), name the
  steps for the user to run, and say the numbers are not yet measured.
- Never say something is faster from reading alone. Say "should be faster, not measured."
- Do not optimize code that is not hot. A cold path made faster is wasted complexity.
