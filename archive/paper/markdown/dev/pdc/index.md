---
title: "Persistent data container (PDC)"
source: "https://docs.papermc.io/paper/dev/pdc/"
description: "A guide to the PDC API for storing data."
fetched_at: "2026-10-19T21:16:01.145Z"
---

# Persistent data container (PDC)

The Persistent Data Container (PDC) is a way to store custom data on a whole range of objects; such as items, entities, and block entities. The full list of classes that support the PDC are:

-   [`ItemStack`](#itemstack)
-   [`Chunk`](#chunk)
-   [`World`](#world)
-   [`Entity`](#entity)
-   [`TileState`](#tilestate)
-   [`Structure`](#structure)
-   [`GeneratedStructure`](#generatedstructure)
-   [`Raid`](#raid)
-   [`OfflinePlayer`](#offlineplayer)
-   [`ItemMeta`](#itemmeta)

## What is it used for?

In the past, developers resorted to a variety of methods to store custom data on objects:

-   NBT tags: Requires reflection to access internals and was generally unreliable in the long term.
-   Lore and display names: Prone to collisions as well as slow to access.

The benefit of the PDC is that it allows for a more reliable and performant way to store arbitrary data on objects. It also doesn’t rely on accessing server internals, so it’s less likely to break on future versions. It also removes the need to manually track the data lifecycle, as, for example with an entity, the PDC will be saved when the entity unloads.

## Adding data

To store data in the PDC, there are a few things you need first. The first is a [`NamespacedKey`](https://jd.papermc.io/paper/org/bukkit/NamespacedKey.html), which is used to identify the data. The second is a [`PersistentDataContainer`](https://jd.papermc.io/paper/org/bukkit/persistence/PersistentDataContainer.html), which is the object you want to store the data on. The third is the data itself.

```java
NamespacedKey key = new NamespacedKey(pluginInstance, "example_key"); // Create a NamespacedKey
World world = Bukkit.getServer().getWorlds().getFirst();


PersistentDataContainer pdc = world.getPersistentDataContainer();
pdc.set(key, PersistentDataType.STRING, "I love tacos!");
```

[`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html) however doesn’t have this method and instead requires you to use its builder-style consumer:

```java
NamespacedKey key = ...;


// For 1.20.4 and below, use 'new ItemStack(Material.DIAMOND)' instead
ItemStack item = ItemStack.of(Material.DIAMOND);
item.editPersistentDataContainer(pdc -> {
    pdc.set(key, PersistentDataType.STRING, "I love tacos!");
});
```

> [!NOTE] Note
> The [`ItemStack#editPersistentDataContainer()`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html#editPersistentDataContainer\(java.util.function.Consumer\)) method on `ItemStack` is only available in 1.21.4+. For older versions, you need to access and modify the [`ItemMeta`](https://jd.papermc.io/paper/org/bukkit/inventory/meta/ItemMeta.html) instead. For 1.16.5+, there’s the [`ItemStack#editMeta()`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html#editMeta\(java.util.function.Consumer\)) method though.

> [!NOTE] Note
> It is considered good practice to reuse `NamespacedKey` objects. They can be constructed with either:
>
> -   A [`Plugin`](https://jd.papermc.io/paper/org/bukkit/plugin/Plugin.html) instance and an identifier
> -   A namespace and an identifier
>
> The first option is often preferred as it will automatically use the plugin’s lowercased name as namespace; however, the second option can be used if you want to use a different namespace or access the data from another plugin.

## Getting data

To get data from the PDC, you need to know the `NamespacedKey` and the [`PersistentDataType`](https://jd.papermc.io/paper/org/bukkit/persistence/PersistentDataType.html) of the data. Some API parts, such as Adventure’s [`Component#text(String)`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/Component.html#text\(java.lang.String\)), require non-null values. In such cases, use the [`getOrDefault`](https://jd.papermc.io/paper/io/papermc/paper/persistence/PersistentDataContainerView.html#getOrDefault\(org.bukkit.NamespacedKey,org.bukkit.persistence.PersistentDataType,C\)) on the pdc instead of [`get`](https://jd.papermc.io/paper/io/papermc/paper/persistence/PersistentDataContainerView.html#get\(org.bukkit.NamespacedKey,org.bukkit.persistence.PersistentDataType\)), which is nullable.

```java
NamespacedKey key = ...; // Use the same key as the adding-data example
World world = ...; // Use the same world as the adding-data example


PersistentDataContainer pdc = world.getPersistentDataContainer();


// Utilize the data from the PDC
String value = pdc.getOrDefault(key, PersistentDataType.STRING, "<null>");


// Do something with the value
player.sendPlainMessage(value);
```

## Data types

The PDC supports a wide range of data types, such as:

-   `Byte`, `Byte Array`
-   `Double`
-   `Float`
-   `Integer`, `Integer Array`
-   `Long`, `Long Array`
-   `Short`
-   `String`
-   `Boolean`
-   `Tag Containers` - a way to nest PDCs within each other. To create a new `PersistentDataContainer`, you can use:

    ```java
    // Get an existing container
    PersistentDataContainer container = ...;
    // Create a new container
    PersistentDataContainer newContainer = container.getAdapterContext().newPersistentDataContainer();
    ```

-   `Lists` - a way to represent lists of data that can be stored via another persistent data type. You may create them via:

    ```java
    // Storing a list of strings in a container by verbosely creating
    // a list data type wrapping the string data type.
    container.set(
        key,
        PersistentDataType.LIST.listTypeFrom(PersistentDataType.STRING),
        List.of("a", "list", "of", "strings")
    );


    // Storing a list of strings in a container by using the API
    // provided pre-definitions of commonly used list types.
    container.set(key, PersistentDataType.LIST.strings(), List.of("a", "list", "of", "strings"));


    // Retrieving a list of strings from the container.
    List<String> strings = container.get(key, PersistentDataType.LIST.strings());
    ```


> [!NOTE] Boolean PersistentDataType
> The [`Boolean`](https://jd.papermc.io/paper/org/bukkit/persistence/PersistentDataType.html#BOOLEAN) PDC type exists for convenience
>
> -   you cannot make more complex types distill to a `Boolean`.

### Custom data types

You can store a wide range of data in the PDC with the native adapters; however, if you need a more complex data type, you can implement your own `PersistentDataType` and use that instead. The `PersistentDataType`’s job is to “deconstruct” a complex data type into something that is natively supported (see above) and then vice-versa.

Here is an example of how to do that for a UUID:

```java title="UUIDDataType.java"
public class UUIDDataType implements PersistentDataType<byte[], UUID> {


    public static final UUIDDataType INSTANCE = new UUIDDataType();


    // We just need a singleton, so there's no need to allow instantiation
    private UUIDDataType() {}


    @Override
    public Class<byte[]> getPrimitiveType() {
        return byte[].class;
    }


    @Override
    public Class<UUID> getComplexType() {
        return UUID.class;
    }


    @Override
    public byte[] toPrimitive(UUID complex, PersistentDataAdapterContext context) {
        ByteBuffer bb = ByteBuffer.allocate(Long.BYTES * 2);
        bb.putLong(complex.getMostSignificantBits());
        bb.putLong(complex.getLeastSignificantBits());
        return bb.array();
    }


    @Override
    public UUID fromPrimitive(byte[] primitive, PersistentDataAdapterContext context) {
        ByteBuffer bb = ByteBuffer.wrap(primitive);
        long firstLong = bb.getLong();
        long secondLong = bb.getLong();
        return new UUID(firstLong, secondLong);
    }
}
```

> [!NOTE] Note
> In order to use your own `PersistentDataType`, you must pass an instance of it to the [`get`](https://jd.papermc.io/paper/io/papermc/paper/persistence/PersistentDataContainerView.html#get\(org.bukkit.NamespacedKey,org.bukkit.persistence.PersistentDataType\))/ [`set`](https://jd.papermc.io/paper/org/bukkit/persistence/PersistentDataContainer.html#set\(org.bukkit.NamespacedKey,org.bukkit.persistence.PersistentDataType,C\))/ [`has`](https://jd.papermc.io/paper/io/papermc/paper/persistence/PersistentDataContainerView.html#has\(org.bukkit.NamespacedKey,org.bukkit.persistence.PersistentDataType\)) methods.
>
> ```java
> container.set(key, UUIDDataType.INSTANCE, uuid);
> ```

## Read-only containers

Certain classes, like `ItemStack` or [`OfflinePlayer`](https://jd.papermc.io/paper/org/bukkit/OfflinePlayer.html), provide a read-only view of their PDC. In contrast to `ItemStack`, `OfflinePlayer` does not provide any way to modify the underlying container. This is because the `OfflinePlayer` is directly read from disk and would require a blocking file operation. Mutable objects, like the [`PersistentDataHolder#getPersistentDataContainer()`](https://jd.papermc.io/paper/org/bukkit/persistence/PersistentDataHolder.html#getPersistentDataContainer\(\)), generally need to be re-saved even without modification or monitored. That’s why it’s better to use unmodifiable “views” for read-only operations.

```java
NamespacedKey key = ...;
ItemStack item = ...;


PersistentDataContainerView pdcView = item.getPersistentDataContainer();


// Utilize the data from the PDC "view"
String value = pdcView.getOrDefault(key, PersistentDataType.STRING, "<null>");


// Do something with the value
player.sendPlainMessage(value);
```

> [!NOTE] Note
> PDC-view support for `ItemStack` was only introduced in 1.21.1. For older versions, you need to use the `ItemMeta` instead.

## Storing on different objects

> [!CAUTION] Caution
> Data is **not** copied across holders for you, and needs to be **manually** copied if ‘moving’ between PersistentDataHolders.
>
> E.g. Placing an ItemStack as a Block (with a TileState) ***does not*** copy over PDC data.

Objects that can have a PDC implement the [`PersistentDataHolder`](https://jd.papermc.io/paper/org/bukkit/persistence/PersistentDataHolder.html) interface and their PDC can be fetched with `PersistentDataHolder#getPersistentDataContainer()`.

-   ##### [`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html)

    -   The persistent data container of an `ItemStack` has historically been accessed by the `ItemStack`’s `ItemMeta`. This, however, includes the overhead of constructing the entire `ItemMeta`, which acts as a snapshot of the `ItemStack`’s data at the point of creation.

        To avoid this overhead in 1.21.1+, ItemStack exposes a read-only view of its persistent data container at [`ItemStack#getPersistentDataContainer()`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html#getPersistentDataContainer\(\)). Edits to the persistent data container can also be simplified in 1.21.4+ using [`ItemStack#editPersistentDataContainer(Consumer)`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html#editPersistentDataContainer\(java.util.function.Consumer\)). The persistent data container available in the consumer is not valid outside the consumer.

        ```java
        ItemStack itemStack = ...;
        itemStack.editPersistentDataContainer(pdc -> {
            pdc.set(key, PersistentDataType.STRING, "I love tacos!");
        });
        ```

-   ##### [`Chunk`](https://jd.papermc.io/paper/org/bukkit/Chunk.html)

    -   `Chunk#getPersistentDataContainer()`
-   ##### [`World`](https://jd.papermc.io/paper/org/bukkit/World.html)

    -   `World#getPersistentDataContainer()`
-   ##### [`Entity`](https://jd.papermc.io/paper/org/bukkit/entity/Entity.html)

    -   `Entity#getPersistentDataContainer()`
-   ##### [`TileState`](https://jd.papermc.io/paper/org/bukkit/block/TileState.html)

    -   This is slightly more complicated, as you need to cast the block’s state to something that extends `TileState`. This does not work for all blocks, only those that have a block entity.

        ```java
        Block block = ...;
        if (block.getState() instanceof Chest chest) {
            chest.getPersistentDataContainer().set(key, PersistentDataType.STRING, "I love tacos!");
            chest.update();
        }
        ```

-   ##### [`Structure`](https://jd.papermc.io/paper/org/bukkit/structure/Structure.html)

    -   `Structure#getPersistentDataContainer()`
-   ##### [`GeneratedStructure`](https://jd.papermc.io/paper/org/bukkit/generator/structure/GeneratedStructure.html)

    -   `GeneratedStructure#getPersistentDataContainer()`
-   ##### [`Raid`](https://jd.papermc.io/paper/org/bukkit/Raid.html)

    -   `Raid#getPersistentDataContainer()`
-   ##### [`OfflinePlayer`](https://jd.papermc.io/paper/org/bukkit/OfflinePlayer.html)

    -   OfflinePlayer only exposes a read-only version of the persistent data container. It can be accessed via `OfflinePlayer#getPersistentDataContainer()`.
-   ##### [`ItemMeta`](https://jd.papermc.io/paper/org/bukkit/inventory/meta/ItemMeta.html)

    -   `ItemMeta#getPersistentDataContainer()`
