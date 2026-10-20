---
title: "Enums"
source: "https://docs.papermc.io/paper/dev/command-api/arguments/enums/"
description: "Documentation for EntityAnchor, GameMode and similar enum value arguments."
fetched_at: "2026-10-19T21:15:57.763Z"
---

# Enums

## Entity anchor argument

The entity anchor argument has two valid inputs: `feet` and `eyes`. The resulting [`LookAnchor`](https://jd.papermc.io/paper/io/papermc/paper/entity/LookAnchor.html) is mainly used for methods like [`Entity#lookAt(Position, LookAnchor)`](https://jd.papermc.io/paper/org/bukkit/entity/Entity.html#lookAt\(io.papermc.paper.math.Position,io.papermc.paper.entity.LookAnchor\)) or [`Player#lookAt(Entity, LookAnchor, LookAnchor)`](https://jd.papermc.io/paper/org/bukkit/entity/Player.html#lookAt\(org.bukkit.entity.Entity,io.papermc.paper.entity.LookAnchor,io.papermc.paper.entity.LookAnchor\)).

### Example usage

```java
Commands.argument("anchor", ArgumentTypes.entityAnchor())
    .executes(context -> {
        final LookAnchor anchor = context.getArgument("anchor", LookAnchor.class);


        context.getSource().getSender().sendRichMessage("You chose <aqua><anchor></aqua>!",
            Placeholder.unparsed("anchor", anchor.name())
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## GameMode argument

The game mode argument works the same way as the first argument of the Vanilla `/gamemode <gamemode>` command. It accepts any of the 4 valid game modes, returning a [`GameMode`](https://jd.papermc.io/paper/org/bukkit/GameMode.html) enum to use in code.

### Example usage

```java
Commands.argument("mode", ArgumentTypes.gameMode())
    .executes(context -> {
        final GameMode mode = context.getArgument("mode", GameMode.class);
        final Player player = context.getSource().getPlayerOrThrow();


        player.setGameMode(mode);
        player.sendRichMessage("Your gamemode has been set to <red><mode></red>!",
            Placeholder.component("mode", Component.translatable(mode))
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## HeightMap argument

The [`HeightMap`](https://jd.papermc.io/paper/org/bukkit/HeightMap.html) argument consists of the following, valid inputs: `motion_blocking`, `motion_blocking_no_leaves`, `ocean_floor`, and `world_surface`. It is often used for declaring relative positioning for data packs or the `/execute positioned over <height_map>` command. E.g. `world_surface` would mean that the Y coordinate of the surface of the world on the set X/Z values should be used.

### Example usage

```java
Commands.argument("height_map", ArgumentTypes.heightMap())
    .executes(context -> {
        final HeightMap heightMap = context.getArgument("height_map", HeightMap.class);


        context.getSource().getSender().sendRichMessage("You selected <gold><selection></gold>",
            Placeholder.unparsed("selection", heightMap.name())
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## Scoreboard display slot argument

This argument allows you to retrieve a [`DisplaySlot`](https://jd.papermc.io/paper/org/bukkit/scoreboard/DisplaySlot.html) enum value from the user.

### Example usage

```java
Commands.argument("slot", ArgumentTypes.scoreboardDisplaySlot())
    .executes(context -> {
        final DisplaySlot slot = context.getArgument("slot", DisplaySlot.class);


        context.getSource().getSender().sendPlainMessage("You selected: " + slot.toString());
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## Template mirror argument

Here, the user has 3 valid input possibilities: `front_back`, `left_right`, and `none`. You can retrieve the result of the argument as a [`Mirror`](https://jd.papermc.io/paper/org/bukkit/block/structure/Mirror.html) enum value.

### Example usage

```java
Commands.argument("mirror", ArgumentTypes.templateMirror())
    .executes(context -> {
        final Mirror mirror = context.getArgument("mirror", Mirror.class);


        context.getSource().getSender().sendPlainMessage("You selected: " + mirror.name());
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## Template rotation argument

For the template rotation argument, the user has 4 valid input possibilities: `180`, `clockwise_90`, `counterclockwise_90`, and `none`. You can retrieve the result of the argument as a [`StructureRotation`](https://jd.papermc.io/paper/org/bukkit/block/structure/StructureRotation.html) enum value.

### Example usage

```java
Commands.argument("rotation", ArgumentTypes.templateRotation())
    .executes(context -> {
        final StructureRotation rotation = context.getArgument("rotation", StructureRotation.class);


        context.getSource().getSender().sendPlainMessage("You selected: " + rotation.name());
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.
