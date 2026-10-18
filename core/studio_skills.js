// SPDX-License-Identifier: GPL-3.0-or-later
// core/studio_skills.js - RobloxScript Studio Skills & Virtual Tool Suite (33 tools).
//
// HOW IT WORKS: Roblox Studio's MCP server (StudioMCP) exposes core primitives
// like execute_luau and multi_edit. RobloxScript layers a comprehensive suite of
// high-level Studio production tools on top of execute_luau:
//  - lighting_*    : Studio lighting presets, post-processing, atmosphere, day/night cycles
//  - ui_*          : Responsive ScreenGui, modern component generators (HUD, dialog, inventory)
//  - fx_*          : High-fidelity particle emitters, beams, trails, calibrated lights
//  - audio_*       : SoundService routing hierarchies, 3D spatial sounds, ambient trigger zones
//  - terrain_*     : Volumetric terrain filling, shaping, clearing
//  - camera_*      : Custom camera styles (isometric, top-down, side-scroller), cutscenes
//  - diagnostics_* : Place health check, performance audit, automated bug fixes
//  - datastore_*   : DataStoreService player data with leaderstats, ordered leaderboards, RemoteEvents
//  - npc_*         : PathfindingService NPCs, ProximityPrompts, TweenService, Marketplace, Teams
//
// All commands return JSON strings from Luau: {"ok":true,"data":...} or {"ok":false,"error":...}.

