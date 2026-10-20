---
title: "Entities and players"
source: "https://docs.papermc.io/paper/dev/command-api/arguments/entity-player/"
description: "Player and Entity arguments documentation."
fetched_at: "2026-10-19T21:15:57.701Z"
---

# Entities and players

The arguments described in this section relate to arguments which you can use to retrieve entities. Their main usage is the selection of command targets. All of these have entity selectors (`@a`, `@e`, `@n`, etc.) as valid inputs, though they require the `minecraft.command.selector` permission in order to be able to be used. The specific arguments may allow or disallow certain selectors.

## Entity argument

This argument, after resolving its returning `EntitySelectorArgumentResolver`, returns a list of exactly one, no more and no less, entity. It is safe to call `List#getFirst()` to retrieve that entity. You can resolve it using [`ArgumentResolver#resolve(CommandSourceStack)`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/resolvers/ArgumentResolver.html#resolve\(io.papermc.paper.command.brigadier.CommandSourceStack\)).

### Example usage

```java
Commands.argument("entity", ArgumentTypes.entity())
    .executes(context -> {
        final EntitySelectorArgumentResolver resolver = context.getArgument("entity", EntitySelectorArgumentResolver.class);
        final Entity entity = resolver.resolve(context.getSource()).getFirst();


        context.getSource().getSender().sendRichMessage("Found <green><entity_name>",
            Placeholder.component("entity_name", entity.teamDisplayName())
        );


        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

If the executing player doesn’t have the `minecraft.command.selector` permission:

 Your device does not support video playback.

If the executing player has the `minecraft.command.selector` permission:

 Your device does not support video playback.

## Entities argument

In contrast to the single entity argument, this multiple-entities argument accepts any amount of entities, with the minimum amount of entities being 1. They can, once again, be resolved using [`ArgumentResolver#resolve(CommandSourceStack)`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/resolvers/ArgumentResolver.html#resolve\(io.papermc.paper.command.brigadier.CommandSourceStack\)), which returns a `List<Entity>`.

### Example usage

```java
Commands.argument("entities", ArgumentTypes.entities())
    .executes(context -> {
        final EntitySelectorArgumentResolver resolver = context.getArgument("entities", EntitySelectorArgumentResolver.class);
        final List<Entity> entities = resolver.resolve(context.getSource());


        final Component entityNames = Component.join(JoinConfiguration.commas(true), entities.stream().map(Entity::teamDisplayName).toList());


        context.getSource().getSender().sendRichMessage("Found <green><entity_names>",
            Placeholder.component("entity_names", entityNames)
        );


        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## Player argument

The player argument allows to retrieve a `PlayerSelectorArgumentResolver`. For this “single player” argument, you can safely get the target player by running `PlayerSelectorArgumentResolver.resolve(context.getSource()).getFirst()`, which returns a [`Player`](https://jd.papermc.io/paper/org/bukkit/entity/Player.html) object.

### Example usage

This command yeets the targeted player into the air!

```java
Commands.argument("target", ArgumentTypes.player())
    .executes(context -> {
        final PlayerSelectorArgumentResolver resolver = context.getArgument("target", PlayerSelectorArgumentResolver.class);
        final Player target = resolver.resolve(context.getSource()).getFirst();


        target.setVelocity(new Vector(0, 3.9, 0));
        target.sendRichMessage("<rainbow>Yeeeeeeeeeet");


        context.getSource().getSender().sendRichMessage("Yeeted <target>!",
            Placeholder.component("target", target.displayName())
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## Players argument

The “multiple players” argument works similarly to the “single player” argument, also returning a `PlayerSelectorArgumentResolver`. Instead of just resolving to exactly one `Player`, this one can resolve to more than just one player - which you should account for in case of using this argument. `PlayerSelectorArgumentResolver.resolve(context.getSource())` returns a `List<Player>`, which you can just iterate through.

### Example usage

Extending the “single player” yeet command to support multiple targets can look like this:

```java
Commands.argument("targets", ArgumentTypes.players())
  .executes(context -> {
      final PlayerSelectorArgumentResolver resolver = context.getArgument("targets", PlayerSelectorArgumentResolver.class);
      final List<Player> targets = resolver.resolve(context.getSource());
      final CommandSender sender = context.getSource().getSender();


      for (final Player target : targets) {
          target.setVelocity(new Vector(0, 3.9, 0));
          target.sendRichMessage("<rainbow>Yeeeeeeeeeet");


          sender.sendRichMessage("Yeeted <target>!",
              Placeholder.component("target", target.displayName())
          );
      }
      return Command.SINGLE_SUCCESS;
  })
```

### In-game preview

 Your device does not support video playback.

## Player profiles argument

The player profiles argument is a very powerful argument which can retrieve both offline and online players. It returns the result of the argument as a `PlayerProfileListResolver`, which resolves to a `Collection<PlayerProfile>`. This collection can be iterated to get the resulting profile(s). Usually, it only returns a single `PlayerProfile` if retrieving a player by name, but it can return multiple if using the entity selectors (like `@a` on online players). Thus it always makes sense to run whatever operation you want to run on all entries in the collection instead of just the first one.

This argument will run API calls to Mojang servers in order to retrieve player information for players which have never joined the server before. Due to this operation sometimes taking a bit longer, it is suggested to resolve this argument in an asynchronous context in order to not cause any server lag.

Sometimes, these API calls may fail. This is also visible in the in-game preview down below. This behavior is also the reason for `/whitelist add` sometimes.

### Example usage - player lookup command

```java
Commands.argument("profiles", ArgumentTypes.playerProfiles())
    .executes(context -> {
        final PlayerProfileListResolver resolver = context.getArgument("profiles", PlayerProfileListResolver.class);
        final Collection<PlayerProfile> profiles = resolver.resolve(context.getSource());


        for (final PlayerProfile profile : profiles) {
            context.getSource().getSender().sendPlainMessage("Found " + profile.getName());
        }


        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.
