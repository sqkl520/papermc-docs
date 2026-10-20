---
title: "server.properties"
source: "https://docs.papermc.io/paper/reference/server-properties/"
description: "An explanation of Minecraft's server.properties file."
fetched_at: "2026-10-19T21:16:03.744Z"
---

# server.properties

> [!NOTE] Note
> The below page shows the settings and default values for the `server.properties` file.
>
> Click on a property to learn more about it.

- `accept-transfers`: `false` — Whether this server accepts transfers from other servers using the transfer command/packet. If this is set to false, the server will disconnect the client.
- `allow-flight`: `false` — Means that users will not be kicked if they fly whilst in Survival mode. This is likely to occur through hacking however there can be false positives.
- `broadcast-console-to-ops`: `true` — Send console command output to all online operators.
- `broadcast-rcon-to-ops`: `true` — Send rcon command output to all online operators.
- `bug-report-link` — A URL value used for the Report Server Bugs button in the Server Links client menu.
- `chat-spam-threshold-seconds`: `10` — Defines how many messages per second a player must send to be kicked for spamming. To disable this, set to 0.
- `command-spam-threshold-seconds`: `10` — Defines how many commands per second a player must send to be kicked for spamming. To disable this, set to 0.
- `debug`: `false` — Enables the server’s debug mode.
- `difficulty`: `easy` — Defines the difficulty of the server. (Allowed values: “peaceful”, “easy”, “normal”, “hard”)
- `enable-code-of-conduct`: `false`
  Whether the server will look for code of conduct files in the codeofconduct subfolder in the server folder. Each file in the folder should have the form <language_code>.txt. The server will then show the code of conduct matching the player’s language. If the language doesn’t exist, then en_us will be used. If neither exist, an arbitrary available entry will be used instead.
