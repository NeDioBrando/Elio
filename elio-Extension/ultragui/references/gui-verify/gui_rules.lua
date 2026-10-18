-- gui_rules.lua: pure layout rules for the GUI verifier. No Roblox calls here, so it can be
-- tested outside Studio. Rects are plain tables: { x = number, y = number, w = number, h = number }.
-- Place as a ModuleScript (Rojo name: gui_rules.lua). verify_gui.client.lua requires it.
-- Written without type annotations, so the same file runs in Luau and in plain Lua for tests.

local rules = {}

function rules.rect(x, y, w, h)
	return { x = x, y = y, w = w, h = h }
end

function rules.overlaps(a, b)
	return a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h
end

-- Distance between the edges of two rects. 0 when they overlap or touch.
function rules.gap(a, b)
	local dx = math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w))
	local dy = math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h))
	return math.sqrt(dx * dx + dy * dy)
end

-- Offset between the centres of a child and its parent, in pixels: { dx, dy }.
function rules.centreOffset(child, parent)
	local cx = (child.x + child.w / 2) - (parent.x + parent.w / 2)
	local cy = (child.y + child.h / 2) - (parent.y + parent.h / 2)
	return { dx = cx, dy = cy }
end

function rules.onScreen(r, vw, vh)
	return r.x >= 0 and r.y >= 0 and r.x + r.w <= vw and r.y + r.h <= vh
end

-- Check a list of { name = string, rect = rect, overhang = bool or nil } siblings.
-- Returns a list of problem strings. An empty list means PASS.
-- Items marked overhang = true are deliberate overlaps and are skipped.
function rules.checkSiblings(items, minGap)
	local problems = {}
	for i = 1, #items do
		for j = i + 1, #items do
			local a, b = items[i], items[j]
			if not (a.overhang or b.overhang) then
				if rules.overlaps(a.rect, b.rect) then
					table.insert(problems, string.format("%s overlaps %s", a.name, b.name))
				else
					local g = rules.gap(a.rect, b.rect)
					if g < minGap then
						table.insert(problems, string.format("%s is %.1f px from %s (minimum %d)", a.name, g, b.name, minGap))
					end
				end
			end
		end
	end
	return problems
end

-- Check a centred element against its parent. Returns a problem string, or nil if within tolerance.
function rules.checkCentred(name, child, parent, tol)
	local off = rules.centreOffset(child, parent)
	if math.abs(off.dx) > tol or math.abs(off.dy) > tol then
		return string.format("%s is off centre by (%.1f, %.1f) px", name, off.dx, off.dy)
	end
	return nil
end

return rules