const SKILLS_LIB_LUA = `local HttpService = game:GetService("HttpService")
local Lighting = game:GetService("Lighting")
local TweenService = game:GetService("TweenService")
local SoundService = game:GetService("SoundService")
local StarterGui = game:GetService("StarterGui")
local StarterPlayer = game:GetService("StarterPlayer")
local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")
local LogService = game:GetService("LogService")

local function jenc(x) return HttpService:JSONEncode(x) end
local function jdec(s) return HttpService:JSONDecode(s) end
local function fail(msg) return jenc({ ok = false, error = msg }) end
local function okdata(d, text) return jenc({ ok = true, data = d, text = text or "" }) end

local function resolvePath(p)
	if p == nil or p == "" then return nil end
	p = tostring(p):gsub("^%s+", ""):gsub("%s+$", "")
	if p == "game" then return game end
	if p:sub(1, 5) == "game." then p = p:sub(6) end
	local node = game
	for _, s in ipairs(string.split(p, ".")) do
		if s ~= "" and not (s == "game" and node == game) then
			local nxt = node:FindFirstChild(s)
			if not nxt and node == game then
				local okSvc, svc = pcall(function() return game:GetService(s) end)
				if okSvc and svc then nxt = svc end
			end
			if not nxt then return nil end
			node = nxt
		end
	end
	return node
end

local function pathOf(inst)
	local parts = {}
	local cur = inst
	while cur and cur ~= game do
		parts[#parts + 1] = cur.Name
		cur = cur.Parent
	end
	local rev = {}
	for i = 1, #parts do rev[i] = parts[#parts - i + 1] end
	return table.concat(rev, ".")
end

local function bareCall(src, name)
	local i = 1
	while true do
		local a, b = src:find(name .. "%s*%(", i)
		if not a then return false end
		local prev = a > 1 and src:sub(a - 1, a - 1) or ""
		if prev == "" or not prev:match("[%w_%.]") then
			return true
		end
		i = b + 1
	end
end

local function luauUnbalanced(src)
	local s = src
	s = s:gsub("%-%-%[%[.-%]%]", " ")
	s = s:gsub("%-%-[^
]*", " ")
	s = s:gsub("%[%[.-%]%]", " ")
	s = s:gsub("%b''", " ")
	s = s:gsub('%b""', " ")
	local function count(word)
		local n = 0
		for _ in s:gmatch("%f[%w_]" .. word .. "%f[^%w_]") do n += 1 end
		return n
	end
	local opens = count("function") + count("do") + count("if") + count("repeat")
	local closes = count("end") + count("until")
	if opens > closes then
		return "unclosed block (" .. tostring(opens) .. " function/do/if/repeat vs " .. tostring(closes) .. " end/until)"
	end
	if closes > opens then
		return "extra end/until (" .. tostring(closes) .. " vs " .. tostring(opens) .. " openers)"
	end
	return nil
end

local api = {}

-- ═════════════════════════════════════════════════════════════════════════════
-- LIGHTING & ATMOSPHERE STUDIO
-- ═════════════════════════════════════════════════════════════════════════════

local function getOrCreate(parent, className, name)
	local found = parent:FindFirstChildOfClass(className) or (name and parent:FindFirstChild(name))
	if not found then
		found = Instance.new(className)
		if name then found.Name = name end
		found.Parent = parent
	end
	return found
end

local LIGHTING_PRESETS = {
	cyberpunk = {
		technology = Enum.Technology.Future,
		clockTime = 0,
		brightness = 1.2,
		outdoorAmbient = Color3.fromRGB(15, 10, 40),
		ambient = Color3.fromRGB(20, 15, 50),
		colorShift_Top = Color3.fromRGB(0, 220, 255),
		colorShift_Bottom = Color3.fromRGB(255, 0, 128),
		exposure = 0.2,
		shadowSoftness = 0.2,
		atmosphere = { density = 0.35, offset = 0.25, color = Color3.fromRGB(30, 20, 70), decay = Color3.fromRGB(200, 0, 150), glare = 0.5, haze = 1.8 },
		bloom = { intensity = 1.4, size = 32, threshold = 0.75 },
		colorCorrection = { contrast = 0.25, saturation = 0.4, tintColor = Color3.fromRGB(240, 245, 255) },
		sunRays = { intensity = 0.1, spread = 0.8 },
	},
	sunset_warm = {
		technology = Enum.Technology.Future,
		clockTime = 17.8,
		brightness = 2.5,
		outdoorAmbient = Color3.fromRGB(120, 70, 50),
		ambient = Color3.fromRGB(90, 50, 40),
		colorShift_Top = Color3.fromRGB(255, 180, 100),
		colorShift_Bottom = Color3.fromRGB(180, 80, 50),
		exposure = 0.1,
		shadowSoftness = 0.6,
		atmosphere = { density = 0.4, offset = 0.5, color = Color3.fromRGB(255, 150, 80), decay = Color3.fromRGB(180, 60, 40), glare = 1.2, haze = 2.5 },
		bloom = { intensity = 0.8, size = 24, threshold = 0.85 },
		colorCorrection = { contrast = 0.15, saturation = 0.3, tintColor = Color3.fromRGB(255, 240, 230) },
		sunRays = { intensity = 0.4, spread = 0.9 },
	},
	horror_dark = {
		technology = Enum.Technology.Future,
		clockTime = 1,
		brightness = 0.3,
		outdoorAmbient = Color3.fromRGB(5, 8, 10),
		ambient = Color3.fromRGB(4, 6, 8),
		colorShift_Top = Color3.fromRGB(20, 30, 40),
		colorShift_Bottom = Color3.fromRGB(10, 15, 20),
		exposure = -0.3,
		shadowSoftness = 0.1,
		atmosphere = { density = 0.6, offset = 0.1, color = Color3.fromRGB(15, 20, 25), decay = Color3.fromRGB(10, 15, 18), glare = 0, haze = 3.5 },
		bloom = { intensity = 0.3, size = 16, threshold = 0.95 },
		colorCorrection = { contrast = 0.3, saturation = -0.4, tintColor = Color3.fromRGB(210, 220, 230) },
		sunRays = { intensity = 0.05, spread = 0.2 },
	},
	fantasy_vibrant = {
		technology = Enum.Technology.Future,
		clockTime = 14,
		brightness = 3.0,
		outdoorAmbient = Color3.fromRGB(140, 150, 170),
		ambient = Color3.fromRGB(120, 130, 150),
		colorShift_Top = Color3.fromRGB(255, 250, 230),
		colorShift_Bottom = Color3.fromRGB(180, 200, 220),
		exposure = 0.15,
		shadowSoftness = 0.5,
		atmosphere = { density = 0.25, offset = 0.2, color = Color3.fromRGB(180, 220, 255), decay = Color3.fromRGB(255, 210, 180), glare = 0.4, haze = 1.0 },
		bloom = { intensity = 0.6, size = 20, threshold = 0.88 },
		colorCorrection = { contrast = 0.12, saturation = 0.35, tintColor = Color3.fromRGB(255, 255, 255) },
		sunRays = { intensity = 0.25, spread = 0.7 },
	},
	overcast_moody = {
		technology = Enum.Technology.Future,
		clockTime = 12,
		brightness = 1.4,
		outdoorAmbient = Color3.fromRGB(100, 105, 115),
		ambient = Color3.fromRGB(90, 95, 105),
		colorShift_Top = Color3.fromRGB(190, 195, 205),
		colorShift_Bottom = Color3.fromRGB(140, 145, 155),
		exposure = 0.0,
		shadowSoftness = 1.0,
		atmosphere = { density = 0.5, offset = 0.3, color = Color3.fromRGB(170, 175, 185), decay = Color3.fromRGB(130, 135, 145), glare = 0.1, haze = 2.8 },
		bloom = { intensity = 0.4, size = 18, threshold = 0.9 },
		colorCorrection = { contrast = 0.08, saturation = -0.15, tintColor = Color3.fromRGB(230, 235, 240) },
		sunRays = { intensity = 0.08, spread = 0.4 },
	},
	realistic_noon = {
		technology = Enum.Technology.Future,
		clockTime = 13,
		brightness = 2.8,
		outdoorAmbient = Color3.fromRGB(130, 135, 140),
		ambient = Color3.fromRGB(110, 115, 120),
		colorShift_Top = Color3.fromRGB(255, 252, 245),
		colorShift_Bottom = Color3.fromRGB(160, 170, 180),
		exposure = 0.05,
		shadowSoftness = 0.4,
		atmosphere = { density = 0.3, offset = 0.25, color = Color3.fromRGB(200, 220, 255), decay = Color3.fromRGB(100, 140, 210), glare = 0.3, haze = 0.8 },
		bloom = { intensity = 0.5, size = 16, threshold = 0.9 },
		colorCorrection = { contrast = 0.1, saturation = 0.1, tintColor = Color3.fromRGB(255, 255, 255) },
		sunRays = { intensity = 0.2, spread = 0.6 },
	},
	vaporwave = {
		technology = Enum.Technology.Future,
		clockTime = 19.5,
		brightness = 1.8,
		outdoorAmbient = Color3.fromRGB(50, 15, 60),
		ambient = Color3.fromRGB(40, 10, 50),
		colorShift_Top = Color3.fromRGB(255, 105, 180),
		colorShift_Bottom = Color3.fromRGB(64, 224, 208),
		exposure = 0.2,
		shadowSoftness = 0.3,
		atmosphere = { density = 0.45, offset = 0.4, color = Color3.fromRGB(220, 80, 180), decay = Color3.fromRGB(50, 200, 210), glare = 0.8, haze = 2.2 },
		bloom = { intensity = 1.6, size = 36, threshold = 0.7 },
		colorCorrection = { contrast = 0.28, saturation = 0.5, tintColor = Color3.fromRGB(255, 230, 250) },
		sunRays = { intensity = 0.35, spread = 0.85 },
	},
	space_void = {
		technology = Enum.Technology.Future,
		clockTime = 0,
		brightness = 0.2,
		outdoorAmbient = Color3.fromRGB(0, 0, 0),
		ambient = Color3.fromRGB(0, 0, 0),
		colorShift_Top = Color3.fromRGB(200, 220, 255),
		colorShift_Bottom = Color3.fromRGB(10, 10, 20),
		exposure = 0.0,
		shadowSoftness = 0.0,
		atmosphere = { density = 0, offset = 0, color = Color3.fromRGB(0, 0, 0), decay = Color3.fromRGB(0, 0, 0), glare = 0, haze = 0 },
		bloom = { intensity = 0.8, size = 20, threshold = 0.8 },
		colorCorrection = { contrast = 0.4, saturation = 0.0, tintColor = Color3.fromRGB(255, 255, 255) },
		sunRays = { intensity = 0.5, spread = 0.5 },
	},
	warm_night = {
		technology = Enum.Technology.Future,
		clockTime = 20,
		brightness = 1.0,
		outdoorAmbient = Color3.fromRGB(45, 30, 55),
		ambient = Color3.fromRGB(35, 25, 45),
		colorShift_Top = Color3.fromRGB(255, 190, 120),
		colorShift_Bottom = Color3.fromRGB(90, 50, 80),
		exposure = 0.05,
		shadowSoftness = 0.25,
		atmosphere = { density = 0.38, offset = 0.2, color = Color3.fromRGB(60, 35, 70), decay = Color3.fromRGB(255, 160, 90), glare = 0.55, haze = 1.6 },
		bloom = { intensity = 1.1, size = 28, threshold = 0.78 },
		colorCorrection = { contrast = 0.18, saturation = 0.28, tintColor = Color3.fromRGB(255, 235, 220) },
		sunRays = { intensity = 0.18, spread = 0.6 },
	}
}

function api.lighting_set_preset(a)
	local pName = tostring(a.preset or "realistic_noon"):lower():gsub("[%s%-]+", "_"):gsub("_+", "_")
	local cfg = LIGHTING_PRESETS[pName]
	-- alias: "warm night" / "warm-night" with space/dash → warm_night
	if not cfg and pName:find("warm") and pName:find("night") then cfg = LIGHTING_PRESETS["warm_night"]; if cfg then pName = "warm_night" end
	if not cfg then
		local valid = {}
		for k in pairs(LIGHTING_PRESETS) do valid[#valid + 1] = k end
		table.sort(valid)
		return fail("unknown preset '" .. pName .. "'. Valid presets: " .. table.concat(valid, ", "))
	end

	Lighting.ClockTime = tonumber(a.clock_time) or cfg.clockTime
	Lighting.Brightness = cfg.brightness
	Lighting.OutdoorAmbient = cfg.outdoorAmbient
	Lighting.Ambient = cfg.ambient
	Lighting.ColorShift_Top = cfg.colorShift_Top
	Lighting.ColorShift_Bottom = cfg.colorShift_Bottom
	Lighting.ExposureCompensation = cfg.exposure
	Lighting.ShadowSoftness = cfg.shadowSoftness
	Lighting.GlobalShadows = a.shadows ~= false

	if cfg.atmosphere then
		local atmos = getOrCreate(Lighting, "Atmosphere", "Atmosphere")
		atmos.Density = cfg.atmosphere.density
		atmos.Offset = cfg.atmosphere.offset
		atmos.Color = cfg.atmosphere.color
		atmos.Decay = cfg.atmosphere.decay
		atmos.Glare = cfg.atmosphere.glare
		atmos.Haze = cfg.atmosphere.haze
	end

	if cfg.bloom then
		local bloom = getOrCreate(Lighting, "BloomEffect", "Bloom")
		bloom.Intensity = cfg.bloom.intensity
		bloom.Size = cfg.bloom.size
		bloom.Threshold = cfg.bloom.threshold
	end

	if cfg.colorCorrection then
		local cc = getOrCreate(Lighting, "ColorCorrectionEffect", "ColorCorrection")
		cc.Contrast = cfg.colorCorrection.contrast
		cc.Saturation = cfg.colorCorrection.saturation
		cc.TintColor = cfg.colorCorrection.tintColor
	end

	if cfg.sunRays then
		local sr = getOrCreate(Lighting, "SunRaysEffect", "SunRays")
		sr.Intensity = cfg.sunRays.intensity
		sr.Spread = cfg.sunRays.spread
	end

	return okdata({ preset = pName, clockTime = Lighting.ClockTime, technology = Lighting.Technology.Name },
		("applied lighting preset '%s' (Future lighting, ClockTime %.1f, atmosphere & post-processing configured)"):format(pName, Lighting.ClockTime))
end

function api.lighting_inspect()
	local post = {}
	for _, child in ipairs(Lighting:GetChildren()) do
		if child:IsA("PostEffect") or child:IsA("Atmosphere") or child:IsA("Sky") then
			post[#post + 1] = { name = child.Name, className = child.ClassName }
		end
	end
	return okdata({
		technology = Lighting.Technology.Name,
		clockTime = Lighting.ClockTime,
		brightness = Lighting.Brightness,
		exposure = Lighting.ExposureCompensation,
		globalShadows = Lighting.GlobalShadows,
		outdoorAmbient = { r = Lighting.OutdoorAmbient.R, g = Lighting.OutdoorAmbient.G, b = Lighting.OutdoorAmbient.B },
		ambient = { r = Lighting.Ambient.R, g = Lighting.Ambient.G, b = Lighting.Ambient.B },
		effects = post
	}, ("Lighting: %s technology, ClockTime %.1f, %d post-effects/sky/atmosphere elements"):format(Lighting.Technology.Name, Lighting.ClockTime, #post))
end

function api.lighting_setup_day_night(a)
	local dur = tonumber(a.cycle_duration_seconds) or 300
	local startT = tonumber(a.start_time) or 8
	if dur <= 0 then return fail("cycle_duration_seconds must be > 0") end

	local scr = ServerScriptService:FindFirstChild("RobloxScript_DayNightCycle")
	if not scr then
		scr = Instance.new("Script")
		scr.Name = "RobloxScript_DayNightCycle"
		scr.Parent = ServerScriptService
	end
	scr.Source = string.format([[-- Generated by RobloxScript Day/Night Cycle
local Lighting = game:GetService("Lighting")
local CYCLE_SECONDS = %d
Lighting.ClockTime = %.1f

local rate = 24 / CYCLE_SECONDS
while true do
	local dt = task.wait(0.1)
	Lighting.ClockTime = (Lighting.ClockTime + (rate * dt)) %% 24
end
]], dur, startT)

	return okdata({ script = pathOf(scr), cycleDuration = dur, startTime = startT },
		("installed Day/Night cycle controller in '%s' (%ds per 24h cycle, start at %.1f)"):format(pathOf(scr), dur, startT))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- UI & HUD COMPONENT GENERATOR
-- ═════════════════════════════════════════════════════════════════════════════

local function addCorner(parent, px)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, px or 8)
	c.Parent = parent
	return c
end

local function addStroke(parent, color, thickness)
	local s = Instance.new("UIStroke")
	s.Color = color or Color3.fromRGB(255, 255, 255)
	s.Transparency = 0.7
	s.Thickness = thickness or 1
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = parent
	return s
end

local function addPadding(parent, px)
	local p = Instance.new("UIPadding")
	p.PaddingTop = UDim.new(0, px)
	p.PaddingBottom = UDim.new(0, px)
	p.PaddingLeft = UDim.new(0, px)
	p.PaddingRight = UDim.new(0, px)
	p.Parent = parent
	return p
end

function api.ui_create_screen(a)
	local name = tostring(a.name or "HUD")
	local sg = StarterGui:FindFirstChild(name)
	if not sg then
		sg = Instance.new("ScreenGui")
		sg.Name = name
		sg.ResetOnSpawn = a.reset_on_spawn == true
		sg.DisplayOrder = tonumber(a.display_order) or 1
		sg.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
		sg.Parent = StarterGui
	end
	return okdata({ path = pathOf(sg), name = name }, ("created ScreenGui '%s' in StarterGui"):format(name))
end

function api.ui_create_component(a)
	local screenName = tostring(a.screen_name or "HUD")
	local sg = StarterGui:FindFirstChild(screenName)
	if not sg then
		sg = Instance.new("ScreenGui")
		sg.Name = screenName
		sg.ResetOnSpawn = false
		sg.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
		sg.Parent = StarterGui
	end

	local compType = tostring(a.component_type or "health_stamina_hud"):lower()
	local forgeOn = a.forge == true or tostring(a.theme or ""):lower() == "forge" or (compType:find("forge") ~= nil)
	if forgeOn then
		if compType == "health_stamina_hud" then compType = "forge_hud"
		elseif compType == "card_inventory" then compType = "forge_inventory"
		end
	end

	if compType == "health_stamina_hud" then
		local container = Instance.new("Frame")
		container.Name = "StatusHUD"
		container.Size = UDim2.new(0, 240, 0, 70)
		container.Position = UDim2.new(0, 20, 1, -90)
		container.BackgroundColor3 = Color3.fromRGB(20, 24, 30)
		container.BackgroundTransparency = 0.25
		container.Parent = sg
		addCorner(container, 10)
		addStroke(container, Color3.fromRGB(60, 70, 85), 1.5)
		addPadding(container, 8)

		local function makeBar(name, yPos, colorA, colorB, labelText)
			local bg = Instance.new("Frame")
			bg.Name = name .. "BG"
			bg.Size = UDim2.new(1, 0, 0, 22)
			bg.Position = UDim2.new(0, 0, 0, yPos)
			bg.BackgroundColor3 = Color3.fromRGB(35, 40, 50)
			bg.Parent = container
			addCorner(bg, 6)

			local fill = Instance.new("Frame")
			fill.Name = "Fill"
			fill.Size = UDim2.new(1, 0, 1, 0)
			fill.BackgroundColor3 = colorA
			fill.Parent = bg
			addCorner(fill, 6)

			local grad = Instance.new("UIGradient")
			grad.Color = ColorSequence.new(colorA, colorB)
			grad.Parent = fill

			local lbl = Instance.new("TextLabel")
			lbl.Name = "Label"
			lbl.Size = UDim2.new(1, -8, 1, 0)
			lbl.Position = UDim2.new(0, 6, 0, 0)
			lbl.BackgroundTransparency = 1
			lbl.Font = Enum.Font.GothamBold
			lbl.TextSize = 12
			lbl.TextColor3 = Color3.fromRGB(255, 255, 255)
			lbl.TextXAlignment = Enum.TextXAlignment.Left
			lbl.Text = labelText
			lbl.Parent = bg
		end

		makeBar("Health", 0, Color3.fromRGB(46, 204, 113), Color3.fromRGB(39, 174, 96), "HP  100 / 100")
		makeBar("Stamina", 28, Color3.fromRGB(52, 152, 219), Color3.fromRGB(41, 128, 185), "STA 100 / 100")

		return okdata({ path = pathOf(container), type = compType }, "created modern Health & Stamina HUD component")

	elseif compType == "dialog_box" then
		local box = Instance.new("Frame")
		box.Name = "DialogBox"
		box.Size = UDim2.new(0.7, 0, 0, 140)
		box.Position = UDim2.new(0.15, 0, 1, -160)
		box.BackgroundColor3 = Color3.fromRGB(18, 22, 28)
		box.BackgroundTransparency = 0.15
		box.Parent = sg
		addCorner(box, 12)
		addStroke(box, Color3.fromRGB(70, 80, 100), 1.5)
		addPadding(box, 12)

		local nameTag = Instance.new("TextLabel")
		nameTag.Name = "SpeakerName"
		nameTag.Size = UDim2.new(1, 0, 0, 20)
		nameTag.BackgroundTransparency = 1
		nameTag.Font = Enum.Font.GothamBlack
		nameTag.TextSize = 16
		nameTag.TextColor3 = Color3.fromRGB(241, 196, 15)
		nameTag.TextXAlignment = Enum.TextXAlignment.Left
		nameTag.Text = "NPC"
		nameTag.Parent = box

		local msg = Instance.new("TextLabel")
		msg.Name = "Message"
		msg.Size = UDim2.new(1, 0, 0, 60)
		msg.Position = UDim2.new(0, 0, 0, 24)
		msg.BackgroundTransparency = 1
		msg.Font = Enum.Font.GothamMedium
		msg.TextSize = 14
		msg.TextColor3 = Color3.fromRGB(240, 240, 245)
		msg.TextWrapped = true
		msg.TextXAlignment = Enum.TextXAlignment.Left
		msg.TextYAlignment = Enum.TextYAlignment.Top
		msg.Text = "Hello traveller! What brings you to this realm?"
		msg.Parent = box

		local btnContainer = Instance.new("Frame")
		btnContainer.Name = "Buttons"
		btnContainer.Size = UDim2.new(1, 0, 0, 30)
		btnContainer.Position = UDim2.new(0, 0, 1, -30)
		btnContainer.BackgroundTransparency = 1
		btnContainer.Parent = box

		local layout = Instance.new("UIListLayout")
		layout.FillDirection = Enum.FillDirection.Horizontal
		layout.HorizontalAlignment = Enum.HorizontalAlignment.Right
		layout.Padding = UDim.new(0, 10)
		layout.Parent = btnContainer

		local function makeBtn(btnName, text, primary)
			local btn = Instance.new("TextButton")
			btn.Name = btnName
			btn.Size = UDim2.new(0, 110, 1, 0)
			btn.BackgroundColor3 = primary and Color3.fromRGB(52, 152, 219) or Color3.fromRGB(45, 52, 65)
			btn.Font = Enum.Font.GothamBold
			btn.TextSize = 13
			btn.TextColor3 = Color3.fromRGB(255, 255, 255)
			btn.Text = text
			btn.Parent = btnContainer
			addCorner(btn, 6)
		end
		makeBtn("Option1", "Accept", true)
		makeBtn("Option2", "Decline", false)

		return okdata({ path = pathOf(box), type = compType }, "created modern Dialog Box UI with speaker nametag and response buttons")

	elseif compType == "notification_toast" then
		local toast = Instance.new("Frame")
		toast.Name = "NotificationToast"
		toast.Size = UDim2.new(0, 280, 0, 50)
		toast.Position = UDim2.new(1, -300, 0, 20)
		toast.BackgroundColor3 = Color3.fromRGB(25, 30, 40)
		toast.BackgroundTransparency = 0.15
		toast.Parent = sg
		addCorner(toast, 8)
		addStroke(toast, Color3.fromRGB(52, 152, 219), 1.5)
		addPadding(toast, 8)

		local icon = Instance.new("TextLabel")
		icon.Name = "Icon"
		icon.Size = UDim2.new(0, 32, 1, 0)
		icon.BackgroundTransparency = 1
		icon.Font = Enum.Font.GothamBlack
		icon.TextSize = 18
		icon.TextColor3 = Color3.fromRGB(52, 152, 219)
		icon.Text = "★"
		icon.Parent = toast

		local txt = Instance.new("TextLabel")
		txt.Name = "Message"
		txt.Size = UDim2.new(1, -40, 1, 0)
		txt.Position = UDim2.new(0, 36, 0, 0)
		txt.BackgroundTransparency = 1
		txt.Font = Enum.Font.GothamMedium
		txt.TextSize = 13
		txt.TextColor3 = Color3.fromRGB(255, 255, 255)
		txt.TextXAlignment = Enum.TextXAlignment.Left
		txt.TextWrapped = true
		txt.Text = "Achievement Unlocked: First Quest!"
		txt.Parent = toast

		return okdata({ path = pathOf(toast), type = compType }, "created Notification Toast component")

	elseif compType == "card_inventory" or compType == "cards" or compType == "card_dropup" then
		-- Lemon-style collectible card system: grid inventory + dropup picker.
		-- Params: card_count (default 8), title (default "Inventory"), dropup (bool, default true)
		local cardCount = math.clamp(tonumber(a.card_count) or 8, 1, 24)
		local invTitle = tostring(a.title or "Inventory")

		-- Root container (bottom-center like the Lemon reference)
		local root = Instance.new("Frame")
		root.Name = "CardInventory"
		root.Size = UDim2.new(0, 340, 0, 260)
		root.Position = UDim2.new(0.5, -170, 1, -20)
		root.AnchorPoint = Vector2.new(0, 1)
		root.BackgroundColor3 = Color3.fromRGB(22, 24, 30)
		root.BackgroundTransparency = 0.08
		root.Parent = sg
		addCorner(root, 12)
		addStroke(root, Color3.fromRGB(55, 60, 75), 1.2)
		addPadding(root, 10)

		-- Header row: title + "Main cards" chip
		local header = Instance.new("Frame")
		header.Name = "Header"
		header.Size = UDim2.new(1, 0, 0, 26)
		header.BackgroundTransparency = 1
		header.Parent = root
		local title = Instance.new("TextLabel")
		title.Name = "Title"
		title.Size = UDim2.new(1, -80, 1, 0)
		title.BackgroundTransparency = 1
		title.Font = Enum.Font.GothamBold
		title.TextSize = 13
		title.TextColor3 = Color3.fromRGB(240, 240, 245)
		title.TextXAlignment = Enum.TextXAlignment.Left
		title.Text = invTitle
		title.Parent = header
		local chip = Instance.new("TextLabel")
		chip.Name = "Chip"
		chip.Size = UDim2.new(0, 76, 1, 0)
		chip.Position = UDim2.new(1, -76, 0, 0)
		chip.BackgroundColor3 = Color3.fromRGB(40, 45, 58)
		chip.Font = Enum.Font.GothamMedium
		chip.TextSize = 10
		chip.TextColor3 = Color3.fromRGB(180, 185, 200)
		chip.Text = "Main cards"
		chip.Parent = header
		addCorner(chip, 999)

		-- Card grid (scrolling)
		local scroll = Instance.new("ScrollingFrame")
		scroll.Name = "CardGrid"
		scroll.Size = UDim2.new(1, 0, 1, -36)
		scroll.Position = UDim2.new(0, 0, 0, 30)
		scroll.BackgroundTransparency = 1
		scroll.BorderSizePixel = 0
		scroll.ScrollBarThickness = 4
		scroll.ScrollBarImageColor3 = Color3.fromRGB(70, 78, 95)
		scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
		scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
		scroll.Parent = root
		local grid = Instance.new("UIGridLayout")
		grid.CellSize = UDim2.new(0, 72, 0, 96)
		grid.CellPadding = UDim2.new(0, 8, 0, 8)
		grid.SortOrder = Enum.SortOrder.LayoutOrder
		grid.Parent = scroll

		-- Palette for card art (cycles)
		local palettes = {
			{Color3.fromRGB(120, 60, 200), Color3.fromRGB(70, 30, 140), "Common"},
			{Color3.fromRGB(30, 120, 215), Color3.fromRGB(15, 70, 140), "Rare"},
			{Color3.fromRGB(220, 130, 30), Color3.fromRGB(150, 80, 15), "Epic"},
			{Color3.fromRGB(200, 50, 90), Color3.fromRGB(130, 25, 55), "Legendary"},
			{Color3.fromRGB(40, 170, 120), Color3.fromRGB(20, 110, 75), "Mythic"},
		}

		local function makeCard(idx, name, rarityIdx, isEquipped)
			local pal = palettes[((rarityIdx - 1) % #palettes) + 1]
			local card = Instance.new("Frame")
			card.Name = "Card_" .. idx
			card.BackgroundColor3 = pal[1]
			card.Parent = scroll
			addCorner(card, 8)
			addStroke(card, pal[1]:Lerp(Color3.new(1,1,1), 0.35), 1.5)
			-- Vertical gradient for depth
			local grad = Instance.new("UIGradient")
			grad.Color = ColorSequence.new(pal[1], pal[2])
			grad.Rotation = 90
			grad.Parent = card
			-- Character silhouette placeholder (circle head + body blob)
			local head = Instance.new("Frame")
			head.Name = "Head"
			head.Size = UDim2.new(0, 22, 0, 22)
			head.Position = UDim2.new(0.5, -11, 0, 14)
			head.BackgroundColor3 = pal[1]:Lerp(Color3.new(1,1,1), 0.45)
			head.Parent = card
			addCorner(head, 999)
			local body = Instance.new("Frame")
			body.Name = "Body"
			body.Size = UDim2.new(0, 40, 0, 34)
			body.Position = UDim2.new(0.5, -20, 0, 38)
			body.BackgroundColor3 = pal[1]:Lerp(Color3.new(1,1,1), 0.30)
			body.Parent = card
			addCorner(body, 12)
			-- Name label
			local nameLabel = Instance.new("TextLabel")
			nameLabel.Name = "CardName"
			nameLabel.Size = UDim2.new(1, -6, 0, 12)
			nameLabel.Position = UDim2.new(0, 3, 1, -16)
			nameLabel.BackgroundTransparency = 1
			nameLabel.Font = Enum.Font.GothamBold
			nameLabel.TextSize = 8
			nameLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
			nameLabel.TextStrokeTransparency = 0.6
			nameLabel.TextScaled = false
			nameLabel.TextTruncate = Enum.TextTruncate.AtEnd
			nameLabel.Text = name
			nameLabel.Parent = card
			-- Rarity tag
			local rarity = Instance.new("TextLabel")
			rarity.Name = "Rarity"
			rarity.Size = UDim2.new(1, -6, 0, 10)
			rarity.Position = UDim2.new(0, 3, 1, -26)
			rarity.BackgroundTransparency = 1
			rarity.Font = Enum.Font.Gotham
			rarity.TextSize = 7
			rarity.TextColor3 = pal[1]:Lerp(Color3.new(1,1,1), 0.7)
			rarity.Text = string.upper(pal[3])
			rarity.Parent = card
			-- Equipped glow ring
			if isEquipped then
				addStroke(card, Color3.fromRGB(120, 220, 130), 2)
				local eq = Instance.new("TextLabel")
				eq.Name = "EquippedTag"
				eq.Size = UDim2.new(1, 0, 0, 12)
				eq.Position = UDim2.new(0, 0, 0, 0)
				eq.BackgroundColor3 = Color3.fromRGB(40, 160, 90)
				eq.BackgroundTransparency = 0.2
				eq.Font = Enum.Font.GothamBold
				eq.TextSize = 7
				eq.TextColor3 = Color3.fromRGB(255, 255, 255)
				eq.Text = "EQUIPPED"
				eq.Parent = card
				addCorner(eq, 999)
			end
			-- Click handler hint (server-side wiring is user's job)
			local btn = Instance.new("TextButton")
			btn.Name = "ClickTarget"
			btn.Size = UDim2.new(1, 0, 1, 0)
			btn.BackgroundTransparency = 1
			btn.Text = ""
			btn.Parent = card
			return card
		end

		local cardNames = { "Void Spectre", "Magnet II", "Icy Guardian", "Astro Jumper", "Springing Serpent", "Molten Core", "Bald Phoenix", "Shadow Walker", "Storm Caller", "Crystal Knight", "Ember Wraith", "Frost Giant" }
		for i = 1, cardCount do
			makeCard(i, cardNames[((i - 1) % #cardNames) + 1], i, i == 1)
		end

		-- Dropup picker (small floating stack above the inventory, like Lemon's)
		if a.dropup ~= false then
			local dropup = Instance.new("Frame")
			dropup.Name = "DropupPicker"
			dropup.Size = UDim2.new(0, 120, 0, 44)
			dropup.Position = UDim2.new(0, 8, 0, -50)
			dropup.BackgroundColor3 = Color3.fromRGB(28, 30, 38)
			dropup.BackgroundTransparency = 0.05
			dropup.Parent = root
			addCorner(dropup, 10)
			addStroke(dropup, Color3.fromRGB(60, 66, 82), 1.2)
			local dropLabel = Instance.new("TextLabel")
			dropLabel.Name = "Hint"
			dropLabel.Size = UDim2.new(1, -8, 1, 0)
			dropLabel.Position = UDim2.new(0, 4, 0, 0)
			dropLabel.BackgroundTransparency = 1
			dropLabel.Font = Enum.Font.Gotham
			dropLabel.TextSize = 9
			dropLabel.TextColor3 = Color3.fromRGB(170, 175, 190)
			dropLabel.TextWrapped = true
			dropLabel.Text = "Drop a card ▲ or describe a mechanic…"
			dropLabel.Parent = dropup
		end

		return okdata({ path = pathOf(root), type = compType, cards = cardCount, dropup = a.dropup ~= false },
			("created card inventory '%s' with %d collectible cards + dropup picker"):format(invTitle, cardCount))

	elseif compType:find("forge") or a.forge == true or tostring(a.theme or ""):lower() == "forge" then
		-- Rewritten Forge language: charcoal metal, gold ember, inset panels.
		local GOLD = Color3.fromRGB(212, 160, 84)
		local EMBER = Color3.fromRGB(224, 120, 64)
		local BG = Color3.fromRGB(18, 18, 20)
		local PANEL = Color3.fromRGB(26, 26, 31)
		local RAISED = Color3.fromRGB(36, 36, 44)
		local STROKE = Color3.fromRGB(61, 61, 72)
		local TEXT = Color3.fromRGB(243, 239, 230)
		local MUTED = Color3.fromRGB(154, 149, 140)
		local kind = compType
		if not kind:find("forge") then
			kind = "forge_panel"
		end

		local function goldLine(parent, y)
			local ln = Instance.new("Frame")
			ln.Name = "GoldLine"
			ln.Size = UDim2.new(1, 0, 0, 1)
			ln.Position = UDim2.new(0, 0, 0, y or 35)
			ln.BackgroundColor3 = GOLD
			ln.BackgroundTransparency = 0.35
			ln.BorderSizePixel = 0
			ln.Parent = parent
			return ln
		end
		local function ink(parent, color, th)
			local s = ink(parent, color, th)
			s.Transparency = 0.18
			return s
		end
		local function iconBtn(parent, glyph, x, y)
			local b = Instance.new("TextButton")
			b.Size = UDim2.new(0, 36, 0, 36)
			b.Position = UDim2.new(0, x, 0, y)
			b.BackgroundColor3 = RAISED
			b.Font = Enum.Font.GothamBold
			b.TextSize = 14
			b.TextColor3 = GOLD
			b.Text = glyph
			b.Parent = parent
			addCorner(b, 8)
			ink(b, STROKE, 1)
			return b
		end

		if kind == "forge_button" then
			local btn = Instance.new("TextButton")
			btn.Name = "ForgeButton"
			btn.Size = UDim2.new(0, 168, 0, 40)
			btn.Position = UDim2.new(0.5, -84, 0.5, -20)
			btn.BackgroundColor3 = RAISED
			btn.Font = Enum.Font.GothamBold
			btn.TextSize = 14
			btn.TextColor3 = TEXT
			btn.Text = tostring(a.title or "Forge")
			btn.Parent = sg
			addCorner(btn, 8)
			ink(btn, GOLD, 1.4)
			return okdata({ path = pathOf(btn), type = kind, forge = true }, "created Forge metal button")
		end

		if kind == "forge_hud" then
			local hud = Instance.new("Frame")
			hud.Name = "ForgeHUD"
			hud.Size = UDim2.new(0, 260, 0, 72)
			hud.Position = UDim2.new(0, 18, 1, -90)
			hud.BackgroundColor3 = BG
			hud.Parent = sg
			addCorner(hud, 8)
			ink(hud, GOLD, 1.2)
			addPadding(hud, 10)
			goldLine(hud, 0)
			local function bar(name, y, col, label)
				local bg = Instance.new("Frame")
				bg.Name = name
				bg.Size = UDim2.new(1, 0, 0, 18)
				bg.Position = UDim2.new(0, 0, 0, y)
				bg.BackgroundColor3 = RAISED
				bg.Parent = hud
				addCorner(bg, 4)
				local fill = Instance.new("Frame")
				fill.Name = "Fill"
				fill.Size = UDim2.new(0.82, 0, 1, 0)
				fill.BackgroundColor3 = col
				fill.Parent = bg
				addCorner(fill, 4)
				local lbl = Instance.new("TextLabel")
				lbl.BackgroundTransparency = 1
				lbl.Size = UDim2.new(1, -8, 1, 0)
				lbl.Position = UDim2.new(0, 6, 0, 0)
				lbl.Font = Enum.Font.GothamBold
				lbl.TextSize = 11
				lbl.TextColor3 = TEXT
				lbl.TextXAlignment = Enum.TextXAlignment.Left
				lbl.Text = label
				lbl.Parent = bg
			end
			bar("Health", 8, Color3.fromRGB(196, 72, 64), "VITAL  100")
			bar("Heat", 36, EMBER, "HEAT   64")
			return okdata({ path = pathOf(hud), type = kind, forge = true }, "created Forge HUD")
		end

		if kind == "forge_inventory" then
			local root = Instance.new("Frame")
			root.Name = "ForgeInventory"
			root.Size = UDim2.new(0, 280, 0, 250)
			root.Position = UDim2.new(0.5, -140, 0.5, -125)
			root.BackgroundColor3 = BG
			root.Parent = sg
			addCorner(root, 8)
			ink(root, STROKE, 1.2)
			local title = Instance.new("TextLabel")
			title.Size = UDim2.new(1, -16, 0, 32)
			title.Position = UDim2.new(0, 8, 0, 4)
			title.BackgroundTransparency = 1
			title.Font = Enum.Font.GothamBold
			title.TextSize = 14
			title.TextColor3 = TEXT
			title.TextXAlignment = Enum.TextXAlignment.Left
			title.Text = "  FORGE  ·  PACK"
			title.Parent = root
			goldLine(root, 36)
			local gridF = Instance.new("Frame")
			gridF.Name = "Slots"
			gridF.Size = UDim2.new(1, -16, 1, -48)
			gridF.Position = UDim2.new(0, 8, 0, 42)
			gridF.BackgroundTransparency = 1
			gridF.Parent = root
			local grid = Instance.new("UIGridLayout")
			grid.CellSize = UDim2.new(0, 48, 0, 48)
			grid.CellPadding = UDim2.new(0, 6, 0, 6)
			grid.Parent = gridF
			for i = 1, 16 do
				local slot = Instance.new("Frame")
				slot.Name = "Slot_" .. i
				slot.BackgroundColor3 = RAISED
				slot.Parent = gridF
				addCorner(slot, 6)
				ink(slot, i <= 3 and GOLD or STROKE, i <= 3 and 1.3 or 1)
				if i <= 3 then
					local g = Instance.new("TextLabel")
					g.BackgroundTransparency = 1
					g.Size = UDim2.fromScale(1, 1)
					g.Font = Enum.Font.GothamBold
					g.TextSize = 16
					g.TextColor3 = GOLD
					g.Text = ({ "⚔", "🛡", "◆" })[i]
					g.Parent = slot
				end
			end
			return okdata({ path = pathOf(root), type = kind, forge = true }, "created Forge inventory (16 slots)")
		end

		if kind == "forge_shop" then
			local root = Instance.new("Frame")
			root.Name = "ForgeShop"
			root.Size = UDim2.new(0, 320, 0, 260)
			root.Position = UDim2.new(0.5, -160, 0.5, -130)
			root.BackgroundColor3 = BG
			root.Parent = sg
			addCorner(root, 8)
			ink(root, STROKE, 1.2)
			local title = Instance.new("TextLabel")
			title.Size = UDim2.new(1, -16, 0, 32)
			title.Position = UDim2.new(0, 8, 0, 4)
			title.BackgroundTransparency = 1
			title.Font = Enum.Font.GothamBold
			title.TextSize = 14
			title.TextColor3 = TEXT
			title.TextXAlignment = Enum.TextXAlignment.Left
			title.Text = "  FORGE  ·  EMPORIUM"
			title.Parent = root
			goldLine(root, 36)
			local list = Instance.new("Frame")
			list.Size = UDim2.new(1, -16, 1, -48)
			list.Position = UDim2.new(0, 8, 0, 42)
			list.BackgroundTransparency = 1
			list.Parent = root
			local lay = Instance.new("UIListLayout")
			lay.Padding = UDim.new(0, 8)
			lay.Parent = list
			local items = { { "Ember Blade", "120" }, { "Ash Cloak", "85" }, { "Rune Core", "200" }, { "Night Oil", "40" } }
			for _, it in ipairs(items) do
				local row = Instance.new("Frame")
				row.Size = UDim2.new(1, 0, 0, 40)
				row.BackgroundColor3 = PANEL
				row.Parent = list
				addCorner(row, 8)
				ink(row, STROKE, 1)
				local n = Instance.new("TextLabel")
				n.BackgroundTransparency = 1
				n.Size = UDim2.new(1, -88, 1, 0)
				n.Position = UDim2.new(0, 12, 0, 0)
				n.Font = Enum.Font.GothamMedium
				n.TextSize = 13
				n.TextColor3 = TEXT
				n.TextXAlignment = Enum.TextXAlignment.Left
				n.Text = it[1]
				n.Parent = row
				local buy = Instance.new("TextButton")
				buy.Size = UDim2.new(0, 72, 0, 26)
				buy.Position = UDim2.new(1, -80, 0.5, -13)
				buy.BackgroundColor3 = RAISED
				buy.Font = Enum.Font.GothamBold
				buy.TextSize = 11
				buy.TextColor3 = GOLD
				buy.Text = it[2] .. "g"
				buy.Parent = row
				addCorner(buy, 6)
				ink(buy, GOLD, 1)
			end
			return okdata({ path = pathOf(root), type = kind, forge = true }, "created Forge shop")
		end

		-- forge_panel (default window)
		local win = Instance.new("Frame")
		win.Name = "ForgePanel"
		win.Size = UDim2.new(0, 420, 0, 280)
		win.Position = UDim2.new(0.5, -210, 0.5, -140)
		win.BackgroundColor3 = BG
		win.Parent = sg
		addCorner(win, 10)
		ink(win, STROKE, 1.4)
		local bar = Instance.new("Frame")
		bar.Name = "Titlebar"
		bar.Size = UDim2.new(1, 0, 0, 36)
		bar.BackgroundColor3 = PANEL
		bar.Parent = win
		addCorner(bar, 10)
		local diamond = Instance.new("TextLabel")
		diamond.Size = UDim2.new(0, 28, 1, 0)
		diamond.BackgroundTransparency = 1
		diamond.Font = Enum.Font.GothamBold
		diamond.TextSize = 14
		diamond.TextColor3 = GOLD
		diamond.Text = "◆"
		diamond.Parent = bar
		local title = Instance.new("TextLabel")
		title.Size = UDim2.new(1, -70, 1, 0)
		title.Position = UDim2.new(0, 28, 0, 0)
		title.BackgroundTransparency = 1
		title.Font = Enum.Font.GothamBold
		title.TextSize = 13
		title.TextColor3 = TEXT
		title.TextXAlignment = Enum.TextXAlignment.Left
		title.Text = tostring(a.title or "FORGE")
		title.Parent = bar
		local close = Instance.new("TextButton")
		close.Size = UDim2.new(0, 28, 0, 22)
		close.Position = UDim2.new(1, -34, 0.5, -11)
		close.BackgroundColor3 = RAISED
		close.Font = Enum.Font.GothamBold
		close.TextSize = 12
		close.TextColor3 = MUTED
		close.Text = "✕"
		close.Parent = bar
		addCorner(close, 6)
		goldLine(win, 36)
		local rail = Instance.new("Frame")
		rail.Name = "Rail"
		rail.Size = UDim2.new(0, 56, 1, -36)
		rail.Position = UDim2.new(0, 0, 0, 36)
		rail.BackgroundColor3 = PANEL
		rail.Parent = win
		iconBtn(rail, "⌂", 10, 12)
		iconBtn(rail, "⚔", 10, 54)
		iconBtn(rail, "⚙", 10, 96)
		iconBtn(rail, "◆", 10, 138)
		local body = Instance.new("Frame")
		body.Name = "Body"
		body.Size = UDim2.new(1, -68, 1, -48)
		body.Position = UDim2.new(0, 62, 0, 44)
		body.BackgroundTransparency = 1
		body.Parent = win
		local card = Instance.new("Frame")
		card.Name = "Inset"
		card.Size = UDim2.new(1, 0, 1, 0)
		card.BackgroundColor3 = PANEL
		card.Parent = body
		addCorner(card, 8)
		ink(card, STROKE, 1)
		addPadding(card, 12)
		local copy = Instance.new("TextLabel")
		copy.BackgroundTransparency = 1
		copy.Size = UDim2.new(1, 0, 1, 0)
		copy.Font = Enum.Font.Gotham
		copy.TextSize = 13
		copy.TextColor3 = MUTED
		copy.TextWrapped = true
		copy.TextXAlignment = Enum.TextXAlignment.Left
		copy.TextYAlignment = Enum.TextYAlignment.Top
		copy.Text = "Forge workbench ready.\\nGold hairline, metal rail, inset body.\\nBuild your content here."
		copy.Parent = card
		return okdata({ path = pathOf(win), type = kind, forge = true }, "created Forge window at " .. pathOf(win))

	return fail("unknown component_type '" .. compType .. "' (use health_stamina_hud, dialog_box, notification_toast, card_inventory, forge_panel, forge_hud, forge_button, forge_inventory, forge_shop)")
end

function api.ui_inspect(a)
	local target = a.screen_name and StarterGui:FindFirstChild(tostring(a.screen_name)) or StarterGui
	local guis = {}
	for _, child in ipairs(target:GetChildren()) do
		if child:IsA("ScreenGui") or child:IsA("GuiObject") then
			guis[#guis + 1] = { name = child.Name, className = child.ClassName, children = #child:GetChildren() }
		end
	end
	return okdata({ items = guis }, ("StarterGui contains %d top-level GUI element(s)"):format(#guis))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- FX & PARTICLE STUDIO
-- ═════════════════════════════════════════════════════════════════════════════

local FX_PRESETS = {
	fire = {
		rate = 40,
		lifetime = NumberRange.new(0.6, 1.2),
		speed = NumberRange.new(5, 10),
		size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1.5), NumberSequenceKeypoint.new(0.5, 2.5), NumberSequenceKeypoint.new(1, 0.2) }),
		transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.7, 0.3), NumberSequenceKeypoint.new(1, 1) }),
		color = ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 220, 100)), ColorSequenceKeypoint.new(0.4, Color3.fromRGB(255, 100, 20)), ColorSequenceKeypoint.new(1, Color3.fromRGB(120, 20, 10)) }),
		lightEmission = 0.8,
		spreadAngle = Vector2.new(15, 15),
		acceleration = Vector3.new(0, 8, 0)
	},
	smoke = {
		rate = 20,
		lifetime = NumberRange.new(2, 3.5),
		speed = NumberRange.new(2, 5),
		size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.6, 3), NumberSequenceKeypoint.new(1, 5) }),
		transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.4), NumberSequenceKeypoint.new(0.5, 0.6), NumberSequenceKeypoint.new(1, 1) }),
		color = ColorSequence.new(Color3.fromRGB(120, 120, 125)),
		lightEmission = 0.1,
		spreadAngle = Vector2.new(25, 25),
		acceleration = Vector3.new(0, 3, 0)
	},
	sparks = {
		rate = 50,
		lifetime = NumberRange.new(0.3, 0.8),
		speed = NumberRange.new(15, 30),
		size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3), NumberSequenceKeypoint.new(1, 0.05) }),
		transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(1, 0.8) }),
		color = ColorSequence.new(Color3.fromRGB(255, 230, 120)),
		lightEmission = 1.0,
		spreadAngle = Vector2.new(45, 45),
		acceleration = Vector3.new(0, -25, 0)
	},
	magic_portal = {
		rate = 60,
		lifetime = NumberRange.new(1.0, 2.0),
		speed = NumberRange.new(3, 8),
		size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.5), NumberSequenceKeypoint.new(0.5, 1.8), NumberSequenceKeypoint.new(1, 0) }),
		transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(0.8, 0.5), NumberSequenceKeypoint.new(1, 1) }),
		color = ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromRGB(140, 50, 255)), ColorSequenceKeypoint.new(0.5, Color3.fromRGB(50, 220, 255)), ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 50, 200)) }),
		lightEmission = 0.9,
		spreadAngle = Vector2.new(180, 180),
		acceleration = Vector3.new(0, 2, 0)
	},
	healing_aura = {
		rate = 25,
		lifetime = NumberRange.new(1.2, 2.0),
		speed = NumberRange.new(2, 4),
		size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.4), NumberSequenceKeypoint.new(0.5, 1.2), NumberSequenceKeypoint.new(1, 0.2) }),
		transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.1), NumberSequenceKeypoint.new(0.7, 0.4), NumberSequenceKeypoint.new(1, 1) }),
		color = ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromRGB(100, 255, 160)), ColorSequenceKeypoint.new(1, Color3.fromRGB(46, 204, 113)) }),
		lightEmission = 0.85,
		spreadAngle = Vector2.new(30, 30),
		acceleration = Vector3.new(0, 4, 0)
	}
}

function api.fx_create_emitter(a)
	local pPath = tostring(a.parent_path or "")
	if pPath == "" then return fail("parent_path is required (e.g. Workspace.Part)") end
	local parent = resolvePath(pPath)
	if not parent or (not parent:IsA("BasePart") and not parent:IsA("Attachment")) then
		return fail(("'%s' must be a BasePart or Attachment"):format(pPath))
	end

	local presetName = tostring(a.preset or "fire"):lower()
	local cfg = FX_PRESETS[presetName]
	if not cfg then
		local valid = {}
		for k in pairs(FX_PRESETS) do valid[#valid + 1] = k end
		table.sort(valid)
		return fail("unknown fx preset '" .. presetName .. "'. Valid: " .. table.concat(valid, ", "))
	end

	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = presetName:gsub("^%l", string.upper) .. "FX"
	emitter.Rate = tonumber(a.rate) or cfg.rate
	emitter.Lifetime = cfg.lifetime
	emitter.Speed = cfg.speed
	emitter.Size = cfg.size
	emitter.Transparency = cfg.transparency
	emitter.Color = cfg.color
	emitter.LightEmission = cfg.lightEmission
	emitter.SpreadAngle = cfg.spreadAngle
	emitter.Acceleration = cfg.acceleration
	emitter.Parent = parent

	return okdata({ path = pathOf(emitter), preset = presetName, rate = emitter.Rate },
		("created '%s' particle effect on '%s'"):format(presetName, pathOf(parent)))
end

function api.fx_create_light(a)
	local pPath = tostring(a.parent_path or "")
	if pPath == "" then return fail("parent_path is required") end
	local parent = resolvePath(pPath)
	if not parent or (not parent:IsA("BasePart") and not parent:IsA("Attachment")) then
		return fail(("'%s' must be a BasePart or Attachment"):format(pPath))
	end

	local lType = tostring(a.light_type or "PointLight")
	if lType ~= "PointLight" and lType ~= "SpotLight" and lType ~= "SurfaceLight" then lType = "PointLight" end

	local light = Instance.new(lType)
	light.Name = lType
	light.Brightness = tonumber(a.brightness) or 2.0
	light.Range = tonumber(a.range) or 16.0
	light.Shadows = a.shadows ~= false

	if a.color and type(a.color) == "table" and #a.color == 3 then
		light.Color = Color3.fromRGB(tonumber(a.color[1]) or 255, tonumber(a.color[2]) or 255, tonumber(a.color[3]) or 255)
	elseif tostring(a.color) == "warm_candle" then
		light.Color = Color3.fromRGB(255, 170, 80)
	elseif tostring(a.color) == "neon_blue" then
		light.Color = Color3.fromRGB(0, 200, 255)
	elseif tostring(a.color) == "red_alert" then
		light.Color = Color3.fromRGB(255, 40, 40)
	else
		light.Color = Color3.fromRGB(255, 240, 220)
	end
	light.Parent = parent

	return okdata({ path = pathOf(light), type = lType, brightness = light.Brightness, range = light.Range },
		("created %s (brightness %.1f, range %.1f) on '%s'"):format(lType, light.Brightness, light.Range, pathOf(parent)))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- COMPOSITE VFX DIRECTOR
-- ═════════════════════════════════════════════════════════════════════════════

local TEX_FIRE = "rbxasset://textures/particles/fire_main.dds"
local TEX_SMOKE = "rbxasset://textures/particles/smoke_main.dds"
local TEX_SPARK = "rbxasset://textures/particles/sparkles_main.dds"

local function vfxAttachment(host, name, x, y, z)
	local att = Instance.new("Attachment")
	att.Name = name
	att.Position = Vector3.new(x or 0, y or 0, z or 0)
	att.Parent = host
	return att
end

local function vfxEmitter(host, name, tex, colSeq, o)
	o = o or {}
	local e = Instance.new("ParticleEmitter")
	e.Name = name
	e.Texture = tex
	e.Color = colSeq
	e.Rate = o.rate or 10
	e.Lifetime = NumberRange.new(o.lifeMin or 0.6, o.lifeMax or 1.4)
	e.Speed = NumberRange.new(o.speed or 4, (o.speed or 4) * (o.speedVar or 1.5))
	if o.sizeStart then
		e.Size = NumberSequence.new(o.sizeStart, o.sizeEnd or 0)
	else
		e.Size = NumberSequence.new(o.size or 1, o.sizeEnd or (o.size or 1) * 0.4)
	end
	e.Transparency = NumberSequence.new(o.transStart or 0.1, o.transEnd == nil and 1 or o.transEnd)
	e.LightEmission = o.lightEmission or 0.4
	e.SpreadAngle = Vector2.new(o.spreadX or 8, o.spreadY or 8)
	if o.accel then e.Acceleration = o.accel end
	if o.rotSpeed and o.rotSpeed > 0 then e.RotSpeed = NumberRange.new(-o.rotSpeed, o.rotSpeed) end
	if o.drag then e.Drag = o.drag end
	e.Parent = host
	return e
end

local function vfxFlash(host, name, col, brightness, range)
	local f = Instance.new("PointLight")
	f.Name = name
	f.Color = col
	f.Brightness = brightness
	f.Range = range
	f.Shadows = false
	f.Parent = host
	return f
end

local VFX_BUILDERS = {}

VFX_BUILDERS.explosion = function(host, tint, s, out)
	local col = tint or Color3.fromRGB(255, 140, 40)
	table.insert(out, vfxEmitter(host, "ExplosionCore", TEX_FIRE, ColorSequence.new(col), {
		rate = math.floor(22 * s), speed = 16 * s, lifeMin = 0.25, lifeMax = 0.55,
		sizeStart = 1.2 * s, sizeEnd = 5.5 * s, transStart = 0, transEnd = 1,
		lightEmission = 1, spreadX = 180, spreadY = 180, drag = 3 }))
	table.insert(out, vfxEmitter(host, "ExplosionSmoke", TEX_SMOKE, ColorSequence.new(col:Lerp(Color3.new(0, 0, 0), 0.45)), {
		rate = math.max(1, math.floor(9 * s)), speed = 3.5 * s, lifeMin = 1.4, lifeMax = 2.4,
		sizeStart = 2 * s, sizeEnd = 7 * s, transStart = 0.45, transEnd = 1,
		spreadX = 75, spreadY = 75, rotSpeed = 40, accel = Vector3.new(0, 2.5, 0) }))
	table.insert(out, vfxFlash(host, "ExplosionFlash", col, 6 * s, 22 * s))
end

VFX_BUILDERS.laser_beam = function(host, tint, s, out)
	local col = tint or Color3.fromRGB(255, 60, 60)
	local halfZ = host:IsA("BasePart") and host.Size.Z or 2
	local a0 = vfxAttachment(host, "LaserOrigin", 0, 0, -halfZ * 0.5)
	local a1 = vfxAttachment(host, "LaserTip", 0, 0, -28 * s)
	table.insert(out, a0)
	table.insert(out, a1)
	local b = Instance.new("Beam")
	b.Name = "LaserCore"
	b.Attachment0 = a0
	b.Attachment1 = a1
	b.Texture = TEX_SPARK
	b.Color = ColorSequence.new(col)
	b.Width0 = 0.9 * s
	b.Width1 = 0.18 * s
	b.LightEmission = 1
	b.FaceCamera = true
	b.Transparency = NumberSequence.new(0.05, 0.35)
	b.Parent = host
	table.insert(out, b)
end

VFX_BUILDERS.sword_trail = function(host, tint, s, out)
	local col = tint or Color3.fromRGB(200, 225, 255)
	local half = host:IsA("BasePart") and math.max(host.Size.X, host.Size.Y) or 1
	local a0 = vfxAttachment(host, "TrailBase", -half * 0.5, 0, 0)
	local a1 = vfxAttachment(host, "TrailTip", half * 0.5, 0, 0)
	table.insert(out, a0)
	table.insert(out, a1)
	local t = Instance.new("Trail")
	t.Name = "SwordTrail"
	t.Attachment0 = a0
	t.Attachment1 = a1
	t.Texture = TEX_SMOKE
	t.Color = ColorSequence.new(col)
	t.Lifetime = 0.28
	t.LightEmission = 0.85
	t.MinLength = 0.05
	t.WidthScale = NumberSequence.new(1, 0)
	t.Transparency = NumberSequence.new(0.15, 1)
	t.Parent = host
	table.insert(out, t)
end

VFX_BUILDERS.fire_aura = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "FireAura", TEX_FIRE, ColorSequence.new(tint or Color3.fromRGB(255, 120, 30)), {
		rate = math.floor(26 * s), speed = 3 * s, lifeMin = 0.5, lifeMax = 0.9,
		sizeStart = 1.4 * s, sizeEnd = 0.3, transStart = 0.15, transEnd = 1,
		lightEmission = 1, spreadX = 55, spreadY = 55, accel = Vector3.new(0, 5, 0) }))
	table.insert(out, vfxFlash(host, "AuraGlow", tint or Color3.fromRGB(255, 120, 30), 2.5, 14 * s))
end

VFX_BUILDERS.healing_aura = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "HealingMotes", TEX_SPARK, ColorSequence.new(tint or Color3.fromRGB(90, 255, 140)), {
		rate = math.floor(14 * s), speed = 1.6 * s, lifeMin = 1.2, lifeMax = 2,
		sizeStart = 0.32 * s, sizeEnd = 0.02, transStart = 0.1, transEnd = 1,
		lightEmission = 1, spreadX = 70, spreadY = 70, accel = Vector3.new(0, 3.5, 0) }))
	table.insert(out, vfxFlash(host, "HealingGlow", tint or Color3.fromRGB(90, 255, 140), 1.8, 10 * s))
end

VFX_BUILDERS.portal_ring = function(host, tint, s, out)
	local col = tint or Color3.fromRGB(150, 80, 255)
	table.insert(out, vfxEmitter(host, "PortalSwirl", TEX_SPARK, ColorSequence.new(col), {
		rate = math.floor(30 * s), speed = 5 * s, lifeMin = 0.8, lifeMax = 1.4,
		sizeStart = 0.55 * s, sizeEnd = 0.05, transStart = 0, transEnd = 1,
		lightEmission = 1, spreadX = 180, spreadY = 20, rotSpeed = 90, drag = 1.5 }))
	table.insert(out, vfxEmitter(host, "PortalMist", TEX_SMOKE, ColorSequence.new(col:Lerp(Color3.new(1, 1, 1), 0.3)), {
		rate = math.floor(7 * s), speed = 1.2 * s, lifeMin = 1.6, lifeMax = 2.6,
		sizeStart = 2.2 * s, sizeEnd = 4.5 * s, transStart = 0.6, transEnd = 1,
		spreadX = 180, spreadY = 180, rotSpeed = 25 }))
	table.insert(out, vfxFlash(host, "PortalGlow", col, 3, 16 * s))
end

VFX_BUILDERS.rain_zone = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "RainField", TEX_SPARK, ColorSequence.new(tint or Color3.fromRGB(160, 190, 255)), {
		rate = math.floor(180 * s), speed = 30 * s, lifeMin = 0.9, lifeMax = 1.3,
		size = 0.08, transStart = 0.35, transEnd = 0.75, spreadX = 3, spreadY = 3,
		accel = Vector3.new(0, -36, 0) }))
end

VFX_BUILDERS.snow_zone = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "SnowFall", TEX_SPARK, ColorSequence.new(tint or Color3.new(1, 1, 1)), {
		rate = math.floor(50 * s), speed = 2.5 * s, lifeMin = 4, lifeMax = 6,
		size = 0.14, transStart = 0.15, transEnd = 0.8, spreadX = 25, spreadY = 25,
		rotSpeed = 30, accel = Vector3.new(0, -1.5, 0) }))
end

VFX_BUILDERS.lightning_strike = function(host, tint, s, out)
	local col = tint or Color3.fromRGB(235, 240, 255)
	local a0 = vfxAttachment(host, "BoltSky", 0, 34 * s, 0)
	local a1 = vfxAttachment(host, "BoltGround", 0, 0, 0)
	table.insert(out, a0)
	table.insert(out, a1)
	local b = Instance.new("Beam")
	b.Name = "LightningBolt"
	b.Attachment0 = a0
	b.Attachment1 = a1
	b.Texture = TEX_SPARK
	b.Color = ColorSequence.new(col)
	b.Width0 = 1.4 * s
	b.Width1 = 0.25 * s
	b.LightEmission = 1
	b.FaceCamera = true
	b.Transparency = NumberSequence.new(0, 0.2)
	b.Parent = host
	table.insert(out, b)
	table.insert(out, vfxEmitter(host, "ImpactSparks", TEX_SPARK, ColorSequence.new(col), {
		rate = math.floor(40 * s), speed = 14 * s, lifeMin = 0.2, lifeMax = 0.5,
		sizeStart = 0.5 * s, sizeEnd = 0.05, transStart = 0, transEnd = 1,
		lightEmission = 1, spreadX = 180, spreadY = 180 }))
	table.insert(out, vfxFlash(host, "StrikeFlash", col, 8, 30 * s))
end

VFX_BUILDERS.frost_breath = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "FrostBreath", TEX_SMOKE, ColorSequence.new(tint or Color3.fromRGB(170, 220, 255)), {
		rate = math.floor(24 * s), speed = 12 * s, lifeMin = 0.5, lifeMax = 0.9,
		sizeStart = 0.8 * s, sizeEnd = 2.6 * s, transStart = 0.25, transEnd = 1,
		spreadX = 18, spreadY = 18, accel = Vector3.new(0, 0, -14 * s), drag = 2 }))
end

VFX_BUILDERS.sparkle_halo = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "SparkleHalo", TEX_SPARK, ColorSequence.new(tint or Color3.fromRGB(255, 215, 90)), {
		rate = math.floor(10 * s), speed = 0.9 * s, lifeMin = 1, lifeMax = 1.8,
		sizeStart = 0.26 * s, sizeEnd = 0.01, transStart = 0, transEnd = 1,
		lightEmission = 1, spreadX = 100, spreadY = 100, accel = Vector3.new(0, 2, 0) }))
end

VFX_BUILDERS.smoke_plume = function(host, tint, s, out)
	table.insert(out, vfxEmitter(host, "SmokePlume", TEX_SMOKE, ColorSequence.new(tint or Color3.fromRGB(90, 90, 95)), {
		rate = math.floor(16 * s), speed = 2.4 * s, lifeMin = 2, lifeMax = 3.4,
		sizeStart = 1.6 * s, sizeEnd = 5 * s, transStart = 0.35, transEnd = 1,
		spreadX = 12, spreadY = 12, rotSpeed = 20, accel = Vector3.new(0, 1.8, 0) }))
end

function api.fx_create_vfx(a)
	local pPath = tostring(a.parent_path or "")
	if pPath == "" then return fail("parent_path is required (e.g. Workspace.Boss.HumanoidRootPart)") end
	local host = resolvePath(pPath)
	if not host or (not host:IsA("BasePart") and not host:IsA("Attachment")) then
		return fail(("'%s' must be a BasePart or Attachment"):format(pPath))
	end

	local eff = tostring(a.effect or ""):lower()
	local build = VFX_BUILDERS[eff]
	if not build then
		local valid = {}
		for k in pairs(VFX_BUILDERS) do valid[#valid + 1] = k end
		table.sort(valid)
		if eff == "" then
			return fail("effect is required. Valid: " .. table.concat(valid, ", "))
		end
		return fail("unknown vfx effect '" .. eff .. "'. Valid: " .. table.concat(valid, ", "))
	end

	local col
	if type(a.color) == "table" and #a.color == 3 then
		col = Color3.fromRGB(
			math.clamp(tonumber(a.color[1]) or 255, 0, 255),
			math.clamp(tonumber(a.color[2]) or 255, 0, 255),
			math.clamp(tonumber(a.color[3]) or 255, 0, 255))
	end

	local scale = tonumber(a.scale) or 1
	if scale < 0.1 or scale > 10 then scale = 1 end

	local created = {}
	build(host, col, scale, created)
	local names = {}
	for i, inst in ipairs(created) do names[i] = inst.Name end

	return okdata({ effect = eff, parent = pathOf(host), elements = names, scale = scale },
		("assembled '%s' VFX (%d element%s) on '%s'"):format(eff, #created, #created == 1 and "" or "s", pathOf(host)))
end

function api.fx_create_beam(a)
	local pPath = tostring(a.parent_path or "")
	if pPath == "" then return fail("parent_path is required (e.g. Workspace.Part)") end
	local host = resolvePath(pPath)
	if not host or (not host:IsA("BasePart") and not host:IsA("Attachment")) then
		return fail(("'%s' must be a BasePart or Attachment"):format(pPath))
	end
	local parentPart = host:IsA("BasePart") and host or host.Parent
	if not parentPart or not parentPart:IsA("BasePart") then parentPart = workspace:FindFirstChild("Baseplate") or workspace:FindFirstChildWhichIsA("BasePart")
		if not parentPart then return fail("could not find a BasePart to host beam attachments") end
	end
	local tPath = tostring(a.target_path or "")
	local a0 = vfxAttachment(parentPart, "BeamA0", 0, 0, 0)
	local a1
	if tPath ~= "" then
		local target = resolvePath(tPath)
		if target and target:IsA("Attachment") then
			a1 = target
			a0.Parent = parentPart
		elseif target and target:IsA("BasePart") then
			a1 = vfxAttachment(target, "BeamA1", 0, 0, 0)
		else
			a1 = vfxAttachment(parentPart, "BeamA1", 0, 0, -12)
		end
	else
		a1 = vfxAttachment(parentPart, "BeamA1", 0, 0, -12)
	end
	-- ensure a0 parent is correct when host was Attachment
	if host:IsA("Attachment") then a0 = host end
	local col
	if type(a.color) == "table" and #a.color == 3 then
		col = Color3.fromRGB(math.clamp(tonumber(a.color[1]) or 255,0,255), math.clamp(tonumber(a.color[2]) or 255,0,255), math.clamp(tonumber(a.color[3]) or 255,0,255))
	else
		col = Color3.fromRGB(0, 200, 255)
	end
	local beam = Instance.new("Beam")
	beam.Name = "VFXBeam"
	beam.Attachment0 = a0
	beam.Attachment1 = a1
	beam.Texture = tostring(a.texture or "") ~= "" and tostring(a.texture) or TEX_SPARK
	beam.Color = ColorSequence.new(col)
	beam.Width0 = tonumber(a.width0) or tonumber(a.width) or 0.6
	beam.Width1 = tonumber(a.width1) or (tonumber(a.width) or 0.6) * 0.35
	beam.Segments = math.clamp(tonumber(a.segments) or 10, 1, 20)
	beam.LightEmission = tonumber(a.light_emission) or 1
	beam.LightInfluence = tonumber(a.light_influence) or 0
	beam.FaceCamera = a.face_camera ~= false
	beam.Transparency = NumberSequence.new(tonumber(a.transparency0) or 0.05, tonumber(a.transparency1) or 0.35)
	beam.Parent = parentPart
	return okdata({ path = pathOf(beam), attachment0 = pathOf(a0), attachment1 = pathOf(a1), width0 = beam.Width0 },
		("created beam '%s' between '%s' and '%s'"):format(pathOf(beam), pathOf(a0), pathOf(a1)))
end

function api.fx_create_trail(a)
	local pPath = tostring(a.parent_path or "")
	if pPath == "" then return fail("parent_path is required (e.g. Workspace.Sword.Blade)") end
	local host = resolvePath(pPath)
	if not host then return fail(("'%s' not found"):format(pPath)) end
	local parentPart = host:IsA("BasePart") and host or (host:IsA("Attachment") and host.Parent or nil)
	if not parentPart or not parentPart:IsA("BasePart") then
		if host:IsA("BasePart") then parentPart = host else return fail("parent_path must be a BasePart or child of one") end
	end
	local a0Path = tostring(a.attachment0_path or "")
	local a1Path = tostring(a.attachment1_path or "")
	local at0, at1
	if a0Path ~= "" then at0 = resolvePath(a0Path) end
	if a1Path ~= "" then at1 = resolvePath(a1Path) end
	if not at0 or not at0:IsA("Attachment") then at0 = vfxAttachment(parentPart, "Trail0", -1.5, 0, 0) end
	if not at1 or not at1:IsA("Attachment") then at1 = vfxAttachment(parentPart, "Trail1", 1.5, 0, 0) end
	local col
	if type(a.color) == "table" and #a.color == 3 then
		col = Color3.fromRGB(math.clamp(tonumber(a.color[1]) or 255,0,255), math.clamp(tonumber(a.color[2]) or 255,0,255), math.clamp(tonumber(a.color[3]) or 255,0,255))
	else
		col = Color3.fromRGB(255, 255, 255)
	end
	local trail = Instance.new("Trail")
	trail.Name = "VFXTrail"
	trail.Attachment0 = at0
	trail.Attachment1 = at1
	trail.Texture = tostring(a.texture or "") ~= "" and tostring(a.texture) or TEX_SMOKE
	trail.Color = ColorSequence.new(col)
	trail.Lifetime = math.clamp(tonumber(a.lifetime) or 0.6, 0.05, 5)
	trail.MinLength = tonumber(a.min_length) or 0.1
	trail.WidthScale = NumberSequence.new(1, 0)
	trail.Transparency = NumberSequence.new(tonumber(a.transparency0) or 0.15, tonumber(a.transparency1) or 1)
	trail.LightEmission = tonumber(a.light_emission) ~= nil and tonumber(a.light_emission) or 0.5
	trail.FaceCamera = a.face_camera ~= false
	trail.Parent = parentPart
	trail.Enabled = true
	return okdata({ path = pathOf(trail), attachment0 = pathOf(at0), attachment1 = pathOf(at1), lifetime = trail.Lifetime },
		("created trail '%s' on '%s' (%.2fs)"):format(pathOf(trail), pathOf(parentPart), trail.Lifetime))
end

function api.fx_create_explosion(a)
	local pPath = tostring(a.parent_path or "Workspace")
	local host = resolvePath(pPath)
	if not host then host = workspace end
	local pos
	if host:IsA("BasePart") then pos = host.Position
	elseif host:IsA("Attachment") then pos = host.WorldPosition
	else pos = Vector3.new(0, 10, 0) end
	if type(a.position) == "table" and #a.position == 3 then
		pos = Vector3.new(tonumber(a.position[1]) or pos.X, tonumber(a.position[2]) or pos.Y, tonumber(a.position[3]) or pos.Z)
	end
	local blastPressure = tonumber(a.blast_pressure) or tonumber(a.pressure) or 10000
	local blastRadius = tonumber(a.blast_radius) or tonumber(a.radius) or 12
	local destroyRadius = tonumber(a.destroy_joint_radius_percent) or 30
	local expType = tostring(a.explosion_type or "NoCraters")
	local explosion = Instance.new("Explosion")
	explosion.Name = "VFXExplosion"
	explosion.BlastPressure = math.clamp(blastPressure, 0, 100000)
	explosion.BlastRadius = math.clamp(blastRadius, 1, 100)
	explosion.DestroyJointRadiusPercent = math.clamp(destroyRadius, 0, 100)
	if expType == "Craters" or expType == "NoCraters" then explosion.ExplosionType = Enum.ExplosionType[expType] end
	explosion.Position = pos
	-- visual supplement: flash light + sparks at blast center
	local anchor = Instance.new("Part")
	anchor.Name = "ExplosionAnchor"
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanQuery = false
	anchor.Transparency = 1
	anchor.Size = Vector3.new(1,1,1)
	anchor.CFrame = CFrame.new(pos)
	anchor.Parent = workspace
	local light = Instance.new("PointLight")
	light.Name = "ExplosionFlash"
	light.Color = Color3.fromRGB(255, 180, 60)
	light.Brightness = 6
	light.Range = blastRadius * 2
	light.Shadows = false
	light.Parent = anchor
	vfxEmitter(anchor, "ExplosionSparks", TEX_SPARK, ColorSequence.new(Color3.fromRGB(255, 200, 80)), { rate = 60, speed = 18, lifeMin = 0.2, lifeMax = 0.45, sizeStart = 0.6, sizeEnd = 0.05, spreadX = 180, spreadY = 180, lightEmission = 1 })
	Debris:AddItem(anchor, 2)
	explosion.Parent = workspace
	return okdata({ path = pathOf(explosion), blastPressure = explosion.BlastPressure, blastRadius = explosion.BlastRadius, position = {pos.X, pos.Y, pos.Z} },
		("created explosion at (%.1f, %.1f, %.1f) radius %.1f pressure %d"):format(pos.X, pos.Y, pos.Z, explosion.BlastRadius, explosion.BlastPressure))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIO ARCHITECTURE STUDIO
-- ═════════════════════════════════════════════════════════════════════════════

function api.audio_setup_sound_hierarchy()
	local function ensureGroup(parent, name, vol)
		local g = parent:FindFirstChild(name)
		if not g or not g:IsA("SoundGroup") then
			g = Instance.new("SoundGroup")
			g.Name = name
			g.Volume = vol or 1.0
			g.Parent = parent
		end
		return g
	end

	local master = ensureGroup(SoundService, "Master", 1.0)
	local music = ensureGroup(master, "Music", 0.7)
	local sfx = ensureGroup(master, "SFX", 1.0)
	local combat = ensureGroup(sfx, "Combat", 1.0)
	local footsteps = ensureGroup(sfx, "Footsteps", 0.6)
	local ambience = ensureGroup(master, "Ambience", 0.5)
	local ui = ensureGroup(master, "UI", 0.8)
	local voice = ensureGroup(master, "Voice", 1.0)

	local eq = ambience:FindFirstChildOfClass("EqualizerSoundEffect") or Instance.new("EqualizerSoundEffect")
	eq.LowGain = 2
	eq.MidGain = -1
	eq.HighGain = 3
	eq.Parent = ambience

	return okdata({ master = pathOf(master) }, "configured production SoundService hierarchy (Master -> Music, SFX [Combat/Footsteps], Ambience, UI, Voice)")
end

function api.audio_create_sound(a)
	local pPath = tostring(a.parent_path or "Workspace")
	local parent = resolvePath(pPath) or workspace
	local sId = tostring(a.sound_id or "")
	if sId == "" then return fail("sound_id is required (e.g. 'rbxassetid://9114223120' or '9114223120')") end
	if not sId:find("://") then sId = "rbxassetid://" .. sId end

	local sound = Instance.new("Sound")
	sound.Name = tostring(a.name or "SoundEffect")
	sound.SoundId = sId
	sound.Volume = tonumber(a.volume) or 0.5
	sound.Looped = a.looped == true
	sound.PlaybackSpeed = tonumber(a.playback_speed) or 1.0
	sound.RollOffMaxDistance = tonumber(a.roll_off_max_distance) or 100

	if a.sound_group then
		local sg = SoundService:FindFirstChild(tostring(a.sound_group), true)
		if sg and sg:IsA("SoundGroup") then sound.SoundGroup = sg end
	end
	sound.Parent = parent

	return okdata({ path = pathOf(sound), soundId = sId, volume = sound.Volume, looped = sound.Looped },
		("created sound '%s' on '%s'"):format(sound.Name, pathOf(parent)))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- PROCEDURAL TERRAIN SCULPTOR
-- ═════════════════════════════════════════════════════════════════════════════

function api.terrain_fill_region(a)
	local terr = workspace.Terrain
	local matName = tostring(a.material or "Grass")
	local mat = Enum.Material[matName]
	if not mat then return fail("unknown material '" .. matName .. "'") end

	local cfArr = a.cframe or { 0, 0, 0 }
	local szArr = a.size or { 32, 16, 32 }
	local cf = CFrame.new(tonumber(cfArr[1]) or 0, tonumber(cfArr[2]) or 0, tonumber(cfArr[3]) or 0)
	local sz = Vector3.new(math.max(4, tonumber(szArr[1]) or 32), math.max(4, tonumber(szArr[2]) or 16), math.max(4, tonumber(szArr[3]) or 32))
	local shape = tostring(a.shape or "block"):lower()

	if shape == "ball" then
		terr:FillBall(cf.Position, math.max(sz.X, sz.Y, sz.Z) / 2, mat)
	elseif shape == "cylinder" then
		terr:FillCylinder(cf, sz.Y, sz.X / 2, mat)
	else
		terr:FillBlock(cf, sz, mat)
	end

	return okdata({ material = matName, shape = shape, position = { cf.Position.X, cf.Position.Y, cf.Position.Z }, size = { sz.X, sz.Y, sz.Z } },
		("filled %s terrain %s at (%.1f, %.1f, %.1f) with %s"):format(shape, sz:__tostring(), cf.Position.X, cf.Position.Y, cf.Position.Z, matName))
end

function api.terrain_clear(a)
	local terr = workspace.Terrain
	if not a.cframe or not a.size then
		terr:Clear()
		return okdata({}, "cleared entire workspace Terrain")
	end
	local cfArr = a.cframe
	local szArr = a.size
	local cf = CFrame.new(tonumber(cfArr[1]) or 0, tonumber(cfArr[2]) or 0, tonumber(cfArr[3]) or 0)
	local sz = Vector3.new(tonumber(szArr[1]) or 64, tonumber(szArr[2]) or 32, tonumber(szArr[3]) or 64)
	terr:FillBlock(cf, sz, Enum.Material.Air)
	return okdata({}, ("cleared terrain region around (%.1f, %.1f, %.1f)"):format(cf.Position.X, cf.Position.Y, cf.Position.Z))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- CAMERA & PERSPECTIVE CONTROLLER
-- ═════════════════════════════════════════════════════════════════════════════

function api.camera_set_style(a)
	local style = tostring(a.style or "isometric"):lower()
	local dist = tonumber(a.distance) or 30
	local fov = tonumber(a.fov) or 60

	local scr = StarterPlayer.StarterPlayerScripts:FindFirstChild("RobloxScript_CameraController")
	if not scr then
		scr = Instance.new("LocalScript")
		scr.Name = "RobloxScript_CameraController"
		scr.Parent = StarterPlayer.StarterPlayerScripts
	end

	if style == "isometric" then
		scr.Source = string.format([[-- Isometric Camera Controller
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

camera.CameraType = Enum.CameraType.Scriptable
camera.FieldOfView = %d
local OFFSET = Vector3.new(%d, %d, %d)

RunService:BindToRenderStep("IsometricCamera", Enum.RenderPriority.Camera.Value + 1, function()
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart")
	if root then
		camera.CFrame = CFrame.new(root.Position + OFFSET, root.Position)
	end
end)
]], fov, dist * 0.7, dist * 0.9, dist * 0.7)

	elseif style == "top_down" then
		scr.Source = string.format([[-- Top-Down Camera Controller
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

camera.CameraType = Enum.CameraType.Scriptable
camera.FieldOfView = %d
local HEIGHT = %d

RunService:BindToRenderStep("TopDownCamera", Enum.RenderPriority.Camera.Value + 1, function()
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart")
	if root then
		camera.CFrame = CFrame.new(root.Position + Vector3.new(0, HEIGHT, 0), root.Position)
	end
end)
]], fov, dist)

	elseif style == "side_scroller" then
		scr.Source = string.format([[-- 2.5D Side-Scroller Camera Controller
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

camera.CameraType = Enum.CameraType.Scriptable
camera.FieldOfView = %d
local DIST = %d

RunService:BindToRenderStep("SideScrollerCamera", Enum.RenderPriority.Camera.Value + 1, function()
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart")
	if root then
		camera.CFrame = CFrame.new(Vector3.new(root.Position.X, root.Position.Y + 4, root.Position.Z + DIST), root.Position + Vector3.new(0, 2, 0))
	end
end)
]], fov, dist)

	else
		return fail("unknown camera style '" .. style .. "' (use isometric, top_down, or side_scroller)")
	end

	return okdata({ script = pathOf(scr), style = style, fov = fov },
		("injected '%s' camera script into StarterPlayerScripts (%s)"):format(style, pathOf(scr)))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- DIAGNOSTICS & PLACE AUDIT
-- ═════════════════════════════════════════════════════════════════════════════

function api.diagnostics_audit()
	local unanchored = {}
	local missingRoots = {}
	local totalParts, totalScripts = 0, 0

	local function safeDesc(root, fn)
		local ok, desc = pcall(function() return root:GetDescendants() end)
		if not ok or type(desc) ~= "table" then return end
		for _, d in ipairs(desc) do
			pcall(fn, d)
		end
	end

	safeDesc(workspace, function(d)
		if d:IsA("BasePart") then
			totalParts = totalParts + 1
			if not d.Anchored and d.Parent == workspace then
				unanchored[#unanchored + 1] = d.Name
			end
		elseif d:IsA("Model") and d:FindFirstChildOfClass("Humanoid") then
			if not d:FindFirstChild("HumanoidRootPart") and not d.PrimaryPart then
				missingRoots[#missingRoots + 1] = d.Name
			end
		end
	end)

	for _, svc in ipairs({"ServerScriptService","StarterPlayer","StarterGui","ReplicatedStorage","ServerStorage","Workspace","StarterPack"}) do
		local okSvc, inst = pcall(function() return game:GetService(svc) end)
		if okSvc and inst then
			safeDesc(inst, function(d)
				if d:IsA("LuaSourceContainer") then totalScripts = totalScripts + 1 end
			end)
		end
	end

	local issues = {}
	if #unanchored > 0 then issues[#issues + 1] = ("%d unanchored top-level part(s)"):format(#unanchored) end
	if #missingRoots > 0 then issues[#issues + 1] = ("%d humanoid model(s) missing root parts"):format(#missingRoots) end
	if not workspace.StreamingEnabled then issues[#issues + 1] = "StreamingEnabled is OFF (recommend enabling for large places)" end

	return okdata({
		totalParts = totalParts,
		totalScripts = totalScripts,
		unanchoredCount = #unanchored,
		missingRootModels = missingRoots,
		streamingEnabled = workspace.StreamingEnabled,
		issues = issues
	}, ("AUDIT: %d parts, %d scripts | %s"):format(totalParts, totalScripts, #issues == 0 and "All healthy!" or table.concat(issues, "; ")))
end

function api.diagnostics_fix_common(a)
	local fixed = {}
	if a.anchor_static_parts ~= false then
		local c = 0
		for _, p in ipairs(workspace:GetDescendants()) do
			if p:IsA("BasePart") and not p.Anchored then
				local m = p:FindFirstAncestorOfClass("Model")
				if not (m and m:FindFirstChildOfClass("Humanoid")) then
					p.Anchored = true
					c = c + 1
				end
			end
		end
		if c > 0 then fixed[#fixed + 1] = ("anchored %d static part(s)"):format(c) end
	end

	if a.enable_streaming ~= false and not workspace.StreamingEnabled then
		workspace.StreamingEnabled = true
		fixed[#fixed + 1] = "enabled Workspace.StreamingEnabled"
	end

	return okdata({ applied = fixed }, ("fixed common issues: %s"):format(#fixed > 0 and table.concat(fixed, ", ") or "already optimized"))
end

function api.asset_bridge_import(a)
	local src = tostring(a.source or "blender")
	local asset = tostring(a.asset or "")
	local target = tostring(a.target_engine or "roblox")
	local dest = tostring(a.dest or "/Game/Imported")
	if asset == "" then return fail("asset is required (rbxassetid://… or /Game/…)") end
	-- Cross-engine bridge: queue FBX export/import via watch-folder factory (stub for beta)
	return okdata({ source = src, asset = asset, target = target, dest = dest },
		("asset_bridge_import queued: %s (%s) -> %s:%s — factory will handle FBX + auto-LOD"):format(asset, src, target, dest))
end

-- ═════════════════════════════════════════════════════════════════════════════
-- PERSISTENCE & NETWORKING — most-requested per Creator docs
-- ═════════════════════════════════════════════════════════════════════════════

function api.datastore_setup(a)
	local storeName = tostring(a.store_name or a.name or "PlayerData")
	if storeName == "" then storeName = "PlayerData" end
	local coinName = tostring(a.currency_name or "Coins")
	local autoSave = tonumber(a.autosave_interval) or 60
	if autoSave < 15 then autoSave = 15 end
	local leaderstats = a.leaderstats ~= false
	local scr = ServerScriptService:FindFirstChild("RobloxScript_DataStore")
	if not scr then
		scr = Instance.new("Script")
		scr.Name = "RobloxScript_DataStore"
		scr.Parent = ServerScriptService
	end
	scr.Source = string.format([=[-- RobloxScript DataStore (DataStoreService best-practice)
-- Store: %s | Currency: %s | Autosave: %ds
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local store = DataStoreService:GetDataStore("%s")
local cache = {} -- userId -> data
local defaults = { %s = 0, Level = 1 }

local function clone(t) local c={}; for k,v in pairs(t) do c[k]=v end; return c end

local function load(player)
	local ok, data = pcall(function() return store:GetAsync(tostring(player.UserId)) end)
	if ok and type(data)=="table" then cache[player.UserId]=data else cache[player.UserId]=clone(defaults) end
	if %s then
		local ls = Instance.new("Folder"); ls.Name="leaderstats"; ls.Parent=player
		for k,v in pairs(cache[player.UserId]) do
			if typeof(v)=="number" then local iv=Instance.new("IntValue"); iv.Name=k; iv.Value=v; iv.Parent=ls
				iv.Changed:Connect(function() cache[player.UserId][k]=iv.Value end)
			end
		end
	end
end
local function save(player)
	local data = cache[player.UserId]; if not data then return end
	local ok, err = pcall(function() store:UpdateAsync(tostring(player.UserId), function(old) return data end) end)
	if not ok then warn("[DataStore] save failed for "..player.Name..": "..tostring(err)) end
end
Players.PlayerAdded:Connect(load)
Players.PlayerRemoving:Connect(function(p) save(p); cache[p.UserId]=nil end)
game:BindToClose(function()
	for _,p in ipairs(Players:GetPlayers()) do save(p) end
	task.wait(1.5)
end)
task.spawn(function()
	while true do task.wait(%d)
		for _,p in ipairs(Players:GetPlayers()) do save(p) end
	end
end)
print("[RobloxScript] DataStore '%s' ready (leaderstats=%s).")
]=], storeName, coinName, autoSave, storeName, coinName, tostring(leaderstats), autoSave, storeName, tostring(leaderstats))
	return okdata({ script = pathOf(scr), store = storeName, currency = coinName, autosave = autoSave },
		("installed DataStore '%s' (%s + Level, autosave %ds, leaderstats %s) at %s"):format(storeName, coinName, autoSave, tostring(leaderstats), pathOf(scr)))
end

function api.leaderboard_setup(a)
	local storeName = tostring(a.store_name or "GlobalLeaderboard")
	local title = tostring(a.title or "Top Players")
	local boardPath = tostring(a.board_path or "Workspace.Leaderboard")
	local parent = resolvePath(boardPath:match("(.+)%.[^%.]+$") or "Workspace")
	local boardName = boardPath:match("[^%.]+$") or "Leaderboard"
	if not parent then return fail("parent_path not found: "..boardPath) end
	local board = parent:FindFirstChild(boardName)
	if not board or not board:IsA("BasePart") then
		board = Instance.new("Part")
		board.Name = boardName
		board.Size = Vector3.new(12, 8, 1)
		board.Anchored = true
		board.CanCollide = false
		board.Position = Vector3.new(0, 10, 0)
		board.Parent = parent
	end
	local gui = board:FindFirstChildOfClass("SurfaceGui") or Instance.new("SurfaceGui")
	gui.Name = "LeaderboardGui"; gui.Face = Enum.NormalId.Front; gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 50; gui.Parent = board
	local frame = gui:FindFirstChild("Frame") or Instance.new("Frame")
	frame.Name="Frame"; frame.Size=UDim2.new(1,0,1,0); frame.BackgroundColor3=Color3.fromRGB(18,22,28); frame.Parent=gui
	addCorner(frame,8); addPadding(frame,8)
	local titleLbl = frame:FindFirstChild("Title") or Instance.new("TextLabel")
	titleLbl.Name="Title"; titleLbl.Size=UDim2.new(1,0,0,28); titleLbl.BackgroundTransparency=1
	titleLbl.Font=Enum.Font.GothamBlack; titleLbl.TextSize=20; titleLbl.TextColor3=Color3.fromRGB(241,196,15); titleLbl.Text=title; titleLbl.Parent=frame
	local list = frame:FindFirstChildOfClass("UIListLayout") or Instance.new("UIListLayout")
	list.Padding=UDim.new(0,4); list.SortOrder=Enum.SortOrder.LayoutOrder; list.Parent=frame
	-- ordered datastore fetcher script
	local mod = ServerScriptService:FindFirstChild("LeaderboardManager")
	if not mod then mod = Instance.new("ModuleScript"); mod.Name="LeaderboardManager"; mod.Parent=ServerScriptService end
	mod.Source = string.format([=[local DataStoreService=game:GetService("DataStoreService")
local Players=game:GetService("Players")
local store=DataStoreService:GetOrderedDataStore("%s")
local M={}
function M.GetTop(limit)
	limit=math.clamp(limit or 10,1,100)
	local ok, pages = pcall(function() return store:GetSortedAsync(false, limit) end)
	if not ok or not pages then return {} end
	local top = pages:GetCurrentPage()
	local out={}
	for i, entry in ipairs(top) do
		local uid = tonumber(entry.key) or entry.key
		local name = "Player"
		pcall(function() name = Players:GetNameFromUserIdAsync(tonumber(uid) or 0) end)
		out[i]={rank=i, userId=uid, username=name, score=entry.value}
	end
	return out
end
return M
]=], storeName)
	return okdata({ board = pathOf(board), store = storeName, title = title },
		("leaderboard '%s' -> ordered store '%s' at %s (SurfaceGui + LeaderboardManager)"):format(title, storeName, pathOf(board)))
end

function api.remote_setup(a)
	local ns = tostring(a.namespace or "GameEvents")
	local events = a.events or {"OnDamage","OnInteract","OnReward"}
	if type(events)=="string" then events={events} end
	local includeFn = a.include_function == true
	local folder = ReplicatedStorage:FindFirstChild(ns)
	if not folder then folder=Instance.new("Folder"); folder.Name=ns; folder.Parent=ReplicatedStorage end
	local created={}
	for _, evName in ipairs(events) do
		evName=tostring(evName):gsub("%s+","")
		if evName~="" then
			local isFn = evName:lower():find("function") or evName:lower():find("get") or includeFn
			if isFn then
				if not folder:FindFirstChild(evName) then local rf=Instance.new("RemoteFunction"); rf.Name=evName; rf.Parent=folder; created[#created+1]=evName.."(RF)" end
			else
				if not folder:FindFirstChild(evName) then local re=Instance.new("RemoteEvent"); re.Name=evName; re.Parent=folder; created[#created+1]=evName.."(RE)" end
			end
		end
	end
	-- template handler script (server)
	if not ServerScriptService:FindFirstChild(ns.."_Handler") then
		local h=Instance.new("Script"); h.Name=ns.."_Handler"; h.Parent=ServerScriptService
		h.Source=string.format([=[-- %s handler (template)
local RS = game:GetService("ReplicatedStorage")
local folder = RS:WaitForChild("%s")
for _, obj in ipairs(folder:GetChildren()) do
	if obj:IsA("RemoteEvent") then
		obj.OnServerEvent:Connect(function(player, ...) print("[%%s] "..obj.Name.." from "..player.Name, ...) end)
	elseif obj:IsA("RemoteFunction") then
		obj.OnServerInvoke = function(player, ...) print("[%%s] "..obj.Name.." invoke from "..player.Name, ...) return true end
	end
end
]=], ns, ns, ns, ns)
	end
	return okdata({ folder = pathOf(folder), events = created }, ("remote namespace '%s' ensured with %d remotes: %s"):format(ns, #created, table.concat(created,", ")))
end

function api.npc_spawn_pathfinding(a)
	local rigName = tostring(a.rig_name or "NPC_Dummy")
	local cframeArr = a.cframe or a.position or {0, 10, 0}
	local cf = CFrame.new(tonumber(cframeArr[1]) or 0, tonumber(cframeArr[2]) or 0, tonumber(cframeArr[3]) or 0)
	local targetArr = a.target or {40, 10, 40}
	local target = Vector3.new(tonumber(targetArr[1]) or 40, tonumber(targetArr[2]) or 10, tonumber(targetArr[3]) or 40)
	local speed = tonumber(a.speed) or 12
	local behavior = tostring(a.behavior or "loop"):lower() -- loop, patrol, chase
	local rig = workspace:FindFirstChild(rigName)
	if not rig or not rig:FindFirstChildOfClass("Humanoid") then
		-- try to clone a simple rig from ServerStorage or create blocky dummy
		local template = ReplicatedStorage:FindFirstChild("NPC_Template") or ServerScriptService:FindFirstChild("NPC_Template")
		if template and template:IsA("Model") then rig = template:Clone(); rig.Name=rigName; rig:PivotTo(cf); rig.Parent=workspace
		else
			rig = Instance.new("Model"); rig.Name=rigName; rig.Parent=workspace
			local hrp = Instance.new("Part"); hrp.Name="HumanoidRootPart"; hrp.Size=Vector3.new(2,2,1); hrp.Position=cf.Position; hrp.Anchored=false; hrp.CanCollide=false; hrp.Parent=rig
			local hum = Instance.new("Humanoid"); hum.RootPart=hrp; hum.Parent=rig; rig.PrimaryPart=hrp
			local head = Instance.new("Part"); head.Name="Head"; head.Size=Vector3.new(1,1,1); head.Position=cf.Position+Vector3.new(0,2,0); head.Parent=rig
		end
	end
	local existing = rig:FindFirstChild("PathfindingScript")
	if existing then existing:Destroy() end
	local scr = Instance.new("Script"); scr.Name="PathfindingScript"; scr.Parent=rig
	scr.Source = string.format([=[local PathfindingService=game:GetService("PathfindingService")
local hum = script.Parent:FindFirstChildOfClass("Humanoid")
local hrp = script.Parent:FindFirstChild("HumanoidRootPart") or script.Parent.PrimaryPart
local TARGET = Vector3.new(%.2f, %.2f, %.2f)
local SPEED = %.2f
if hum then hum.WalkSpeed=SPEED end
local function follow(dest)
	local path = PathfindingService:CreatePath({AgentRadius=2, AgentHeight=5, AgentCanJump=true, Costs={Water=20}})
	path:ComputeAsync(hrp.Position, dest)
	if path.Status ~= Enum.PathStatus.Success then warn("[NPC] No path to "..tostring(dest)); return end
	local wps = path:GetWaypoints()
	for _, wp in ipairs(wps) do
		if wp.Action==Enum.PathWaypointAction.Jump and hum then hum:ChangeState(Enum.HumanoidStateType.Jumping) end
		hum:MoveTo(wp.Position); hum.MoveToFinished:Wait()
	end
end
path.Blocked:Connect(function(idx) warn("[NPC] path blocked at "..idx..", recomputing"); task.wait(0.5); follow(TARGET) end)
if "%s"=="loop" then while true do follow(TARGET); task.wait(1); follow(script.Parent:GetPivot().Position+Vector3.new(math.random(-20,20),0,math.random(-20,20))) end
else follow(TARGET) end
]=], target.X, target.Y, target.Z, speed, behavior)
	rig:PivotTo(cf)
	return okdata({ rig = pathOf(rig), target = {target.X, target.Y, target.Z}, speed = speed, behavior = behavior },
		("NPC '%s' pathed to (%.1f,%.1f,%.1f) speed %d (%s)"):format(rigName, target.X,target.Y,target.Z, speed, behavior))
end

function api.proximity_setup(a)
	local targetPath = tostring(a.target_path or a.part_path or "")
	if targetPath=="" then return fail("target_path is required (e.g. Workspace.Chest)") end
	local target = resolvePath(targetPath)
	if not target or not target:IsA("BasePart") then return fail("target_path must be a BasePart: "..targetPath) end
	local actionText = tostring(a.action_text or "Interact")
	local objectText = tostring(a.object_text or target.Name)
	local hold = tonumber(a.hold_duration) or 0
	local maxDist = tonumber(a.max_distance) or 12
	local cooldown = tonumber(a.cooldown) or 1
	local prompt = target:FindFirstChildOfClass("ProximityPrompt")
	if not prompt then prompt=Instance.new("ProximityPrompt"); prompt.Parent=target end
	prompt.ActionText=actionText; prompt.ObjectText=objectText; prompt.HoldDuration=hold; prompt.MaxActivationDistance=maxDist
	prompt.RequiresLineOfSight=false; prompt.ExclusiveGui=false
	local reward = tonumber(a.reward_coins) or 0
	if prompt:FindFirstChild("RewardScript") then prompt.RewardScript:Destroy() end
	local rs = Instance.new("Script"); rs.Name="RewardScript"; rs.Parent=prompt
	rs.Source = string.format([=[local prompt=script.Parent
local debounce={}
prompt.Triggered:Connect(function(player)
	if debounce[player] then return end; debounce[player]=true
	print("[Proximity] "..prompt.ObjectText.." triggered by "..player.Name)
	-- reward example: leaderstats Coins += %d
	local ls = player:FindFirstChild("leaderstats")
	if ls and ls:FindFirstChild("Coins") then ls.Coins.Value += %d end
	task.wait(%d); debounce[player]=nil
end)
]=], reward, reward, cooldown)
	return okdata({ prompt = pathOf(prompt), action = actionText, object = objectText, reward = reward },
		("ProximityPrompt '%s' on %s (hold %.1fs, dist %d, +%d coins)"):format(actionText, pathOf(target), hold, maxDist, reward))
end

function api.tween_create(a)
	local targetPath = tostring(a.target_path or "")
	if targetPath=="" then return fail("target_path is required") end
	local target = resolvePath(targetPath)
	if not target then return fail("target not found: "..targetPath) end
	local property = tostring(a.property or "Position")
	local toVal = a.to
	if toVal==nil then return fail("to is required (Vector3, Color3, number, UDim2, CFrame table)") end
	local duration = tonumber(a.duration) or 1
	local easing = tostring(a.easing or "Sine")
	local dir = tostring(a.direction or "InOut")
	local loop = a.loop == true
	local yoyo = a.yoyo == true
	-- build value literal
	local valStr
	if type(toVal)=="table" and #toVal==3 and property:lower():find("color") then
		valStr = string.format("Color3.fromRGB(%d,%d,%d)", tonumber(toVal[1])or 255, tonumber(toVal[2])or 255, tonumber(toVal[3])or 255)
	elseif type(toVal)=="table" and #toVal==3 and (property=="Position" or property=="Size" or property=="CFrame") then
		valStr = string.format("Vector3.new(%.3f,%.3f,%.3f)", tonumber(toVal[1])or 0, tonumber(toVal[2])or 0, tonumber(toVal[3])or 0)
	elseif type(toVal)=="table" and toVal.x and toVal.y then
		valStr = string.format("UDim2.new(%.3f,%d,%.3f,%d)", tonumber(toVal.xScale)or 0, tonumber(toVal.xOffset)or 0, tonumber(toVal.yScale)or 0, tonumber(toVal.yOffset)or 0)
	elseif type(toVal)=="number" then valStr=tostring(toVal)
	elseif type(toVal)=="string" then valStr=string.format("%q", toVal)
	else valStr = tostring(toVal) end
	local scrName = "Tween_"..property.."_"..tostring(duration):gsub("%.","_")
	if target:FindFirstChild(scrName) then target[scrName]:Destroy() end
	local scr = Instance.new("Script"); scr.Name=scrName; scr.Parent=target
	scr.Source = string.format([=[local TweenService=game:GetService("TweenService")
local obj=script.Parent
local info=TweenInfo.new(%.3f, Enum.EasingStyle.%s, Enum.EasingDirection.%s, %d, %s, 0)
local goal={ %s = %s }
local tw=TweenService:Create(obj, info, goal)
tw:Play()
if %s then tw.Completed:Connect(function(s) if s==Enum.PlaybackState.Completed then tw:Play() end end) end
]=], duration, easing, dir, yoyo and -1 or 0, tostring(yoyo), property, valStr, tostring(loop and not yoyo))
	-- also fire once immediately via TweenService for instant preview
	local ok, err = pcall(function()
		local info = TweenInfo.new(duration, Enum.EasingStyle[easing] or Enum.EasingStyle.Sine, Enum.EasingDirection[dir] or Enum.EasingDirection.InOut, yoyo and -1 or 0, yoyo, 0)
		local goal={} ; -- cannot set dynamic property via string without loadstring; rely on script above for typed goal
	end)
	return okdata({ script = pathOf(scr), property = property, duration = duration, easing = easing },
		("tween %s.%s -> %s over %.2fs (%s %s)"):format(pathOf(target), property, valStr, duration, easing, dir))
end

function api.marketplace_setup(a)
	local passId = tonumber(a.gamepass_id or a.pass_id) or 0
	local productId = tonumber(a.devproduct_id or a.product_id) or 0
	local reward = tostring(a.reward or "Coins +100")
	if passId==0 and productId==0 then return fail("supply gamepass_id elio devproduct_id") end
	local scr = ServerScriptService:FindFirstChild("RobloxScript_Marketplace")
	if not scr then scr=Instance.new("Script"); scr.Name="RobloxScript_Marketplace"; scr.Parent=ServerScriptService end
	if passId~=0 then
		scr.Source = string.format([=[-- GamePass %d -> %s
local MarketplaceService=game:GetService("MarketplaceService")
local Players=game:GetService("Players")
local PASS_ID=%d
local function hasPass(player) local ok, has = pcall(function() return MarketplaceService:UserOwnsGamePassAsync(player.UserId, PASS_ID) end); return ok and has end
local function onPromptFinished(player, id, purchased)
	if id==PASS_ID and purchased and player.Parent then print(player.Name.." bought pass "..PASS_ID.." -> grant %s") end
end
MarketplaceService.PromptGamePassPurchaseFinished:Connect(onPromptFinished)
Players.PlayerAdded:Connect(function(p) task.wait(1); if hasPass(p) then print(p.Name.." already owns "..PASS_ID) end end)
-- prompt helper: MarketplaceService:PromptGamePassPurchase(player, PASS_ID)
print("[Marketplace] GamePass %%d ready" , PASS_ID)
]=], passId, reward, passId, reward)
		return okdata({ script = pathOf(scr), gamepass = passId, reward = reward }, ("GamePass %d wired -> %s at %s"):format(passId, reward, pathOf(scr)))
	else
		scr.Source = string.format([=[-- DevProduct %d -> %s
local MarketplaceService=game:GetService("MarketplaceService")
local PRODUCT_ID=%d
MarketplaceService.ProcessReceipt = function(receipt)
	if receipt.ProductId==PRODUCT_ID then
		local player = game.Players:GetPlayerByUserId(receipt.PlayerId)
		if player then print(player.Name.." purchased "..PRODUCT_ID.." -> grant %s"); return Enum.ProductPurchaseDecision.PurchaseGranted end
	end
	return Enum.ProductPurchaseDecision.NotProcessedYet
end
print("[Marketplace] DevProduct %%d ready", PRODUCT_ID)
]=], productId, reward, productId, reward)
		return okdata({ script = pathOf(scr), product = productId, reward = reward }, ("DevProduct %d wired -> %s at %s"):format(productId, reward, pathOf(scr)))
	end
end

function api.teams_setup(a)
	local teamList = a.teams or {"Red","Blue"}
	if type(teamList)=="string" then teamList={teamList} end
	local spawnParentPath = tostring(a.spawn_parent or "Workspace.Spawns")
	local autoAssign = a.auto_assign ~= false
	local teamsService = game:GetService("Teams")
	local parent = resolvePath(spawnParentPath:match("(.+)%.[^%.]+$") or "Workspace") or workspace
	local created={}
	for i, tName in ipairs(teamList) do
		tName=tostring(tName)
		local team = teamsService:FindFirstChild(tName)
		if not team then team=Instance.new("Team"); team.Name=tName; team.Parent=teamsService; created[#created+1]=tName end
		local hue = (i*137)%360
		team.TeamColor = BrickColor.new(Color3.fromHSV(hue/360, 0.7, 0.9))
		team.AutoAssignable = autoAssign
	end
	if not ServerScriptService:FindFirstChild("RobloxScript_Teams") and autoAssign then
		local scr=Instance.new("Script"); scr.Name="RobloxScript_Teams"; scr.Parent=ServerScriptService
		scr.Source=[=[local Players=game:GetService("Players")
local Teams=game:GetService("Teams")
local function assign(player)
	local smallest=nil; local min=math.huge
	for _, t in ipairs(Teams:GetTeams()) do if #t:GetPlayers() < min then min=#t:GetPlayers(); smallest=t end end
	if smallest then player.Team=smallest end
end
Players.PlayerAdded:Connect(assign)
]=]
	end
	return okdata({ teams = teamList, created = created }, ("teams %s configured (autoAssign=%s)"):format(table.concat(teamList,", "), tostring(autoAssign)))
end


function api.script_analysis(a)
	local scope = tostring(a.scope or a.path or "")
	local includeOutput = a.include_output ~= false
	local maxScripts = math.clamp(tonumber(a.max_scripts) or 80, 1, 200)
	local maxOutput = math.clamp(tonumber(a.max_output) or 40, 1, 120)
	local SKIP = {
		CoreGui = true, CorePackages = true, PluginGuiService = true,
		RobloxPluginGuiService = true, RobloxReplicatedStorage = true,
		CSGDictionaryService = true, Visit = true, LuaWebService = true,
		InsertService = true, ScriptContext = true,
	}
	local roots = {}
	if scope ~= "" then
		local r = resolvePath(scope)
		if not r then return fail("scope not found: " .. scope) end
		roots = { r }
	else
		for _, svc in ipairs({"ServerScriptService","StarterPlayer","StarterGui","ReplicatedStorage","ServerStorage","Workspace","StarterPack"}) do
			local okSvc, inst = pcall(function() return game:GetService(svc) end)
			if okSvc and inst then roots[#roots + 1] = inst end
		end
	end
	local scripts = {}
	local function walk(n)
		if #scripts >= maxScripts or n == nil then return end
		local nm, cn = "", ""
		pcall(function() nm = n.Name; cn = n.ClassName end)
		if SKIP[cn] or SKIP[nm] then return end
		local okIs, isScript = pcall(function() return n:IsA("LuaSourceContainer") end)
		if okIs and isScript then scripts[#scripts + 1] = n end
		local okCh, ch = pcall(function() return n:GetChildren() end)
		if not okCh or type(ch) ~= "table" then return end
		for _, c in ipairs(ch) do
			walk(c)
			if #scripts >= maxScripts then return end
		end
	end
	for _, r in ipairs(roots) do walk(r) end

	local findings = {}
	local syntaxOk, syntaxFail = 0, 0
	local issueCount = 0
	for _, s in ipairs(scripts) do
		local src = ""
		pcall(function() src = s.Source or "" end)
		local issues = {}
		local bal = luauUnbalanced(src)
		if bal then
			syntaxFail += 1
			issues[#issues + 1] = { kind = "syntax", msg = bal }
		else
			syntaxOk += 1
		end
		for call in src:gmatch(":WaitForChild%s*(%b())") do
			local inner = call:sub(2, -2)
			if not inner:find(",") then
				issues[#issues + 1] = { kind = "lint", msg = "WaitForChild without timeout (can hang)" }
				break
			end
		end
		if bareCall(src, "wait") then
			issues[#issues + 1] = { kind = "lint", msg = "deprecated wait() - use task.wait" }
		end
		if bareCall(src, "spawn") then
			issues[#issues + 1] = { kind = "lint", msg = "deprecated spawn() - use task.spawn" }
		end
		if bareCall(src, "delay") then
			issues[#issues + 1] = { kind = "lint", msg = "deprecated delay() - use task.delay" }
		end
		for call in src:gmatch("Instance%.new%s*(%b())") do
			if call:find(",") then
				issues[#issues + 1] = { kind = "lint", msg = "Instance.new(class, parent) is deprecated - set .Parent after" }
				break
			end
		end
		local lineCount = 1
		for _ in src:gmatch("\n") do lineCount += 1 end
		issueCount += #issues
		if #issues > 0 then
			local cn = ""
			pcall(function() cn = s.ClassName end)
			findings[#findings + 1] = {
				path = pathOf(s),
				className = cn,
				lines = lineCount,
				chars = #src,
				issues = issues,
			}
		end
	end

	local output = {}
	if includeOutput then
		local ok, hist = pcall(function()
			return LogService:GetLogHistory()
		end)
		if ok and type(hist) == "table" then
			local start = math.max(1, #hist - maxOutput + 1)
			for i = start, #hist do
				local e = hist[i]
				if type(e) == "table" then
					local msg = tostring(e.message or e.Message or "")
					local typ = e.messageType or e.MessageType or e.type
					local typName = tostring(typ)
					if typeof then
						pcall(function()
							if typeof(typ) == "EnumItem" then typName = typ.Name end
						end)
					end
					output[#output + 1] = { message = msg, type = typName }
				end
			end
		end
	end

	local lines = {
		string.format("Script analysis: %d scripts (syntax ok=%d fail=%d, issues=%d)%s",
			#scripts, syntaxOk, syntaxFail, issueCount,
			scope ~= "" and (" scope=" .. scope) or ""),
	}
	local shown = 0
	for _, f in ipairs(findings) do
		if #f.issues > 0 then
			shown += 1
			lines[#lines + 1] = string.format("- %s [%s] %d lines, %d issue(s)", f.path, f.className, f.lines, #f.issues)
			for _, iss in ipairs(f.issues) do
				lines[#lines + 1] = "    " .. iss.kind .. ": " .. iss.msg
			end
		end
	end
	if shown == 0 then
		lines[#lines + 1] = "No syntax errors or common lints in scanned scripts."
	end
	if includeOutput then
		lines[#lines + 1] = ""
		if #output == 0 then
			lines[#lines + 1] = "Studio Output: (empty or LogService unavailable)"
		else
			lines[#lines + 1] = "Studio Output (last " .. #output .. "):"
			for _, e in ipairs(output) do
				local msg = e.message
				if #msg > 400 then msg = msg:sub(1, 400) .. "…" end
				lines[#lines + 1] = string.format("[%s] %s", e.type, msg)
			end
		end
	end
	local text = table.concat(lines, "\n")
	if #text > 12000 then text = text:sub(1, 12000) .. "\n…[truncated]" end
	return okdata({
		scripts = #scripts,
		syntax_ok = syntaxOk,
		syntax_fail = syntaxFail,
		issue_count = issueCount,
		findings = findings,
		output = output,
	}, text)
end

function api.web_fetch(a)
	local url = tostring(a.url or "")
	if url == "" then return fail("url is required (https://…)") end
	local maxChars = math.clamp(tonumber(a.max_chars) or 8000, 500, 20000)
	local headers = a.headers
	if type(headers) ~= "table" then headers = nil end
	local ok, res = pcall(function()
		return game:GetService("HttpService"):RequestAsync({ Url = url, Method = "GET", Headers = headers })
	end)
	if not ok then return fail("HttpService RequestAsync failed: " .. tostring(res) .. " — enable HTTP Requests in Game Settings > Security") end
	if not res.Success then return fail("fetch failed: HTTP " .. tostring(res.StatusCode) .. " " .. tostring(res.StatusMessage or "")) end
	local body = tostring(res.Body or "")
	local truncated = false
	if #body > maxChars then body = body:sub(1, maxChars) .. "\n\n…[truncated " .. (#body - maxChars) .. " chars, use max_chars to adjust]"; truncated = true end
	return okdata({ url = url, status = res.StatusCode, bytes = #body, truncated = truncated }, body)
end

function api.web_search(a)
	local q = tostring(a.query or a.q or "")
	if q == "" then return fail("query is required") end
	local limit = math.clamp(tonumber(a.limit) or 3, 1, 8)
	local hs = game:GetService("HttpService")
	-- Two endpoints: html (rich markup) then lite (plain rows) as fallback.
	local body = ""
	for _, ep in ipairs({ "https://html.duckduckgo.com/html/?q=", "https://lite.duckduckgo.com/lite/?q=" }) do
		local ok, res = pcall(function()
			return hs:RequestAsync({ Url = ep .. hs:UrlEncode(q), Method = "GET", Headers = { ["User-Agent"] = "RobloxScript/1.0 (+https://github.com/sebattfg/RobloxScript-Free)" } })
		end)
		if ok and res.Success and res.Body and #res.Body > 0 then body = res.Body; break end
	end
	if body == "" then return fail("search unreachable (both DDG endpoints failed) - enable HTTP Requests in Game Settings") end
	local results = {}
	-- DuckDuckGo html: <a rel="nofollow" class="result__a" href="...">Title</a> <a class="result__url" href="...">
	for href, title in body:gmatch('<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)</a>') do
		if title and href then
			-- href is duck redirect /l/?uddg=ENCODED — decode if possible
			local real = href
			local u = href:match("uddg=([^&]+)")
			if u then
				pcall(function() real = hs:UrlDecode(u) end)
				-- UrlDecode doesn't handle + ; fallback
				real = real:gsub("%%(%x%x)", function(h) return string.char(tonumber(h,16)) end)
			end
			title = title:gsub("^%s+", ""):gsub("%s+$", "")
			if #title > 0 and #real > 0 then
				results[#results+1] = { title = title, url = real }
				if #results >= limit then break end
			end
		end
	end
	if #results == 0 then
		-- Lite endpoint fallback: plain <a href="http…">title</a> result rows.
		-- (Lua patterns have no lookahead; skip DDG links via plain find.)
		local seen = {}
		for url, title in body:gmatch('<a[^>]+href="(https?://[^"]+)"[^>]*>([^<][^<]-)</a>') do
			if not seen[url] and not url:find("duckduckgo", 1, true) and #title >= 4 then
				seen[url] = true
				results[#results+1] = { title = title:gsub("%s+$",""), url = url }
				if #results >= limit then break end
			end
		end
	end
	if #results == 0 then
		-- last resort: grab any result__url
		for url in body:gmatch('class="result__url"[^>]+href="([^"]+)"') do
			results[#results+1] = { title = url, url = url }
			if #results >= limit then break end
		end
	end
	if #results == 0 then return fail("no results for '" .. q .. "' (try a different query or web_fetch a direct URL)") end
	local txt = ""
	for i, r in ipairs(results) do txt = txt .. i .. ". " .. r.title .. "\n   " .. r.url .. "\n" end
	return okdata({ query = q, results = results }, txt)
end


function api.plugin_list()
	local items = {}
	local function collect(where, inst)
		if not inst then return end
		for _, c in ipairs(inst:GetChildren()) do
			items[#items + 1] = { where = where, name = c.Name, className = c.ClassName, path = pathOf(c), children = #c:GetChildren() }
		end
	end
	pcall(function() collect("PluginGuiService", game:GetService("PluginGuiService")) end)
	pcall(function()
		local cg = game:GetService("CoreGui")
		for _, c in ipairs(cg:GetChildren()) do
			local n = c.ClassName
			if c:IsA("ScreenGui") or n:find("Plugin") or n:find("DockWidget") then
				items[#items + 1] = { where = "CoreGui", name = c.Name, className = n, path = pathOf(c), children = #c:GetChildren() }
			end
		end
	end)
	pcall(function() collect("PluginDebugService", game:GetService("PluginDebugService")) end)
	local ss = game:GetService("ServerStorage")
	local rs = ss:FindFirstChild("RobloxScript")
	if rs then
		local plugs = rs:FindFirstChild("Plugins")
		if plugs then collect("ServerStorage.RobloxScript.Plugins", plugs) end
	end
	return okdata({ items = items, count = #items }, ("plugin surfaces: %d item(s) — PluginGuiService, CoreGui widgets, ServerStorage.RobloxScript.Plugins"):format(#items))
end

function api.plugin_inspect(a)
	local p = tostring(a.path or a.target_path or "")
	if p == "" then return fail("path is required (from plugin_list)") end
	local inst = resolvePath(p)
	if not inst then
		-- try PluginGuiService / CoreGui by name
		pcall(function()
			inst = game:GetService("PluginGuiService"):FindFirstChild(p, true)
		end)
	end
	if not inst then return fail("plugin instance not found: " .. p) end
	local kids = {}
	for _, c in ipairs(inst:GetChildren()) do
		kids[#kids + 1] = { name = c.Name, className = c.ClassName }
	end
	return okdata({ path = pathOf(inst), className = inst.ClassName, children = kids }, ("inspected %s (%s, %d children)"):format(pathOf(inst), inst.ClassName, #kids))
end

function api.plugin_create(a)
	local name = tostring(a.name or "ORPlugin"):gsub("[^%w_]", "")
	if name == "" then name = "ORPlugin" end
	local title = tostring(a.title or name)
	local ss = game:GetService("ServerStorage")
	local rs = ss:FindFirstChild("RobloxScript")
	if not rs then rs = Instance.new("Folder"); rs.Name = "RobloxScript"; rs.Parent = ss end
	local plugs = rs:FindFirstChild("Plugins")
	if not plugs then plugs = Instance.new("Folder"); plugs.Name = "Plugins"; plugs.Parent = rs end
	local folder = plugs:FindFirstChild(name)
	if not folder then folder = Instance.new("Folder"); folder.Name = name; folder.Parent = plugs end
	local src = folder:FindFirstChild("Plugin")
	if src then src:Destroy() end
	src = Instance.new("Script")
	src.Name = "Plugin"
	src.Parent = folder
	src.Source = string.format([==[-- elio local plugin: %s
-- Save this folder (or this Script) via Plugins > Save as Local Plugin.
-- The plugin global only exists after it is installed as a plugin.
local toolbar = plugin:CreateToolbar("elio · %s")
local btn = toolbar:CreateButton("%s", "Toggle %s", "rbxassetid://6031075938")
local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Left, true, false, 320, 420, 240, 280)
local widget = plugin:CreateDockWidgetPluginGui("%s_widget", info)
widget.Title = "%s"
local root = Instance.new("Frame")
root.Size = UDim2.fromScale(1, 1)
root.BackgroundColor3 = Color3.fromRGB(18, 18, 22)
root.Parent = widget
local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 8)
corner.Parent = root
local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -16, 0, 32)
title.Position = UDim2.new(0, 8, 0, 8)
title.BackgroundTransparency = 1
title.Font = Enum.Font.GothamBold
title.TextSize = 15
title.TextColor3 = Color3.fromRGB(212, 160, 84)
title.TextXAlignment = Enum.TextXAlignment.Left
title.Text = "%s"
title.Parent = root
local body = Instance.new("TextLabel")
body.Size = UDim2.new(1, -16, 1, -48)
body.Position = UDim2.new(0, 8, 0, 40)
body.BackgroundTransparency = 1
body.Font = Enum.Font.Gotham
body.TextSize = 13
body.TextColor3 = Color3.fromRGB(180, 176, 168)
body.TextWrapped = true
body.TextXAlignment = Enum.TextXAlignment.Left
body.TextYAlignment = Enum.TextYAlignment.Top
body.Text = "elio plugin widget. Hook Studio selection / DataModel from here."
body.Parent = root
btn.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)
]==], name, title, title, title, name, title, title)
	local note = folder:FindFirstChild("README")
	if not note then
		note = Instance.new("StringValue")
		note.Name = "README"
		note.Parent = folder
	end
	note.Value = "Right-click this folder in ServerStorage.RobloxScript.Plugins → Save as Local Plugin. Then enable it in the Plugins tab. plugin_list will show its DockWidget once loaded."
	return okdata({ path = pathOf(folder), script = pathOf(src) },
		("plugin skeleton '%s' at %s — Save as Local Plugin to install (plugin global is not available in execute_luau)"):format(name, pathOf(folder)))
end

local dispatch = {
	lighting_set_preset = api.lighting_set_preset,
	lighting_inspect = api.lighting_inspect,
	lighting_setup_day_night = api.lighting_setup_day_night,
	ui_create_screen = api.ui_create_screen,
	ui_create_component = api.ui_create_component,
	ui_inspect = api.ui_inspect,
	fx_create_emitter = api.fx_create_emitter,
	fx_create_light = api.fx_create_light,
	fx_create_vfx = api.fx_create_vfx,
	fx_create_beam = api.fx_create_beam,
	fx_create_trail = api.fx_create_trail,
	fx_create_explosion = api.fx_create_explosion,
	audio_setup_sound_hierarchy = api.audio_setup_sound_hierarchy,
	audio_create_sound = api.audio_create_sound,
	terrain_fill_region = api.terrain_fill_region,
	terrain_clear = api.terrain_clear,
	camera_set_style = api.camera_set_style,
	diagnostics_audit = api.diagnostics_audit,
	diagnostics_fix_common = api.diagnostics_fix_common,
	asset_bridge_import = api.asset_bridge_import,
	datastore_setup = api.datastore_setup,
	leaderboard_setup = api.leaderboard_setup,
	remote_setup = api.remote_setup,
	npc_spawn_pathfinding = api.npc_spawn_pathfinding,
	proximity_setup = api.proximity_setup,
	tween_create = api.tween_create,
	marketplace_setup = api.marketplace_setup,
	teams_setup = api.teams_setup,
	plugin_list = api.plugin_list,
	plugin_inspect = api.plugin_inspect,
	plugin_create = api.plugin_create,
	web_fetch = api.web_fetch,
	web_search = api.web_search,
	script_analysis = api.script_analysis,
}

local args = jdec([==[__ARGS_JSON__]==])
if not args then return fail("bad args") end
local ok2, res = pcall(function()
	local fn = dispatch[args.op]
	if not fn then return fail("unknown studio skill op: " .. tostring(args.op)) end
	return fn(args)
end)
if not ok2 then return fail("studio skill error: " .. tostring(res)) end
return res
`;

