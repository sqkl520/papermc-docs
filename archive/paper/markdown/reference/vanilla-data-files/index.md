---
title: "Vanilla data files"
source: "https://docs.papermc.io/paper/reference/vanilla-data-files/"
description: "An explanation of Minecraft's data files."
fetched_at: "2026-10-19T21:16:04.197Z"
---

# Vanilla data files

## `eula.txt`

`eula.txt` is a simple config file that allows you to accept the [EULA](https://aka.ms/MinecraftEULA), which is required to run the Minecraft server.


```
#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
```

- `eula`: `false` — Whether to accept the Minecraft EULA. This must be set to “true” to run the server.

## `banned-ips.json`

`banned-ips.json` is a JSON file that stores IP addresses that are not allowed to connect to the server.

> [!CAUTION] Caution
> This is a data file used by the server, not a configuration file.
>
> We do not recommend editing this file directly, and this is provided for reference only.
>
> Instead, use the `/ban-ip`, `/pardon-ip`, and `/banlist ips` commands to manage banned-ips.json.

This is a single entry in the root array found in banned-ips.json.

- `"ip"`: `an IPv4 or IPv6 address`
  The IP address representing the banned user.

  For IPv4 the expected format is “x.x.x.x”,

  For IPv6 the expected format follows [RFC5952 Section 4](https://datatracker.ietf.org/doc/html/rfc5952#section-4),

  For anything else, “<unknown>” may be present (but its use is discouraged).
- `"created"`: `the ban creation time` — A timestamp of when the user was banned. The expected format is “yyyy-MM-dd HH:mm:ss Z”.
- `"source"`: `"(Unknown)"` — A string representing the source of the ban.
- `"expires"`: `"forever"`
  A timestamp of when the ban expires, or “forever” if it does not expire.

  The expected format is “yyyy-MM-dd HH:mm:ss Z”.
- `"reason"`: `"Banned by an operator."` — The reason for the ban.

## `banned-players.json`

`banned-players.json` is a JSON file that stores players that are not allowed to connect to the server.

> [!CAUTION] Caution
> This is a data file used by the server, not a configuration file.
>
> We do not recommend editing this file directly, and this is provided for reference only.
>
> Instead, use the `/ban`, `/pardon`, and `/banlist players` commands to manage banned-players.json.

This is a single entry in the root array found in banned-players.json.

- `"uuid"`: `the UUID of the banned user` — The UUID representing the banned user.
- `"name"`: `the name of the banned user` — The name of the banned user.
- `"created"`: `the ban creation time` — A timestamp of when the user was banned. The expected format is “yyyy-MM-dd HH:mm:ss Z”.
- `"source"`: `"(Unknown)"` — A string representing the source of the ban.
- `"expires"`: `"forever"`
  A timestamp of when the ban expires, or “forever” if it does not expire.

  The expected format is “yyyy-MM-dd HH:mm:ss Z”.
- `"reason"`: `"Banned by an operator."` — The reason for the ban.

## `ops.json`

`ops.json` is a JSON file that stores player’s operator status information.

In Vanilla, this is used as a rudimentary permissions system, and to allow certain player to bypass the player limit.

> [!CAUTION] Caution
> This is a data file used by the server, not a configuration file.
>
> We do not recommend editing this file directly, and this is provided for reference only.
>
> Instead, use the `/op`, `/deop` commands to manage ops.json.

This is a single entry in the root array found in ops.json.

- `"uuid"`: `the UUID of the operator` — The UUID representing the operator.
- `"name"`: `the name of the operator` — The name of the operator.
- `"level"`: `0`
  The level of the operator permissions.

  The expected format is an integer between 0 and 4.
- `"bypassesPlayerLimit"`: `false` — Whether this operator bypasses the player limit.

## `whitelist.json`

`whitelist.json` is a JSON file that stores players that are allowed to connect to the server.

It is used in conjunction with the [`white-list`](../server-properties/index.md#white_list) option in `server.properties`.

> [!CAUTION] Caution
> This is a data file used by the server, not a configuration file.
>
> We do not recommend editing this file directly, and this is provided for reference only.
>
> Instead, use the `/whitelist` command to manage whitelist.json.

This is a single entry in the root array found in whitelist.json.

- `"uuid"`: `the UUID of the player on the whitelist` — The UUID of the player on the whitelist.
- `"name"`: `the name of the player on the whitelist` — The name of the player on the whitelist.
