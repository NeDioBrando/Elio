# studio-verify

Use when: any task where Studio can run, show or check the result, including any UI item and any change that should be seen running.

Use the Studio tools to check the result instead of asking the user to.
- Find before you write. Use script_search and script_grep to find existing code and instances, so you
  do not duplicate a system that already exists. Read the file with script_read.
- Inspect the hierarchy with inspect_instance before and after a change. Confirm the instances are where
  you think they are, with the names and properties you set.
- Snippets: run small checks with execute_luau. Confirm an API behaves as its docs say, read values, and
  print results. Keep each snippet short (it is cut off after about 20 seconds). Remove any instance or
  change it made. Never write to a DataStore or change rewards as a check without approval.
- Visual: after each UI item, take a screen_capture and say what it shows. Check the screen at a phone
  size and a PC size if the tool can change the window size. If you cannot change the size, say so and
  check the sizes by numbers (gui-verify). A plugin's own window can be checked with capture_plugin_gui.
- Errors: after any run, read get_console_output. Report every error and warning, even ones that look
  unrelated, and fix the ones that come from your code.
- Play: use start_stop_play to start and stop a play run. Say what you did in play and what you saw.
  Playtests need a person to judge feel, so say when that is still needed.
- Wait for jobs with wait_job_finished where a long action is started.
- Report each check with what it showed: the capture, the console output, the hierarchy, or the value.
  If a check could not run, say which one, and what you checked by reading instead.
