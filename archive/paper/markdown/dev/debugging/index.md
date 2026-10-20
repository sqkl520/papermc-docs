---
title: "Debugging your plugin"
source: "https://docs.papermc.io/paper/dev/debugging/"
description: "Debugging is common when writing code. This guide outlines the common ways to debug your plugin."
fetched_at: "2026-10-19T21:15:59.591Z"
---

# Debugging your plugin

Debugging your plugin is vital to being able to fix bugs and issues in your plugin. This page will cover some of the most common debugging techniques.

## Printing to the console

One of the most common debugging techniques is to print to the console. This is likely something you’ve done before, as it’s very simple. This has a few downsides, though. It can be hard to find the print statements in the console, and it can be hard to remove them all when you’re done debugging. Most notably, you have to recompile your plugin and restart the server to add or remove debugging.

When debugging, you can use `System.out.println("");` to print to the console. It is recommended to use your plugin’s logger instead though, as it will be easier to know which plugin the log has come from. This can be done simply with:

```java
plugin.getSLF4JLogger().debug("SuperDuperBad Thing has happened");
```

> [!NOTE] Logger Levels
> In some consoles, using the `warn` or `error` level will print the message in different colors. This can be useful for finding your print statements in the console.

## Using a remote debugger

A debugger is a tool that allows you to pause your code at a certain point and inspect the values of variables. This can be very useful for finding out why your code isn’t working as expected and also for finding out where your code is going wrong.

### Setting up the debugger

To use a debugger, you need to set up your IDE to use it. This is different for each IDE, but for the sake of this guide, we will be using IntelliJ IDEA.

To set up a debugger in IntelliJ, you need to create a new run configuration. You can do this by clicking the dropdown next to the run button and clicking `Edit Configurations...`:

![](../../../assets/docs.papermc.io/_astro/config_dropdown.BFxL9k7t_Zf8FGm.webp)

Then, click the `+` button in the top left and select `Remote JVM Debug`. You can then name the configuration whatever you want, and click `Apply`:

![](../../../assets/docs.papermc.io/_astro/config_add.BZo3OiyP_Z2mKEN9.webp)

Finally, copy the command line arguments from the window, and paste these into your server’s startup script. These will go after the `java` command and before `-jar`. Once you have done this, you can click `OK`. For example:

```shell
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 -jar paper-26.3.jar --nogui
```

Once your server is running, you can use the bug icon in the top right to connect your debugger to the server:

![](../../../assets/docs.papermc.io/_astro/debugger_connect.mnUOoaKC_ZDRJ8d.webp)

#### Using the debugger

Let’s say we have this code:

```java
@EventHandler
public void onPlayerMove(PlayerMoveEvent event) {
    Player player = event.getPlayer();
    Location location = player.getLocation();


    if (location.getWorld() == null)
        return;


    if (location.getWorld().getEnvironment() == World.Environment.NETHER) {
        player.sendPlainMessage("You are in the nether!");
    }
}
```

You can add a breakpoint to the line by clicking on the line number:

![](../../../assets/docs.papermc.io/_astro/add_breakpoints.Dgq1Prxb_Z1pPHSQ.webp)

This will pause the code when it reaches that line. You can then use the debugger to inspect the values of variables:

![](../../../assets/docs.papermc.io/_astro/debugger_use.Cd360zfH_2kA1zG.webp)

You can inspect the values of each of the variables in the current scope. You can also use the buttons in the top to step from one breakpoint to the next. If needed, you can also use the text box at the top to evaluate expressions for debugging purposes.

### Using direct debugging

Direct debugging will allow you to run the server directly from your IDE, and will allow you to use breakpoints and step through your code. We can achieve this by using [JPenilla’s Gradle plugin](https://github.com/jpenilla/run-task) to run the server directly from the IDE. See [here](https://github.com/jpenilla/run-task#basic-usage) for instructions on how to set up the plugin.

### Preventing timeouts while paused

While the server is paused at a breakpoint, it doesn’t tick. If you stay paused for a while, two timeouts can interrupt your debugging session.

#### The watchdog

The watchdog can’t tell a paused server apart from a frozen one. With the default configuration, it starts printing thread dumps after 10 seconds without a tick and stops the server after 60 seconds.

To prevent this, start your server with the [`disable.watchdog`](../../reference/system-properties/index.md#disablewatchdog) system property:

```shell
java -Ddisable.watchdog=true -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 -jar paper-26.3.jar --nogui
```

If you run the server with the Gradle plugin, add the flag to the `runServer` task instead:

```kotlin title="build.gradle.kts"
tasks {
    runServer {
        jvmArgs("-Ddisable.watchdog=true")
    }
}
```

> [!CAUTION] Caution
> Only disable the watchdog on a development server. On a production server, it is what detects and reports a real freeze.

#### Client timeouts

The Vanilla client disconnects after 30 seconds without receiving anything from the server, so you get kicked while the server is paused. This timeout is part of the client and can’t be changed from the server. If you need to stay connected, install a client mod that raises it, such as [untimeout](https://modrinth.com/mod/untimeout).
