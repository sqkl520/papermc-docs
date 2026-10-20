---
title: "Signed messages"
source: "https://docs.papermc.io/paper/dev/component-api/signed-messages/"
description: "A guide to working with SignedMessage objects."
fetched_at: "2026-10-19T21:15:59.269Z"
---

# Signed messages

Since [Minecraft version 1.19](https://minecraft.wiki/w/Java_Edition_1.19), the client now signs any messages it sends so that they are uniquely identifiable and verifiable to be sent by a specific player. With this update, they also introduced the ability **delete specific messages** previously sent by a player.

> [!TIP] Note
> This guide does not go in-depth into the specifics of chat signing and its implementation on either client or server. For a full overview, you can refer [to this linked gist](https://gist.github.com/kennytv/ed783dd244ca0321bbd882c347892874).

## How are signed messages represented in code?

Paper uses Adventure’s [`SignedMessage`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/SignedMessage.html) object to represent a signed message. We differentiate two kinds of signed messages: system messages and non-system messages. System messages (checked with [`SignedMessage#isSystem()`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/SignedMessage.html#isSystem\(\))) are messages send by the server, whilst non-system messages are not.

You can also differentiate the **signed plain text** `String` content of the message ([`SignedMessage#message()`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/SignedMessage.html#message\(\))) from the unsigned, nullable [`Component`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/text/Component.html) content ([`SignedMessage#unsignedContent()`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/SignedMessage.html#unsignedContent\(\))).

## Obtaining a signed message

Signed messages can be obtained in two ways.

1.  From an [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html) using [`AbstractChatEvent#signedMessage()`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AbstractChatEvent.html#signedMessage\(\)).

2.  From an [`ArgumentTypes#signedMessage()`](https://jd.papermc.io/paper/io/papermc/paper/command/brigadier/argument/ArgumentTypes.html#signedMessage\(\)) Brigadier argument type.

## Using signed messages

You can send signed message objects to an [`Audience`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/audience/Audience.html) using the [`Audience#sendMessage(SignedMessage, ChatType.Bound)`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/audience/Audience.html#sendMessage\(net.kyori.adventure.chat.SignedMessage,net.kyori.adventure.chat.ChatType.Bound\)) method. You can obtain a [`ChatType.Bound`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/ChatType.Bound.html) object from the [`ChatType`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/chat/ChatType.html) interface.

Deleting messages is much simpler. Adventure provides the [`Audience#deleteMessage(SignedMessage)`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/audience/Audience.html#deleteMessage\(net.kyori.adventure.chat.SignedMessage\)) or [`Audience#deleteMessage(SignedMessage.Signature)`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/audience/Audience.html#deleteMessage\(net.kyori.adventure.chat.SignedMessage.Signature\)) methods for that.

## Example: Making user sent messages deletable

For our example, we will create a chat format plugin which allows a user to delete their own messages in case they made a mistake. For this we will use the [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html).

> [!TIP] AsyncChatEvent
> The [`AsyncChatEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/AsyncChatEvent.html) is covered in the [chat events](../../chat-events/index.md) documentation page. If you want to read up on more detail on the chat renderer, you can do so there.

### In-game preview

![](../../../../assets/docs.papermc.io/_astro/signed-messages-deletion.CS-ZEcGo_Z2i9xf7.webp)

### Code

```java title="SignedChatListener.java"
public class SignedChatListener implements Listener {


    @EventHandler
    void onPlayerChat(AsyncChatEvent event) {
        // We modify the chat format, so we use a chat renderer.
        event.renderer((player, playerName, message, viewer) -> {
            // This is the base format of our message. It will format chat as "<player_name> » <message>".
            final Component base = Component.textOfChildren(
                playerName.colorIfAbsent(NamedTextColor.GOLD),
                Component.text(" » ", NamedTextColor.DARK_GRAY),
                message
            );


            // Send the base format to any player who is not the sender.
            if (viewer != player) {
                return base;
            }


            // Create a base delete suffix. The creation is separated into two
            // parts purely for readability reasons.
            final Component deleteCrossIcon = Component.textOfChildren(
                Component.text("[", NamedTextColor.DARK_GRAY),
                Component.text("X", NamedTextColor.DARK_RED, TextDecoration.BOLD),
                Component.text("]", NamedTextColor.DARK_GRAY)
            );


            // Add a hover and click event to the delete suffix.
            final Component deleteCross = deleteCrossIcon
                .hoverEvent(Component.text("Click to delete your message!", NamedTextColor.RED))
                // We retrieve the signed message with event.signedMessage() and request a server-wide deletion if the
                // deletion cross were to be clicked.
                .clickEvent(ClickEvent.callback(_ -> Bukkit.getServer().deleteMessage(event.signedMessage())));


            // Send the base format but with the delete suffix.
            return base.appendSpace().append(deleteCross);
        });
    }
}
```
