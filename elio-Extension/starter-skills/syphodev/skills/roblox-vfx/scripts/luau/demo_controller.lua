-- VFXDemo - LocalScript. Put in StarterPlayer > StarterPlayerScripts.
--
-- One key and one on-screen button per effect. The buttons exist as well as the
-- keys because a keyboard-only demo is unusable on a phone and, more to the
-- point, gives you nothing to read: with the list on screen you can see what is
-- bound to what without going back to the source.
--
-- Effects are built on the CLIENT, so what you see is instant and local. If you
-- want other players to see them, fire this from the server instead - the module
-- takes the character to build on as its second argument for exactly that.

local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local Scenes = require(ReplicatedStorage:WaitForChild("VFXScenes"))

local KEYS = {
	Enum.KeyCode.One, Enum.KeyCode.Two, Enum.KeyCode.Three, Enum.KeyCode.Four,
	Enum.KeyCode.Five, Enum.KeyCode.Six, Enum.KeyCode.Seven, Enum.KeyCode.Eight,
}
local LABEL = { "1", "2", "3", "4", "5", "6", "7", "8" }

local gui = Instance.new("ScreenGui")
gui.Name = "VFXDemo"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = player:WaitForChild("PlayerGui")

local panel = Instance.new("Frame")
panel.Size = UDim2.new(0, 260, 0, 34 * #Scenes.names + 52)
panel.Position = UDim2.new(0, 18, 0.5, -(34 * #Scenes.names + 52) / 2)
panel.BackgroundColor3 = Color3.fromRGB(18, 19, 26)
panel.BackgroundTransparency = 0.15
panel.BorderSizePixel = 0
panel.Parent = gui
Instance.new("UICorner", panel).CornerRadius = UDim.new(0, 10)
local stroke = Instance.new("UIStroke", panel)
stroke.Color = Color3.fromRGB(70, 74, 96)
stroke.Thickness = 1

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -20, 0, 34)
title.Position = UDim2.new(0, 10, 0, 8)
title.BackgroundTransparency = 1
title.Font = Enum.Font.GothamBold
title.TextSize = 15
title.TextColor3 = Color3.fromRGB(235, 238, 250)
title.TextXAlignment = Enum.TextXAlignment.Left
title.Text = "VFX  ·  press a number"
title.Parent = panel

local list = Instance.new("Frame")
list.Size = UDim2.new(1, -20, 1, -50)
list.Position = UDim2.new(0, 10, 0, 44)
list.BackgroundTransparency = 1
list.Parent = panel
local layout = Instance.new("UIListLayout", list)
layout.Padding = UDim.new(0, 4)
layout.SortOrder = Enum.SortOrder.LayoutOrder

local status = Instance.new("TextLabel")
status.Size = UDim2.new(1, -20, 0, 16)
status.Position = UDim2.new(0, 10, 1, -20)
status.BackgroundTransparency = 1
status.Font = Enum.Font.Gotham
status.TextSize = 12
status.TextColor3 = Color3.fromRGB(120, 126, 150)
status.TextXAlignment = Enum.TextXAlignment.Left
status.Text = "ready"
status.Parent = panel

local buttons = {}

local function fire(i)
	local name = Scenes.names[i]
	if not name then return end
	local ok, err = Scenes.play(name)
	status.Text = ok and (Scenes.titles[name] or name)
		or ("could not play: " .. tostring(err))
	for j, b in ipairs(buttons) do
		b.BackgroundColor3 = (j == i and ok) and Color3.fromRGB(58, 96, 168)
			or Color3.fromRGB(34, 36, 48)
	end
end

for i, name in ipairs(Scenes.names) do
	local b = Instance.new("TextButton")
	b.Size = UDim2.new(1, 0, 0, 30)
	b.LayoutOrder = i
	b.BackgroundColor3 = Color3.fromRGB(34, 36, 48)
	b.BorderSizePixel = 0
	b.AutoButtonColor = true
	b.Font = Enum.Font.Gotham
	b.TextSize = 14
	b.TextColor3 = Color3.fromRGB(226, 230, 244)
	b.TextXAlignment = Enum.TextXAlignment.Left
	b.Text = "   " .. (LABEL[i] or i) .. "   " .. (Scenes.titles[name] or name)
	b.Parent = list
	Instance.new("UICorner", b).CornerRadius = UDim.new(0, 6)
	b.Activated:Connect(function() fire(i) end)
	buttons[i] = b
end

UIS.InputBegan:Connect(function(input, processed)
	if processed then return end     -- do not steal a keypress meant for a text box
	for i, k in ipairs(KEYS) do
		if input.KeyCode == k then fire(i) return end
	end
	if input.KeyCode == Enum.KeyCode.Zero then
		Scenes.stop()
		status.Text = "stopped"
		for _, b in ipairs(buttons) do b.BackgroundColor3 = Color3.fromRGB(34, 36, 48) end
	end
end)

-- A respawn invalidates the character the last effect was built on, and the
-- teardown that would have restored its transparency belongs to a character
-- that no longer exists.
player.CharacterAdded:Connect(function()
	Scenes.stop()
	status.Text = "ready"
	for _, b in ipairs(buttons) do b.BackgroundColor3 = Color3.fromRGB(34, 36, 48) end
end)

status.Text = #Scenes.names .. " effects loaded  ·  0 clears"
