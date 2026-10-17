// Extra Roblox Studio commands (1.17.32): parts, constraints, lighting FX, pads.
// Patches RobloxScriptSkills after studio_daily.js / studio_gui.js load.
(function () {
  if (typeof RobloxScriptSkills === "undefined") return;

  function luaStr(s) {
    return '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ") + '"';
  }
  function num3(v, d) {
    const a = Array.isArray(v) ? v : d;
    return [
      Number(a[0]) || d[0] || 0,
      Number(a[1]) || d[1] || 0,
      Number(a[2]) || d[2] || 0,
    ];
  }
  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function bool(v, d) {
    if (v === true || v === "true") return "true";
    if (v === false || v === "false") return "false";
    return d ? "true" : "false";
  }

  const HEAD = [
    'local HttpService=game:GetService("HttpService")',
    "local function resolve(p) if not p or p=='' then return nil end p=tostring(p) if p=='game' then return game end if p:sub(1,5)=='game.' then p=p:sub(6) end local n=game for _,s in ipairs(string.split(p,'.')) do if s~='' then local nxt=n:FindFirstChild(s) if not nxt and n==game then local ok,svc=pcall(function() return game:GetService(s) end) if ok then nxt=svc end end if not nxt then return nil end n=nxt end end return n end",
    "local function ok(d,t) return HttpService:JSONEncode({ok=true,data=d,text=t or ''}) end",
    "local function fail(m) return HttpService:JSONEncode({ok=false,error=m}) end",
  ].join("\n");

  function wrap(body) {
    return { code: HEAD + "\n" + body };
  }

  function buildPlus(op, a) {
    a = a || {};
    const path = luaStr(a.path || a.target_path || "");
    if (op === "size_set") {
      const sz = num3(a.size, [4, 1, 4]);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.Size=Vector3.new(${sz[0]},${sz[1]},${sz[2]}) return ok({path=i:GetFullName()},"size set")`);
    }
    if (op === "color_set") {
      const c = num3(a.color, [163, 162, 165]);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.Color=Color3.fromRGB(${c[0]},${c[1]},${c[2]}) return ok({path=i:GetFullName()},"color set")`);
    }
    if (op === "cframe_set") {
      const p = num3(a.position || a.cframe, [0, 5, 0]);
      const r = num3(a.rotation || a.orientation, [0, 0, 0]);
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local cf=CFrame.new(${p[0]},${p[1]},${p[2]})*CFrame.Angles(math.rad(${r[0]}),math.rad(${r[1]}),math.rad(${r[2]})) if i:IsA("BasePart") then i.CFrame=cf elseif i:IsA("Model") then i:PivotTo(cf) else return fail("need BasePart or Model") end return ok({path=i:GetFullName()},"cframe set")`);
    }
    if (op === "rotation_set") {
      const r = num3(a.rotation || a.orientation, [0, 0, 0]);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.Orientation=Vector3.new(${r[0]},${r[1]},${r[2]}) return ok({path=i:GetFullName()},"rotation set")`);
    }
    if (op === "massless_set") {
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.Massless=${bool(a.massless, true)} return ok({path=i:GetFullName(),massless=i.Massless},"massless set")`);
    }
    if (op === "can_touch_set") {
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.CanTouch=${bool(a.can_touch, true)} return ok({path=i:GetFullName()},"CanTouch set")`);
    }
    if (op === "can_query_set") {
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.CanQuery=${bool(a.can_query, true)} return ok({path=i:GetFullName()},"CanQuery set")`);
    }
    if (op === "cast_shadow_set") {
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end i.CastShadow=${bool(a.cast_shadow, true)} return ok({path=i:GetFullName()},"CastShadow set")`);
    }
    if (op === "collision_group_set") {
      const g = luaStr(a.group || a.collision_group || "Default");
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end local n=${g} pcall(function() game:GetService("PhysicsService"):RegisterCollisionGroup(n) end) pcall(function() i.CollisionGroup=n end) return ok({path=i:GetFullName(),group=n},"collision group set")`);
    }
    if (op === "brickcolor_set") {
      const n = luaStr(a.brickcolor || a.name || "Medium stone grey");
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end pcall(function() i.BrickColor=BrickColor.new(${n}) end) return ok({path=i:GetFullName()},"brickcolor set")`);
    }
    if (op === "meshpart_create") {
      const name = luaStr(a.name || "MeshPart");
      const sz = num3(a.size, [4, 4, 4]);
      const pos = num3(a.position, [0, 5, 0]);
      const parent = luaStr(a.parent || "Workspace");
      return wrap(`local par=resolve(${parent}) or workspace local m=Instance.new("MeshPart") m.Name=${name} m.Size=Vector3.new(${sz[0]},${sz[1]},${sz[2]}) m.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) m.Anchored=true m.Parent=par return ok({path=m:GetFullName()},"created MeshPart")`);
    }
    if (op === "wedge_create") {
      const name = luaStr(a.name || "Wedge");
      const sz = num3(a.size, [4, 2, 4]);
      const pos = num3(a.position, [0, 3, 0]);
      const parent = luaStr(a.parent || "Workspace");
      return wrap(`local par=resolve(${parent}) or workspace local w=Instance.new("WedgePart") w.Name=${name} w.Size=Vector3.new(${sz[0]},${sz[1]},${sz[2]}) w.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) w.Anchored=true w.Parent=par return ok({path=w:GetFullName()},"created WedgePart")`);
    }
    if (op === "spawn_box") {
      const name = luaStr(a.name || "Arena");
      const w = num(a.width, 40);
      const d = num(a.depth, 40);
      const h = num(a.height, 12);
      return wrap(`local m=Instance.new("Model") m.Name=${name} m.Parent=workspace local function wall(nm,sz,pos) local p=Instance.new("Part") p.Name=nm p.Anchored=true p.Size=sz p.Position=pos p.Parent=m return p end wall("Floor",Vector3.new(${w},1,${d}),Vector3.new(0,0.5,0)) wall("North",Vector3.new(${w},${h},1),Vector3.new(0,${h / 2 + 0.5},${d / 2})) wall("South",Vector3.new(${w},${h},1),Vector3.new(0,${h / 2 + 0.5},${-d / 2})) wall("East",Vector3.new(1,${h},${d}),Vector3.new(${w / 2},${h / 2 + 0.5},0)) wall("West",Vector3.new(1,${h},${d}),Vector3.new(${-w / 2},${h / 2 + 0.5},0)) return ok({path=m:GetFullName()},"spawn box created")`);
    }
    if (op === "ladder_create") {
      const pos = num3(a.position, [0, 8, 0]);
      const h = num(a.height, 16);
      return wrap(`local p=Instance.new("TrussPart") p.Name=${luaStr(a.name || "Ladder")} p.Size=Vector3.new(2,${h},2) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Parent=workspace return ok({path=p:GetFullName()},"ladder created")`);
    }
    if (op === "trampoline_create") {
      const pos = num3(a.position, [0, 1, 0]);
      const power = num(a.power, 80);
      return wrap(`local p=Instance.new("Part") p.Name=${luaStr(a.name || "Trampoline")} p.Size=Vector3.new(8,1,8) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Color=Color3.fromRGB(80,200,120) p.Parent=workspace local s=Instance.new("Script") s.Name="Bounce" s.Source="local p=script.Parent p.Touched:Connect(function(h) local hum=h.Parent and h.Parent:FindFirstChildOfClass('Humanoid') if hum then hum.JumpPower=${power} hum.Jump=true end end)" s.Parent=p return ok({path=p:GetFullName()},"trampoline created")`);
    }
    if (op === "conveyor_create") {
      const pos = num3(a.position, [0, 1, 0]);
      const spd = num(a.speed, 20);
      return wrap(`local p=Instance.new("Part") p.Name=${luaStr(a.name || "Conveyor")} p.Size=Vector3.new(12,1,6) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Color=Color3.fromRGB(60,60,70) p.Parent=workspace p.AssemblyLinearVelocity=Vector3.new(0,0,${spd}) return ok({path=p:GetFullName()},"conveyor created")`);
    }
    if (op === "ice_part") {
      const pos = num3(a.position, [0, 1, 0]);
      const sz = num3(a.size, [16, 1, 16]);
      return wrap(`local p=Instance.new("Part") p.Name=${luaStr(a.name || "Ice")} p.Size=Vector3.new(${sz[0]},${sz[1]},${sz[2]}) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true pcall(function() p.Material=Enum.Material.Ice p.CustomPhysicalProperties=PhysicalProperties.new(0.7,0.01,0,1,1) end) p.Parent=workspace return ok({path=p:GetFullName()},"ice part created")`);
    }
    if (op === "jump_pad") {
      const pos = num3(a.position, [0, 1, 0]);
      const power = num(a.power, 60);
      return wrap(`local p=Instance.new("Part") p.Name=${luaStr(a.name || "JumpPad")} p.Size=Vector3.new(6,1,6) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Color=Color3.fromRGB(80,160,255) p.Parent=workspace local s=Instance.new("Script") s.Name="Pad" s.Source="script.Parent.Touched:Connect(function(h) local hum=h.Parent and h.Parent:FindFirstChildOfClass('Humanoid') if hum then local root=h.Parent:FindFirstChild('HumanoidRootPart') if root then root.AssemblyLinearVelocity=Vector3.new(0,${power},0) end end end)" s.Parent=p return ok({path=p:GetFullName()},"jump pad created")`);
    }
    if (op === "speed_pad") {
      const pos = num3(a.position, [0, 1, 0]);
      const spd = num(a.speed, 32);
      return wrap(`local p=Instance.new("Part") p.Name=${luaStr(a.name || "SpeedPad")} p.Size=Vector3.new(6,1,6) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Color=Color3.fromRGB(255,200,60) p.Parent=workspace local s=Instance.new("Script") s.Name="Pad" s.Source="script.Parent.Touched:Connect(function(h) local hum=h.Parent and h.Parent:FindFirstChildOfClass('Humanoid') if hum then hum.WalkSpeed=${spd} end end)" s.Parent=p return ok({path=p:GetFullName()},"speed pad created")`);
    }
    if (op === "attachment_create") {
      const name = luaStr(a.name || "Attachment");
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local at=Instance.new("Attachment") at.Name=${name} at.Parent=i return ok({path=at:GetFullName()},"attachment created")`);
    }
    if (op === "hinge_create") {
      const a0 = luaStr(a.part0 || a.path || "");
      const a1 = luaStr(a.part1 || a.target_path || "");
      return wrap(`local p0=resolve(${a0}) local p1=resolve(${a1}) if not p0 or not p1 then return fail("need part0 and part1") end local h=Instance.new("HingeConstraint") local x0=p0:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",p0) local x1=p1:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",p1) h.Attachment0=x0 h.Attachment1=x1 h.Parent=p0 return ok({path=h:GetFullName()},"hinge created")`);
    }
    if (op === "spring_create") {
      const a0 = luaStr(a.part0 || a.path || "");
      const a1 = luaStr(a.part1 || a.target_path || "");
      const stiff = num(a.stiffness, 1000);
      return wrap(`local p0=resolve(${a0}) local p1=resolve(${a1}) if not p0 or not p1 then return fail("need part0 and part1") end local s=Instance.new("SpringConstraint") local x0=p0:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",p0) local x1=p1:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",p1) s.Attachment0=x0 s.Attachment1=x1 s.Stiffness=${stiff} s.Parent=p0 return ok({path=s:GetFullName()},"spring created")`);
    }
    if (op === "rope_create") {
      const a0 = luaStr(a.part0 || a.path || "");
      const a1 = luaStr(a.part1 || a.target_path || "");
      const len = num(a.length, 8);
      return wrap(`local p0=resolve(${a0}) local p1=resolve(${a1}) if not p0 or not p1 then return fail("need part0 and part1") end local r=Instance.new("RopeConstraint") local x0=p0:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",p0) local x1=p1:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",p1) r.Attachment0=x0 r.Attachment1=x1 r.Length=${len} r.Visible=true r.Parent=p0 return ok({path=r:GetFullName()},"rope created")`);
    }
    if (op === "vector_force_create") {
      const f = num3(a.force, [0, 1000, 0]);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end local at=i:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",i) local vf=Instance.new("VectorForce") vf.Attachment0=at vf.Force=Vector3.new(${f[0]},${f[1]},${f[2]}) vf.Parent=i return ok({path=vf:GetFullName()},"vector force created")`);
    }
    if (op === "linear_velocity_create") {
      const v = num3(a.velocity, [0, 0, 20]);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("BasePart") then return fail("need a BasePart path") end local at=i:FindFirstChildOfClass("Attachment") or Instance.new("Attachment",i) local lv=Instance.new("LinearVelocity") lv.Attachment0=at lv.VectorVelocity=Vector3.new(${v[0]},${v[1]},${v[2]}) lv.MaxForce=1e6 lv.Parent=i return ok({path=lv:GetFullName()},"linear velocity created")`);
    }
    if (op === "fire_add") {
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local f=Instance.new("Fire") f.Parent=i return ok({path=f:GetFullName()},"fire added")`);
    }
    if (op === "smoke_add") {
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local s=Instance.new("Smoke") s.Parent=i return ok({path=s:GetFullName()},"smoke added")`);
    }
    if (op === "sparkles_add") {
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local s=Instance.new("Sparkles") s.Parent=i return ok({path=s:GetFullName()},"sparkles added")`);
    }
    if (op === "point_light_add") {
      const b = num(a.brightness, 2);
      const r = num(a.range, 16);
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local l=Instance.new("PointLight") l.Brightness=${b} l.Range=${r} l.Parent=i return ok({path=l:GetFullName()},"point light added")`);
    }
    if (op === "spot_light_add") {
      const b = num(a.brightness, 2);
      const r = num(a.range, 24);
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local l=Instance.new("SpotLight") l.Brightness=${b} l.Range=${r} l.Parent=i return ok({path=l:GetFullName()},"spot light added")`);
    }
    if (op === "atmosphere_set") {
      const dens = num(a.density, 0.3);
      const off = num(a.offset, 0.25);
      return wrap(`local a=game:GetService("Lighting"):FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere",game:GetService("Lighting")) a.Density=${dens} a.Offset=${off} return ok({density=a.Density},"atmosphere set")`);
    }
    if (op === "bloom_set") {
      const int = num(a.intensity, 0.4);
      const size = num(a.size, 24);
      return wrap(`local e=game:GetService("Lighting"):FindFirstChildOfClass("BloomEffect") or Instance.new("BloomEffect",game:GetService("Lighting")) e.Intensity=${int} e.Size=${size} e.Enabled=true return ok({intensity=e.Intensity},"bloom set")`);
    }
    if (op === "blur_set") {
      const size = num(a.size, 8);
      return wrap(`local e=game:GetService("Lighting"):FindFirstChildOfClass("BlurEffect") or Instance.new("BlurEffect",game:GetService("Lighting")) e.Size=${size} e.Enabled=true return ok({size=e.Size},"blur set")`);
    }
    if (op === "color_correction_set") {
      const b = num(a.brightness, 0);
      const c = num(a.contrast, 0.1);
      const s = num(a.saturation, 0.1);
      return wrap(`local e=game:GetService("Lighting"):FindFirstChildOfClass("ColorCorrectionEffect") or Instance.new("ColorCorrectionEffect",game:GetService("Lighting")) e.Brightness=${b} e.Contrast=${c} e.Saturation=${s} e.Enabled=true return ok({brightness=e.Brightness},"color correction set")`);
    }
    if (op === "sunrays_set") {
      const int = num(a.intensity, 0.15);
      return wrap(`local e=game:GetService("Lighting"):FindFirstChildOfClass("SunRaysEffect") or Instance.new("SunRaysEffect",game:GetService("Lighting")) e.Intensity=${int} e.Enabled=true return ok({intensity=e.Intensity},"sunrays set")`);
    }
    if (op === "gravity_set") {
      const g = num(a.gravity, 196.2);
      return wrap(`workspace.Gravity=${g} return ok({gravity=workspace.Gravity},"gravity set")`);
    }
    if (op === "walkspeed_set") {
      const spd = num(a.speed, 16);
      return wrap(`pcall(function() game:GetService("StarterPlayer").CharacterWalkSpeed=${spd} end) local n=0 for _,d in ipairs(workspace:GetDescendants()) do if d:IsA("Humanoid") then d.WalkSpeed=${spd} n=n+1 end end return ok({speed=${spd},humanoids=n},"walkspeed set")`);
    }
    if (op === "jumppower_set") {
      const pwr = num(a.power, 50);
      return wrap(`pcall(function() game:GetService("StarterPlayer").CharacterJumpPower=${pwr} end) local n=0 for _,d in ipairs(workspace:GetDescendants()) do if d:IsA("Humanoid") then pcall(function() d.UseJumpPower=true d.JumpPower=${pwr} end) n=n+1 end end return ok({power=${pwr},humanoids=n},"jumppower set")`);
    }
    if (op === "forcefield_add") {
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local ff=Instance.new("ForceField") ff.Parent=i return ok({path=ff:GetFullName()},"forcefield added")`);
    }
    if (op === "explosion_at") {
      const pos = num3(a.position, [0, 5, 0]);
      const blast = num(a.blast_radius, 12);
      return wrap(`local e=Instance.new("Explosion") e.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) e.BlastRadius=${blast} e.Parent=workspace return ok({position={${pos[0]},${pos[1]},${pos[2]}}},"explosion created")`);
    }
    if (op === "teleport_to") {
      const dest = num3(a.position, [0, 10, 0]);
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local cf=CFrame.new(${dest[0]},${dest[1]},${dest[2]}) if i:IsA("Model") then i:PivotTo(cf) elseif i:IsA("BasePart") then i.CFrame=cf else return fail("need Model or BasePart") end return ok({path=i:GetFullName()},"teleported")`);
    }
    if (op === "leaderstats_int") {
      const stat = String(a.stat || a.name || "Coins").replace(/[^A-Za-z0-9_]/g, "") || "Coins";
      const start = num(a.value, 0);
      return wrap(`local sss=game:GetService("ServerScriptService") local s=sss:FindFirstChild("SYNERIXCODE_Leaderstats") or Instance.new("Script") s.Name="SYNERIXCODE_Leaderstats" s.Source="game:GetService('Players').PlayerAdded:Connect(function(plr) local ls=Instance.new('Folder') ls.Name='leaderstats' ls.Parent=plr local v=Instance.new('IntValue') v.Name='${stat}' v.Value=${start} v.Parent=ls end)" s.Parent=sss return ok({script=s:GetFullName()},"leaderstats script ready")`);
    }
    if (op === "remote_event_create") {
      const name = luaStr(a.name || "SYNERIXCODE_Remote");
      return wrap(`local rs=game:GetService("ReplicatedStorage") local r=rs:FindFirstChild(${name}) or Instance.new("RemoteEvent") r.Name=${name} r.Parent=rs return ok({path=r:GetFullName()},"remote event ready")`);
    }
    if (op === "sound_volume") {
      const vol = num(a.volume, 0.5);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("Sound") then return fail("need a Sound path") end i.Volume=math.clamp(${vol},0,10) return ok({path=i:GetFullName(),volume=i.Volume},"volume set")`);
    }
    if (op === "set_property") {
      const key = luaStr(a.property || a.key || "");
      const val = luaStr(a.value == null ? "" : String(a.value));
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local k=${key} local v=${val} local n=tonumber(v) local okset,err=pcall(function() if v=="true" then i[k]=true elseif v=="false" then i[k]=false elseif n then i[k]=n else i[k]=v end end) if not okset then return fail(tostring(err)) end return ok({path=i:GetFullName(),property=k},"property set")`);
    }
    if (op === "get_property") {
      const key = luaStr(a.property || a.key || "Name");
      return wrap(`local i=resolve(${path}) if not i then return fail("path not found") end local k=${key} local v local okget=pcall(function() v=i[k] end) if not okget then return fail("cannot read") end return ok({path=i:GetFullName(),property=k,value=tostring(v)},tostring(v))`);
    }
    if (op === "scale_model") {
      const sc = num(a.scale, 1.5);
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("Model") then return fail("need a Model path") end pcall(function() i:ScaleTo(${sc}) end) return ok({path=i:GetFullName(),scale=${sc}},"model scaled")`);
    }
    if (op === "ungroup_model") {
      return wrap(`local i=resolve(${path}) if not i or not i:IsA("Model") then return fail("need a Model path") end local par=i.Parent or workspace local n=0 local kids=i:GetChildren() for _,c in ipairs(kids) do c.Parent=par n=n+1 end i:Destroy() return ok({moved=n},"ungrouped")`);
    }
    if (op === "developer_product_create") {
      const nm = luaStr(a.name || "Product");
      const desc = luaStr(a.description || a.desc || "");
      const price = num(a.price || a.price_in_robux || a.robux, 10);
      return wrap(`local hs=game:GetService("HttpService") local universe=tonumber(game.GameId) or 0 if universe<1 then return fail("publish the place first (GameId is 0), or pass universe_id to developer_product_create") end local url="https://apis.roblox.com/developer-products/v1/universes/"..universe.."/developerproducts?name="..hs:UrlEncode(${nm}).."&description="..hs:UrlEncode(${desc}).."&priceInRobux="..tostring(${price}) local okreq,res=pcall(function() return hs:RequestAsync({Url=url,Method="POST",Headers={["Content-Type"]="application/json"}}) end) if not okreq then return fail("Studio HTTP could not create the product: "..tostring(res)..". Sign into roblox.com in this browser and retry — synerixcode creates it via your Roblox session.") end return ok({status=res.StatusCode,body=tostring(res.Body):sub(1,900)},"dev product HTTP "..tostring(res.StatusCode))`);
    }
    if (op === "developer_product_list") {
      return wrap(`local hs=game:GetService("HttpService") local universe=tonumber(game.GameId) or 0 if universe<1 then return fail("publish the place first (GameId is 0)") end local url="https://apis.roblox.com/developer-products/v1/universes/"..universe.."/developerproducts?pageNumber=1&pageSize=50" local okreq,res=pcall(function() return hs:GetAsync(url) end) if not okreq then return fail("list failed: "..tostring(res)) end return ok({body=tostring(res):sub(1,4000)},tostring(res):sub(1,4000))`);
    }
    return null;
  }

  const PLUS = [
    { name: "size_set", description: "Set BasePart.Size [x,y,z].", params: { path: { type: "string", req: true }, size: { type: "array", req: false } } },
    { name: "color_set", description: "Set BasePart.Color from RGB 0-255.", params: { path: { type: "string", req: true }, color: { type: "array", req: false } } },
    { name: "cframe_set", description: "Set CFrame (position + rotation degrees) on a Part or Model.", params: { path: { type: "string", req: true }, position: { type: "array", req: false }, rotation: { type: "array", req: false } } },
    { name: "rotation_set", description: "Set BasePart.Orientation in degrees.", params: { path: { type: "string", req: true }, rotation: { type: "array", req: false } } },
    { name: "massless_set", description: "Set BasePart.Massless.", params: { path: { type: "string", req: true }, massless: { type: "boolean", req: false } } },
    { name: "can_touch_set", description: "Set BasePart.CanTouch.", params: { path: { type: "string", req: true }, can_touch: { type: "boolean", req: false } } },
    { name: "can_query_set", description: "Set BasePart.CanQuery.", params: { path: { type: "string", req: true }, can_query: { type: "boolean", req: false } } },
    { name: "cast_shadow_set", description: "Set BasePart.CastShadow.", params: { path: { type: "string", req: true }, cast_shadow: { type: "boolean", req: false } } },
    { name: "collision_group_set", description: "Register and assign a PhysicsService collision group.", params: { path: { type: "string", req: true }, group: { type: "string", req: false } } },
    { name: "brickcolor_set", description: "Set BasePart.BrickColor by name.", params: { path: { type: "string", req: true }, brickcolor: { type: "string", req: false } } },
    { name: "meshpart_create", description: "Create an anchored MeshPart.", params: { name: { type: "string", req: false }, size: { type: "array", req: false }, position: { type: "array", req: false }, parent: { type: "string", req: false } } },
    { name: "wedge_create", description: "Create an anchored WedgePart.", params: { name: { type: "string", req: false }, size: { type: "array", req: false }, position: { type: "array", req: false } } },
    { name: "spawn_box", description: "Build a floor + four walls arena box in Workspace.", params: { name: { type: "string", req: false }, width: { type: "number", req: false }, depth: { type: "number", req: false }, height: { type: "number", req: false } } },
    { name: "ladder_create", description: "Create a climbable TrussPart ladder.", params: { name: { type: "string", req: false }, height: { type: "number", req: false }, position: { type: "array", req: false } } },
    { name: "trampoline_create", description: "Create a bounce pad Part with a Touched script.", params: { name: { type: "string", req: false }, position: { type: "array", req: false }, power: { type: "number", req: false } } },
    { name: "conveyor_create", description: "Create a conveyor Part using AssemblyLinearVelocity.", params: { name: { type: "string", req: false }, position: { type: "array", req: false }, speed: { type: "number", req: false } } },
    { name: "ice_part", description: "Create a slippery Ice material Part.", params: { name: { type: "string", req: false }, size: { type: "array", req: false }, position: { type: "array", req: false } } },
    { name: "jump_pad", description: "Create a pad that launches characters up.", params: { name: { type: "string", req: false }, position: { type: "array", req: false }, power: { type: "number", req: false } } },
    { name: "speed_pad", description: "Create a pad that sets Humanoid.WalkSpeed on touch.", params: { name: { type: "string", req: false }, position: { type: "array", req: false }, speed: { type: "number", req: false } } },
    { name: "attachment_create", description: "Add an Attachment under a part (for constraints).", params: { path: { type: "string", req: true }, name: { type: "string", req: false } } },
    { name: "hinge_create", description: "HingeConstraint between part0 and part1.", params: { part0: { type: "string", req: true }, part1: { type: "string", req: true } } },
    { name: "spring_create", description: "SpringConstraint between part0 and part1.", params: { part0: { type: "string", req: true }, part1: { type: "string", req: true }, stiffness: { type: "number", req: false } } },
    { name: "rope_create", description: "RopeConstraint between part0 and part1.", params: { part0: { type: "string", req: true }, part1: { type: "string", req: true }, length: { type: "number", req: false } } },
    { name: "vector_force_create", description: "VectorForce on a BasePart.", params: { path: { type: "string", req: true }, force: { type: "array", req: false } } },
    { name: "linear_velocity_create", description: "LinearVelocity on a BasePart.", params: { path: { type: "string", req: true }, velocity: { type: "array", req: false } } },
    { name: "fire_add", description: "Add a Fire effect to an instance.", params: { path: { type: "string", req: true } } },
    { name: "smoke_add", description: "Add a Smoke effect to an instance.", params: { path: { type: "string", req: true } } },
    { name: "sparkles_add", description: "Add Sparkles to an instance.", params: { path: { type: "string", req: true } } },
    { name: "point_light_add", description: "Add a PointLight.", params: { path: { type: "string", req: true }, brightness: { type: "number", req: false }, range: { type: "number", req: false } } },
    { name: "spot_light_add", description: "Add a SpotLight.", params: { path: { type: "string", req: true }, brightness: { type: "number", req: false }, range: { type: "number", req: false } } },
    { name: "atmosphere_set", description: "Set Lighting Atmosphere density/offset.", params: { density: { type: "number", req: false }, offset: { type: "number", req: false } } },
    { name: "bloom_set", description: "Set Lighting BloomEffect.", params: { intensity: { type: "number", req: false }, size: { type: "number", req: false } } },
    { name: "blur_set", description: "Set Lighting BlurEffect size.", params: { size: { type: "number", req: false } } },
    { name: "color_correction_set", description: "Set Lighting ColorCorrectionEffect.", params: { brightness: { type: "number", req: false }, contrast: { type: "number", req: false }, saturation: { type: "number", req: false } } },
    { name: "sunrays_set", description: "Set Lighting SunRaysEffect intensity.", params: { intensity: { type: "number", req: false } } },
    { name: "gravity_set", description: "Set Workspace.Gravity.", params: { gravity: { type: "number", req: false } } },
    { name: "walkspeed_set", description: "Set StarterPlayer and live Humanoid WalkSpeed.", params: { speed: { type: "number", req: false } } },
    { name: "jumppower_set", description: "Set StarterPlayer and live Humanoid JumpPower.", params: { power: { type: "number", req: false } } },
    { name: "forcefield_add", description: "Add a ForceField under an instance.", params: { path: { type: "string", req: true } } },
    { name: "explosion_at", description: "Create an Explosion at a world position (Edit preview).", params: { position: { type: "array", req: false }, blast_radius: { type: "number", req: false } } },
    { name: "teleport_to", description: "Pivot a Model or Part to a world position.", params: { path: { type: "string", req: true }, position: { type: "array", req: false } } },
    { name: "leaderstats_int", description: "Install a PlayerAdded leaderstats IntValue script.", params: { stat: { type: "string", req: false }, value: { type: "number", req: false } } },
    { name: "remote_event_create", description: "Create or reuse a RemoteEvent in ReplicatedStorage.", params: { name: { type: "string", req: false } } },
    { name: "sound_volume", description: "Set Sound.Volume on a Sound instance.", params: { path: { type: "string", req: true }, volume: { type: "number", req: false } } },
    { name: "set_property", description: "Set any instance property by name (string/number/bool).", params: { path: { type: "string", req: true }, property: { type: "string", req: true }, value: { type: "string", req: false } } },
    { name: "get_property", description: "Read any instance property and return its value.", params: { path: { type: "string", req: true }, property: { type: "string", req: false } } },
    { name: "scale_model", description: "Model:ScaleTo(scale).", params: { path: { type: "string", req: true }, scale: { type: "number", req: false } } },
    { name: "ungroup_model", description: "Move a Model's children to its parent and destroy the Model.", params: { path: { type: "string", req: true } } },
    { name: "developer_product_create", description: "Create a real Roblox Developer Product on this published universe (name + Robux price). Browser must be signed into roblox.com. Then wires ProcessReceipt if reward is set.", params: { name: { type: "string", req: true, desc: "product name" }, price: { type: "number", req: true, desc: "price in Robux (>=1)" }, description: { type: "string", req: false }, reward: { type: "string", req: false, desc: "what ProcessReceipt grants" }, universe_id: { type: "number", req: false } } },
    { name: "developer_product_list", description: "List Developer Products on this universe.", params: { universe_id: { type: "number", req: false } } },
  ];

  const orig = RobloxScriptSkills.buildLuau;
  RobloxScriptSkills.buildLuau = function (op, args) {
    const extra = buildPlus(op, args);
    if (extra) return extra;
    return orig(op, args);
  };
  for (const c of PLUS) RobloxScriptSkills.SKILL_COMMANDS.push(c);
  RobloxScriptSkills.SKILL_OPS = RobloxScriptSkills.SKILL_COMMANDS.map(function (c) { return c.name; });
})();
