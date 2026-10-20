---
title: "Internationalization"
source: "https://docs.papermc.io/paper/dev/component-api/i18n/"
description: "How to use Adventure's internationalization."
fetched_at: "2026-10-19T21:15:59.162Z"
---

# Internationalization

Generally it’s a good idea to support translations in your plugin, especially if you want to appeal to the largest user base. Adventure makes this simple by adding a server-side translation layer to almost all text that ends up being displayed to clients.

> [!NOTE] Javadocs
> Adventure’s Javadocs for all-things translations can be found [here](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/translation/package-summary.html).

## GlobalTranslator

All translation is done through [`GlobalTranslator`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/translation/GlobalTranslator.html). You can render translations yourself and add new sources for translations.

You can add sources to the `GlobalTranslator` by creating instances of [`TranslationStore`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/translation/TranslationStore.html) or implementing the [`Translator`](https://jd.papermc.io/adventure/net.kyori.adventure.api/net/kyori/adventure/translation/Translator.html) interface yourself.

## Where translations work

Vanilla Minecraft handles translations on the client by using the language files bundled with the client or provided via resource packs. If you don’t want to send custom language files in a resource pack, server-side translations are the only alternative. They work anywhere the component API exists, except for [`ItemStack`](https://jd.papermc.io/paper/org/bukkit/inventory/ItemStack.html) display text like the display name or lore. So chat, entity display names, scoreboards, tab lists, etc., all support translations.

## Examples

### `ResourceBundle`

```properties title="src/main/resources/your/plugin/Bundle_en_US.properties"
some.translation.key=Translated Message: {0}
```

```java
TranslationStore.StringBased<MessageFormat> store = TranslationStore.messageFormat(Key.key("namespace:value"));


ResourceBundle bundle = ResourceBundle.getBundle("your.plugin.Bundle", Locale.US);
store.registerAll(Locale.US, bundle, true);
GlobalTranslator.translator().addSource(store);
```

This creates a new `TranslationStore` under a specified namespace. Then, a [`ResourceBundle`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ResourceBundle.html) is created from a bundle located on the classpath with the specified [`Locale`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html). Finally, that `ResourceBundle` is added to the store. That store is then added as a source to the `GlobalTranslator`. This makes all the translations available server-side.

Now you can use your translation keys in translatable components.

```java
Component.translatable("some.translation.key", Component.text("The Argument"))
```

This will show to clients using the US English language: `Translated Message: The Argument`.
