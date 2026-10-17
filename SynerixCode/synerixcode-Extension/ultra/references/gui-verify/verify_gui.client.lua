-- verify_gui.client.lua: LocalScript. Checks the live GUI in Play against the layout rules.
-- Place it in StarterPlayer > StarterPlayerScripts, with gui_rules.lua (a ModuleScript) beside it.
-- Run it in Play, with a character alive, after the screens have loaded.
--
-- Prints FAIL lines for every problem, a PASS line per group that is clean, and a RESULT line.
-- It FAILS when it checks nothing: "not found" is a failure, never a pass.
--
-- Mark elements with attributes (in Studio's Properties panel, or with SetAttribute):
--   Overhang = true   a deliberate overlap, such as a badge on an icon. Skipped by the overlap check.
--   Centred = true    must sit in the centre of its parent (within 1 px).

local Players = game:GetService("Players")
local rules = require(script.Parent.gui_rules)

local MIN_GAP = 8
local CENTRE_TOL = 1

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local camera = workspace.CurrentCamera

local function rectOf(obj)
	local p = obj.AbsolutePosition
	local s = obj.AbsoluteSize
	return rules.rect(p.X, p.Y, s.X, s.Y)
end

local checked = 0
local failed = 0

local function fail(msg)
	failed += 1
	print("FAIL " .. msg)
end

local function run()
	local vs = camera.ViewportSize
	local screenRect = rules.rect(0, 0, vs.X, vs.Y)

	-- Group the visible GUI elements by their parent, so siblings can be compared.
	local groups = {}
	for _, gui in playerGui:GetChildren() do
		if gui:IsA("ScreenGui") and gui.Enabled then
			for _, obj in gui:GetDescendants() do
				if obj:IsA("GuiObject") and obj.Visible and obj.AbsoluteSize.X > 0 and obj.AbsoluteSize.Y > 0 then
					local parent = obj.Parent
					groups[parent] = groups[parent] or {}
					table.insert(groups[parent], {
						name = obj:GetFullName(),
						rect = rectOf(obj),
						overhang = obj:GetAttribute("Overhang") == true,
						centred = obj:GetAttribute("Centred") == true,
						obj = obj,
					})
				end
			end
		end
	end

	for parent, items in groups do
		-- 1. Every element is on the screen.
		for _, item in items do
			checked += 1
			if not rules.onScreen(item.rect, vs.X, vs.Y) then
				fail(item.name .. " is outside the screen")
			end
		end

		-- 2. Siblings do not overlap and keep the minimum gap.
		checked += 1
		local problems = rules.checkSiblings(items, MIN_GAP)
		if #problems == 0 then
			print("PASS siblings under " .. parent:GetFullName() .. " keep " .. MIN_GAP .. " px gaps")
		else
			for _, p in problems do
				fail(p .. " (under " .. parent:GetFullName() .. ")")
			end
		end

		-- 3. Elements marked Centred sit in the middle of their parent.
		for _, item in items do
			if item.centred then
				checked += 1
				local parentRect = screenRect
				if parent:IsA("GuiObject") then
					parentRect = rectOf(parent)
				end
				local problem = rules.checkCentred(item.name, item.rect, parentRect, CENTRE_TOL)
				if problem then
					fail(problem)
				end
			end
		end
	end

	-- 4. Text fits its box. TextBounds is the size the text needs; it must not be bigger than the box.
	for _, items in groups do
		for _, item in items do
			local obj = item.obj
			if obj:IsA("TextLabel") or obj:IsA("TextButton") then
				if obj.Text ~= "" then
					checked += 1
					local need = obj.TextBounds
					local have = obj.AbsoluteSize
					if need.X > have.X + 1 or need.Y > have.Y + 1 then
						fail(item.name .. " text needs " .. math.floor(need.X) .. "x" .. math.floor(need.Y)
							.. " px but the box is " .. math.floor(have.X) .. "x" .. math.floor(have.Y) .. " px")
					end
				end
			end
		end
	end

	if checked == 0 then
		fail("nothing was checked: no visible GUI found under PlayerGui")
	end
	print(string.format("%d checks, %d failed", checked, failed))
	print(failed == 0 and checked > 0 and "RESULT PASS" or "RESULT FAIL")
end

task.wait(3)
run()
