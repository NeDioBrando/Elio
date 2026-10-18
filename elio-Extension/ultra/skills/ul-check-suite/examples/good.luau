--!strict
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("Coins")

local Coin = {}

function Coin.add(userId: number, amount: number): boolean
	local ok, err = pcall(function()
		store:UpdateAsync(tostring(userId), function(old: number?)
			return (old or 0) + amount
		end)
	end)
	if not ok then
		warn("Coin.add failed:", err)
	end
	return ok
end

task.spawn(function()
	while true do
		task.wait(1)
	end
end)

return Coin
