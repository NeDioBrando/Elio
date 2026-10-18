local btn = Instance.new("TextButton")
btn.Size = UDim2.new(0, 176, 0, 55)
btn.Text = "Claim"
btn.Font = Enum.Font.GothamBlack
btn.TextColor3 = Color3.fromRGB(255, 255, 255)
btn.AnchorPoint = Vector2.new(0.5, 0.5)
btn.ZIndex = 25
btn.ClipsDescendants = true
btn.MouseButton1Click:Connect(function() end)
local stroke = Instance.new("UIStroke")
stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
local seq = ColorSequence.new{ ColorSequenceKeypoint.new(0, Color3.fromRGB(1, 2, 3)) }
