---
title: "Dialog API"
source: "https://docs.papermc.io/paper/dev/dialogs/"
description: "A guide to the dialog API introduced in 1.21.7."
fetched_at: "2026-10-19T21:15:59.845Z"
---

# Dialog API

[Dialogs](https://minecraft.wiki/w/Dialog) are a feature added to Minecraft in the [1.21.6](https://minecraft.wiki/w/Java_Edition_1.21.6) update. Paper released developer API for creating custom dialogs in 1.21.7. This section is meant as an introduction to this API and what you can and cannot do with dialogs.

## What is a dialog?

Dialogs are a way for servers to send custom in-game menus to clients. They allow for displaying various information or provide an easy way to gather user input.

Dialogs can be shown to players during the configuration phase or normal gameplay, which makes them a very versatile tool. A simple dialog might look like this:

![A dialog sent during the configuration phase](../../../assets/docs.papermc.io/_astro/confirmation-dialog.qlIGNgwP_Z1NgQsM.webp)

The dialog shown here is a **confirmation**-type dialog, which just means it always contains two buttons, one meant for confirmation and one meant for refusal.

## Showing dialogs

Dialogs can be shown in-game using the `/dialog show <players> <dialog>` command. Alternatively, you can show them using the API by using [`Audience#showDialog(DialogLike)`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/audience/Audience.html#showDialog\(net.kyori.adventure.dialog.DialogLike\)). You can get built-in dialogs statically from the [`Dialog`](https://jd.papermc.io/paper/io/papermc/paper/dialog/Dialog.html) interface. New dialogs can be created dynamically using [`Dialog#create`](https://jd.papermc.io/paper/io/papermc/paper/dialog/Dialog.html#create\(java.util.function.Consumer\)) or, if registered during the bootstrap phase, retrieved from the dialog registry with `RegistryAccess.registryAccess().getRegistry(RegistryKey.DIALOG).get(Key)`.

## Built-in dialogs

There are three built-in dialogs:

-   [Server Links](https://jd.papermc.io/paper/io/papermc/paper/registry/keys/DialogKeys.html#SERVER_LINKS)
-   [Quick Actions](https://jd.papermc.io/paper/io/papermc/paper/registry/keys/DialogKeys.html#QUICK_ACTIONS)
-   [Custom Options](https://jd.papermc.io/paper/io/papermc/paper/registry/keys/DialogKeys.html#CUSTOM_OPTIONS)

### Adding server links

You can add server links by retrieving the [`ServerLinks`](https://jd.papermc.io/paper/org/bukkit/ServerLinks.html) instance from [`Bukkit.getServer().getServerLinks()`](https://jd.papermc.io/paper/org/bukkit/Server.html#getServerLinks\(\)) and using the various mutation methods. The player can open the server links menu at any time by opening the game menu (pressing `esc`) and clicking on the `Server Links...` button. This button only appears if server links are present.

## Creating dialogs dynamically

You can build a [`Dialog`](https://jd.papermc.io/paper/io/papermc/paper/dialog/Dialog.html) object using the [`Dialog#create`](https://jd.papermc.io/paper/io/papermc/paper/dialog/Dialog.html#create\(java.util.function.Consumer\)) method. The consumer parameter allows you to build the dialog. **A dialog always requires a base and a type**, which can be declared in the builder. You can either create a new dialog or alternatively use an existing [registry-registered](#registering-dialogs-in-the-registry) dialog as a base instead.

For reference, a very simple (notice-type) dialog can be constructed and shown to a player with the following code:

<details>
<summary>In-game preview</summary>

![A dialog with only a title and an ok button](../../../assets/docs.papermc.io/_astro/notice-dialog.DaeSpFd2_ZY4Awx.webp)

</details>


```java
Dialog dialog = Dialog.create(builder -> builder.empty()
    .base(DialogBase.builder(text("Title")).build())
    .type(DialogType.notice())
);
player.showDialog(dialog);
```

### Dialog base

You can create a dialog base using its [builder](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.Builder.html), which can be created using [`DialogBase#builder(Component)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.html#builder\(net.kyori.adventure.text.Component\)). A dialog base can declare the following values:

| Method | Description |
| --- | --- |
| [`afterAction(DialogAfterAction)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.Builder.html#afterAction\(io.papermc.paper.registry.data.dialog.DialogBase.DialogAfterAction\)) | The action to take after the dialog is closed |
| [`canCloseWithEscape(boolean)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.Builder.html#canCloseWithEscape\(boolean\)) | Whether the dialog can be closed with the `esc` key |
| [`externalTitle(Component)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.Builder.html#externalTitle\(net.kyori.adventure.text.Component\)) | The title to display on buttons which open this dialog |
| [`body(List<? extends DialogBody>)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.Builder.html#body\(java.util.List\)) | The body of the dialog. |
| [`inputs(List<? extends DialogInput>)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/DialogBase.Builder.html#inputs\(java.util.List\)) | The inputs of the dialog. |

#### Dialog body

A dialog can contain an arbitrary number of body components. A body entry can be created using [`DialogBody#plainMessage(Component)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/body/DialogBody.html#plainMessage\(net.kyori.adventure.text.Component\)) for displaying text or [`DialogBody#item(ItemStack)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/body/DialogBody.html#item\(org.bukkit.inventory.ItemStack\)) for displaying items.

#### Dialog input

There are four ways to gather input:

-   [`DialogInput.bool`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/input/DialogInput.html#bool\(java.lang.String,net.kyori.adventure.text.Component\))

    A simple tick box representing a true or false state

    ![](../../../assets/docs.papermc.io/_astro/input-boolean.Cpo3o710_Z2upaKt.webp)

-   [`DialogInput.singleOption`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/input/DialogInput.html#singleOption\(java.lang.String,net.kyori.adventure.text.Component,java.util.List\))

    A multiple-choice button

    ![](../../../assets/docs.papermc.io/_astro/input-multi-options.CgHkNz2V_1AV5eM.webp)

-   [`DialogInput.text`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/input/DialogInput.html#text\(java.lang.String,net.kyori.adventure.text.Component\))

    A simple string input field

    ![](../../../assets/docs.papermc.io/_astro/input-text.CJMeHKdP_Z1I9iUj.webp)

-   [`DialogInput.numberRange`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/input/DialogInput.html#numberRange\(java.lang.String,net.kyori.adventure.text.Component,float,float\))

    A slider for number input

    ![](../../../assets/docs.papermc.io/_astro/input-number-range.DuG-Gl9K_Z2lj6gz.webp)

### Dialog type

The [`DialogType`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html) interface defines a few static methods for the various dialog types. The following types exist:

| Type | Method | Description |
| --- | --- | --- |
| notice | [`notice()`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html#notice\(\)) or [`notice(ActionButton button)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html#notice\(io.papermc.paper.registry.data.dialog.ActionButton\)) | A simple dialog with just one button |
| confirmation | [`confirmation(ActionButton yesButton, ActionButton noButton)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html#confirmation\(io.papermc.paper.registry.data.dialog.ActionButton,io.papermc.paper.registry.data.dialog.ActionButton\)) | A dialog with a yes and no button |
| dialog list | [`dialogList(RegistrySet dialogs)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html#dialogList\(io.papermc.paper.registry.set.RegistrySet\)) | A dialog for opening the specified dialogs |
| multiple actions | [`multiAction(List<ActionButton> actions)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html#multiAction\(java.util.List\)) | A dialog for displaying multiple buttons |
| server links | [`serverLinks(ActionButton exitAction, int columns, int buttonWidth)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/type/DialogType.html#serverLinks\(io.papermc.paper.registry.data.dialog.ActionButton,int,int\)) | A server links dialog |

The type primarily influences the bottom part of the dialog.

## Registering dialogs in the registry

If you want dialogs to be registered in the dialogs registry, you must register them inside a registry modification lifecycle event in your plugin’s bootstrapper. Some general information on that can be read [here](../registries/index.md).

> [!TIP] Tip
> The advantage of registering dialogs in the registry is that it allows you to use that same dialog elsewhere in your code without having to pass around the `Dialog` object. This also allows the dialog to be referenced in commands with a dialog parameter.

The general registration looks fairly similar to dynamically created dialogs:

```java title="ExamplePluginBootstrap.java"
@Override
public void bootstrap(final BootstrapContext context) {
    context.getLifecycleManager().registerEventHandler(
        RegistryEvents.DIALOG.compose(),
        event -> event.registry().register(
            DialogKeys.create(Key.key("papermc:custom_dialog")),
            builder -> builder
                // Build your dialog here ...
                .base(DialogBase.builder(Component.text("Title")).build())
                .type(DialogType.notice())
        )
    );
}
```

## Closing dialogs

Dialogs can be closed from the API. There are two ways to achieve that:

-   The intended way of using [`Audience#closeDialog()`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/audience/Audience.html#closeDialog\(\)).
-   The slightly hacky way of using [`HumanEntity#closeInventory()`](https://jd.papermc.io/paper/org/bukkit/entity/HumanEntity.html#closeInventory\(\)).

Using `closeDialog()` will result in the dialog being closed and the player returning to the previous non-dialog or game menu screen they were on. This means any previously open inventories will be kept open.

In contrast, `closeInventory()` will close not only the currently open dialog, but also any other screens, like an open inventory.

## Example: A blocking confirmation dialog

If you want your players to read some information, agree to something, or give general input before they join your server, you can send them a dialog during the configuration phase. For this example, we will be creating the dialog shown at the start.

### The dialog

The dialog is a simple confirmation-type dialog with a single plain message body components. We will register it in the bootstrapper so that we can easily retrieve it from the `AsyncPlayerConnectionConfigureEvent`, where the dialog will be sent from.

```java
context.getLifecycleManager().registerEventHandler(RegistryEvents.DIALOG.compose(),
    event -> event.registry().register(
        DialogKeys.create(Key.key("papermc:praise_paperchan")),
        builder -> builder
            .base(DialogBase.builder(text("Accept our rules!", NamedTextColor.LIGHT_PURPLE))
                .canCloseWithEscape(false)
                .body(List.of(
                    DialogBody.plainMessage(text("By joining our server you agree that Paper-chan is cute!"))
                ))
                .build()
            )
            .type(DialogType.confirmation(
                ActionButton.builder(text("Paper-chan is cute!", TextColor.color(0xEDC7FF)))
                    .tooltip(text("Click to agree!"))
                    .action(DialogAction.customClick(Key.key("papermc:paperchan/agree"), null))
                    .build(),
                ActionButton.builder(text("I hate Paper-chan!", TextColor.color(0xFF8B8E)))
                    .tooltip(text("Click this if you are a bad person!"))
                    .action(DialogAction.customClick(Key.key("papermc:paperchan/disagree"), null))
                    .build()
            ))
    )
);
```

Notice the `.action` methods on the confirmation `ActionButton`s. These hold a key and an optional, custom NBT payload that will be sent from the client to the server when the player clicks one of the buttons. We use that to identify the click event.

This example uses two separate keys for both keys, but you can also use only one and set a custom NBT payload.

### Requiring the player to agree before allowing them to join

In order to block the player from joining the server, we send them the dialog and await a response. We do this by constructing a `CompletableFuture`, putting it into a map, and waiting until the future gets completed, will only happen as soon the player pressed one of the two confirmation buttons of the dialog.

The code for that would look something like this:

<details>
<summary>In-game preview</summary>

Your device does not support video playback.

</details>


```java title="ServerJoinListener.java"
public class ServerJoinListener implements Listener {


    /// A map for holding all currently connecting players.
    private final Map<UUID, CompletableFuture<Boolean>> awaitingResponses = new ConcurrentHashMap<>();


    @EventHandler
    void onPlayerConfigure(AsyncPlayerConnectionConfigureEvent event) {
        Dialog dialog = RegistryAccess.registryAccess().getRegistry(RegistryKey.DIALOG).get(Key.key("papermc:praise_paperchan"));
        if (dialog == null) {
            // The dialog failed to load :(
            // This would happen if the dialog could not be found in the registry by the provided key.
            // Usually that is an indicator that the used key is different from the one used to register your
            // dialog, your bootstrapper might not be registered, or an exception occurred in the bootstrap phase.
            return;
        }


        PlayerConfigurationConnection connection = event.getConnection();
        UUID profileId = connection.getProfile().getId();
        if (profileId == null) {
            return;
        }


        // Construct a new completable future without a task.
        CompletableFuture<Boolean> response = new CompletableFuture<>();
        // Complete the future if nothing has been done after one minute.
        response.completeOnTimeout(false, 1, TimeUnit.MINUTES);


        // Put it into our map.
        this.awaitingResponses.put(profileId, response);


        Audience audience = connection.getAudience();
        // Show the connecting player the dialog.
        audience.showDialog(dialog);


        // Wait until the future is complete. This step is necessary in order to keep the player in the configuration phase.
        if (!response.join()) {
            // We close the dialog manually because the client might not do it on its own.
            audience.closeDialog();
            // If the response is false, they declined. Therefore, we kick them from the server.
            connection.disconnect(Component.text("You hate Paper-chan :(", NamedTextColor.RED));
        }


        // We clean the map to avoid unnecessary entry buildup.
        this.awaitingResponses.remove(profileId);
    }


    /// An event for handling dialog button click events.
    @EventHandler
    void onDialogSubmit(PlayerCustomClickEvent event) {
        // Handle custom click only for configuration connection.
        if (!(event.getCommonConnection() instanceof PlayerConfigurationConnection connection)) {
            return;
        }


        UUID profileId = connection.getProfile().getId();
        if (profileId == null) {
            return;
        }


        Key key = event.getIdentifier();
        if (key.equals(Key.key("papermc:paperchan/disagree"))) {
            // If the identifier is the same as the disagree one, set the connection result to false.
            this.setConnectionAgreement(profileId, false);
        } else if (key.equals(Key.key("papermc:paperchan/agree"))) {
            // If it is the same as the agree one, set the result to true.
            this.setConnectionAgreement(profileId, true);
        }
    }


    /// An event handler for cleanup the map to avoid unnecessary entry buildup.
    @EventHandler
    void onConnectionClose(PlayerConnectionCloseEvent event) {
        this.awaitingResponses.remove(event.getPlayerUniqueId());
    }


    /// Simple utility method for setting a connection's dialog response result.
    private void setConnectionAgreement(UUID profileId, boolean value) {
        CompletableFuture<Boolean> future = this.awaitingResponses.get(profileId);
        if (future != null) {
            future.complete(value);
        }
    }
}
```

And that’s all there is to it. You can use this code to block players from joining your server before they should be allowed to.

## Example: Retrieving and parsing user input

The dialog for this example will be fairly simple: We once again create a confirmation-type dialog which contains two number range inputs. The top input will be for setting the level, the bottom input for setting the experience percentage towards the next level. When the player clicks on the confirmation button, they should have their levels and exp set to the configured values.

```java
Dialog.create(builder -> builder.empty()
    .base(DialogBase.builder(text("Configure your new experience value"))
        .inputs(List.of(
            DialogInput.numberRange("level", text("Level", NamedTextColor.GREEN), 0.0F, 100.0F)
                .step(1.0F)
                .initial(0.0F)
                .width(300)
                .build(),
            DialogInput.numberRange("experience", text("Experience", NamedTextColor.GREEN), 0.0F, 100.0F)
                .step(1.0F)
                .initial(0.0F)
                .labelFormat("%s: %s percent to the next level")
                .width(300)
                .build()
        ))
        .build()
    )
    .type(DialogType.confirmation(
        ActionButton.create(
            text("Confirm", TextColor.color(0xAEFFC1)),
            text("Click to confirm your input."),
            100,
            DialogAction.customClick(Key.key("papermc:user_input/confirm"), null)
        ),
        ActionButton.create(
            text("Discard", TextColor.color(0xFFA0B1)),
            text("Click to discard your input."),
            100,
            null // If we set the action to null, it doesn't do anything and closes the dialog
        )
    ))
);
```

### Reading the input

To retrieve the values the user put into the dialog, we can once again listen to a `PlayerCustomClickEvent`. We first check the identifier of the action. After that, we can retrieve the input values from the [`DialogResponseView`](https://jd.papermc.io/paper/io/papermc/paper/dialog/DialogResponseView.html) retrievable from [`PlayerCustomClickEvent#getDialogResponseView()`](https://jd.papermc.io/paper/io/papermc/paper/event/player/PlayerCustomClickEvent.html#getDialogResponseView\(\)).

This view allows us to retrieve the value of an input field with the field’s key. Those are declared as the first parameter of the `DialogInput.numberRange` method.

The last issue is getting a player object from this event. We cannot just call `event.getPlayer()`. Instead, we have to cast the connection retrievable from [`PlayerCustomClickEvent#getCommonConnection()`](https://jd.papermc.io/paper/io/papermc/paper/event/player/PlayerCustomClickEvent.html#getCommonConnection\(\)). to a [`PlayerGameConnection`](https://jd.papermc.io/paper/io/papermc/paper/connection/PlayerGameConnection.html), from which we can get the player.

The full event handler code looks like this:

<details>
<summary>In-game preview</summary>

Your device does not support video playback.

</details>


```java
@EventHandler
void onDialogSubmit(PlayerCustomClickEvent event) {
    if (!event.getIdentifier().equals(Key.key("papermc:user_input/confirm"))) {
        return;
    }
    if (!(event.getCommonConnection() instanceof PlayerGameConnection connection)) {
        return;
    }


    DialogResponseView view = event.getDialogResponseView();
    if (view == null) {
        return;
    }


    int level = view.getFloat("level").intValue();
    float exp = view.getFloat("experience").floatValue();


    Player player = connection.getPlayer();
    player.sendRichMessage("You selected <color:#ccfffd><level> levels</color> and <color:#ccfffd><exp>% exp</color> to the next level!",
        Placeholder.unparsed("level", String.valueOf(level)),
        Placeholder.unparsed("exp", String.valueOf(exp))
    );
    player.setLevel(level);
    player.setExp(exp / 100);
}
```

### Using callbacks

Instead of registering another event handler, you can instead use the [`DialogAction#customClick(DialogActionCallback, ClickCallback.Options)`](https://jd.papermc.io/paper/io/papermc/paper/registry/data/dialog/action/DialogAction.html#customClick\(io.papermc.paper.registry.data.dialog.action.DialogActionCallback,net.kyori.adventure.text.event.ClickCallback.Options\)) method to register a callback locally.

The code for the dialog action would therefore look like this:

```java
DialogAction.customClick(
    (view, audience) -> {
        if (!(audience instanceof Player player)) {
            return;
        }


        int level = view.getFloat("level").intValue();
        float exp = view.getFloat("experience").floatValue();


        player.sendRichMessage("You selected <color:#ccfffd><level> levels</color> and <color:#ccfffd><exp>% exp</color> to the next level!",
            Placeholder.unparsed("level", String.valueOf(level)),
            Placeholder.unparsed("exp", String.valueOf(exp))
        );


        player.setLevel(level);
        player.setExp(exp / 100);
    },
    ClickCallback.Options.builder()
        .uses(1) // Set the number of uses for this callback. Defaults to 1
        .lifetime(ClickCallback.DEFAULT_LIFETIME) // Set the lifetime of the callback. Defaults to 12 hours
        .build()
)
```

### Using NBT payloads

Instead of using callbacks, you can use NBT payloads and event handlers.

If we take a look at the dialog creation code again, the confirmation button is created like this:

```java
ActionButton.create(
    Component.text("Confirm", TextColor.color(0xAEFFC1)),
    Component.text("Click to confirm your input."),
    100,
    DialogAction.customClick(Key.key("papermc:user_input/confirm"), null)
),
```

The DialogAction’s last parameter, currently `null`, is an optional `BinaryTagHolder` payload. If we wanted to, we could put custom NBT data in there. This NBT data will be sent to the client when the dialog is shown. When the player clicks the button, a [`PlayerCustomClickEvent`](https://jd.papermc.io/paper/io/papermc/paper/event/player/PlayerCustomClickEvent.html) will be fired containing the same NBT data among other information.

#### Creating payloads with `adventure-nbt`

The `BinaryTagHolder.binaryTagHolder` factory method requires a SNBT-formatted string. We can either construct this string manually, or use the `adventure-nbt` library to create NBT data programmatically.

> [!CAUTION] Caution
> The `adventure-nbt` library is not included by default in Paper, you will have to include it manually.
>
>

<details>
<summary>Adding the adventure-nbt dependency.</summary>

#### Gradle (Kotlin)

```kotlin title="build.gradle.kts"
repositories {
  mavenCentral()
}


dependencies {
  implementation("net.kyori:adventure-nbt:5.2.0")
}
```

#### Gradle (Groovy)

```groovy title="build.gradle"
repositories {
  mavenCentral()
}


dependencies {
  implementation 'net.kyori:adventure-nbt:5.2.0'
}
```

#### Maven

```xml title="pom.xml"
<dependency>
  <groupId>net.kyori</groupId>
  <artifactId>adventure-nbt</artifactId>
  <version>5.2.0</version>
</dependency>
```


</details>

Using `TagStringIO` we can convert any NBT tag into an SNBT string like so:

```java
BinaryTagHolder payload = BinaryTagHolder.binaryTagHolder(
    TagStringIO.tagStringIO().asString(
        CompoundBinaryTag.builder()
            .putString("action", "confirm")
            .putInt("some_value", 42)
            .build()
    )
);
```

### Reading NBT payloads

To read the NBT payload, we can use the [`PlayerCustomClickEvent#getTag()`](https://jd.papermc.io/paper/io/papermc/paper/event/player/PlayerCustomClickEvent.html#getTag\(\)) method.

#### Reading payloads with `adventure-nbt`

The `getTag()` method returns a `BinaryTagHolder`, which we can convert back into a `CompoundBinaryTag` using the `TagStringIO` class again:

```java
BinaryTagHolder tagHolder = event.getTag();
String snbt = tagHolder.string();
CompoundBinaryTag tag = TagStringIO.tagStringIO().asCompound(snbt);


String action = tag.getString("action");
int someValue = tag.getInt("some_value");
```
