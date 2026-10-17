// Extra Roblox Studio commands used every day (parts, tools, tags, selection).
// Patches RobloxScriptSkills after studio_skills.js loads.
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
  const HEAD = [
    'local HttpService=game:GetService("HttpService")',
    "local function resolve(p) if not p or p=='' then return nil end p=tostring(p) if p=='game' then return game end if p:sub(1,5)=='game.' then p=p:sub(6) end local n=game for _,s in ipairs(string.split(p,'.')) do if s~='' then local nxt=n:FindFirstChild(s) if not nxt and n==game then local ok,svc=pcall(function() return game:GetService(s) end) if ok then nxt=svc end end if not nxt then return nil end n=nxt end end return n end",
    "local function ok(d,t) return HttpService:JSONEncode({ok=true,data=d,text=t or ''}) end",
    "local function fail(m) return HttpService:JSONEncode({ok=false,error=m}) end",
  ].join("\n");

  function wrap(body) {
    return { code: HEAD + "\n" + body };
  }

  function buildDaily(op, a) {
    a = a || {};
    if (op === "part_create") {
      const name = luaStr(a.name || "Part");
      const sz = num3(a.size, [4, 1, 4]);
      const pos = num3(a.position || a.cframe, [0, 5, 0]);
      const col = num3(a.color, [163, 162, 165]);
      const mat = String(a.material || "Plastic").replace(/[^A-Za-z]/g, "") || "Plastic";
      const parent = luaStr(a.parent || a.parent_path || "Workspace");
      const anchored = a.anchored === false ? "false" : "true";
      return wrap(
        `local par=resolve(${parent}) or workspace\n` +
        `local p=Instance.new("Part") p.Name=${name} p.Size=Vector3.new(${sz[0]},${sz[1]},${sz[2]}) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=${anchored} p.CanCollide=true p.Color=Color3.fromRGB(${col[0]},${col[1]},${col[2]}) pcall(function() p.Material=Enum.Material.${mat} end) p.Parent=par\n` +
        `return ok({path=p:GetFullName(),name=p.Name},"created Part "..p:GetFullName())`
      );
    }
    if (op === "model_group") {
      const name = luaStr(a.name || "Model");
      const paths = Array.isArray(a.paths) ? a.paths : (Array.isArray(a.objects) ? a.objects : []);
      const list = JSON.stringify(paths.map(String));
      return wrap(
        `local names=HttpService:JSONDecode('${list.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')\n` +
        `local m=Instance.new("Model") m.Name=${name} m.Parent=workspace\n` +
        `local first=nil for _,p in ipairs(names) do local inst=resolve(p) if inst then inst.Parent=m if not first and inst:IsA("BasePart") then first=inst end end end\n` +
        `if first then m.PrimaryPart=first end\n` +
        `return ok({path=m:GetFullName(),children=#m:GetChildren()},"grouped "..#m:GetChildren().." instances into "..m:GetFullName())`
      );
    }
    if (op === "weld_assemble") {
      const path = luaStr(a.path || a.target_path || "");
      return wrap(
        `local root=resolve(${path}) if not root then return fail("path not found") end\n` +
        `local parts={} for _,d in ipairs(root:GetDescendants()) do if d:IsA("BasePart") then parts[#parts+1]=d end end\n` +
        `if root:IsA("BasePart") then table.insert(parts,1,root) end\n` +
        `if #parts<2 then return fail("need at least two BaseParts") end\n` +
        `local primary=parts[1] if root:IsA("Model") then root.PrimaryPart=primary end\n` +
        `local n=0 for i=2,#parts do local w=Instance.new("WeldConstraint") w.Part0=primary w.Part1=parts[i] w.Parent=primary n=n+1 end\n` +
        `return ok({welds=n,primary=primary:GetFullName()},"welded "..n.." parts to "..primary.Name)`
      );
    }
    if (op === "tool_create") {
      const name = luaStr(a.name || "Tool");
      const dest = luaStr(a.parent || "StarterPack");
      return wrap(
        `local par=resolve(${dest}) or game:GetService("StarterPack")\n` +
        `local t=Instance.new("Tool") t.Name=${name} t.CanBeDropped=true t.RequiresHandle=true t.Parent=par\n` +
        `local h=Instance.new("Part") h.Name="Handle" h.Size=Vector3.new(1,1,4) h.Color=Color3.fromRGB(180,180,190) h.Massless=true h.Parent=t\n` +
        `return ok({path=t:GetFullName()},"created Tool "..t:GetFullName().." with Handle")`
      );
    }
    if (op === "dummy_spawn") {
      const name = luaStr(a.name || "Dummy");
      const pos = num3(a.position, [0, 5, 0]);
      return wrap(
        `local m=Instance.new("Model") m.Name=${name} m.Parent=workspace\n` +
        `local function part(n,sz,cf) local p=Instance.new("Part") p.Name=n p.Size=sz p.Anchored=false p.CanCollide=true p.CFrame=cf p.Parent=m return p end\n` +
        `local root=part("HumanoidRootPart",Vector3.new(2,2,1),CFrame.new(${pos[0]},${pos[1]},${pos[2]})) root.Transparency=1 root.CanCollide=false\n` +
        `local torso=part("Torso",Vector3.new(2,2,1),root.CFrame) local head=part("Head",Vector3.new(2,1,1),root.CFrame*CFrame.new(0,1.5,0))\n` +
        `local hum=Instance.new("Humanoid") hum.Parent=m m.PrimaryPart=root\n` +
        `local w1=Instance.new("WeldConstraint") w1.Part0=root w1.Part1=torso w1.Parent=root\n` +
        `local w2=Instance.new("WeldConstraint") w2.Part0=torso w2.Part1=head w2.Parent=torso\n` +
        `return ok({path=m:GetFullName()},"spawned dummy "..m:GetFullName())`
      );
    }
    if (op === "kill_brick") {
      const path = a.path || a.target_path;
      const pos = num3(a.position, [0, 1, 0]);
      const sz = num3(a.size, [8, 1, 8]);
      return wrap(
        `local p=nil\n` +
        (path ? `p=resolve(${luaStr(path)})\n` : "") +
        `if not p then p=Instance.new("Part") p.Name="KillBrick" p.Size=Vector3.new(${sz[0]},${sz[1]},${sz[2]}) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Color=Color3.fromRGB(180,40,40) p.Material=Enum.Material.Neon p.Parent=workspace end\n` +
        `local old=p:FindFirstChild("KillScript") if old then old:Destroy() end\n` +
        `local s=Instance.new("Script") s.Name="KillScript" s.Parent=p\n` +
        `s.Source="script.Parent.Touched:Connect(function(hit) local h=hit.Parent and hit.Parent:FindFirstChildOfClass('Humanoid') if h then h.Health=0 end end)"\n` +
        `return ok({path=p:GetFullName()},"kill brick at "..p:GetFullName())`
      );
    }
    if (op === "spawn_location") {
      const pos = num3(a.position, [0, 5, 0]);
      const team = luaStr(a.team || "");
      return wrap(
        `local sp=Instance.new("SpawnLocation") sp.Name="SpawnLocation" sp.Size=Vector3.new(6,1,6) sp.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) sp.Anchored=true sp.Neutral=true sp.Duration=0 sp.Parent=workspace\n` +
        `local tn=${team} if tn~="" then pcall(function() sp.TeamColor=BrickColor.new(tn) sp.Neutral=false end) end\n` +
        `return ok({path=sp:GetFullName()},"created SpawnLocation at "..sp:GetFullName())`
      );
    }
    if (op === "instance_destroy") {
      const path = luaStr(a.path || a.target_path || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local n=inst:GetFullName() inst:Destroy() return ok({destroyed=n},"destroyed "..n)`
      );
    }
    if (op === "instance_clone") {
      const path = luaStr(a.path || "");
      const dest = luaStr(a.parent || a.dest || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local c=inst:Clone() local par=resolve(${dest}) or inst.Parent or workspace c.Parent=par return ok({path=c:GetFullName()},"cloned to "..c:GetFullName())`
      );
    }
    if (op === "material_set") {
      const path = luaStr(a.path || "");
      const mat = String(a.material || "Plastic").replace(/[^A-Za-z]/g, "") || "Plastic";
      const col = Array.isArray(a.color) ? num3(a.color, [163, 162, 165]) : null;
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local n=0 local function apply(p) if p:IsA("BasePart") then pcall(function() p.Material=Enum.Material.${mat} end) ${col ? `p.Color=Color3.fromRGB(${col[0]},${col[1]},${col[2]})` : ""} n=n+1 end end apply(inst) for _,d in ipairs(inst:GetDescendants()) do apply(d) end return ok({count=n},"set material ${mat} on "..n.." parts")`
      );
    }
    if (op === "click_detector") {
      const path = luaStr(a.path || a.target_path || "");
      const maxd = Number(a.max_distance) || 16;
      return wrap(
        `local inst=resolve(${path}) if not inst or not inst:IsA("BasePart") then return fail("path must be a BasePart") end local cd=inst:FindFirstChildOfClass("ClickDetector") or Instance.new("ClickDetector") cd.MaxActivationDistance=${maxd} cd.Parent=inst return ok({path=cd:GetFullName()},"ClickDetector on "..inst:GetFullName())`
      );
    }
    if (op === "billboard") {
      const path = luaStr(a.path || "");
      const text = luaStr(a.text || "Label");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local host=inst:IsA("BasePart") and inst or inst:FindFirstChildWhichIsA("BasePart",true) if not host then return fail("need a BasePart") end local bg=host:FindFirstChild("ORBillboard") or Instance.new("BillboardGui") bg.Name="ORBillboard" bg.Size=UDim2.new(0,140,0,36) bg.StudsOffset=Vector3.new(0,3,0) bg.AlwaysOnTop=true bg.Parent=host local tl=bg:FindFirstChild("Text") or Instance.new("TextLabel") tl.Name="Text" tl.Size=UDim2.fromScale(1,1) tl.BackgroundColor3=Color3.fromRGB(20,20,24) tl.BackgroundTransparency=0.25 tl.Text=${text} tl.TextColor3=Color3.new(1,1,1) tl.Font=Enum.Font.GothamBold tl.TextScaled=true tl.Parent=bg return ok({path=bg:GetFullName()},"billboard on "..host:GetFullName())`
      );
    }
    if (op === "attribute_set") {
      const path = luaStr(a.path || "");
      const key = luaStr(a.key || a.name || "");
      const val = a.value;
      let lit = "true";
      if (typeof val === "number") lit = String(val);
      else if (typeof val === "boolean") lit = val ? "true" : "false";
      else lit = luaStr(val == null ? "" : String(val));
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end inst:SetAttribute(${key}, ${lit}) return ok({path=inst:GetFullName(),key=${key}},"attribute set")`
      );
    }
    if (op === "tag_add") {
      const path = luaStr(a.path || "");
      const tag = luaStr(a.tag || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end game:GetService("CollectionService"):AddTag(inst, ${tag}) return ok({path=inst:GetFullName(),tag=${tag}},"tagged")`
      );
    }
    if (op === "selection_info") {
      return wrap(
        `local sel=game:GetService("Selection"):Get() local items={} for _,i in ipairs(sel) do items[#items+1]={name=i.Name,className=i.ClassName,path=i:GetFullName()} end return ok({count=#items,items=items},(#items==0 and "nothing selected" or ("selected "..#items.." instance(s)")))`
      );
    }
    if (op === "sky_set") {
      const preset = String(a.preset || "day").toLowerCase();
      const map = {
        day: { top: [90, 160, 255], bottom: [180, 210, 255] },
        night: { top: [8, 10, 28], bottom: [20, 24, 48] },
        sunset: { top: [255, 120, 60], bottom: [255, 200, 140] },
        space: { top: [0, 0, 0], bottom: [4, 6, 18] },
      };
      const c = map[preset] || map.day;
      return wrap(
        `local Lighting=game:GetService("Lighting") local sky=Lighting:FindFirstChildOfClass("Sky") or Instance.new("Sky") sky.Parent=Lighting\n` +
        `sky.SkyboxBk="rbxassetid://591058823" sky.SkyboxDn="rbxassetid://591059876" sky.SkyboxFt="rbxassetid://591058104" sky.SkyboxLf="rbxassetid://591057861" sky.SkyboxRt="rbxassetid://591057625" sky.SkyboxUp="rbxassetid://591059642"\n` +
        `Lighting.Ambient=Color3.fromRGB(${c.bottom[0]},${c.bottom[1]},${c.bottom[2]}) Lighting.OutdoorAmbient=Color3.fromRGB(${c.top[0]},${c.top[1]},${c.top[2]})\n` +
        `return ok({preset="${preset}"},"sky preset ${preset}")`
      );
    }
    if (op === "health_pack") {
      const pos = num3(a.position, [0, 3, 0]);
      const heal = Number(a.heal) || 50;
      return wrap(
        `local p=Instance.new("Part") p.Name="HealthPack" p.Size=Vector3.new(2,2,2) p.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) p.Anchored=true p.Color=Color3.fromRGB(80,220,120) p.Material=Enum.Material.Neon p.Parent=workspace\n` +
        `local s=Instance.new("Script") s.Name="HealScript" s.Parent=p\n` +
        `s.Source="local db=false script.Parent.Touched:Connect(function(hit) if db then return end local h=hit.Parent and hit.Parent:FindFirstChildOfClass('Humanoid') if h then db=true h.Health=math.min(h.MaxHealth,h.Health+${heal}) script.Parent:Destroy() end end)"\n` +
        `return ok({path=p:GetFullName(),heal=${heal}},"health pack heals ${heal}")`
      );
    }
    if (op === "sprint_setup") {
      const walk = Number(a.walk_speed) || 16;
      const sprint = Number(a.sprint_speed) || 24;
      return wrap(
        `local sps=game:GetService("StarterPlayer").StarterPlayerScripts local old=sps:FindFirstChild("SYNERIXCODE_Sprint") if old then old:Destroy() end\n` +
        `local ls=Instance.new("LocalScript") ls.Name="SYNERIXCODE_Sprint" ls.Parent=sps\n` +
        `ls.Source="local uis=game:GetService('UserInputService') local p=game:GetService('Players').LocalPlayer local function hum() local c=p.Character return c and c:FindFirstChildOfClass('Humanoid') end uis.InputBegan:Connect(function(i,g) if g then return end if i.KeyCode==Enum.KeyCode.LeftShift then local h=hum() if h then h.WalkSpeed=${sprint} end end end) uis.InputEnded:Connect(function(i) if i.KeyCode==Enum.KeyCode.LeftShift then local h=hum() if h then h.WalkSpeed=${walk} end end end)"\n` +
        `return ok({walk=${walk},sprint=${sprint}},"sprint on LeftShift (${walk} -> ${sprint})")`
      );
    }
    if (op === "seat_create") {
      const pos = num3(a.position, [0, 2, 0]);
      const vehicle = a.vehicle === true;
      return wrap(
        `local s=Instance.new("${vehicle ? "VehicleSeat" : "Seat"}") s.Name="${vehicle ? "VehicleSeat" : "Seat"}" s.Size=Vector3.new(2,1,2) s.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) s.Anchored=true s.Parent=workspace return ok({path=s:GetFullName()},"created "..s.ClassName)`
      );
    }
    if (op === "workspace_list") {
      const path = luaStr(a.path || "Workspace");
      const limit = Math.min(80, Math.max(1, Number(a.limit) || 40));
      return wrap(
        `local root=resolve(${path}) or workspace local items={} for _,c in ipairs(root:GetChildren()) do if #items>=${limit} then break end items[#items+1]={name=c.Name,className=c.ClassName,path=c:GetFullName()} end return ok({path=root:GetFullName(),count=#items,items=items},"listed "..#items.." children of "..root:GetFullName())`
      );
    }
    if (op === "instance_rename") {
      const path = luaStr(a.path || "");
      const name = luaStr(a.name || a.new_name || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local n=${name} if n=="" then return fail("empty name") end inst.Name=n return ok({path=inst:GetFullName()},"renamed to "..inst:GetFullName())`
      );
    }
    if (op === "instance_reparent") {
      const path = luaStr(a.path || "");
      const parent = luaStr(a.parent || a.dest || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local par=resolve(${parent}) if not par then return fail("parent not found") end inst.Parent=par return ok({path=inst:GetFullName()},"reparented to "..par:GetFullName())`
      );
    }
    if (op === "selection_set") {
      const raw = Array.isArray(a.paths) ? a.paths : (a.path ? [a.path] : []);
      const arr = raw.map((x) => luaStr(String(x))).join(",");
      return wrap(
        `local sel=game:GetService("Selection") local out={} for _,p in ipairs({${arr}}) do local i=resolve(p) if i then out[#out+1]=i end end sel:Set(out) return ok({count=#out},"selected "..#out.." instance(s)")`
      );
    }
    if (op === "script_append") {
      const path = luaStr(a.path || "");
      const src = '"' + String(a.source || a.code || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n") + '"';
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if not inst:IsA("LuaSourceContainer") then return fail("not a script") end inst.Source=inst.Source.."\\n"..${src} return ok({path=inst:GetFullName(),chars=#inst.Source},"appended to "..inst:GetFullName())`
      );
    }
    if (op === "camera_look_at") {
      const path = luaStr(a.path || "");
      const dist = Number(a.distance) || 24;
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local cam=workspace.CurrentCamera if not cam then return fail("no camera") end local pos=inst:GetPivot().Position local d=${dist} cam.CameraType=Enum.CameraType.Scriptable cam.CFrame=CFrame.lookAt(pos+Vector3.new(d,d*0.55,d),pos) return ok({path=inst:GetFullName(),distance=d},"camera looking at "..inst:GetFullName())`
      );
    }
    if (op === "attribute_get") {
      const path = luaStr(a.path || "");
      const key = luaStr(a.key || a.name || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local k=${key} local v=inst:GetAttribute(k) return ok({path=inst:GetFullName(),key=k,value=v},"attribute "..k.." = "..tostring(v))`
      );
    }
    if (op === "pivot_set") {
      const path = luaStr(a.path || "");
      const pos = num3(a.position || a.pos, [0, 0, 0]);
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end inst:PivotTo(CFrame.new(${pos[0]},${pos[1]},${pos[2]})) return ok({path=inst:GetFullName(),position={${pos[0]},${pos[1]},${pos[2]}}},"pivoted "..inst:GetFullName())`
      );
    }
    if (op === "highlight_add") {
      const path = luaStr(a.path || "");
      const fill = Array.isArray(a.color) ? num3(a.color, [0, 1, 1]) : [0, 1, 1];
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local h=inst:FindFirstChildOfClass("Highlight") if not h then h=Instance.new("Highlight") h.Name="SYNERIXCODE_Highlight" h.Parent=inst end h.FillColor=Color3.new(${fill[0]},${fill[1]},${fill[2]}) h.OutlineColor=Color3.new(1,1,1) h.FillTransparency=0.65 h.OutlineTransparency=0 return ok({path=h:GetFullName()},"highlight on "..inst:GetFullName())`
      );
    }
    if (op === "script_set_source") {
      const path = luaStr(a.path || "");
      const src = '"' + String(a.source || a.code || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n") + '"';
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if not inst:IsA("LuaSourceContainer") then return fail("not a script") end inst.Source=${src} return ok({path=inst:GetFullName(),chars=#inst.Source},"wrote source "..inst:GetFullName())`
      );
    }
    if (op === "script_list") {
      const path = luaStr(a.path || "");
      const limit = Math.min(80, Math.max(1, Number(a.limit) || 40));
      return wrap(
        `local root=resolve(${path}) or game local out={} local function walk(n) if #out>=${limit} then return end if n:IsA("LuaSourceContainer") then out[#out+1]={path=n:GetFullName(),className=n.ClassName,disabled=n.Disabled} end for _,c in ipairs(n:GetChildren()) do walk(c) if #out>=${limit} then return end end end pcall(walk, root) return ok({count=#out,items=out},"listed "..#out.." scripts")`
      );
    }
    if (op === "script_disable") {
      const path = luaStr(a.path || "");
      const dis = a.disabled === false ? "false" : "true";
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if not inst:IsA("LuaSourceContainer") then return fail("not a script") end inst.Disabled=${dis} return ok({path=inst:GetFullName(),disabled=inst.Disabled},"Disabled="..tostring(inst.Disabled))`
      );
    }
    if (op === "sound_play") {
      const path = luaStr(a.path || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local s=inst:IsA("Sound") and inst or inst:FindFirstChildOfClass("Sound") if not s then return fail("no Sound") end s:Play() return ok({path=s:GetFullName()},"playing "..s:GetFullName())`
      );
    }
    if (op === "anchored_set") {
      const path = luaStr(a.path || "");
      const v = a.anchored === false ? "false" : "true";
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if not inst:IsA("BasePart") then return fail("not a BasePart") end inst.Anchored=${v} return ok({path=inst:GetFullName(),anchored=inst.Anchored},"Anchored="..tostring(inst.Anchored))`
      );
    }
    if (op === "collision_set") {
      const path = luaStr(a.path || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if not inst:IsA("BasePart") then return fail("not a BasePart") end if ${a.can_collide === false ? "true" : (a.can_collide === true ? "true" : "false")} then inst.CanCollide=${a.can_collide === false ? "false" : "true"} end if ${a.can_touch != null ? "true" : "false"} then inst.CanTouch=${a.can_touch ? "true" : "false"} end if ${a.can_query != null ? "true" : "false"} then inst.CanQuery=${a.can_query ? "true" : "false"} end return ok({path=inst:GetFullName(),canCollide=inst.CanCollide},"collision updated")`
      );
    }
    if (op === "transparency_set") {
      const path = luaStr(a.path || "");
      const tr = Number(a.transparency);
      const v = Number.isFinite(tr) ? tr : 0;
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if inst:IsA("BasePart") or inst:IsA("Decal") or inst:IsA("Texture") or inst:IsA("GuiObject") then inst.Transparency=${v} end return ok({path=inst:GetFullName(),transparency=${v}},"Transparency=${v}")`
      );
    }
    if (op === "humanoid_set") {
      const path = luaStr(a.path || "");
      const ws = a.walk_speed != null ? Number(a.walk_speed) : null;
      const jp = a.jump_power != null ? Number(a.jump_power) : (a.jump_height != null ? null : null);
      const mh = a.max_health != null ? Number(a.max_health) : null;
      const hh = a.hip_height != null ? Number(a.hip_height) : null;
      const lines = [
        `local inst=resolve(${path}) if not inst then return fail("not found") end`,
        `local h=inst:IsA("Humanoid") and inst or inst:FindFirstChildOfClass("Humanoid") if not h then return fail("no Humanoid") end`,
      ];
      if (ws != null && Number.isFinite(ws)) lines.push(`h.WalkSpeed=${ws}`);
      if (a.jump_power != null && Number.isFinite(Number(a.jump_power))) lines.push(`h.JumpPower=${Number(a.jump_power)} h.UseJumpPower=true`);
      if (a.jump_height != null && Number.isFinite(Number(a.jump_height))) lines.push(`h.JumpHeight=${Number(a.jump_height)}`);
      if (mh != null && Number.isFinite(mh)) lines.push(`h.MaxHealth=${mh} h.Health=${mh}`);
      if (hh != null && Number.isFinite(hh)) lines.push(`h.HipHeight=${hh}`);
      lines.push(`return ok({path=h:GetFullName(),walkSpeed=h.WalkSpeed,jumpPower=h.JumpPower},"humanoid updated")`);
      return wrap(lines.join(" "));
    }
    if (op === "lighting_set") {
      const prop = String(a.property || a.name || "").replace(/[^A-Za-z]/g, "") || "ClockTime";
      const val = a.value;
      let rhs;
      if (typeof val === "number") rhs = String(val);
      else if (typeof val === "boolean") rhs = val ? "true" : "false";
      else if (Array.isArray(val) && val.length >= 3) rhs = `Color3.fromRGB(${Number(val[0])||0},${Number(val[1])||0},${Number(val[2])||0})`;
      else rhs = luaStr(val == null ? "" : String(val));
      return wrap(
        `local L=game:GetService("Lighting") L.${prop}=${rhs} return ok({property="${prop}"},"Lighting.${prop} set")`
      );
    }
    if (op === "folder_create") {
      const parent = luaStr(a.parent || a.path || "Workspace");
      const name = luaStr(a.name || "Folder");
      return wrap(
        `local par=resolve(${parent}) or workspace local f=par:FindFirstChild(${name}) if not (f and f:IsA("Folder")) then f=Instance.new("Folder") f.Name=${name} f.Parent=par end return ok({path=f:GetFullName()},"folder "..f:GetFullName())`
      );
    }
    if (op === "value_set") {
      const path = luaStr(a.path || "");
      const v = a.value;
      let rhs;
      if (typeof v === "boolean") rhs = v ? "true" : "false";
      else if (typeof v === "number") rhs = String(v);
      else rhs = luaStr(v == null ? "" : String(v));
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end inst.Value=${rhs} return ok({path=inst:GetFullName(),value=inst.Value},"Value set")`
      );
    }
    if (op === "weld_constraint") {
      const a0 = luaStr(a.part0 || a.path || "");
      const a1 = luaStr(a.part1 || a.other || "");
      return wrap(
        `local p0=resolve(${a0}) local p1=resolve(${a1}) if not (p0 and p0:IsA("BasePart")) then return fail("part0 not a BasePart") end if not (p1 and p1:IsA("BasePart")) then return fail("part1 not a BasePart") end local w=Instance.new("WeldConstraint") w.Part0=p0 w.Part1=p1 w.Parent=p0 return ok({path=w:GetFullName()},"welded "..p0.Name.." + "..p1.Name)`
      );
    }
    if (op === "camera_subject") {
      const path = luaStr(a.path || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local cam=workspace.CurrentCamera if not cam then return fail("no camera") end cam.CameraSubject=inst return ok({path=inst:GetFullName()},"CameraSubject "..inst:GetFullName())`
      );
    }
    if (op === "instance_move") {
      const path = luaStr(a.path || "");
      const pos = num3(a.position || a.pos, [0, 0, 0]);
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end if inst:IsA("BasePart") then inst.Position=Vector3.new(${pos[0]},${pos[1]},${pos[2]}) else inst:PivotTo(CFrame.new(${pos[0]},${pos[1]},${pos[2]})) end return ok({path=inst:GetFullName(),position={${pos[0]},${pos[1]},${pos[2]}}},"moved "..inst:GetFullName())`
      );
    }
    if (op === "tag_remove") {
      const path = luaStr(a.path || "");
      const tag = luaStr(a.tag || a.name || "");
      return wrap(
        `local inst=resolve(${path}) if not inst then return fail("not found") end local cs=game:GetService("CollectionService") cs:RemoveTag(inst,${tag}) return ok({path=inst:GetFullName(),tag=${tag}},"tag removed")`
      );
    }
    return null;
  }

  const DAILY = [
    { name: "part_create", description: "Create a Part (size, position, color, material, anchored). Daily building block.", params: { name: { type: "string", req: false, desc: "Part name" }, size: { type: "array", req: false, desc: "[x,y,z] studs" }, position: { type: "array", req: false, desc: "[x,y,z]" }, color: { type: "array", req: false, desc: "[r,g,b] 0-255" }, material: { type: "string", req: false, desc: "Plastic, SmoothPlastic, Neon, Wood, Metal…" }, parent: { type: "string", req: false, desc: "dotted parent, default Workspace" }, anchored: { type: "boolean", req: false, desc: "default true" } } },
    { name: "model_group", description: "Group instances into a Model and set PrimaryPart.", params: { name: { type: "string", req: false, desc: "Model name" }, paths: { type: "array", req: true, desc: "dotted paths to group" } } },
    { name: "weld_assemble", description: "WeldConstraint every BasePart in a model/part to the first part (keeps it rigid).", params: { path: { type: "string", req: true, desc: "dotted path to Model or Part" } } },
    { name: "tool_create", description: "Create a Tool with a Handle in StarterPack (or parent).", params: { name: { type: "string", req: false, desc: "Tool name" }, parent: { type: "string", req: false, desc: "default StarterPack" } } },
    { name: "dummy_spawn", description: "Spawn a simple Humanoid dummy (HRP + Torso + Head) in Workspace.", params: { name: { type: "string", req: false, desc: "Dummy" }, position: { type: "array", req: false, desc: "[x,y,z]" } } },
    { name: "kill_brick", description: "Make a part kill on touch (or create a red kill brick).", params: { path: { type: "string", req: false, desc: "existing BasePart" }, position: { type: "array", req: false, desc: "if creating" }, size: { type: "array", req: false, desc: "if creating" } } },
    { name: "spawn_location", description: "Create a SpawnLocation.", params: { position: { type: "array", req: false, desc: "[x,y,z]" }, team: { type: "string", req: false, desc: "optional BrickColor name" } } },
    { name: "instance_destroy", description: "Destroy an instance by dotted path.", params: { path: { type: "string", req: true, desc: "dotted path" } } },
    { name: "instance_clone", description: "Clone an instance.", params: { path: { type: "string", req: true, desc: "source path" }, parent: { type: "string", req: false, desc: "dest parent" } } },
    { name: "material_set", description: "Set Material (and optional color) on a part and its descendant parts.", params: { path: { type: "string", req: true, desc: "dotted path" }, material: { type: "string", req: true, desc: "Neon, SmoothPlastic, Wood…" }, color: { type: "array", req: false, desc: "[r,g,b]" } } },
    { name: "click_detector", description: "Add a ClickDetector to a BasePart.", params: { path: { type: "string", req: true, desc: "BasePart path" }, max_distance: { type: "number", req: false, desc: "default 16" } } },
    { name: "billboard", description: "Add an always-on-top BillboardGui label above a part.", params: { path: { type: "string", req: true, desc: "part path" }, text: { type: "string", req: false, desc: "label" } } },
    { name: "attribute_set", description: "Set an Attribute on an instance.", params: { path: { type: "string", req: true, desc: "dotted path" }, key: { type: "string", req: true, desc: "attribute name" }, value: { type: "string", req: false, desc: "string/number/bool" } } },
    { name: "tag_add", description: "CollectionService:AddTag.", params: { path: { type: "string", req: true, desc: "dotted path" }, tag: { type: "string", req: true, desc: "tag name" } } },
    { name: "selection_info", description: "List the current Studio Selection.", params: {} },
    { name: "sky_set", description: "Quick sky/ambient: day, night, sunset, space.", params: { preset: { type: "string", req: false, desc: "day, night, sunset, space" } } },
    { name: "health_pack", description: "Create a pickup that heals, then destroys itself.", params: { position: { type: "array", req: false, desc: "[x,y,z]" }, heal: { type: "number", req: false, desc: "default 50" } } },
    { name: "sprint_setup", description: "LocalScript: hold LeftShift to sprint.", params: { walk_speed: { type: "number", req: false, desc: "default 16" }, sprint_speed: { type: "number", req: false, desc: "default 24" } } },
    { name: "seat_create", description: "Create a Seat or VehicleSeat.", params: { position: { type: "array", req: false, desc: "[x,y,z]" }, vehicle: { type: "boolean", req: false, desc: "VehicleSeat if true" } } },
    { name: "workspace_list", description: "List children of a path (default Workspace).", params: { path: { type: "string", req: false, desc: "dotted path" }, limit: { type: "number", req: false, desc: "max items, default 40" } } },
    { name: "instance_rename", description: "Rename an instance. Path is dotted from game (e.g. Workspace.Part).", params: { path: { type: "string", req: true }, name: { type: "string", req: true } } },
    { name: "instance_reparent", description: "Move an instance to a new parent.", params: { path: { type: "string", req: true }, parent: { type: "string", req: true } } },
    { name: "selection_set", description: "Set Studio Selection to the given instance paths.", params: { paths: { type: "array", req: false, desc: "dotted paths" }, path: { type: "string", req: false } } },
    { name: "script_append", description: "Append source to a Script/LocalScript/ModuleScript (does not overwrite).", params: { path: { type: "string", req: true }, source: { type: "string", req: true } } },
    { name: "camera_look_at", description: "Point the Studio camera at an instance (edit-mode viewport).", params: { path: { type: "string", req: true }, distance: { type: "number", req: false } } },
    { name: "attribute_get", description: "Read one Attribute from an instance.", params: { path: { type: "string", req: true }, key: { type: "string", req: true } } },
    { name: "pivot_set", description: "Set an instance pivot world position [x,y,z].", params: { path: { type: "string", req: true }, position: { type: "array", req: true, desc: "[x,y,z]" } } },
    { name: "highlight_add", description: "Add/update a Highlight on an instance so you can see it in the viewport.", params: { path: { type: "string", req: true }, color: { type: "array", req: false, desc: "[r,g,b] 0-1" } } },
    { name: "script_set_source", description: "Overwrite a Script/LocalScript/ModuleScript Source.", params: { path: { type: "string", req: true }, source: { type: "string", req: true } } },
    { name: "script_list", description: "List LuaSourceContainer scripts under a path (default whole game, capped).", params: { path: { type: "string", req: false }, limit: { type: "number", req: false } } },
    { name: "script_disable", description: "Set Script.Disabled (true to disable).", params: { path: { type: "string", req: true }, disabled: { type: "boolean", req: false } } },
    { name: "sound_play", description: "Play a Sound on an instance (or a child Sound).", params: { path: { type: "string", req: true } } },
    { name: "anchored_set", description: "Set BasePart.Anchored.", params: { path: { type: "string", req: true }, anchored: { type: "boolean", req: false } } },
    { name: "collision_set", description: "Set CanCollide / CanTouch / CanQuery on a BasePart.", params: { path: { type: "string", req: true }, can_collide: { type: "boolean", req: false }, can_touch: { type: "boolean", req: false }, can_query: { type: "boolean", req: false } } },
    { name: "transparency_set", description: "Set Transparency on a part, decal, texture, or GuiObject (0-1).", params: { path: { type: "string", req: true }, transparency: { type: "number", req: true } } },
    { name: "humanoid_set", description: "Set WalkSpeed / JumpPower / MaxHealth / HipHeight on a Humanoid.", params: { path: { type: "string", req: true }, walk_speed: { type: "number", req: false }, jump_power: { type: "number", req: false }, max_health: { type: "number", req: false }, hip_height: { type: "number", req: false } } },
    { name: "lighting_set", description: "Set one Lighting property (ClockTime, Brightness, FogEnd, Ambient as [r,g,b] 0-255).", params: { property: { type: "string", req: true }, value: { type: "string", req: true } } },
    { name: "folder_create", description: "Create a Folder under a parent path.", params: { parent: { type: "string", req: false }, name: { type: "string", req: true } } },
    { name: "value_set", description: "Set .Value on a ValueBase (String/Int/Number/BoolValue).", params: { path: { type: "string", req: true }, value: { type: "string", req: true } } },
    { name: "weld_constraint", description: "WeldConstraint two BaseParts together.", params: { part0: { type: "string", req: true }, part1: { type: "string", req: true } } },
    { name: "camera_subject", description: "Set Workspace.CurrentCamera.CameraSubject.", params: { path: { type: "string", req: true } } },
    { name: "instance_move", description: "Move a part/model to world position [x,y,z].", params: { path: { type: "string", req: true }, position: { type: "array", req: true, desc: "[x,y,z]" } } },
    { name: "tag_remove", description: "Remove a CollectionService tag from an instance.", params: { path: { type: "string", req: true }, tag: { type: "string", req: true } } },
  ];

  const orig = RobloxScriptSkills.buildLuau;
  RobloxScriptSkills.buildLuau = function (op, args) {
    const extra = buildDaily(op, args);
    if (extra) return extra;
    return orig(op, args);
  };
  for (const c of DAILY) RobloxScriptSkills.SKILL_COMMANDS.push(c);
  RobloxScriptSkills.SKILL_OPS = RobloxScriptSkills.SKILL_COMMANDS.map(function (c) { return c.name; });
})();
