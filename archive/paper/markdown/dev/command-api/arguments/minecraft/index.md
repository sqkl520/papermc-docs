---
title: "Minecraft-specific"
source: "https://docs.papermc.io/paper/dev/command-api/arguments/minecraft/"
description: "Everything regarding the essential Brigadier arguments."
fetched_at: "2026-10-19T21:15:57.995Z"
---

# Minecraft-specific

The [Arguments and Literals](../../basics/arguments-and-literals/index.md) page covers the most used, native Brigadier arguments. But Minecraft define a few more which Paper wraps around. These can be accessed in a static context using the [`ArgumentTypes`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html) class. We will go over all of those in this section.

## Quick overview

A quick overview of all possible arguments is defined here:

| Argument Reference | Resolved Type |
| --- | --- |
| [`entity()`](../entity-player/index.md#entity-argument) | [`Entity`](https://jd.papermc.io/paper/org/bukkit/entity/Entity.html) |
| [`entities()`](../entity-player/index.md#entities-argument) | `List<[Entity](https://jd.papermc.io/paper/org/bukkit/entity/Entity.html)>` |
| [`player()`](../entity-player/index.md#player-argument) | [`Player`](https://jd.papermc.io/paper/org/bukkit/entity/Player.html) |
| [`players()`](../entity-player/index.md#players-argument) | `List<[Player](https://jd.papermc.io/paper/org/bukkit/entity/Player.html)>` |
| [`playerProfiles()`](../entity-player/index.md#player-profiles-argument) | `Collection<[PlayerProfile](https://jd.papermc.io/paper/com/destroystokyo/paper/profile/PlayerProfile.html)>` |
| [`blockPosition()`](../location/index.md#block-position-argument) | [`BlockPosition`](https://jd.papermc.io/paper/io/papermc/paper/math/BlockPosition.html) |
| [`columnBlockPosition()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#columnBlockPosition\(\)) | [`ColumnBlockPosition`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/position/ColumnBlockPosition.html) |
| [`blockInWorldPredicate()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#blockInWorldPredicate\(\)) | [`BlockInWorldPredicate`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/predicate/BlockInWorldPredicate.html) |
| [`finePosition(boolean centerIntegers)`](../location/index.md#fine-position-argument) | [`FinePosition`](https://jd.papermc.io/paper/io/papermc/paper/math/FinePosition.html) |
| [`columnFinePosition(boolean centerIntegers)`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#columnFinePosition\(\)) | [`ColumnFinePosition`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/position/ColumnFinePosition.html) |
| [`rotation()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#rotation\(\)) | [`Rotation`](https://jd.papermc.io/paper/io/papermc/paper/math/Rotation.html) |
| [`angle()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#angle\(\)) | `float` |
| [`axes()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#axes\(\)) | `Set<[Axis](https://jd.papermc.io/paper/org/bukkit/Axis.html)>` |
| [`blockState()`](../paper/index.md#block-state-argument) | [`BlockState`](https://jd.papermc.io/paper/org/bukkit/block/BlockState.html) |
| [`itemStack()`](../paper/index.md#item-argument) | [`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html) |
| [`itemPredicate()`](../predicate/index.md#item-predicate-argument) | [`ItemStackPredicate`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/predicate/ItemStackPredicate.html) |
| [`namedColor()`](../adventure/index.md#named-color-argument) | [`NamedTextColor`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/format/NamedTextColor.html) (Adventure) |
| [`hexColor()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#hexColor\(\)) | [`TextColor`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/format/TextColor.html) (Adventure) |
| [`component()`](../adventure/index.md#component-argument) | [`Component`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/Component.html) (Adventure) |
| [`style()`](../adventure/index.md#adventure-style-argument) | [`Style`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/format/Style.html) (Adventure) |
| [`signedMessage()`](../adventure/index.md#signed-message-argument) | [`SignedMessage`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/SignedMessage.html) (Adventure) |
| [`scoreboardDisplaySlot()`](../enums/index.md#scoreboard-display-slot-argument) | [`DisplaySlot`](https://jd.papermc.io/paper/org/bukkit/scoreboard/DisplaySlot.html) |
| [`namespacedKey()`](../paper/index.md#namespacedkey-argument) | [`NamespacedKey`](https://jd.papermc.io/paper/org/bukkit/NamespacedKey.html) |
| [`key()`](../adventure/index.md#key-argument) | [`Key`](https://jd.papermc.io/adventure/net.kyori.adventure.key/net/kyori/adventure/key/Key.html) (Adventure) |
| [`integerRange()`](../predicate/index.md#integer-range-argument) | `Range<Integer>` |
| [`doubleRange()`](../predicate/index.md#double-range-argument) | `Range<Double>` |
| [`world()`](../location/index.md#world-argument) | [`World`](https://jd.papermc.io/paper/org/bukkit/World.html) |
| [`gameMode()`](../enums/index.md#gamemode-argument) | [`GameMode`](https://jd.papermc.io/paper/org/bukkit/GameMode.html) |
| [`heightMap()`](../enums/index.md#heightmap-argument) | [`HeightMap`](https://jd.papermc.io/paper/org/bukkit/HeightMap.html) |
| [`uuid()`](../paper/index.md#uuid-argument) | `UUID` |
| [`objectiveCriteria()`](../paper/index.md#objective-criteria-argument) | [`Criteria`](https://jd.papermc.io/paper/org/bukkit/scoreboard/Criteria.html) |
| [`entityAnchor()`](../enums/index.md#entity-anchor-argument) | [`LookAnchor`](https://jd.papermc.io/paper/io/papermc/paper/entity/LookAnchor.html) |
| [`time(int minTime)`](../paper/index.md#time-argument) | `Integer` |
| [`templateMirror()`](../enums/index.md#template-mirror-argument) | [`Mirror`](https://jd.papermc.io/paper/org/bukkit/block/structure/Mirror.html) |
| [`templateRotation()`](../enums/index.md#template-rotation-argument) | [`StructureRotation`](https://jd.papermc.io/paper/org/bukkit/block/structure/StructureRotation.html) |
| [`resource(RegistryKey<T>)`](../registry/index.md#resource-argument) | registry element |
| [`resourceKey(RegistryKey<T>)`](../registry/index.md#resource-key-argument) | [`TypedKey`](https://jd.papermc.io/paper/io/papermc/paper/registry/TypedKey.html) of a registry element |
