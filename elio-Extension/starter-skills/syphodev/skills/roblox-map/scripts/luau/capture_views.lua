--!nonstrict
-- roblox-map: a camera tour that writes REAL PNG FILES for a human to look at.
--
--   python scripts/capture_receiver.py --out <dir> [--port 8799]        (background)
--   python scripts/capture_receiver.py --emit-lua views.json > tour.lua  (fills the views and port placeholders)
--   run tour.lua through execute_luau, poll workspace:GetAttribute("CaptureTour")
--
-- WHY THIS EXISTS. A user away from the PC (remote control) asked for screenshots.
-- The MCP capture returns an image to the agent only; desktop grabs saved zero frames
-- while Studio was not the foreground window, and another tour saved every frame one
-- view late because the camera and the grab were driven from two processes. Here the
-- camera move, the capture and the pixel read live in ONE script, so they cannot drift
-- out of step, and CaptureService renders whether or not Studio has focus.
--
-- views.json: [{"name": "1_gate", "eye": [x,y,z], "look": [x,y,z]}, ...] in WORLD studs
-- (terrain lift included). Pick eyes from the spec's own coordinates, never by eye.

local HttpService = game:GetService("HttpService")
local CaptureService = game:GetService("CaptureService")
local AssetService = game:GetService("AssetService")
local cam = workspace.CurrentCamera
local BASE = "http://127.0.0.1:{port}"
local VIEWS = HttpService:JSONDecode([==[{views}]==])
local HEX = {}
for i = 0, 255 do HEX[i] = string.format("%02x", i) end

local function post(path, body)
	for _ = 1, 20 do
		local ok, res = pcall(function()
			return HttpService:PostAsync(BASE .. path, body or "", Enum.HttpContentType.TextPlain)
		end)
		if ok then return res end
		task.wait(1.5)
	end
	error("receiver unreachable at " .. path)
end

workspace:SetAttribute("CaptureTour", "starting")
task.spawn(function()
	local ok, err = pcall(function()
		for n, v in ipairs(VIEWS) do
			local eye = Vector3.new(v.eye[1], v.eye[2], v.eye[3])
			local look = Vector3.new(v.look[1], v.look[2], v.look[3])
			cam.Focus = CFrame.new(look)
			cam.CFrame = CFrame.lookAt(eye, look)
			task.wait(3) -- let streaming, LOD and foliage settle before the shot
			local cid
			CaptureService:CaptureScreenshot(function(id) cid = id end)
			local waited = 0
			while not cid and waited < 20 do waited += task.wait(0.2) end
			if not cid then error("capture timed out on " .. v.name) end
			local img = AssetService:CreateEditableImageAsync(Content.fromUri(cid))
			local W, H = img.Size.X, img.Size.Y
			local buf = img:ReadPixelsBuffer(Vector2.zero, img.Size)
			img:Destroy()
			post(("/begin?name=%s&w=%d&h=%d"):format(v.name, W, H))
			local ROWS = 40
			for y = 0, H - 1, ROWS do
				local rows = math.min(ROWS, H - y)
				local parts = table.create(W * rows * 3)
				local k = 0
				for yy = y, y + rows - 1 do
					local base = yy * W * 4
					for x = 0, W - 1 do
						local o = base + x * 4
						parts[k + 1] = HEX[buffer.readu8(buf, o)]
						parts[k + 2] = HEX[buffer.readu8(buf, o + 1)]
						parts[k + 3] = HEX[buffer.readu8(buf, o + 2)]
						k += 3
					end
				end
				post(("/rows?name=%s&y=%d"):format(v.name, y), table.concat(parts))
				task.wait()
			end
			post("/end?name=" .. v.name)
			workspace:SetAttribute("CaptureTour", ("%d/%d done (%dx%d)"):format(n, #VIEWS, W, H))
		end
	end)
	workspace:SetAttribute("CaptureTour", ok and "all done" or ("FAILED: " .. tostring(err)))
end)
return ("capture tour started: %d views"):format(#VIEWS)
