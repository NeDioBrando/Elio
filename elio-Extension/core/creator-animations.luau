-- elio's optional presentation effects. No gameplay or purchase handlers.
local tweenservice = game:GetService("TweenService")
local Root = script.Parent
local Reduced = Root:GetAttribute("elioReducedMotion") == true
local function animate(scale, amount, duration)
    tweenservice:Create(scale, TweenInfo.new(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {Scale = amount}):Play()
end
for _, object in Root:GetDescendants() do
    if object:IsA("GuiButton") then
        local scale = object:FindFirstChild("elioHoverScale")
        if scale and not scale:IsA("UIScale") then scale = object:FindFirstChildWhichIsA("UIScale") end
        if not scale then scale = Instance.new("UIScale"); scale.Name = "elioHoverScale"; scale.Parent = object end
        local base = scale.Scale
        object.MouseEnter:Connect(function() if not Reduced then animate(scale, base * 1.04, 0.14) end end)
        object.MouseLeave:Connect(function() animate(scale, base, 0.14) end)
        object.MouseButton1Down:Connect(function() if not Reduced then animate(scale, base * 0.96, 0.07) end end)
        object.MouseButton1Up:Connect(function() animate(scale, base, 0.12) end)
    elseif object:IsA("Frame") and object.Parent == Root and not Reduced then
        local scale = object:FindFirstChild("elioPanelScale")
        if scale and not scale:IsA("UIScale") then scale = object:FindFirstChildWhichIsA("UIScale") end
        if not scale then scale = Instance.new("UIScale"); scale.Name = "elioPanelScale"; scale.Parent = object end
        local base = scale.Scale
        scale.Scale = base * 0.92
        animate(scale, base, 0.22)
    end
end
