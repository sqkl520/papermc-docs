---
title: "Entity Pathfinder API"
source: "https://docs.papermc.io/paper/dev/entity-pathfinder/"
description: "A guide to the Entity Pathfinder API."
fetched_at: "2026-10-19T21:15:59.990Z"
---

# Entity Pathfinder API

The Entity Pathfinder API can be used to control the movement of entities in Minecraft. It allows you to set a path for an entity to follow, such as moving to a location or following a player.

## Accessing the pathfinder

To access the pathfinder for a mob, you need to call [`getPathfinder()`](https://jd.papermc.io/paper/org/bukkit/entity/Mob.html#getPathfinder\(\)) on the mob. This will return an instance of [`Pathfinder`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html).

> [!NOTE] Note
> The pathfinder is only available for entities that implement [`Mob`](https://jd.papermc.io/paper/org/bukkit/entity/Mob.html).

Let’s say that you have a [`Cow`](https://jd.papermc.io/paper/org/bukkit/entity/Cow.html) and want to move it to a player. You can do this by getting the pathfinder for the cow and then setting the path to the player’s location:

```java
Cow cow = ...;
Player player = ...;


Pathfinder pathfinder = cow.getPathfinder();
// moveTo returns a boolean indicating whether the path was set successfully
boolean success = pathfinder.moveTo(player.getLocation());
```

If you want to access the current path for the cow, you can call [`getCurrentPath()`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html#getCurrentPath\(\)) on the pathfinder:

```java
PathResult path = pathfinder.getCurrentPath();


// A PathResult is essentially a wrapper around a List of Locations. These can be accessed with:
List<Location> locations = path.getPoints();
// It is important to note that the list contains points that have already been passed,
// as well as future points. If you want to get the next point, you can use:
Location nextPoint = path.getNextPoint(); // Or locations.get(path.getNextPointIndex())
// Finally, you can access the final destination with:
Location destination = path.getFinalPoint();
```

## Pathfinding rules

The pathfinder is limited by Minecraft’s own pathfinding logic. For example, a polar bear cannot fly. This means that if you set a path for a polar bear to a location that is in the air, it will not be able to reach it.

Some attributes can be set on the pathfinder to change the way that the pathfinder works. These are:

-   [`setCanOpenDoors(boolean)`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html#setCanOpenDoors\(boolean\)): Whether the entity can open doors. This is relevant for zombies breaking down doors and villagers opening doors.
-   [`setCanPassDoors(boolean)`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html#setCanPassDoors\(boolean\)): Whether the entity can pass through open doors.
-   [`setCanFloat(boolean)`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html#setCanFloat\(boolean\)): Whether the entity can float in water.

These methods have respective getters as well.

## Stopping the pathfinding

You can call [`stopPathfinding()`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html#stopPathfinding\(\)) on the pathfinder to cancel the entity from pathfinding. This will also clear the current path. You can use [`hasPath()`](https://jd.papermc.io/paper/com/destroystokyo/paper/entity/Pathfinder.html#hasPath\(\)) to check if the pathfinder is currently running.
