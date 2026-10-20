---
title: "bukkit.yml"
source: "https://docs.papermc.io/paper/reference/bukkit-configuration/"
description: "An explanation of Bukkit's configuration file."
fetched_at: "2026-10-19T21:16:02.476Z"
---

# bukkit.yml

> [!NOTE] Note
> The below YAML shows you the structure and default values for `bukkit.yml`.
>
> Click on a leaf node to view the description for that setting.

- `settings`
  - `allow-end`: `true` — Whether to load end-type dimensions.
  - `warn-on-overload`: `true` — Allows disabling the “Can’t keep up!” message.
  - `permissions-file`: `permissions.yml` — File to load server permissions from. Use of this feature has mostly been replaced by permission plugins.
  - `update-folder`: `update` — Path to replace new plugin versions with. See [Updating Plugins](../../updating/index.md#step-2-update-plugins) for more information.
  - `plugin-profiling`: `false` — This option does not operate, as it is disabled by a Paper patch.
  - `connection-throttle`: `4000` — How long of a delay to enforce between connections from an IP address. Measured in milliseconds since last attempt.
  - `query-plugins`: `true` — Whether to send plugins in the GS4 Query protocol response.
  - `deprecated-verbose`: `default`
    Whether to warn for use of deprecated events. If “default”, the warning is printed if annotated with `@Warning(true)`. Ignored if system property [paper.alwaysPrintWarningState](../system-properties/index.md#paperalwaysprintwarningstate) is true. Valid values are “true”, “false”, or “default”.
  - `shutdown-message`: `Server closed` — The kick message for the player when the server shuts down. The message is formatted with legacy ”§” style formatting.
  - `minimum-api`: `none`
    Minimum plugin [api-version](../../dev/plugin-yml/index.md#api-version). A string containing the server version, from `1.13` to `26.3`. If below this, or not specified, the plugin is prevented from loading.
  - `use-map-color-cache`: `true` — Whether to build and save mappings from RGB colors to the closest map palette color.
  - `world-container`: `N/A` — Specifies the path to the folder where world files are saved. By default, this is the folder where the server JAR file is located. Note: Worlds must be manually moved to this folder for the server to recognize them.
- `spawn-limits`
  - `monsters`: `70` — Set the spawn-limits for monsters. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_monster).
  - `animals`: `10` — Set the spawn-limits for animals. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_creature).
  - `water-animals`: `5` — Set the spawn-limits for water animals. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_water_creature).
  - `water-ambient`: `20` — Set the spawn-limits for water ambient mobs. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_water_ambient).
  - `water-underground-creature`: `5`
    Set the spawn-limits for water underground creatures. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_underground_water_creature).
  - `axolotls`: `5` — Set the spawn-limits for axolotls. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_axolotls).
  - `ambient`: `15` — Set the spawn-limits for ambient mobs. This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_spawn_limits_ambient).
- `chunk-gc`
  - `period-in-ticks`: `600` — How long chunks loaded by plugins should last for. Capped by Paper to be 20 ticks (1 second).
- `ticks-per`
  - `animal-spawns`: `400`
    Number of ticks between each passive creature (animal) spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_creature).
  - `monster-spawns`: `1`
    Number of ticks between each hostile monster spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_monster).
  - `water-spawns`: `1`
    Number of ticks between each water creature spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_water_creature).
  - `water-ambient-spawns`: `1`
    Number of ticks between each ambient water mob spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_water_ambient).
  - `water-underground-creature-spawns`: `1`
    Number of ticks between each underground water creatures spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_underground_water_creature).
  - `axolotl-spawns`: `1`
    Number of ticks between each axolotl spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_axolotls).
  - `ambient-spawns`: `1`
    Number of ticks between each ambient mob spawn attempt. Set to -1 to use [the Vanilla default](https://minecraft.wiki/w/Mob_spawning#Spawn_cycle). This can be overridden by the [Paper world config](../world-configuration/index.md#entities_spawning_ticks_per_spawn_ambient).
  - `autosave`: `6000` — Number of ticks between each full auto-save. Set to -1 to disable auto-save.
- `aliases`: `now-in-commands.yml` — Static value from converting old versions to the new commands.yml format.
- `worlds`
  - `<world>`
    - `biome-provider`: `N/A`
      The biome provider to use for this world. Plugins must register a `BiomeProvider` to be used here. The format is *plugin-name:extra-parameters* or *plugin-name* if no extra parameters are needed. The plugin name is as defined in the `plugin.yml` or `paper-plugin.yml`.
    - `generator`: `N/A`
      The generator to use for this world. Plugins must register a `ChunkGenerator` to be used here. The format is *plugin-name:extra-parameters* or *plugin-name* if no extra parameters are needed. The plugin name is as defined in the `plugin.yml` or `paper-plugin.yml`.
