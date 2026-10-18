# tunables-config

Use when: adding a number that a designer might tune: health, speed, prices, wave sizes, timers, spawn rates.

- Put the numbers in one Config module, as a plain Luau table, grouped by system:
    local Config = { combat = { maxHealth = 100 }, economy = { startCoins = 50 } }
    return Config
- Services read Config.combat.maxHealth. They never hold the number themselves.
- Keep the module's values as data only: no functions, no Instances.
- If the user is tuning balance, change the table, then re-read the file to confirm
  the value changed.
