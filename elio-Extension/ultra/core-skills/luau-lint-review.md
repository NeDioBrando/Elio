# luau-lint-review

Use when: finishing any Luau code before reporting it, or reviewing code the user gives you.

Run this list on your own output before you report. Each item is a question.
- Is every local used? Remove the unused ones.
- Did any name leak into the global environment by mistake? Every new name should be local.
- Does a local shadow an outer one with the same name, where the outer value was needed?
- Does any code call # on a table with holes, or on a dictionary-like table? Use a counter
  or a numeric loop instead.
- Does any code use pairs where the order matters? Use ipairs for arrays, or sort the keys.
- Is every FindFirstChild, GetService on a fallible name, and DataStore read checked for nil
  before it is indexed?
- Does any loop use wait() or spawn() instead of task.wait() or task.spawn()?
- Is every connection stored and disconnected when its owner is destroyed?
- Is any value compared with == where a nil and a false could differ?
- Does any string format use a wrong specifier for its type (%d with a float, %s with a table)?
- Does any function have a return path that returns nothing where a value is expected?
Report the checks that found issues, what you fixed, and any you could not decide by reading.
