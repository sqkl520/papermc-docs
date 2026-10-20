---
title: "help.yml"
source: "https://docs.papermc.io/paper/reference/bukkit-help-configuration/"
description: "An explanation of Bukkit's help.yml file."
fetched_at: "2026-10-19T21:16:02.548Z"
---

# help.yml

> [!NOTE] Note
> The below YAML shows you the structure for `help.yml`.
>
> Click on a leaf node to view the description for that setting.

- `general-topics`
  - `<topic name>`
    A custom help “topic” to show when the user types “`/help <topic>`”.

    - `shortText`: `""`
      The first line of the help entry, used as a summary in index pages.

      This is formatted with legacy ”&” style formatting.
    - `fullText`: `""`
      The remaining lines of this help entry.

      This is formatted with legacy ”&” style formatting.
    - `permission`: `""`
      The permission required to view this help entry.

      If this is empty/not set, the entry does not require a permission.
- `index-topics`
  - `<topic name>`
    A composite help topic index.

    If the topic name is the special value “Default”, it will override the automatically generated index used for /help with no arguments.

    - `shortText`: `""`
      The short text used in other index topics.

      This is not displayed when showing this topic itself.

      This is formatted with legacy ”&” style formatting.
    - `preamble`: `""`
      Information to show before the index.

      This is formatted with legacy ”&” style formatting.
    - `permission`: `""`
      A custom permission required to view this help entry.

      If this is empty/not set, the entry does not require a permission.
    - `commands`: `[]`
      What to show in the index.

      This is a list of commands, or other help topics.

      They will be displayed in the order they are listed here in “topic name: short text” format.

      Each entry is a maximum of 1 minimum-width chat line (55 chars).
- `amended-topics`
  - `<topic name>`
    - `shortText`: `""`
      A replacement for the short text of the topic.

      If this is empty/not set, the original short text is used.

      If this contains the literal string `<text>`, it will be replaced with the original short text.

      This is formatted with legacy ”&” style formatting.
    - `fullText`: `""`
      A replacement for the full text of the topic.

      If this is empty/not set, the original full text is used.

      If this contains the literal string `<text>`, it will be replaced with the original full text.

      This is formatted with legacy ”&” style formatting.
    - `permission`: `""`
      Overrides the permission required to view this help entry.

      If this is empty/not set, the original permission is NOT used, instead no permission is required.
- `ignore-plugins`: `[]`
  A list of plugins to ignore when generating help topics for registered commands.

  If “All” is included, all plugins are ignored.

  If the special plugin name “Bukkit” is included, all commands registered by Bukkit are ignored.
- `command-topics-in-master-index`: `true`
  Whether to allow command topics (topics starting with a `/`) to be shown in the main index.

  This is the index shown when the user types “`/help`” or “`/help <page>`”. Command alias topics are always hidden.
