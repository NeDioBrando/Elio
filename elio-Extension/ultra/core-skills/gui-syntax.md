# gui-syntax

Use when: every GUI script, before it is marked done. Example: references/gui-syntax/example.lua.

Roblox-valid GUI code. These rules come from Roblox's API dump.
- Create with Instance.new("ClassName"). Set properties, then Parent last.
- Text lives on TextButton and TextLabel. ImageButton and ImageLabel have no Text or Font.
- Clicks: Activated (mouse, touch and gamepad). MouseButton1Click is mouse and touch only.
- Enums in full and spelled exactly: Enum.Font.GothamBlack, Enum.ApplyStrokeMode.Border,
  Enum.ScaleType.Fit, Enum.ZIndexBehavior.Sibling.
- A ScreenGui from a LocalScript goes under PlayerGui: screen.Parent = player:WaitForChild("PlayerGui").
- UDim2.new takes four numbers. UDim.new takes two. Color3.fromRGB takes 0 to 255. Color3.new
  takes 0 to 1. Vector2.new takes two.
- Transparency is 0 to 1. ColorSequence and NumberSequence keypoints run from 0 to 1, in order,
  starting at 0 and ending at 1.
- Image properties take "rbxassetid://<id>". Icons use ScaleType.Fit. Repeating textures use ScaleType.Tile.
- UICorner.CornerRadius = UDim.new(0, pixels). UIGradient.Color is a ColorSequence.
  UIGradient.Transparency is a NumberSequence.
The user can run check_gui_syntax.py on the script. It checks class names, property names, events,
enum values and argument counts for variables made with Instance.new in the same file. It does not
catch undefined variables, and a pass does not prove the code runs.
