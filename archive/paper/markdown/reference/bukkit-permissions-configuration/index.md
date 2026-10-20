---
title: "permissions.yml"
source: "https://docs.papermc.io/paper/reference/bukkit-permissions-configuration/"
description: "An explanation of Bukkit's permissions.yml file."
fetched_at: "2026-10-19T21:16:02.582Z"
---

# permissions.yml

> [!NOTE] Note
> The below YAML shows you the structure for `permissions.yml`.
>
> Click on a leaf node to view the description for that setting.

> [!CAUTION] Caution
> This is NOT a replacement for a permissions plugin.
>
> This file is used to define metadata about permissions themselves, including a description and a default value.

- `<permission>`
  - `default`: `op`
    Who this permission is granted to by default.

    “true”: all players.

    “false”: no players.

    “op”: only operators (also aliased as “isop”, “operator”, “isoperator”, “admin”, and “isadmin”).

    “!op”: all players except operators (also aliased as “notop”, “!operator”, “notoperator”, “!admin”, “notadmin”).
  - `children`
    A list (not shown) or a map (shown below) of child permissions.

    - `<permission>`: `true`
      A child permission of this permission.

      The value is either a boolean, where false inverts the whether the permission would be granted to this.

      or a top level permission entry, except the default is this parent permissions default value, and any child permissions of the newly created permission are bubbled up to the top level.
  - `description`: `""` — The description of the permission.
