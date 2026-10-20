---
title: "Vanilla-like experience"
source: "https://docs.papermc.io/paper/vanilla/"
description: "This page lists all changes that result in a different experience than Vanilla."
fetched_at: "2026-10-19T21:16:04.783Z"
---

# Vanilla-like experience

Due to the way the Bukkit API is implemented in Paper, the gameplay experience between Vanilla and Paper can have inconsistencies. This can be furthered by efforts to fix bugs present in Vanilla Minecraft. Whilst many people may not notice the inconsistencies, there are situations where they become problematic. One example is that technical players may struggle getting their machines to work like they should. This page aims to provide a starting point for players who want to get as close to Vanilla as possible.

> [!NOTE] Note
> This page is inspired by [Earthcomputer’s collection](https://gist.github.com/Earthcomputer/2296da33b8cc91dba81b48103c0e1fe3) of Vanilla breaking changes.

> [!CAUTION] Caution
> This guide will only help you to get as close to Vanilla as possible. Unfortunately, it currently is not possible to get a 100% Vanilla experience in Paper.

## server.properties

- `pause-when-empty-seconds`: `60` — How many seconds have to pass after no player has been online before the server is paused. This is disabled by default because it is incompatible with what plugins expect and might do with no players online.

## paper-world-defaults.yml

- `chunks`
  - `delay-chunk-unloads-by`: `0s` — Delays chunk unloads by the specified time. Formatted as a duration with a single unit e.g. 10h or 25m. Supports d, h, m, and s.
  - `max-auto-save-chunks-per-tick`: `200` — The maximum number of chunks the auto-save system will save in a single tick
  - `min-chunk-unload-count`: `2147483647`
    The minimum number of eligible chunks to unload each tick. The chunks will unload from world chunk map, and save to disk asynchronously. See min-chunk-unload-fraction for more. Increasing these takes more tick time on chunk unloading, but may help with memory usage in specific scenarios.
- `collisions`
  - `allow-player-cramming-damage`: `true` — Allows players to take damage from cramming when colliding with more entities than set in the maxEntityCramming game rule
  - `max-entity-collisions`: `2147483647` — Instructs the server to stop processing collisions after this value is reached
- `entities`
  - `behavior`
    - `cooldown-failed-beehive-releases`: `false` — Adds a cooldown to bees being released after a failed release, which can occur if the hive is blocked or it being night.
    - `only-merge-items-horizontally`: `true` — Prevents merging items that are not on the same y level, preventing potential visual artifacts.
    - `phantoms-do-not-spawn-on-creative-players`: `false` — Disables spawning of phantoms on players in creative mode
    - `phantoms-only-attack-insomniacs`: `false` — Prevents phantoms from attacking players who have slept
    - `stuck-entity-poi-retry-delay`: `disabled` — The delay before retrying POI acquisition when entity navigation is stuck. This will reduce pathfinding performance impact. Measured in ticks.
  - `spawning`
    - `max-arrow-despawn-invulnerability`: `disabled` — Workaround for [MC-125757](https://mojira.dev/MC-125757), makes all arrows advance their despawn timer as if they were stuck in the ground, after a delay (in ticks).
    - `count-all-mobs-for-spawning`: `true` — Determines whether spawner mobs and other misc mobs are counted towards the global mob limit
    - `duplicate-uuid`
      - `mode`: `NOTHING`
        Specifies the method the server uses to resolve entities with duplicate UUIDs. This can be one of the following values:

        -   **SAFE_REGEN**: Regenerate a UUID for the entity, or delete it if they are close.
        -   **DELETE**: Delete the entity.
        -   **NOTHING**: Does nothing, not printing logs.
        -   **WARN**: Does nothing, printing logs
    - `filter-bad-tile-entity-nbt-from-falling-blocks`: `false` — Instructs the server to remove certain NBT data from falling blocks. **Note**: Some adventure maps may require this to be turned off to function correctly, but we do not recommend turning it off on a public server
    - `filtered-entity-tag-nbt-paths`: `[]`
      A list of NBT tags that will be removed from the “entity_data” component on items which spawn entities. The format of these strings follows the same format used to select NBT tags in Vanilla commands. If the spawning was directly caused by a player and the player has the minecraft.nbt.place permission, the filter list will be ignored. The defaults are set to prevent entities from spawning or moving to a place other than the location they were placed. For example, if Pos wasn’t included, a spawn egg could place an entity at any location. **Note**: Some adventure maps may require this to be an empty list to function correctly, but we do not recommend turning it off on a public server
    - `per-player-mob-spawns`: `false`
      Determines whether the mob limit (in bukkit.yml) is counted per player or for the entire server. Enabling this setting results in roughly the same number of mobs, but with a more even distribution that prevents one player from using the entire mob cap and provides a more single-player like experience
- `hopper`
  - `cooldown-when-full`: `false` — Instructs the server to apply a short cooldown when the hopper is full, instead of constantly trying to pull new items
- `maps`
  - `item-frame-cursor-limit`: `2147483647` — The number of cursors (markers) allowed per map. A large number of cursors may be used to lag clients
- `misc`
  - `allow-remote-ender-dragon-respawning`: `true`
    Disables an optimization which verifies that end crystals placed in the end are placed on the portal frame before any attempt is made at respawning the ender dragon. Enabling this setting allows remote ender dragon respawning to work again.
- `scoreboards`
  - `use-vanilla-world-scoreboard-name-coloring`: `true` — Instructs the server to use the Vanilla scoreboard for player nickname coloring. Useful when playing on adventure maps made for the Vanilla server and client
- `unsupported-settings`
  **Unsupported settings**

  The following settings are provided by Paper but are not officially supported. Use them at your own risk and they may be removed at any time.

  - `disable-world-ticking-when-empty`: `true` — Stops the ticking of the world when there are no players or force loaded chunks present in the world.
  - `fix-invulnerable-end-crystal-exploit`: `false` — If set to false, the creation of invulnerable end crystals will be allowed. Fixes [MC-108513](https://mojira.dev/MC-108513)

## paper-global.yml

- `commands`
  - `suggest-player-names-when-null-tab-completions`: `false` — Instructs the server to return a list of players when tab-completing when there are no other completions available
- `item-validation`
  - `book`
    - `author`: `2147483647` — The maximum length of a book’s author in characters
    - `page`: `2147483647` — The maximum length of a book’s page in characters
    - `title`: `2147483647` — The maximum length of a book’s title in characters
  - `book-size`
    - `page-max`: `disabled` — The max number of bytes a single page in a book can contribute to the allowed byte total for a book, or “disabled” to disable non-vanilla restrictions on the book size.
  - `display-name`: `2147483647` — The maximum length of an item’s display name in characters
  - `lore-line`: `2147483647` — The maximum length of a lore line in characters
  - `resolve-selectors-in-books`: `true` — Whether to resolve selectors in books. With this enabled, players given creative mode will be able to crash the server in yet another way
- `misc`
  - `max-joins-per-tick`: `2147483647`
    Sets the maximum amount of players that may join the server in a single tick. If more players join, they will be postponed until later ticks to join but not kicked. This is not related to connection throttling found in bukkit.yml
  - `max-tracking-combat-entries`: `disabled` — The maximum number of combat entries that the server will track. Older entries will be discarded.
- `packet-limiter`
  - `all-packets`
    - `interval`: `-1` — The interval, in seconds, for which max-packet-rate should apply
  - `overrides`
    Override the **action**, **interval**, and **max-packet-rate** configuration for any individual serverbound packet. You can find the identifiers for packets on the [wiki](https://minecraft.wiki/w/Java_Edition_protocol/Packets).

    - `minecraft:place_recipe`
      - `interval`: `-1` — The interval, in seconds, for which max-packet-rate should apply
- `spam-limiter`
  - `incoming-packet-threshold`: `disabled` — Sets the threshold at which the server will consider incoming packets spam and ignore them
- `time`
  - `affects-all-worlds`: `true`
    Whether the worlds share a clock by dimension type or each runs independently. This for example affects the time command where it should act on all worlds or just the sender’s current world. This also affects World time API.
- `unsupported-settings`
  **Unsupported settings**

  The following settings are provided by Paper but are not officially supported. Use them at your own risk and they may be removed at any time.

  - `allow-headless-pistons`: `true` — Whether the server should allow the creation of headless pistons. These are often used to break permanent blocks
  - `allow-permanent-block-break-exploits`: `true` — Whether unbreakable blocks can be broken with Vanilla exploits. This includes bedrock, end portal frames, end portal blocks, and more
  - `allow-piston-duplication`: `true` — Whether to allow duplication of TNT, carpets, and rails. This does not control sand duplication
  - `allow-unsafe-end-portal-teleportation`: `true` — This setting allows for exploits related to end portal teleportation to be possible, for example sand duplication. This setting is not recommended to be enabled, but is provided for those who wish to use it.
  - `oversized-item-component-sanitizer`
    - `dont-sanitize`:
      ```yaml
       - minecraft:container
       - minecraft:charged_projectiles
       - minecraft:bundle_contents
      ```
      This setting defines which item data components shouldn’t be sanitized in oversized item obfuscation. Changing this re-enables exploits, but may be needed for certain resource packs. Possible values: `minecraft:container`, `minecraft:charged_projectiles`, `minecraft:bundle_contents`
  - `perform-username-validation`: `false` — Whether the server should validate usernames. While this may allow users with special characters in their name to join, it can also cause issues with commands and plugins
  - `skip-tripwire-hook-placement-validation`: `true` — This setting allows for exploits related to tripwire hook duping to be enabled.
  - `update-equipment-on-player-actions`: `false` — This setting controls if equipment should be updated when handling certain player actions. If set to false this will allow players to exploit attributes by e.g. switching equipment before using it.

## spigot.yml

- `world-settings`
  - `default`
    - `entity-activation-range`
      The distance in blocks from a player at which entities tick normally. Outside this range, entities tick less frequently. Set to 0 or less to disable activation-range throttling for loaded entities in that category, causing them to tick normally regardless of player distance.

      - `animals`: `0` — The entity activation range for animals.
      - `monsters`: `0` — The entity activation range for monsters.
      - `raiders`: `0` — The entity activation range for raiders.
      - `misc`: `0` — The entity activation range for miscellaneous entities, including dropped items. Outside of this range, items moving through water streams may appear to visually lag, rubber-band, or move backward.
      - `water`: `0` — The entity activation range for water mobs.
      - `villagers`: `0` — The entity activation range for villagers.
      - `flying-monsters`: `0` — The entity activation range for flying monsters.
    - `max-tnt-per-tick`: `-1` — How many TNT to process per server tick. Set to 0 or less to disable.

## Further considerations

-   `settings.timeout-time` in `spigot.yml` mirrors the watchdog setting in the `server.properties` file. Keep in mind that the `spigot.yml` setting is in seconds while the default setting is in milliseconds.
-   `watchdog` in `paper-global.yml` controls the watchdog early warning. While this is only a warning, you might want to disable it as it can get annoying.
