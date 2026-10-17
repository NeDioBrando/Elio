local report={checked=0,scripts=0,looseParts=0,unreadableScripts=0,findings={},limit=20000,readOnly=true}
for _,v in ipairs(game:GetDescendants()) do
 report.checked+=1
 if report.checked>report.limit then report.truncated=true break end
 if v:IsA('BasePart') and not v.Anchored then report.looseParts+=1 end
 if v:IsA('LuaSourceContainer') then
  report.scripts+=1
  local ok,source=pcall(function() return v.Source end)
  if not ok then report.unreadableScripts+=1
  elseif #report.findings<60 then
   for _,pattern in ipairs({'require%s*%(%s*%d','loadstring%s*%(','getfenv%s*%(','setfenv%s*%('}) do
    if string.find(source,pattern) then table.insert(report.findings,{path=v:GetFullName(),reason='Review external or dynamic code: '..pattern}) break end
   end
  end
 end
end
report.note='Read-only hints, not a security guarantee. Unanchored parts may be intentional. Inspect reported scripts before changing them.'
return game:GetService('HttpService'):JSONEncode(report)