- `enable-jmx-monitoring`: `false`
  Exposes an MBean with the Object name “net.minecraft.server:type=Server” and two attributes “averageTickTime” and “tickTimes” exposing the tick times in milliseconds. In order for enabling JMX on the Java runtime you also need to add a couple of JVM flags to the startup as documented [here](https://docs.oracle.com/javase/8/docs/technotes/guides/management/agent.html)
- `enable-query`: `false` — Enables GameSpy4 protocol server listener. Used to get information about server.
- `enable-rcon`: `false` — Enables remote access to the server console.
- `enable-status`: `true` — Makes the server appear on the server list and also enables listener for getting server information. If turned off, server will appear offline but players will still be able to connect.
- `enforce-secure-profile`: `true` — If set to true, players without a Mojang-signed public key will not be able to connect to the server.
- `enforce-whitelist`: `false` — If set to true, the server will kick players who are not on the whitelist.
- `entity-broadcast-range-percentage`: `100`
  Controls how close entities need to be before being sent to clients. Higher values means they”ll be rendered from farther away, potentially causing more lag. This is expressed the percentage of the default value. For example, setting to 50 will make it half as usual. This mimics the function on the client video settings (not unlike Render Distance, which the client can customize so long as it”s under the server”s setting). This must be between 10 and 1000 percent.
- `force-gamemode`: `false` — Force players to join in the default game mode. This will reset their previous game mode when they reconnect.
- `function-permission-level`: `2` — Sets the default permission level for functions. (Allowed values: 1, 2, 3, 4)
- `gamemode`: `survival` — Defines the mode of gameplay. (Allowed values: “survival”, “creative”, “adventure”, “spectator”)
- `generate-structures`: `true` — Defines whether structures (such as villages) will be generated.
- `generator-settings`: `{}` — The settings used to customize world generation. Follow [its format](https://minecraft.wiki/w/Java_Edition_level_format#generatorOptions_tag_format) and write the corresponding JSON string.
- `hardcore`: `false` — If set to true, players will be set to spectator mode if they die.
- `hide-online-players`: `false` — Hides the player list sent with the status request packets.
- `initial-disabled-packs` — Comma-separated list of datapacks to not be auto-enabled on world creation.
- `initial-enabled-packs`: `vanilla` — Comma-separated list of datapacks to be enabled during world creation. Feature packs need to be explicitly enabled.
- `level-name`: `world` — The name of the world. This will be the name of the folder in which the world is saved.
- `level-seed` — The seed used to generate the world. Leave blank to default to random.
- `level-type`: `minecraft:normal` — Defines the type of the world generator. (Allowed values: “normal”, “flat”, “large_biomes”, “amplified”, “single_biome_surface”, “buffet”, “default_1_1”, “customized”)
- `log-ips`: `true` — Whether player IP addresses should be logged by the server. This does not impact the ability of plugins to log the IP addresses of players
- `management-server-enabled`: `false` — Whether the [Minecraft Server Management Protocol](https://minecraft.wiki/w/Minecraft_Server_Management_Protocol) is enabled.
- `management-server-host`: `localhost` — Controls the host that the Minecraft Server Management Protocol is started.
- `management-server-port`: `0` — Controls the port that the Minecraft Server Management Protocol is started on.
- `management-server-secret` — Allows for clients to supply an Authorization header with a server specific secret, which is forty alphanumeric characters long (A-Z, a-z, and 0-9). The secret is automatically generated if the property is left empty.
- `management-server-tls-enabled`: `true` — Controls whether the Minecraft Server Management Protocol uses TLS (Transport Layer Security).
- `management-server-tls-keystore` — Controls the path to the keystore file used for TLS. A server will not start when TLS is enabled and no keystore is provided.
- `management-server-tls-keystore-password`
  Controls the password to the keystore file used for TLS. The password can be done through an environment variable (MINECRAFT_MANAGEMENT_TLS_KEYSTORE_PASSWORD), a Java Virtual Machine argument (-Dmanagement.tls.keystore.password=), or through this server property.
- `max-chained-neighbor-updates`: `1000000` — Limits the number of consecutive neighbor updates before skipping subsequent updates. Negative values will disable the limit.
- `max-players`: `20` — The maximum number of players that can play on the server at the same time.
- `max-tick-time`: `60000`
  The maximum number of milliseconds a single tick may take before the server watchdog stops the server with the message. If a single server tick took 60.00 seconds (should be max 0.05) it will be considered to be crashed and the server will forcibly shutdown via calling System.exit(1). Setting this to -1 will disable watchdog entirely.
- `max-world-size`: `29999984` — The maximum allowed size of the world radius, in blocks. This only affects the chunks that are generated when the world is initially created, and not the world border (Limited to 29999984).
- `motd`: `A Minecraft Server` — The message of the day, displayed in the server list.
- `network-compression-threshold`: `256` — The number of bytes of a packet before it is compressed. Setting to a negative disables compression.
- `online-mode`: `true` — If set to true, the server checks all connecting players against Minecraft”s account database. This requires all connected players to have a valid Minecraft account and makes it impossible for cracked players to connect.
- `op-permission-level`: `4` — Sets the default permission level for ops when using /op. (Allowed values: 0, 1, 2, 3, 4)
- `pause-when-empty-seconds`: `-1` — How many seconds have to pass after no player has been online before the server is paused. This is disabled by default because it is incompatible with what plugins expect and might do with no players online.
- `player-idle-timeout`: `0`
  If non-zero, players are kicked from the server if they are idle for more than that many minutes. (Default: 0). The following packets stop this timer: “Click Window”, “Enchant Item”, “Update Sign”, “Player Digging”, “Player Block Placement”, “Held Item Change”, “Animation (swing arm)”, “Entity Action”, “Client Status”, “Chat Message”, “Use Entity”.
- `prevent-proxy-connections`: `false` — If the ISP/AS sent from the server is different from the one from Mojang Studios” authentication server, the player not allowed to join the server.
- `query.port`: `25565` — The port for the query server. This is used to get information about the server.
- `rate-limit`: `0` — Sets the maximum allowed number of packets that can be sent before getting kicked. Setting this to 0 disables the limit.
- `rcon.password` — The password for the rcon server.
- `rcon.port`: `25575` — The port to start the rcon server on.
- `region-file-compression`: `deflate`
  Specifies the compression type used to compress region files. Possible values are: “deflate”, “lz4”, “none” and “gzip” (only available on Paper). If set to “none”, region files will take up significantly more disk space, but it might make sense together with filesystem-level compression.
- `require-resource-pack`: `false` — If true, a player must have the given resource pack to connect. They will be kicked if they do not have it.
- `resource-pack` — The URL to the server’s resource pack.
- `resource-pack-id` — The UUID of the server resource pack to use.
- `resource-pack-prompt` — The message that is displayed when the client is prompted to download the resource pack.
- `resource-pack-sha1` — The hash of the resource pack, used for verification. This is recommended to be set to ensure players are downloading the correct pack.
- `server-ip` — The IP address to bind to. Leave blank to bind to all interfaces.
- `server-port`: `25565` — The port to listen on for connections.
- `simulation-distance`: `10`
  Sets the maximum distance from players that living entities may be located in order to be updated by the server, measured in chunks in each direction of the player (radius, not diameter). If entities are outside this radius, then they will not be ticked by the server nor will they be visible to players. Must be between 3 and 32 inclusive.
- `spawn-protection`: `16`
  Used to determine the side length of the spawn protection. The formula of 2x+1 is used. A value of 1 will result in a side length of 3 **blocks**. Setting this to 0 will disable spawn protection. There must be at least 1 operator to be enabled.
- `status-heartbeat-interval`: `0` — Controls the intervals in which the management server sends heartbeat notifications to connected clients. It is disabled by default.
- `sync-chunk-writes`: `true`
  Enables synchronous writing of chunk data. Has no effect on Paper by default, unless the corresponding system property is also set to true. See [the system properties reference](../system-properties/index.md#paperenable-sync-chunk-writes).
- `text-filtering-config` — The path to the text filtering configuration file. Leave blank to disable text filtering.
- `text-filtering-version`: `0` — The version of the configuration format used for [`text-filtering-config`](#text_filtering_config). Valid values are 0 and 1.
- `use-native-transport`: `true` — Provides a performance boost for Linux servers.
- `view-distance`: `10` — Sets the amount of world data the server sends the client, measured in chunks in each direction of the player (radius, not diameter). It determines the server-side viewing distance (Default: 10, Min: 3, Max: 32).
- `white-list`: `true` — Enables a whitelist on the server. If enabled, the server will only allow selected users to connect.
