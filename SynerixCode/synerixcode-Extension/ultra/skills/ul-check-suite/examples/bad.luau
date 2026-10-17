local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("Coins")

local part = workspace:FindFirstChild("Coin").Position
wait(1)
spawn(function() print("hi") end)
local door = workspace:WaitForChild("Door")

while true do
	local x = 1
end

Players.PlayerAdded:Connect(function(player)
	local value = store:GetAsync(player.UserId)
	store:SetAsync(player.UserId, (value or 0) + 10)
end)
