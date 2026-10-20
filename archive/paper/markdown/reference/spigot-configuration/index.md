---
title: "spigot.yml"
source: "https://docs.papermc.io/paper/reference/spigot-configuration/"
description: "An explanation of Spigot's configuration file."
fetched_at: "2026-10-19T21:16:04.032Z"
---

# spigot.yml

> [!NOTE] Note
> The below YAML shows you the structure and default values for `spigot.yml`
>
> Click on a leaf node to view the description for that setting.

> [!NOTE] Note
> To override a per-world option, create a new key under `world-settings` with the level-name (name of the folder).

- `settings`
  - `debug`: `false` — Enables debug logging, by setting the log level to ALL.
  - `save-user-cache-on-stop-only`: `false` — If false, the server saves the user-cache on every update.
  - `sample-count`: `12` — How many players to display the names of in the player-count hover. The selected players, and their positions in the list, are randomized.
  - `timeout-time`: `60` — Time in seconds since the last server-tick that the server is deemed not-responding by the server, and is stopped/restarted by the watchdog.
  - `restart-on-crash`: `true` — Whether to call `restart-script` when the server is killed by the watchdog. Note: this setting doesn’t restart the server if it gets killed externally, like by the OS.
  - `restart-script`: `./start.sh`
    The script file that is run when the server restarts.

    -   On Windows this is passed to `cmd /c start {restart-script}`. Normally, this means specifying a Batch (*.bat) file to be run. See Microsoft’s [documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/start) for specific options.
    -   On other platforms, this is passed to `sh {restart-script}`. The option is interpreted as an absolute or relative path to a shell script (*.sh). See your operating system’s documentation for more information (e.g. [Man Pages](https://man.archlinux.org/man/sh.1p#command_file)).

    For more information on Spigot’s restart system, read [this](https://gist.github.com/Prof-Bloodstone/6367eb4016eaf9d1646a88772cdbbac5)
  - `log-villager-deaths`: `true` — Whether to log villager deaths and witch transformations to console and latest.log
  - `log-named-deaths`: `true` — Whether to log deaths of entities with custom names to console and latest.log
  - `bungeecord`: `false`
    Whether to enable Bungeecord support, enabling:

    -   Receiving forwarded player-data and source ips.
    -   Support for binding to unix domain sockets.
  - `attribute`
    - `maxAbsorption`
      - `max`: `2048.0` — Overrides the maximum for the maxAbsorption attribute.
    - `maxHealth`
      - `max`: `1024.0` — Overrides the maximum for the maxHealth attribute.
    - `movementSpeed`
      - `max`: `1024.0` — Overrides the maximum for the movementSpeed attribute.
    - `attackDamage`
      - `max`: `2048.0` — Overrides the maximum for the attackDamage attribute.
  - `netty-threads`: `4` — Sets number of netty threads.
  - `player-shuffle`: `0`
    How often to shuffle the list of player connections, in ticks, 0 or less to disable. This prevents players from strategically re-logging to increase their position in the tick order. This can have a performance impact if enabled with low values.
  - `user-cache-size`: `1000` — How many players to keep in the user cache.
  - `moved-too-quickly-multiplier`: `10.0` — Controls how fast a client can move in one packet. If triggered, the server logs to console and prevents the move.
  - `moved-wrongly-threshold`: `0.0625` — Controls how far the client can move per move-packet, defined as the distance in blocks squared. If triggered, the server logs to console and prevents the move.
- `advancements`
  - `disable-saving`: `false` — Prevents saving of Advancements.
  - `disabled`:
    ```yaml
     - minecraft:story/disabled
    ```
    A list of strings, each being:

    -   A namespace-including Advancement key, For example, “minecraft:adventure/avoid_vibration” would disable the Sneak 100 advancement. [The Minecraft Wiki](https://minecraft.wiki/w/Advancement#List_of_advancements) has a list of all the Vanilla advancements, which need the “minecraft:” namespace prepended to them.
    -   The literal string ”*”, which disables *all* Advancements.
    -   An Advancement key’s namespace, which disables all advancements inside it. For example, “minecraft” would disable all Vanilla advancements.

    if an advancement is disabled without all of it’s children also being disabled console errors occur on load.
- `messages`
  - `whitelist`: `You are not whitelisted on this server!`
    The kick message for a player when:

    -   The player is unable to join as the whitelist is active.
    -   The player was kicked after they are removed from the whitelist, with enforce-whitelist enabled.
    -   The player was kicked after the whitelist enables, with enforce-whitelist enabled

    The message is formatted with legacy ”&” style formatting, and “\\n” for newlines.
  - `unknown-command`: `Unknown command. Type "/help" for help.` — NOTE: This setting no longer has any effect. The functionality should instead be replaced by a plugin.
  - `server-full`: `The server is full!` — The kick message for a player when they can’t join, as the server doesn’t have any open slots (current-players >= max players) The message is formatted with legacy ”&” style formatting, and “\\n” for newlines.
  - `outdated-client`: `Outdated client! Please use {0}`
    The kick for a player when they can’t join, as the server version is newer than the client version. The message is formatted with legacy ”&” style formatting, and “\\n” for newlines. Additionally, it replaces {0} with the current server version
  - `outdated-server`: `Outdated server! I'm still on {0}`
    The kick for a player when they can’t join, as the server version is older than the client version. The message is formatted with legacy ”&” style formatting, and “\\n” for newlines. Additionally, it replaces {0} with the current server version
  - `restart`: `Server is restarting` — The kick message for players on the server when it starts restarting, or if a player tries to join while the server is still restarting. The message is formatted with legacy ”&” style formatting, and “\\n” for newlines.
- `world-settings`
  - `default`
    - `below-zero-generation-in-existing-chunks`: `true` — Whether to allow conversion of existing chunks to full (post 1.18) height.
    - `merge-radius`
      - `exp`: `-1` — The range, in blocks, that exp orbs will combine at on initial spawn. This behavior is not present in Vanilla and doesn’t impact the usual merge range once spawned. Set to 0 or less to disable.
      - `item`: `0.5` — The range, in blocks, that items will combine within.
    - `ticks-per`
      - `hopper-check`: `1` — The ticks between checks to pull items.
      - `hopper-transfer`: `8` — The ticks between hopper item movements.
    - `hopper-amount`: `1` — How many items a hopper should move at a time, limited to stack size.
    - `hopper-can-load-chunks`: `false` — Whether to prevent hoppers from loading chunks.
    - `hunger`
      - `combat-exhaustion`: `0.1` — How much exhaustion to give from attacking.
      - `jump-sprint-exhaustion`: `0.2` — How much exhaustion to give from sprint jumping.
      - `jump-walk-exhaustion`: `0.05` — How much exhaustion to give from jump walking.
      - `other-multiplier`: `0.0` — The exhaustion multiplier for normal walking and crouching.
      - `regen-exhaustion`: `6.0` — How much exhaustion to give from regenerating health.
      - `sprint-multiplier`: `0.1` — The exhaustion multiplier for sprinting on the ground.
      - `swim-multiplier`: `0.01`
        The exhaustion multiplier for when “swimming”. This occurs when the player is:

        -   actually swimming
        -   walking underwater (eyes below surface)
        -   walking on water (eyes above surface)
    - `enable-zombie-pigmen-portal-spawns`: `true` — Whether to allow zombified piglins to spawn inside nether portals. This setting does not affect portal travel for any mobs.
    - `zombie-aggressive-towards-villager`: `true` — Whether zombies try to seek out and attack villagers.
    - `dragon-death-sound-radius`: `0` — The number of blocks that the dragon death sound is audible. Set to 0 to use the Vanilla default (64 blocks). This setting has no effect if the gamerule globalSoundEvents is set to true, which is the default.
    - `end-portal-sound-radius`: `0` — The number of blocks that the end portal opening sound is audible. Set to 0 to use the Vanilla default (64 blocks). This setting has no effect if the gamerule globalSoundEvents is set to true, which is the default.
    - `hanging-tick-frequency`: `100` — How often to tick hanging entities, in ticks.
    - `wither-spawn-sound-radius`: `0` — The number of blocks that the wither spawn sound is audible. Set to 0 to use the Vanilla default (64 blocks). This setting has no effect if the gamerule globalSoundEvents is set to true, which is the default.
    - `item-despawn-rate`: `6000` — The default time in ticks it takes an item to despawn. Per-item rates are found in Paper’s [per-world config](../world-configuration/index.md#entities_spawning_alt_item_despawn_rate).
    - `mob-spawn-range`: `8` — The range, in chunks, from the player, that mobs can spawn.
    - `arrow-despawn-rate`: `1200` — The number of ticks before an arrow despawns.
    - `trident-despawn-rate`: `1200` — The number of ticks before a trident despawns.
    - `seed-village`: `10387312` — The per-structure seed for villages.
    - `seed-desert`: `14357617` — The per-structure seed for desert structures.
    - `seed-igloo`: `14357618` — The per-structure seed for igloos.
    - `seed-jungle`: `14357619` — The per-structure seed for jungle structures.
    - `seed-swamp`: `14357620` — The per-structure seed for swamp structures.
    - `seed-monument`: `10387313` — The per-structure seed for monuments.
    - `seed-shipwreck`: `165745295` — The per-structure seed for shipwrecks.
    - `seed-ocean`: `14357621` — The per-structure seed for the ocean structures.
    - `seed-outpost`: `165745296` — The per-structure seed for outposts.
    - `seed-endcity`: `10387313` — The per-structure seed for end cities.
    - `seed-slime`: `987234911` — The per-structure seed for slime chunks.
    - `seed-nether`: `30084232` — The per-structure seed for the nether structures.
    - `seed-mansion`: `10387319` — The per-structure seed for mansions.
    - `seed-fossil`: `14357921` — The per-structure seed for fossils.
    - `seed-portal`: `34222645` — The per-structure seed for portals.
    - `seed-ancientcity`: `20083232` — The per-structure seed for ancient cities.
    - `seed-trailruins`: `83469867` — The per-structure seed for trail ruins.
    - `seed-trialchambers`: `94251327` — The per-structure seed for trial chambers.
    - `seed-buriedtreasure`: `10387320` — The per-structure seed for buried treasure.
    - `seed-mineshaft`: `default` — The per-structure seed for mineshafts.
    - `seed-stronghold`: `default` — The per-structure seed for strongholds.
    - `thunder-chance`: `100000` — The chance of lightning occurring during a thunderstorm, as a probability of 1/<thunder-chance> per chunk, every tick.
    - `entity-activation-range`
      The distance in blocks from a player at which entities tick normally. Outside this range, entities tick less frequently. Set to 0 or less to disable activation-range throttling for loaded entities in that category, causing them to tick normally regardless of player distance.

      - `animals`: `32` — The entity activation range for animals.
      - `monsters`: `32` — The entity activation range for monsters.
      - `raiders`: `64` — The entity activation range for raiders.
      - `misc`: `16` — The entity activation range for miscellaneous entities, including dropped items. Outside of this range, items moving through water streams may appear to visually lag, rubber-band, or move backward.
      - `water`: `16` — The entity activation range for water mobs.
      - `villagers`: `32` — The entity activation range for villagers.
      - `flying-monsters`: `32` — The entity activation range for flying monsters.
      - `wake-up-inactive`
        - `animals-every`: `1200` — How often an inactive animal outside of range will be woken up, in ticks. This is a minimum due to being limited to animals-max-per-tick.
        - `animals-for`: `100` — How long to wake an inactive animal up for, in ticks.
        - `animals-max-per-tick`: `4` — A limit of how many inactive animals can be woken up on the same tick.
        - `flying-monsters-every`: `200` — How often an inactive flying monster outside of range will be woken up, in ticks. This is a minimum due to being limited to flying-monsters-max-per-tick.
        - `flying-monsters-for`: `100` — How long to wake an inactive flying monster up for, in ticks.
        - `flying-monsters-max-per-tick`: `8` — A limit of how many inactive flying monsters can be woken up on the same tick.
        - `monsters-every`: `400` — How often an inactive monster outside of range will be woken up, in ticks. This is a minimum due to being limited to monsters-max-per-tick.
        - `monsters-for`: `100` — How long to wake an inactive monster up for, in ticks.
        - `monsters-max-per-tick`: `8` — A limit of how many inactive monsters can be woken up on the same tick.
        - `villagers-every`: `600` — How often an inactive villager outside of range will be woken up, in ticks. This is a minimum due to being limited to villagers-max-per-tick
        - `villagers-for`: `100` — How long to wake an inactive villager up for, in ticks.
        - `villagers-max-per-tick`: `4` — A limit of how many inactive villagers can be woken up on the same tick.
      - `villagers-work-immunity-after`: `100` — The time in ticks a villager has to be inactive and working to be woken up.
      - `villagers-work-immunity-for`: `20` — How long a villager should be woken up for, in ticks, after villagers-work-immunity-after.
      - `villagers-active-for-panic`: `true` — Whether to activate villagers when they want to panic.
      - `tick-inactive-villagers`: `true` — Whether to keep ticking villagers that are outside of their activation range.
      - `ignore-spectators`: `false` — Whether spectators activate entities within range.
    - `nerf-spawner-mobs`: `false` — Disable most AI for spawner spawned mobs.
    - `unload-frozen-chunks`: `false` — Experimental option that controls whether chunks can unload whilst ticks are frozen via /tick freeze.
    - `entity-tracking-range`
      - `players`: `128` — Controls how far in blocks players are tracked (sent to) the player. This is scaled by the [entity-broadcast-range-percentage](../server-properties/index.md#entity_broadcast_range_percentage).
      - `animals`: `96` — Controls how far in blocks animals are tracked (sent to) the player. This is scaled by the [entity-broadcast-range-percentage](../server-properties/index.md#entity_broadcast_range_percentage).
      - `monsters`: `96`
        Controls how far in blocks monsters are tracked (sent to) the player. This is scaled by the [entity-broadcast-range-percentage](../server-properties/index.md#entity_broadcast_range_percentage).
      - `misc`: `96`
        Controls how far in blocks misc entities are tracked (sent to) the player. This is scaled by the [entity-broadcast-range-percentage](../server-properties/index.md#entity_broadcast_range_percentage).
      - `display`: `128`
        Controls how far in blocks display entities are tracked (sent to) the player. This is scaled by the [entity-broadcast-range-percentage](../server-properties/index.md#entity_broadcast_range_percentage).
      - `other`: `64`
        Controls how far in blocks other entities are tracked (sent to) the player. This is scaled by the [entity-broadcast-range-percentage](../server-properties/index.md#entity_broadcast_range_percentage).
    - `growth`
      - `cactus-modifier`: `100` — The growth modifier percentage for cactus, where Vanilla speed is 100%. This option is unable to disable growth at 0, instead defaulting to 100% The maximum effectiveness is 1600%.
      - `cane-modifier`: `100` — The growth modifier percentage for sugarcane, where Vanilla speed is 100%. This option is unable to disable growth at 0%, instead defaulting to 100% The maximum effectiveness is 1600%.
      - `melon-modifier`: `100` — The growth modifier percentage for melons, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%
      - `mushroom-modifier`: `100` — The growth modifier percentage for mushrooms, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 2500%
      - `pumpkin-modifier`: `100` — The growth modifier percentage for pumpkins, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%
      - `sapling-modifier`: `100` — The growth modifier percentage for saplings, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 700%
      - `beetroot-modifier`: `100` — The growth modifier percentage for beetroot, where Vanilla speed is 100%. This option is unable to disable growth at 0%, instead defaulting to 100% The maximum effectiveness is 5100%.
      - `carrot-modifier`: `100` — The growth modifier percentage for carrots, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%.
      - `potato-modifier`: `100` — The growth modifier percentage for potatoes, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%
      - `torchflower-modifier`: `100` — The growth modifier percentage for torchflowers, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%
      - `wheat-modifier`: `100` — The growth modifier percentage for wheat, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%
      - `netherwart-modifier`: `100` — The growth modifier percentage for netherwart, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 1000%
      - `vine-modifier`: `100` — The growth modifier percentage for vines, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 400%
      - `cocoa-modifier`: `100` — The growth modifier percentage for cocoa beans, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 500%
      - `bamboo-modifier`: `100` — The growth modifier percentage for bamboo, where Vanilla speed is 100%. This option is unable to disable growth at 0%, instead defaulting to 100% The maximum effectiveness is 300%.
      - `sweetberry-modifier`: `100` — The growth modifier percentage for sweet-berries, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 500%
      - `kelp-modifier`: `100` — The growth modifier percentage for kelp, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is roughly 715%
      - `twistingvines-modifier`: `100` — The growth modifier percentage for twisting-vines, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 1000%
      - `weepingvines-modifier`: `100` — The growth modifier percentage for weeping-vines, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 1000%
      - `cavevines-modifier`: `100` — The growth modifier percentage for cave-vines, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 1000%
      - `glowberry-modifier`: `100` — The growth modifier percentage for glow-berries, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is roughly 910%
      - `pitcherplant-modifier`: `100` — The growth modifier percentage for pitcherplants, where Vanilla speed is 100%. This option is unable to disable growth, instead defaulting to 100% The maximum effectiveness is 5100%
    - `max-tick-time`
      - `tile`: `50` — This option does not operate, as it is disabled by a Paper patch.
      - `entity`: `50` — This option does not operate, and is non-functional upstream.
    - `max-tnt-per-tick`: `100` — How many TNT to process per server tick. Set to 0 or less to disable.
    - `view-distance`: `default` — Overrides the view distance. Set to -1 or “default” to use the value in [server.properties](../server-properties/index.md#view_distance)
    - `simulation-distance`: `default` — Overrides the simulation distance. Set to -1 or “default” to use the value in [server.properties](../server-properties/index.md#simulation_distance).
    - `verbose`: `false` — Whether to log world settings when the configuration file is loaded. This normally occurs on startup, `/spigot reload`, and `/reload`.
- `players`
  - `disable-saving`: `false` — Prevents saving player data.
- `config-version`: `""` — Internal constant for upgrading configuration: **Do Not Touch**.
- `stats`
  - `disable-saving`: `false` — Whether to prevent saving stats.
  - `forced-stats`: `{}`
    An Object, where:

    -   The Keys inside are any “Resource location” from [The Minecraft Wiki](https://minecraft.wiki/w/Statistics#List_of_custom_statistic_names).
    -   The Value for each key is an integer to force the related stat to.
- `commands`
  - `tab-complete`: `0`
    How many characters need to be typed before commands tab-complete.

    < 0 — Tab-completion is disabled.

    = 0 — Always tab-complete all available commands.

    > 0 — Only tab-complete commands after n characters are typed. This behaves as 0 due to client changes.
  - `send-namespaced`: `true` — Whether to send commands with a namespace (like minecraft:give) to the client.
  - `log`: `true` — Whether to log commands executed by players, in chat or on signs. This *currently* logs in the format “<playername> issued server command: <command>”.
  - `replace-commands`: — List of Vanilla commands that should override any plugin commands.
    ```yaml
     - setblock
     - summon
     - testforblock
     - tellraw
    ```
  - `spam-exclusions`: — Any chat message or command that prefix matches an entry in this list will be excluded from the built-in spam filter. Commands need a ”/” to be counted as commands.
    ```yaml
     - /skill
    ```
  - `silent-commandblock-console`: `false` — Whether to log Vanilla command feedback to the Console.
  - `enable-spam-exclusions`: `false` — Whether to apply spam exclusions from [`commands.spam-exclusions`](#commands_spam_exclusions).
