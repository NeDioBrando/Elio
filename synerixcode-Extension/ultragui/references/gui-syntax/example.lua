-- A TextButton built the way the skill tells the model to build one.
local player = game:GetService("Players").LocalPlayer
local screen = Instance.new("ScreenGui")
screen.Name = "ShopGui"
screen.ResetOnSpawn = false
screen.IgnoreGuiInset = false

local button = Instance.new("TextButton")
button.Name = "ClaimButton"
button.Size = UDim2.new(0, 176, 0, 55)
button.Position = UDim2.new(0.5, 0, 0.5, 0)
button.AnchorPoint = Vector2.new(0.5, 0.5)
button.BackgroundColor3 = Color3.fromRGB(180, 255, 25)
button.BorderSizePixel = 0
button.AutoButtonColor = false
button.Text = "Claim"
button.Font = Enum.Font.GothamBlack
button.TextColor3 = Color3.fromRGB(255, 255, 255)
button.TextScaled = true
button.ZIndex = 25
button.Activated:Connect(function() end)

local stroke = Instance.new("UIStroke")
stroke.Thickness = 3
stroke.Color = Color3.fromRGB(12, 20, 26)
stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
stroke.Parent = button

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 4)
corner.Parent = button

local grad = Instance.new("UIGradient")
grad.Rotation = 90
grad.Color = ColorSequence.new{
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 232, 8)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 104, 0)),
}
grad.Transparency = NumberSequence.new{
	NumberSequenceKeypoint.new(0, 0.91),
	NumberSequenceKeypoint.new(1, 0.62),
}
grad.Parent = button

local textLimit = Instance.new("UITextSizeConstraint")
textLimit.MaxTextSize = 36
textLimit.MinTextSize = 12
textLimit.Parent = button

local image = Instance.new("ImageLabel")
image.Image = "rbxassetid://385956923"
image.ScaleType = Enum.ScaleType.Tile
image.TileSize = UDim2.new(0, 19, 0, 19)
image.ImageColor3 = Color3.fromRGB(0, 0, 0)
image.BackgroundTransparency = 1

screen.Parent = player:WaitForChild("PlayerGui")
button.Parent = screen
