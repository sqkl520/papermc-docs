---
title: "commands.yml"
source: "https://docs.papermc.io/paper/reference/bukkit-commands-configuration/"
description: "An explanation of Bukkit's commands.yml file."
fetched_at: "2026-10-19T21:16:02.388Z"
---

# commands.yml

> [!NOTE] Note
> The below YAML shows you the structure and default values for the legacy `commands.yml`.
>
> Click on a leaf node to view the description for that setting.

> [!CAUTION] Caution
> The aliases defined in this legacy file do not support modern features, such as:
>
> -   Tab completion
> -   Permissions

- `command-block-overrides`:
  ```yaml
   - <command to override>
  ```
  Which Vanilla commands should be prioritized over those provided by Bukkit or plugins. Useful for compatibility with adventure maps built for Vanilla command blocks. Use the literal ”*” to always use the Vanilla version in command blocks. By default, no commands are overridden.
- `ignore-vanilla-permissions`: `false` — Whether to use Vanilla permission levels when executing commands.
- `aliases`
  - `icanhasbukkit`: — A built-in alias. Set aliases to an empty list ([]) to persistently remove.
    ```yaml
     - version $1-
    ```
  - `<alias name>`:
    ```yaml
     - <commands to run>
    ```
    A list of strings which are target commands. Alternatively, a string, which is a single target command. A target command is a command that is run, when the alias is run. Replacements:

    -   `$sender` is replaced with the command sender”s name (Added by Paper).
    -   `$<n>` is replaced by the n”th argument, 1-indexed.
    -   `$$<n>` is replaced by the n”th argument, 1-indexed, failing if the n”th argument is not present.
    -   `$<n>-` is replaced by the n”th argument and everything that follows, 1-indexed.
    -   `$$<n>-` is replaced by the n”th argument and everything that follows, 1-indexed, failing if the n”th argument is not present.

    Each alias registered cannot (easily) be overridden by a plugin.
