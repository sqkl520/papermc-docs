
# ViaVersion

Using Adventure with ViaVersion.

:::danger

Adventure platform implementation for ViaVersion is no longer maintained.
The Adventure team no longer provides support for using these libraries.

We recommend that users of these libraries update to modern platforms that [natively support Adventure](/adventure/platform/native) (e.g., Velocity, Paper, Sponge API 8+).

:::

On supported platforms (Sponge 7 and Bukkit), Adventure is able to enhance its functionality
by using the [ViaVersion](https://hangar.papermc.io/ViaVersion/ViaVersion) API
to send packets directly to the client. This allows, for instance, for a plugin on a Minecraft
1.7 server to send RGB chat messages and titles to clients on newer versions of Minecraft.

If you include the Sponge or Bukkit platforms, no further action is required: ViaVersion will
be detected and support for it will be enabled.


---


# Welcome

Documentation for all projects under the PaperMC umbrella, including Paper, Velocity and Folia.

import { CardGrid } from "@astrojs/starlight/components";
import { ContributorList } from "astro-contributors";
import LinkCard from "/src/components/LinkCard.astro";

<CardGrid>
  <LinkCard title="Paper" href="/paper" icon="paper">
    High performance Minecraft server that aims to fix gameplay and mechanics inconsistencies.
  </LinkCard>
  <LinkCard title="Velocity" href="/velocity" icon="velocity">
    The modern, next-generation Minecraft server proxy.
  </LinkCard>
  <LinkCard title="Folia" href="/folia" icon="folia">
    A fork of Paper which adds regionized multithreading to the dedicated server.
  </LinkCard>
  <LinkCard title="Adventure" href="/adventure" icon="adventure">
    A Java library for server-controllable user interface elements in Minecraft: Java Edition.
  </LinkCard>
  <LinkCard title="Waterfall" href="/waterfall" destructive icon="waterfall">
    A discontinued BungeeCord proxy fork that aimed to improve performance and stability.
  </LinkCard>
  <LinkCard title="Miscellaneous" href="/misc" icon="random">
    Various other documentation and tools.
  </LinkCard>
</CardGrid>

<br />

## [Contribute](https://github.com/PaperMC/docs)

We’d like to extend a warm thank you to all the contributors who have helped bring this documentation site to life.
Whether you've written code, submitted feedback, fixed a typo, or shared your expertise - every contribution is deeply appreciated.
This is very much a team effort, and we’re grateful to have you with us on the journey!

<ContributorList githubRepo="PaperMC/docs" />


---


# Art assets

The official PaperMC and Velocity logomarks and the terms under which you may use them.

<style>
  :root[data-theme="dark"] {
    --image-backdrop-light: var(--sl-color-white);
  }
  :root[data-theme="light"] {
    --image-backdrop-dark: var(--sl-color-white);
  }
  table td {
    vertical-align: middle;
  }
  table img {
    width: 12rem !important;
  }
</style>

This page provides the official PaperMC and Velocity logomarks and the terms under which you may use them.

Images on this page are available through our CDN, and using the provided URLs is encouraged (but not necessary)
when referencing these assets in your projects, as long as you adhere to the usage guidelines outlined below.

:::caution

The logomarks are subject to their own separate licensing terms and do not inherit any from the
projects they represent.

:::

## PaperMC

You may:

- Use the PaperMC logomark to represent the project in blog posts and other places in order to bring
  attention to the project.
- Use the PaperMC logomark to represent Paper-Server in downloads, server selectors, and similar
  places.
- Crop out extra transparent canvas space behind the PaperMC logomark, so it fits better next to
  other content.

You may not:

- Alter any of the colors used in the PaperMC logomark.
- Change the dimensions of the PaperMC logomark.
- Create modified versions of the PaperMC logomark or derivative works of it.
- Add your own project images or branding to the PaperMC logomark.
- Claim the logomark as your own work or use it as a representation of your own projects.
- Sell the PaperMC logomark on its own or as part of other products without explicit permission.
- Alter the transparency of any elements within the PaperMC logomark.

| Image                                                                                                                                        | URL                                                                      |
|----------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| <div style="background-color: var(--image-backdrop-light);">![](https://assets.papermc.io/brand/papermc_combination_mark_dark.min.svg)</div> | `https://assets.papermc.io/brand/papermc_combination_mark_dark.min.svg`  |
| <div style="background-color: var(--image-backdrop-dark);">![](https://assets.papermc.io/brand/papermc_combination_mark_light.min.svg)</div> | `https://assets.papermc.io/brand/papermc_combination_mark_light.min.svg` |
| ![](https://assets.papermc.io/brand/papermc_logo.min.svg)                                                                                    | `https://assets.papermc.io/brand/papermc_logo.min.svg`                   |
| ![](https://assets.papermc.io/brand/papermc_logo.256.png)                                                                                    | `https://assets.papermc.io/brand/papermc_logo.256.png`                   |
| ![](https://assets.papermc.io/brand/papermc_logo.512.png)                                                                                    | `https://assets.papermc.io/brand/papermc_logo.512.png`                   |

## Velocity

Please do not edit, recolor, rearrange, or distort the Velocity logo. Resizing the
logo and cropping out any blank space is acceptable.

The logo should not be used in a matter that suggests the Velocity project officially
endorses some product or service. For instance, you may advertise a plugin as being
compatible with Velocity, but you may not make the Velocity logo prominent in that
advertising.

| Image                                                                                                                                         | URL                                                                       |
|-----------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| ![](https://assets.papermc.io/brand/velocity_combination_mark_blue.min.svg)                                                                   | `https://assets.papermc.io/brand/velocity_combination_mark_blue.min.svg`  |
| <div style="background-color: var(--image-backdrop-dark);">![](https://assets.papermc.io/brand/velocity_combination_mark_white.min.svg)</div> | `https://assets.papermc.io/brand/velocity_combination_mark_white.min.svg` |
| ![](https://assets.papermc.io/brand/velocity_logo_blue.min.svg)                                                                               | `https://assets.papermc.io/brand/velocity_logo_blue.min.svg`              |
| <div style="background-color: var(--image-backdrop-dark);">![](https://assets.papermc.io/brand/velocity_logo_white.min.svg)</div>             | `https://assets.papermc.io/brand/velocity_logo_white.min.svg`             |


---


# Installing or updating Java

How to install or update to Java 25 on Linux (apt/rpm), Windows, or Mac.

Installing Java is a critical first step to using or developing plugins for Paper and Velocity.
This guide will walk you through the recommended installation steps for most major
platforms.

:::caution[Do not use headless variants of Java!]

There are `headless` variants of Java which usually have a suffix of `-headless` in their package
name. Those variants miss required dependencies for Paper. Therefore, using them is not recommended.

:::

:::tip

This guide focuses on Amazon's Corretto OpenJDK distribution. This is because it offers the best
installation experience on the most platforms. Corretto is, however, not the only OpenJDK vendor to
choose from. Many alternatives exist such as [Eclipse Adoptium](https://adoptium.net/),
[Microsoft](https://www.microsoft.com/openjdk) and
[Azul Zulu](https://www.azul.com/downloads/?package=jdk). Note that the JDK Oracle distributes,
while functionally identical, is **not** recommended due to an extremely unfriendly installer and
previous hostile licensing.

:::

## Linux

### Ubuntu/Debian

Installing Java 25 on Debian-based Linux distributions is very simple. First, ensure your system has
all required tools to successfully install Java.

```bash
sudo apt-get update
sudo apt-get install ca-certificates apt-transport-https gnupg wget
```

Second, import the Amazon Corretto public key and apt repository.

```bash
wget -O - https://apt.corretto.aws/corretto.key | sudo gpg --dearmor -o /usr/share/keyrings/corretto-keyring.gpg && \
echo "deb [signed-by=/usr/share/keyrings/corretto-keyring.gpg] https://apt.corretto.aws stable main" | sudo tee /etc/apt/sources.list.d/corretto.list
```

Then, install Java 25 and other dependencies using the following command:

```bash
sudo apt-get update
sudo apt-get install -y java-25-amazon-corretto-jdk libxi6 libxtst6 libxrender1
```

Proceed to [verify your installation](#verifying-installation).

### RPM-based

To install Java 25 on CentOS, RHEL, Fedora, openSUSE, SLES, or any other RPM-based Linux
distribution, execute the following commands depending on your package manager. Once you have
finished, precede to [verify your installation](#verifying-installation).

#### DNF

DNF is used on Fedora, CentOS/RHEL 7+, and related distributions.

```bash
sudo rpm --import https://yum.corretto.aws/corretto.key
sudo curl -Lo /etc/yum.repos.d/corretto.repo https://yum.corretto.aws/corretto.repo
sudo dnf -y install java-25-amazon-corretto-devel
```

#### Zypper

Zypper is used on openSUSE, SLES, and related distributions.

```bash
sudo zypper addrepo https://yum.corretto.aws/corretto.repo
sudo zypper refresh
sudo zypper install java-25-amazon-corretto-devel
```

#### YUM

YUM is used on older releases of CentOS/RHEL, and excessively old releases of Fedora.

```bash
sudo rpm --import https://yum.corretto.aws/corretto.key
sudo curl -Lo /etc/yum.repos.d/corretto.repo https://yum.corretto.aws/corretto.repo
sudo yum -y install java-25-amazon-corretto-devel
```

## Windows 10 & 11

If you're on Windows 10 or 11, installing Java is just like installing any other program. Download
the Amazon Corretto installer from
[their website](https://corretto.aws/downloads/latest/amazon-corretto-25-x64-windows-jdk.msi).

Once you have run the installer, it is safe to click "next" through the whole process. No additional
bloatware or toolbars will be installed, and all the required features are enabled out of the box.

Now, open a command prompt and precede to [verify your installation](#verifying-installation).

## macOS/OS X

If you're on macOS, the best way to manage Java installations is with a tool called
[Homebrew](https://brew.sh). Follow the instructions on their homepage to install it. Then, in your
terminal run the following command:

```bash
brew install openjdk@25
```

Once this command has completed, continue to [verify your installation](#verifying-installation).

## Pterodactyl

:::note

On Pterodactyl versions lower than `1.2.0`, an administrator account is required to change the Java
version. These instructions will not apply.

:::

If you have started a Paper server with an incorrect Java version, Pterodactyl will automatically
prompt you to update like this:

![Pterodactyl Automatic Prompt](./assets/pterodactyl-prompt.png)

If this does not show up for you, the Java version can be manually changed. Navigate to the
"Startup" tab of your server, select `Java 25` from the "Docker Image"
dropdown as shown in the image below.

![Pterodactyl Manual Java Version Change](./assets/pterodactyl-manual.png)

:::note

If you don't see `Java 25` in the dropdown, an administrator account is required to update the Paper egg.

:::

## Pufferpanel (Docker)

:::note

You will need **Admin** permissions on the panel to change your Java version.

:::

At the server you want to change the Java version for, go to the **Admin** tab and open
**Edit Server Definition**. In the **Environment** tab, the **Docker Image** field allows
you edit the docker image used.

![Pufferpanel Environment Tab](./assets/pufferpanel-environment.png)

In this case, you can simply replace the version (the number after the ":") with `25`.
You can find alternative JDK docker images on
[Docker Hub](https://hub.docker.com/search?badges=official).

## Verifying installation

:::note

This section does not apply when running on Pterodactyl or Pufferpanel.

:::

Now that you have installed Java 25, run this command in your terminal to ensure the process was
successful.

```bash
java -version
```

The output should be similar to this. The important parts to look out for is that it starts with
`openjdk 25` and contains `64-Bit` in the last line. If the output you get is similar to
`java: command not found`, try creating a new terminal session.

```
openjdk version "25" 2025-09-16
OpenJDK Runtime Environment (build 25+36-3489)
OpenJDK 64-Bit Server VM (build 25+36-3489, mixed mode, sharing)
```

If your installation has failed, do not hesitate to reach out in the `#paper-help` channel of our
[Discord](https://discord.gg/papermc) for support.


---


# Introduction

An introduction to how components work.

:::note

This documentation page applies to both the Paper and Velocity projects.

:::

Since Minecraft 1.7, the game has utilized components to represent text to be displayed
by clients. Components offer a number of benefits over plain text strings which are enumerated below.
Paper and Velocity natively implements the Adventure API to add component support wherever possible.

## Why you should use Components

Previously, text was a linear structure with the only formatting options being
confusing symbols like `§c` and `§k` to control basic colors and styles of text.
Components are a tree-like structure that inherits style and colors from their parents.

Components have several types which do different things than just display raw text, like
translating text to the client's language based on a key, or showing a client-specific keybind
to a player.

All these component types support more style options like any RGB color, interaction events
(click and hover). The other component types and these style options have poor or missing
representations in the legacy string format.

## Usage

Representing text as components is now the supported way of representing text for Paper and Velocity. They are used
for almost all aspects of text being displayed to clients. Text like item names, lore, bossbars, team prefixes and
suffixes, custom names, and much more all support components in respective APIs.
[Mojang has stated](https://mojira.dev/MC-190605#comment-id-606141)
that client support for the legacy format with `§` will be removed in the future.

:::tip

In the Paper API, there are lots of deprecated methods and types that deal with this legacy format. This is to
signal that a better alternative in components is available and should be migrated to going forward.

:::

## Creating components

Components can be interacted with as objects. There are different interfaces for each type along with
builders for all the types. These objects are immutable so when constructing more complex components, it's
recommended to use builders to avoid creating new Component instances with every change.

```java
// This is a sub-optimal construction of the
// component as each change creates a new component
final Component component = Component.text("Hello")
    .color(TextColor.color(0x13f832))
    .append(Component.text(" world!", NamedTextColor.GREEN));

/* This is an optimal use of the builder to create
   the same component. Also note that Adventure
   Components are designed for use with static method imports
   to make code less verbose */
final Component component = text()
    .content("Hello").color(color(0x13f832))
    .append(text(" world!", GREEN))
    .build();
```

:::note[In-Depth Documentation]

For complete documentation on the Adventure Component API Paper and Velocity use, please look at the
[Adventure documentation](/adventure).

:::

## MiniMessage

Paper and Velocity include the MiniMessage library, which is a string representation of components. If you prefer working with
strings rather than objects, MiniMessage is vastly superior to the legacy string format. It can utilize the tree
structure for style inheritance and can represent the more complex component types while legacy cannot.

```java
final Component component = MiniMessage.miniMessage().deserialize(
    "<#438df2><b>This is the parent component; its style is " +
    "applied to all children.\n<u><!b>This is the first child, " +
    "which is rendered after the parent</!b></u><key:key.inventory></b></#438df2>"
);

// if the syntax above is too verbose for you, create a helper method!

public final class Components {
    public static Component mm(String miniMessageString) { // mm, short for MiniMessage
        return MiniMessage.miniMessage().deserialize(miniMessageString);
    }
}

// ...

import static com.example.paperplugin.util.Components.mm; // replace with your own package

final Component component = mm("<blue>Hello <red>World!");
```

We recommend using this format for user-facing input such as commands or configuration values.

:::note[In-Depth Documentation]

MiniMessage is a part of Adventure, and you can find its documentation on [Adventure's documentation](/adventure/minimessage/).

:::

:::tip

MiniMessage has a [web viewer](https://webui.advntr.dev/), which is useful for constructing more complicated components and seeing the results in real time.

:::

## JSON format

Components can be serialized and deserialized from a standard JSON format. This format is used
in Vanilla in various commands which accept component arguments like `/tellraw`. Below is a simple example
of this format.

```json
{
  "text": "This is the parent component; its style is applied to all children.\n",
  "color": "#438df2",
  "bold": true,
  "extra": [
    {
      "text": "This is this first child, which is rendered after the parent",
      "underlined": true,
      // This overrides the parent's "bold" value just for this component
      "bold": false
    },
    {
      // This is a keybind component which will display the client's keybind for that action
      "keybind": "key.inventory"
    }
  ]
}
```

:::note[In-Depth Documentation]

The JSON format is fully documented on the [Minecraft Wiki](https://minecraft.wiki/w/Text_component_format).

:::

:::tip

There are online tools to make generating this format much easier like [JSON Text Generator](https://minecraft.tools/en/json_text.php).

:::

## Serializers

Paper and Velocity come bundled with different serializers for converting between
[](jd:adventure:net.kyori.adventure.text.Component)s and other forms of serialized text.

### [`GsonComponentSerializer`](jd:adventure:net.kyori.adventure.text.serializer.gson:module-summary)

Converts between `Component`
and JSON-formatted strings with convenience methods to directly deal with Gson's
[`JsonElement`](https://javadoc.io/doc/com.google.code.gson/gson/latest/com.google.gson/com/google/gson/JsonElement.html).
This conversion is lossless and is the preferred form of serialization for components that do not have to be edited by users regularly.

### [`MiniMessage`](jd:adventure:net.kyori.adventure.text.minimessage:module-summary)

Converts between `Component`
and a MiniMessage-formatted string. This conversion is lossless and is the preferred form of
serialization for components that have to be edited by users. There is also extensive customization you can add to the
serializer, which is [documented here](/adventure/minimessage/api/#getting-started).

### [`PlainTextComponentSerializer`](jd:adventure:net.kyori.adventure.text.serializer.plain:module-summary)

Serializes a `Component` into a plain text string. This is very lossy as all style information as well as most other
types of components will lose information. There may be special handling for
[](jd:adventure:net.kyori.adventure.text.TranslatableComponent)s to be serialized
into a default language, but generally this shouldn't be used except in certain circumstances, like logging to a text file.

### [`LegacyComponentSerializer`](jd:adventure:net.kyori.adventure.text.serializer.legacy:module-summary)

:::caution

This is not recommended for use as the legacy format may be removed in the future.

:::

Converts between `Component` and the legacy string format.
This conversion is very lossy as component types and events do not have a legacy string representation.

A more useful use case is converting legacy text to MiniMessage format in a migration process.
```java
final String legacyString = ChatColor.RED + "This is a legacy " + ChatColor.GOLD + "string";

// runs the legacy string through two serializers to convert legacy -> MiniMessage
final String miniMessageString = MiniMessage.miniMessage().serialize(
    LegacyComponentSerializer.legacySection().deserialize(legacyString)
);
```

:::note

There are 2 built-in legacy serializers, one dealing with `§` symbols and the other for
`&` symbols. They have their own instances available through
[](jd:adventure:net.kyori.adventure.text.serializer.legacy:net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer#legacySection())
and [](jd:adventure:net.kyori.adventure.text.serializer.legacy:net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer#legacyAmpersand()).

:::


---


# Velocity Documentation

import { CardGrid, LinkCard } from "@astrojs/starlight/components";

Velocity is the ridiculously scalable, flexible Minecraft proxy.

## Getting started

It is simple to get started with Velocity. Get started with our
[Getting Started guide](/velocity/getting-started).

## I need help

If you need some help with Velocity, please seek help in the following places:

### 📖 These Docs

We have put a lot of effort into documenting Velocity as much as possible with our new website and
our coverage will continue to expand. We strongly encourage you to check the sidebar of the docs for
relevant resources. Helping yourself using the resources in these docs saves all of us time.

We recommend you visit the [frequently asked questions](/velocity/faq) to begin your
search. Most common issues with Velocity are answered there.

Please do not be offended if we respond to your question linking back here. Asking us a question
already answered in the documentation doesn't help anyone.

### 💬 Our Discord

If you have searched the docs and didn't find the answer to your question, then it is time to
[join our Discord](https://discord.gg/papermc) to ask your question.

<CardGrid>
  <LinkCard
    title="Administration"
    description="Information and tutorials regarding the administration of a Velocity proxy."
    href="/velocity/admin"
  />
  <LinkCard
    title="Development"
    description="Information and tutorials for developers on how to create and expand on Velocity plugins."
    href="/velocity/dev"
  />
</CardGrid>


---


# Administration

import PageCards from "/src/components/PageCards.astro";

Welcome to the Velocity administration guide! This guide includes information and tutorials
regarding the administration of a Velocity proxy.

#### Getting started

<PageCards path="src/content/docs/velocity/admin/getting-started/index.mdx" />

#### How-to guides

<PageCards path="src/content/docs/velocity/admin/how-to/index.mdx" />

#### Reference

<PageCards path="src/content/docs/velocity/admin/reference/index.mdx" />


---


# Getting started

import PageCards from "/src/components/PageCards.astro";

Guides for getting started with running a Velocity proxy.

<PageCards />


---


# How-to guides

import PageCards from "/src/components/PageCards.astro";

How-to guides for setting up specific features of Velocity and managing the proxy.

<PageCards />


---


# Reference

import PageCards from "/src/components/PageCards.astro";

Reference of Velocity's configuration options, system properties and other features.

<PageCards />


---


# Built-in commands

A list of the built-in commands with explanations.

Velocity includes a few commands in the core of the proxy by default. These commands were chosen
based on how generally useful they are to most users.

Of course, you can always install plugins to add more commands if you want.

## `/velocity`

The `/velocity` command contains a number of subcommands to manage the proxy.

### `/velocity plugins`

If the user has the `velocity.command.plugins` permission, they can view all the plugins currently
active on the proxy using `/velocity plugins`, including the name, authors, and version.

### `/velocity info`

If the user has the `velocity.command.info` permission, they can view information about the Velocity instance,
such as the version of Velocity running on the proxy.

### `/velocity reload`

If the user has the `velocity.command.reload` permission, the proxy will read and reconfigure itself
from the `velocity.toml` on disk. If there are problems with parsing the file, no changes will be
applied.

### `/velocity dump`

If the user has the `velocity.command.dump` permission, they can use this command to get an
anonymized dump of details on the proxy. This can be sent to the PaperMC Discord to help us provide
support.

### `/velocity heap`

:::caution

This command generates a heap dump which contains detailed information about your Velocity instance
which can be quite sensitive, be very careful to whom you share the generated heap dump.

:::

If the user has the `velocity.command.heap` permission, they will be able to generate a heap dump
from the running Velocity instance, which will allow a detailed analysis of memory consumption.

The generated heap dump will be found in the `dumps` folder.

## `/server`

If the user has the `velocity.command.server` permission (by default, this is granted to all users),
players can use this command to view and switch to another server.

Executing just `/server` will send the user the name of the server they are currently on, along with
options to move to other servers configured on the proxy.

If a server name has been provided, Velocity will attempt to connect to the server.

## `/shutdown`

:::note

This command can only be executed from console.

:::

When run, this will gracefully shut down the Velocity proxy.
All players will be disconnected from the proxy, and plugins will have a chance to finish up before the proxy shuts down.
An optional reason can be given, either as JSON or with [MiniMessage Format](/adventure/minimessage/format/).

If the provided message starts with `"`, `[`, or `{`, then the message is attempted to be parsed as JSON.
If this parsing fails, or the message starts with anything else, the message will be parsed as MiniMessage.

## `/glist`

If the user has the `velocity.command.glist` permission (by default, this is granted to nobody),
players can use this command to view the number of players currently on the proxy and use
`/glist all` to get a listing of players per server.

## `/send`

If the user has the `velocity.command.send` permission, they can send other players (or all
players on the proxy) to another server.

## `/velocity:callback`

Velocity uses this command internally for plugins to run click callbacks when a user clicks on text.


---


# Comparing with other proxies

A comparison of Velocity to other proxies.

Presumably, you have learned about what Velocity can do for you. But how does it stack up against
other solutions out there? We're trying to convince you to use Velocity, after all, so this document
may be somewhat biased in our favor.

## Overview

:::danger

**The Paper team strongly recommends using Velocity over Waterfall and BungeeCord**. Waterfall has reached end of life. All future
development by PaperMC is done on Velocity. For more information, see the [announcement](https://forums.papermc.io/threads/1088/).

:::

This is a quick overview of the differences between Velocity and other popular proxy software. Read below for more details.
| Feature                                  | BungeeCord | Waterfall | Velocity |
|------------------------------------------|------------|-----------|----------|
| Resource efficient                       | ❌         | ✅        | ✅✅     |
| Velocity plugins                         | ❌         | ❌        | ✅       |
| BungeeCord plugins                       | ✅         | ✅        | 🟨*      |
| Secure player information forwarding     | ❌         | ❌        | ✅       |
| API supporting modern Minecraft features | ❌         | ❌        | ✅       |
| Actively developed                       | ❓         | ❌        | ✅       |
| Improved mod support                     | ❌         | ❌        | ✅*\*    |

\* _The Velocity API does not support plugins made for BungeeCord/Waterfall, but [Snap](https://hangar.papermc.io/Phoenix616/Snap) can be installed for experimental support.
 Snap is not maintained by, or affiliated with, the Velocity project._

\** _Full Forge support for 1.7 through 1.12.2 and 1.20.2 or higher._

## BungeeCord and derivatives

We can't discuss the full history of Minecraft proxy software deeply – we recommend
[Me4502's excellent article](https://madelinemiller.dev/blog/decade-of-minecraft-multiplayer/) that
covers the multiplayer Minecraft world in great detail.

### BungeeCord

The original author of Velocity, at the time of starting the project, had over 5 years of experience
using BungeeCord, and knew its various quirks inside and out.

There are several reasons why improving BungeeCord was a fool's game:

- BungeeCord is very conservative with regard to API changes. If it breaks some plugin developed 5
  years ago from an inactive developer, you can forget about it.
- The changes that _do_ change the API are often quite particular and niche use cases and changing
  the API in substantial ways is frowned upon (witness the support for RGB colors in `ChatColor`).
- The project is essentially run like a cathedral. In BungeeCord (and its sister project, Spigot),
  the word of md_5 is king. Contributing a simple security fix to BungeeCord earned the primary
  developer of Velocity at least two beratings from md_5.
- BungeeCord is actively hostile to continued support for Minecraft modding.
- We have seen new modding APIs for _Minecraft_ since the first version of BungeeCord released
  in 2012. It's time for a new and improved API that does not make the mistakes the BungeeCord API
  makes, and to draw influence from the new modding APIs that Minecraft now boasts.

### Waterfall

Partly due to experience obtained by the author's own experience with BungeeCord, he founded the
Waterfall project in 2016 as a fork of BungeeCord, modeled after Paper, with the explicit aim of
improving BungeeCord. _We tried the obvious next step_.

Meet [Hyrum's Law](https://www.hyrumslaw.com/):

> With a sufficient number of users of an API, it does not matter what you promise in the contract:
> all observable behaviors of your system will be depended on by somebody.

Here's Hyrum's law in comic format, in case that eases getting the point across:

> <span class="img-inline">[![xkcd #1172](https://imgs.xkcd.com/comics/workflow.png)](https://xkcd.com/1172/)</span>
>
> ["Workflow"](https://xkcd.com/1172/) from [xkcd](https://xkcd.com/) by Randal Munroe,
> [licensed](https://xkcd.com/license.html) under
> [CC BY-NC 2.5](https://creativecommons.org/licenses/by-nc/2.5/)

Most BungeeCord plugins are deeply dependent on the specific behaviors and quirks BungeeCord
exposes, which Velocity cannot perfectly emulate. As a result, the number of changes one can make
to BungeeCord and have plugins retain the same behavior is minimal.

Suppose you have played a video game published by Company A. It runs on an operating system made by Company B.
One day, Company B releases a new version of their operating system, and you upgrade to it, only to recoil
in horror as that video game no longer works. (Worse, Studio A might be out of business at that point, so
no patch is forthcoming.) Who do you blame, Company A for producing a defective product, or Company B for
breaking the game? [This isn't a hypothetical](https://devblogs.microsoft.com/oldnewthing/20110131-00/?p=11633).

We can point to one example where
[an attempt](https://github.com/PaperMC/Waterfall/commit/c8eb6aec7bac82fd309fa6d6113b8a0418317b01)
to improve scoreboard handling on 1.13 and above
[was reversed](https://github.com/PaperMC/Waterfall/issues/255) thanks to plugins expecting
BungeeCord's broken behavior. At this point, it is fairly obvious why making a clean break was
better. Given that this happened near the start of the Velocity project's lifetime, it was probably
a quite powerful motivator, although it certainly wasn't the only motivator.

### Hypothetical BungeeCord API-based Velocity

We are compelled to mention this briefly as this was a topic brought up in the early days of the
project. We could have based Velocity on the BungeeCord API (or a derivative thereof, such as the
Waterfall API) instead.

This has the same problems as Waterfall, perhaps more as we would need to emulate _all_ the behavior
of the BungeeCord API independently. The Wine project has been trying for over 3 decades to provide
a shim layer that allows Windows programs to run on Linux and other operating systems. Their efforts
remain ongoing to this day. It is hard to emulate the behavior of another operating system's environment.
The authors of ReactOS have it even worse, trying to emulate all the quirks of Windows, including its
kernel, and they have set their baseline to a version of Windows that was released 2 decades ago. Their
work is even further from completed than Wine's is.

We would have to spend a lot of time pretending that Velocity looked and quacked just like BungeeCord.
We intentionally rejected this approach. It's not worth doing.


---


# Configuring Velocity

Velocity is designed to be easy to configure and this guide will walk you through how to do so.

Velocity is designed to be easy to configure and set up. Every Velocity file is stored in
`velocity.toml`, located in the directory where you started the proxy. Velocity uses the
[TOML](https://github.com/toml-lang/toml) file format, as it is easy to understand and avoids
pitfalls of YAML and other configuration formats common in the community.

An up-to-date version of the default configuration can be found on
[GitHub](https://github.com/PaperMC/Velocity/blob/dev/4.0.0/proxy/src/main/resources/default-velocity.toml).

## Data types

There are a few "special" data types in the Velocity configuration.

### Chat

Chat messages may be provided in [MiniMessage](/adventure/minimessage/format/) format.

RGB support is available for Minecraft 1.16 and later versions.

### Address

An address is a pairing of an IP address or hostname, and a port, separated by a colon (`:`). For
instance, `127.0.0.1:25577` and `server01.example.com:25565` are valid addresses.

## Root section

These settings mostly cover the basic, most essential settings of the proxy.

| Setting Name                       | Type    | Description                                                                                                                                                                                                                                                        |
|------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `config-version`                   | String  | This is the current config version used by Velocity. You should not alter this setting.                                                                                                                                                                            |
| `bind`                             | Address | This tells the proxy to accept connections on a specific IP. By default, Velocity will listen for connections on all IP addresses on the computer on port 25565.                                                                                                   |
| `motd`                             | Chat    | This allows you to change the message shown to players when they add your server to their server list. You can use [MiniMessage format](/adventure/minimessage/format/).                                                                                           |
| `show-max-players`                 | Integer | This allows you to customize the number of "maximum" players in the player's server list. Note that Velocity doesn't have a maximum number of players it supports.                                                                                                 |
| `online-mode`                      | Boolean | Should we authenticate players with Mojang? By default, this is on.                                                                                                                                                                                                |
| `force-key-authentication`         | Boolean | Should the proxy enforce the new public key security standard? By default, this is on.                                                                                                                                                                             |
| `player-info-forwarding-mode`      | Enum    | See [Configuring player information forwarding](/velocity/player-information-forwarding) for more information.                                                                                                                                                     |
| `prevent-client-proxy-connections` | Boolean | If client's ISP/AS sent from this proxy is different from the one from Mojang's authentication server, the player is kicked. This disallows some VPN and proxy connections but is a weak form of protection.                                                       |
| `forwarding-secret-file`           | String  | The name of the file in which the forwarding secret is stored. This secret is used to ensure that player info forwarded by Velocity comes from your proxy and not from someone pretending to run Velocity. See the "Player info forwarding" section for more info. |
| `announce-forge`                   | Boolean | This setting determines whether Velocity should present itself as a Forge/FML-compatible server. By default, this is disabled.                                                                                                                                     |
| `kick-existing-players`            | Boolean | Allows restoring the Vanilla behavior of kicking users on the proxy if they try to reconnect (e.g. lost internet connection briefly).                                                                                                                              |
| `ping-passthrough`                 | String  | Allows forwarding nothing (the default), the `MODS` (for Forge), the `DESCRIPTION`, or everything (`ALL`) from the `try` list (or forced host server connection order).                                                                                            |
| `enable-player-address-logging`    | Boolean | If disabled (default is true), player IP addresses will be replaced by `<ip address withheld>` in logs.                                                                                                                                                            |

## `servers` section

| Setting Name  | Type    | Description                                                                                                                |
|---------------|---------|----------------------------------------------------------------------------------------------------------------------------|
| A server name | Address | This makes the proxy aware of a server that it can connect to.                                                             |
| `try`         | Array   | This specifies what servers Velocity should try to connect to upon player login and when a player is kicked from a server. |

## `forced-hosts` section

| Setting Name | Type     | Description                                                                                                                                       |
|--------------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| A host name  | Hostname | This configures the proxy to create a forced host for the specified hostname. An array of servers to try for the specified hostname is the value. |

## `advanced` section

| Setting Name                               | Type    | Description                                                                                                                                                                                             |
|--------------------------------------------|---------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `compression-threshold`                    | Integer | This is the minimum size (in bytes) that a packet must be before the proxy compresses it. Minecraft uses 256 bytes by default.                                                                          |
| `compression-level`                        | Integer | This setting indicates what `zlib` compression level the proxy should use to compress packets. The default value uses the default zlib level.                                                           |
| `login-ratelimit`                          | Integer | This setting determines the minimum amount of time (in milliseconds) that must pass before a connection from the same IP address will be accepted by the proxy. A value of `0` disables the rate limit. |
| `connection-timeout`                       | Integer | This setting determines how long the proxy will wait to connect to a server before timing out.                                                                                                          |
| `read-timeout`                             | Integer | This setting determines how long the proxy will wait to receive data from the server before timing out.                                                                                                 |
| `haproxy-protocol`                         | Boolean | This setting determines whether or not Velocity should receive HAProxy PROXY messages. If you don't use HAProxy, leave this setting off.                                                                |
| `tcp-fast-open`                            | Boolean | This setting allows you to enable TCP Fast Open support in Velocity. Your proxy must run on Linux kernel >=4.14 for this setting to apply.                                                              |
| `bungee-plugin-message-channel`            | Boolean | This setting allows you to enable or disable support for the BungeeCord plugin messaging channel.                                                                                                       |
| `show-ping-requests`                       | Boolean | This setting allows you to log ping requests sent by clients to the proxy.                                                                                                                              |
| `announce-proxy-commands`                  | Boolean | This setting allows you to enable or disable explicitly sending proxy commands to the client (for Minecraft 1.13+ tab completion).                                                                      |
| `failover-on-unexpected-server-disconnect` | Boolean | This setting allows you to determine if the proxy should failover or disconnect the user in the event of an unclean disconnect.                                                                         |
| `log-command-executions`                   | Boolean | Determines whether or not the proxy should log all commands run by the user.                                                                                                                            |
| `log-player-connections`                   | Boolean | Enables logging of player connections when connecting to the proxy, switching servers and disconnecting from the proxy.                                                                                 |
| `accepts-transfers`                        | Boolean | Determines whether or not the proxy accepts incoming transfers from other servers. If disabled, the proxy will disconnect transferred clients.                                                          |
| `enable-reuse-port`                        | Boolean | Enables support for SO_REUSEPORT. This may help the proxy scale better on multicore systems with a lot of incoming connections, and provide better CPU utilization than the existing strategy of having a single thread accepting connections and distributing them to worker threads. Requires Linux or macOS. |
| `command-rate-limit`                       | Integer | How fast (in milliseconds) are clients allowed to send commands after the last command. By default this is 50ms (20 commands per second) |
| `forward-commands-if-rate-limited`         | Boolean | Should we forward commands to the backend upon being rate limited? This will forward the command to the server instead of processing it on the proxy. Since most server implementations have a rate limit, this will prevent the player from being able to send excessive commands to the server. |
| `kick-after-rate-limited-commands`         | Integer | How many commands are allowed to be sent after the rate limit is hit before the player is kicked? Setting this to 0 or lower will disable this feature. |
| `tab-complete-rate-limit`                  | Integer | How fast (in milliseconds) are clients allowed to send tab completions after the last tab completion |
| `kick-after-rate-limited-tab-completes`    | Integer | How many tab completions are allowed to be sent after the rate limit is hit before the player is kicked? Setting this to 0 or lower will disable this feature. |

## `query` section

| Setting Name   | Type    | Description                                                                                                  |
|----------------|---------|--------------------------------------------------------------------------------------------------------------|
| `enabled`      | Boolean | Whether or not Velocity should reply to Minecraft query protocol requests. You can usually leave this false. |
| `port`         | Number  | Specifies which port that Velocity should listen on for GameSpy 4 (Minecraft query protocol) requests.       |
| `map`          | String  | Specifies the map name to be shown to clients.                                                               |
| `show-plugins` | Boolean | Whether or not Velocity plugins are included in the query responses.                                         |


---


# Libraries used

The credits for all the different libraries used by Velocity.

Velocity uses a number of open-source libraries:

| Name                                                                            | Author                                                                   | License                                                                                                      |
|---------------------------------------------------------------------------------|--------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| [Guava](https://github.com/google/guava)                                        | [Google](https://github.com/google)                                      | [Apache License 2.0](https://github.com/google/guava/blob/master/LICENSE)                                    |
| [Gson](https://github.com/google/gson)                                          | [Google](https://github.com/google)                                      | [Apache License 2.0](https://github.com/google/gson/blob/master/LICENSE)                                     |
| [Netty](https://github.com/netty/netty)                                         | [Netty Project](https://netty.io)                                        | [Apache License 2.0](https://github.com/netty/netty/blob/4.1/LICENSE.txt)                                    |
| [libdeflate](https://github.com/ebiggers/libdeflate)                            | [Eric Biggers](https://github.com/ebiggers)                              | [MIT License](https://github.com/ebiggers/libdeflate/blob/master/COPYING)                                    |
| [adventure](https://github.com/PaperMC/adventure)                               | [PaperMC](https://github.com/PaperMC)                                    | [MIT License](https://github.com/PaperMC/adventure/blob/main/4/license.txt)                                  |
| [Brigadier](https://github.com/Mojang/brigadier)                                | [Mojang](https://www.minecraft.net)                                      | [MIT License](https://github.com/Mojang/brigadier/blob/master/LICENSE)                                       |
| [event](https://github.com/KyoriPowered/event)                                  | [KyoriPowered](https://github.com/KyoriPowered)                          | [MIT License](https://github.com/KyoriPowered/event/blob/master/license.txt)                                 |
| [ASM](https://asm.ow2.io/)                                                      | [OW2](https://asm.ow2.io/)                                               | [BSD 3-Clause License](https://asm.ow2.io/license.html)                                                      |
| [SLF4J](https://github.com/qos-ch/slf4j)                                        | [SLF4J](https://www.slf4j.org/)                                          | [MIT License](https://github.com/qos-ch/slf4j/blob/master/LICENSE.txt)                                       |
| [Log4j](https://logging.apache.org/log4j/2.x/)                                  | [Log4j Team](https://logging.apache.org/log4j/2.3.x/log4j-web/team-list) | [Apache License 2.0](https://logging.apache.org/log4j/2.12.x/license.html)                                   |
| [TerminalConsoleAppender](https://github.com/Minecrell/TerminalConsoleAppender) | [Minecrell](https://github.com/Minecrell)                                | [MIT License](https://github.com/Minecrell/TerminalConsoleAppender/blob/master/LICENSE)                      |
| [Configurate](https://github.com/SpongePowered/configurate)                     | [SpongePowered](https://github.com/SpongePowered)                        | [Apache License 2.0](https://github.com/SpongePowered/configurate/blob/master/LICENSE)                       |
| [SnakeYAML](https://bitbucket.org/snakeyaml/snakeyaml)                          | [SnakeYAML](https://bitbucket.org/snakeyaml)                             | [Apache License 2.0](https://bitbucket.org/snakeyaml/snakeyaml/src/master/LICENSE.txt)                       |
| [HOCON](https://github.com/lightbend/config)                                    | [lightbend](https://github.com/lightbend)                                | [Apache License 2.0](https://github.com/lightbend/config/blob/master/LICENSE-2.0.txt)                        |
| [toml4j](https://github.com/mwanji/toml4j)                                      | [Moandji Ezana](https://github.com/mwanji)                               | [MIT License](https://github.com/mwanji/toml4j/blob/master/LICENSE)                                          |
| [Night-Config](https://github.com/TheElectronWill/night-config)                 | [TheElectronWill](https://github.com/TheElectronWill)                    | [GNU Lesser General Public License 3.0](https://github.com/TheElectronWill/night-config/blob/master/LICENSE) |
| [fastutil](https://fastutil.di.unimi.it/)                                       | [Sebastiano Vigna](https://vigna.di.unimi.it/)                           | [Apache License 2.0](https://github.com/vigna/fastutil/blob/master/LICENSE-2.0)                              |
| [JLine](https://github.com/jline/jline3/blob/master/LICENSE.txt)                | [JLine project](https://github.com/jline/jline3)                         | [BSD 3-Clause License](https://github.com/jline/jline3/blob/master/LICENSE.txt)                              |
| [AsyncHttpClient](https://github.com/AsyncHttpClient/async-http-client)         | [Stephane Landelle](https://github.com/slandelle)                        | [Apache License 2.0](https://github.com/AsyncHttpClient/async-http-client/blob/master/LICENSE.txt)           |
| [completable-futures](https://github.com/spotify/completable-futures)           | [Spotify](https://github.com/spotify)                                    | [Apache License 2.0](https://github.com/spotify/completable-futures/blob/master/LICENSE)                     |


---


# Development

import PageCards from "/src/components/PageCards.astro";

Welcome to the Velocity development guide! This guide includes information and tutorials for
developers to create and expand on Velocity plugins.

#### Getting started

<PageCards path="src/content/docs/velocity/dev/getting-started/index.mdx" />

#### How-to guides

<PageCards path="src/content/docs/velocity/dev/how-to/index.mdx" />

#### API

<PageCards path="src/content/docs/velocity/dev/api/index.mdx" />


---


# API

import PageCards from "/src/components/PageCards.astro";

Guides for working with Velocity's API.

<PageCards />


---


# Velocity plugin basics

How to get started with the Velocity API.

Now we will lay the groundwork for your first plugin. We will cover how to create your very first
Velocity plugin.

## Create the plugin class

Create a new class (let's say `com.example.velocityplugin.VelocityTest`) and paste this in:

```java title="VelocityTest.java" collapse={1-6} showLineNumbers
package com.example.velocityplugin;

import com.google.inject.Inject;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.ProxyServer;
import org.slf4j.Logger;

@Plugin(id = "myfirstplugin", name = "My First Plugin", version = "0.1.0-SNAPSHOT",
        url = "https://example.org", description = "I did it!", authors = {"Me"})
public class VelocityTest {

  private final ProxyServer server;
  private final Logger logger;

  @Inject
  public VelocityTest(ProxyServer server, Logger logger) {
    this.server = server;
    this.logger = logger;

    logger.info("Hello there! I made my first plugin with Velocity.");
  }
}
```

What did you just do there? There's quite a bit to unpack, so let's focus on the Velocity-specific
bits:

```java
@Plugin(id = "myfirstplugin", name = "My First Plugin", version = "0.1.0-SNAPSHOT",
        url = "awesome.org", description = "I did it!", authors = {"Me"})
public class VelocityTest {
```

This tells Velocity that this class contains your plugin (`myfirstplugin`) so that it can be loaded
once the proxy starts up. Velocity will detect where the plugin will reside when you compile your
plugin.

Moving on, what's this?

```java
@Inject
public VelocityTest(ProxyServer server, Logger logger) {
  this.server = server;
  this.logger = logger;

  logger.info("Hello there, it's a test plugin I made!");
}
```

This looks like magic! How is Velocity doing this? The answer lies in the
[`@Inject`](https://javadoc.io/doc/com.google.inject/guice/latest/com/google/inject/Inject.html)
which indicates that Velocity should inject a
[](jd:velocity:com.velocitypowered.api.proxy.ProxyServer)
and the [`Logger`](https://www.slf4j.org/api/org/slf4j/Logger.html) when constructing your plugin.
These two interfaces will help you out as you begin working with Velocity. We won't talk too much about
dependency injection: all you need to know is that Velocity will do this.

All you need to do is build your plugin, put it in your `plugins/` directory, and try it! Isn't that
nice? In the next section you'll learn more about how to use the API.

## Choosing [`@Plugin`](jd:velocity:com.velocitypowered.api.plugin.Plugin) information

Choose your plugin's ID wisely. Other plugins will use this ID to depend on yours. If you change it,
you could break compatibility.

The plugin name is somewhat less important. It will be shown to users as the display name of your
plugin, but tweaking it will not be catastrophic.

For the version, we recommend sticking to semantic versioning - you can read more about this concept
at [semver.org](https://semver.org). Basically, use 3 numbers in your version, such as 1.4.25.
Increment the major number when you make a backwards-incompatible breaking change, increment the
minor number when you add functionality that is backwards compatible, and increment the patch number
when you fix a bug or make an otherwise unnoticeable change in the implementation.

You can also describe your plugin's URL, authors, and description in your `@Plugin` annotation.
Dependencies on other plugins are also to be specified there, but we'll get to that later on the
[Dependency Management](/velocity/dev/dependency-management) page.

### A word of caution

:::caution

In Velocity, plugin loading is split into two steps: construction and initialization. The code in
your plugin's constructor is part of the construction phase. There is very little you can do safely
during construction, especially as the API does not specify which operations are safe to run during
construction. Notably, you can't register an event listener in your constructor, because you need to
have a valid plugin registration, but Velocity can't register the plugin until the plugin has been
constructed, causing a "chicken or the egg" problem.

To break this vicious cycle, you should always wait for initialization, which is indicated when
Velocity fires the [](jd:velocity:com.velocitypowered.api.event.proxy.ProxyInitializeEvent).
We can do things on initialization by adding a listener for this event, as shown below.
Note that Velocity automatically registers your plugin main class as a listener.

```java
@Subscribe
public void onProxyInitialization(ProxyInitializeEvent event) {
  // Do some operation demanding access to the Velocity API here.
  // For instance, we could register an event:
  server.getEventManager().register(this, new PluginListener());
}
```

:::

## Getting your plugin's directory

At some point you may need your plugin's directory. To do this, add
`@DataDirectory Path dataDirectory` to your plugin's constructor parameters:

```java
private final Path dataDirectory;

@Inject
public VelocityTest(ProxyServer server, Logger logger, @DataDirectory Path dataDirectory) {
  this.server = server;
  this.logger = logger;
  this.dataDirectory = dataDirectory;
}
```

This will get you a [](jd:java:java.nio.file.Path) of your plugin directory.
If you absolutely need a [](jd:java:java.io.File),
you may use [](jd:java:java.nio.file.Path#toFile()).
However, Velocity usually works with `Path`.


---


# Command API

How to create commands within Velocity.

The command API lets you create commands that can be executed by a player connected to the proxy or
the console.

## Creating a command

Each command class needs to implement a [](jd:velocity:com.velocitypowered.api.command.Command) sub-interface.
The choice depends on the type of arguments and the granularity of suggestions provided to the client. These include:

### [](jd:velocity:com.velocitypowered.api.command.BrigadierCommand)

Internally, Velocity uses the [Brigadier](https://github.com/Mojang/brigadier) library to register
and dispatch command actions. You can register your own `CommandNode`s by wrapping them in a
`BrigadierCommand`. Let's see an example of a command that will tell whoever executes the command
"Hello World" in light blue text.

```java title="TestBrigadierCommand.java" collapse={1-11} showLineNumbers
package com.example.velocityplugin;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.Command;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.velocitypowered.api.command.BrigadierCommand;
import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.VelocityBrigadierMessage;
import com.velocitypowered.api.proxy.ProxyServer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;

public final class TestBrigadierCommand {

  public static BrigadierCommand createBrigadierCommand(final ProxyServer proxy) {
    LiteralCommandNode<CommandSource> helloNode = BrigadierCommand.literalArgumentBuilder("test")
      // Here you can filter the subjects that can execute the command.
      // This is the ideal place to do "hasPermission" checks
      .requires(source -> source.hasPermission("test.permission"))
      // Here you can add the logic that will be used in
      // the execution of the "/test" command without any argument
      .executes(context -> {
        // Here you get the subject that executed the command
        CommandSource source = context.getSource();

        Component message = Component.text("Hello World", NamedTextColor.AQUA);
        source.sendMessage(message);

        // Returning Command.SINGLE_SUCCESS means that the execution was successful
        // Returning BrigadierCommand.FORWARD will send the command to the server
        return Command.SINGLE_SUCCESS;
      })
      // Using the "then" method, you can add sub-arguments to the command.
      // For example, this subcommand will be executed when using the command "/test <some argument>"
      // A RequiredArgumentBuilder is a type of argument in which you can enter some undefined data
      // of some kind. For example, this example uses a StringArgumentType.word() that requires
      // a single word to be entered, but you can also use different ArgumentTypes provided by Brigadier
      // that return data of type Boolean, Integer, Float, other String types, etc
      .then(BrigadierCommand.requiredArgumentBuilder("argument", StringArgumentType.word())
        // Here you can define the hints to be provided in case the ArgumentType does not provide them.
        // In this example, the names of all connected players are provided
        .suggests((context, builder) -> {
          // Here we provide the names of the players along with a tooltip,
          // which can be used as an explanation of a specific argument or as a simple decoration
          proxy.getAllPlayers().forEach(player -> builder.suggest(
              player.getUsername(),
              // A VelocityBrigadierMessage takes a component.
              // In this case, the player's name is provided with a rainbow
              // gradient created using MiniMessage.
              VelocityBrigadierMessage.tooltip(
                  MiniMessage.miniMessage().deserialize("<rainbow>" + player.getUsername())
              )
          ));
          // If you do not need to add a tooltip to the hint
          // or your command is intended only for versions lower than Minecraft 1.13,
          // you can omit adding the tooltip, since for older clients,
          // the tooltip will not be displayed.
          builder.suggest("all");
          return builder.buildFuture();
        })
        // Here the logic of the command "/test <some argument>" is executed
        .executes(context -> {
          // Here you get the argument that the CommandSource has entered.
          // You must enter exactly the name as you have named the argument
          // and you must provide the class of the argument you expect, in this case... a String
          String argumentProvided = context.getArgument("argument", String.class);
          // This method will check if the given string corresponds to a
          // player's name and if it does, it will send a message to that player
          proxy.getPlayer(argumentProvided).ifPresent(player ->
            player.sendMessage(Component.text("Hello!"))
          );
          // Returning Command.SINGLE_SUCCESS means that the execution was successful
          // Returning BrigadierCommand.FORWARD will send the command to the server
          return Command.SINGLE_SUCCESS;
        })
      )
      .build();

    // BrigadierCommand implements Command
    return new BrigadierCommand(helloNode);
  }
}
```

Brigadier commands have full backward compatibility with 1.12.2 and lower versions.

Custom plugin command argument types are not supported in Velocity, as they would require the client
to also support them. We recommend sticking to the predefined Brigadier types provided.

### [](jd:velocity:com.velocitypowered.api.command.SimpleCommand)

Modeled after the convention popularized by Bukkit and BungeeCord, a `SimpleCommand` has three
methods: one for when the command is executed, one to provide suggestions for tab completion, and
one to check a [](jd:velocity:com.velocitypowered.api.command.CommandSource)
has permission to use the command. All methods receive a
[](jd:velocity:com.velocitypowered.api.command.SimpleCommand$Invocation)
object, which contains the `CommandSource` that executed the command and the arguments as an array of strings.
The previous example can also be implemented using this interface:

```java title="TestCommand.java" collapse={1-8} showLineNumbers
package com.example.velocityplugin;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import java.util.concurrent.CompletableFuture;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;

public final class TestCommand implements SimpleCommand {

  @Override
  public void execute(final Invocation invocation) {
    CommandSource source = invocation.source();
    // Get the arguments after the command alias
    String[] args = invocation.arguments();

    source.sendMessage(Component.text("Hello World!", NamedTextColor.AQUA));
  }

  // This method allows you to control who can execute the command.
  // If the executor does not have the required permission,
  // the execution of the command and the control of its autocompletion
  // will be sent directly to the server on which the sender is located
  @Override
  public boolean hasPermission(final Invocation invocation) {
    return invocation.source().hasPermission("command.test");
  }

  // With this method you can control the suggestions to send
  // to the CommandSource according to the arguments
  // it has already written or other requirements you need
  @Override
  public List<String> suggest(final Invocation invocation) {
    return List.of();
  }

  // Here you can offer argument suggestions in the same way as the previous method,
  // but asynchronously. It is recommended to use this method instead of the previous one
  // especially in cases where you make a more extensive logic to provide the suggestions
  @Override
  public CompletableFuture<List<String>> suggestAsync(final Invocation invocation) {
    return CompletableFuture.completedFuture(List.of());
  }
}
```

It's important to note [`invocation.arguments()`](jd:velocity:com.velocitypowered.api.command.CommandInvocation#arguments())
doesn't include the command alias (e.g. `teleport` for `/teleport foo bar`). In the event that no arguments are specified, an empty array will be
passed, rather than a null array.

If a player or the console executes the following command: `/stats Player2 kills`, the first
argument will be `Player2`, which we can access using `invocation.arguments()[0]` and the second
argument will be `kills`.

### [](jd:velocity:com.velocitypowered.api.command.RawCommand)

There's certain cases where you don't need to process the arguments. These may include:

- A `/say` style command, where the arguments contain the message as a string; or
- You're using an external command framework to process your commands.

A raw command indicates the proxy to pass the command alias and its arguments directly without
further processing. Let's see an example of a command that echoes the received input:

```java title="EchoCommand.java" collapse={1-4} showLineNumbers
package com.example.velocityplugin;

import com.velocitypowered.api.command.RawCommand;
import net.kyori.adventure.text.Component;

public final class EchoCommand implements RawCommand {

  @Override
  public void execute(final Invocation invocation) {
    invocation.source().sendMessage(Component.text(invocation.arguments()));
  }

  @Override
  public boolean hasPermission(final Invocation invocation) {
    return invocation.source().hasPermission("command.echo");
  }
}
```

## Registering a command

Now that we have created a command, we need to register it in order for it to work. To register
commands, you use the [](jd:velocity:com.velocitypowered.api.command.CommandManager).
We get the command manager by executing
[`proxyServer.getCommandManager()`](jd:velocity:com.velocitypowered.api.proxy.ProxyServer#getCommandManager())
with the proxy instance, or by injecting it using the [`@Inject`](https://javadoc.io/doc/com.google.inject/guice/latest/com/google/inject/Inject.html)
annotation in the main class. The register method requires two parameters, the command metadata and the command object.

The [](jd:velocity:com.velocitypowered.api.command.CommandMeta)
contains the case-insensitive aliases and more advanced features.
`CommandManager` provides a meta builder via the
[`metaBuilder(String alias)`](jd:velocity:com.velocitypowered.api.command.CommandManager#metaBuilder(java.lang.String)) method.

```java title="HelloWorldPlugin.java" collapse={1-8} showLineNumbers
package com.example.velocityplugin;

import com.google.inject.Inject;
import com.velocitypowered.api.command.BrigadierCommand;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.ProxyServer;

@Plugin(id = "helloworld")
public final class HelloWorldPlugin {
  private final ProxyServer proxy;

  @Inject
  public HelloWorldPlugin(ProxyServer proxy) {
    this.proxy = proxy;
  }

  @Subscribe
  public void onProxyInitialize(ProxyInitializeEvent event) {
    CommandManager commandManager = proxy.getCommandManager();
    // Here you can add meta for the command, as aliases and the plugin to which it belongs (RECOMMENDED)
    CommandMeta commandMeta = commandManager.metaBuilder("test")
      // This will create a new alias for the command "/test"
      // with the same arguments and functionality
      .aliases("otherAlias", "anotherAlias")
      .plugin(this)
      .build();

    // You can replace this with "new EchoCommand()" or "new TestCommand()"
    // SimpleCommand simpleCommand = new TestCommand();
    // RawCommand rawCommand = new EchoCommand();
    // The registration is done in the same way, since all 3 interfaces implement "Command"
    BrigadierCommand commandToRegister = TestBrigadierCommand.createBrigadierCommand(proxy);

    // Finally, you can register the command
    commandManager.register(commandMeta, commandToRegister);
  }
}
```

If you're registering a `BrigadierCommand`, you may prefer to use the
[`register(BrigadierCommand)`](jd:velocity:com.velocitypowered.api.command.CommandManager#register(com.velocitypowered.api.command.BrigadierCommand))
method or [`metaBuilder(BrigadierCommand)`](jd:velocity:com.velocitypowered.api.command.CommandManager#metaBuilder(com.velocitypowered.api.command.BrigadierCommand))
to specify additional aliases.


---


# Creating your first plugin

How to create your first plugin with the Velocity API.

import { Tabs, TabItem } from "@astrojs/starlight/components";
import { LATEST_VELOCITY_RELEASE } from "/src/utils/versions";

It is very simple to create a plugin for Velocity. This section will teach you how to set up your
IDE, your plugin identifiers, and give you an introduction to the basics of the Velocity API.

## Before you continue...

You will need proficiency in the Java programming language. If you don't know Java yet, we strongly
recommend you learn some basic Java before you continue.

## Set up your environment

You're going to need the [JDK](/misc/java-install) and an IDE. If you don't have an IDE, IntelliJ
IDEA is recommended.

## Creating the project in your IDE

- Open your IDE
- Click `Create New Project` or the equivalent
- Select either `Gradle` or `Maven`
- Make sure your **Project JDK** is Java 25 or later
- **Finish** the dialog and open the project.

Now we have created our project, we need configure our build system.

## I know how to do this. Give me what I need!

### Maven repository

| Name      | URL                                                |
|-----------|----------------------------------------------------|
| `papermc` | `https://repo.papermc.io/repository/maven-public/` |

### Dependency

| Group ID              | Artifact ID    | Version                   |
|-----------------------|----------------|---------------------------|
| `com.velocitypowered` | `velocity-api` | {LATEST_VELOCITY_RELEASE} |

### Javadocs

Javadocs are available at [jd.papermc.io](jd:velocity).

## Set up your build system

You will need to set up a build system before you continue. While it is possible to write Velocity
plugins without one, having a build system will make your life a lot less difficult.

How to set up a build system is outside the scope of this page, but you can look at your build
system's documentation ([Gradle](https://docs.gradle.org/current/userguide/userguide.html) or
[Maven](https://maven.apache.org/guides/getting-started/index.html)) for assistance.

:::note[velocity-plugin.json]

Before you set up your build system, you should think about whether you want your `velocity-plugin.json`
to be generated automatically using a `@Plugin` annotation in your source code or if you want to write it
manually. Depending on which you prefer, you may need to add additional lines to your build files. You can find
more information on the `velocity-plugin.json` file [here](/velocity/dev/velocity-plugin-json).

:::

### Setting up the dependency

<Tabs syncKey="build-system">
  <TabItem label="Gradle (Kotlin)">
    ```kotlin title="build.gradle.kts" replace
    repositories {
      maven(url = "https://repo.papermc.io/repository/maven-public/") {
        name = "papermc"
      }
    }

    dependencies {
      compileOnly("com.velocitypowered:velocity-api:\{LATEST_VELOCITY_RELEASE}")
      // If you want your velocity-plugin.json file to be generated based on plugin annotations
      annotationProcessor("com.velocitypowered:velocity-api:\{LATEST_VELOCITY_RELEASE}")
    }
    ```
  </TabItem>
  <TabItem label="Gradle (Groovy)">
    ```groovy title="build.gradle" replace
    repositories {
      maven {
        name = 'papermc'
        url = 'https://repo.papermc.io/repository/maven-public/'
      }
    }

    dependencies {
      compileOnly 'com.velocitypowered:velocity-api:\{LATEST_VELOCITY_RELEASE}'
      // If you want your velocity-plugin.json file to be generated based on plugin annotations
      annotationProcessor 'com.velocitypowered:velocity-api:\{LATEST_VELOCITY_RELEASE}'
    }
    ```
  </TabItem>
  <TabItem label="Maven 4+">
    :::caution

    If you're using JDK 23 or later, you must add the annotation processor manually to your `pom.xml`, as described in the example.
    See the [Maven documentation](https://maven.apache.org/plugins/maven-compiler-plugin-4.x/examples/annotation-processor.html) for more information.

    :::

    ```xml title="pom.xml" replace
    <project>
      <repositories>
        <repository>
          <id>papermc</id>
          <url>https://repo.papermc.io/repository/maven-public/</url>
        </repository>
      </repositories>

      <dependencies>
        <dependency>
          <groupId>com.velocitypowered</groupId>
          <artifactId>velocity-api</artifactId>
          <version>\{LATEST_VELOCITY_RELEASE}</version>
          <scope>provided</scope>
        </dependency>
        <!-- add the annotation processor if you want your velocity-plugin.json file to be generated -->
        <dependency>
          <groupId>com.velocitypowered</groupId>
          <artifactId>velocity-api</artifactId>
          <version>\{LATEST_VELOCITY_RELEASE}</version>
          <type>processor</type>
        </dependency>
      </dependencies>
    </project>
    ```
  </TabItem>
  <TabItem label="Maven 3">
    :::caution

    If you're using JDK 23 or later, you must add the annotation processor manually to your `pom.xml`, as described in the example.
    See the [Maven documentation](https://maven.apache.org/plugins/maven-compiler-plugin-4.x/examples/annotation-processor.html) for more information.

    :::

    ```xml title="pom.xml" replace
    <project>
      <repositories>
        <repository>
          <id>papermc</id>
          <url>https://repo.papermc.io/repository/maven-public/</url>
        </repository>
      </repositories>

      <dependencies>
        <dependency>
          <groupId>com.velocitypowered</groupId>
          <artifactId>velocity-api</artifactId>
          <version>\{LATEST_VELOCITY_RELEASE}</version>
          <scope>provided</scope>
        </dependency>
      </dependencies>

      <build>
        <plugins>
          <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <configuration>
              <!-- add the annotation processor if you want your velocity-plugin.json file to be generated -->
              <annotationProcessorPaths>
                <path>
                  <groupId>com.velocitypowered</groupId>
                  <artifactId>velocity-api</artifactId>
                  <version>\{LATEST_VELOCITY_RELEASE}</version>
                </path>
              </annotationProcessorPaths>
            </configuration>
          </plugin>
        </plugins>
      </build>
    </project>
    ```
  </TabItem>
</Tabs>

## Using the Minecraft Development IntelliJ plugin

Alternatively, you can use the [Minecraft Development IntelliJ plugin](https://plugins.jetbrains.com/plugin/8327-minecraft-development)
to create a new project. To do that you need to install the plugin first.

:::note

This tutorial only works with IntelliJ IDEA. If you are using another IDE, please follow the manual project setup guide described above.

:::

### Installing the Minecraft Development plugin

The first thing you need to do is install the [Minecraft Development](https://plugins.jetbrains.com/plugin/8327-minecraft-development) plugin.
You can do this by going to `File > Settings > Plugins` and searching for `Minecraft Development` under the `Marketplace` section.

![](./assets/installing-plugin.png)

Once you have installed the plugin, you will need to restart IntelliJ.
To do that you can click the `Restart IDE` button that appears after installing the plugin.

![](./assets/restart-ide.png)

### Creating a new project

Now that you have installed the plugin, you can create a new project by going to `File > New > Project...` and selecting `Minecraft` from the list of options.

### Setting up a Velocity project

![](./assets/new-project-velocity.png)

You will be asked to provide some information about your project.

| Field                | Explanation                                                                                                                                                                                                                                                               |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Name**             | The name of your project.                                                                                                                                                                                                                                                 |
| **Location**         | The location of your project. This is where the project files will be stored.                                                                                                                                                                                             |
| **Platform Type**    | The platform type you are developing for. This should be `Plugin`.                                                                                                                                                                                                        |
| **Platform**         | The platform you are developing for. This should be `Velocity`.                                                                                                                                                                                                           |
| **Velocity Version** | The version of Velocity you are developing for.                                                                                                                                                                                                                           |
| **Plugin Id**        | The id of your plugin.                                                                                                                                                                                                                                                    |
| **Plugin Name**      | The name of your plugin.                                                                                                                                                                                                                                                  |
| **Main Class**       | The main class of your plugin. This class should have the `@Plugin` annotation.                                                                                                                                                                                           |
| **Optional Setting** | Here you can define things like authors, website, description, etc. These are optional and not required for the plugin to work.                                                                                                                                           |
| **Build System**     | The build system you want to use. Paper recommends using Gradle but you can use Maven if you prefer.                                                                                                                                                                      |
| **Group ID**         | The group ID of your project. This is used for Maven and Gradle. This is usually your domain name in reverse. If you don't know what you should put here, you can use something like `io.github.<yourname>` or if you don't have GitHub you can just use `me.<yourname>`. |
| **Artifact ID**      | The artifact ID of your project. This is used for Maven and Gradle. This is usually the name of your project. This is usually the same as the `Name` field.                                                                                                               |
| **Version**          | The version of your project. This is used for Maven and Gradle. This is usually `1.0-SNAPSHOT` and does not really matter for now.                                                                                                                                        |
| **JDK**              | The JDK you want to use. This can be anything from Java 25 and above.                                                                                                                                                                                                     |

Now you can click on the `Create` button and IntelliJ will create the project for you.
If everything went well, you should see something like this:

![](./assets/velocity-plugin-overview.png)

## Conclusion

You should now have a project set up with Velocity as a dependency.
All you have left to do now is to compile your plugin and run it on a Velocity server.

:::note

If you want to streamline the process of testing a plugin, you can use the [Run-Task](https://github.com/jpenilla/run-task) Gradle plugin.
It will automatically download a Velocity server and run it for you.

:::

:::note

If you are using IntelliJ, you can use the Gradle GUI `Build` menu to compile your plugin - found on the top right of your IDE.
The output JAR of your plugin will be in the `build/libs` directory.

:::


---


# Dependency management

How to handle dependencies within your Velocity plugin.

Dependencies are common. You need to hook into another plugin. You don't want to write the same code
someone else has already solved. Whatever you do, you need a way to manage your dependencies
effectively.

## Plugin dependencies

Adding a dependency on another plugin is done with the
[`@Plugin`](jd:velocity:com.velocitypowered.api.plugin.Plugin)
annotation in your main class. Let's revisit that briefly:

```java
@Plugin(
  id = "myfirstplugin",
  name = "My Plugin",
  version = "0.1.0"
)
public class VelocityTest {
  // ...
}
```

Say we have a dependency on another plugin, call it `wonderplugin`. To add it as a dependency, do
the following:

```java
@Plugin(
  id = "myfirstplugin",
  name = "My Plugin",
  version = "0.1.0",
  dependencies = {
    @Dependency(id = "wonderplugin")
  }
)
public class VelocityTest {
  // ...
}
```

The id of the dependency is the same as the other plugin's `id` from its `@Plugin` annotation. This
is why having a stable plugin ID is important.

That's it! Now, your plugin will require `wonderplugin` to load, and when it does, it will load
_after_ `wonderplugin`.

To specify multiple dependencies, separate them by commas:
`dependencies = {@Dependency(id = "wonderplugin"), @Dependency(id = "otherplugin")}`

## Optional plugin dependencies

To make a dependency optional, add `optional = true`, like shown:

```java
@Plugin(
  id = "myfirstplugin",
  name = "My Plugin",
  version = "0.1.0",
  dependencies = {
    @Dependency(id = "wonderplugin", optional = true)
  }
)
public class VelocityTest {
  // ...
}
```

## External dependencies

:::caution

Please remember to relocate any dependencies you shade. Failure to relocate will lead to dependency
conflicts with other plugins.

:::

Dependencies on other libraries aren't handled by Velocity. You will need to add them using your
build system.

If your plugin does not shade its dependencies, but rather attaches them from a directory, you may
use the [](jd:velocity:com.velocitypowered.api.plugin.PluginManager)'s
[`addToClasspath`](jd:velocity:com.velocitypowered.api.plugin.PluginManager#addToClasspath(java.lang.Object,java.nio.file.Path))
method instead of using reflection to access the
[](jd:java:java.lang.ClassLoader).


---


# Working with events

How to listen for events in Velocity.

Listening to events with Velocity's `@Subscribe`
annotation is straightforward. You've already seen one such listener, using
[](jd:velocity:com.velocitypowered.api.event.proxy.ProxyInitializeEvent)
in your main class. Additional events can be found on the [Javadoc](jd:velocity).

## Creating a listener method

To listen to an event, mark the method with [`@Subscribe`](jd:velocity:com.velocitypowered.api.event.Subscribe),
like shown. This works similarly to annotation-driven event listening in other APIs you may be familiar with;
it's the equivalent of Bukkit's/Bungee's `@EventHandler` and Sponge's `@Listener`.

```java
@Subscribe
public void onPlayerChat(PlayerChatEvent event) {
  // do stuff here
}
```

:::tip

Note that the import is [`com.velocitypowered.api.event.Subscribe`](jd:velocity:com.velocitypowered.api.event.Subscribe)
and _not_ in `com.google.common.eventbus`.

:::

## Orders

Every listener has a [`priority`](jd:velocity:com.velocitypowered.api.event.Subscribe#priority()).
When an event is fired, the order in which listeners are invoked is defined by their `priority`.
The higher the priority, the earlier the event handler will be called.

State the desired order in the `@Subscribe` annotation:

```java
@Subscribe(priority = 10)
public void onPlayerChatFirst(PlayerChatEvent event) {
  // this method fires first
}

@Subscribe(priority = 5)
public void onPlayerChat(PlayerChatEvent event) {
  // this method fires after the one above
}
```

`0` is the default value if you do not specify an order.

## Registering listeners

Velocity automatically registers your main plugin class as an event listener. This is handy for
initialization and for simple plugins, but for more complex plugins, you will want to separate your
event handlers from the main plugin class. To do so, you will need to register with the
[](jd:velocity:com.velocitypowered.api.event.EventManager)
any other listeners you have:

The event system supports registering an object as a listener (allowing you to use `@Subscribe` to
mark event handlers) or registering functional listeners.

### Registering an object as a listener

```java
server.getEventManager().register(plugin, listener);
```

Both parameters are [](jd:java:java.lang.Object).
The first argument is your plugin's object, and the second argument should be the listener to register. For example:

```java
@Plugin(id = "myfirstplugin", name = "My Plugin", version = "0.1.0", dependencies = {@Dependency(id = "wonderplugin")})
public class VelocityTest {

  private final ProxyServer server;
  private final Logger logger;

  @Inject
  public VelocityTest(ProxyServer server, Logger logger) {
    this.server = server;
    this.logger = logger;
  }

  @Subscribe
  public void onInitialize(ProxyInitializeEvent event) {
    server.getEventManager().register(this, new MyListener());
  }
}

public class MyListener {

  @Subscribe
  public void onPlayerChat(PlayerChatEvent event) {
    // do something here
  }

}
```

### Registering a functional-style listener

As an alternative to `@Subscribe`, you can also use the functional `EventHandler` interface and register yours with
[`register(Object plugin, Class<E> eventClass, EventHandler<E> handler)`](jd:velocity:com.velocitypowered.api.event.EventManager#register(java.lang.Object,java.lang.Class,com.velocitypowered.api.event.EventHandler)):

```java
server.getEventManager().register(this, PlayerChatEvent.class, event -> {
  // do something here
});
```

## Handling events asynchronously

In Velocity 3.0.0, events can now be handled asynchronously. The event system allows a plugin to
pause sending an event to every listener, perform some unit of computation or I/O asynchronously,
and then resume processing the event. All Velocity events have the ability to be processed
asynchronously, however only some will explicitly wait for events to finish being fired before
continuing.

For an annotation-based listener, all that is needed to process an event asynchronously is to either
return an [](jd:velocity:com.velocitypowered.api.event.EventTask)
or add a second return an [](jd:velocity:com.velocitypowered.api.event.Continuation) parameter:

```java
@Subscribe(priority = 100)
public void onLogin(LoginEvent event, Continuation continuation) {
  doSomeAsyncProcessing().whenComplete((_, throwable) -> {
    if (throwable != null) {
      continuation.resumeWithException(throwable);
    } else {
      continuation.resume();
    }
  });
}

private CompletableFuture<Void> doSomeAsyncProcessing() {
  //...
}

@Subscribe(priority = 100)
public EventTask onPlayerChat(PlayerChatEvent event) {
  if (mustFurtherProcess(event)) {
    return EventTask.async(() => ...);
  }
  return null;
}
```

A functional listener simply needs to implement
[](jd:velocity:com.velocitypowered.api.event.AwaitingEventExecutor)
and return an [](jd:velocity:com.velocitypowered.api.event.EventTask):

```java
server.getEventManager().register(this, PlayerChatEvent.class, (AwaitingEventExecutor) event -> {
  if (mustFurtherProcess(event)) {
    return EventTask.async(() => ...);
  }
  return null;
});
```

There are two types of event tasks:

- **Async tasks** simply run a unit of execution asynchronously. To get a basic event task, use
  [](jd:velocity:com.velocitypowered.api.event.EventTask#async(java.lang.Runnable)).
  Basic event tasks are the closest equivalent for Velocity 1.x.x event listeners and asynchronous
  events in the Bukkit API.
- **Continuation tasks** provide the listener with a callback (known as a `Continuation`) to resume
  event processing when the (possibly asynchronous) work is completed. To get a continuation-based
  event task, use [`EventTask.withContinuation(Consumer<Continuation>)`](jd:velocity:com.velocitypowered.api.event.EventTask#withContinuation(java.util.function.Consumer)).
  Continuation-based tasks are the closest equivalent for listeners that use BungeeCord `AsyncEvent`
  intents, but have a slightly different programming model in that each listener still runs sequentially,
  just that an individual listener can defer passing control onto the next listener until it is done.

:::caution

To retain compatibility with older versions of Velocity, Velocity 3.0.0 runs all event listeners
asynchronously. This behavior will change in Polymer and will require you to explicitly provide an
event task (or to use continuations) if you need to perform some work asynchronously. All developers
are urged to make the transition now.

:::

## Creating events

Creating events on Velocity is somewhat different than on other platforms. However, it is very
similar for the most part.

### Creating the event class

First we need to create a class for our event. In this tutorial we'll assume you're making a private
messaging plugin, and thus use a `PrivateMessageEvent`. Most of this part is boilerplate.

```java title="PrivateMessageEvent.java"
public class PrivateMessageEvent {

  private final Player sender;
  private final Player recipient;
  private final String message;

  public PrivateMessageEvent(Player sender, Player recipient, String message) {
    this.sender = sender;
    this.recipient = recipient;
    this.message = message;
  }

  public Player sender() {
    return sender;
  }

  public Player recipient() {
    return recipient;
  }

  public String message() {
    return message;
  }

  // toString, equals, and hashCode may be added as needed

}
```

You'll notice that your events don't need to extend or implement anything. They just work.

### Firing the Event

To fire the event, you'll need to get the server's event manager and use the
[`fire`](jd:velocity:com.velocitypowered.api.event.EventManager#fire(E))
method. Note that this returns a [](jd:java:java.util.concurrent.CompletableFuture),
so if you want to continue logic after the event is handled by all listeners, use a callback:

```java
server.getEventManager().fire(new PrivateMessageEvent(sender, recipient, message)).thenAccept((event) -> {
  // event has finished firing
  // do some logic dependent on the result
});
```

### Using `ResultedEvent`

Velocity uses the generalized [](jd:velocity:com.velocitypowered.api.event.ResultedEvent)
for events which have some sort of 'result'. The result type of the event is defined by its generic type; for example
`PrivateMessageEvent implements ResultedEvent<ResultType>`.

Some common result types are [`GenericResult`](jd:velocity:com.velocitypowered.api.event.ResultedEvent$GenericResult),
for simple allowed/denied results, and component results, used for events where the result may be denied with an accompanying reason
(such as in a login event).

Using a general result is far more encompassing than `isCancelled/setCancelled` methods you may be
used to on other platforms, whose meaning is vague and limited to a simple boolean. In this example,
we'll use `GenericResult`, so listeners will be able to mark our `PrivateMessageEvent` as either
allowed or denied.

```java title="PrivateMessageEvent.java"
public class PrivateMessageEvent implements ResultedEvent<GenericResult> {

  private final Player sender;
  private final Player recipient;
  private final String message;

  private GenericResult result = GenericResult.allowed(); // Allowed by default

  public PrivateMessageEvent(Player sender, Player recipient, String message) {
    this.sender = sender;
    this.recipient = recipient;
    this.message = message;
  }

  public Player sender() {
    return sender;
  }

  public Player recipient() {
    return recipient;
  }

  public String message() {
    return message;
  }

  @Override
  public GenericResult result() {
    return result;
  }

  @Override
  public void setResult(GenericResult result) {
    this.result = Objects.requireNonNull(result);
  }

}
```

Per convention, the result of a `ResultedEvent` should never be null. Here, we assure that using
[](jd:java:java.util.Objects#requireNonNull(T)).

Listeners may 'deny' the event by using `event.setResult(GenericResult.denied())`, and you may check
the result with `event.getResult()`.


---


# Getting started

import PageCards from "/src/components/PageCards.astro";

Guides for getting started with developing a Velocity plugin.

<PageCards />


---


# How-to guides

import PageCards from "/src/components/PageCards.astro";

How-to guides for developing your Velocity plugin.

<PageCards />


---


# Common pitfalls

How to avoid common pitfalls within Velocity.

While we try to make the API a pleasure to use, there are the occasional rough edges, and you should
be aware of them.

## Accessing the API at construction time

In Velocity, plugin loading is split into two steps: construction and initialization. The code in
your plugin's constructor is part of the construction phase. There is very little you can do safely
during construction, especially as the API does not specify which operations are safe to run during
construction. Notably, you can't register an event listener in your constructor, because you need to
have a valid plugin registration, but Velocity can't register the plugin until the plugin has been
constructed.

To break this cycle, you should always wait for initialization, which is indicated when Velocity
fires the [](jd:velocity:com.velocitypowered.api.event.proxy.ProxyInitializeEvent).
We can do things on initialization by adding a listener for this event, as shown below.
Note that Velocity automatically registers your plugin main class as a listener.

```java
@Subscribe
public void onProxyInitialization(ProxyInitializeEvent event) {
  // Do some operation demanding access to the Velocity API here.
  // For instance, we could register an event:
  server.getEventManager().register(this, new PluginListener());
}
```

## Audience operations are not fully supported

Velocity currently does not support all Audience operations of the Adventure API, so these operations should be handled on the backend.
Furthermore, playing sound was previously considered infeasible for versions below 1.19.3, a registry of hardcoded sound IDs is required.

| Operation                  | Supported        |
| -------------------------- | -----------------|
| Chat messages              | Yes              |
| Action bar messages        | Yes              |
| Titles                     | Yes              |
| Bossbars                   | Yes              |
| Tablist header and footer  | Yes              |
| Resource packs             | Yes              |
| Sounds                     | Yes[^sounds-note]|
| Books                      | No               |
| Dialogs                    | No               |

[^sounds-note]: Playing sounds only works on 1.19.3+ and requires an emitter ([](jd:adventure:net.kyori.adventure.sound.Sound$Emitter#self()) or another player from the same server). [](jd:velocity:com.velocitypowered.api.proxy.Player#playSound(net.kyori.adventure.sound.Sound)) is not implemented, as Adventure's contract requires sounds to play at the player's current position.


---


# Plugin messaging

How to handle and send plugin messages on Velocity.

First introduced in [2012](https://web.archive.org/web/20220711204310/https://dinnerbone.com/blog/2012/01/13/minecraft-plugin-channels-messaging/),
plugin messaging is a way for Velocity plugins to communicate with clients and backend servers.

Velocity manages connections in both directions, for both the client and backend server.
This means Velocity plugins need to consider 4 main cases:

```d2
style.fill: transparent
direction: right

player -> Velocity: "1 (Incoming)"
Velocity -> backend: "2 (Outgoing)"
backend -> Velocity: "3 (Incoming)"
Velocity -> player: "4 (Outgoing)"
```

:::caution

When listening to `PluginMessageEvent`, ensure the result is
[`ForwardResult.handled()`](jd:velocity:com.velocitypowered.api.event.connection.PluginMessageEvent$ForwardResult#handled())
if you do not intend the client to participate.

If the result is forwarded, players can impersonate the proxy to your backend servers.

Additionally, ensure the result is set correctly after actually handling correct messages, to prevent them from being leaked to the other party.

This can be achieved with unconditionally setting the result between checking the identifier and checking the source, as shown in the examples.

:::

Additionally, BungeeCord channel compatibility is included, which may remove the need for a companion Velocity plugin in certain cases.

## Case 1: Receiving a plugin message from a player

This is for when you need to handle or inspect the contents of a plugin message sent by a player.
It will require registering with the ChannelRegistrar for the event to be fired.

An example use case could be logging messages from a mod that reports the enabled features.

```d2
style.fill: transparent
direction: right

"Forward from player" {
  player -> Velocity
  Velocity -> backend
}

"Handle from player" {
  player -> Velocity
  Velocity -> backend {
    style.stroke: transparent
  }
}
```

```java
public static final MinecraftChannelIdentifier IDENTIFIER = MinecraftChannelIdentifier.from("custom:main");

@Subscribe
public void onProxyInitialization(ProxyInitializeEvent event) {
  proxyServer.getChannelRegistrar().register(IDENTIFIER);
}

@Subscribe
public void onPluginMessageFromPlayer(PluginMessageEvent event) {
  // Check if the identifier matches first, no matter the source.
  if (!IDENTIFIER.equals(event.getIdentifier())) {
    return;
  }

  // mark PluginMessage as handled, indicating that the contents
  // should not be forwarding to their original destination.
  event.setResult(PluginMessageEvent.ForwardResult.handled());

  // Alternatively:

  // mark PluginMessage as forwarded, indicating that the contents
  // should be passed through, as if Velocity is not present.
  //event.setResult(PluginMessageEvent.ForwardResult.forward());

  // only attempt parsing the data if the source is a player
  if (!(event.getSource() instanceof Player player)) {
    return;
  }

  ByteArrayDataInput in = ByteStreams.newDataInput(event.getData());
  // handle packet data
}
```

## Case 2: Sending a plugin message to a backend server

This is for when you need to send a plugin message to a backend server.

There are two methods to send a plugin message to the backend, depending on what you need to achieve.

:::caution

On your backend server, only listen for plugin messages if you are sure only a trusted proxy can send them to your server.

Otherwise, a player can pretend to be your proxy, and spoof them.

:::

```d2
style.fill: transparent
direction: right

"Send to backend" {
  player -> Velocity {
    style.stroke: transparent
  }
  Velocity -> backend
}
```

### Using any connected player

This is useful if you just want to communicate something relevant to the entire server,
or otherwise can be derived from its content.

An example use case could be telling the server to shut down.

```java
public boolean sendPluginMessageToBackend(RegisteredServer server, ChannelIdentifier identifier, byte[] data) {
  // On success, returns true
  return server.sendPluginMessage(identifier, data);
}
```

### Using a specific player's connection

This is useful if you want to communicate something about a specific player to their current backend server.
You may want additional checks to ensure it will be handled correctly on the backend the player is on.

An example use case could be telling the backend server to give the player a specific item.

```java
public boolean sendPluginMessageToBackendUsingPlayer(Player player, ChannelIdentifier identifier, byte[] data) {
  Optional<ServerConnection> connection = player.getCurrentServer();
  if (connection.isPresent()) {
    // On success, returns true
    return connection.get().sendPluginMessage(identifier, data);
  }
  return false;
}
```

## Case 3: Receiving a plugin message from a backend server

This is for when you need to receive plugin messages from your backend server.
It will require registering with the [](jd:velocity:com.velocitypowered.api.proxy.messages.ChannelRegistrar)
for the event to be fired.

An example use case could be handing a request to transfer the player to another server.

```d2
style.fill: transparent
direction: left

"Forward from backend" {
  backend -> Velocity
  Velocity -> player
}

"Handle from backend" {
  backend -> Velocity
  Velocity -> player {
    style.stroke: transparent
  }
}
```

```java
public static final MinecraftChannelIdentifier IDENTIFIER = MinecraftChannelIdentifier.from("custom:main");

@Subscribe
public void onProxyInitialization(ProxyInitializeEvent event) {
  proxyServer.getChannelRegistrar().register(IDENTIFIER);
}

@Subscribe
public void onPluginMessageFromBackend(PluginMessageEvent event) {
  // Check if the identifier matches first, no matter the source.
  // this allows setting all messages to IDENTIFIER as handled,
  // preventing any client-originating messages from being forwarded.
  if (!IDENTIFIER.equals(event.getIdentifier())) {
    return;
  }

  // mark PluginMessage as handled, indicating that the contents
  // should not be forwarding to their original destination.
  event.setResult(PluginMessageEvent.ForwardResult.handled());

  // Alternatively:

  // mark PluginMessage as forwarded, indicating that the contents
  // should be passed through, as if Velocity is not present.
  //
  // this should be used with extreme caution,
  // as any client can freely send whatever it wants, pretending to be the proxy
  //event.setResult(PluginMessageEvent.ForwardResult.forward());

  // only attempt parsing the data if the source is a backend server
  if (!(event.getSource() instanceof ServerConnection backend)) {
    return;
  }

  ByteArrayDataInput in = ByteStreams.newDataInput(event.getData());
  // handle packet data
}
```

## Case 4: Sending a plugin message to a player

This is for when you need to send a plugin message to a player.

:::tip

This is only really useful for when you are making client-side mods. Otherwise, the player likely will just ignore the message.

:::

```d2
style.fill: transparent
direction: left

"Send to player" {
  backend -> Velocity {
    style.stroke: transparent
  }
  Velocity -> player
}
```

```java
public boolean sendPluginMessageToPlayer(Player player, ChannelIdentifier identifier, byte[] data) {
  // On success, returns true
  return player.sendPluginMessage(identifier, data);
}
```

## BungeeCord channel compatibility

This allows your backend servers to communicate with Velocity
in a way compatible with BungeeCord.

By default, your Velocity server will respond to the `bungeecord:main` channel, if `bungee-plugin-message-channel` is enabled in [the configuration](/velocity/configuration#advanced-section).

:::tip[The "bungeecord" specification]

See [here](/paper/dev/plugin-messaging#plugin-message-types) for a list of all the built-in plugin messages that BungeeCord / Velocity supports.

:::


---


# Porting your plugin from Velocity 1.x.x

How to port your plugin from Velocity 1.x.x to modern API.

Velocity 3.0.0 includes important API changes from the Velocity 1.x.x series. **Please read this
document very carefully**.

## Minimum supported Java version bump

Velocity 4.0.x and above now requires Java 25 and above.

## Removal of legacy dependencies

We removed all support for the old `text` 3 library. For `text` 3.x.x (and all the APIs that depend
on it), direct equivalents are available in [Adventure](/adventure/), which was
introduced in Velocity 1.1.0.

`toml4j`, deprecated in Velocity 1.1.0 (as it is no longer maintained), has not been removed to
provide more time for plugins to migrate to Configurate. However, you should prepare to either
switch to Configurate or shade `toml4j` into your plugin directly.

## New asynchronous event system

Velocity 3.0.0 contains a backport of Velocity Polymer's event system, which differs from Velocity
1.x.x's event system in a number of ways. Velocity 1.x.x's event model forced all events to be
executed asynchronously on a fixed-size thread pool, which has proven over time to be a flawed
model.

Existing event handlers will continue to work unmodified on Velocity 3.0.0, as all event handlers
are assumed to be asynchronous blocking handlers by default. However, there are some new APIs
introduced for handling continuations - see the [event API page](/velocity/dev/event-api) for more
information. However, you are encouraged to migrate your event listeners to the new event API
paradigms.


---


# Using the scheduler

A guide to the Scheduler API within Velocity allowing tasks to be run.

The Velocity scheduler lets you decide when and how your plugin tasks run, allowing fine control
over execution. On Velocity, there is no main thread. All tasks run using the Velocity scheduler are
thus run asynchronously.

## Running a delayed task

All scheduling works by using a [`TaskBuilder`](jd:velocity:com.velocitypowered.api.scheduler.Scheduler$TaskBuilder)
returned from the [](jd:velocity:com.velocitypowered.api.scheduler.Scheduler).
This fluent builder may be chained to configure the details of the scheduling.

```java
server.getScheduler()
  .buildTask(plugin, () -> {
    // do stuff here
  })
  .delay(2L, TimeUnit.SECONDS)
  .schedule();
```

Here, we are scheduling a task to run 2 seconds later. Velocity requires the instance of your
plugin, `plugin` above. If you are scheduling a task from your main plugin class you may simply use
`this`.

Time arguments are specified as a `long` with a [](jd:java:java.util.concurrent.TimeUnit).
Using time units makes scheduling delayed tasks more readable and allows for greater precision.
`2L, TimeUnit.SECONDS` is far easier to understand than the ambiguous `2000L`.

You can also use a [](jd:java:java.time.Duration) to specify the time arguments,
e.g.: `Duration.ofSeconds(5L)`.

## Running a repeating task

Creating a repeating task is similar to a delayed task, but you must also specify
[`repeat(long, TimeUnit)`](jd:velocity:com.velocitypowered.api.scheduler.Scheduler$TaskBuilder#repeat(long,java.util.concurrent.TimeUnit)).
This example will repeat every 5 minutes.

```java
server.getScheduler()
  .buildTask(plugin, () -> {
    // do stuff here
  })
  .repeat(5L, TimeUnit.MINUTES)
  .schedule();
```

## Running a task now

Tasks use the scheduler's cached thread pool for all execution, which reuses threads. To take
advantage of this thread pool for running async tasks which run now, simply omit calling the _delay_
and _repeat_ methods of the `TaskBuilder`.

## Cancellation

The [`schedule()`](jd:velocity:com.velocitypowered.api.scheduler.Scheduler$TaskBuilder#schedule())
method returns a [](jd:velocity:com.velocitypowered.api.scheduler.ScheduledTask),
which may then be used to cancel the task involved via the
[`cancel()`](jd:velocity:com.velocitypowered.api.scheduler.ScheduledTask#cancel()) method.
Tasks cannot be uncancelled.

Additionally, [`task.status()`](jd:velocity:com.velocitypowered.api.scheduler.ScheduledTask#status())
returns the current status of the task.

```java
ScheduledTask task = server.getScheduler()
  .buildTask(plugin, () -> {
    // do stuff here
  })
  .repeat(5L, TimeUnit.MINUTES)
  .schedule();
// ...
task.cancel();
// ...
System.out.println(task.status());
```

You can also schedule _self-cancelling_ tasks using a `Consumer<ScheduledTask>`.

```java
AtomicInteger integer = new AtomicInteger(0);

ScheduledTask task = server.getScheduler()
  .buildTask(plugin, (selfTask) -> {
    // do stuff here, for example...
    if (integer.addAndGet(1) > 10) {
      selfTask.cancel();
    }
  })
  .repeat(Duration.ofSeconds(4L))
  .schedule();
```

## Obtaining tasks from a plugin

You can get all tasks scheduled by a plugin with
[`tasksByPlugin(Object)`](jd:velocity:com.velocitypowered.api.scheduler.Scheduler#tasksByPlugin(java.lang.Object)).

```java
Collection<ScheduledTask> tasks = server.getScheduler().tasksByPlugin(plugin);
// then you can control them, for example, cancel all task scheduled by a plugin
for (ScheduledTask task : tasks) {
  task.cancel();
}
```


---


# The Velocity plugin file

A full reference of the velocity-plugin.json file.

import { FileTree } from "@astrojs/starlight/components";

The `velocity-plugin.json` file is the configuration file for your plugin. It contains information
about your plugin's name, description, version, main class path, and other. It is located in the `resources`
directory of your plugin and may be generated automatically, if you configured the Velocity annotation processor
and used a `@Plugin` annotation somewhere in your code.

<FileTree>
  - velocity-plugin/
    - src/
      - main/
        - java/
        - resources/
          - **velocity-plugin.json**
    - build.gradle.kts
    - settings.gradle.kts
</FileTree>

## Example
This is an example `velocity-plugin.json` file:

```json title=velocity-plugin.json {"   Required values:":2-4} {"     The ID is required. Optional defaults to false:":11-15}
{

  "id": "example-plugin",
  "main": "com.example.testplugin.TestPluginMain",
  "name": "Velocity Example Plugin",
  "version": "1.0.0",
  "description": "An example plugin for showcasing the plugin json file.",
  "url": "https://github.com/PaperMC/docs",
  "authors": ["Strokkur24"],
  "dependencies": [

    {
      "id": "luckperms",
      "optional": true
    }
  ],
  "provides": ["other-plugin"]
}
```

## Fields
The only required fields are `id` and `main`. Any other fields are optional.

- **`id`**\
  The ID of the plugin. This ID needs to be unique for each plugin. It is used for identifying your
  plugin internally and also used as the name for your plugin's logger.

  Plugin IDs must start with a lowercase letter and may contain lowercase letters,
  digits, hyphens, and underscores. The total length must not exceed 64 characters.

  ```json
  {"id": "a_cool_plugin"}
  ```

- **`main`**\
  The path towards your main plugin class.

  ```json
  {"main": "com.example.yourplugin.PluginMain"}
  ```

- **`name`**\
  A user-friendly variant of your plugin's name. This is used for any user-facing display of your plugin, such
  as the `/velocity plugins` command.

  ```json
  {"name": "A cool plugin"}
  ```

- **`version`**\
  The version of your plugin.
  ```json
  {"version": "0.0.1-beta.7"}
  ```

- **`description`**\
  The description of your plugin.
  ```json
  {"description": "Some interesting plugin description."}
  ```

- **`url`**\
  The URL of your plugin's website.
  ```json
  {"url": "https://github.com/PaperMC/Velocity"}
  ```

- **`authors`**\
  A list of your plugin's authors.
  ```json
  {"authors": ["Strokkur24", "electronicboy"]}
  ```

- **`dependencies`**\
  Your plugin's dependencies. The value of this field is an array of dependency objects.

  The dependency object itself has two fields:
  - `id` the plugin ID of the plugin you depend upon
  - `optional` whether the dependency is optional. This field is not required and defaults to `false`.

  ```json
  {
    "dependencies": [
      {
        "id": "luckperms",
        "optional": true
      }
    ]
  }
  ```

- **`provides`**\
  A list of plugin IDs that this plugin provides for. This is used for dependency resolution,
  marking that plugins depending on these IDs should be satisfied by this plugin as well.


---


# Frequently asked questions

Frequently asked Velocity administration questions.

Over the years, we've been asked many of the same questions by users. This FAQ attempts to answer as
many of these questions from the user perspective.

## What version of Java does Velocity require?

Velocity 4.0.x and above requires at least Java 25.

## Where can I find Velocity plugins?

A good source for finding plugins compatible with Velocity would be our plugin repository
[Hangar](https://hangar.papermc.io/?page=0&platform=VELOCITY).

## Does Velocity support plugins developed for BungeeCord or Waterfall?

No. Many of the things Velocity can do could not be done if we decided to support BungeeCord
plugins.

However, certain plugins may have Velocity ports available or alternatives are available. In
addition, plugins that support BungeeCord but only require that they are installed on the server
(nothing on the proxy) typically use the BungeeCord plugin messaging channel, which is supported
natively by the latest versions of Velocity.

If no Velocity port or alternative is available, the third-party project [Snap](https://hangar.papermc.io/Phoenix616/Snap)
offers an experimental way to run BungeeCord/Waterfall plugins on Velocity.
Note that not all plugins may work correctly, so you should always do your own testing.
Snap is not maintained by or affiliated with the Velocity project.

## Help, I can't connect to my server!

There are a few common causes for why you can't connect to the server.

### Basic troubleshooting

As a first step, you should verify:

- that your servers are started and are responsive to console input
- that the proxy is started
- that the server and proxy are bound to the appropriate port and IP

### Improper player information forwarding errors

```
Can't connect to server lobby: If you wish to use IP forwarding, please enable it in your Bungeecord config as well!
```

```
Can't connect to server lobby: Your server did not send a forwarding request to the proxy. Is it set up correctly?
```

These errors are result of improper configuration. See
[Player Information Forwarding](/velocity/player-information-forwarding) to learn how to properly set up player information
forwarding.

```
Can't connect to server lobby: This server requires you to connect with Velocity.
```

This error is a result of enabling Velocity modern forwarding on your backend server, but not
enabling it in Velocity. To fix this error, ensure that you have set up the correct player
information forwarding method on the proxy. See [Player Information Forwarding](/velocity/player-information-forwarding) for
more information.

### Invalid payload `REGISTER`

```
[server connection] player1 -> hub has connected
[connected player] player1 (/localhost:58943): kicked from server hub: Invalid payload REGISTER!
```

This error typically occurs on Spigot-based servers when someone connects with a modded client. You
can fix this issue if you use Paper (or a fork of Paper) 1.12.2 or above by adding the startup flag
[`-Dpaper.disableChannelLimit=true`](/paper/reference/system-properties#paperdisablechannellimit)
to the server's startup flags and restarting the server.

### Argument type identifier unknown

```
Argument type identifier <namespace>:<name> unknown.
```

If you receive this message, there are two possibilities. If you run a modded server and are using
Fabric 1.16+ and above, update to at least Velocity 1.1.2 and install
[CrossStitch](https://www.curseforge.com/minecraft/mc-mods/crossstitch). (If you are running any
other kind of modded server and have it working with Velocity, let us know!)

If you receive this message but run a Vanilla server,
[please report a bug to the Velocity issue tracker](https://github.com/PaperMC/Velocity/issues/new).

### Read time out while switching to a Forge server

Particularly for some very large mod packs, there is an elevated risk of the connection between the
player and the proxy dropping. There is not much we can do on the proxy end to alleviate this. We
suggest either reducing the number of mods your server uses, or raise the `read-timeout` setting in
`velocity.toml` and add the `-Dfml.readTimeout` startup flag to your Forge server and setting it to
the value (in seconds) you chose for the proxy. For instance, if you determine that 120 seconds is
the best read timeout to use, use `-Dfml.readTimeout=120` and set `read-timeout = 120000` in
`velocity.toml`.

### My forced hosts are not working!

If you are relying on SRV records to direct the player to the proxy, remember that Velocity matches `forced-hosts` using the **hostname the client sends**, which is resolved before the connection — not necessarily the address the player types.

To make `forced-hosts` work with a proxy on a non-default port (e.g. `12345`), use this setup:

Create DNS records:
- **CNAME:** `forced1.example.com → actual.server.address.com`
- **SRV:** `_minecraft._tcp.survival → forced1.example.com` (priority: 0, weight: 0, port: 12345)

In velocity.toml:
```toml
[forced-hosts]
"forced1.example.com" = ["survival"] # survival.example.com
```

Although the player connects via `survival.example.com`, the SRV record points to `forced1.example.com`, and that is what the client sends to Velocity — allowing it to match correctly in `forced-hosts`.

### Plugins unable to modify messages or commands

```
A plugin tried to cancel a signed chat message. This is no longer possible in 1.19.1 and newer. Disconnecting player <player>
```

Starting with Minecraft 1.19.1, Mojang implemented a new chat system that encrypts each message with
the signed key that each player has. Velocity does not yet have full support for cancelling or modifying
this type of messages and commands, so you can install the [SignedVelocity](https://hangar.papermc.io/4drian3d/SignedVelocity) plugin,
which will allow the message or command to be transmitted to your server, which, upon receiving it on the server,
will apply the result computed in Velocity.


---


# Getting started

How to install and set up a minimal configuration of Velocity.

This page covers how to install and set up a minimal configuration of Velocity.

## Installing Java

Velocity is written in Java, so if you do not already have Java installed, you will need to install
it before you continue. Velocity requires at least Java 25.
See our [Java installation guide](/misc/java-install) for detailed instructions.

## Downloading Velocity

Head over to the [downloads](https://papermc.io/downloads/velocity) page to get the latest version
of Velocity. We recommend getting the latest stable version. After downloading Velocity, move the
JAR file to a dedicated folder for just the proxy or upload it to your server.

## Launching Velocity for the first time

Once you have downloaded Velocity, we will launch it for the first time to generate the
configuration file, `velocity.toml`. You can use the start script created to launch Velocity once
you're done configuring Velocity.

### Launching Velocity under Windows

Create a `start.bat` with the following contents in the same directory where you intend to place the
proxy files.

```batch title="start.bat"
@echo off
java -Xms1G -Xmx1G -XX:+UseG1GC -XX:G1HeapRegionSize=4M -XX:+UnlockExperimentalVMOptions -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -XX:MaxInlineLevel=15 -jar velocity.jar
pause
```

:::tip

Make sure to change the `velocity.jar` to the name of the Velocity JAR that you downloaded, or
rename the Velocity JAR to `velocity.jar`.

:::

Once saved, double-click the `start.bat` file. If it worked, you should now receive a console
similar to the output in the next section.

### Launching Velocity under macOS or Linux

Create a `start.sh` with the following contents in the same directory where you intend to place the
proxy files. You may do this using a file transfer client, or using a text editor running on the
host.

```bash title="start.sh"
#!/bin/sh

java -Xms1G -Xmx1G -XX:+UseG1GC -XX:G1HeapRegionSize=4M -XX:+UnlockExperimentalVMOptions -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -XX:MaxInlineLevel=15 -jar velocity*.jar
```

Once you've saved the files, open a terminal (or log into the machine) if you haven't already. Navigate to the directory
where you have placed the Velocity JAR file and the `start.sh` file. Then, you will need to prepare the `start.sh`
script for it to be executable and run it.

1. Run `chmod u+x start.sh`. This command modifies the file's permissions, granting the file's owner (you) the ability to
   execute (`x`) the script. Without this step, the system may not recognize the script as something that can be run.
1. Now that the file is executable, run `./start.sh` to run the script.

## After launch

Here's a sample of what you'll see once we've started the proxy:

```log replace
[05:41:13 INFO]: Booting up Velocity \{LATEST_VELOCITY_RELEASE} (git-74c932e5-b363)...
[05:41:13 INFO]: Loading localizations...
[05:41:13 INFO]: Connections will use epoll channels, libdeflate (Linux aarch64) compression, OpenSSL (Linux aarch64) ciphers
[05:41:13 INFO]: Loading plugins...
[05:41:13 INFO]: Loaded 0 plugins
[05:41:13 INFO]: Listening on /[0:0:0:0:0:0:0:0%0]:25565
[05:41:13 INFO]: Done (0.36s)!
```

Velocity has launched, and you are now ready to configure the proxy completely. Go ahead and type
`end` at the console and press enter. The proxy will shut down:

```log
> end
[05:42:10 INFO]: Shutting down the proxy...
[05:42:10 INFO]: Closing endpoint /0.0.0.0:25565
```

If you used the Windows batch script from earlier, the window will ask you to press a key. You can
either press a key or close the command window.

### Configuring your servers

We now need to configure each server to accept connections from the proxy.

Velocity is a highly configurable proxy. While most users will not need to change everything in the
config, there are tons of options covered
[on the configuration reference page](/velocity/configuration) along with an explanation on
how each option works. However, in this section we will do the bare minimum to get the proxy up and
running.

Open the `velocity.toml` file in a text editor and search for the `[servers]` section. This section
specifies the servers that Velocity can connect to. Here's what the `[servers]` section will look
like initially:

```toml title="velocity.toml"
[servers]
# Configure your servers here. Each key represents the server's name, and the value
# represents the IP address of the server to connect to.
lobby = "127.0.0.1:30066"
factions = "127.0.0.1:30067"
minigames = "127.0.0.1:30068"

# In what order we should try servers when a player logs in or is kicked from a server.
try = [
  "lobby",
  "factions"
]
```

On the left side, you will specify a name for the server (for example, `lobby`) and on right is a
string indicating the IP address and port for the server. You will now need to add your servers to
the list. You can change the list of servers as needed.

The `try` setting is special. It is a list of servers Velocity should try to connect the player to
when the player first logs onto the proxy or gets kicked from a server. If you decided to change the
name of the `lobby` server, then you should replace `lobby` in this list with the name you chose for
the first server the player should log into first.

:::caution

The following setup is generic and is intended to apply to any Minecraft server. This setup is not
only not ergonomic (players will lack skins, proper UUIDs, and all connections will appear to come
from the proxy) but also **dangerously insecure**. After you place your servers in offline mode, you
**must** follow the "Player Information Forwarding" and "Securing Your Servers" topics to complete
your setup.

:::

Open the `server.properties` file for each of your servers and set the `online-mode` setting to
`false`. This allows Velocity to connect to your server. Once you're done, restart your server.
While Velocity is now ready for use, you will almost certainly want to
[secure your servers](/velocity/security) and
[configure player information forwarding](/velocity/player-information-forwarding).


---


# Migration guide

How to migrate your proxy between different Velocity versions.

New to Velocity, or upgrading to a new version of Velocity? This page will briefly explore what you
need to be aware of for a successful migration.

## Migrating from Velocity 1.0.x to Velocity 1.1.0

Moving from Velocity 1.0.x to Velocity 1.1.0 should be as simple as just replacing the Velocity JAR
and restarting the proxy. You may want to back up your `velocity.toml` and then delete the current
`velocity.toml` and let Velocity regenerate it to add the new settings that Velocity 1.1.0
introduces.


---


# Configuring player information forwarding

How to configure information forwarding on Velocity.

Velocity supports forwarding information about your players to your servers, such as IP addresses,
UUIDs and skins. Velocity supports three forwarding formats:

- **Velocity modern forwarding** is a custom forwarding format (modern forwarding) that is more
  secure.
- **BungeeCord forwarding** (also known as _legacy forwarding_) which has better compatibility but
  is less secure.
- **BungeeGuard**, which is the same as BungeeCord forwarding but includes a secret key. It is
  better than BungeeCord forwarding alone, but it is less ideal than Velocity modern forwarding.

:::note

You may choose between only one of these forwarding formats. It is not currently possible to "mix
and match" forwarding modes or use all the forwarding formats together. In general, if you are
supporting clients using Minecraft 1.13 and newer only, use Velocity modern forwarding, else you
must use BungeeCord forwarding.

:::

## Configuring modern forwarding

`modern` forwarding is a Velocity-native format. It forwards all player information in an efficient
binary format and employs a MAC code to make it much more difficult to trick the server into
impersonating your Velocity proxy. However, it is only available for Minecraft 1.13 or higher.

:::caution

Modern forwarding is incompatible with Minecraft versions below 1.13 and the
ProtocolSupport plugin. If you use any of these, you will need to use legacy BungeeCord-compatible
forwarding instead.

:::

To use modern forwarding with any supported server implementation, set the `player-info-forwarding-mode`
setting in `velocity.toml` to `modern`. Then, you need to ensure your server is properly configured
to use Velocity forwarding.

### Configuring modern forwarding for Paper

Paper 1.14+ and above, along with Paper 1.13.1/1.13.2 build 377 and above support Velocity modern
forwarding natively.

First, you need to disable the `online-mode` setting in the [`server.properties`](/paper/reference/server-properties#online_mode) file. This prevents
the server from authenticating players, which the proxy will do instead.

You also need to disable BungeeCord forwarding if you had it enabled beforehand. Make sure
`settings.bungeecord` is set to `false` in your `spigot.yml`.

In `config/paper-global.yml`, set `proxies.velocity.enabled` to true and
`proxies.velocity.secret`, to match the secret in your `forwarding.secret` file. You must also set
`proxies.velocity.online-mode` to match the `online-mode` setting in your `velocity.toml`. Once
you're done editing `paper-global.yml`, reboot your server.

:::note

If you are using Paper 1.18.2 or lower, you will find these options as `settings.velocity-support.enabled`,
`settings.velocity-support.secret` and `settings.velocity-support.online-mode` in the `paper.yml` file.

:::

## Configuring modern forwarding for Fabric

A mod called [FabricProxy-Lite](https://modrinth.com/mod/fabricproxy-lite) allows you to use
Velocity modern forwarding with a modded server using Fabric. For additional compatibility, you may use the [CrossStitch](https://modrinth.com/mod/crossstitch) mod.

## Configuring modern forwarding for Forge

A mod called [ProxyCompatibleForge](https://modrinth.com/mod/proxy-compatible-forge) allows you to use
Velocity modern forwarding with a modded server using Forge 1.14 or higher.

## Configuring legacy BungeeCord-compatible forwarding

:::danger

Legacy forwarding is **fundamentally insecure**. If you must use it, you should understand
[how to secure your server properly](/velocity/security). That page reviews all the possible
options to secure your server so that nothing aside from the proxy can connect to your server.

:::

`legacy` forwarding is the player information forwarding protocol that is used by BungeeCord when
enabling IP forwarding from BungeeCord. Due to this, it is ubiquitous and well-supported by most
server implementations. It has excellent compatibility (supporting versions as old as 1.7.2,
released in 2013) and will work with Forge if you also install SpongeForge/BungeeForge on your modded server and
configure it correctly. However, it is not secure.

If you must use BungeeCord-compatible forwarding, simply set your `player-info-forwarding-mode` setting
in `velocity.toml` to `legacy`. You will also need to make sure your server can accept the forwarded
player data sent by Velocity.

To add some security, particularly for proxies hosted on shared hosting, Velocity optionally
supports the [BungeeGuard](https://www.spigotmc.org/resources/bungeeguard.79601/) plugin. To use it,
set the `player-info-forwarding-mode` setting in `velocity.toml` to `bungeeguard`, then add the value in
the `forwarding.secret` file to the token section in the BungeeGuard configuration.

### Configuring legacy forwarding for Spigot / Paper

To make Spigot or Paper understand the data forwarded from Velocity, set `settings.bungeecord` to
`true` in your `spigot.yml` and then reboot your server.

### Configuring legacy forwarding for Sponge

To configure Sponge to understand the data forwarded from Velocity, you will need to stop the server
first, set `modules.bungeecord` to `true` and `bungeecord.ip-forwarding` to `true` in your
`config/sponge/global.conf` file, and then restart your Sponge server.

### Configuring legacy forwarding for Forge

To configure Forge to understand the data forwarded from Velocity, you will need to stop the server
first, download your correct [BungeeForge](https://github.com/caunt/BungeeForge/releases) version and place the mod into the mods folder, and then restart your Forge server.

### Configuring legacy forwarding for Fabric

:::caution

There are no longer any actively supported mods that support legacy forwarding. Please use Velocity
modern forwarding instead.

:::


---


# System properties

Documentation for the system properties and environment variables Velocity may check.

These system properties and environment variables can be set when you start your server allowing for the configuration of various settings.

:::danger[Danger Ahead]

Setting flags for the JVM can alter how it operates and the same goes for the Velocity server.
If you are unsure about what a flag does, it is recommended that you **do not use it**.

:::

## How they work

System properties are set when you start your server. For example, if you are using a `.bat` or a `.sh` file to start your server, you can add the system properties to
the file. For example:

```bash
java -Dvelocity.packet-decode-logging=true -jar velocity.jar
```

:::note

Some of Velocity's system properties contain a `.` character in their name. When using PowerShell, these will require wrapping in quotes.
i.e. `"-Dvelocity.packet-decode-logging=true"`

:::

Where a `-D` is used to set a system property, and the system property is `velocity.packet-decode-logging` with a value of `true`.
Otherwise, just add them to the start command.

:::note

The default value shown may not be set for the property but will only be used by Velocity if it is not explicitly set.

:::

## List of system properties

#### auth.forceSecureProfiles

- **default**: `true`
- **description**: Overrides `force-key-authentication` from the config. If not set, it will be automatically set to the current config value.

#### mojang.sessionserver

- **default**: `https://sessionserver.mojang.com/session/minecraft/hasJoined`
- **description**: Full URL of the `hasJoined` endpoint on the session server used for authentication.

#### velocity.natives-tmpdir

- **default**: `unset`
- **description**: Temporary directory for Velocity native files. (If set, it will also define `io.netty.native.workdir`)

#### velocity.max-known-packs

- **default**: `64`
- **description**: Limits known packs to the Vanilla default to prevent crashing Velocity.

#### velocity.max-clientside-plugin-channels

- **default**: `1024`
- **description**: Limits the plugin messaging channels registered by the client, as both Velocity and the backend servers need to keep track of them.

#### velocity.max-packets-per-flush

- **default**: `8192`
- **description**: The max amount of packets before the queue is flushed automatically.

#### velocity.log-server-backpressure

- **default**: `false`
- **description**: Whether Velocity should log if the server connection is writable and thus if the player connection will be auto-read.

#### velocity.packet-decode-logging

- **default**: `false`
- **description**: Whether packet decoding errors should be logged extensively.

#### velocity.skip-uncompressed-packet-size-validation

- **default**: `false`
- **description**: Whether to skip the validation of uncompressed packet sizes, this is useful to allow modded setups to send uncompressed packets over the threshold.

#### velocity.increased-compression-cap

- **default**: `false`
- **description**: Whether the maximum uncompressed packet size should be set to its maximum supported limit (128 MiB) instead of the Vanilla limit (8 MiB).

#### velocity.disable-native-transport

- **default**: `false`
- **description**: Whether to disable Netty's native transport methods like the io_uring support and Epoll. If set to true, Velocity will use Java's NIO transport instead.

#### velocity.enable-iouring-transport

- **default**: `false`
- **description**: Enables Netty's io_uring transport when set to true. By default, Velocity only uses the Epoll (on Linux) and kqueue (on macOS) native transports. This property does not override the `velocity.disable-native-transport` property.

#### velocity.natives-disabled

- **default**: `false`
- **description**: Whether native functionality for specific operating systems should be disabled.

#### velocity.legacyChatMaxServerboundLength

- **default**: `100`
- **description**: Overrides the max chat input length for versions below 1.11. This is useful for mods that backport the modern chat limit of `256`.

#### velocity.strictErrorHandling

- **default**: `true`
- **description**: Whether the client should disconnect on packet errors. Temporarily added in MC 1.20.5 and removed in 1.21.2 to help modded servers transition to this change.

#### velocity.maximum-play-queue-size

- **default**: `134217728` (128 MiB)
- **description**: The maximum size of the queue (in bytes) that holds pending PLAY state packets sent to the client while it is in the CONFIG state.

#### velocity.max-plugin-message-payload-size
- **default**: `32767`
- **description**: The maximum allowed size of plugin message packets in bytes.

## List of environment variables

#### VELOCITY_FORWARDING_SECRET

- **default**: `unset`
- **description**: Overrides the forwarding secret inside the [`forwarding-secret-file`](/velocity/configuration#root-section).


---


# Securing your servers

An explanation of how to secure your servers.

It is vital that you secure your backend servers. As part of setting up Velocity, you will put your
server into offline mode, which means in theory, someone could impersonate any player on your
server. This is extremely dangerous, so it is important to make sure only the proxy can connect to
your servers.

This guide will explore the various options for securing your backend servers so only your proxy can
connect to them. Note that this is an _exploration_ of options, aiming to review the various options
and give you advantages and disadvantages to them, so you can make an informed decision.

This list is not in any particular order, and almost all of these methods can be combined as needed.

## Operating system firewalls

When properly configured, using the firewall facilities provided by your server's operating system
is a highly effective way to protect your servers. The Velocity project **strongly recommends the
use of a firewall**.

Instructions for your operating system may vary. Solutions for major server OSes include:

- Windows: Windows Firewall
- Linux: iptables, nftables

**Advantages**:

- Fool-proof if you do not give untrusted servers access to your servers
- Does not require any extra Minecraft server configuration
- Part of good system hardening advice for any operating system

**Disadvantages**:

- Tricky first-time setup
- May be difficult to use with multiple proxies
- Firewall configuration must be kept in sync with new servers and proxies
- Not viable on a shared host

## Velocity modern forwarding

If your server only supports Minecraft 1.13 and above, Velocity's modern forwarding can forward
player information to your servers and provide a second layer of protection against someone trying
to impersonate as your proxy.

:::caution

Velocity modern forwarding is not a replacement for a firewall. We strongly recommend using a
firewall with any Minecraft proxy setup.

:::

**Advantages**:

- Get player info forwarding for free
- Secure on a shared host, provided the host has implemented proper protections
- Works if you host your server on multiple physical servers

**Disadvantages**:

- Only works for Minecraft 1.13 and above
- Requires Paper 1.13 or above, or FabricProxy-Lite if you use Fabric
- Relies on the forwarding secret being kept secret

## Binding to `localhost`

If you are hosting your proxy on the same physical computer as your other servers (and nobody else
is hosting servers on them), binding your servers to `localhost` is a very simple way of protecting
them from getting connected to by anything other than the proxy.

For each server, open the `server.properties` file. Find the line that starts with `server-ip` and
change the line to `server-ip=127.0.0.1`. Save the file and restart the server.

Afterwards, open your `velocity.toml` file and ensure all the servers are pointing to
`127.0.0.1:<port>`.

**Advantages**:

- Trivial setup compared to other methods discussed
- Fool-proof if you do not give untrusted users access to your server

**Disadvantages**:

- Setup must be reversed (and an alternate method used) if you move any of the servers to a
  different physical server ( such that the proxy and the server are not on the same physical
  server)
- Not viable on a shared host

## Using an encrypted tunnel

This is a variation of binding to `localhost`, but instead of hosting all your servers on a single
physical server, you will set up an encrypted tunnel between each of your servers, and make sure the
server only listens for incoming connections from the tunnel. There are many different solutions,
ranging from VPN solutions such as [WireGuard](https://www.wireguard.com),
[OpenVPN](https://openvpn.net/), and [tinc](https://www.tinc-vpn.org/) to encrypted tunnels such as
[spiped](https://www.tarsnap.com/spiped.html). This guide will not go into details of how to set up
each of these solutions.

**Advantages**:

- Encrypts traffic between your proxy and your servers while ensuring only authorized clients can
  connect to your servers

**Disadvantages**:

- Very complex setup
- Impossible to use on a shared host

## IP whitelisting plugins

As a last line of defense, you can choose to restrict logins to users on an IP whitelist using a
plugin like [IPWhitelist](https://www.spigotmc.org/resources/ipwhitelist.61/).

**Advantages**:

- May be your only solution if none of the other solutions will work (especially on a shared host)

**Disadvantages**:

- Vulnerable to attack if the attacker can get a server on the same node as your proxy is on

## Other important security advice

This common-sense general advice goes without saying:

- Keep frequent backups of your server
- Set up a firewall on your server
- Run your servers as an unprivileged user (this means no `sudo` access or running as `root` for
  Linux users!)
- Update Velocity, your Minecraft server and server plugins, and your server's operating system
  frequently
- Use strong passwords
- Carefully think about the potential impacts of installing any plugins or software before actually
  doing so
- Secure any and all other services you may be running on your server
- Follow all system hardening advice for your operating system

We will not provide a full treatment to the advice given above, so please do some research of your
own. Your setup will vary - there is no "one size fits all" advice we can give other than these
general guidelines.


---


# Server compatibility

A guide to the server compatibility for Velocity.

import { LATEST_MC_RELEASE } from "/src/utils/versions";

Velocity is compatible with many Minecraft server implementations. The expectation is that if the
server acts like Vanilla, Velocity will work, and we make special provisions for modded setups where
we can.

## Compatible game versions

As of this writing, Velocity is compatible with Minecraft 1.7.2 through {LATEST_MC_RELEASE}.

## Vanilla setups

Velocity is best-tested with implementations derived from the Vanilla server by Mojang that do not
add content to the game itself.

### Vanilla servers

The Mojang Vanilla software is in a complicated position. It is useful as we often produce protocol
updates using the Mojang server for testing, but in production setups, the lack of player info
forwarding support can induce subtle client problems.

If you plan to run a Vanilla server, **the Velocity team strongly recommends that you use Fabric
with the FabricProxy-Lite mod**. Fabric and FabricProxy-Lite do not by themselves change the Vanilla
experience, and your server will remain compatible with Vanilla clients. If you are unable (or
unwilling) to run Fabric, [VanillaCord](https://github.com/ME1312/VanillaCord) allows you to use
legacy BungeeCord forwarding.

### Spigot

Spigot is not well-tested with Velocity. However, it is based on Vanilla and as it is the base for
Paper, it is relatively well-supported.

Spigot does not support Velocity's modern forwarding, but does support legacy BungeeCord forwarding.

### Paper

The Velocity project recommends using Paper for running a public server. Velocity works with all
versions of Paper from 1.7.10 to the latest version.

You can use Velocity's modern forwarding if you run Paper 1.13.2 or higher. If you use Paper 1.12.2
or lower, you must use legacy BungeeCord-style forwarding.

### SpongeVanilla

SpongeVanilla is compatible with legacy BungeeCord-style and modern forwarding. Our Sponge support largely
focuses on Forge compatibility, see below for more information.

## Modded setups

### Fabric

Velocity works with Fabric out of the box, but you should add support for player info forwarding
using a mod like [FabricProxy-Lite](https://modrinth.com/mod/fabricproxy-lite) (which supports
Velocity modern forwarding).

In addition, if you intend to run mods that add new content on top of Vanilla, you should install
[CrossStitch](https://modrinth.com/mod/crossstitch), which improves support for certain Minecraft
features that are extended by mods, such as custom argument types. This mod is officially maintained
by the Velocity project.

### Minecraft Forge (1.13 and above)

Velocity as of version 3.3.0 supports Forge servers of versions higher than 1.20.2.
Support for intermediate versions between 1.13 and 1.20.1 is not planned, however,
you can use the [Ambassador](https://modrinth.com/plugin/ambassador) plugin to support these versions.

To add modern forwarding support to Forge, you must install the [ProxyCompatibleForge](https://modrinth.com/mod/proxy-compatible-forge)
or [SpongeForge](https://spongepowered.org/downloads/spongeforge) mod corresponding to your server version.
*Note that SpongeForge is currently in an experimental phase of its Forge support for 1.20.4 versions*.

### Minecraft Forge (1.7.2-1.12.2)

Minecraft Forge for Minecraft 1.7.2-1.12.2 is fully compatible with Velocity, as we make special
provisions to synchronize client state with each server. However, we **strongly** recommend the use
of SpongeForge or BungeeForge, as it allows you to use legacy BungeeCord player info forwarding and generally
improves proxy support in general.

Velocity does not support Forge-Bukkit hybrids - they have caused several issues, and the design of
the Bukkit API precludes any notion of sane mod support.

## Proxy-behind-proxy (BungeeCord, Velocity, ...)

These setups are _completely unsupported_. You are best advised to avoid them, as they can cause
lots of issues. Most proxy-behind-proxy setups are either illogical in the first place or can be
handled more gracefully by better, more scalable and performant solutions.

## Other implementations

This is, naturally, not an exhaustive list. Alternative implementations of the Minecraft protocol
may or may not work. We encourage you to experiment and to contribute back with your results.


---


# Tuning Velocity

How to tune Velocity to allow for even better performance.

Velocity comes with good performance out of the box. We go in deep, starting from smart algorithmic
choices, making strategic usage of native libraries, all the way to the JVM level, optimizing the
proxy so that the JVM will make better decisions when optimizing the code.

## Host the proxy on Linux

Velocity comes with high-performance, specially tuned native libraries for compression and
encryption, along with including native transports from Netty. However, due to support constraints,
the compiled natives are only verified to work on Linux x86_64 and aarch64. While Velocity does not
require the natives to work, you will suffer from degraded performance. For this reason, we strongly
recommend that all production deployments of Velocity run on x86_64 Linux.

## Allocate server resources appropriately

You should always make sure to allocate the correct amount of heap, network bandwidth, and get the
right CPU for the amount of players you want to have on your proxy at a given time. For instance, it
is unlikely you'll be able to get 1,000 players on a Raspberry Pi Zero, but you'll have a much
better chance if you have a recent high-end server CPU from Intel or AMD.

There is no "one-size-fits-all" hardware recommendation, only general guidelines for the amount of
players you can expect:

- Prefer lots of cores but lower clock speeds. Unlike the Minecraft server, Velocity can actually
  benefit from the extra cores and single-threaded performance is not as important.
- You should always have enough memory to run Velocity, including room for JVM overhead and for your
  operating system. For a rough minimum recommended memory amount, double the size of the proxy heap
  and then add 2GB. For instance, for a proxy with a 2GB heap, plan on getting at least 6GB of
  memory.
- Disk speed is unimportant. A solid-state drive is nice to have but not strictly required.
  Likewise, disk capacity is unimportant as well.

### Special notes regarding speculative execution security vulnerabilities

Starting in 2018, a number of security vulnerabilities with regard to
[speculative execution](https://en.wikipedia.org/wiki/Speculative_execution) used by modern CPUs
have been discovered.

The mitigations to these vulnerabilities can have painful performance implications, especially on
processors vulnerable to Meltdown and further compounded if running in a virtual machine. Velocity,
as a network application, is particularly sensitive to the performance hits that the mitigations
introduce.

To minimize these hits, we recommend hosting your proxy on a machine with a CPU that has mitigations
against Spectre and Meltdown. Processors released in 2019 and onwards typically contain mitigations
to protect against Spectre and Meltdown.

If you are using a CPU vulnerable to Spectre and/or Meltdown and are willing to risk security for
performance, it is also possible to disable Spectre/Meltdown mitigations depending on the operating
system you use. Note however that you disable these security mitigations _at your own risk_. The
Velocity project does not recommend that you disable these mitigations.

## Allocate enough heap

Alongside having enough CPU, memory, and network bandwidth, you must also allocate enough Java heap
to the proxy. Not doing this can induce lag and in severe cases may result in the proxy being
terminated by the Java Virtual Machine because it ran out of memory.

The general rule of thumb is that you allocate 512MB per 500 players, plus some extra to allow for
some room for error (typically 1GB extra). For instance, if you want to handle 1,000 on a single
proxy, plan to allocate 2GB of heap.

### Special notes for containers

**If you use a containerized setup (such as using Kubernetes, Pterodactyl, or Docker directly), you
should not allocate the entirety of your memory allocation to the heap!** Doing so _will_ likely
cause the proxy to be killed by the kernel's out-of-memory killer, which will result in your proxy
going down, likely at the worst possible time.

A safe (albeit conservative) setting for the heap would be to allocate half of the memory you
allocate to the proxy container in total. For instance, if you know the proxy will need to hold
1,000 players, then allocate 4GB to the container and give the proxy 2GB of heap.

## Tune your startup flags

We also recommend tuning your startup flags. The current recommendation is:

```
-XX:+UseG1GC -XX:G1HeapRegionSize=4M -XX:+UnlockExperimentalVMOptions -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -XX:MaxInlineLevel=15
```

You will add these flags after the `java` command but before the `-jar` parameter.

### Explanation of the flags

Most of these flags focus on tuning the G1 garbage collector to be more friendly to Velocity's
workload. One of these flags (`-XX:MaxInlineLevel=15`) tends to improve performance in general.

Before the release of Java 9, the default Java garbage collector was the Parallel GC. This is a
stop-the-world collector that does its work in parallel. The problem is that its pause times tend to
be long, and are not suitable for Minecraft (often showing up as seemingly unexplainable lag
spikes).

The recommended garbage collector for Velocity is the G1 region-based collector. There are several
reasons for us to recommend G1:

- It strikes the right balance between throughput and pause times. Throughput is roughly how much
  work the proxy can achieve.
- It is compatible with most setups (it is available in Java 8, the earliest Java version we
  support).

Setups using these flags tend have very low (less than 10 millisecond) GC pauses every few minutes,
which is very good for Minecraft.

### Other configurations

:::caution

Deviating from the configuration we recommend is done solely at your own risk.

:::

Velocity is an application that tends to follow the generational hypothesis quite closely. It has
also been tuned to reduce load on the garbage collector as much as possible.

#### ZGC

ZGC (the Z Garbage Collector), introduced with Java 11 and stabilized with Java 15, has proven to be
successful for one large-scale deployment of Velocity.

At its core, ZGC is a concurrent, generation-less garbage collector emphasizing low latency at the
expense of throughput. Given the nature of Velocity as a network proxy where low throughput and high
throughput are important, we recommend using ZGC with caution, and only if you use Java 15 or above.

The primary tuning flag for ZGC is heap size - if ZGC cannot collect garbage faster than the proxy
can allocate it, the threads generating garbage will be temporarily paused, causing the proxy to
appear to be laggy. Our heap size recommendations still apply, but prepare to give the proxy more
memory if necessary.

#### Shenandoah

Introduced in Java 11 and declared stable in Java 15, Shenandoah is similar to G1 in being a
concurrent, generational garbage collector, but it does more work in parallel.

The Velocity team is not aware of any successful deployments of Shenandoah with Velocity in the
wild.

#### OpenJ9

OpenJ9 is an alternative to the HotSpot JVM derived from IBM's J9 JVM, focused primarily on cloud
workloads. As a result, it behaves very differently from HotSpot. Correspondingly, it has a
completely different set of garbage collectors.

The default `gencon` garbage collector should work fine with Velocity.


---


# What does Velocity do for me?

An explanation for why you should run Velocity.

We believe that Velocity is one of the best proxies for _Minecraft_ around, and there's not much
that can top it. However, we do diverge from more established, mainstream solutions in some
important ways. That can make Velocity a bit hard to sell. We are frequently asked "why?" so often.
This page is our answer to that question.

## Strong experience

The founder and primary developer of Velocity (Tux) has been active in developing proxy software for
_Minecraft: Java Edition_ since 2013. They created the RedisBungee plugin, contributed to BungeeCord
from 2014 to 2017, and also founded the Waterfall project and led it from 2016 to 2017. In fact, the
current maintainer of Waterfall helped encourage them to start a brand-new proxy from the ground up!

## Leading performance

Velocity powers several highly-populated Minecraft networks, while using fewer resources than the
competition. The recipe to the sauce is simple.

### No entity ID rewriting

When a Minecraft client connects to another Minecraft server, the server will send back an ID that
uniquely identifies a specific player connection. This ID is used in packets that target the player
that the server may send. But what happens when they're actually connected to a proxy that has the
ability to change what server the player is connected to?

Other proxy solutions try to solve this problem by rewriting entity IDs that reference the current
player, changing it from the entity ID assigned by the server the player is currently connected to,
to the entity ID that the player got when they connected to the first server they connected to
through the proxy. This approach is often complicated, leads to bugs, reduces performance, breaks
mods, and ultimately cannot be a complete solution.

However, the Minecraft client actually supports changing its entity ID with a special packet
sequence. Velocity takes advantage of this and forces the client to change its entity ID. This
approach improves performance, improves mod compatibility, and reduces issues caused by incomplete
entity ID rewrites.

### Going deep

Velocity goes deeper than optimizing the handling of the Minecraft protocol. Smart handling of the
protocol produces incredible performance gains but for more performance, we need to go much deeper.

One way in which we drastically improve performance and throughput is by improving the speed of
compressing packets to be sent to the client. On supported platforms (Linux x86_64 and aarch64),
Velocity is able to replace the zlib library ( which implements the compression algorithm used by
the Minecraft protocol) with [libdeflate](https://github.com/ebiggers/libdeflate) which is twice as
fast as zlib while delivering a similar compression ratio.

Velocity also employs several tricks to get the JIT (just-in-time) compiler on our side. Those
tricks require deep understanding of how Java works, but we put in the work to apply those tricks
which translate to increased performance.

### Internal stability policies

Finally, Velocity does not attempt to maintain a stable internal API between minor and major
releases. This allows Velocity to be more flexible and still deliver performance improvements and
new features with each release. For instance, Velocity 1.1.0 delivered massive performance
improvements and added many significant new features by breaking parts of the internal API while
still keeping full compatibility with older plugins. Compare to BungeeCord which is often very
conservative about API breaks and when it does so, provides little notice of the break, and even
when doing a break, does not take the opportunity to seriously improve the API being broken (for
instance, adding RGB support to `ChatColor`).

### Control is in your hands

We take pride in tuning Velocity to be the most performant proxy, but in case the speed provided
out-of-the-box is not good enough, you can easily tweak several performance-related settings in
`velocity.toml`.

## Improved security

Velocity also features more security features, some of which are unique to Velocity. We proactively
foreclose as many denial-of-service attacks as soon as possible and feature a unique player info
forwarding system for Minecraft 1.13+ that requires the server and proxy to know a pre-arranged key.

## Standards and mod support

Unlike certain platforms which only provide lip service to the modding community (and can be at time
hostile to them), Velocity embraces the richness of the platform Minecraft provides. As just a small
example, we have a Fabric mod that
[helps bridge the gap between Velocity itself and mods that extend the Minecraft protocol](https://www.curseforge.com/minecraft/mc-mods/crossstitch)
and feature full Forge support for 1.7 through 1.12.2 and 1.20.2 or higher. Velocity also supports emerging
standard libraries in the community such as the [Adventure](https://github.com/PaperMC/adventure) library.
We collaborate with the Minecraft modding community.