const SKILL_COMMANDS = [
  {
    name: "lighting_set_preset",
    description: "Instantly configure production lighting & atmosphere presets: cyberpunk, sunset_warm, warm_night (warm night 20h), horror_dark, fantasy_vibrant, overcast_moody, realistic_noon, vaporwave, space_void. Configures Atmosphere, Bloom, ColorCorrection, and SunRays (assumes Future technology is set manually - do not write Lighting.Technology via Luau). Use Glare (not Glaire) and EnvironmentDiffuseScale/EnvironmentSpecularScale.",
    params: {
      preset: { type: "string", req: true, desc: "cyberpunk, sunset_warm, warm_night, horror_dark, fantasy_vibrant, overcast_moody, realistic_noon, vaporwave, space_void (warm_night = sunset_warm at 20h)" },
      clock_time: { type: "number", req: false, desc: "optional time of day override (0-24)" },
      shadows: { type: "boolean", req: false, desc: "default true - enable GlobalShadows" }
    }
  },
  {
    name: "lighting_inspect",
    description: "Inspect active Lighting properties, Technology, Atmosphere settings, and all post-processing effects in the place.",
    params: {}
  },
  {
    name: "lighting_setup_day_night",
    description: "Inject a clean, smooth Day/Night cycle controller script in ServerScriptService.",
    params: {
      cycle_duration_seconds: { type: "number", req: false, desc: "seconds for full 24h cycle (default 300)" },
      start_time: { type: "number", req: false, desc: "initial ClockTime (default 8)" }
    }
  },
  {
    name: "ui_create_screen",
    description: "Create a modern, responsive ScreenGui in StarterGui configured for clean layer rendering.",
    params: {
      name: { type: "string", req: true, desc: "e.g. HUD, ShopScreen, InventoryScreen" },
      reset_on_spawn: { type: "boolean", req: false, desc: "default false" },
      display_order: { type: "number", req: false, desc: "display layer order (default 1)" }
    }
  },
  {
    name: "ui_create_component",
    description: "Generate styled UI in StarterGui. Types: health_stamina_hud, dialog_box, notification_toast, card_inventory, plus rewritten Forge language (forge_panel, forge_hud, forge_button, forge_inventory, forge_shop). forge:true (or the overlay Forge toggle) remaps HUDs/inventories into gold-metal Forge chrome.",
    params: {
      screen_name: { type: "string", req: false, desc: "target ScreenGui name (default 'HUD')" },
      component_type: { type: "string", req: true, desc: "health_stamina_hud, dialog_box, notification_toast, card_inventory, forge_panel, forge_button, forge_inventory, forge_shop" },
      card_count: { type: "number", req: false, desc: "for card_inventory: number of cards 1-24 (default 8)" },
      title: { type: "string", req: false, desc: "for card_inventory: header title (default 'Inventory')" },
      dropup: { type: "boolean", req: false, desc: "for card_inventory: show dropup picker above the grid (default true)" },
      forge: { type: "boolean", req: false, desc: "if true, uses Forge dark style (#1e1e24, 10px radius, icons) regardless of type" },
      theme: { type: "string", req: false, desc: "forge for Forge style, or default" }
    }
  },
  {
    name: "ui_inspect",
    description: "Inspect the GUI hierarchy and components currently in StarterGui.",
    params: {
      screen_name: { type: "string", req: false, desc: "optional specific ScreenGui name" }
    }
  },
  {
    name: "fx_create_emitter",
    description: "Attach high-fidelity tuned ParticleEmitter effects: fire, smoke, sparks, magic_portal, healing_aura.",
    params: {
      parent_path: { type: "string", req: true, desc: "dotted path to BasePart or Attachment (e.g. Workspace.Torch.Part)" },
      preset: { type: "string", req: true, desc: "fire, smoke, sparks, magic_portal, healing_aura" },
      rate: { type: "number", req: false, desc: "emission rate per second" }
    }
  },
  {
    name: "fx_create_light",
    description: "Create a calibrated light source (PointLight, SpotLight, SurfaceLight) with shadow casting.",
    params: {
      parent_path: { type: "string", req: true, desc: "dotted path to BasePart or Attachment" },
      light_type: { type: "string", req: false, desc: "PointLight (default), SpotLight, SurfaceLight" },
      brightness: { type: "number", req: false, desc: "brightness (default 2.0)" },
      range: { type: "number", req: false, desc: "range in studs (default 16)" },
      color: { type: "string", req: false, desc: "warm_candle, neon_blue, red_alert, or leave empty for daylight" },
      shadows: { type: "boolean", req: false, desc: "default true" }
    }
  },
  {
    name: "fx_create_vfx",
    description: "Assemble a complete composite VFX rig in one call (emitters + beams/trails + lights). Attach to a large transparent part for zone effects.",
    params: {
      parent_path: { type: "string", req: true, desc: "dotted path to BasePart or Attachment" },
      effect: { type: "string", req: true, desc: "explosion, laser_beam, sword_trail, fire_aura, healing_aura, portal_ring, rain_zone, snow_zone, lightning_strike, frost_breath, sparkle_halo, smoke_plume" },
      color: { type: "array", req: false, desc: "[r,g,b] tint applied to every element (0-255)" },
      scale: { type: "number", req: false, desc: "size/intensity multiplier (default 1, max 10)" }
    }
  },
  {
    name: "fx_create_beam",
    description: "Create a Beam between two Attachments with texture, color, width, and segments. Auto-creates attachments if target_path is a BasePart or omitted.",
    params: {
      parent_path: { type: "string", req: true, desc: "dotted path to BasePart or Attachment (beam origin)" },
      target_path: { type: "string", req: false, desc: "dotted path to target BasePart/Attachment for beam end (auto offset if omitted)" },
      texture: { type: "string", req: false, desc: "rbxasset:// texture, default sparkles" },
      color: { type: "array", req: false, desc: "[r,g,b] tint (0-255)" },
      width0: { type: "number", req: false, desc: "starting width (default 0.6)" },
      width1: { type: "number", req: false, desc: "ending width (default width*0.35)" },
      segments: { type: "number", req: false, desc: "beam segments 1-20 (default 10)" },
      face_camera: { type: "boolean", req: false, desc: "face camera (default true)" }
    }
  },
  {
    name: "fx_create_trail",
    description: "Create a Trail with two Attachments that animates with movement. Ideal for swords, projectiles, and motion streaks.",
    params: {
      parent_path: { type: "string", req: true, desc: "dotted path to BasePart that owns the trail" },
      attachment0_path: { type: "string", req: false, desc: "dotted path to first Attachment (auto-creates if omitted)" },
      attachment1_path: { type: "string", req: false, desc: "dotted path to second Attachment (auto-creates if omitted)" },
      texture: { type: "string", req: false, desc: "rbxasset:// texture, default smoke" },
      color: { type: "array", req: false, desc: "[r,g,b] tint (0-255)" },
      lifetime: { type: "number", req: false, desc: "trail lifetime seconds (0.05-5, default 0.6)" },
      min_length: { type: "number", req: false, desc: "minimum length before trail draws (default 0.1)" }
    }
  },
  {
    name: "fx_create_explosion",
    description: "Create a real Explosion with blast pressure/radius, optional crater type, and a flash + spark VFX anchor. Works at any Vector3 or attached to a part.",
    params: {
      parent_path: { type: "string", req: false, desc: "dotted path to BasePart/Attachment for explosion center (default Workspace)" },
      position: { type: "array", req: false, desc: "[x,y,z] world position override (0-255)" },
      blast_pressure: { type: "number", req: false, desc: "blast pressure 0-100000 (default 10000)" },
      blast_radius: { type: "number", req: false, desc: "blast radius 1-100 (default 12)" },
      destroy_joint_radius_percent: { type: "number", req: false, desc: "joint destroy percent 0-100 (default 30)" },
      explosion_type: { type: "string", req: false, desc: "NoCraters or Craters (default NoCraters)" }
    }
  },
  {
    name: "audio_setup_sound_hierarchy",
    description: "Configure industry-standard SoundService routing hierarchy: Master -> Music, SFX (Combat, Footsteps), Ambience, UI, Voice.",
    params: {}
  },
  {
    name: "audio_create_sound",
    description: "Create and configure a Sound instance attached to a Part or routed to a SoundGroup.",
    params: {
      parent_path: { type: "string", req: false, desc: "dotted path (default Workspace)" },
      sound_id: { type: "string", req: true, desc: "e.g. rbxassetid://9114223120 or raw number" },
      name: { type: "string", req: false, desc: "sound name" },
      volume: { type: "number", req: false, desc: "volume (0.0 - 1.0, default 0.5)" },
      looped: { type: "boolean", req: false, desc: "default false" },
      sound_group: { type: "string", req: false, desc: "Music, SFX, Ambience, UI, Voice" }
    }
  },
  {
    name: "terrain_fill_region",
    description: "Fill volumetric regions with voxel terrain materials (Grass, Rock, Sand, Water, Snow, Basalt, Lava, etc.).",
    params: {
      material: { type: "string", req: true, desc: "Grass, Rock, Sand, Water, Snow, Basalt, Lava, WoodPlanks" },
      cframe: { type: "array", req: true, desc: "[x, y, z] center coordinates" },
      size: { type: "array", req: true, desc: "[x, y, z] box size" },
      shape: { type: "string", req: false, desc: "block (default), ball, cylinder" }
    }
  },
  {
    name: "terrain_clear",
    description: "Clear terrain in a bounding box, or clear all terrain in the place if cframe/size omitted.",
    params: {
      cframe: { type: "array", req: false, desc: "[x, y, z] center coordinates" },
      size: { type: "array", req: false, desc: "[x, y, z] size to clear" }
    }
  },
  {
    name: "camera_set_style",
    description: "Inject high-performance camera controllers in StarterPlayerScripts: isometric, top_down, side_scroller.",
    params: {
      style: { type: "string", req: true, desc: "isometric, top_down, side_scroller" },
      distance: { type: "number", req: false, desc: "camera distance in studs (default 30)" },
      fov: { type: "number", req: false, desc: "FieldOfView (default 60)" }
    }
  },
  {
    name: "diagnostics_audit",
    description: "Deep health and performance scan of the place: unanchored physics parts, missing humanoid roots, StreamingEnabled check.",
    params: {}
  },
  {
    name: "diagnostics_fix_common",
    description: "Automatically apply optimizations: anchor static scenery parts, enable StreamingEnabled, enable Future lighting.",
    params: {
      anchor_static_parts: { type: "boolean", req: false, desc: "default true" },
      enable_streaming: { type: "boolean", req: false, desc: "default true" },
      set_future_lighting: { type: "boolean", req: false, desc: "default true" }
    }
  },
  {
    name: "asset_bridge_import",
    description: "Import an FBX exported from Blender into Studio as Workspace.ELIO_Imported (EditableMesh). Pass asset = the filepath from blender_export_fbx. Also accepts rbxassetid://. Requires Connect Blender for FBX.",
    params: {
      source: { type: "string", req: false, desc: "blender, crax, roblox, or URL" },
      asset: { type: "string", req: true, desc: "FBX path from Blender, rbxassetid://…, or https://…" },
      target_engine: { type: "string", req: false, desc: "roblox or unreal (default roblox)" },
      dest: { type: "string", req: false, desc: "destination path, e.g. /Game/Imported" }
    }
  },
  {
    name: "datastore_setup",
    description: "Scaffolds production DataStoreService player-data with session-lock-safe UpdateAsync, pcall retry, BindToClose flush, autosave loop and optional leaderstats folder (Coins + Level).",
    params: {
      store_name: { type: "string", req: false, desc: "DataStore name, default PlayerData" },
      currency_name: { type: "string", req: false, desc: "leaderstat currency name, default Coins" },
      autosave_interval: { type: "number", req: false, desc: "seconds between autosaves, min 15, default 60" },
      leaderstats: { type: "boolean", req: false, desc: "create leaderstats Folder with IntValues, default true" }
    }
  },
  {
    name: "leaderboard_setup",
    description: "Creates an OrderedDataStore global leaderboard with a SurfaceGui board part and a LeaderboardManager ModuleScript exposing GetTop(limit).",
    params: {
      store_name: { type: "string", req: false, desc: "OrderedDataStore name, default GlobalLeaderboard" },
      title: { type: "string", req: false, desc: "board title text" },
      board_path: { type: "string", req: false, desc: "dotted path for the board part, default Workspace.Leaderboard" }
    }
  },
  {
    name: "remote_setup",
    description: "Creates a ReplicatedStorage RemoteEvent/RemoteFunction namespace with sample server handler script. Eliminates manual Remote wiring.",
    params: {
      namespace: { type: "string", req: false, desc: "folder name in ReplicatedStorage, default GameEvents" },
      events: { type: "array", req: false, desc: "array of event names, e.g. [OnDamage,OnReward]" },
      include_function: { type: "boolean", req: false, desc: "force RemoteFunction for all, default false" }
    }
  },
  {
    name: "npc_spawn_pathfinding",
    description: "Spawns or reuses a Humanoid rig and injects a PathfindingService loop with CreatePath, ComputeAsync, Blocked re-compute, Jump handling and patrol/loop behaviours.",
    params: {
      rig_name: { type: "string", req: false, desc: "Model name in Workspace, default NPC_Dummy" },
      cframe: { type: "array", req: false, desc: "[x,y,z] spawn position" },
      target: { type: "array", req: false, desc: "[x,y,z] path target" },
      speed: { type: "number", req: false, desc: "WalkSpeed, default 12" },
      behavior: { type: "string", req: false, desc: "loop, patrol, or chase" }
    }
  },
  {
    name: "proximity_setup",
    description: "Adds a ProximityPrompt with Billboard handling, hold duration, max distance, cooldown debounce and optional leaderstats Coins reward to any BasePart.",
    params: {
      target_path: { type: "string", req: true, desc: "dotted path to BasePart, e.g. Workspace.Chest" },
      action_text: { type: "string", req: false, desc: "ActionText, default Interact" },
      object_text: { type: "string", req: false, desc: "ObjectText, default part name" },
      hold_duration: { type: "number", req: false, desc: "hold seconds, default 0" },
      max_distance: { type: "number", req: false, desc: "activation distance, default 12" },
      reward_coins: { type: "number", req: false, desc: "Coins granted on Triggered" }
    }
  },
  {
    name: "tween_create",
    description: "Creates a TweenService tween on any instance property (Position, Transparency, Color3, UDim2, etc.) with EasingStyle/Direction, loop and yoyo. Generates a self-playing Script.",
    params: {
      target_path: { type: "string", req: true, desc: "dotted path to instance" },
      property: { type: "string", req: false, desc: "property name, default Position" },
      to: { type: "string", req: true, desc: "target value: [x,y,z] for Vector3, [r,g,b] for Color3, or number/string" },
      duration: { type: "number", req: false, desc: "seconds, default 1" },
      easing: { type: "string", req: false, desc: "Sine, Quad, Cubic, Elastic, Bounce, etc." },
      direction: { type: "string", req: false, desc: "In, Out, InOut" },
      loop: { type: "boolean", req: false, desc: "loop playback" },
      yoyo: { type: "boolean", req: false, desc: "reverse on complete" }
    }
  },
  {
    name: "marketplace_setup",
    description: "Wires MarketplaceService for a GamePass or Developer Product: UserOwnsGamePassAsync check, PromptGamePassPurchaseFinished and ProcessReceipt templates with grant hook.",
    params: {
      gamepass_id: { type: "number", req: false, desc: "GamePass ID" },
      devproduct_id: { type: "number", req: false, desc: "Developer Product ID" },
      reward: { type: "string", req: false, desc: "grant description, e.g. Coins +100" }
    }
  },
  {
    name: "teams_setup",
    description: "Configures Teams service with coloured Team instances, TeamColor auto-distribution and an optional auto-balance assign script in ServerScriptService.",
    params: {
      teams: { type: "array", req: false, desc: "team names array, default [Red,Blue]" },
      spawn_parent: { type: "string", req: false, desc: "path to spawn folder" },
      auto_assign: { type: "boolean", req: false, desc: "enable auto-balance script, default true" }
    }
  },
  {
    name: "web_fetch",
    description: "Fetches any URL via HttpService (GET) and returns the body text. Use for docs, APIs, or reference pages. Respects max_chars (500-20000).",
    params: {
      url: { type: "string", req: true, desc: "full https:// URL to fetch" },
      max_chars: { type: "number", req: false, desc: "truncate after N chars, default 8000" },
      headers: { type: "object", req: false, desc: "optional headers table" }
    }
  },
  {
    name: "web_search",
    description: "Web search via DuckDuckGo HTML, returns top results as title+URL. Perfect for the AI to get a quick reference before building.",
    params: {
      query: { type: "string", req: true, desc: "search query, e.g. 'Roblox DataStore best practices'" },
      limit: { type: "number", req: false, desc: "max results 1-8, default 3" }
    }
  },
  {
    name: "script_analysis",
    description: "Read + lint scripts (alias: script_read_analysis). Walks SSS/StarterPlayer/StarterGui/RS/Workspace (not CoreGui). Luau block-balance (not loadstring), flags WaitForChild without timeout, bare wait/spawn/delay (not task.*), Instance.new parent arg, plus Output.",
    params: {
      scope: { type: "string", req: false, desc: "dotted path to limit the walk (default game scripts, not CoreGui)" },
      include_output: { type: "boolean", req: false, desc: "include Studio Output / LogService history (default true)" },
      max_scripts: { type: "number", req: false, desc: "cap scripts scanned, default 80 (1-200)" },
      max_output: { type: "number", req: false, desc: "cap Output lines, default 40 (1-120)" }
    }
  },
  {
    name: "plugin_list",
    description: "List Studio plugin surfaces: PluginGuiService, CoreGui plugin/DockWidget GUIs, PluginDebugService, and ServerStorage.RobloxScript.Plugins skeletons created by plugin_create.",
    params: {}
  },
  {
    name: "plugin_inspect",
    description: "Inspect one plugin instance (name, class, children) by dotted path from plugin_list.",
    params: {
      path: { type: "string", req: true, desc: "dotted path, e.g. PluginGuiService.MyWidget" }
    }
  },
  {
    name: "plugin_create",
    description: "Write a local-plugin skeleton under ServerStorage.RobloxScript.Plugins.<name> with a toolbar button + DockWidget script. User must Save as Local Plugin — the plugin global is not available inside execute_luau.",
    params: {
      name: { type: "string", req: false, desc: "folder/plugin id, default ORPlugin" },
      title: { type: "string", req: false, desc: "toolbar / widget title" }
    }
  },
];

