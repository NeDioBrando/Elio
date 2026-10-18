--!nonstrict
-- roblox-map: ambient motion. The cheapest thing that makes a map look alive.
--
-- Drop this in ServerScriptService. It finds tagged instances and animates
-- them; nothing else in the map needs to know it exists.
--
-- THE ONE THING THAT CATCHES EVERYONE:
--
--   TweenService CANNOT TWEEN A MODEL. Tween a Model's PrimaryPart and only
--   that part moves - the rest of the model stays behind. There is no error.
--
-- Two correct ways round it, both used below:
--   1. WELD the model to its PrimaryPart, then tween the PrimaryPart. The welds
--      carry everything else. Best for rigid motion.
--   2. Tween a CFrameValue and PivotTo the model on its Changed signal. Works
--      without welds, costs a signal per frame per model.
--
-- Motion here is deliberately SLOW and SMALL. Ambient animation that draws the
-- eye is not ambient - it is a distraction, and on a farm map the player is
-- looking at their crops, not at the scenery.

local CollectionService = game:GetService("CollectionService")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local ambient = {}

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

local function weldToPrimary(model)
	local primary = model.PrimaryPart
	if not primary then
		primary = model:FindFirstChildWhichIsA("BasePart")
		model.PrimaryPart = primary
	end
	if not primary then return nil end
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") and d ~= primary then
			local w = Instance.new("WeldConstraint")
			w.Part0 = primary
			w.Part1 = d
			w.Parent = primary
			d.Anchored = false
		end
	end
	primary.Anchored = true
	return primary
end

-- ---------------------------------------------------------------------------
-- spin: continuous rotation. Windmill sails, waterwheels, signs.
-- ---------------------------------------------------------------------------

function ambient.spin(model, axis, degreesPerSecond)
	local primary = weldToPrimary(model)
	if not primary then return end
	local base = primary.CFrame
	local angle = 0
	RunService.Heartbeat:Connect(function(dt)
		angle = (angle + math.rad(degreesPerSecond) * dt) % (math.pi * 2)
		primary.CFrame = base * CFrame.fromAxisAngle(axis, angle)
	end)
end

-- ---------------------------------------------------------------------------
-- bob: slow vertical drift. Lilypads, boats, floating props.
-- ---------------------------------------------------------------------------

function ambient.bob(model, amplitude, period, phase)
	local primary = weldToPrimary(model)
	if not primary then return end
	local base = primary.CFrame
	local t = phase or (math.random() * period)
	RunService.Heartbeat:Connect(function(dt)
		t += dt
		local y = math.sin(t / period * math.pi * 2) * amplitude
		local roll = math.sin(t / period * math.pi * 2 + 1.1) * math.rad(1.6)
		primary.CFrame = base * CFrame.new(0, y, 0) * CFrame.Angles(roll, 0, roll * 0.6)
	end)
end

-- ---------------------------------------------------------------------------
-- sway: a gentle lean, as if in wind. Crops, bushes, tree canopies.
--
-- Applied to a PART rather than a model, and to canopies only - swaying a
-- whole tree including its trunk reads as an earthquake.
-- ---------------------------------------------------------------------------

function ambient.sway(part, degrees, period, phase)
	local base = part.CFrame
	local t = phase or (math.random() * period)
	RunService.Heartbeat:Connect(function(dt)
		t += dt
		local a = math.sin(t / period * math.pi * 2) * math.rad(degrees)
		local b = math.sin(t / period * math.pi * 2 * 0.73 + 0.7) * math.rad(degrees * 0.6)
		part.CFrame = base * CFrame.Angles(a, 0, b)
	end)
end

-- ---------------------------------------------------------------------------
-- pulse: emissive breathing, for lanterns and lit windows.
-- ---------------------------------------------------------------------------

function ambient.pulse(part, lo, hi, period)
	local info = TweenInfo.new(period / 2, Enum.EasingStyle.Sine,
		Enum.EasingDirection.InOut, -1, true, math.random() * period)
	part.Transparency = lo
	TweenService:Create(part, info, {Transparency = hi}):Play()
end

-- ---------------------------------------------------------------------------
-- wire it up by tag
-- ---------------------------------------------------------------------------

local function apply(inst)
	if CollectionService:HasTag(inst, "AmbientSpin") and inst:IsA("Model") then
		ambient.spin(inst, Vector3.new(0, 0, 1),
			inst:GetAttribute("SpinSpeed") or 14)
	elseif CollectionService:HasTag(inst, "AmbientBob") and inst:IsA("Model") then
		ambient.bob(inst, inst:GetAttribute("BobAmplitude") or 0.22,
			inst:GetAttribute("BobPeriod") or 4.5)
	elseif CollectionService:HasTag(inst, "AmbientSway") and inst:IsA("BasePart") then
		ambient.sway(inst, inst:GetAttribute("SwayDegrees") or 1.8,
			inst:GetAttribute("SwayPeriod") or 5.0)
	elseif CollectionService:HasTag(inst, "AmbientPulse") and inst:IsA("BasePart") then
		ambient.pulse(inst, 0.0, 0.35, inst:GetAttribute("PulsePeriod") or 3.2)
	end
end

for _, tag in ipairs({"AmbientSpin", "AmbientBob", "AmbientSway", "AmbientPulse"}) do
	for _, inst in ipairs(CollectionService:GetTagged(tag)) do
		task.spawn(apply, inst)
	end
	CollectionService:GetInstanceAddedSignal(tag):Connect(apply)
end

return ambient
