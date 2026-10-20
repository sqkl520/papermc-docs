---
title: "Chat events"
source: "https://docs.papermc.io/paper/dev/chat-events/"
description: "An outline on AsyncChatEvent and how to handle it."
fetched_at: "2026-10-19T21:15:57.526Z"
---

# Chat events

The chat event has evolved a few times over the years. This guide will explain how to properly use the new [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html) and its [`ChatRenderer`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html). The [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html) is an improved version of the old [`AsyncPlayerChatEvent`](https://jd.papermc.io/paper/org/bukkit/event/player/AsyncPlayerChatEvent.html) that allows you to render chat messages individually for each player.

> [!NOTE] AsyncChatEvent vs ChatEvent
> The key difference between [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html) and [`ChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/ChatEvent.html) is that [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html) is fired asynchronously.
>
> This means that it does not block the main thread and sends the chat message when the listener has completed. Be aware that using the Bukkit API in an asynchronous context (i.e. the event handler) is unsafe and exceptions may be thrown. If you need to use the Bukkit API, you can use [`ChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/ChatEvent.html). However, we recommend using [`BukkitScheduler`](../scheduler/index.md).

## Understanding the renderer

Before we can start using the new chat event, we need to understand how the new renderer works. The renderer is Paper’s way of allowing plugins to modify the chat message before it is sent to the player. This is done by using the [`ChatRenderer`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html) interface with its [`ChatRenderer#render(Player, Component, Component, Audience)`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html#render\(org.bukkit.entity.Player,net.kyori.adventure.text.Component,net.kyori.adventure.text.Component,net.kyori.adventure.audience.Audience\)) method. Previously, this was done by using the [`AsyncPlayerChatEvent`](https://jd.papermc.io/paper/org/bukkit/event/player/AsyncPlayerChatEvent.html) with its [`AsyncPlayerChatEvent#setFormat(String)`](https://jd.papermc.io/paper/org/bukkit/event/player/AsyncPlayerChatEvent.html#setFormat\(java.lang.String\)) method.

```java title="ChatRenderer.java"
Component render(Player source, Component sourceDisplayName, Component message, Audience viewer);
```

-   The [`render`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html#render\(org.bukkit.entity.Player,net.kyori.adventure.text.Component,net.kyori.adventure.text.Component,net.kyori.adventure.audience.Audience\)) method is called when a chat message is sent to the player.
-   The `source` parameter is the player that sent the message.
-   The `sourceDisplayName` parameter is the display name of the player that sent the message.
-   The `message` parameter is the message that was sent.
-   The `viewer` parameter is the player that is receiving the message.

> [!TIP] ChatRenderer.ViewerUnaware
> If your renderer does not need to know about the viewer, you can use the [`ChatRenderer.ViewerUnaware`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.ViewerUnaware.html) interface instead of the [`ChatRenderer`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html) interface. This will benefit performance as the message will only be rendered once instead of each individual player.

## Using the renderer

There are two ways to use the renderer.

1.  Implementing the [`ChatRenderer`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html) interface in a class.
2.  Using a lambda expression.

Depending on the complexity of your renderer, you may want to use one or the other.

### Implementing the `ChatRenderer` interface

The first way of using the renderer is by implementing the [`ChatRenderer`](https://jd.papermc.io/paper/io/papermc/paper/chat/ChatRenderer.html) interface in a class. In this example, we will be using our `ChatListener` class.

Next, we need to tell the event to use the renderer by using the [`AbstractChatEvent#renderer()`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AbstractChatEvent.html#renderer\(\)) method.

```java title="ChatListener.java"
public class ChatListener implements Listener, ChatRenderer {


    @EventHandler
    public void onChat(AsyncChatEvent event) {
        event.renderer(this); // Tell the event to use our renderer
    }


    @Override
    public Component render(Player source, Component sourceDisplayName, Component message, Audience viewer) {
        // ...
    }
}
```

> [!NOTE] Note
> If you decide to create a separate class for your renderer, it is important to know that you don’t need to instantiate the class every time the event is called. In this case, you can use [the singleton pattern](https://en.wikipedia.org/wiki/Singleton_pattern) to create a single instance of the class.

### Using a lambda expression

Another way of using the renderer is by using a lambda expression.

```java title="ChatListener.java"
public class ChatListener implements Listener {


    @EventHandler
    public void onChat(AsyncChatEvent event) {
        event.renderer((source, sourceDisplayName, message, viewer) -> {
            // ...
        });
    }
}
```

## Rendering the message

Now that we have our renderer, we can start rendering the message.

Let’s say we want to render our chat to look like this:

![](../../../assets/docs.papermc.io/_astro/plain-message-rendering.CSp3azaV_X1OsX.webp)

To do this, we need to return a new [`Component`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/Component.html) that contains the message we want to send.

```java title="ChatListener.java"
public class ChatListener implements Listener, ChatRenderer {


    // Event logic...


    @Override
    public Component render(Player source, Component sourceDisplayName, Component message, Audience viewer) {
        return sourceDisplayName
                .append(Component.text(": "))
                .append(message);
    }
}
```

Now you can see that the message is rendered as we wanted it to be.

## Conclusion

That is all you need to know about the new chat event and its renderer. Of course there are many more things you can do with components in general. If you want to learn more about components, you can read the [Component Documentation](https://docs.papermc.io/adventure/text/).