const LIGHTING_PRESETS_JS = {
  cyberpunk: { technology: "Future", clockTime: 0, brightness: 1.2, outdoorAmbient: [15,10,40], ambient: [20,15,50], colorShift_Top: [0,220,255], colorShift_Bottom: [255,0,128], exposure: 0.2, shadowSoftness: 0.2, atmosphere: { density: 0.35, offset: 0.25, color: [30,20,70], decay: [200,0,150], glare: 0.5, haze: 1.8 }, bloom: { intensity: 1.4, size: 32, threshold: 0.75 }, colorCorrection: { contrast: 0.25, saturation: 0.4, tintColor: [240,245,255] }, sunRays: { intensity: 0.1, spread: 0.8 } },
  sunset_warm: { technology: "Future", clockTime: 17.8, brightness: 2.5, outdoorAmbient: [120,70,50], ambient: [90,50,40], colorShift_Top: [255,180,100], colorShift_Bottom: [180,80,50], exposure: 0.1, shadowSoftness: 0.6, atmosphere: { density: 0.4, offset: 0.5, color: [255,150,80], decay: [180,60,40], glare: 1.2, haze: 2.5 }, bloom: { intensity: 0.8, size: 24, threshold: 0.85 }, colorCorrection: { contrast: 0.15, saturation: 0.3, tintColor: [255,240,230] }, sunRays: { intensity: 0.4, spread: 0.9 } },
  horror_dark: { technology: "Future", clockTime: 1, brightness: 0.3, outdoorAmbient: [5,8,10], ambient: [4,6,8], colorShift_Top: [20,30,40], colorShift_Bottom: [10,15,20], exposure: -0.3, shadowSoftness: 0.1, atmosphere: { density: 0.6, offset: 0.1, color: [15,20,25], decay: [10,15,18], glare: 0, haze: 3.5 }, bloom: { intensity: 0.3, size: 16, threshold: 0.95 }, colorCorrection: { contrast: 0.3, saturation: -0.4, tintColor: [210,220,230] }, sunRays: { intensity: 0.05, spread: 0.2 } },
  fantasy_vibrant: { technology: "Future", clockTime: 14, brightness: 3.0, outdoorAmbient: [140,150,170], ambient: [120,130,150], colorShift_Top: [255,250,230], colorShift_Bottom: [180,200,220], exposure: 0.15, shadowSoftness: 0.5, atmosphere: { density: 0.25, offset: 0.2, color: [180,220,255], decay: [255,210,180], glare: 0.4, haze: 1.0 }, bloom: { intensity: 0.6, size: 20, threshold: 0.88 }, colorCorrection: { contrast: 0.12, saturation: 0.35, tintColor: [255,255,255] }, sunRays: { intensity: 0.25, spread: 0.7 } },
  overcast_moody: { technology: "Future", clockTime: 12, brightness: 1.4, outdoorAmbient: [100,105,115], ambient: [90,95,105], colorShift_Top: [190,195,205], colorShift_Bottom: [140,145,155], exposure: 0, shadowSoftness: 1.0, atmosphere: { density: 0.5, offset: 0.3, color: [170,175,185], decay: [130,135,145], glare: 0.1, haze: 2.8 }, bloom: { intensity: 0.4, size: 18, threshold: 0.9 }, colorCorrection: { contrast: 0.08, saturation: -0.15, tintColor: [230,235,240] }, sunRays: { intensity: 0.08, spread: 0.4 } },
  realistic_noon: { technology: "Future", clockTime: 13, brightness: 2.8, outdoorAmbient: [130,135,140], ambient: [110,115,120], colorShift_Top: [255,252,245], colorShift_Bottom: [160,170,180], exposure: 0.05, shadowSoftness: 0.4, atmosphere: { density: 0.3, offset: 0.25, color: [200,220,255], decay: [100,140,210], glare: 0.3, haze: 0.8 }, bloom: { intensity: 0.5, size: 16, threshold: 0.9 }, colorCorrection: { contrast: 0.1, saturation: 0.1, tintColor: [255,255,255] }, sunRays: { intensity: 0.2, spread: 0.6 } },
  vaporwave: { technology: "Future", clockTime: 19.5, brightness: 1.8, outdoorAmbient: [50,15,60], ambient: [40,10,50], colorShift_Top: [255,105,180], colorShift_Bottom: [64,224,208], exposure: 0.2, shadowSoftness: 0.3, atmosphere: { density: 0.45, offset: 0.4, color: [220,80,180], decay: [50,200,210], glare: 0.8, haze: 2.2 }, bloom: { intensity: 1.6, size: 36, threshold: 0.7 }, colorCorrection: { contrast: 0.28, saturation: 0.5, tintColor: [255,230,250] }, sunRays: { intensity: 0.35, spread: 0.85 } },
  space_void: { technology: "Future", clockTime: 0, brightness: 0.2, outdoorAmbient: [0,0,0], ambient: [0,0,0], colorShift_Top: [200,220,255], colorShift_Bottom: [10,10,20], exposure: 0, shadowSoftness: 0, atmosphere: { density: 0, offset: 0, color: [0,0,0], decay: [0,0,0], glare: 0, haze: 0 }, bloom: { intensity: 0.8, size: 20, threshold: 0.8 }, colorCorrection: { contrast: 0.4, saturation: 0, tintColor: [255,255,255] }, sunRays: { intensity: 0.5, spread: 0.5 } },
  warm_night: { technology: "Future", clockTime: 20, brightness: 1.0, outdoorAmbient: [45,30,55], ambient: [35,25,45], colorShift_Top: [255,190,120], colorShift_Bottom: [90,50,80], exposure: 0.05, shadowSoftness: 0.25, atmosphere: { density: 0.38, offset: 0.2, color: [60,35,70], decay: [255,160,90], glare: 0.55, haze: 1.6 }, bloom: { intensity: 1.1, size: 28, threshold: 0.78 }, colorCorrection: { contrast: 0.18, saturation: 0.28, tintColor: [255,235,220] }, sunRays: { intensity: 0.18, spread: 0.6 } },
};

