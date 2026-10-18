
local dir = (arg and arg[0] and arg[0]:match("(.*/)")) or "./"
local r = dofile(dir .. "gui_rules.lua")
local fails, passes = 0, 0
local function check(name, cond)
  if cond then passes = passes + 1 else fails = fails + 1; print("FAIL: " .. name) end
end
local R = r.rect
-- overlap and gap
check("overlapping rects overlap", r.overlaps(R(0,0,10,10), R(5,5,10,10)))
check("touching edges do not overlap", not r.overlaps(R(0,0,10,10), R(10,0,10,10)))
check("gap 8 horizontally", math.abs(r.gap(R(0,0,10,10), R(18,0,10,10)) - 8) < 1e-9)
check("gap 0 when overlapping", r.gap(R(0,0,10,10), R(5,5,10,10)) == 0)
check("diagonal gap is euclidean (3,4 -> 5)", math.abs(r.gap(R(0,0,10,10), R(13,14,10,10)) - 5) < 1e-9)
-- siblings
local ok = r.checkSiblings({ {name="A", rect=R(0,0,100,40)}, {name="B", rect=R(0,48,100,40)} }, 8)
check("8 px gap passes", #ok == 0)
local tight = r.checkSiblings({ {name="A", rect=R(0,0,100,40)}, {name="B", rect=R(0,45,100,40)} }, 8)
check("5 px gap fails", #tight == 1 and tight[1]:find("minimum 8") ~= nil)
local over = r.checkSiblings({ {name="A", rect=R(0,0,100,40)}, {name="B", rect=R(50,10,100,40)} }, 8)
check("overlap fails", #over == 1 and over[1]:find("overlaps") ~= nil)
local deliberate = r.checkSiblings({ {name="A", rect=R(0,0,100,40)}, {name="Badge", rect=R(80,0,20,20), overhang=true} }, 8)
check("overhang item is skipped", #deliberate == 0)
-- centring
check("centred child passes", r.checkCentred("X", R(45,30,10,10), R(0,0,100,70), 1) == nil)
check("off-centre child fails", r.checkCentred("X", R(0,0,10,10), R(0,0,100,70), 1) ~= nil)
-- on screen
check("inside viewport", r.onScreen(R(0,0,100,50), 1280, 720))
check("past right edge fails", not r.onScreen(R(1200,0,100,50), 1280, 720))
check("negative y fails", not r.onScreen(R(0,-1,100,50), 1280, 720))
print(string.format("%d checks, %d failed", passes + fails, fails))
os.exit(fails == 0 and 0 or 1)
