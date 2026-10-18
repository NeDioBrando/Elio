# reference-library

Use when: any UI, icon, button, art, cosmetic or style task, or whenever you wonder what reference material exists before building.

The references/ folder holds material you should reuse, not rebuild.
- references/check-ui-repo/: the Check-UI modules. src/CheckUITheme.luau holds every colour, asset ID
  and gradient. src/CheckUIComponents.luau has createWindow, createHeader, createCloseButton,
  createStandardButton, create3DButton, createStateButton, createCardContainer, createProgressBar,
  createComparisonFlow and createRewardCard. src/CheckUIController.luau has responsive scaling and
  button animations. src/CheckUIIcons.luau is an icon registry of 1,022 icons. examples/ has one full
  menu per archetype: Shop, Codes, Rebirth, Settings and Daily Rewards. Start from the closest match.
  DESIGN_SYSTEM.md and README.md hold the full specification and the reasons behind each rule.
  Copy a module into the same folder as the screen that requires it, because the components require
  CheckUITheme beside them.
- references/check-ui/: SKILL.md (the full standard) and Copy_And_Paste_Skill_full_rules.txt (the short
  rules that check-ui-rules is built from).
- references/button-art/: two sheets of button art, for the Shop, Codes, Leaderboard, Rebirth and Daily
  Rewards looks. Match the style with these, not with invented colours.
- references/vector-hats/: hat art in SVG and PNG at 64 and 256 px, filled and outline versions, in
  folders named Santa Hat, Top Hat, Umbrella Hat, Beret, Sombrero, Chef Hat, Sleeping Cap, Wizard Hat,
  Robin Hood Cap, Detective Hat, Beanie and Party Hat 2. Each folder has a License.url file. Read the
  licence before any hat art is used in a shipped game. Do not use an image whose licence you have not
  read.
- references/gui-verify/ and references/gui-syntax/: the verifier and the syntax example, used by the
  gui-verify and gui-syntax skills. references/check_gui_syntax.py is a syntax checker that needs
  Roblox's API dump to run (see the file's header).
Rules:
- Reuse a reference component before writing a new one. If you do not use one, say why.
- If a reference is missing from the folder, say so and stop that part. Do not recreate it from memory.
- Known issue: the reference lists the same sound ID (6895079853) for hover and click. Confirm it before use.
- Samples in the reference define no playerGui, RunService or TweenService. Define them before use.
