---
title: "Teleportation"
source: "https://docs.papermc.io/paper/dev/entity-teleport/"
description: "The entity teleportation API and how to use it."
fetched_at: "2026-10-19T21:16:00.039Z"
---

# Teleportation

Entities can be instantaneously teleported to specific positions, synchronously and asynchronously with the [`teleport`](https://jd.papermc.io/paper/org/bukkit/entity/Entity.html#teleport\(org.bukkit.Location\)) and [`teleportAsync`](https://jd.papermc.io/paper/org/bukkit/entity/Entity.html#teleportAsync\(org.bukkit.Location\)) API.

> [!TIP] Performance
> If you expect to teleport into unloaded chunks, it is recommended to use the `teleportAsync` API, as it avoids doing synchronous chunk loads, which put a lot of stress on the server’s main thread - hurting overall performance.

```java
boolean success = entity.teleport(location); // loads chunks synchronously and teleports the entity


entity.teleportAsync(location).thenAccept(success -> { // loads chunks asynchronously and teleports the entity
    // this code is ran when the teleport completes
    // the Future is completed on the main thread, so it is safe to use the API here


    if (success) {
        // the entity was teleported successfully!
    }
});
```

> [!DANGER] Danger
> You should **NEVER** call `.get()`/`.join()` on the `teleportAsync` `Future` on the main thread, as it **WILL** deadlock your server, if the chunk you’re teleporting into is not loaded.

## Look at

The [`lookAt`](https://jd.papermc.io/paper/org/bukkit/entity/Player.html#lookAt\(org.bukkit.entity.Entity,io.papermc.paper.entity.LookAnchor,io.papermc.paper.entity.LookAnchor\)) API allows you to make a player look at a certain position or entity.

```java
player.lookAt(
    position,
    LookAnchor.EYES // the player's eyes will be facing the position
);


player.lookAt(
    entity,
    LookAnchor.EYES // the player's eyes will be facing the entity
    LookAnchor.FEET // the player will be facing the entity's feet
);
```

## Teleport flags

Teleport flags offer a way to teleport entities whilst being able to customize behavior. This allows you to do things like teleport players using relative flags and being able to retain passengers.

All available teleport flags can be found in the [`TeleportFlag`](https://jd.papermc.io/paper/io/papermc/paper/entity/TeleportFlag.html) class.

### Relative teleportation

Teleport a player relatively, preventing velocity from being reset in the X, Y and Z axes.

```java
player.teleport(
    location,
    TeleportFlag.Relative.VELOCITY_X,
    TeleportFlag.Relative.VELOCITY_Y,
    TeleportFlag.Relative.VELOCITY_Z
);
```

### Retaining passengers

> [!CAUTION] Warning
> Since 1.21.10, this flag does not do anything, as it’s been made the default behavior when teleporting entities.

Teleport an entity with the [`RETAIN_PASSENGERS`](https://jd.papermc.io/paper/io/papermc/paper/entity/TeleportFlag.EntityState.html#RETAIN_PASSENGERS) flag, allowing its passengers to be transferred with the entity.

```java
entity.teleport(location, TeleportFlag.EntityState.RETAIN_PASSENGERS);
```
