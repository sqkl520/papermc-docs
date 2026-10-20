---
title: "World configuration"
source: "https://docs.papermc.io/paper/reference/world-configuration/"
description: "An explanation of Paper's world configuration file."
fetched_at: "2026-10-19T21:16:04.586Z"
---

# World configuration

> [!NOTE] Note
> The below YAML shows you the structure and default values for the world configuration (`config/paper-world-defaults.yml` and `world/dimensions/<namespace>/<key>/paper-world.yml`).
>
> Click on a leaf node to view the description for that setting.

- `anticheat`
  - `anti-xray`
    - `enabled`: `false` — Controls the on/off state for the Anti-Xray system
    - `engine-mode`: `1`
      Sets the Anti-Xray engine mode. 1 replaces specified blocks (hidden-blocks) with other “fake” blocks, stone (deepslate at y < 0), netherrack, or end_stone based on the dimension. In contrast, 2 will replace both hidden-blocks and replacement-blocks with randomly generated hidden-blocks. Similarly to engine mode 2, mode 3 will replace each chunk layer with a random block from the hidden-blocks list.
    - `hidden-blocks`:
      ```yaml
       - copper_ore
       - deepslate_copper_ore
       - raw_copper_block
       - gold_ore
       - deepslate_gold_ore
       - iron_ore
       - deepslate_iron_ore
       - raw_iron_block
       - coal_ore
       - deepslate_coal_ore
       - lapis_ore
       - deepslate_lapis_ore
       - mossy_cobblestone
       - obsidian
       - chest
       - diamond_ore
       - deepslate_diamond_ore
       - redstone_ore
       - deepslate_redstone_ore
       - clay
       - emerald_ore
       - deepslate_emerald_ore
       - ender_chest
      ```
      With engine-mode: 1, these blocks will be replaced by stone (deepslate at y < 0), netherrack, or end_stone, based on the dimension. All types of air are ignored on this list. With engine-mode: 2, these blocks will be randomly placed in the world, replacing both hidden-blocks and replacement-blocks. Tile entities, such as chests or spawners, are not allowed on this list. Individual blocks may be added multiple times, increasing their chance of being placed. engine-mode: 3 is very similar to 2, but these blocks will be randomly placed where each vertical chunk layer will take the same block from the list.
    - `lava-obscures`: `false` — Whether to obfuscate blocks touching lava. Does not work well with non-stone-like ore textures. This is because lava, while being mostly opaque, does not cover blocks fully at the surface
    - `max-block-height`: `64`
      Sets the maximum height (y coordinate, starting from the bottom of the world) to which anti-xray will operate. Only integer multiples of 16 are accepted. All other values will be rounded down. The [Minecraft Wiki page about Ore](https://minecraft.wiki/w/Ore) may be helpful in determining the best value for you
    - `replacement-blocks`:
      ```yaml
       - stone
       - oak_planks
       - deepslate
      ```
      With engine-mode: 1, replacement blocks are not used. Changing this list will have no effect. With engine-mode: 2, both replacement-blocks and hidden-blocks are randomly replaced by hidden-blocks. While tile entities are ignored in the hidden-blocks list, they may be added to the replacement-blocks list. All types of air blocks are ignored here. With engine-mode: 3, the behavior is the same as engine-mode: 2, but the replacement-blocks list is used to determine which blocks are used for each vertical chunk layer.
    - `update-radius`: `2`
      Radius for block updates which will be sent containing real block data when the client interacts with a block. Only values 0, 1, and 2 are accepted. Values smaller than 0 will be rounded up to 0, while values larger than 2 will be rounded down to 2. 0 is only designed for testing purposes. Do not use it in production
    - `use-permission`: `false`
      Whether to allow players with the paper.antixray.bypass permission to bypass anti-xray. Checking this permission is disabled by default as legacy permission plugins may struggle with the number of checks made. This should only be used with modern permission plugins
- `chunks`
  - `auto-save-interval`: `default` — Configures the world saving interval in ticks. Overrides ticks-per.autosave in bukkit.yml for this world. By default it will use the global ticks-per.autosave in bukkit.yml
  - `delay-chunk-unloads-by`: `10s` — Delays chunk unloads by the specified time. Formatted as a duration with a single unit e.g. 10h or 25m. Supports d, h, m, and s.
  - `entity-per-chunk-save-limit`
    - `experience_orb`: `-1` — Limits the number of experience_orb’s that will be saved/loaded per chunk. A value of -1 disables the limit for a specific entity.
    - `<entity-type>`: `amount` — Limits the number of any type of entity that will be saved/loaded per chunk. A value of -1 disables the limit for a specific entity. **Any entity may be added to the list**, beyond the enumerated defaults
  - `fixed-chunk-inhabited-time`: `-1`
    If 0 or greater, set the chunk inhabited time to a fixed number. Fixed in this instance means static or unchanging. This is **not** fixing a bug. The timer is increased when chunks are kept loaded because of player activity
  - `flush-regions-on-save`: `false` — Sets whether the server will flush chunks to disk when they are saved. This may have a performance impact
  - `max-auto-save-chunks-per-tick`: `24` — The maximum number of chunks the auto-save system will save in a single tick
  - `min-chunk-unload-count`: `50`
    The minimum number of eligible chunks to unload each tick. The chunks will unload from world chunk map, and save to disk asynchronously. See min-chunk-unload-fraction for more. Increasing these takes more tick time on chunk unloading, but may help with memory usage in specific scenarios.
  - `min-chunk-unload-fraction`: `0.05` — The minimum fraction of eligible chunks to unload each tick. The final number of chunk unloads per tick is the maximum of min-chunk-unload-count and eligible-chunks * min-chunk-unload-fraction.
  - `prevent-moving-into-unloaded-chunks`: `false` — Sets whether the server will prevent players from moving into unloaded chunks or not
- `collisions`
  - `allow-player-cramming-damage`: `false` — Allows players to take damage from cramming when colliding with more entities than set in the maxEntityCramming game rule
  - `allow-vehicle-collisions`: `true` — Whether vehicles should also be able to collide while only-players-collide is enabled
  - `fix-climbing-bypassing-cramming-rule`: `false`
    Sets whether climbing should bypass the entity cramming limit(maxEntityCramming game rule). If set to true, climbing entities will also be counted towards the entity cramming limit so that they can take suffocation damage
  - `max-entity-collisions`: `8` — Instructs the server to stop processing collisions after this value is reached
  - `only-players-collide`: `false` — Only calculate collisions if a player is one of the two entities colliding
- `command-blocks`
  - `force-follow-perm-level`: `true` — Require that command blocks meet both the Bukkit permission requirements and the Vanilla permission level. Otherwise, only 1 of those is required.
  - `permissions-level`: `2` — Default Vanilla permission level for command blocks.
- `entities`
  - `armor-stands`
    - `do-collision-entity-lookups`: `true` — Instructs armor stand entities to do entity collision checks
    - `tick`: `true` — Disable to prevent armor stands from ticking. Can improve performance with many armor stands
  - `behavior`
    - `allow-spider-world-border-climbing`: `true` — Whether spiders should be able to climb on the world border, as if it were a regular wall.
    - `baby-zombie-movement-modifier`: `0.5` — Modifies the speed that baby zombies move at, where 0.5 is 50% faster than the mob base speed, and -0.4 would be 40% slower
    - `cooldown-failed-beehive-releases`: `true` — Adds a cooldown to bees being released after a failed release, which can occur if the hive is blocked or it being night.
    - `disable-chest-cat-detection`: `false` — Allows you to open chests even if they have a cat sitting on top of them
    - `disable-creeper-lingering-effect`: `false` — Disables creepers randomly leaving behind a lingering area effect cloud
    - `disable-player-crits`: `false` — Instructs the server to disable critical hits in PvP, treating them as normal hits instead
    - `door-breaking-difficulty`
      - `vindicator`: — A list of difficulties (PEACEFUL, EASY, NORMAL, HARD) at which vindicators will attempt to break doors.
        ```yaml
         - NORMAL
         - HARD
        ```
      - `<entity-type>`: — A list of difficulties (PEACEFUL, EASY, NORMAL, HARD) at which zombie-like entities (husks, zombies, zombie villagers and zombified piglins) will attempt to break doors.
        ```yaml
         - HARD
        ```
    - `ender-dragons-death-always-places-dragon-egg`: `false` — Controls whether ender dragons should always drop dragon eggs on death
    - `experience-merge-max-value`: `-1`
      Instructs the server to put a maximum value on experience orbs, preventing them all from merging down into 1 single orb. A value of -1 instructs the server to use no max value, allowing them to merge down into a single orb. This is especially noticeable when defeating boss monsters
    - `mobs-can-always-pick-up-loot`
      - `skeletons`: `false` — Instructs the server to allow skeletons to pick up loot. If set to false, the probability that a skeleton picks up items depends on the world’s difficulty (Vanilla behavior)
      - `zombies`: `false` — Instructs the server to allow zombies to pick up loot. If set to false, the probability that a zombie picks up items depends on the world’s difficulty (Vanilla behavior)
    - `nerf-pigmen-from-nether-portals`: `false` — Removes AI from pigmen spawned via nether portals
    - `only-merge-items-horizontally`: `false` — Prevents merging items that are not on the same y level, preventing potential visual artifacts.
    - `parrots-are-unaffected-by-player-movement`: `false` — Makes parrots “sticky” so they do not fall off a player’s shoulder when they move. Use crouch to shake them off
    - `phantoms-do-not-spawn-on-creative-players`: `true` — Disables spawning of phantoms on players in creative mode
    - `phantoms-only-attack-insomniacs`: `true` — Prevents phantoms from attacking players who have slept
    - `phantoms-spawn-attempt-max-seconds`: `119` — Sets the maximum number of seconds between phantom spawn attempts
    - `phantoms-spawn-attempt-min-seconds`: `60` — Sets the minimum number of seconds between phantom spawn attempts
    - `piglins-guard-chests`: `true` — If piglins should attempt to guard chests when angered
    - `pillager-patrols`
      - `disable`: `false` — Disables Pillager patrols and associated AI
      - `spawn-chance`: `0.2` — Modify the spawn changes for patrols
      - `spawn-delay`
        - `ticks`: `12000` — Delay in ticks between spawn chance
        - `per-player`: `false` — Sets the delay to be independent for each player
      - `start`
        - `day`: `5` — Days between raid spawns
        - `per-player`: `false` — Sets the start to be independent for each player
    - `player-insomnia-start-ticks`: `72000` — Number of ticks a player must stay awake before phantoms can start spawning. Default (72000) is 3 Minecraft days, -1 disables phantom spawning.
    - `should-remove-dragon`: `false` — Sets whether to remove the dragon if it exists without a portal
    - `spawner-nerfed-mobs-should-jump`: `false` — Determines if spawner nerfed mobs should attempt to float (jump) in water
    - `stuck-entity-poi-retry-delay`: `200` — The delay before retrying POI acquisition when entity navigation is stuck. This will reduce pathfinding performance impact. Measured in ticks.
    - `zombie-villager-infection-chance`: `default`
      Sets the chance for villager conversion to zombie villager. Set to “default” for default behavior based on game difficulty. Set to 0.0 to always have villagers die when killed by zombies. Set to 100.0 to always convert villagers to zombie villagers
    - `zombies-target-turtle-eggs`: `true` — Sets whether zombies and zombified piglins should target turtle eggs. Setting this to false may help with performance, as they won’t search for nearby eggs
    - `inactive-mob-goal-selector-throttle-rate`: `disabled` — If specified, this setting controls how often to tick inactive mobs’ goal selectors. Higher values reduce the performance impact of ticking mobs that are far away. Measured in ticks.
  - `entities-target-with-follow-range`: `false` — Sets whether the server should use follow range when targeting entities
  - `markers`
    - `tick`: `true` — Disable to prevent markers from ticking. This may affect how they behave as passengers of other entities
  - `mob-effects`
    - `immune-to-wither-effect`: `true` — If the specified entity should be immune to the wither effect
    - `spiders-immune-to-poison-effect`: `true` — If spiders should be immune to poison
  - `sniffer`
    - `boosted-hatch-time`: `default` — The boosted hatch time, in ticks, a sniffer egg requires to hatch. Boosted hatching occurs when planted on specific blocks.
    - `hatch-time`: `default` — The non-boosted hatch time, in ticks, a sniffer egg requires to hatch.
  - `spawning`
    - `all-chunks-are-slime-chunks`: `false` — Instructs the server to treat all chunks like slime chunks, allowing them to spawn in any chunk. This may actually decrease your chances of running into a Slime as they now have a much larger potential spawn area
    - `alt-item-despawn-rate`
      - `enabled`: `false` — Determines if items will have different despawn rates
      - `items`
        - `cobblestone`: `300` — Sets a custom despawn rate for cobblestone of 300 ticks
        - `<item-type>`: `amount`
          Determines how long each respective item despawns in ticks. The item ids are the same as those used in the /give command. They can be viewed by enabling advanced item tooltips in-game by pressing **F3 + H**; the item id will appear at the bottom of the tooltip that appears when you hover over an item
    - `max-arrow-despawn-invulnerability`: `200` — Workaround for [MC-125757](https://mojira.dev/MC-125757), makes all arrows advance their despawn timer as if they were stuck in the ground, after a delay (in ticks).
    - `count-all-mobs-for-spawning`: `false` — Determines whether spawner mobs and other misc mobs are counted towards the global mob limit
    - `creative-arrow-despawn-rate`: `default` — The rate, in ticks, at which arrows shot from players in creative mode are despawned
    - `despawn-range-shape`: `ELLIPSOID`
      The shape of the despawn range. Can be one of the following values:

      -   **ELLIPSOID**: The despawn range is an ellipsoid, with the horizontal and vertical despawn ranges being separate. This is the default Minecraft behavior.
      -   **CYLINDER**: The vertical despawn range is checked separately from the horizontal despawn range, but the horizontal despawn range is a circle.
    - `despawn-ranges`
      - `<mob_category>`
        - `hard`: `default` — The horizontal and vertical number of blocks away from a player in which each monster type (set individually) will be forcibly despawned.
        - `soft`: `default` — The horizontal and vertical number of blocks away from a player in which each monster type (set individually) will be randomly selected to be despawned.
      - `<mob_category>`
        - `hard`
          - `horizontal`: `default` — The horizontal number of blocks away from a player in which each entity type (set individually) will be forcibly despawned.
          - `vertical`: `default` — The vertical number of blocks away from a player in which each entity type (set individually) will be forcibly despawned.
        - `soft`
          - `horizontal`: `default` — The horizontal number of blocks away from a player in which each entity type (set individually) will be randomly selected to be despawned.
          - `vertical`: `default` — The vertical number of blocks away from a player in which each entity type (set individually) will be randomly selected to be despawned.
    - `despawn-time`
      - `<entity-type>`: `disabled` — A server-introduced despawn time after which the entity is forcefully despawned. If disabled or not specified, the entity will simply despawn according to Vanilla rules.
    - `disable-mob-spawner-spawn-egg-transformation`: `false` — Whether to block players from changing the type of mob spawners with a spawn egg
    - `duplicate-uuid`
      - `mode`: `SAFE_REGEN`
        Specifies the method the server uses to resolve entities with duplicate UUIDs. This can be one of the following values:

        -   **SAFE_REGEN**: Regenerate a UUID for the entity, or delete it if they are close.
        -   **DELETE**: Delete the entity.
        -   **NOTHING**: Does nothing, not printing logs.
        -   **WARN**: Does nothing, printing logs
      - `safe-regen-delete-range`: `32` — If multiple entities with duplicate UUIDs are within this many blocks, saferegen will delete all but 1 of them
    - `filter-bad-tile-entity-nbt-from-falling-blocks`: `true` — Instructs the server to remove certain NBT data from falling blocks. **Note**: Some adventure maps may require this to be turned off to function correctly, but we do not recommend turning it off on a public server
    - `filtered-entity-tag-nbt-paths`:
      ```yaml
       - Pos
       - Motion
       - sleeping_pos
      ```
      A list of NBT tags that will be removed from the “entity_data” component on items which spawn entities. The format of these strings follows the same format used to select NBT tags in Vanilla commands. If the spawning was directly caused by a player and the player has the minecraft.nbt.place permission, the filter list will be ignored. The defaults are set to prevent entities from spawning or moving to a place other than the location they were placed. For example, if Pos wasn’t included, a spawn egg could place an entity at any location. **Note**: Some adventure maps may require this to be an empty list to function correctly, but we do not recommend turning it off on a public server
    - `iron-golems-can-spawn-in-air`: `false` — Sets whether iron golems can spawn in the air. Iron farms may break depending on this setting
    - `monster-spawn-max-light-level`: `default` — When set to “default”, the Vanilla default will be used (=0). Set to 15 or greater to revert to pre-1.18 behavior
    - `non-player-arrow-despawn-rate`: `default` — The rate, in ticks, at which arrows shot from non-player entities are despawned. The default value instructs the server to use the same default arrow despawn rate from spigot.yml that is used for all arrows
    - `per-player-mob-spawns`: `true`
      Determines whether the mob limit (in bukkit.yml) is counted per player or for the entire server. Enabling this setting results in roughly the same number of mobs, but with a more even distribution that prevents one player from using the entire mob cap and provides a more single-player like experience
    - `scan-for-legacy-ender-dragon`: `true` — Determines if the server attempts to start the ender dragon fight. Setting this to false will make the ender dragon not spawn in the end, even with a new world
    - `skeleton-horse-thunder-spawn-chance`: `default` — Sets the chance that a “Skeleton Trap” (4 skeleton horsemen) will spawn in a thunderstorm. Takes a double between 0 and 1, where 0 is 0% chance
    - `slime-spawn-height`
      - `slime-chunk`
        - `maximum`: `40` — Sets the maximum Y position for natural Slime spawn in Slime Chunks
      - `surface-biome`
        - `minimum`: `50` — Sets the minimum Y position for natural Slime spawn in Surface Biomes
        - `maximum`: `70` — Sets the maximum Y position for natural Slime spawn in Surface Biomes
    - `spawn-limits`
      - `ambient`: `-1`
        The constant used to determine how many ambient mobs will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_ambient), except that it can be configured per world. A value of -1 will use the value in bukkit.yml
      - `axolotls`: `-1`
        The constant used to determine how many axolotls will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_axolotls), except that it can be configured per world. A value of -1 will use the value in bukkit.yml
      - `creature`: `-1`
        The constant used to determine how many animals will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_animals), except that it can be configured per world, and the name. A value of -1 will use the value in bukkit.yml
      - `monster`: `-1`
        The constant used to determine how many monsters will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_monsters), except that it can be configured per world. A value of -1 will use the value in bukkit.yml
      - `underground_water_creature`: `-1`
        The constant used to determine how many underground water creatures will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_water_underground_creature), except that it can be configured per world. A value of -1 will use the value in bukkit.yml
      - `water_ambient`: `-1`
        The constant used to determine how many water ambient mobs will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_water_ambient), except that it can be configured per world. A value of -1 will use the value in bukkit.yml
      - `water_creature`: `-1`
        The constant used to determine how many water animals will be naturally spawned per world. This is identical to the value set in [bukkit.yml](../bukkit-configuration/index.md#spawn_limits_water_animals), except that it can be configured per world. A value of -1 will use the value in bukkit.yml
    - `ticks-per-spawn`
      - `ambient`: `-1` — Determines how many ticks there are between attempts to spawn ambient mobs (bats). Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_ambient_spawns).
      - `axolotls`: `-1` — Determines how many ticks there are between attempts to spawn axolotls. Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_axolotl_spawns).
      - `creature`: `-1` — Determines how many ticks there are between attempts to spawn passive creatures (animals). Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_animal_spawns).
      - `monster`: `-1` — Determines how many ticks there are between attempts to spawn hostile monsters. Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_monster_spawns).
      - `underground_water_creature`: `-1`
        Determines how many ticks there are between attempts to spawn underground water creatures (glow squid). Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_water_underground_creature_spawns).
      - `water_ambient`: `-1`
        Determines how many ticks there are between attempts to spawn ambient water mobs (tropical fish). Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_water_ambient_spawns).
      - `water_creature`: `-1`
        Determines how many ticks there are between attempts to spawn water creatures (squid, dolphins). Default (-1) uses [bukkit.yml spawn rate](../bukkit-configuration/index.md#ticks_per_water_spawns).
    - `wandering-trader`
      - `spawn-chance-failure-increment`: `25` — How much the spawn chance will be increased on every failed wandering trader spawn
      - `spawn-chance-max`: `75` — The maximum chance that a wandering trader will be spawned
      - `spawn-chance-min`: `25` — The minimum chance that a wandering trader will be spawned
      - `spawn-day-length`: `24000` — Time between wandering trader spawn attempts in ticks
      - `spawn-minute-length`: `1200` — The length of the wandering trader spawn minute in ticks
    - `wateranimal-spawn-height`
      - `maximum`: `default` — The maximum height at which water animals will spawn. **Note**: The default value defers to Minecraft’s default setting, which as of 1.12 is the sea level of the world (usually Y: 64)
      - `minimum`: `default` — The minimum height at which water animals will spawn. **Note**: The default value defers to Minecraft’s default setting, which as of 1.12 is the sea level of the world (usually Y: 64)
  - `tracking-range-y`
    - `animal`: `default` — Controls how far vertically in blocks animals are tracked (sent to) the player.
    - `display`: `default` — Controls how far vertically in blocks display entities are tracked (sent to) the player.
    - `enabled`: `false` — Enables separate ranges for tracking ranges in the vertical (Y) direction.
    - `misc`: `default` — Controls how far vertically in blocks miscellaneous are tracked (sent to) the player.
    - `monster`: `default` — Controls how far vertically in blocks monsters are tracked (sent to) the player.
    - `other`: `default` — Controls how far vertically in blocks other entities are tracked (sent to) the player.
    - `player`: `default` — Controls how far vertically in blocks players are tracked (sent to) the player.
- `environment`
  - `disable-explosion-knockback`: `false` — Instructs the server to completely block any knockback that occurs as a result of an explosion
  - `disable-ice-and-snow`: `false` — Disables ice and snow formation. This also causes cauldrons to no longer be filled by rain or snow
  - `disable-thunder`: `false` — Disables thunderstorms
  - `fire-tick-delay`: `30` — Sets the minimum delay between fire ticks
  - `frosted-ice`
    - `delay`
      - `max`: `40` — Maximum RNG value to apply frosted-ice effects at
      - `min`: `20` — Minimum RNG value to apply frosted-ice effects at
    - `enabled`: `true` — Instructs the server to enable (and tick) frosted ice blocks
  - `generate-flat-bedrock`: `false` — Instructs the server to generate bedrock as a single flat layer
  - `locate-structures-outside-world-border`: `false` — If the server should be able to locate structures in chunks that are outside the world border.
  - `max-block-ticks`: `65536` — The maximum number of block ticks that can be processed in a single tick. This is a safety measure to prevent the server from hanging when there is a large amount of block updates.
  - `max-fluid-ticks`: `65536` — The maximum number of fluid ticks that can be processed in a single tick. This is a safety measure to prevent the server from hanging when there is a large number of fluid updates.
  - `nether-ceiling-void-damage-height`: `disabled` — Sets the level above which players in the nether will take void damage. This is a Vanilla-friendly way to restrict players from using the nether ceiling as a buildable area. Setting to disabled disables this feature
  - `optimize-explosions`: `false` — Instructs the server to cache entity lookups during an explosion, rather than recalculating throughout the process. This speeds up explosions significantly
  - `portal-create-radius`: `16` — The maximum range the server will try to create a portal around when generating a new portal
  - `portal-search-radius`: `128` — The maximum range the server will use to look for an existing nether portal. If it can’t find one in that range, it will generate a new one
  - `portal-search-vanilla-dimension-scaling`: `true` — Whether to apply Vanilla dimension scaling to portal-search-radius
  - `treasure-maps`
    - `enabled`: `true` — If villagers should trade treasure maps and treasure maps from chests should lead to a feature
    - `find-already-discovered`
      - `loot-tables`: `default`
        Overrides the loot table-configured check for undiscovered structures. default allows loot tables to individually determine if the map should allow discovered locations in its search. All Vanilla loot tables default to skipping discovered locations so changing this to false would override that behavior and force them to search discovered locations
      - `villager-trade`: `false` — Instructs the server to target the first treasure location found for maps obtained via trading with villagers
  - `void-damage-amount`: `4` — The amount of void damage dealt per void damage attempt. May be set to `disabled` to completely disable void damage in the world.
  - `void-damage-min-build-height-offset`: `-64` — The offset from a world’s minimum build height at which entities should receive void damage.
  - `water-over-lava-flow-speed`: `5` — Sets the speed at which water flows while over lava
- `feature-seeds`
  - `generate-random-seeds-for-all`: `false` — Enables autofilling random seeds for all available features you haven’t already set a seed to. Using this in a controlled environment is also a good way of receiving a full list of features you can set seeds for
  - `<feature-namespace>`: `-1` — Sets the population seed for the specified feature. If set to -1, the Vanilla population seed stays unchanged and will not be overridden by the autofill option
- `fishing-time-range`
  - `maximum`: `600` — The maximum number of RNG ticks before catching a fish
  - `minimum`: `100` — The minimum number of RNG ticks needed to catch a fish
- `fixes`
  - `disable-unloaded-chunk-enderpearl-exploit`: `false` — Prevent enderpearls from storing the thrower when in an unloaded chunk
  - `falling-block-height-nerf`: `disabled` — The height at which falling blocks will be removed from the server. A value of disabled will disable this feature
  - `fix-items-merging-through-walls`: `false` — Whether items should be prevented from merging through walls. Enabling this will incur a performance degradation. This is only necessary when merge-radius.item (spigot.yml) is large enough to merge items through walls
  - `prevent-tnt-from-moving-in-water`: `false` — Instructs the server to keep Primed TNT entities from moving in flowing water
  - `split-overstacked-loot`: `true`
    When set to false, loot tables will not attempt to split items with a stack size higher than the maximum into items of smaller stack sizes. This will prevent overstacked items from being lost or causing a chunk to become uninhabitable (due to players getting constantly kicked because of oversized packets) when a shulker box is broken in survival
  - `tnt-entity-height-nerf`: `disabled` — The height at which Primed TNT entities will be removed from the server. A value of disabled will disable this feature
- `hopper`
  - `cooldown-when-full`: `true` — Instructs the server to apply a short cooldown when the hopper is full, instead of constantly trying to pull new items
  - `disable-move-event`: `false` — Completely disables the InventoryMoveItemEvent for hoppers. Dramatically improves hopper performance but will break protection plugins and any others that depend on this event
  - `ignore-occluding-blocks`: `false` — Determines if hoppers will ignore containers inside occluding blocks, like a hopper minecart inside a sand block. Enabling this will improve performance for hoppers checking where to insert items
- `lootables`
  - `auto-replenish`: `false`
    Instructs the server to automatically replenish lootable containers. This feature is useful for long-term worlds in which players are not expected to constantly explore to generate new chunks. Breaking such lootable containers disables replenishing after their initial looting.
  - `max-refills`: `-1` — Sets the maximum number of times a lootable may be refilled. **Note**: The default value will allow a lootable to refill an infinite number of times
  - `refresh-max`: `2d` — The maximum amount of time that can pass before a lootable is refilled. Formatted as a duration with a single unit e.g. 10h or 25m. Supports d, h, m, and s.
  - `refresh-min`: `12h` — The minimum amount of time that must pass before a lootable will be eligible to be refilled. Formatted as a duration with a single unit e.g. 10h or 25m. Supports d, h, m, and s.
  - `reset-seed-on-fill`: `true` — Resets the loot seed each time the lootable is refilled, effectively randomizing the new loot items on each refill
  - `restrict-player-reloot`: `true` — Prevents the same players from coming back and re-looting the same containers over and over
  - `restrict-player-reloot-time`: `disabled` — Per-player cooldown between reloots. Formatted as a duration with a single unit e.g. 10h or 25m. Supports d, h, m, and s.
  - `retain-unlooted-shulker-box-loot-table-on-non-player-break`: `true`
    Configures if breaking a shulker box via non-player means, e.g. a piston, should retain the shulker box’s loot table if the shulker box has not been looted yet. Setting this option to `false` prevents players from moving shulker boxes with potentially refilling loot tables to new locations by breaking them via the likes of pistons.
- `maps`
  - `item-frame-cursor-limit`: `128` — The number of cursors (markers) allowed per map. A large number of cursors may be used to lag clients
  - `item-frame-cursor-update-interval`: `10` — The interval in ticks at which cursors on maps in item frames are updated. Setting this to a number less than 1 will disable updates altogether
- `max-growth-height`
  - `bamboo`
    - `max`: `16` — Maximum height bamboo will naturally grow to
    - `min`: `11` — Minimum height bamboo will naturally grow to
  - `cactus`: `3` — Maximum height cactus blocks will naturally grow to
  - `reeds`: `3` — Maximum height sugar cane/reeds blocks will naturally grow to
- `misc`
  - `allow-remote-ender-dragon-respawning`: `false`
    Disables an optimization which verifies that end crystals placed in the end are placed on the portal frame before any attempt is made at respawning the ender dragon. Enabling this setting allows remote ender dragon respawning to work again.
  - `alternate-current-update-order`: `HORIZONTAL_FIRST_OUTWARD`
    Controls the order in which Alternate Current updates wires and neighboring blocks. Only has an effect when using the “ALTERNATE_CURRENT” redstone implementation. This can be one of the following values:

    -   **HORIZONTAL_FIRST_OUTWARD**
    -   **HORIZONTAL_FIRST_INWARD**
    -   **VERTICAL_FIRST_OUTWARD**
    -   **VERTICAL_FIRST_INWARD**
  - `disable-end-credits`: `false` — Instructs the server to never send the end game credits when leaving the End
  - `disable-relative-projectile-velocity`: `false` — Instructs the server to ignore shooter velocity when calculating the velocity of a fired arrow
  - `disable-sprint-interruption-on-attack`: `false` — Determines if the server will interrupt a sprinting player if they are attacked. When set to true, you may be subject to a Vanilla bug where sprinting is stopped and started when attacking players.
  - `legacy-ender-pearl-behavior`: `false`
    Determines if the server uses legacy (pre-1.21.2) ender pearl behavior. If enabled, ender pearls will no longer load chunks and will be saved with the launching player instead of being saved as independent entities in the world.
  - `max-leash-distance`: `default` — Configure the maximum distance of a leash. If the distance to the leashed entity is greater, the leash will break.
  - `redstone-implementation`: `VANILLA`
    Specifies the redstone implementation that the server uses. Alternative implementations can greatly reduce the lag caused by redstone dust by optimizing power calculations and reducing the number of block and shape updates emitted. The following implementations are available:

    -   **VANILLA**: The Vanilla redstone implementation.
    -   **EIGENCRAFT**: The Eigencraft redstone implementation by theosib.
    -   **ALTERNATE_CURRENT**: The Alternate Current redstone implementation by Space Walker.

    **Note:** Both the Eigencraft and Alternate Current implementations change the behavior of redstone dust. You can read about how behavior is changed in each implementation’s respective documentation:

    -   Eigencraft: No official documentation available. However, [theosib’s comments](https://mojira.dev/MC-81098#comment-id-71035) on the Mojira bug tracker give an overview of the Eigencraft implementation.
    -   [Alternate Current](https://github.com/SpaceWalkerRS/alternate-current/blob/main/README.md)
  - `show-sign-click-command-failure-msgs-to-player`: `false` — Whether commands executed by sign click should show failure messages to players
  - `update-pathfinding-on-block-update`: `true`
    Controls whether the pathfinding of mobs is updated when a block is updated in the world. Disabling this option can improve the server performance significantly, while there is almost no noticeable effect on the game mechanics. This is recommended when there are lots of entities loaded, and you have automated farms or redstone clocks
- `scoreboards`
  - `allow-non-player-entities-on-scoreboards`: `true` — Instructs the server to always treat non-player entities as if they are never on a team. Disabling this may slightly decrease the amount of time the server spends calculating entity collisions
  - `use-vanilla-world-scoreboard-name-coloring`: `false` — Instructs the server to use the Vanilla scoreboard for player nickname coloring. Useful when playing on adventure maps made for the Vanilla server and client
- `spawn`
  - `allow-using-signs-inside-spawn-protection`: `false` — Allows players to use signs while inside spawn protection
- `tick-rates`
  - `behavior`
    - `villager`
      - `validatenearbypoi`: `-1` — Sets the tick rate of the validatenearbypoi behavior. of Villager entities
    - `<entity-type>`
      - `<behavior-name>`: `-1` — Sets the behavior tick rate of an entity. -1 uses Vanilla. See timings for the names. Might change between updates!
  - `container-update`: `1`
    The rate, in ticks, at which the server updates containers and inventories. Higher values than 1 can cause item desync/ghosting or make block breaking progress appear to reset randomly. It can also create visual artifacts mimicking server lag to clients, despite this not being the case.
  - `dry-farmland`: `1` — Controls how frequently dry farmland blocks are ticked. Higher values slow down the rate at which farmland checks for moisture updates. Default (1) uses Vanilla behavior, -1 disables dry farmland random ticks.
  - `grass-spread`: `1` — Sets the delay, in ticks, at which the server attempts to spread grass. Higher values will result in a slower spread
  - `mob-spawner`: `1` — How often mob spawners should tick to calculate available spawn areas and spawn new entities into the world. A value of -1 will disable all spawners
  - `sensor`
    - `villager`
      - `secondarypoisensor`: `40` — Sets the tick rate of the secondarypoisensor sensor of Villager entities
    - `<entity-type>`
      - `<sensor-name>`: `-1` — Sets the sensor tick rate of an entity. -1 uses Vanilla. See timings for the names. Might change between updates!
  - `wet-farmland`: `1` — Controls how frequently wet farmland blocks are ticked. Higher values slow down the rate at which farmland checks for moisture updates. Default (1) uses Vanilla behavior, -1 disables wet farmland random ticks.
- `unsupported-settings`
  **Unsupported settings**

  The following settings are provided by Paper but are not officially supported. Use them at your own risk and they may be removed at any time.

  - `disable-world-ticking-when-empty`: `false` — Stops the ticking of the world when there are no players or force loaded chunks present in the world.
  - `fix-invulnerable-end-crystal-exploit`: `true` — If set to false, the creation of invulnerable end crystals will be allowed. Fixes [MC-108513](https://mojira.dev/MC-108513)
  - `ticking`
    - `chunks`: `true` — Controls whether the server ticks chunks. This includes mob spawning, random block ticking, thunder, and ice and snow creation.
    - `block-entities`: `true` — Controls whether the server ticks block entities.
