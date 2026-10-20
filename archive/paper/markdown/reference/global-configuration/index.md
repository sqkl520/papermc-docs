---
title: "Global configuration"
source: "https://docs.papermc.io/paper/reference/global-configuration/"
description: "An explanation of Paper's global configuration file."
fetched_at: "2026-10-19T21:16:03.048Z"
---

# Global configuration

> [!NOTE] Note
> The below YAML shows you the structure and default values for the global configuration (`config/paper-global.yml`).
>
> Click on a leaf node to view the description for that setting.

- `anticheat`
  - `obfuscation`
    - `items`
      - `all-models`
        - `also-obfuscate`: `[]`
          Controls additional data components which should be hidden for all items from other players. It’s generally not recommended to configure this unless you know what you are doing, as you may change how items look to other players.
        - `dont-obfuscate`:
          ```yaml
           - minecraft:lodestone_tracker
          ```
          Controls which data components should not be hidden for all items from other players. This is because they may slightly change the item’s appearance, so hiding it isn’t warranted. In this example, lodestone trackers may reveal critical locations, but hiding the location causes the compass to shake around for other players. It’s up to your digression whether you think this tradeoff is important.
        - `sanitize-count`: `true` — Controls whether the item’s count should be hidden from other players.
      - `enable-item-obfuscation`: `false`
        Controls whether unnecessary item information (such as enchantments, lore, etc.) that can give cheat clients an advantage should be sent to other players’ clients. This may break resource packs that rely on information such as enchantments, lore or item names when observing other players. The hidden data components can be extended or reduced via `also-obfuscate` and `dont-obfuscate` respectively.
      - `model-overrides`
        - `minecraft:elytra`
          - `also-obfuscate`: `[]` — Controls the components that should also be obfuscated for items with the item model of `minecraft:elytra`. This may be useful if you want to hide certain components not important to other players.
          - `dont-obfuscate`: — Controls the components that should not be obfuscated for items with the item model of `minecraft:elytra`. This defaults to `minecraft:damage` as elytras with 1 durability have a special texture.
            ```yaml
             - minecraft:damage
            ```
          - `sanitize-count`: `true` — Controls whether the item count of items with the model `minecraft:elytra` should be hidden from other players.
- `block-updates`
  - `disable-chorus-plant-updates`: `false`
    Whether to disable any form of block updates for chorus plants on the server. Disabling block updates leads to chorus plants no longer updating their block state, allowing for technically invalid chorus plant configurations to remain in the world, which might be useful for mapmakers.
  - `disable-mushroom-block-updates`: `false`
    Whether to disable any form of block updates for mushroom blocks on the server. Disabling block updates leads to mushroom blocks no longer updating their block state, allowing for technically invalid mushroom block configurations to remain in the world, which might be useful for mapmakers.
  - `disable-noteblock-updates`: `false`
    Whether to disable any form of block updates for note blocks on the server. Disabling block updates leads to note blocks no longer updating their block state, allowing for technically invalid note blocks to remain in the world, which might be useful for mapmakers.
  - `disable-tripwire-updates`: `false`
    Whether to disable any form of block updates for tripwires on the server. Disabling block updates leads to tripwires no longer updating their block state, allowing for technically invalid tripwires to remain in the world, which might be useful for mapmakers.
- `chunk-loading-advanced`
  - `auto-config-send-distance`: `true` — Set to true if the server will match the chunk send radius that clients have configured in their view distance settings if the client is less-than the server’s send distance.
  - `player-max-concurrent-chunk-generates`: `0` — Specifies the maximum amount of concurrent chunk generations that an individual player can have. Set to 0 to let the server configure it automatically per player, or set it to -1 to disable the limit.
  - `player-max-concurrent-chunk-loads`: `0` — Specifies the maximum amount of concurrent chunk loads that an individual player can have. Set to 0 to let the server configure it automatically per player, or set it to -1 to disable the limit.
- `chunk-loading-basic`
  - `player-max-chunk-generate-rate`: `-1.0` — The maximum rate at which chunks will generate for any individual player. Set to -1 to disable this limit.
  - `player-max-chunk-load-rate`: `100`
    The maximum rate at which chunks will load for any individual player. Note that this setting also affects chunk generations, since a chunk load is always first issued to test if a chunk is already generated. Set to -1 to disable this limit.
  - `player-max-chunk-send-rate`: `75` — The maximum rate in chunks per second that the server will send to any individual player. Set to -1 to disable this limit.
