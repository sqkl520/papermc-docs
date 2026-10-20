---
title: "Plugin configuration"
source: "https://docs.papermc.io/paper/dev/plugin-configurations/"
description: "How to create configuration files for your plugins to customize behavior."
fetched_at: "2026-10-19T21:16:01.208Z"
---

# Plugin configuration

Configuration files allow users to change certain behavior and functionality of plugins. This guide will outline how to use them.

## Format

By default, plugins use a [YAML](https://yaml.org/) configuration format (`.yaml`/`.yml` file). Other formats, such as JSON or TOML, can be used; however, these are not natively supported by Paper, so they will not be covered in this guide.

YAML works by having a tree-like `key: value` pair structure, as you would have seen in your [`plugin.yml`](../plugin-yml/index.md). An example would look like this:

```yaml
root:
  one-key: 10
  another-key: David
```

When accessing indented values, you separate the levels with dots (`.`). For example, the key for the `David` string would be `root.another-key`.

## Creating a `config.yml`

By placing a `config.yml` file inside your plugin, you can specify the default values for certain settings. This will be located in the `resources` directory:


```
example-plugin/
  src/
    main/
      java/
        …
      resources/
        config.yml
        plugin.yml
```


When your plugin is initialized, you must copy this file into the plugin’s data directory, so that a user can edit the values. Here is an example of how you would do this in your plugin’s `onEnable`:

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {


    @Override
    public void onEnable() {
        this.saveResource("config.yml", /* replace */ false);


        // You can also use this shorthand for the default configuration file (config.yml):
        // this.saveDefaultConfig();
        // the file will be saved if it does not already exist


        // this.getConfig()...
    }
}
```

> [!NOTE] Note
> The boolean `replace` parameter specifies whether it should replace an existing file if one exists. If set to true, the configuration will be overwritten on every call.

## Fetching and writing data

The [`FileConfiguration`](https://jd.papermc.io/paper/org/bukkit/configuration/file/FileConfiguration.html) of the plugin can be fetched with [`Plugin#getConfig()`](https://jd.papermc.io/paper/org/bukkit/plugin/Plugin.html#getConfig\(\)) once it has been saved. This will allow data to be fetched and set with the respective `get...(key)` and [`set(key, value)`](https://jd.papermc.io/paper/org/bukkit/configuration/ConfigurationSection.html#set\(java.lang.String,java.lang.Object\)). By default, most basic data types are supported by YAML. These can be fetched simply with [`getString(key)`](https://jd.papermc.io/paper/org/bukkit/configuration/ConfigurationSection.html#getString\(java.lang.String\)) or [`getBoolean(key)`](https://jd.papermc.io/paper/org/bukkit/configuration/ConfigurationSection.html#getBoolean\(java.lang.String\)).

However, some more complex Bukkit data types are also supported. A few of these include: [`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html), [`Location`](https://jd.papermc.io/paper/org/bukkit/Location.html) and [`Vector`](https://jd.papermc.io/paper/org/bukkit/util/Vector.html). Here is an example of loading a value from the config for teleporting a player:

> [!NOTE] Saving Configs
> Whenever setting data in configurations, you must call [`FileConfiguration#save(File)`](https://jd.papermc.io/paper/org/bukkit/configuration/file/FileConfiguration.html#save\(java.io.File\)) for the changes to be persisted to disk.

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {


    public void teleportPlayer(Player player) {
        Location to = this.getConfig().getLocation("target-location");
        player.teleport(to);
    }
}
```

This is possible as they implement [`ConfigurationSerializable`](https://jd.papermc.io/paper/org/bukkit/configuration/serialization/ConfigurationSerializable.html). You can use this yourself, by implementing and registering a custom class.

```java title="TeleportOptions.java"
public class TeleportOptions implements ConfigurationSerializable {


    private final String name;
    private final int chunkX;
    private final int chunkZ;


    public TeleportOptions(String name, int chunkX, int chunkZ) {
        this.name = name;
        // ...
    }


    public Map<String, Object> serialize() {
        Map<String, Object> data = new HashMap<>(3);


        data.put("name", this.name);
        data.put("chunk-x", this.chunkX);
        data.put("chunk-z", this.chunkZ);


        return data;
    }


    public static TeleportOptions deserialize(Map<String, Object> args) {
        return new TeleportOptions(
                (String) args.get("name"),
                (int) args.get("chunk-x"),
                (int) args.get("chunk-z")
        );
    }
}
```

Here we can see that we have an instance-based `serialize` method, which returns a map, and then a static `deserialize` method that takes a Map as a parameter and returns an instance of the `TeleportOptions` class. Finally, for this to work, we must call: `ConfigurationSerialization.registerClass(TeleportOptions.class);`

> [!CAUTION] Caution
> If you do not call [`ConfigurationSerialization#registerClass(Class)`](https://jd.papermc.io/paper/org/bukkit/configuration/serialization/ConfigurationSerialization.html#registerClass\(java.lang.Class\)) with Paper plugins, you will not be able to load nor save your custom classes.

## Custom configuration files

It is highly likely that you will have many different things to configure in your plugin. If you choose to split these across multiple different files, you can still use the Bukkit `FileConfiguration` API to read the data from these. It is as simple as:

```java
File file = new File(plugin.getDataFolder(), "items.yaml");
YamlConfiguration config = YamlConfiguration.loadConfiguration(file);
// Work with config here
config.save(file);
```

This example reads the `items.yaml` file from your plugin’s data directory. If the file does not exist or an error occurs during reading, an empty configuration will be returned.

> [!DANGER] Blocking I/O
> Loading and saving files on the main thread will slow down your server. `load` and `save` operations should be executed asynchronously.

## Configurate

Configurate is a third-party library for working with configurations, maintained by the Sponge project. This project is used internally by Paper for its configuration and offers many features that the `FileConfiguration` API doesn’t have. See their project [here](https://github.com/SpongePowered/Configurate) for more information.
