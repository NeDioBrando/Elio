-- LocalScript template: StarterPlayer.StarterPlayerScripts.CustomAnimationKeys
--
-- Binds keys to the KeyframeSequences that `to_roblox.py` put in
-- ReplicatedStorage.CustomAnims. Registers them into playable ContentIds at
-- RUNTIME, so nothing is uploaded to Roblox.
--
-- Those ids are SESSION-LOCAL. Fine for testing; publishing needs real uploads.
-- Edit BINDS, paste the whole thing into a LocalScript's Source.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local KeyframeSequenceProvider = game:GetService("KeyframeSequenceProvider")

local BINDS = {
	[Enum.KeyCode.K] = "RoundhouseKick",
	[Enum.KeyCode.P] = "RightCross",
}
local FADE = 0.08
local MIRROR_ONTO = "AnimationTester"   -- a dummy to mirror onto, or nil

local player = Players.LocalPlayer

-- On-screen status. A failure must be visible WITHOUT opening Output: play-mode
-- output is often unreachable from tooling, so the page has to diagnose itself.
local gui = Instance.new("ScreenGui")
gui.Name = "CustomAnimHint"
gui.ResetOnSpawn = false
local box = Instance.new("TextLabel")
box.Size = UDim2.fromOffset(360, 74)
box.Position = UDim2.new(0, 12, 1, -86)
box.BackgroundTransparency = 0.3
box.BackgroundColor3 = Color3.fromRGB(18, 18, 22)
box.Font = Enum.Font.Code
box.TextSize = 15
box.TextXAlignment = Enum.TextXAlignment.Left
box.TextYAlignment = Enum.TextYAlignment.Top
box.TextColor3 = Color3.fromRGB(235, 235, 240)
box.Text = "  loading animations..."
box.Parent = gui
gui.Parent = player:WaitForChild("PlayerGui")

local state = { ids = 0, rig = "not bound", ok = false }
local hint = {}
for key, name in pairs(BINDS) do table.insert(hint, ("[%s] %s"):format(key.Name, name)) end
table.sort(hint)
local function refresh()
	box.TextColor3 = state.ok and Color3.fromRGB(235,235,240) or Color3.fromRGB(255,150,150)
	box.Text = ("  %s\n  animations: %d    you: %s"):format(table.concat(hint, "   "), state.ids, state.rig)
end

local folder = ReplicatedStorage:WaitForChild("CustomAnims", 20)
if not folder then state.rig = "CustomAnims MISSING" refresh() return end

local ids = {}
for _, seq in ipairs(folder:GetChildren()) do
	if seq:IsA("KeyframeSequence") then
		-- BARE ContentId only: "hash://" and "rbxasset://" both fail
		local ok, id = pcall(function() return KeyframeSequenceProvider:RegisterKeyframeSequence(seq) end)
		if ok and id then ids[seq.Name] = id state.ids += 1
		else warn(("[CustomAnims] register failed for %s: %s"):format(seq.Name, tostring(id))) end
	end
end
refresh()

local rigs = {}
local function bindRig(model, label)
	local humanoid = model:FindFirstChildOfClass("Humanoid")
	if not humanoid then return end
	local animator = humanoid:FindFirstChildOfClass("Animator") or humanoid:WaitForChild("Animator", 5)
	if not animator then return end
	local isR15 = humanoid.RigType == Enum.HumanoidRigType.R15
	if label == "player" then
		state.rig = isR15 and "R15 ok" or (humanoid.RigType.Name .. " - NEEDS R15")
		state.ok = isR15 and state.ids > 0
		refresh()
	end
	if not isR15 then
		warn(("[CustomAnims] %s is %s - these are R15 animations."):format(label, humanoid.RigType.Name))
	end
	local rig = { model = model, tracks = {}, playing = nil }
	for name, id in pairs(ids) do
		local anim = Instance.new("Animation")
		anim.Name, anim.AnimationId = name, id
		local ok, track = pcall(function() return animator:LoadAnimation(anim) end)
		if ok and track then rig.tracks[name] = track
		else warn(("[CustomAnims] %s: LoadAnimation failed for %s"):format(label, name)) end
	end
	rigs[label] = rig
end

local function play(name)
	for label, rig in pairs(rigs) do
		if rig.model.Parent and rig.model:FindFirstChildOfClass("Humanoid") then
			local track = rig.tracks[name]
			if track then
				if rig.playing and rig.playing.IsPlaying then rig.playing:Stop(FADE) end
				track:Play(FADE)
				rig.playing = track
			end
		else
			rigs[label] = nil   -- respawned or streamed out
		end
	end
end

local function onCharacter(char)
	char:WaitForChild("Humanoid", 10)
	rigs.player = nil
	bindRig(char, "player")
end
if player.Character then task.spawn(onCharacter, player.Character) end
player.CharacterAdded:Connect(onCharacter)

if MIRROR_ONTO then
	task.spawn(function()
		local d = workspace:WaitForChild(MIRROR_ONTO, 20)
		if d then bindRig(d, MIRROR_ONTO) end
	end)
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end
	local name = BINDS[input.KeyCode]
	if name then play(name) end
end)