- `chunk-system`
  - `io-threads`: `-1` — Sets the number of threads to be used for read and write operations with chunks. If any value below zero is set, only one thread will be used.
  - `worker-threads`: `-1`
    Sets the number of threads to be used for parallel chunk generation. If a value below zero is set, the server will automatically determine the optimal number of threads based on the available physical CPU cores (**not logical cores**). For systems with 3 or fewer physical cores, only 1 thread will be used. In all other cases, the number of threads is capped at half of the physical cores.
- `collisions`
  - `enable-player-collisions`: `true` — Sets whether the server should allow players to collide with one another. This option can be broken by plugins interacting with the scoreboard. If you are having trouble with this option, try without plugins installed
  - `send-full-pos-for-hard-colliding-entities`: `true`
    Collisions with boats and minecarts are often subject to client/server disagreement, which may cause glitchy behavior for players. This setting attempts to mitigate this desync by sending precise locations for entities involved in collisions. Having this enabled will use more bandwidth; however, in the majority of cases, this is a worthy tradeoff
- `commands`
  - `ride-command-allow-player-as-vehicle`: `false` — Allow mounting entities to a player in the Vanilla `/ride` command.
  - `suggest-player-names-when-null-tab-completions`: `true` — Instructs the server to return a list of players when tab-completing when there are no other completions available
- `console`
  - `enable-brigadier-completions`: `true` — Enables Mojang’s Brigadier (advanced) command completions in the server console
  - `enable-brigadier-highlighting`: `true` — Enables Mojang’s Brigadier highlighting in the server console
  - `has-all-permissions`: `false` — Whether the console command sender has all permissions
- `item-validation`
  - `book`
    - `author`: `8192` — The maximum length of a book’s author in characters
    - `page`: `16384` — The maximum length of a book’s page in characters
    - `title`: `8192` — The maximum length of a book’s title in characters
  - `book-size`
    - `page-max`: `2560` — The max number of bytes a single page in a book can contribute to the allowed byte total for a book, or “disabled” to disable non-vanilla restrictions on the book size.
    - `total-multiplier`: `0.98` — Each page has this multiple of bytes from the last page as its contribution to the allowed byte total for a book (with the first page being having a multiplier of 1.0)
  - `display-name`: `8192` — The maximum length of an item’s display name in characters
  - `lore-line`: `8192` — The maximum length of a lore line in characters
  - `resolve-selectors-in-books`: `false` — Whether to resolve selectors in books. With this enabled, players given creative mode will be able to crash the server in yet another way
