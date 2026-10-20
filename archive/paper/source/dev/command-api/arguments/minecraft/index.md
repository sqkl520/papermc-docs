# Minecraft-specific

Everything regarding the essential Brigadier arguments.

The [Arguments and Literals](../../basics/arguments-and-literals/index.md) page covers the most used, native Brigadier arguments. But Minecraft define a few more which Paper wraps around. These can be accessed
in a static context using the [](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes) class. We will go over all of those in this section.

## Quick overview
A quick overview of all possible arguments is defined here:

| Argument Reference                                                                                                                      | Resolved Type                                                                                    |
|-----------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| [`entity()`](../entity-player/index.md#entity-argument)                                                            | [](jd:paper:org.bukkit.entity.Entity)                                                            |
| [`entities()`](../entity-player/index.md#entities-argument)                                                        | <code>List<[Entity](jd:paper:org.bukkit.entity.Entity)></code>                                   |
| [`player()`](../entity-player/index.md#player-argument)                                                            | [](jd:paper:org.bukkit.entity.Player)                                                            |
| [`players()`](../entity-player/index.md#players-argument)                                                          | <code>List<[Player](jd:paper:org.bukkit.entity.Player)></code>                                   |
| [`playerProfiles()`](../entity-player/index.md#player-profiles-argument)                                           | <code>Collection<[PlayerProfile](jd:paper:com.destroystokyo.paper.profile.PlayerProfile)></code> |
| [`blockPosition()`](../location/index.md#block-position-argument)                                                  | [](jd:paper:io.papermc.paper.math.BlockPosition)                                                 |
| [`columnBlockPosition()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#columnBlockPosition())                     | [](jd:paper:io.papermc.paper.command.brigadier.argument.position.ColumnBlockPosition)            |
| [`blockInWorldPredicate()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#blockInWorldPredicate())                 | [](jd:paper:io.papermc.paper.command.brigadier.argument.predicate.BlockInWorldPredicate)         |
| [`finePosition(boolean centerIntegers)`](../location/index.md#fine-position-argument)                              | [](jd:paper:io.papermc.paper.math.FinePosition)                                                  |
| [`columnFinePosition(boolean centerIntegers)`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#columnFinePosition()) | [](jd:paper:io.papermc.paper.command.brigadier.argument.position.ColumnFinePosition)             |
| [`rotation()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#rotation())                                           | [](jd:paper:io.papermc.paper.math.Rotation)                                                      |
| [`angle()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#angle())                                                 | `float`                                                                                          |
| [`axes()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#axes())                                                   | <code>Set<[Axis](jd:paper:org.bukkit.Axis)></code>                                               |
| [`blockState()`](../paper/index.md#block-state-argument)                                                           | [](jd:paper:org.bukkit.block.BlockState)                                                         |
| [`itemStack()`](../paper/index.md#item-argument)                                                                   | [](jd:paper:org.bukkit.inventory.ItemStack)                                                      |
| [`itemPredicate()`](../predicate/index.md#item-predicate-argument)                                                 | [](jd:paper:io.papermc.paper.command.brigadier.argument.predicate.ItemStackPredicate)            |
| [`namedColor()`](../adventure/index.md#named-color-argument)                                                       | [](jd:adventure:net.kyori.adventure.text.format.NamedTextColor) (Adventure)                      |
| [`hexColor()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#hexColor())                                           | [](jd:adventure:net.kyori.adventure.text.format.TextColor) (Adventure)                           |
| [`component()`](../adventure/index.md#component-argument)                                                          | [](jd:adventure:net.kyori.adventure.text.Component) (Adventure)                                  |
| [`style()`](../adventure/index.md#adventure-style-argument)                                                        | [](jd:adventure:net.kyori.adventure.text.format.Style) (Adventure)                               |
| [`signedMessage()`](../adventure/index.md#signed-message-argument)                                                 | [](jd:adventure:net.kyori.adventure.chat.SignedMessage) (Adventure)                              |
| [`scoreboardDisplaySlot()`](../enums/index.md#scoreboard-display-slot-argument)                                    | [](jd:paper:org.bukkit.scoreboard.DisplaySlot)                                                   |
| [`namespacedKey()`](../paper/index.md#namespacedkey-argument)                                                      | [](jd:paper:org.bukkit.NamespacedKey)                                                            |
| [`key()`](../adventure/index.md#key-argument)                                                                      | [](jd:adventure:net.kyori.adventure.key:net.kyori.adventure.key.Key) (Adventure)                 |
| [`integerRange()`](../predicate/index.md#integer-range-argument)                                                   | `Range<Integer>`                                                                                 |
| [`doubleRange()`](../predicate/index.md#double-range-argument)                                                     | `Range<Double>`                                                                                  |
| [`world()`](../location/index.md#world-argument)                                                                   | [](jd:paper:org.bukkit.World)                                                                    |
| [`gameMode()`](../enums/index.md#gamemode-argument)                                                                | [](jd:paper:org.bukkit.GameMode)                                                                 |
| [`heightMap()`](../enums/index.md#heightmap-argument)                                                              | [](jd:paper:org.bukkit.HeightMap)                                                                |
| [`uuid()`](../paper/index.md#uuid-argument)                                                                        | `UUID`                                                                                           |
| [`objectiveCriteria()`](../paper/index.md#objective-criteria-argument)                                             | [](jd:paper:org.bukkit.scoreboard.Criteria)                                                      |
| [`entityAnchor()`](../enums/index.md#entity-anchor-argument)                                                       | [](jd:paper:io.papermc.paper.entity.LookAnchor)                                                  |
| [ `time(int minTime)`](../paper/index.md#time-argument)                                                            | `Integer`                                                                                        |
| [`templateMirror()`](../enums/index.md#template-mirror-argument)                                                   | [](jd:paper:org.bukkit.block.structure.Mirror)                                                   |
| [`templateRotation()`](../enums/index.md#template-rotation-argument)                                               | [](jd:paper:org.bukkit.block.structure.StructureRotation)                                        |
| [`resource(RegistryKey<T>)`](../registry/index.md#resource-argument)                                               | registry element                                                                               |
| [`resourceKey(RegistryKey<T>)`](../registry/index.md#resource-key-argument)                                        | [](jd:paper:io.papermc.paper.registry.TypedKey) of a registry element                                                                |