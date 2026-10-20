---
title: "Predicates"
source: "https://docs.papermc.io/paper/dev/command-api/arguments/predicate/"
description: "Documentation for arguments that allow value validation."
fetched_at: "2026-10-19T21:15:58.115Z"
---

# Predicates

A predicate allows for checking for valid values. These arguments are dedicated to checking whether some sort of value is valid according to user input.

## Double range argument

This argument can be used as a predicate for numbers, which require precise input.

### Example usage

```java
Commands.argument("range", ArgumentTypes.doubleRange())
    .executes(context -> {
        final Range<Double> range = context.getArgument("range", DoubleRangeProvider.class).range();
        final CommandSender sender = context.getSource().getSender();


        for (int i = 0; i < 5; i++) {
            sender.sendRichMessage("Is <index> in bounds? <result>",
                Placeholder.unparsed("index", String.valueOf(i)),
                Placeholder.unparsed("result", String.valueOf(range.contains((double) i)))
            );
        }
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.

## Integer range argument

This argument works very similarly to the double range argument, with the only difference being that this argument only accepts integers.

### Example usage

```java
Commands.argument("range", ArgumentTypes.integerRange())
    .then(Commands.argument("input", IntegerArgumentType.integer())
        .executes(context -> {
            final Range<Integer> range = context.getArgument("range", IntegerRangeProvider.class).range();
            final int input = IntegerArgumentType.getInteger(context, "input");
            final CommandSender sender = context.getSource().getSender();


            sender.sendRichMessage("<aqua><input></aqua> <result:'<green>is</green>':'<red>is not</red>'/> inside the specified range!",
                Placeholder.unparsed("input", String.valueOf(input)),
                Formatter.booleanChoice("result", range.contains(input))
            );
            return Command.SINGLE_SUCCESS;
        })
    )
```

### In-game preview

 Your device does not support video playback.

## Item predicate argument

This argument allows for checking whether an item fits some predicate. It is useful for filtering out certain items based on some criteria.

### Example usage

```java
Commands.argument("predicate", ArgumentTypes.itemPredicate())
    .executes(context -> {
        final ItemStackPredicate predicate = context.getArgument("predicate", ItemStackPredicate.class);
        final ItemStack woodenSword = ItemType.WOODEN_SWORD.createItemStack();


        context.getSource().getSender().sendRichMessage("Does predicate include a default wooden sword? <result:'<green>true</green>':'<red>false</red>'>",
            Formatter.booleanChoice("result", predicate.test(woodenSword))
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview

 Your device does not support video playback.