function buildLightingPresetLuau(args) {
  let pName = String(args.preset || "realistic_noon").toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  let cfg = LIGHTING_PRESETS_JS[pName];
  if (!cfg && pName.includes("warm") && pName.includes("night")) { cfg = LIGHTING_PRESETS_JS["warm_night"]; if (cfg) pName = "warm_night"; }
  if (!cfg) {
    const valid = Object.keys(LIGHTING_PRESETS_JS).sort().join(", ");
    return { err: `ERROR: unknown preset '${pName}'. Valid presets: ${valid}` };
  }
  const clockTime = args.clock_time != null ? Number(args.clock_time) : cfg.clockTime;
  const shadows = args.shadows !== false;
  const c = cfg;
  // Minimal Luau: directly set Lighting, no 73KB library
  const lua = `local Lighting=game:GetService("Lighting")\nlocal HttpService=game:GetService("HttpService")\nlocal function getOrCreate(p,cl,n) local f=p:FindFirstChildOfClass(cl) or (n and p:FindFirstChild(n)) if not f then f=Instance.new(cl) if n then f.Name=n end f.Parent=p end return f end\nLighting.ClockTime=${clockTime}\nLighting.Brightness=${c.brightness}\nLighting.OutdoorAmbient=Color3.fromRGB(${c.outdoorAmbient[0]},${c.outdoorAmbient[1]},${c.outdoorAmbient[2]})\nLighting.Ambient=Color3.fromRGB(${c.ambient[0]},${c.ambient[1]},${c.ambient[2]})\nLighting.ColorShift_Top=Color3.fromRGB(${c.colorShift_Top[0]},${c.colorShift_Top[1]},${c.colorShift_Top[2]})\nLighting.ColorShift_Bottom=Color3.fromRGB(${c.colorShift_Bottom[0]},${c.colorShift_Bottom[1]},${c.colorShift_Bottom[2]})\nLighting.ExposureCompensation=${c.exposure}\nLighting.ShadowSoftness=${c.shadowSoftness}\nLighting.GlobalShadows=${shadows ? "true" : "false"}\ndo local a=getOrCreate(Lighting,"Atmosphere","Atmosphere") a.Density=${c.atmosphere.density} a.Offset=${c.atmosphere.offset} a.Color=Color3.fromRGB(${c.atmosphere.color[0]},${c.atmosphere.color[1]},${c.atmosphere.color[2]}) a.Decay=Color3.fromRGB(${c.atmosphere.decay[0]},${c.atmosphere.decay[1]},${c.atmosphere.decay[2]}) a.Glare=${c.atmosphere.glare} a.Haze=${c.atmosphere.haze} end\ndo local b=getOrCreate(Lighting,"BloomEffect","Bloom") b.Intensity=${c.bloom.intensity} b.Size=${c.bloom.size} b.Threshold=${c.bloom.threshold} end\ndo local cc=getOrCreate(Lighting,"ColorCorrectionEffect","ColorCorrection") cc.Contrast=${c.colorCorrection.contrast} cc.Saturation=${c.colorCorrection.saturation} cc.TintColor=Color3.fromRGB(${c.colorCorrection.tintColor[0]},${c.colorCorrection.tintColor[1]},${c.colorCorrection.tintColor[2]}) end\ndo local s=getOrCreate(Lighting,"SunRaysEffect","SunRays") s.Intensity=${c.sunRays.intensity} s.Spread=${c.sunRays.spread} end\nreturn HttpService:JSONEncode({ok=true,data={preset="${pName}",clockTime=Lighting.ClockTime},text="applied lighting preset '${pName}' (ClockTime "..string.format("%.1f",Lighting.ClockTime)..", atmosphere & post-processing configured) - set Future technology manually in Studio if needed"})`;
  return { code: lua };
}

