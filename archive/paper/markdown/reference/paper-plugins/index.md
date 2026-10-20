---
title: "Paper plugins"
source: "https://docs.papermc.io/paper/reference/paper-plugins/"
description: "A guide to the ins and outs of Paper plugins."
fetched_at: "2026-10-19T21:16:03.076Z"
---

# Paper plugins

This documentation page serves to explain all the new semantics and possible confusions that Paper plugins may introduce.

> [!NOTE] Note
> Developers can get more information on Paper plugins [here](../../dev/getting-started/paper-plugins/index.md).

## What are they?

Paper plugins are plugins which are loaded by Paper’s new plugin loading framework. Paper plugins are used by developers to take advantage of modern systems Mojang provides, for example, datapacks.

![Plugin List](../../../assets/docs.papermc.io/_astro/plugin-list.xu6gSgcJ_13sLFe.webp)

## What is the difference?

When enabled, Paper plugins are **identical** to Bukkit plugins. This allows plugins to still fully communicate and support each other, meaning that even if a plugin is a Bukkit or Paper plugin, they are both able to depend on each other just fine.

Paper plugins only support being loaded by Paper’s Plugin Loader and may use new API unavailable to Bukkit plugins.

### How do I add Paper plugins?

Paper plugins are added the same as Bukkit plugins, therefore, you can follow [this guide](../../adding-plugins/index.md).

### Cyclic plugin loading

With the introduction of Paper plugins, Paper introduces a new plugin loader that fixes some odd issues. However, as a result, this now causes [cyclic loading](../../dev/getting-started/paper-plugins/index.md#cyclic-plugin-loading) between plugins to no longer be supported.

If Paper detects a loop, your server will be shut down with an error.

> [!DANGER] Legacy
> If your server **requires** this circular loading, you can enable this by adding the [`-Dpaper.useLegacyPluginLoading=true`](../system-properties/index.md#paperuselegacypluginloading) startup flag. Please note that this may not be supported in the future.
