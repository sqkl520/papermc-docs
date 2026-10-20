---
title: "Introduction"
source: "https://docs.papermc.io/paper/dev/command-api/basics/introduction/"
description: "A guide to Paper's Brigadier command API."
fetched_at: "2026-10-19T21:15:58.761Z"
---

# Introduction

Paper’s command system is built on top of Minecraft’s Brigadier command system. This system provides a powerful and flexible way to define commands and arguments. It offers many advantages above the previously widely used Bukkit command system:

-   Less parsing or error checking required by the developer for arguments.
-   Better user experience with client error checking.
-   Integration with reload events, allowing the definition of commands usable in datapacks.
-   Easier creation of subcommands.

> [!NOTE] Note
> To see a comparison between the new Brigadier system and the old Bukkit system, [click here](../../misc/comparison-bukkit-brigadier/index.md).

## Guide

> [!TIP] Tip
> If the Brigadier API seems too complicated, you can start with [basic commands](../../misc/basic-command/index.md). They provide a simple way of creating commands, with only a small learning curve.

The following sites are worth-while to look through first when learning about Brigadier:

-   [The Command Tree](../command-tree/index.md)
-   [Arguments and Literals](../arguments-and-literals/index.md)
-   [Command Executors](../executors/index.md)
-   [Command Registration](../registration/index.md)
-   [Command Requirements](../requirements/index.md)
-   [Argument Suggestions](../argument-suggestions/index.md)
-   [Custom Arguments](../custom-arguments/index.md)

For a reference of more advanced arguments, you should look here:

-   [Minecraft Arguments](../../arguments/minecraft/index.md)

> [!DANGER] Future pages
> The following pages will be added to the documentation in the future:
>
> -   **Tutorial: Creating Utility Commands**
> -   **The Command Dispatcher**
> -   **Forks and Redirects**
> -   **Tutorial: Extending the vanilla execute command**

## Additional support

For support regarding the command API, you can always ask in our [Discord server](https://discord.gg/PaperMC) under the [`#paper-dev`](https://discord.com/channels/289587909051416579/555462289851940864) channel!
