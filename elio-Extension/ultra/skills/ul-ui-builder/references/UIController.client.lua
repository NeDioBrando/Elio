--!strict
-- Opens and closes every page, and knows the name of none of them.
--
-- The UI declares its own behaviour through ATTRIBUTES that ui_build.py emits:
--
--   ScreenGui  UIKind      = "hud" | "page"     "page" starts hidden
--   Button     OpensPage   = "<ScreenGui name>" toggles that page
--   Button     ClosesPage  = true               closes the page it lives in
--   Button     HoverScale, HoverRotate, HoverTime, HoverStyle   hover feedback
--   Button     PressScale, PressTime                            click pop
--   ScreenGui  OpenStyle ("pop" | "instant"), OpenFrom, OpenTime
--
-- MOTION IS DATA. The numbers come from the theme's "motion" block. A typical
-- hover grows a button to about 1.13x and tilts it 4 degrees in about 130ms, then
-- pops on click; many games open menus INSTANTLY. A page or button without
-- these attributes keeps the default pop.
--
-- So this file is a fixed part of the skill: add a page and a HUD button to the
-- spec and it works with no edit here. A table of page names in a script is the
-- thing that goes stale the first time somebody renames a screen.
--
-- ONE PAGE AT A TIME. Opening a page closes whatever else is open, because two
-- stacked modal windows over a HUD is how a UI stops being readable.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local gui = player:WaitForChild("PlayerGui")

local OPEN_TIME = 0.16
local CLOSE_TIME = 0.12
local OPEN_FROM = 0.85

local openPage: ScreenGui? = nil

local function pages(): { ScreenGui }
	local out = {}
	for _, child in ipairs(gui:GetChildren()) do
		if child:IsA("ScreenGui") and child:GetAttribute("UIKind") == "page" then
			table.insert(out, child)
		end
	end
	return out
end

-- The window inside a page, which is the thing that should scale and fade rather
-- than the ScreenGui, since a ScreenGui has no size of its own.
local function windowOf(page: ScreenGui): GuiObject?
	local canvas = page:FindFirstChild("CanvasFrame")
	if not canvas then
		return nil
	end
	for _, child in ipairs(canvas:GetChildren()) do
		if child:IsA("GuiObject") then
			return child
		end
	end
	return nil
end

local function setScale(window: GuiObject?, value: number)
	if not window then
		return
	end
	local scale = window:FindFirstChild("PageScale")
	if not scale then
		scale = Instance.new("UIScale")
		scale.Name = "PageScale"
		scale.Parent = window
	end
	local s = scale :: UIScale
	s.Scale = value
end

local function close(page: ScreenGui?)
	if not page or not page.Enabled then
		return
	end
	local window = windowOf(page)
	local scale = window and window:FindFirstChild("PageScale") :: UIScale?
	if scale and page:GetAttribute("OpenStyle") ~= "instant" then
		local tween = TweenService:Create(
			scale,
			TweenInfo.new(CLOSE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In),
			{ Scale = 0.85 }
		)
		tween.Completed:Connect(function()
			page.Enabled = false
		end)
		tween:Play()
	else
		page.Enabled = false
	end
	if openPage == page then
		openPage = nil
	end
end

local function open(page: ScreenGui)
	if openPage and openPage ~= page then
		close(openPage)
	end
	local window = windowOf(page)
	openPage = page
	if page:GetAttribute("OpenStyle") == "instant" then
		-- Measured: many popular games open menus with no tween at all. Instant reads as responsive, not as unfinished.
		setScale(window, 1)
		page.Enabled = true
		return
	end
	local from = page:GetAttribute("OpenFrom")
	local time = page:GetAttribute("OpenTime")
	setScale(window, if typeof(from) == "number" then from else OPEN_FROM)
	page.Enabled = true
	local scale = window and window:FindFirstChild("PageScale") :: UIScale?
	if scale then
		-- Back easing is the standard Roblox "pop". Small overshoot, not a bounce.
		TweenService:Create(
			scale,
			TweenInfo.new(
				if typeof(time) == "number" then time else OPEN_TIME,
				Enum.EasingStyle.Back,
				Enum.EasingDirection.Out
			),
			{ Scale = 1 }
		):Play()
	end