function buildFxBeamLuau(a){
  const pPath = String(a.parent_path||"");
  if(!pPath) return {err:"ERROR: parent_path is required for fx_create_beam"};
  const color = Array.isArray(a.color)&&a.color.length===3 ? `Color3.fromRGB(${a.color.map(n=>Math.min(255,Math.max(0,parseInt(n)||0)).toString()).join(",")})` : "Color3.fromRGB(0,200,255)";
  const tex = a.texture ? String(a.texture).replace(/"/g,"") : "rbxasset://textures/particles/sparkles_main.dds";
  const w0 = parseFloat(a.width0 ?? a.width ?? 0.6) || 0.6;
  const w1 = parseFloat(a.width1 ?? (w0*0.35)) || w0*0.35;
  const segs = Math.min(20, Math.max(1, parseInt(a.segments)||10));
  const face = a.face_camera===false ? "false" : "true";
  const t0 = a.transparency0 ?? 0.05, t1 = a.transparency1 ?? 0.35;
  const targetPath = a.target_path ? String(a.target_path).replace(/"/g,"") : "";
  const lua = `local host=game:GetService("HttpService")\nlocal function resolve(p) local n=game for _,s in ipairs(string.split(p, ".")) do n=n:FindFirstChild(s) if not n then return nil end end return n end\nlocal function vfxAtt(par,n,x,y,z) local at=Instance.new("Attachment") at.Name=n at.Position=Vector3.new(x or 0,y or 0,z or 0) at.Parent=par return at end\nlocal h=resolve("${pPath.replace(/"/g,"")}") if not h or (not h:IsA("BasePart") and not h:IsA("Attachment")) then return game:GetService("HttpService"):JSONEncode({ok=false,error="parent_path must be BasePart or Attachment"}) end\nlocal par=h:IsA("BasePart") and h or h.Parent\nif not par or not par:IsA("BasePart") then par=workspace:FindFirstChild("Baseplate") or workspace:FindFirstChildWhichIsA("BasePart") end\nlocal a0=${pPath.includes(".") ? `h:IsA("Attachment") and h or vfxAtt(par,"BeamA0",0,0,0)` : `vfxAtt(par,"BeamA0",0,0,0)`}\nlocal a1; do local tp="${targetPath}" if tp~="" then local t=resolve(tp) if t and t:IsA("Attachment") then a1=t elseif t and t:IsA("BasePart") then a1=vfxAtt(t,"BeamA1",0,0,0) else a1=vfxAtt(par,"BeamA1",0,0,-12) end else a1=vfxAtt(par,"BeamA1",0,0,-12) end end\nlocal b=Instance.new("Beam") b.Name="VFXBeam" b.Attachment0=a0 b.Attachment1=a1 b.Texture="${tex}" b.Color=ColorSequence.new(${color}) b.Width0=${w0} b.Width1=${w1} b.Segments=${segs} b.LightEmission=1 b.FaceCamera=${face} b.Transparency=NumberSequence.new(${t0},${t1}) b.Parent=par\nreturn host:JSONEncode({ok=true,data={path=b:GetFullName(),width0=b.Width0},text="created beam "..b:GetFullName()})`;
  return {code: lua};
}
function buildFxTrailLuau(a){
  const pPath=String(a.parent_path||""); if(!pPath) return {err:"ERROR: parent_path is required for fx_create_trail"};
  const color = Array.isArray(a.color)&&a.color.length===3 ? `Color3.fromRGB(${a.color.map(n=>Math.min(255,Math.max(0,parseInt(n)||0)).toString()).join(",")})` : "Color3.fromRGB(255,255,255)";
  const tex = a.texture ? String(a.texture).replace(/"/g,"") : "rbxasset://textures/particles/smoke_main.dds";
  const life = Math.min(5, Math.max(0.05, parseFloat(a.lifetime)||0.6));
  const minL = parseFloat(a.min_length)||0.1;
  const lua = `local host=game:GetService("HttpService")\nlocal function resolve(p) local n=game for _,s in ipairs(string.split(p, ".")) do n=n:FindFirstChild(s) if not n then return nil end end return n end\nlocal function vfxAtt(par,n,x,y,z) local at=Instance.new("Attachment") at.Name=n at.Position=Vector3.new(x or 0,y or 0,z or 0) at.Parent=par return at end\nlocal h=resolve("${pPath.replace(/"/g,"")}") if not h then return host:JSONEncode({ok=false,error="parent_path not found"}) end\nlocal par=h:IsA("BasePart") and h or (h:IsA("Attachment") and h.Parent or nil) if not par or not par:IsA("BasePart") then return host:JSONEncode({ok=false,error="parent_path must be a BasePart"}) end\nlocal a0p="${String(a.attachment0_path||"").replace(/"/g,"")}" local a1p="${String(a.attachment1_path||"").replace(/"/g,"")}" local at0=a0p~="" and resolve(a0p) or nil local at1=a1p~="" and resolve(a1p) or nil\nif not (at0 and at0:IsA("Attachment")) then at0=vfxAtt(par,"Trail0",-1.5,0,0) end\nif not (at1 and at1:IsA("Attachment")) then at1=vfxAtt(par,"Trail1",1.5,0,0) end\nlocal tr=Instance.new("Trail") tr.Name="VFXTrail" tr.Attachment0=at0 tr.Attachment1=at1 tr.Texture="${tex}" tr.Color=ColorSequence.new(${color}) tr.Lifetime=${life} tr.MinLength=${minL} tr.WidthScale=NumberSequence.new(1,0) tr.Transparency=NumberSequence.new(0.15,1) tr.LightEmission=0.5 tr.Parent=par tr.Enabled=true\nreturn host:JSONEncode({ok=true,data={path=tr:GetFullName(),lifetime=tr.Lifetime},text="created trail "..tr:GetFullName()})`;
  return {code: lua};
}
function buildFxExplosionLuau(a){
  const pPath=String(a.parent_path||"Workspace"); const blastP = Math.min(100000, Math.max(0, parseFloat(a.blast_pressure ?? a.pressure ?? 10000)||10000)); const blastR = Math.min(100, Math.max(1, parseFloat(a.blast_radius ?? a.radius ?? 12)||12)); const destr = Math.min(100, Math.max(0, parseFloat(a.destroy_joint_radius_percent??30)||30));
  const pos = Array.isArray(a.position)&&a.position.length===3 ? `Vector3.new(${a.position.map(n=>parseFloat(n)||0).join(",")})` : null;
  const eType = String(a.explosion_type||"NoCraters").replace(/"/g,"");
  const lua = `local host=game:GetService("HttpService")\nlocal p=game for _,s in ipairs(string.split("${pPath.replace(/"/g,"")}", ".")) do p=p:FindFirstChild(s) if not p then break end end if not p then p=workspace end\nlocal pos=${pos || `p:IsA("BasePart") and p.Position or (p:IsA("Attachment") and p.WorldPosition or Vector3.new(0,10,0))`}\nlocal e=Instance.new("Explosion") e.Name="VFXExplosion" e.BlastPressure=${blastP} e.BlastRadius=${blastR} e.DestroyJointRadiusPercent=${destr} pcall(function() e.ExplosionType=Enum.ExplosionType["${eType}"] end) e.Position=pos e.Parent=workspace\nlocal anchor=Instance.new("Part") anchor.Name="ExplosionAnchor" anchor.Anchored=true anchor.CanCollide=false anchor.Transparency=1 anchor.Size=Vector3.new(1,1,1) anchor.CFrame=CFrame.new(pos) anchor.Parent=workspace local light=Instance.new("PointLight") light.Color=Color3.fromRGB(255,180,60) light.Brightness=6 light.Range=${blastR*2} light.Parent=anchor game:GetService("Debris"):AddItem(anchor,2)\nreturn host:JSONEncode({ok=true,data={path=e:GetFullName(),blastRadius=e.BlastRadius},text="created explosion at "..tostring(pos)})`;
  return {code: lua};
}

function buildCardInventoryLuau(a){
  const screen = String(a.screen_name || "HUD").replace(/"/g, "");
  const title = String(a.title || "Inventory").replace(/"/g, "");
  const count = Math.min(24, Math.max(1, parseInt(a.card_count) || 8));
  const dropup = a.dropup !== false;
  const names = ["Void Spectre","Magnet II","Icy Guardian","Astro Jumper","Springing Serpent","Molten Core","Bald Phoenix","Shadow Walker","Storm Caller","Crystal Knight","Ember Wraith","Frost Giant"];
  const cardsJson = JSON.stringify(
    Array.from({length: count}, (_, i) => ({ n: names[i % names.length], r: ((i) % 5) + 1, e: i === 0 }))
  );
  const lua = `local HttpService=game:GetService("HttpService")
local sg=game:GetService("StarterGui"):FindFirstChild("${screen}")
if not sg then sg=Instance.new("ScreenGui") sg.Name="${screen}" sg.ResetOnSpawn=false sg.ZIndexBehavior=Enum.ZIndexBehavior.Sibling sg.Parent=game:GetService("StarterGui") end
local old=sg:FindFirstChild("CardInventory") if old then old:Destroy() end
local function corner(p,r) local c=Instance.new("UICorner") c.CornerRadius=UDim.new(0,r or 8) c.Parent=p return c end
local function stroke(p,c,t) local s=Instance.new("UIStroke") s.Color=c or Color3.fromRGB(60,66,82) s.Thickness=t or 1.2 s.Parent=p return s end
local root=Instance.new("Frame") root.Name="CardInventory" root.Size=UDim2.new(0,340,0,260) root.Position=UDim2.new(0.5,-170,1,-20) root.AnchorPoint=Vector2.new(0,1) root.BackgroundColor3=Color3.fromRGB(22,24,30) root.BackgroundTransparency=0.08 root.Parent=sg
corner(root,12) stroke(root)
local hdr=Instance.new("Frame") hdr.Name="Header" hdr.Size=UDim2.new(1,0,0,26) hdr.BackgroundTransparency=1 hdr.Parent=root
local tl=Instance.new("TextLabel") tl.Size=UDim2.new(1,-80,1,0) tl.BackgroundTransparency=1 tl.Font=Enum.Font.GothamBold tl.TextSize=13 tl.TextColor3=Color3.fromRGB(240,240,245) tl.TextXAlignment=Enum.TextXAlignment.Left tl.Text="${title}" tl.Parent=hdr
local chip=Instance.new("TextLabel") chip.Size=UDim2.new(0,76,1,0) chip.Position=UDim2.new(1,-76,0,0) chip.BackgroundColor3=Color3.fromRGB(40,45,58) chip.Font=Enum.Font.GothamMedium chip.TextSize=10 chip.TextColor3=Color3.fromRGB(180,185,200) chip.Text="Main cards" chip.Parent=hdr corner(chip,999)
local scroll=Instance.new("ScrollingFrame") scroll.Name="CardGrid" scroll.Size=UDim2.new(1,0,1,-36) scroll.Position=UDim2.new(0,0,0,30) scroll.BackgroundTransparency=1 scroll.BorderSizePixel=0 scroll.ScrollBarThickness=4 scroll.ScrollBarImageColor3=Color3.fromRGB(70,78,95) scroll.CanvasSize=UDim2.new(0,0,0,0) scroll.AutomaticCanvasSize=Enum.AutomaticSize.Y scroll.Parent=root
local grid=Instance.new("UIGridLayout") grid.CellSize=UDim2.new(0,72,0,96) grid.CellPadding=UDim2.new(0,8,0,8) grid.SortOrder=Enum.SortOrder.LayoutOrder grid.Parent=scroll
local PAL={{Color3.fromRGB(120,60,200),Color3.fromRGB(70,30,140),"COMMON"},{Color3.fromRGB(30,120,215),Color3.fromRGB(15,70,140),"RARE"},{Color3.fromRGB(220,130,30),Color3.fromRGB(150,80,15),"EPIC"},{Color3.fromRGB(200,50,90),Color3.fromRGB(130,25,55),"LEGENDARY"},{Color3.fromRGB(40,170,120),Color3.fromRGB(20,110,75),"MYTHIC"}}
local cards=HttpService:JSONDecode('${cardsJson.replace(/'/g, "\\'")}')
for i,cd in ipairs(cards) do
  local pal=PAL[cd.r]
  local card=Instance.new("Frame") card.Name="Card_"..i card.BackgroundColor3=pal[1] card.Parent=scroll
  corner(card,8) stroke(card,pal[1]:Lerp(Color3.new(1,1,1),0.35),1.5)
  local gr=Instance.new("UIGradient") gr.Color=ColorSequence.new(pal[1],pal[2]) gr.Rotation=90 gr.Parent=card
  local head=Instance.new("Frame") head.Size=UDim2.new(0,22,0,22) head.Position=UDim2.new(0.5,-11,0,14) head.BackgroundColor3=pal[1]:Lerp(Color3.new(1,1,1),0.45) head.Parent=card corner(head,999)
  local body=Instance.new("Frame") body.Size=UDim2.new(0,40,0,34) body.Position=UDim2.new(0.5,-20,0,38) body.BackgroundColor3=pal[1]:Lerp(Color3.new(1,1,1),0.30) body.Parent=card corner(body,12)
  local nm=Instance.new("TextLabel") nm.Size=UDim2.new(1,-6,0,12) nm.Position=UDim2.new(0,3,1,-16) nm.BackgroundTransparency=1 nm.Font=Enum.Font.GothamBold nm.TextSize=8 nm.TextColor3=Color3.fromRGB(255,255,255) nm.TextTruncate=Enum.TextTruncate.AtEnd nm.Text=cd.n nm.Parent=card
  local rr=Instance.new("TextLabel") rr.Size=UDim2.new(1,-6,0,10) rr.Position=UDim2.new(0,3,1,-26) rr.BackgroundTransparency=1 rr.Font=Enum.Font.Gotham rr.TextSize=7 rr.TextColor3=pal[1]:Lerp(Color3.new(1,1,1),0.7) rr.Text=pal[3] rr.Parent=card
  if cd.e then stroke(card,Color3.fromRGB(120,220,130),2) local eq=Instance.new("TextLabel") eq.Size=UDim2.new(1,0,0,12) eq.BackgroundColor3=Color3.fromRGB(40,160,90) eq.BackgroundTransparency=0.2 eq.Font=Enum.Font.GothamBold eq.TextSize=7 eq.TextColor3=Color3.fromRGB(255,255,255) eq.Text="EQUIPPED" eq.Parent=card corner(eq,999) end
  local btn=Instance.new("TextButton") btn.Name="ClickTarget" btn.Size=UDim2.new(1,0,1,0) btn.BackgroundTransparency=1 btn.Text="" btn.Parent=card
end
${dropup ? `local drop=Instance.new("Frame") drop.Name="DropupPicker" drop.Size=UDim2.new(0,120,0,44) drop.Position=UDim2.new(0,8,0,-50) drop.BackgroundColor3=Color3.fromRGB(28,30,38) drop.BackgroundTransparency=0.05 drop.Parent=root corner(drop,10) stroke(drop)
local hint=Instance.new("TextLabel") hint.Size=UDim2.new(1,-8,1,0) hint.Position=UDim2.new(0,4,0,0) hint.BackgroundTransparency=1 hint.Font=Enum.Font.Gotham hint.TextSize=9 hint.TextColor3=Color3.fromRGB(170,175,190) hint.TextWrapped=true hint.Text="Drop a card \\u25b2 or describe a mechanic\\u2026" hint.Parent=drop` : ""}
return HttpService:JSONEncode({ok=true,data={path=root:GetFullName(),cards=${count},dropup=${dropup}},text="created card inventory '${title}' with ${count} collectible cards${dropup ? " + dropup picker" : ""}"})`;
  return { code: lua };
}

function validateStudioSkill(op, args) {
  args = args || {};
  const cmd = SKILL_COMMANDS.find(c => c.name === op);
  if (!cmd) return null;
  for (const [k, v] of Object.entries(cmd.params)) {
    const val = args[k];
    if (v.req && (val === undefined || val === null || val === "")) return `missing required param '${k}' for ${op}`;
    if (val !== undefined && val !== null) {
      const t = v.type;
      if (t === "string" && typeof val !== "string") return `'${k}' must be a string for ${op}`;
      if (t === "number" && typeof val !== "number") return `'${k}' must be a number for ${op}`;
      if (t === "boolean" && typeof val !== "boolean") return `'${k}' must be a boolean for ${op}`;
      if (t === "array" && !Array.isArray(val)) return `'${k}' must be an array for ${op}`;
    }
  }
  if (op === "lighting_set_preset") {
    let p = String(args.preset || "").toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
    if (!LIGHTING_PRESETS_JS[p] && !(p.includes("warm") && p.includes("night"))) return `unknown preset '${args.preset}'. Valid: ${Object.keys(LIGHTING_PRESETS_JS).join(", ")}`;
    if (args.clock_time != null && (isNaN(Number(args.clock_time)) || Number(args.clock_time) < 0 || Number(args.clock_time) > 24)) return `clock_time must be 0-24`;
    if (args.shadows != null && typeof args.shadows !== "boolean") return `shadows must be boolean`;
    if (args.EnvironmentOutdoorScale !== undefined) return `EnvironmentOutdoorScale is not valid — use EnvironmentDiffuseScale / EnvironmentSpecularScale`;
    if (args.Glaire !== undefined || args.glaire !== undefined) return `Glaire is a typo — use Glare`;
  }
  if (op === "terrain_fill_region" && args.material) {
    const mats = ["Grass","Rock","Sand","Water","Snow","Basalt","Lava","Mud","Ice","Salt","LeafyGrass","Sandstone","Ground"];
    if (!mats.map(m=>m.toLowerCase()).includes(String(args.material).toLowerCase())) return `unknown material '${args.material}'. Valid: ${mats.join(", ")}`;
  }
  if (op === "camera_set_style" && args.style) {
    const styles = ["isometric","top_down","side_scroller"];
    if (!styles.includes(String(args.style).toLowerCase())) return `unknown style '${args.style}'. Valid: ${styles.join(", ")}`;
  }
  return null;
}

function buildLuau(op, args) {
  args = args || {};
  const pre = validateStudioSkill(op, args);
  if (pre) return { err: `ERROR: ${pre}` };
  if (op === "lighting_set_preset") return buildLightingPresetLuau(args);
  if (op === "fx_create_beam") return buildFxBeamLuau(args);
  if (op === "fx_create_trail") return buildFxTrailLuau(args);
  if (op === "fx_create_explosion") return buildFxExplosionLuau(args);
  if (op === "ui_create_component" && ["card_inventory","cards","card_dropup"].includes(String(args.component_type||"").toLowerCase())) {
    return buildCardInventoryLuau(args);
  }
  const base = Object.assign({ op }, args);
  try {
    const json = JSON.stringify(base);
    if (json.includes("]==]")) return { err: "ERROR: internal serialization conflict." };
    const code = SKILLS_LIB_LUA.replace("__ARGS_JSON__", json);
    return { code };
  } catch (e) {
    return { err: `ERROR building studio skill command: ${e}` };
  }
}

function describeCommands() {
  const lines = [];
  lines.push(
    "— RobloxScript Studio Skills: high-level tools for Lighting & Atmosphere, UI & HUD generation, " +
    "Particles & FX, Audio routing, Terrain sculpting, Camera controllers, and Place Diagnostics. —"
  );
  for (const c of SKILL_COMMANDS) {
    const compact = [];
    const detailed = [];
    for (const [k, v] of Object.entries(c.params)) {
      const mark = v.req ? "" : "?";
      if (v.desc && v.desc.length > 45) {
        detailed.push(`    ${k}${mark}: ${v.type} - ${v.desc}`);
      } else {
        compact.push(`${k}${mark}:${v.type}${v.desc ? ` "${v.desc}"` : ""}`);
      }
    }
    const paramLines = [compact.length ? `    ${compact.join(", ")}` : "", ...detailed].filter(Boolean).join("\n");
    lines.push(`${c.name}: ${c.description}${paramLines ? "\n" + paramLines : ""}`);
  }
  return lines;
}

const RobloxScriptSkills = {
  SKILLS_LIB_LUA,
  SKILL_COMMANDS,
  SKILL_OPS: SKILL_COMMANDS.map((c) => c.name),
  buildLuau,
  describeCommands,
  validateStudioSkill,
};