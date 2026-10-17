// Extra Roblox Studio GUI commands: change images, textures, text, colors, layout — everything.
// Patches RobloxScriptSkills after studio_skills.js / studio_daily.js load.
(function () {
  if (typeof RobloxScriptSkills === "undefined") return;

  function luaStr(s) {
    return '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ") + '"';
  }
  function argsLua(a) {
    return "local a=HttpService:JSONDecode(" + luaStr(JSON.stringify(a == null ? {} : a)) + ")\n";
  }

  const HEAD = [
    'local HttpService=game:GetService("HttpService")',
    'local StarterGui=game:GetService("StarterGui")',
    "local function resolve(p) if not p or p=='' then return nil end p=tostring(p) if p=='game' then return game end if p:sub(1,5)=='game.' then p=p:sub(6) end local n=game for _,s in ipairs(string.split(p,'.')) do if s~='' then local nxt=n:FindFirstChild(s) if not nxt and n==game then local ok,svc=pcall(function() return game:GetService(s) end) if ok then nxt=svc end end if not nxt then return nil end n=nxt end end return n end",
    "local function ok(d,t) return HttpService:JSONEncode({ok=true,data=d,text=t or ''}) end",
    "local function fail(m) return HttpService:JSONEncode({ok=false,error=m}) end",
    "local function rgb(v,d) if type(v)=='table' then return Color3.fromRGB(tonumber(v[1]) or 0,tonumber(v[2]) or 0,tonumber(v[3]) or 0) end return d or Color3.new(1,1,1) end",
    "local function udim2(v,d) if type(v)=='table' then if #v>=4 then return UDim2.new(tonumber(v[1]) or 0,tonumber(v[2]) or 0,tonumber(v[3]) or 0,tonumber(v[4]) or 0) elseif #v>=2 then return UDim2.new(tonumber(v[1]) or 0,0,tonumber(v[2]) or 0,0) end end return d or UDim2.new(0,100,0,100) end",
    "local BUILTIN={panel='rbxasset://textures/ui/dialog_white.png',button='rbxasset://textures/ui/btn_newWhite.png',circle='rbxasset://textures/ui/LuaApp/graphic/gr-circle.png',placeholder='rbxasset://textures/ui/GuiImagePlaceholder.png',gradient='rbxasset://textures/ui/dialog_white.png',icon='rbxasset://textures/ui/TopBar/inventoryOff.png',close='rbxasset://textures/ui/Settings/CloseButton.png',shadow='rbxasset://textures/ui/dialog_white.png'} local function asset(s) if s==nil then return '' end s=tostring(s) local low=string.lower(s) if BUILTIN[low] then return BUILTIN[low] end if s:match('^%d+$') then return 'rbxassetid://'..s end local n=tonumber(s) if n then return 'rbxassetid://'..tostring(math.floor(n)) end return s end",
    "local function ensureChild(inst, className, name) local x=name and inst:FindFirstChild(name) if x and x:IsA(className) then return x end x=Instance.new(className) if name then x.Name=name end x.Parent=inst return x end",
    [
      "local function applyProp(inst,key,val)",
      " if val==nil then return end",
      " if key=='Parent' then local p=resolve(tostring(val)) if p then inst.Parent=p end return end",
      " if type(val)=='table' then",
      "  local n=#val",
      "  if n==3 then pcall(function() inst[key]=rgb(val) end) return end",
      "  if n>=4 then pcall(function() inst[key]=udim2(val) end) return end",
      "  if n==2 then pcall(function() if key=='AnchorPoint' or key=='ImageRectOffset' or key=='ImageRectSize' then inst[key]=Vector2.new(tonumber(val[1]) or 0,tonumber(val[2]) or 0) else inst[key]=UDim.new(tonumber(val[1]) or 0,tonumber(val[2]) or 0) end end) return end",
      " end",
      " if type(val)=='string' then",
      "  if val:sub(1,5)=='Enum.' then local parts=string.split(val,'.') pcall(function() inst[key]=Enum[parts[2]][parts[3]] end) return end",
      "  if key=='Font' then pcall(function() inst.Font=Enum.Font[val] end) return end",
      "  if key=='ScaleType' then pcall(function() inst.ScaleType=Enum.ScaleType[val] end) return end",
      "  if key=='Image' or key=='Texture' or key=='TextureId' or key=='TextureID' then pcall(function() inst[key]=asset(val) end) return end",
      " end",
      " pcall(function() inst[key]=val end)",
      "end",
    ].join("\n"),
    [
      "local function asImageHost(inst)",
      " if inst:IsA('ImageLabel') or inst:IsA('ImageButton') then return inst end",
      " if inst:IsA('Decal') or inst:IsA('Texture') then return inst end",
      " if inst:IsA('MeshPart') then return inst end",
      " local lab=inst:FindFirstChild('SYNERIXCODE_Image')",
      " if not (lab and (lab:IsA('ImageLabel') or lab:IsA('ImageButton'))) then",
      "  lab=Instance.new('ImageLabel') lab.Name='SYNERIXCODE_Image' lab.BackgroundTransparency=1 lab.Size=UDim2.new(1,0,1,0) lab.ZIndex=(inst:IsA('GuiObject') and inst.ZIndex or 1) lab.Parent=inst",
      " end",
      " return lab",
      "end",
    ].join("\n"),
  ].join("\n");

  function wrap(body) {
    return { code: HEAD + "\n" + body };
  }
  function need(a, k) {
    if (a[k] === undefined || a[k] === null || a[k] === "") return { err: "ERROR: missing required param '" + k + "'" };
    return null;
  }

  function buildGui(op, a) {
    a = a || {};
    if (op === "ui_build") {
      return wrap(argsLua(a) + [
        "local sgName=tostring(a.screen or a.name or 'SYNERIXCODE_UI')",
        "local sg=StarterGui:FindFirstChild(sgName)",
        "if not sg then sg=Instance.new('ScreenGui') sg.Name=sgName sg.ResetOnSpawn=false sg.IgnoreGuiInset=true sg.ZIndexBehavior=Enum.ZIndexBehavior.Sibling sg.Parent=StarterGui end",
        "local widgets=a.widgets or a.elements",
        "if type(widgets)~='table' then widgets={} end",
        "local created={}",
        "local function make(w)",
        " if type(w)~='table' then return end",
        " local className=tostring(w.class_name or w.class or 'Frame')",
        " local allowed={Frame=true,TextLabel=true,TextButton=true,ImageLabel=true,ImageButton=true,ScrollingFrame=true,ViewportFrame=true,TextBox=true,CanvasGroup=true}",
        " if not allowed[className] then className='Frame' end",
        " local par=sg",
        " if w.parent and tostring(w.parent)~='' then par=resolve(tostring(w.parent)) or sg:FindFirstChild(tostring(w.parent), true) or sg end",
        " local inst=Instance.new(className) inst.Name=tostring(w.name or className)",
        " if inst:IsA('GuiObject') then inst.Size=udim2(w.size or {0,160,0,40}) inst.Position=udim2(w.position or {0,0,0,0}) if w.anchor then inst.AnchorPoint=Vector2.new(tonumber(w.anchor[1]) or 0, tonumber(w.anchor[2]) or 0) end if w.background then inst.BackgroundColor3=rgb(w.background) elseif className=='ImageLabel' or className=='ImageButton' then inst.BackgroundTransparency=1 end if w.background_transparency~=nil then inst.BackgroundTransparency=tonumber(w.background_transparency) or 0 end if w.z_index then inst.ZIndex=tonumber(w.z_index) or 1 end end",
        " if (inst:IsA('TextLabel') or inst:IsA('TextButton') or inst:IsA('TextBox')) then inst.Text=tostring(w.text or inst.Name) inst.TextScaled=(w.text_scaled~=false) if w.text_color then inst.TextColor3=rgb(w.text_color) end if w.font then pcall(function() inst.Font=Enum.Font[tostring(w.font)] end) end inst.RichText=w.rich_text==true end",
        " if (inst:IsA('ImageLabel') or inst:IsA('ImageButton')) then local img=asset(w.image or w.texture or '') if img~='' then inst.Image=img end if w.image_color then inst.ImageColor3=rgb(w.image_color) end if w.scale_type then pcall(function() inst.ScaleType=Enum.ScaleType[tostring(w.scale_type)] end) end if w.slice then local s=w.slice inst.ScaleType=Enum.ScaleType.Slice inst.SliceCenter=Rect.new(tonumber(s[1]) or 0,tonumber(s[2]) or 0,tonumber(s[3]) or 0,tonumber(s[4]) or 0) end end",
        " inst.Parent=par",
        " if w.corner~=nil then local c=Instance.new('UICorner') c.CornerRadius=UDim.new(0,tonumber(w.corner) or 8) c.Parent=inst end",
        " if w.stroke then local s=Instance.new('UIStroke') s.Color=rgb(w.stroke) s.Thickness=tonumber(w.stroke_thickness) or 1 s.Parent=inst end",
        " if type(w.properties)=='table' then for k,v in pairs(w.properties) do applyProp(inst,tostring(k),v) end end",
        " created[#created+1]=inst:GetFullName()",
        "end",
        "if #widgets==0 then",
        " make({class_name='ImageLabel',name='Panel',image='panel',size={0,360,0,220},position={0.5,-180,0.5,-110},background={20,20,24},corner=10,stroke={255,255,255}})",
        " make({class_name='TextLabel',name='Title',parent='StarterGui.'..sgName..'.Panel',text=tostring(a.title or 'synerixcode UI'),size={1,-24,0,36},position={0,12,0,10},background_transparency=1,text_color={235,235,240},font='GothamBold'})",
        " make({class_name='ImageButton',name='Close',parent='StarterGui.'..sgName..'.Panel',image='close',size={0,28,0,28},position={1,-40,0,10},corner=6})",
        "else for _,w in ipairs(widgets) do make(w) end end",
        "return ok({path=sg:GetFullName(),count=#created,items=created},'built '..sg:GetFullName()..' with '..tostring(#created)..' widget(s) — textures applied')",
      ].join("\n"));
    }
    if (op === "ui_set_image") {
      const m = need(a, "path") || need(a, "image");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local host=asImageHost(inst) local img=asset(a.image or a.texture or a.texture_id)",
        "if host:IsA('ImageLabel') or host:IsA('ImageButton') then host.Image=img",
        "elseif host:IsA('Decal') or host:IsA('Texture') then host.Texture=img",
        "elseif host:IsA('MeshPart') then host.TextureID=img end",
        "if a.scale_type then pcall(function() host.ScaleType=Enum.ScaleType[tostring(a.scale_type)] end) end",
        "if a.image_color then pcall(function() host.ImageColor3=rgb(a.image_color) end) end",
        "if a.image_transparency~=nil then pcall(function() host.ImageTransparency=tonumber(a.image_transparency) or 0 end) end",
        "if a.slice then local s=a.slice pcall(function() host.ScaleType=Enum.ScaleType.Slice host.SliceCenter=Rect.new(tonumber(s[1]) or 0,tonumber(s[2]) or 0,tonumber(s[3]) or 0,tonumber(s[4]) or 0) end) end",
        "if a.resample then pcall(function() host.ResampleMode=Enum.ResamplerMode[tostring(a.resample)] end) end",
        "return ok({path=host:GetFullName(),image=img,className=host.ClassName},'set image on '..host:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_texture") {
      const m = need(a, "path") || need(a, "texture");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local tex=asset(a.texture or a.image or a.texture_id) local n=0",
        "local function paint(x)",
        " if x:IsA('ImageLabel') or x:IsA('ImageButton') then x.Image=tex n=n+1 if a.image_color then pcall(function() x.ImageColor3=rgb(a.image_color) end) end",
        " elseif x:IsA('Decal') or x:IsA('Texture') then x.Texture=tex n=n+1",
        " elseif x:IsA('MeshPart') then x.TextureID=tex n=n+1",
        " elseif x:IsA('SpecialMesh') then x.TextureId=tex n=n+1 end",
        " if a.descendants~=false then for _,c in ipairs(x:GetChildren()) do paint(c) end end",
        "end",
        "paint(inst)",
        "if n==0 then local host=asImageHost(inst) if host:IsA('ImageLabel') or host:IsA('ImageButton') then host.Image=tex n=1 elseif host:IsA('Decal') or host:IsA('Texture') then host.Texture=tex n=1 elseif host:IsA('MeshPart') then host.TextureID=tex n=1 end end",
        "return ok({path=inst:GetFullName(),texture=tex,count=n},'set texture on '..tostring(n)..' instance(s)')",
      ].join("\n"));
    }
    if (op === "ui_set_text") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not (inst:IsA('TextLabel') or inst:IsA('TextButton') or inst:IsA('TextBox')) then",
        " local t=inst:FindFirstChildWhichIsA('TextLabel') or inst:FindFirstChildWhichIsA('TextButton')",
        " if not t then t=Instance.new('TextLabel') t.Name='SYNERIXCODE_Text' t.BackgroundTransparency=1 t.Size=UDim2.new(1,0,1,0) t.Parent=inst end",
        " inst=t",
        "end",
        "if a.text~=nil then inst.Text=tostring(a.text) end",
        "if a.rich_text~=nil then inst.RichText=a.rich_text==true end",
        "if a.text_color then inst.TextColor3=rgb(a.text_color) end",
        "if a.text_size then inst.TextSize=tonumber(a.text_size) or 14 end",
        "if a.text_scaled~=nil then inst.TextScaled=a.text_scaled==true end",
        "if a.font then pcall(function() inst.Font=Enum.Font[tostring(a.font)] end) end",
        "if a.stroke_color then inst.TextStrokeColor3=rgb(a.stroke_color) inst.TextStrokeTransparency=tonumber(a.stroke_transparency) or 0 end",
        "if a.x_align then pcall(function() inst.TextXAlignment=Enum.TextXAlignment[tostring(a.x_align)] end) end",
        "if a.y_align then pcall(function() inst.TextYAlignment=Enum.TextYAlignment[tostring(a.y_align)] end) end",
        "return ok({path=inst:GetFullName(),text=inst.Text},'set text on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_color") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if inst:IsA('GuiObject') then",
        " if a.background then inst.BackgroundColor3=rgb(a.background) end",
        " if a.background_transparency~=nil then inst.BackgroundTransparency=tonumber(a.background_transparency) or 0 end",
        " if a.border then inst.BorderColor3=rgb(a.border) end",
        " if a.border_size~=nil then inst.BorderSizePixel=tonumber(a.border_size) or 0 end",
        "end",
        "if inst:IsA('BasePart') and a.background then inst.Color=rgb(a.background) end",
        "return ok({path=inst:GetFullName()},'set color on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_size") {
      const m = need(a, "path") || need(a, "size");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if inst:IsA('GuiObject') then inst.Size=udim2(a.size) else return fail('not a GuiObject') end",
        "return ok({path=inst:GetFullName()},'set size on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_position") {
      const m = need(a, "path") || need(a, "position");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "inst.Position=udim2(a.position)",
        "if a.anchor then inst.AnchorPoint=Vector2.new(tonumber(a.anchor[1]) or 0, tonumber(a.anchor[2]) or 0) end",
        "if a.z_index~=nil then inst.ZIndex=tonumber(a.z_index) or 1 end",
        "return ok({path=inst:GetFullName()},'set position on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_font") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local n=0 local function paint(x) if x:IsA('TextLabel') or x:IsA('TextButton') or x:IsA('TextBox') then if a.font then pcall(function() x.Font=Enum.Font[tostring(a.font)] end) end if a.text_size then x.TextSize=tonumber(a.text_size) or 14 end if a.text_scaled~=nil then x.TextScaled=a.text_scaled==true end n=n+1 end if a.descendants~=false then for _,c in ipairs(x:GetChildren()) do paint(c) end end end",
        "paint(inst) return ok({count=n},'set font on '..tostring(n)..' text widget(s)')",
      ].join("\n"));
    }
    if (op === "ui_set_corner") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "local c=inst:FindFirstChildOfClass('UICorner') or Instance.new('UICorner')",
        "c.CornerRadius=UDim.new(tonumber(a.scale) or 0, tonumber(a.radius) or tonumber(a.pixels) or 8) c.Parent=inst",
        "return ok({path=inst:GetFullName(),radius=c.CornerRadius.Offset},'set UICorner on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_stroke") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "local s=inst:FindFirstChildOfClass('UIStroke') or Instance.new('UIStroke')",
        "if a.color then s.Color=rgb(a.color) end",
        "s.Thickness=tonumber(a.thickness) or 1",
        "if a.transparency~=nil then s.Transparency=tonumber(a.transparency) or 0 end",
        "if a.stroke_mode then pcall(function() s.ApplyStrokeMode=Enum.ApplyStrokeMode[tostring(a.stroke_mode)] end) end",
        "s.Parent=inst",
        "return ok({path=inst:GetFullName()},'set UIStroke on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_gradient") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "local g=inst:FindFirstChildOfClass('UIGradient') or Instance.new('UIGradient')",
        "local c0=rgb(a.color0 or a.from, Color3.fromRGB(255,255,255))",
        "local c1=rgb(a.color1 or a.to, Color3.fromRGB(180,180,190))",
        "g.Color=ColorSequence.new(c0,c1)",
        "g.Rotation=tonumber(a.rotation) or 90",
        "if a.transparency0~=nil or a.transparency1~=nil then g.Transparency=NumberSequence.new(tonumber(a.transparency0) or 0, tonumber(a.transparency1) or 0) end",
        "g.Parent=inst",
        "return ok({path=inst:GetFullName()},'set UIGradient on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_padding") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "local p=inst:FindFirstChildOfClass('UIPadding') or Instance.new('UIPadding')",
        "local n=tonumber(a.pixels) or tonumber(a.padding) or 8",
        "local l=tonumber(a.left) or n local r=tonumber(a.right) or n local t=tonumber(a.top) or n local b=tonumber(a.bottom) or n",
        "p.PaddingLeft=UDim.new(0,l) p.PaddingRight=UDim.new(0,r) p.PaddingTop=UDim.new(0,t) p.PaddingBottom=UDim.new(0,b) p.Parent=inst",
        "return ok({path=inst:GetFullName(),left=l,right=r,top=t,bottom=b},'set UIPadding on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_layout") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "local kind=string.lower(tostring(a.layout or 'list'))",
        "for _,c in ipairs(inst:GetChildren()) do if c:IsA('UIListLayout') or c:IsA('UIGridLayout') or c:IsA('UIPageLayout') or c:IsA('UITableLayout') then c:Destroy() end end",
        "local lay",
        "if kind=='grid' then lay=Instance.new('UIGridLayout') lay.CellSize=udim2(a.cell_size or {0,72,0,72}) lay.CellPadding=udim2(a.cell_padding or {0,6,0,6}) lay.FillDirectionMaxCells=tonumber(a.columns) or 4",
        "elseif kind=='page' then lay=Instance.new('UIPageLayout')",
        "else lay=Instance.new('UIListLayout') lay.Padding=UDim.new(0, tonumber(a.padding) or 6) end",
        "if a.fill then pcall(function() lay.FillDirection=Enum.FillDirection[tostring(a.fill)] end) end",
        "if a.h_align then pcall(function() lay.HorizontalAlignment=Enum.HorizontalAlignment[tostring(a.h_align)] end) end",
        "if a.v_align then pcall(function() lay.VerticalAlignment=Enum.VerticalAlignment[tostring(a.v_align)] end) end",
        "if a.sort then pcall(function() lay.SortOrder=Enum.SortOrder[tostring(a.sort)] end) end",
        "lay.Parent=inst",
        "return ok({path=inst:GetFullName(),layout=lay.ClassName},'set '..lay.ClassName..' on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_visible") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if inst:IsA('GuiObject') or inst:IsA('LayerCollector') then",
        " if a.visible~=nil then inst.Visible=a.visible==true end",
        " if inst:IsA('GuiObject') then if a.active~=nil then inst.Active=a.active==true end if a.z_index~=nil then inst.ZIndex=tonumber(a.z_index) or 1 end end",
        " if inst:IsA('LayerCollector') and a.display_order~=nil then inst.DisplayOrder=tonumber(a.display_order) or 1 end",
        "end",
        "return ok({path=inst:GetFullName()},'set visible on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_property") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local props=a.properties if type(props)~='table' then props={} end",
        "if a.property then props[tostring(a.property)]=a.value end",
        "local n=0 for k,v in pairs(props) do applyProp(inst,tostring(k),v) n=n+1 end",
        "return ok({path=inst:GetFullName(),count=n},'set '..tostring(n)..' propertie(s) on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_paint") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local root=resolve(tostring(a.path or '')) if not root then return fail('not found: '..tostring(a.path)) end",
        "local n=0",
        "local function paint(g)",
        " n=n+1",
        " if g:IsA('GuiObject') then",
        "  if (g:IsA('Frame') or g:IsA('ScrollingFrame')) and a.background then g.BackgroundColor3=rgb(a.background) end",
        "  if (g:IsA('TextLabel') or g:IsA('TextButton') or g:IsA('TextBox')) then",
        "   if a.text then g.TextColor3=rgb(a.text) end",
        "   if a.font then pcall(function() g.Font=Enum.Font[tostring(a.font)] end) end",
        "   if a.text_size then g.TextSize=tonumber(a.text_size) or 14 end",
        "  end",
        "  if (g:IsA('ImageLabel') or g:IsA('ImageButton')) then",
        "   if a.image then g.Image=asset(a.image) end",
        "   if a.image_color then g.ImageColor3=rgb(a.image_color) end",
        "  end",
        "  if a.corner~=nil then local c=g:FindFirstChildOfClass('UICorner') or Instance.new('UICorner') c.CornerRadius=UDim.new(0,tonumber(a.corner) or 8) c.Parent=g end",
        "  if a.stroke then local s=g:FindFirstChildOfClass('UIStroke') or Instance.new('UIStroke') s.Color=rgb(a.stroke) s.Thickness=tonumber(a.stroke_thickness) or 1 s.Parent=g end",
        "  if a.accent and (g:IsA('TextButton') or g:IsA('ImageButton')) then g.BackgroundColor3=rgb(a.accent) end",
        " end",
        " for _,c in ipairs(g:GetChildren()) do paint(c) end",
        "end",
        "paint(root)",
        "return ok({path=root:GetFullName(),count=n},'painted '..tostring(n)..' instance(s) under '..root:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_add_element") {
      const m = need(a, "parent") || need(a, "class_name");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local par=resolve(tostring(a.parent or a.parent_path or '')) if not par then return fail('parent not found') end",
        "local className=tostring(a.class_name or a.class or 'Frame')",
        "local allowed={Frame=true,TextLabel=true,TextButton=true,ImageLabel=true,ImageButton=true,ScrollingFrame=true,ViewportFrame=true,TextBox=true,VideoFrame=true,CanvasGroup=true}",
        "if not allowed[className] then return fail('unsupported class '..className) end",
        "local inst=Instance.new(className) inst.Name=tostring(a.name or className)",
        "if inst:IsA('GuiObject') then",
        " inst.Size=udim2(a.size or {0,120,0,36})",
        " inst.Position=udim2(a.position or {0,0,0,0})",
        " if a.background then inst.BackgroundColor3=rgb(a.background) end",
        "end",
        "if (inst:IsA('TextLabel') or inst:IsA('TextButton') or inst:IsA('TextBox')) and a.text then inst.Text=tostring(a.text) inst.TextScaled=true end",
        "if (inst:IsA('ImageLabel') or inst:IsA('ImageButton')) and (a.image or a.texture) then inst.Image=asset(a.image or a.texture) inst.BackgroundTransparency=1 end",
        "inst.Parent=par",
        "if type(a.properties)=='table' then for k,v in pairs(a.properties) do applyProp(inst,tostring(k),v) end end",
        "return ok({path=inst:GetFullName(),className=className},'created '..className..' '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_scale") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('not a GuiObject') end",
        "local s=inst:FindFirstChildOfClass('UIScale') or Instance.new('UIScale')",
        "s.Scale=tonumber(a.scale) or 1 s.Parent=inst",
        "return ok({path=inst:GetFullName(),scale=s.Scale},'set UIScale on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_list_tree") {
      return wrap(argsLua(a) + [
        "local root=resolve(tostring(a.path or a.screen_name or '')) or StarterGui",
        "local limit=math.clamp(tonumber(a.limit) or 80, 1, 200) local items={} local n=0",
        "local function walk(x,depth)",
        " if n>=limit then return end n=n+1",
        " local row={name=x.Name,className=x.ClassName,path=x:GetFullName(),depth=depth}",
        " if x:IsA('ImageLabel') or x:IsA('ImageButton') then row.image=x.Image row.imageColor={math.floor(x.ImageColor3.R*255+0.5),math.floor(x.ImageColor3.G*255+0.5),math.floor(x.ImageColor3.B*255+0.5)} end",
        " if x:IsA('TextLabel') or x:IsA('TextButton') or x:IsA('TextBox') then row.text=x.Text row.font=tostring(x.Font) end",
        " if x:IsA('GuiObject') then row.visible=x.Visible row.size={x.Size.X.Scale,x.Size.X.Offset,x.Size.Y.Scale,x.Size.Y.Offset} row.bg={math.floor(x.BackgroundColor3.R*255+0.5),math.floor(x.BackgroundColor3.G*255+0.5),math.floor(x.BackgroundColor3.B*255+0.5)} end",
        " if x:IsA('Decal') or x:IsA('Texture') then row.texture=x.Texture end",
        " if x:IsA('MeshPart') then row.texture=x.TextureID end",
        " items[#items+1]=row",
        " for _,c in ipairs(x:GetChildren()) do walk(c,depth+1) end",
        "end",
        "walk(root,0)",
        "return ok({path=root:GetFullName(),items=items,count=#items},'listed '..tostring(#items)..' GUI instance(s) under '..root:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_apply_theme") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local root=resolve(tostring(a.path or '')) if not root then return fail('not found: '..tostring(a.path)) end",
        "local themes={",
        " dark={bg={18,18,22},panel={28,28,34},text={235,235,240},accent={88,166,255},stroke={255,255,255},corner=8,font='GothamMedium'},",
        " light={bg={244,244,248},panel={255,255,255},text={20,20,24},accent={0,120,215},stroke={0,0,0},corner=8,font='Gotham'},",
        " gold={bg={18,16,12},panel={36,30,20},text={240,220,170},accent={212,175,55},stroke={212,175,55},corner=6,font='GothamBold'},",
        " sakura={bg={28,18,24},panel={48,28,40},text={255,230,240},accent={255,140,180},stroke={255,180,200},corner=10,font='GothamMedium'},",
        " night={bg={8,10,18},panel={16,20,32},text={210,220,240},accent={120,160,255},stroke={80,100,160},corner=6,font='Gotham'},",
        " horror={bg={10,8,8},panel={22,14,14},text={230,210,210},accent={170,20,20},stroke={80,10,10},corner=2,font='GothamBold'},",
        " neon={bg={8,8,14},panel={12,12,22},text={220,255,250},accent={0,255,200},stroke={0,220,255},corner=4,font='GothamBlack'},",
        " stud={bg={31,31,31},panel={163,162,165},text={255,255,255},accent={0,162,255},stroke={0,0,0},corner=0,font='Legacy'}",
        "}",
        "local th=themes[string.lower(tostring(a.theme or 'dark'))] or themes.dark",
        "local n=0",
        "local function paint(g)",
        " n=n+1",
        " if g:IsA('GuiObject') then",
        "  if g:IsA('Frame') or g:IsA('ScrollingFrame') then g.BackgroundColor3=rgb(th.panel) end",
        "  if g:IsA('TextLabel') or g:IsA('TextButton') or g:IsA('TextBox') then g.TextColor3=rgb(th.text) pcall(function() g.Font=Enum.Font[th.font] end) end",
        "  if g:IsA('TextButton') or g:IsA('ImageButton') then g.BackgroundColor3=rgb(th.accent) end",
        "  local c=g:FindFirstChildOfClass('UICorner') or Instance.new('UICorner') c.CornerRadius=UDim.new(0,th.corner) c.Parent=g",
        "  local s=g:FindFirstChildOfClass('UIStroke') or Instance.new('UIStroke') s.Color=rgb(th.stroke) s.Thickness=1 s.Transparency=0.7 s.Parent=g",
        "  if a.image and (g:IsA('ImageLabel') or g:IsA('ImageButton')) then g.Image=asset(a.image) end",
        " end",
        " for _,ch in ipairs(g:GetChildren()) do paint(ch) end",
        "end",
        "paint(root)",
        "return ok({path=root:GetFullName(),theme=a.theme or 'dark',count=n},'applied theme '..tostring(a.theme or 'dark')..' to '..tostring(n)..' instance(s)')",
      ].join("\n"));
    }
    if (op === "ui_set_slice") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local host=asImageHost(inst)",
        "if not (host:IsA('ImageLabel') or host:IsA('ImageButton')) then return fail('not an ImageLabel/ImageButton') end",
        "host.ScaleType=Enum.ScaleType.Slice",
        "local s=a.slice or a.center or {12,12,12,12}",
        "host.SliceCenter=Rect.new(tonumber(s[1]) or 0,tonumber(s[2]) or 0,tonumber(s[3]) or 0,tonumber(s[4]) or 0)",
        "if a.slice_scale then host.SliceScale=tonumber(a.slice_scale) or 1 end",
        "if a.image then host.Image=asset(a.image) end",
        "return ok({path=host:GetFullName()},'set 9-slice on '..host:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_bind_button") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not (inst:IsA('GuiButton') or inst:IsA('TextButton') or inst:IsA('ImageButton')) then return fail('not a button') end",
        "local action=tostring(a.action or 'print')",
        "local old=inst:FindFirstChild('SYNERIXCODE_Click') if old then old:Destroy() end",
        "local ls=Instance.new('LocalScript') ls.Name='SYNERIXCODE_Click' ls.Parent=inst",
        "local src='local b=script.Parent b.MouseButton1Click:Connect(function() '",
        "if action=='destroy_parent' then src=src..'if b.Parent then b.Parent:Destroy() end'",
        "elseif action=='toggle_parent' then src=src..'local p=b.Parent if p and p:IsA(\"GuiObject\") then p.Visible=not p.Visible end'",
        "elseif action=='print' then src=src..'print(\"clicked\", b:GetFullName())'",
        "else src=src..tostring(a.source or 'print(\"clicked\")') end",
        "src=src..' end)'",
        "ls.Source=src",
        "return ok({path=inst:GetFullName(),action=action},'bound click on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "decal_set") {
      const m = need(a, "path") || need(a, "texture");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('BasePart') then return fail('decal_set needs a BasePart') end",
        "local face=tostring(a.face or 'Front')",
        "local d",
        "for _,c in ipairs(inst:GetChildren()) do if c:IsA('Decal') and tostring(c.Face)==face then d=c break end end",
        "if not d then d=Instance.new('Decal') pcall(function() d.Face=Enum.NormalId[face] end) d.Parent=inst end",
        "d.Texture=asset(a.texture) if a.transparency~=nil then d.Transparency=tonumber(a.transparency) or 0 end",
        "if a.color then d.Color3=rgb(a.color) end",
        "return ok({path=d:GetFullName(),texture=d.Texture},'set Decal on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "mesh_set_texture") {
      const m = need(a, "path") || need(a, "texture");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local tex=asset(a.texture)",
        "if inst:IsA('MeshPart') then inst.TextureID=tex",
        "elseif inst:IsA('SpecialMesh') then inst.TextureId=tex",
        "else local sm=inst:FindFirstChildOfClass('SpecialMesh') if not sm then sm=Instance.new('SpecialMesh') sm.Parent=inst end sm.TextureId=tex end",
        "return ok({path=inst:GetFullName(),texture=tex},'set mesh texture on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "surface_gui_create") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('BasePart') then return fail('surface_gui_create needs a BasePart') end",
        "local sg=inst:FindFirstChild('SYNERIXCODE_Surface') if not (sg and sg:IsA('SurfaceGui')) then sg=Instance.new('SurfaceGui') sg.Name='SYNERIXCODE_Surface' sg.Parent=inst end",
        "sg.Face=Enum.NormalId[tostring(a.face or 'Front')] or Enum.NormalId.Front",
        "sg.SizingMode=Enum.SurfaceGuiSizingMode.PixelsPerStud",
        "sg.PixelsPerStud=tonumber(a.pixels_per_stud) or 50",
        "if a.image then local img=sg:FindFirstChild('Image') or Instance.new('ImageLabel') img.Name='Image' img.BackgroundTransparency=1 img.Size=UDim2.new(1,0,1,0) img.Image=asset(a.image) img.Parent=sg end",
        "if a.text then local t=sg:FindFirstChild('Label') or Instance.new('TextLabel') t.Name='Label' t.BackgroundTransparency=1 t.Size=UDim2.new(1,0,1,0) t.Text=tostring(a.text) t.TextScaled=true t.Parent=sg end",
        "return ok({path=sg:GetFullName()},'SurfaceGui on '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_clone") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local c=inst:Clone()",
        "if a.name and tostring(a.name)~='' then c.Name=tostring(a.name) end",
        "local par=inst.Parent",
        "if a.parent and tostring(a.parent)~='' then par=resolve(tostring(a.parent)) or par end",
        "c.Parent=par",
        "return ok({path=c:GetFullName()},'cloned to '..c:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_clear_children") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "local n=#inst:GetChildren() inst:ClearAllChildren()",
        "return ok({path=inst:GetFullName(),removed=n},'cleared '..tostring(n)..' children of '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_set_anchor") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if not inst:IsA('GuiObject') then return fail('ui_set_anchor needs a GuiObject') end",
        "local x=tonumber(a.x or a.anchor_x) or 0 local y=tonumber(a.y or a.anchor_y) or 0",
        "inst.AnchorPoint=Vector2.new(x,y)",
        "return ok({path=inst:GetFullName(),anchor={x,y}},'anchor '..inst:GetFullName())",
      ].join("\n"));
    }
    if (op === "ui_bring_to_front") {
      const m = need(a, "path");
      if (m) return m;
      return wrap(argsLua(a) + [
        "local inst=resolve(tostring(a.path or '')) if not inst then return fail('not found: '..tostring(a.path)) end",
        "if inst:IsA('LayerCollector') then inst.DisplayOrder=(tonumber(inst.DisplayOrder) or 0)+10 return ok({path=inst:GetFullName(),display_order=inst.DisplayOrder},'DisplayOrder '..tostring(inst.DisplayOrder)) end",
        "if inst:IsA('GuiObject') then inst.ZIndex=(tonumber(inst.ZIndex) or 1)+10 return ok({path=inst:GetFullName(),z_index=inst.ZIndex},'ZIndex '..tostring(inst.ZIndex)) end",
        "return fail('ui_bring_to_front needs a GUI')",
      ].join("\n"));
    }
    return null;
  }

  const GUI = [
    { name: "ui_build", description: "Build a production ScreenGui from a widgets[] spec. Each widget can set class, name, parent, size, position, text, image/texture (rbxassetid, numeric id, or builtin panel|button|circle|icon|close), corner, stroke, colors. Always creates ImageLabels for art — never grey placeholders.", params: { screen: { type: "string", req: false }, name: { type: "string", req: false }, title: { type: "string", req: false }, widgets: { type: "array", req: false, desc: "[{class_name,name,parent,size,position,text,image,corner,stroke,background,properties}]" } } },
    { name: "ui_set_image", description: "Set the Image on an ImageLabel/ImageButton (or add one). Accepts rbxassetid://, numeric id, or rbxasset:// texture. Also ScaleType, ImageColor3, 9-slice.", params: { path: { type: "string", req: true, desc: "dotted path" }, image: { type: "string", req: true, desc: "rbxassetid:// or id" }, scale_type: { type: "string", req: false, desc: "Stretch|Fit|Crop|Slice" }, image_color: { type: "array", req: false, desc: "[r,g,b]" }, image_transparency: { type: "number", req: false }, slice: { type: "array", req: false, desc: "[l,t,r,b] SliceCenter" } } },
    { name: "ui_set_texture", description: "Replace textures/images on a GUI or 3D instance and (by default) its descendants: ImageLabel.Image, Decal/Texture, MeshPart.TextureID.", params: { path: { type: "string", req: true }, texture: { type: "string", req: true, desc: "rbxassetid:// or id" }, descendants: { type: "boolean", req: false, desc: "default true" }, image_color: { type: "array", req: false } } },
    { name: "ui_set_text", description: "Set Text / font / color / stroke / alignment on a TextLabel, TextButton, or TextBox (creates a child label if needed).", params: { path: { type: "string", req: true }, text: { type: "string", req: false }, font: { type: "string", req: false }, text_color: { type: "array", req: false }, text_size: { type: "number", req: false }, text_scaled: { type: "boolean", req: false }, rich_text: { type: "boolean", req: false }, stroke_color: { type: "array", req: false } } },
    { name: "ui_set_color", description: "Set BackgroundColor3 / transparency / border on a GuiObject (or Part.Color).", params: { path: { type: "string", req: true }, background: { type: "array", req: false, desc: "[r,g,b]" }, background_transparency: { type: "number", req: false }, border: { type: "array", req: false }, border_size: { type: "number", req: false } } },
    { name: "ui_set_size", description: "Set Size as UDim2 [scaleX, offsetX, scaleY, offsetY].", params: { path: { type: "string", req: true }, size: { type: "array", req: true } } },
    { name: "ui_set_position", description: "Set Position UDim2, optional AnchorPoint [x,y] and ZIndex.", params: { path: { type: "string", req: true }, position: { type: "array", req: true }, anchor: { type: "array", req: false }, z_index: { type: "number", req: false } } },
    { name: "ui_set_font", description: "Set Font / TextSize on a widget and descendants.", params: { path: { type: "string", req: true }, font: { type: "string", req: false, desc: "Gotham, Legacy, SourceSansBold..." }, text_size: { type: "number", req: false }, descendants: { type: "boolean", req: false } } },
    { name: "ui_set_corner", description: "Add or update UICorner (pixel radius, optional scale).", params: { path: { type: "string", req: true }, radius: { type: "number", req: false }, scale: { type: "number", req: false } } },
    { name: "ui_set_stroke", description: "Add or update UIStroke color/thickness/transparency.", params: { path: { type: "string", req: true }, color: { type: "array", req: false }, thickness: { type: "number", req: false }, transparency: { type: "number", req: false } } },
    { name: "ui_set_gradient", description: "Add or update UIGradient (from/to colors, rotation).", params: { path: { type: "string", req: true }, color0: { type: "array", req: false }, color1: { type: "array", req: false }, rotation: { type: "number", req: false } } },
    { name: "ui_set_padding", description: "Add or update UIPadding.", params: { path: { type: "string", req: true }, pixels: { type: "number", req: false }, left: { type: "number", req: false }, right: { type: "number", req: false }, top: { type: "number", req: false }, bottom: { type: "number", req: false } } },
    { name: "ui_set_layout", description: "UIListLayout, UIGridLayout, or UIPageLayout on a frame.", params: { path: { type: "string", req: true }, layout: { type: "string", req: false, desc: "list|grid|page" }, padding: { type: "number", req: false }, columns: { type: "number", req: false }, cell_size: { type: "array", req: false } } },
    { name: "ui_set_visible", description: "Visible / Active / ZIndex / DisplayOrder.", params: { path: { type: "string", req: true }, visible: { type: "boolean", req: false }, active: { type: "boolean", req: false }, z_index: { type: "number", req: false }, display_order: { type: "number", req: false } } },
    { name: "ui_set_property", description: "Set ANY property on an instance. Colors as [r,g,b], UDim2 as [sx,ox,sy,oy], Enums as 'Enum.Font.Gotham' or Font='Gotham'. Use this to change everything the dedicated tools miss.", params: { path: { type: "string", req: true }, properties: { type: "object", req: false, desc: "{Image, Text, BackgroundColor3, ...}" }, property: { type: "string", req: false }, value: { type: "string", req: false } } },
    { name: "ui_paint", description: "Walk a ScreenGui/frame and restyle every widget: background, accent, text, font, corner, stroke, and optional image/texture on every ImageLabel.", params: { path: { type: "string", req: true }, background: { type: "array", req: false }, accent: { type: "array", req: false }, text: { type: "array", req: false }, font: { type: "string", req: false }, corner: { type: "number", req: false }, stroke: { type: "array", req: false }, image: { type: "string", req: false }, image_color: { type: "array", req: false } } },
    { name: "ui_add_element", description: "Create Frame/TextLabel/TextButton/ImageLabel/ImageButton/ScrollingFrame/ViewportFrame/TextBox under a parent. Optional image/text/size/position/properties.", params: { parent: { type: "string", req: true }, class_name: { type: "string", req: true }, name: { type: "string", req: false }, size: { type: "array", req: false }, position: { type: "array", req: false }, text: { type: "string", req: false }, image: { type: "string", req: false }, background: { type: "array", req: false }, properties: { type: "object", req: false } } },
    { name: "ui_set_scale", description: "Add or update UIScale on a GuiObject.", params: { path: { type: "string", req: true }, scale: { type: "number", req: false } } },
    { name: "ui_list_tree", description: "Deep-list a GUI tree with Image, Text, Size, colors — so you can see current textures before changing them.", params: { path: { type: "string", req: false }, screen_name: { type: "string", req: false }, limit: { type: "number", req: false } } },
    { name: "ui_apply_theme", description: "Paint a GUI tree with a named theme: dark, light, gold, sakura, night, horror, neon, stud. Optional image applied to every ImageLabel.", params: { path: { type: "string", req: true }, theme: { type: "string", req: false }, image: { type: "string", req: false } } },
    { name: "ui_set_slice", description: "Enable 9-slice ScaleType.Slice + SliceCenter on an image widget (optionally set the image too).", params: { path: { type: "string", req: true }, slice: { type: "array", req: false, desc: "[l,t,r,b]" }, image: { type: "string", req: false }, slice_scale: { type: "number", req: false } } },
    { name: "ui_bind_button", description: "Attach a LocalScript click handler: print, destroy_parent, toggle_parent, or custom source.", params: { path: { type: "string", req: true }, action: { type: "string", req: false }, source: { type: "string", req: false } } },
    { name: "decal_set", description: "Add/update a Decal on a BasePart face (Front/Back/Left/Right/Top/Bottom) with a texture id.", params: { path: { type: "string", req: true }, texture: { type: "string", req: true }, face: { type: "string", req: false }, transparency: { type: "number", req: false }, color: { type: "array", req: false } } },
    { name: "mesh_set_texture", description: "Set MeshPart.TextureID or SpecialMesh.TextureId.", params: { path: { type: "string", req: true }, texture: { type: "string", req: true } } },
    { name: "surface_gui_create", description: "Put a SurfaceGui on a part, optional full-face image and/or text.", params: { path: { type: "string", req: true }, face: { type: "string", req: false }, image: { type: "string", req: false }, text: { type: "string", req: false }, pixels_per_stud: { type: "number", req: false } } },
    { name: "ui_clone", description: "Clone a GUI instance (optional new name / parent).", params: { path: { type: "string", req: true }, name: { type: "string", req: false }, parent: { type: "string", req: false } } },
    { name: "ui_clear_children", description: "Remove every child of a GUI instance (the instance itself stays).", params: { path: { type: "string", req: true } } },
    { name: "ui_set_anchor", description: "Set AnchorPoint on a GuiObject (x/y 0-1).", params: { path: { type: "string", req: true }, x: { type: "number", req: false }, y: { type: "number", req: false } } },
    { name: "ui_bring_to_front", description: "Raise DisplayOrder (ScreenGui) or ZIndex (GuiObject) so it draws on top.", params: { path: { type: "string", req: true } } },
  ];

  const orig = RobloxScriptSkills.buildLuau;
  RobloxScriptSkills.buildLuau = function (op, args) {
    const extra = buildGui(op, args);
    if (extra) return extra;
    return orig(op, args);
  };
  for (const c of GUI) RobloxScriptSkills.SKILL_COMMANDS.push(c);
  RobloxScriptSkills.SKILL_OPS = RobloxScriptSkills.SKILL_COMMANDS.map(function (c) { return c.name; });
})();