- `messages`
  - `kick`
    - `authentication-servers-down`: `<lang:multiplayer.disconnect.authservers_down>` — Message sent to players when Mojang’s authentication servers are unreachable. Formatted using [MiniMessage](https://docs.papermc.io/adventure/minimessage/).
    - `connection-throttle`: `Connection throttled! Please wait before reconnecting.` — Message sent to players when they are throttled for connecting too frequently. Formatted using [MiniMessage](https://docs.papermc.io/adventure/minimessage/).
    - `flying-player`: `<lang:multiplayer.disconnect.flying>` — Message sent to players who are detected flying. Formatted using [MiniMessage](https://docs.papermc.io/adventure/minimessage/).
    - `flying-vehicle`: `<lang:multiplayer.disconnect.flying>` — Message sent to players who are detected riding a flying vehicle. Formatted using [MiniMessage](https://docs.papermc.io/adventure/minimessage/).
  - `no-permission`: `<red>I'm sorry, but you do not have permission to perform this command. Please contact the server administrators if you believe that this is in error.` — Default message sent to players when they have insufficient permissions for an action, formatted with [MiniMessage](https://docs.papermc.io/adventure/minimessage/). Plugins may override this for their commands
  - `use-display-name-in-quit-message`: `false` — Whether the server should use the player’s display name (set by plugins) or actual name in quit messages
- `misc`
  - `catchup-ticks`: `default` — Sets the maximum number of ticks the server can speedup after a lag spike. A value of “default” defaults to 5. Set to 0 to disable the catchup.
  - `chat-threads`
    - `chat-executor-core-size`: `-1` — Sets the core number of threads in the chat thread pool. Values smaller than 0 will have the same effect as 0.
    - `chat-executor-max-size`: `-1` — Limits the number of allowed threads in the chat thread pool. Values Smaller or equal to 0 result in no limit.
  - `client-interaction-leniency-distance`: `default` — Defines the leniency distance added on the server to the interaction range of a player when validating interact packets.
  - `compression-level`: `default` — Sets the compression level. A value of “default” defaults to -1, resulting in no compression.
  - `enable-nether`: `true` — Whether the nether dimension is enabled and will be loaded.
  - `load-permissions-yml-before-plugins`: `true` — Loads bukkit’s permission.yml file before plugins, allowing them to check information set there immediately on enable
  - `max-joins-per-tick`: `5`
    Sets the maximum amount of players that may join the server in a single tick. If more players join, they will be postponed until later ticks to join but not kicked. This is not related to connection throttling found in bukkit.yml
  - `max-tracking-combat-entries`: `10240` — The maximum number of combat entries that the server will track. Older entries will be discarded.
  - `prevent-negative-villager-demand`: `false` — Fixes [MC-163962](https://mojira.dev/MC-163962). Prevents the villager demand from going negative, but may introduce parity issues with Vanilla.
  - `region-file-cache-size`: `256` — The maximum size of the region file cache
  - `strict-advancement-dimension-check`: `false` — Disables the attempts to translate worlds that use the same generation as the Overworld, The Nether, or The End to general dimensions rather than the specific dimension key of the world.
  - `use-alternative-luck-formula`: `false` — Use an [alternative luck formula](https://gist.github.com/aikar/40281f6c73ec9b6fef7588e6461e1ba9) allowing luck to be applied to items that have no quality defined. Makes major changes to fishing formulas
  - `use-dimension-type-for-custom-spawners`: `false` — Whether phantoms, wandering traders, etc. should be able to spawn in custom overworlds. Defaults to false in order to match Vanilla behavior
  - `xp-orb-groups-per-area`: `default` — The amount of equal value experience orb groups that can exist in a given area. By default, the server uses 40. Experience orbs that do not share the same value will not be merged by Vanilla’s merging algorithm.
- `packet-limiter`
  - `all-packets`
    - `action`: `KICK` — The action to take once the limit has been violated. Possible values are DROP which will ignore packets over the limit, and KICK which will kick players for exceeding the limit
    - `interval`: `7.0` — The interval, in seconds, for which max-packet-rate should apply
    - `max-packet-rate`: `500.0` — The number of packets allowed per player within the interval
  - `kick-message`: `<red><lang:disconnect.exceeded_packet_rate>` — The message players are kicked with for sending too many packets. Formatted using [MiniMessage](https://docs.papermc.io/adventure/minimessage/).
  - `overrides`
    Override the **action**, **interval**, and **max-packet-rate** configuration for any individual serverbound packet. You can find the identifiers for packets on the [wiki](https://minecraft.wiki/w/Java_Edition_protocol/Packets).

    - `minecraft:place_recipe`
      - `action`: `KICK` — The action to take once the limit has been violated. Possible values are DROP which will ignore packets over the limit, and KICK which will kick players for exceeding the limit
      - `interval`: `7.0` — The interval, in seconds, for which max-packet-rate should apply
      - `max-packet-rate`: `500.0` — The number of packets allowed per player within the interval
- `player-auto-save`
  - `max-per-tick`: `-1` — How many players should be saved at most in a single tick. A value of -1 will set a recommended value based on player-auto-save.rate of either 10 or 20
  - `rate`: `-1` — How often player data should be saved in ticks. A value of -1 will use ticks-per.autosave in bukkit.yml
- `proxies`
  - `bungee-cord`
    - `online-mode`: `true` — Instructs the server how to handle player UUIDs and data when behind BungeeCord. Always set to match your proxy’s online-mode setting
  - `proxy-protocol`: `false`
    Whether the server should process [PROXY Protocol](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt) messages. This is completely unrelated to Velocity or BungeeCord. Only enable this if you are using HAProxy or similar
  - `velocity`
    - `enabled`: `false` — Whether the server should accept Velocity Modern Forwarding
    - `online-mode`: `true` — Instructs the server how to handle player UUIDs and data when behind Velocity. Always set to match your proxy’s online-mode setting
    - `secret`: `""` — The secret string that is shared by your Velocity proxy and this server. This needs to match your proxy’s secret as defined in the forwarding.secret file
- `scoreboards`
  - `save-empty-scoreboard-teams`: `true` — Some scoreboard plugins leave hundreds of empty scoreboard teams around, dramatically slowing down login times. This sets whether the server should remove those empty teams automatically
  - `track-plugin-scoreboards`: `false`
    Whether the server should track plugin scoreboards with only dummy objectives. This is a breaking change; however, it provides a much more sensible default value. Enabling this with plugins using many scoreboards will incur a performance degradation
- `spam-limiter`
  - `incoming-packet-threshold`: `300` — Sets the threshold at which the server will consider incoming packets spam and ignore them
  - `recipe-spam-increment`: `1` — The number that the recipe spam counter increases by when a player presses a recipe
  - `recipe-spam-limit`: `20` — The number that the recipe spam counter can reach until the server kicks the player for spam
  - `tab-spam-increment`: `1` — The number that the internal tab spam counter increases by when a player presses tab in the chat window
  - `tab-spam-limit`: `500` — The number that the internal tab spam counter can reach until the server kicks the player for spam
- `spark`
  - `enable-immediately`: `false`
    Whether the bundled spark profiler should be enabled as soon as possible. This can be useful for profiling the server during startup. By default, spark is enabled once the server has finished starting up (when the **Done (X.XXXs)! For help, type “help”** message is sent in the console).
  - `enabled`: `true` — Whether the bundled spark profiler should be enabled.
- `time`
  - `affects-all-worlds`: `false`
    Whether the worlds share a clock by dimension type or each runs independently. This for example affects the time command where it should act on all worlds or just the sender’s current world. This also affects World time API.
- `unsupported-settings`
  **Unsupported settings**

  The following settings are provided by Paper but are not officially supported. Use them at your own risk and they may be removed at any time.

  - `allow-headless-pistons`: `false` — Whether the server should allow the creation of headless pistons. These are often used to break permanent blocks
  - `allow-permanent-block-break-exploits`: `false` — Whether unbreakable blocks can be broken with Vanilla exploits. This includes bedrock, end portal frames, end portal blocks, and more
  - `allow-piston-duplication`: `false` — Whether to allow duplication of TNT, carpets, and rails. This does not control sand duplication
  - `allow-unsafe-end-portal-teleportation`: `false` — This setting allows for exploits related to end portal teleportation to be possible, for example sand duplication. This setting is not recommended to be enabled, but is provided for those who wish to use it.
  - `oversized-item-component-sanitizer`
    - `dont-sanitize`: `[]`
      This setting defines which item data components shouldn’t be sanitized in oversized item obfuscation. Changing this re-enables exploits, but may be needed for certain resource packs. Possible values: `minecraft:container`, `minecraft:charged_projectiles`, `minecraft:bundle_contents`
  - `perform-username-validation`: `true` — Whether the server should validate usernames. While this may allow users with special characters in their name to join, it can also cause issues with commands and plugins
  - `skip-tripwire-hook-placement-validation`: `false` — This setting allows for exploits related to tripwire hook duping to be enabled.
  - `skip-vanilla-damage-tick-when-shield-blocked`: `false`
    Whether the server should skip damage ticks when entities are blocking damage via a shield. While Vanilla does process a damage tick, this behavior was a long standing bug in Paper. Enabling this option means that the damage tick will be skipped, which may result in rapid damage on shields due to the missing invulnerability.
  - `update-equipment-on-player-actions`: `true` — This setting controls if equipment should be updated when handling certain player actions. If set to false this will allow players to exploit attributes by e.g. switching equipment before using it.
- `update-checker`
  - `enabled`: `true` — Whether Paper should check for updates automatically on startup. See [here](../../misc/update-checker/index.md) for more information.
- `watchdog`
  - `early-warning-delay`: `10000` — The number of milliseconds before the watchdog thread starts printing thread dumps after the server starts hanging
  - `early-warning-every`: `5000` — The interval in milliseconds between printed thread dumps while the server is hanging