end

local function toggle(name: string)
	local page = gui:FindFirstChild(name)
	if not page or not page:IsA("ScreenGui") then
		-- Loud, because a renamed page failing silently is the exact bug this
		-- attribute-driven design exists to avoid.
		warn(("[UI] no ScreenGui named %q to open"):format(name))
		return
	end
	if page.Enabled and openPage == page then
		close(page)
	else
		open(page)
	end
end

local function pageOf(instance: Instance): ScreenGui?
	local node: Instance? = instance
	while node do
		if node:IsA("ScreenGui") then
			return node
		end
		node = node.Parent
	end
	return nil
end

-- Hover and press feedback, read from attributes. Scale lives on a UIScale named
-- MotionScale so it never fights the page's PageScale or a layout's sizing;
-- rotation is the button's own Rotation, restored to whatever it started at.
local function easing(name: any): Enum.EasingStyle
	local ok, style = pcall(function()
		return (Enum.EasingStyle :: any)[name]
	end)
	return if ok and style then style else Enum.EasingStyle.Quad
end

local function wireMotion(button: GuiButton)
	local hoverScale = button:GetAttribute("HoverScale")
	local pressScale = button:GetAttribute("PressScale")
	if typeof(hoverScale) ~= "number" and typeof(pressScale) ~= "number" then
		return
	end
	local scale = button:FindFirstChild("MotionScale") :: UIScale?
	if not scale then
		local s = Instance.new("UIScale")
		s.Name = "MotionScale"
		s.Parent = button
		scale = s
	end
	local ms = scale :: UIScale
	local baseRotation = button.Rotation
	local hoverRotate = button:GetAttribute("HoverRotate")
	local hoverTime = button:GetAttribute("HoverTime")
	local info = TweenInfo.new(
		if typeof(hoverTime) == "number" then hoverTime else 0.1,
		easing(button:GetAttribute("HoverStyle")),
		Enum.EasingDirection.Out
	)
	local pressTime = button:GetAttribute("PressTime")
	local pressInfo = TweenInfo.new(
		if typeof(pressTime) == "number" then pressTime else 0.07,
		Enum.EasingStyle.Quad,
		Enum.EasingDirection.Out
	)
	local hovered = false

	local function rest()
		local target = if hovered and typeof(hoverScale) == "number" then hoverScale else 1
		local rot = if hovered and typeof(hoverRotate) == "number"
			then baseRotation + hoverRotate
			else baseRotation
		TweenService:Create(ms, info, { Scale = target }):Play()
		TweenService:Create(button, info, { Rotation = rot }):Play()
	end
	button.MouseEnter:Connect(function()
		hovered = true
		rest()
	end)
	button.MouseLeave:Connect(function()
		hovered = false
		rest()
	end)
	if typeof(pressScale) == "number" then
		button.MouseButton1Down:Connect(function()
			TweenService:Create(ms, pressInfo, { Scale = pressScale }):Play()
		end)
		button.MouseButton1Up:Connect(rest)
	end
end

local function wire(button: GuiButton)
	wireMotion(button)
	local opens = button:GetAttribute("OpensPage")
	if typeof(opens) == "string" then
		button.Activated:Connect(function()
			toggle(opens)
		end)
	end
	if button:GetAttribute("ClosesPage") == true then
		button.Activated:Connect(function()
			close(pageOf(button))
		end)
	end
end

local function bind(root: Instance)
	for _, descendant in ipairs(root:GetDescendants()) do
		if descendant:IsA("GuiButton") then
			wire(descendant)
		end
	end
	root.DescendantAdded:Connect(function(descendant)
		if descendant:IsA("GuiButton") then
			wire(descendant)
		end
	end)
end

for _, page in ipairs(pages()) do
	page.Enabled = false
end
bind(gui)

-- Escape closes the top page. UserInputService, not ContextActionService, so the
-- default Roblox menu still opens when nothing of ours is up.
UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.Escape and openPage then
		close(openPage)
	end
end)

print(("[UI] ready: %d pages"):format(#pages()))
