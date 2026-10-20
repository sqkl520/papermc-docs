
# Bukkit

The Bukkit Adventure implementation.

import Dependency from "/src/components/Dependency.astro";
import { LATEST_ADVENTURE_PLATFORM_BUKKIT_SUPPORTED_MC, LATEST_ADVENTURE_PLATFORM_RELEASE } from "/src/utils/versions";

The Adventure platform implementation for Bukkit targets Paper, Spigot, and Bukkit for
Minecraft 1.7.10 through {LATEST_ADVENTURE_PLATFORM_BUKKIT_SUPPORTED_MC}.

:::danger

Adventure platform implementation for Bukkit/Spigot and the Minecraft/Bungeecord component serializers are no longer maintained.
The Adventure team no longer provides support for using these libraries.

We recommend that users of these libraries update to modern software that [natively supports Adventure](/adventure/platform/native) (e.g., [Paper](/paper)).

:::

Declaring the dependency:

<Dependency group="net.kyori" name="adventure-platform-bukkit" version={LATEST_ADVENTURE_PLATFORM_RELEASE} />

## Usage

You should first obtain a `BukkitAudiences` object by using `BukkitAudiences.create(plugin)`. This object is thread-safe
and can be reused from different threads if needed. From here, Bukkit `CommandSender`s and `Player`s may be converted into
`Audience`s using the appropriate methods on `BukkitAudiences`.

The audiences object should also be closed when a plugin is disabled in order to clean up resources and increase the likelihood of a successful `/reload`.

```java title="MyPlugin.java"
public class MyPlugin extends JavaPlugin {

    private BukkitAudiences adventure;

    public BukkitAudiences adventure() {
        if (this.adventure == null) {
            throw new IllegalStateException("Tried to access Adventure when the plugin was disabled!");
        }
        return this.adventure;
    }

    @Override
    public void onEnable() {
        // Initialize an audiences instance for the plugin
        this.adventure = BukkitAudiences.create(this);
        // then do any other initialization
    }

    @Override
    public void onDisable() {
        if (this.adventure != null) {
            this.adventure.close();
            this.adventure = null;
        }
    }
}
```

This audience provider should be used over the serializers directly, since it will handle compatibility measures for sending messages across versions.

## Component serializers

For areas that aren't covered by the `Audience` interface, the Bukkit platform provides the `MinecraftComponentSerializer`
(available on CraftBukkit-based servers), and the `BungeeComponentSerializer` (available on Spigot and Paper servers)
to convert directly between Adventure [Components](/adventure/text) and other component types. For uses that don't integrate
directly with native types, JSON and legacy format serializers for the running server version are exposed in `BukkitComponentSerializer`.


---


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


# Folia Documentation

import { CardGrid, LinkCard } from "@astrojs/starlight/components";

Folia is a fork of Paper which adds regionized multithreading to the dedicated server.

<CardGrid>
  <LinkCard
    title="Administration"
    description="Information and tutorials regarding the administration of a Folia server."
    href="/folia/admin"
  />
</CardGrid>


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


# Downloads Service

Paper provides a downloads service that you can use to access builds.

PaperMC provides a downloads service to facilitate automated downloads access. Full documentation can be
found on the [Downloads Service Docs](https://fill.papermc.io/swagger-ui/index.html#/).

:::danger

We emphatically **do not recommend** using unstable builds or auto-updaters within production environments.

:::

All requests must now include a valid User-Agent header that:
- Clearly identifies your software or company
- Is not generic (e.g. curl, wget, or similar defaults)
- Includes a contact URL or email address (e.g. a homepage, bot info page, or support email)

**Some examples:**
```
mc-image-helper/1.39.11 (https://github.com/itzg/docker-minecraft-server)
nodecraft/packifier/1.0.0 (staff@nodecraft.com)
```

## REST API examples

:::note

We require `jq` to be installed for the examples below. You can install it with `sudo apt-get install jq` on Debian/Ubuntu.

:::

### Getting the latest version

```shell
#!/usr/bin/env sh

PROJECT="paper"
USER_AGENT="cool-project/1.0.0 (contact@me.com)"

LATEST_VERSION=$(curl -s -H "User-Agent: $USER_AGENT" https://fill.papermc.io/v3/projects/${PROJECT} | \
    jq -r '.versions | to_entries[0] | .value[0]')

echo "Latest version is $LATEST_VERSION"
```

This will get the latest available Minecraft version for the given project.

### Getting the latest stable build number

```shell replace
#!/usr/bin/env sh

PROJECT="paper"
MINECRAFT_VERSION="\{LATEST_PAPER_RELEASE}"
USER_AGENT="cool-project/1.0.0 (contact@me.com)"

LATEST_BUILD=$(curl -s -H "User-Agent: $USER_AGENT" https://fill.papermc.io/v3/projects/${PROJECT}/versions/${MINECRAFT_VERSION}/builds | \
  jq -r 'map(select(.channel == "STABLE")) | .[0] | .id')

if [ "$LATEST_BUILD" != "null" ]; then
  echo "Latest stable build is $LATEST_BUILD"
else
  echo "No stable build for version $MINECRAFT_VERSION found :("
fi
```

This will get the latest stable build for the given project and Minecraft version, if it's available.

### Downloading the latest stable build

```shell replace
#!/usr/bin/env sh

PROJECT="paper"
MINECRAFT_VERSION="\{LATEST_PAPER_RELEASE}"
USER_AGENT="cool-project/1.0.0 (contact@me.com)"

# First check if the requested version has a stable build
BUILDS_RESPONSE=$(curl -s -H "User-Agent: $USER_AGENT" https://fill.papermc.io/v3/projects/${PROJECT}/versions/${MINECRAFT_VERSION}/builds)

# Check if the API returned an error
if echo "$BUILDS_RESPONSE" | jq -e '.ok == false' > /dev/null 2>&1; then
  ERROR_MSG=$(echo "$BUILDS_RESPONSE" | jq -r '.message // "Unknown error"')
  echo "Error: $ERROR_MSG"
  exit 1
fi

# Try to get a stable build URL for the requested version
PAPERMC_URL=$(echo "$BUILDS_RESPONSE" | jq -r 'first(.[] | select(.channel == "STABLE") | .downloads."server:default".url) // "null"')
FOUND_VERSION="$MINECRAFT_VERSION"

# If no stable build for requested version, find the latest version with a stable build
if [ "$PAPERMC_URL" == "null" ]; then
  echo "No stable build for version $MINECRAFT_VERSION, searching for latest version with stable build..."

  # Get all versions for the project (using the same endpoint structure as the "Getting the latest version" example)
  # The versions are organized by version group, so we need to extract all versions from all groups
  # Then sort them properly as semantic versions (newest first)
  VERSIONS=$(curl -s -H "User-Agent: $USER_AGENT" https://fill.papermc.io/v3/projects/${PROJECT} | \
    jq -r '.versions | to_entries[] | .value[]' | \
    sort -V -r)

  # Iterate through versions to find one with a stable build
  for VERSION in $VERSIONS; do
    VERSION_BUILDS=$(curl -s -H "User-Agent: $USER_AGENT" https://fill.papermc.io/v3/projects/${PROJECT}/versions/${VERSION}/builds)

    # Check if this version has a stable build
    STABLE_URL=$(echo "$VERSION_BUILDS" | jq -r 'first(.[] | select(.channel == "STABLE") | .downloads."server:default".url) // "null"')

    if [ "$STABLE_URL" != "null" ]; then
      PAPERMC_URL="$STABLE_URL"
      FOUND_VERSION="$VERSION"
      echo "Found stable build for version $VERSION"
      break
    fi
  done
fi

if [ "$PAPERMC_URL" != "null" ]; then
  # Download the latest Paper version
  curl -o server.jar $PAPERMC_URL
  echo "Download completed (version: $FOUND_VERSION)"
else
  echo "No stable builds available for any version :("
  exit 1
fi
```

This is the most common use case for the API. It will download the latest stable build for the given project and
Minecraft version. You should always serve & use the stable builds. Experimental builds are prone to error and
do not receive support.

## GraphQL API examples

Fill also supports a GraphQL API, which can be accessed at `https://fill.papermc.io/graphql`.
Fill's GraphQL API uses standard pagination, which you can learn more about [here](https://graphql.org/learn/pagination/).

A built-in GraphQL playground is available at https://fill.papermc.io/graphiql?path=/graphql.
Common API tools such as Postman will introspect the API and provide a UI for building queries.

### Getting the latest version
```graphql
query LatestVersion {
    project(key: "paper") {
        key
        versions(first: 1, orderBy: {direction: DESC}) {
            edges {
                node {
                    key
                }
            }
        }
    }
}
```

<details>
<summary>Example response</summary>

```json
{
    "data": {
        "project": {
            "key": "paper",
            "versions": {
                "edges": [
                    {
                        "node": {
                            "key": "1.21.11"
                        }
                    }
                ]
            }
        }
    }
}
```

</details>

### Getting the latest stable build number
```graphql
query LatestStableBuild {
    project(key: "paper") {
        key
        versions(first: 1, orderBy: {direction: DESC}) {
            edges {
                node {
                    key
                    builds(filterBy: { channel: STABLE }, first: 1, orderBy: { direction: DESC }) {
                        edges {
                            node {
                                number
                            }
                        }
                    }
                }
            }
        }
    }
}
```

<details>
<summary>Example response</summary>

```json
{
    "data": {
        "project": {
            "key": "paper",
            "versions": {
                "edges": [
                    {
                        "node": {
                            "key": "1.21.10",
                            "builds": {
                                "edges": [
                                    {
                                        "node": {
                                            "number": 48
                                        }
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
    }
}
```

</details>

### Getting the latest stable build download URL
```graphql
query LatestStableBuildDownloadURL {
    project(key: "paper") {
        key
        versions(first: 1, orderBy: {direction: DESC}) {
            edges {
                node {
                    key
                    builds(filterBy: { channel: STABLE }, first: 1, orderBy: { direction: DESC }) {
                        edges {
                            node {
                                number
                                download(key: "server:default") {
                                    name
                                    url
                                    checksums {
                                        sha256
                                    }
                                    size
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

<details>
<summary>Example response</summary>

```json
{
    "data": {
        "project": {
            "key": "paper",
            "versions": {
                "edges": [
                    {
                        "node": {
                            "key": "1.21.10",
                            "builds": {
                                "edges": [
                                    {
                                        "node": {
                                            "number": 48,
                                            "download": {
                                                "name": "paper-1.21.10-48.jar",
                                                "url": "https://fill-data.papermc.io/v1/objects/bfca155b4a6b45644bfc1766f4e02a83c736e45fcc060e8788c71d6e7b3d56f6/paper-1.21.10-48.jar",
                                                "checksums": {
                                                    "sha256": "bfca155b4a6b45644bfc1766f4e02a83c736e45fcc060e8788c71d6e7b3d56f6"
                                                },
                                                "size": 54185955
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
    }
}
```

</details>


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


# Item command converter

A tool to update commands from the old NBT-based item format to item components.

import ItemCommandConverter from "/src/components/tools/ItemCommandConverter.svelte";

In 1.20.5, Mojang has moved from unstructured NBT to the so-called item components. While Minecraft
will automatically update all existing items for you, only Paper will update commands and text
components containing items where possible. This tool helps you convert old item commands to the
new format externally.

Note that you need to select the *Entity Argument* mode if you want to convert entity data outside of
the summon command, as we require the entity type to convert data correctly.

<br />

<ItemCommandConverter client:load />


---


# Paper Documentation

import { CardGrid, LinkCard } from "@astrojs/starlight/components";

Paper is a Minecraft: Java Edition game server, designed to greatly improve performance and offer more advanced features and API.

<CardGrid>
  <LinkCard
    title="Administration"
    description="Information and tutorials regarding the administration of a Paper server."
    href="/paper/admin"
  />
  <LinkCard
    title="Development"
    description="Information and tutorials for developers on how to create and expand on Paper plugins."
    href="/paper/dev"
  />
  <LinkCard
    title="Contributing"
    description="Information and tutorials for developers wishing to contribute to the Paper project."
    href="/paper/contributing"
  />
</CardGrid>


---


# Adding plugins

Plugins are the most powerful way to extend the functionality of Paper beyond the configuration files.

Plugins are the most powerful way to extend the functionality of Paper beyond the configuration
files. Functionality added by plugins can range from making milk restore hunger or dead bushes grow,
to adding entirely new and original game modes or items.

:::danger[Malicious Plugins]

Ensure you fully trust the source of any plugin before installing it. Plugins are given **full and
unrestricted** access to not only your server but also the machine that it runs on. Because of this,
it is imperative that plugins only be installed from trusted sources. Be careful!

:::

## Finding plugins

Before installing a plugin, you'll need to find what you want to install. The best place to find
plugins is [Hangar](https://hangar.papermc.io), Paper's plugin repository, but you can also find
plugins on [Modrinth](https://modrinth.com/discover/plugins?g=categories:paper) or
[BukkitDev](https://dev.bukkit.org/bukkit-plugins). Many plugins may release on [GitHub](https://github.com).
Instead of checking each site directly, you can also use a search engine. Searching for the function you
desire, followed by `Paper plugin` will often yield good results.

## Installing plugins

1. Once you've found the plugin you'd like to install, download it. Ensure the file you have
   downloaded ends in `.jar`. Some plugins also distribute as `.zip` files, in which case you will
   need to extract the file and locate the `.jar` for your platform, often labeled `bukkit` or
   `paper`.
2. Once you have the plugin downloaded locally, locate the `plugins` folder from the root directory
   of your Paper server.
3. Drag and drop the plugin file (`.jar`) into the `plugins` folder. If you are using a shared
   hosting service, you may need to use their web panel or SFTP to upload the plugin; however, the
   procedure will be the same.
4. Restart your server. The plugin should load.
5. Check your work. Once the server has finished loading, run the `/plugins` command in-game or type
   `plugins` into the console. You should see your freshly installed plugin listed in green. If it
   is not listed or is colored red, continue to [troubleshooting](#troubleshooting). A plugin listed
   in red means that it is not currently enabled. For a freshly installed plugin, this often means
   that the plugin failed to load.

## Troubleshooting

### Check your logs

The first step to troubleshooting installing plugins is to check the log of your server. Your
server's most recent logs will be stored to the `logs/latest.log` file. You may need to scroll near
the beginning of this file to see when plugins were loaded.

#### Missing dependencies

If you see something like this:

```log
[00:00:00] [Server thread/WARN] Could not load 'plugins/MyAwesomePlugin-1.0.0.jar' in folder 'plugins'
[00:00:00] [Server thread/WARN] org.bukkit.plugin.UnknownDependencyException: Unknown/missing dependency plugins: [Vault]. Please download and install these plugins to run 'MyAwesomePlugin'.
```

This means that the plugin you tried to install is missing a dependency. A dependency, in this case,
is another plugin that you must install for the first to function. While you will get a big scary
error, the important line to look at is:

```log
[00:00:00] [Server thread/WARN] Unknown/missing dependency plugins: [Vault]. Please download and install these plugins to run 'MyAwesomePlugin'.
```

This is telling you that in order to load `MyAwesomePlugin`, you must first install `Vault`.

#### Invalid `plugin.yml`

If you see something closer to this:

```log
[00:00:00] [Server thread/WARN] Could not load 'plugins/MyAwesomePlugin-1.0.0.jar' in folder 'plugins'
[00:00:00] [Server thread/WARN] org.bukkit.plugin.InvalidDescriptionException: Invalid plugin.yml
```

This means that what you have downloaded isn't a valid Paper plugin. This is generally caused by one
of the following:

1. The plugin you downloaded isn't a plugin at all, but instead a mod for Forge, Fabric, or similar.
   These will not run on Paper.
2. The plugin failed to download completely. Especially when using tools such as `curl` or `wget`,
   you can easily download error pages rather than the plugin you intended. This may also be caused
   by a network issue. Attempt to download the plugin again. If you are using FTP (not SFTP or a web
   panel) to upload your plugin to a shared hosting service, ensure your FTP client is in `binary`
   and not `ASCII` mode. Consult the documentation for your FTP client for details.

#### Ambiguous plugin name

If you see something like this:

```log
[00:00:00] [Server thread/WARN] Ambiguous plugin name `Essentials' for files `plugins/EssentialsX-2.19.4.jar' and `plugins/Essentialsx-2.20.0-dev.jar' in `plugins'
```

This means you have two plugins with the same name, which is not supported. In this case, two
versions of EssentialsX are installed. Both the release `2.19.4`, and a development build of
`2.20.0`. Ensure you only have one version of each plugin installed at one time. Delete the older
version of the duplicate plugin, and restart your server.

To prevent accidentally installing two versions of one plugin while updating, you can use
the `update` folder as described in the [Update Guide](/paper/updating#step-2-update-plugins).

#### Something else

If you see an error, but it isn't similar to one of the above, attempt to read it yourself. While
the full error may be large and scary, you likely only have to read the first one or two lines to
understand what is going on. If you're not sure, do not hesitate to reach out for support on our
[Discord](https://discord.gg/papermc) in the `#paper-help` channel.

### If nothing is logged

If nothing is logged, your server is likely not attempting to load any plugins. The conditions
needed for the server to load a plugin are as follows:

1. The file is at the root of the `plugins` folder, relative to its working directory. This is
   usually the same folder as the server JAR file. **Subdirectories of the `plugins` folder will not
   be checked.** All plugins must be in the root folder.
2. The file ends in `.jar`. If your plugin does not end in `.jar`, what you have downloaded may not
   be a plugin. Note that some plugins distribute multiple JARs as `.zip` files. If this is the
   case, you have to extract them before installing the plugin.

If both of these are true, and you still see no logs, please reach out for support on our
[Discord](https://discord.gg/papermc) server in the `#paper-help` channel. We will be happy to
assist you.


---


# Administration

import PageCards from "/src/components/PageCards.astro";

Welcome to the Paper administration guide! This guide includes information and tutorials
regarding the administration of a Paper server.

#### Getting started

<PageCards path="src/content/docs/paper/admin/getting-started/index.mdx" />

#### How-to guides

<PageCards path="src/content/docs/paper/admin/how-to/index.mdx" />

#### Reference

<PageCards path="src/content/docs/paper/admin/reference/index.mdx" />

#### Miscellaneous

<PageCards path="src/content/docs/paper/admin/misc/index.mdx" />


---


# Getting started

import PageCards from "/src/components/PageCards.astro";

Guides for getting started with running a Paper server.

<PageCards />


---


# How-to guides

import PageCards from "/src/components/PageCards.astro";

How-to guides for setting up specific features of Paper and managing the server.

<PageCards />


---


# Miscellaneous

import PageCards from "/src/components/PageCards.astro";

Miscellaneous documentation pertaining to Paper.

<PageCards />


---


# Reference

import PageCards from "/src/components/PageCards.astro";

Reference of Paper's configuration options, system properties and other features.

<PageCards />


---


# Aikar's flags

Aikar's flags are a set of JVM flags designed to improve the performance of your Paper server.

## Recommended JVM startup flags

:::caution[Script Generator]

**This page only serves as an explanation page.** If you want to generate a start script, please visit
our **[Script Generator](/misc/tools/start-script-gen)**.

:::

```bash
java -Xms10G -Xmx10G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar paper.jar --nogui
```

:::danger[Do not allocate all of your available memory on a shared host!]

When setting the `Xms` and `Xmx` values, if your host says you have 8GB of memory, **do not use 8GB**!

Minecraft (and Java) needs additional memory on top of that `Xmx` parameter. It is recommended to
**reduce your `Xmx` and `Xms` by about 1000-1500MB** to avoid running out of memory or `OOMKiller` killing
your server. This also leaves room for the operating system to use memory too.

Do you have 8GB of memory? Use 6500MB for safety.
_But you may also ask your host if they will cover this overhead for you and
give you 9500M instead. Some hosts will! Just ask._

:::

## Recommended memory

**We recommend using at least 6-10GB**, no matter how few players! If you can't afford 10GB of
memory, give as much as you can, but ensure you leave the operating system some memory too. G1GC
operates better with more memory.

However, more memory does not mean better performance above a certain point. Eventually you will hit
a point of diminishing returns. Going out and getting 32GB of RAM for a server will only waste your
money with minimal returns.

## Java GC logging

Are you having old gen issues with these flags? Add the following flags based on your Java version
to enable GC logging:

**Java 8-10**

```bash
-Xloggc:gc.log -verbose:gc -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps
-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=5 -XX:GCLogFileSize=1M
```

**Java 11+**

```bash
-Xlog:gc*:logs/gc.log:time,uptime:filecount=5,filesize=1M
```

GC logging does not hurt your performance and can be left on at all times. The files will not take
up much space (5MB)

## Technical explanation of the flags

1.  **-Xms matching -Xmx - why:** You should never run your server with the case that `Xmx` can run
    the system completely out of memory. Your server should always be expected to use the entire
    `Xmx`! You should then ensure the OS has extra memory on top of that `Xmx` for non-Minecraft/OS level
    things. Therefore, you should never run Minecraft with `Xmx` settings you can't support if Java uses it
    all. Now, that means **if `Xms` is lower than `Xmx` you have unused memory**! Unused memory is
    wasted memory. G1 operates better with the more memory it's given. G1 adaptively chooses how
    much memory to give to each region to optimize pause time. If you have more memory than it needs
    to reach an optimal pause time, G1 will simply push that extra into the old generation, and it
    will not hurt you. The fundamental idea of improving GC behavior is to ensure short-lived objects
    die young and never get promoted. With the more memory G1 has, the better assurance you will get
    that objects are not getting prematurely promoted to the old generation. G1 operates differently
    than previous collectors and is able to handle larger heaps more efficiently.

    If it does not need the memory given to it, it will not use it. The entire engine operates
    differently and does not suffer from too large of heaps, and this is industry-wide accepted
    information that under G1 to keep Xms and Xmx the same!

2.  **UnlockExperimentalVMOptions:** needed for some the below options

3.  **G1NewSizePercent:** These are the important ones. You now can specify percentages of an
    overall desired range for the new generation. With these settings, we tell G1 to not use its
    default 5% for new gen, and instead give it 40%! **Minecraft has an extremely high memory
    allocation rate**, ranging to at least 800MB/second on a 30 player server! And this is
    mostly short-lived objects (Block Position).

    Now, this means Minecraft **really** needs more focus on new gen to be able to even support this
    allocation rate. If your new gen is too small, you will be running new gen collections 1-2+
    times per second, which is awful. You will have so many pauses that TPS has risk of suffering,
    and the server will not be able to keep up with the cost of GCs. Then combine the fact that
    objects will now promote faster, resulting in your old gen growing faster. Given more new gen,
    we are able to slow down the intervals of young gen collections, resulting in more time for
    short-lived objects to die young and overall more efficient GC behavior.

4.  **G1MixedGCLiveThresholdPercent:** Controls when to include regions in mixed GCs in the young
    GC collection, keeping old gen tidy without doing a normal old gen GC collection. When your
    memory is less than this percent, old gen won't even be included in 'mixed' collections. Mixed
    are not as heavy as a full old collection, so having small incremental cleanups of old keeps
    memory usage light.

    Default is 65 to 85 depending on the Java version, we are setting that to 90 to ensure we reclaim garbage
    in old gen as fast as possible to retain as much free regions as we can.

5.  **G1ReservePercent=20:** Minecraft memory allocation rate in up-to-date versions is really insane. We
    run the risk of a dreaded "to-space exhaustion" not having enough memory free to move data
    around. This ensures more memory is waiting to be used for this operation. Default is 10, so we
    are giving another 10 to it.

6.  **MaxTenuringThreshold=1:** Minecraft has a really high allocation rate of memory. Of that
    memory, most is reclaimed in the eden generation. However, transient data will overflow into
    survivor. Initially played with completely removing survivor and had decent results, but does
    result in transient data making its way to old which is not good. Max Tenuring 1 ensures that we
    do not promote transient data to old generation, but anything that survives 2 passes of GC is
    just going to be assumed as longer-lived.

    Doing this greatly reduces pause times in young collections as copying data up to 15 times in
    survivor space for a tenured object really takes a lot of time for actually old memory. Ideally
    the GC engine would track average age for objects instead and tenure out data faster, but that
    is not how it works.

    Considering average GC rate is 10s to the upwards of minutes per young collection, this does not
    result in any 'garbage' being promoted, and just delays longer lived memory to be collected in
    mixed GCs.

7.  **SurvivorRatio=32:** Because we drastically reduced MaxTenuringThreshold, we will be reducing
    use of survivor space drastically. This frees up more regions to be used by eden instead.

8.  **AlwaysPreTouch:** AlwaysPreTouch gets the memory setup and reserved at process start ensuring
    it is contiguous, improving the efficiency of it more. This improves the operating systems
    memory access speed. Mandatory to use Transparent Huge Pages

9.  **+DisableExplicitGC:** Many plugins think they know how to control memory, and try to invoke
    garbage collection. Plugins that do this trigger a full garbage collection, triggering a massive
    lag spike. This flag disables plugins from trying to do this, protecting you from their bad
    code.

10. **MaxGCPauseMillis=200:** This setting controls how much memory is used in between the minimum
    and maximum ranges specified for your new generation. This is a "goal" for how long you want
    your server to pause for collections. 200 is aiming for at most loss of 4 ticks. This will
    result in a short TPS drop, however the server can make up for this drop instantly, meaning it
    will have no meaningful impact on your TPS. 200ms is lower than players can recognize. In
    testing, having this value constrained to an even lower number results in G1 not recollecting
    memory fast enough and potentially running out of old gen triggering a full collection. Just
    because this number is 200 does not mean every collection will be 200. It means it can use up to
    200 if it really needs it, and we need to let it do its job when there is memory to collect.

11. **+ParallelRefProcEnabled:** Optimizes the GC process to use multiple threads for weak reference
    checking. Not sure why this isn't default...

12. **G1RSetUpdatingPauseTimePercent=5:** Default is 10% of time spent during pause updating RSets,
    reduce this to 5% to make more of it concurrent to reduce pause durations.

13. **G1MixedGCCountTarget=4:** Default is 8. Because we are aiming to collect slower, with less old
    gen usage, try to reclaim old gen memory faster to avoid running out of old.

14. **G1HeapRegionSize=8M+:** Default is auto calculated. Super important for Minecraft, especially
    1.15, as with low memory situations, the default calculation will in most times be too low. Any
    memory allocation half of this size (4MB) will be treated as "Humongous" and promote straight to
    old generation and is harder to free. If you allow Java to use the default, you will be
    destroyed with a significant chunk of your memory getting treated as Humongous.

15. **+PerfDisableSharedMem:** Causes GC to write to file system which can cause major latency if
    disk IO is high - see https://www.evanjones.ca/jvm-mmap-pause.html

### Transparent huge pages

Controversial feature but may be usable if you cannot configure your host for real HugeTLBFS. Try
adding `-XX:+UseTransparentHugePages` but it's extremely important you also have `AlwaysPreTouch` set.
Otherwise, THP will likely hurt you. We have not measured how THP works for Minecraft or its impact with
`AlwaysPreTouch`, so this section is for the advanced users who want to experiment.


---


# Configuring Anti-Xray

Paper ships an obfuscation-based Anti-Xray system by default. Learn how to configure it here.

> Originally written and maintained by [stonar96](https://github.com/stonar96).

Paper includes an obfuscation-based Anti-Xray with three modes, configurable on a per world basis.

:::note[Per World Configuration]

If you aren't already familiar with per world configuration, please take a moment to familiarize
yourself with the [Configuration Guide](/paper/reference/configuration).

:::

This guide is a step-by-step walk-through for configuring Anti-Xray. For reference documentation,
refer to the Anti-Xray section of the
[Per-World Configuration Reference](/paper/reference/world-configuration#anticheat_anti_xray).

Anti-Xray has three different modes. `engine-mode: 1` replaces specified blocks (`hidden-blocks`) with
other "fake" blocks, `stone` (`deepslate` at y < 0), `netherrack`, or `end_stone` based on the
dimension. In contrast, `engine-mode: 2` will replace both `hidden-blocks` and `replacement-blocks`
with randomly generated `hidden-blocks`. `engine-mode: 3` works similarly to `engine-mode: 2`, but instead of
randomizing every block, it randomizes the block for each layer of a chunk.

The following images[^1] show how each mode will look for a player using Xray with the recommended
configuration in both the overworld and nether.

[^1]:
    Image design by `Oberfail`, initially posted in the
    [PaperMC Discord](https://discord.gg/papermc).

{/*

Seed: -7943468717341609647

# Overworld:
/tp @p -581.976 67.85076 -4924.106 47 36

# Nether:
/tp @p 789.437 117.38012 -319.064 -137.4 28
*/}

![Overworld Anti-Xray Comparison](assets/anti-xray-overworld.png)
![Nether Anti-Xray Comparison](assets/anti-xray-nether.png)

Especially on the client side, `engine-mode: 1` is much less computationally intensive, while
`engine-mode: 2` may better prevent Xray. With `engine-mode: 1`, only ores that are entirely covered
by solid blocks will be hidden. Ores exposed to air in caves or water from a lake will not be
hidden. With `engine-mode: 2`, fake ores obstruct the view of real blocks. If `air` is added to
`hidden-blocks`, `engine-mode: 2` will effectively hide all ores, even those exposed to air. `engine-mode: 3` can reduce network load when joining by a factor of ~2 and helps with chunk packet compression.

:::caution[Anti-Xray Bypasses]

**Range Extension**: While Anti-Xray alone will prevent the majority of users from Xraying on your
server, it is not by any means infallible. Because of how Anti-Xray is (and has to be) implemented,
it is possible to, on a default server, extend the range of real ores you can see by a not
insignificant amount. This can be mitigated by any competent anti-cheat plugin; however, this is not
included out of the box.

**Seed Reversing**: Another attack vector is the deterministic nature of Minecraft's world
generation. If the client is able to obtain the world seed, it is able to know the real location of
every generated ore, completely bypassing Anti-Xray. This can be partially worked around by making
it harder for the client to reverse the world seed with the
[`feature-seeds` configuration](/paper/reference/world-configuration#feature_seeds), in conjunction
with the structure seed options in `spigot.yml`. Note that this is not a complete solution, and it
may still be possible for a client to obtain the server's world seed. Using a different seed for
each world may also be beneficial.

**Ores Exposed to Air**: In `engine-mode: 1`, `engine-mode: 2` and `engine-mode: 3`, it is possible for a client
to view ores that are exposed to air. This can be mitigated in `engine-mode: 2` and `engine-mode: 3` by adding `air` to
the `hidden-blocks` list. However, doing this may cause client performance issues (FPS drops) for
some players.

:::

## Recommended configuration

The recommended configuration for `engine-mode: 1`, `engine-mode: 2` and `engine-mode: 3` is as follows:

:::tip[Spacing]

YAML cares about whitespace! The example configuration below is already formatted correctly. Ensure
formatting and indentation remains unchanged by using the "copy" button in the top right of each
example. Especially ensure that no tabulators are accidentally inserted. Check your editor's options
for using spaces instead of tabulators for indentation. If your configuration file already contains
other important changes, it is recommended to make a backup before editing it.

:::

### `engine-mode: 1`

<details>
  <summary>Default World Configuration</summary>

Replace the existing `anticheat.anti-xray` block in `paper-world-defaults.yml` with the following:

```yaml title="paper-world-defaults.yml"
anticheat:
  anti-xray:
    enabled: true
    engine-mode: 1
    hidden-blocks:
    # There's no chance to hide dungeon chests as they are entirely surrounded by air, but buried treasures will be hidden.
    - chest
    - coal_ore
    - deepslate_coal_ore
    - copper_ore
    - deepslate_copper_ore
    - raw_copper_block
    - diamond_ore
    - deepslate_diamond_ore
    - emerald_ore
    - deepslate_emerald_ore
    - gold_ore
    - deepslate_gold_ore
    - iron_ore
    - deepslate_iron_ore
    - raw_iron_block
    - lapis_ore
    - deepslate_lapis_ore
    - redstone_ore
    - deepslate_redstone_ore
    lava-obscures: false
    # As of 1.18 some ores are generated much higher.
    # Please adjust the max-block-height setting at your own discretion.
    # https://minecraft.wiki/w/Ore might be helpful.
    max-block-height: 64
    # The replacement-blocks list is not used in engine-mode: 1. Changing this will have no effect.
    replacement-blocks: []
    update-radius: 2
    use-permission: false
```

</details>

<details>
  <summary>Nether Configuration</summary>

Copy and paste into your `paper-world.yml` within your nether world folder. See the
[Configuration Guide](/paper/reference/configuration) for more information.

```yml title="world/dimensions/minecraft/the_nether/paper-world.yml"
anticheat:
  anti-xray:
    enabled: true
    engine-mode: 1
    hidden-blocks:
    - ancient_debris
    - nether_gold_ore
    - nether_quartz_ore
    lava-obscures: false
    max-block-height: 128
    # The replacement-blocks list is not used in engine-mode: 1. Changing this will have no effect.
    replacement-blocks: []
    update-radius: 2
    use-permission: false
```

</details>

<details>
  <summary>End Configuration</summary>

Copy and paste into your `paper-world.yml` within your end world folder. See the
[Configuration Guide](/paper/reference/configuration) for more information.

```yml title="world/dimensions/minecraft/the_end/paper-world.yml"
anticheat:
  anti-xray:
    enabled: false
```

</details>

### `engine-mode: 2`

<details>
  <summary>Default World Configuration</summary>

Replace the existing `anticheat.anti-xray` block in `paper-world-defaults.yml` with the following:

```yaml title="paper-world-defaults.yml"
anticheat:
  anti-xray:
    enabled: true
    engine-mode: 2
    hidden-blocks:
    # You can add air here such that many holes are generated.
    # This works well against cave finders but may cause client FPS drops for all players.
    - air
    - copper_ore
    - deepslate_copper_ore
    - raw_copper_block
    - diamond_ore
    - deepslate_diamond_ore
    - gold_ore
    - deepslate_gold_ore
    - iron_ore
    - deepslate_iron_ore
    - raw_iron_block
    - lapis_ore
    - deepslate_lapis_ore
    - redstone_ore
    - deepslate_redstone_ore
    lava-obscures: false
    # As of 1.18 some ores are generated much higher.
    # Please adjust the max-block-height setting at your own discretion.
    # https://minecraft.wiki/w/Ore might be helpful.
    max-block-height: 64
    replacement-blocks:
    # Chest is a tile entity and can't be added to hidden-blocks in engine-mode: 2.
    # But adding chest here will hide buried treasures, if max-block-height is increased.
    - chest
    - amethyst_block
    - andesite
    - budding_amethyst
    - calcite
    - coal_ore
    - deepslate_coal_ore
    - deepslate
    - diorite
    - dirt
    - emerald_ore
    - deepslate_emerald_ore
    - granite
    - gravel
    - oak_planks
    - smooth_basalt
    - stone
    - tuff
    update-radius: 2
    use-permission: false
```

</details>

<details>
  <summary>Nether Configuration</summary>

Copy and paste into your `paper-world.yml` within your nether world folder. See the
[Configuration Guide](/paper/reference/configuration) for more information.

```yml title="world/dimensions/minecraft/the_nether/paper-world.yml"
anticheat:
  anti-xray:
    enabled: true
    engine-mode: 2
    hidden-blocks:
    # See note about air and possible client performance issues above.
    - air
    - ancient_debris
    - bone_block
    - glowstone
    - magma_block
    - nether_bricks
    - nether_gold_ore
    - nether_quartz_ore
    - polished_blackstone_bricks
    lava-obscures: false
    max-block-height: 128
    replacement-blocks:
    - basalt
    - blackstone
    - gravel
    - netherrack
    - soul_sand
    - soul_soil
    update-radius: 2
    use-permission: false

```

</details>

<details>
  <summary>End Configuration</summary>

Copy and paste into your `paper-world.yml` within your end world folder. See the
[Configuration Guide](/paper/reference/configuration) for more information.

```yml title="world/dimensions/minecraft/the_end/paper-world.yml"
anticheat:
  anti-xray:
    enabled: false
```
</details>

### `engine-mode: 3`

<details>
  <summary>Default World Configuration</summary>

Replace the existing `anticheat.anti-xray` block in `paper-world-defaults.yml` with the following:

```yaml title="paper-world-defaults.yml"
anticheat:
  anti-xray:
    enabled: true
    engine-mode: 3
    hidden-blocks:
    # You can add air here such that many holes are generated.
    # This works well against cave finders but may cause client FPS drops for all players.
    - air
    - copper_ore
    - deepslate_copper_ore
    - raw_copper_block
    - diamond_ore
    - deepslate_diamond_ore
    - gold_ore
    - deepslate_gold_ore
    - iron_ore
    - deepslate_iron_ore
    - raw_iron_block
    - lapis_ore
    - deepslate_lapis_ore
    - redstone_ore
    - deepslate_redstone_ore
    lava-obscures: false
    # As of 1.18 some ores are generated much higher.
    # Please adjust the max-block-height setting at your own discretion.
    # https://minecraft.wiki/w/Ore might be helpful.
    max-block-height: 64
    replacement-blocks:
    # Chest is a tile entity and can't be added to hidden-blocks in engine-mode: 2.
    # But adding chest here will hide buried treasures, if max-block-height is increased.
    - chest
    - amethyst_block
    - andesite
    - budding_amethyst
    - calcite
    - coal_ore
    - deepslate_coal_ore
    - deepslate
    - diorite
    - dirt
    - emerald_ore
    - deepslate_emerald_ore
    - granite
    - gravel
    - oak_planks
    - smooth_basalt
    - stone
    - tuff
    update-radius: 2
    use-permission: false
```

</details>

<details>
  <summary>Nether Configuration</summary>

Copy and paste into your `paper-world.yml` within your nether world folder. See the
[Configuration Guide](/paper/reference/configuration) for more information.

```yml title="world/dimensions/minecraft/the_nether/paper-world.yml"
anticheat:
  anti-xray:
    enabled: true
    engine-mode: 3
    hidden-blocks:
    # See note about air and possible client performance issues above.
    - air
    - ancient_debris
    - bone_block
    - glowstone
    - magma_block
    - nether_bricks
    - nether_gold_ore
    - nether_quartz_ore
    - polished_blackstone_bricks
    lava-obscures: false
    max-block-height: 128
    replacement-blocks:
    - basalt
    - blackstone
    - gravel
    - netherrack
    - soul_sand
    - soul_soil
    update-radius: 2
    use-permission: false
```

</details>

<details>
  <summary>End Configuration</summary>

Copy and paste into your `paper-world.yml` within your end world folder. See the
[Configuration Guide](/paper/reference/configuration) for more information.

```yml title="world/dimensions/minecraft/the_end/paper-world.yml"
anticheat:
  anti-xray:
    enabled: false
```

</details>

## FAQ, common pitfalls and support

<details>
  <summary>I can still see (some) ores / use X-ray</summary>

As described above, there are several reasons why you might still see (some) ores even though you
have enabled Anti-Xray:

* The ores are above the configured `max-block-height` value.
* Anti-Xray cannot hide ores exposed to air or other transparent blocks (in caves for example). In
  principle this is also the case for `engine-mode: 2` and `engine-mode: 3`, however, usually the fake ores obstruct the
  view of real blocks. Hiding those exposed ores too requires additional plugins.
* The `use-permission` option is enabled and you have the Anti-Xray bypass permission (`paper.antixray.bypass`) or you have
  operator status.
* The block type is missing in the configured block lists. This can be the result of using an
  outdated configuration file.

</details>

<details>
  <summary>I have added fake blocks but X-ray doesn't show them</summary>

If you use `engine-mode: 2` or `engine-mode: 3` and you have added fake blocks to the `hidden-blocks` list but you can't
see them in-game using X-ray, this can have the following reasons:

* The added block types are tile entities. Anti-Xray can hide (replace) tile entities (such as
  chests), provided that they are not exposed to air or other transparent blocks. However, Anti-Xray
  can't place tile entities as fake blocks into the chunk.
* The block is disabled in your client's X-ray mod or not shown by your X-ray resource pack.

</details>

<details>
  <summary>It doesn't work below y = 0 or in certain other places.</summary>

* Your configuration file is probably outdated and missing important blocks in the
  `replacement-blocks` list, such as `deepslate` or biome-specific blocks, such as `basalt`. You
  might also want to check if the `hidden-blocks` list includes all important ores and their
  `deepslate` variants.
* If it doesn't work above a certain y-level, check your `max-block-height` setting.

</details>

<details>
  <summary>It still doesn't work, further troubleshooting</summary>

* Make sure to always restart your server after making changes to the Anti-Xray configuration.
  Changes won't be applied automatically.
* Do not use the `/reload` command. To apply Anti-Xray configuration changes a restart is required.
* After restarting the server, verify that the configuration is applied correctly by inspecting the
  config sections with timings or spark.

</details>

<details>
  <summary>How and where do I ask for support if it still doesn't work?</summary>

If the above bullet points don't solve your problem or if you have further questions about
Anti-Xray, please don't hesitate to ask us on the [PaperMC Discord](https://discord.gg/papermc)
using the #paper-help channel. Please try to provide as much detail as possible about your problem.
"It doesn't work" isn't very helpful when asking for support. Describe what you want to achieve,
what you have tried, what you expect and what you observe. Ideally include a timings or spark link
and a picture what you observe in-game.

</details>


---


# Contributing

import PageCards from "/src/components/PageCards.astro";

Welcome to the Paper contributing guide! This guide includes information and tutorials for developers
wishing to contribute to the Paper project.

<PageCards />


---


# Events

A guide on how to add new events to Paper.

There are several requirements for events in the Paper API.

:::note

Note that while not all existing events may follow these
guidelines, all new and modified events should adhere to them.

:::

All new events should go in the package (sub-package of) `io.papermc.paper.event`.

### Constructors

All new constructors added should be annotated with
[`@ApiStatus.Internal`](https://javadoc.io/doc/org.jetbrains/annotations/latest/org/jetbrains/annotations/ApiStatus.Internal.html)
to signify that they are not considered API and can change at any time without warning.

Constructors that are being replaced, if they aren't being removed, should be marked with
[`@Deprecated`](jd:java:java.lang.Deprecated) and [`@DoNotUse`](jd:paper:io.papermc.paper.annotation.DoNotUse).

### Mutability
Certain API types are "mutable" which can lead to unexpected behavior within events. Mutable types like
[](jd:paper:org.bukkit.Location) and [](jd:paper:org.bukkit.util.Vector)
should therefore be cloned when returned from a "getter" in an event.

### `HandlerList`
For an event class or any subclass of it to be listened to, a [`HandlerList`](jd:paper:org.bukkit.event.HandlerList)
field must be present with an instance and static method to retrieve it.
See the docs for [](jd:paper:org.bukkit.event.Event) for specifics.
This field should be static and final and named `HANDLER_LIST`.

Also consider not putting a `HandlerList` on every event, just a "common parent" event so that a plugin can listen to the
parent event and capture any child events but also listen to the child event separately.

### Miscellaneous

* New parameters or method returns of type [](jd:paper:org.bukkit.inventory.ItemStack)
should not be [`@Nullable`](https://javadoc.io/doc/org.jspecify/jspecify/latest/org/jspecify/annotations/Nullable.html)
in most case and instead accept an empty itemStack.


---


# Development

import PageCards from "/src/components/PageCards.astro";

Welcome to the Paper development guide! This guide includes information and tutorials for developers
on how to create and expand on Paper plugins.

#### Getting started

<PageCards path="src/content/docs/paper/dev/getting-started/index.mdx" />

#### API

<PageCards path="src/content/docs/paper/dev/api/index.mdx" />

#### Miscellaneous

<PageCards path="src/content/docs/paper/dev/misc/index.mdx" />


---


# API

import PageCards from "/src/components/PageCards.astro";

Welcome to the Paper API guide!
This guide includes information for developers about how to use specific parts of the Paper API.

<PageCards />


---


# Command API

import PageCards from "/src/components/PageCards.astro";

#### Basics

<PageCards path="src/content/docs/paper/dev/api/command-api/basics/index.mdx" />

#### Arguments

<PageCards path="src/content/docs/paper/dev/api/command-api/arguments/index.mdx" />

#### Miscellaneous

<PageCards path="src/content/docs/paper/dev/api/command-api/misc/index.mdx" />


---


# Chat events

An outline on AsyncChatEvent and how to handle it.

The chat event has evolved a few times over the years.
This guide will explain how to properly use the new [](jd:paper:io.papermc.paper.event.player.AsyncChatEvent)
and its [](jd:paper:io.papermc.paper.chat.ChatRenderer).
The [](jd:paper:io.papermc.paper.event.player.AsyncChatEvent)
is an improved version of the old [](jd:paper:org.bukkit.event.player.AsyncPlayerChatEvent)
that allows you to render chat messages individually for each player.

:::note[`AsyncChatEvent` vs `ChatEvent`]

The key difference between [](jd:paper:io.papermc.paper.event.player.AsyncChatEvent)
and [](jd:paper:io.papermc.paper.event.player.ChatEvent) is that
[](jd:paper:io.papermc.paper.event.player.AsyncChatEvent) is fired asynchronously.

This means that it does not block the main thread and sends the chat message when the listener has completed.
Be aware that using the Bukkit API in an asynchronous context (i.e. the event handler) is unsafe and exceptions may be thrown.
If you need to use the Bukkit API, you can use [](jd:paper:io.papermc.paper.event.player.ChatEvent).
However, we recommend using [`BukkitScheduler`](/paper/dev/scheduler).

:::

## Understanding the renderer

Before we can start using the new chat event, we need to understand how the new renderer works.
The renderer is Paper's way of allowing plugins to modify the chat message before it is sent to the player.
This is done by using the [](jd:paper:io.papermc.paper.chat.ChatRenderer) interface with its
[](jd:paper:io.papermc.paper.chat.ChatRenderer#render(org.bukkit.entity.Player,net.kyori.adventure.text.Component,net.kyori.adventure.text.Component,net.kyori.adventure.audience.Audience))
method. Previously, this was done by using the [](jd:paper:org.bukkit.event.player.AsyncPlayerChatEvent)
with its [](jd:paper:org.bukkit.event.player.AsyncPlayerChatEvent#setFormat(java.lang.String)) method.

```java title="ChatRenderer.java"
Component render(Player source, Component sourceDisplayName, Component message, Audience viewer);
```

- The [`render`](jd:paper:io.papermc.paper.chat.ChatRenderer#render(org.bukkit.entity.Player,net.kyori.adventure.text.Component,net.kyori.adventure.text.Component,net.kyori.adventure.audience.Audience)) method is called when a chat message is sent to the player.
- The `source` parameter is the player that sent the message.
- The `sourceDisplayName` parameter is the display name of the player that sent the message.
- The `message` parameter is the message that was sent.
- The `viewer` parameter is the player that is receiving the message.

:::tip[`ChatRenderer.ViewerUnaware`]

If your renderer does not need to know about the viewer, you can use the
[](jd:paper:io.papermc.paper.chat.ChatRenderer$ViewerUnaware)
interface instead of the [](jd:paper:io.papermc.paper.chat.ChatRenderer) interface.
This will benefit performance as the message will only be rendered once instead of each individual player.

:::

## Using the renderer

There are two ways to use the renderer.
1. Implementing the [](jd:paper:io.papermc.paper.chat.ChatRenderer) interface in a class.
2. Using a lambda expression.

Depending on the complexity of your renderer, you may want to use one or the other.

### Implementing the `ChatRenderer` interface

The first way of using the renderer is by implementing the [](jd:paper:io.papermc.paper.chat.ChatRenderer)
interface in a class. In this example, we will be using our `ChatListener` class.

Next, we need to tell the event to use the renderer by using the
[](jd:paper:io.papermc.paper.event.player.AbstractChatEvent#renderer()) method.

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

:::note

If you decide to create a separate class for your renderer, it is important to know that you don't need to instantiate the class every time the event is called.
In this case, you can use [the singleton pattern](https://en.wikipedia.org/wiki/Singleton_pattern) to create a single instance of the class.

:::

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

Let's say we want to render our chat to look like this:

![](./assets/plain-message-rendering.png)

To do this, we need to return a new [](jd:adventure:net.kyori.adventure.text.Component) that contains the message we want to send.

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

That is all you need to know about the new chat event and its renderer.
Of course there are many more things you can do with components in general.
If you want to learn more about components, you can read the [Component Documentation](/adventure/text/).


---


# Minecraft-specific

Everything regarding the essential Brigadier arguments.

The [Arguments and Literals](/paper/dev/command-api/basics/arguments-and-literals) page covers the most used, native Brigadier arguments. But Minecraft define a few more which Paper wraps around. These can be accessed
in a static context using the [](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes) class. We will go over all of those in this section.

## Quick overview
A quick overview of all possible arguments is defined here:

| Argument Reference                                                                                                                      | Resolved Type                                                                                    |
|-----------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| [`entity()`](/paper/dev/command-api/arguments/entity-player#entity-argument)                                                            | [](jd:paper:org.bukkit.entity.Entity)                                                            |
| [`entities()`](/paper/dev/command-api/arguments/entity-player#entities-argument)                                                        | <code>List<[Entity](jd:paper:org.bukkit.entity.Entity)></code>                                   |
| [`player()`](/paper/dev/command-api/arguments/entity-player#player-argument)                                                            | [](jd:paper:org.bukkit.entity.Player)                                                            |
| [`players()`](/paper/dev/command-api/arguments/entity-player#players-argument)                                                          | <code>List<[Player](jd:paper:org.bukkit.entity.Player)></code>                                   |
| [`playerProfiles()`](/paper/dev/command-api/arguments/entity-player#player-profiles-argument)                                           | <code>Collection<[PlayerProfile](jd:paper:com.destroystokyo.paper.profile.PlayerProfile)></code> |
| [`blockPosition()`](/paper/dev/command-api/arguments/location#block-position-argument)                                                  | [](jd:paper:io.papermc.paper.math.BlockPosition)                                                 |
| [`columnBlockPosition()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#columnBlockPosition())                     | [](jd:paper:io.papermc.paper.command.brigadier.argument.position.ColumnBlockPosition)            |
| [`blockInWorldPredicate()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#blockInWorldPredicate())                 | [](jd:paper:io.papermc.paper.command.brigadier.argument.predicate.BlockInWorldPredicate)         |
| [`finePosition(boolean centerIntegers)`](/paper/dev/command-api/arguments/location#fine-position-argument)                              | [](jd:paper:io.papermc.paper.math.FinePosition)                                                  |
| [`columnFinePosition(boolean centerIntegers)`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#columnFinePosition()) | [](jd:paper:io.papermc.paper.command.brigadier.argument.position.ColumnFinePosition)             |
| [`rotation()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#rotation())                                           | [](jd:paper:io.papermc.paper.math.Rotation)                                                      |
| [`angle()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#angle())                                                 | `float`                                                                                          |
| [`axes()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#axes())                                                   | <code>Set<[Axis](jd:paper:org.bukkit.Axis)></code>                                               |
| [`blockState()`](/paper/dev/command-api/arguments/paper#block-state-argument)                                                           | [](jd:paper:org.bukkit.block.BlockState)                                                         |
| [`itemStack()`](/paper/dev/command-api/arguments/paper#item-argument)                                                                   | [](jd:paper:org.bukkit.inventory.ItemStack)                                                      |
| [`itemPredicate()`](/paper/dev/command-api/arguments/predicate#item-predicate-argument)                                                 | [](jd:paper:io.papermc.paper.command.brigadier.argument.predicate.ItemStackPredicate)            |
| [`namedColor()`](/paper/dev/command-api/arguments/adventure#named-color-argument)                                                       | [](jd:adventure:net.kyori.adventure.text.format.NamedTextColor) (Adventure)                      |
| [`hexColor()`](jd:paper:io.papermc.paper.command.brigadier.argument.ArgumentTypes#hexColor())                                           | [](jd:adventure:net.kyori.adventure.text.format.TextColor) (Adventure)                           |
| [`component()`](/paper/dev/command-api/arguments/adventure#component-argument)                                                          | [](jd:adventure:net.kyori.adventure.text.Component) (Adventure)                                  |
| [`style()`](/paper/dev/command-api/arguments/adventure#adventure-style-argument)                                                        | [](jd:adventure:net.kyori.adventure.text.format.Style) (Adventure)                               |
| [`signedMessage()`](/paper/dev/command-api/arguments/adventure#signed-message-argument)                                                 | [](jd:adventure:net.kyori.adventure.chat.SignedMessage) (Adventure)                              |
| [`scoreboardDisplaySlot()`](/paper/dev/command-api/arguments/enums#scoreboard-display-slot-argument)                                    | [](jd:paper:org.bukkit.scoreboard.DisplaySlot)                                                   |
| [`namespacedKey()`](/paper/dev/command-api/arguments/paper#namespacedkey-argument)                                                      | [](jd:paper:org.bukkit.NamespacedKey)                                                            |
| [`key()`](/paper/dev/command-api/arguments/adventure#key-argument)                                                                      | [](jd:adventure:net.kyori.adventure.key:net.kyori.adventure.key.Key) (Adventure)                 |
| [`integerRange()`](/paper/dev/command-api/arguments/predicate#integer-range-argument)                                                   | `Range<Integer>`                                                                                 |
| [`doubleRange()`](/paper/dev/command-api/arguments/predicate#double-range-argument)                                                     | `Range<Double>`                                                                                  |
| [`world()`](/paper/dev/command-api/arguments/location#world-argument)                                                                   | [](jd:paper:org.bukkit.World)                                                                    |
| [`gameMode()`](/paper/dev/command-api/arguments/enums#gamemode-argument)                                                                | [](jd:paper:org.bukkit.GameMode)                                                                 |
| [`heightMap()`](/paper/dev/command-api/arguments/enums#heightmap-argument)                                                              | [](jd:paper:org.bukkit.HeightMap)                                                                |
| [`uuid()`](/paper/dev/command-api/arguments/paper#uuid-argument)                                                                        | `UUID`                                                                                           |
| [`objectiveCriteria()`](/paper/dev/command-api/arguments/paper#objective-criteria-argument)                                             | [](jd:paper:org.bukkit.scoreboard.Criteria)                                                      |
| [`entityAnchor()`](/paper/dev/command-api/arguments/enums#entity-anchor-argument)                                                       | [](jd:paper:io.papermc.paper.entity.LookAnchor)                                                  |
| [ `time(int minTime)`](/paper/dev/command-api/arguments/paper#time-argument)                                                            | `Integer`                                                                                        |
| [`templateMirror()`](/paper/dev/command-api/arguments/enums#template-mirror-argument)                                                   | [](jd:paper:org.bukkit.block.structure.Mirror)                                                   |
| [`templateRotation()`](/paper/dev/command-api/arguments/enums#template-rotation-argument)                                               | [](jd:paper:org.bukkit.block.structure.StructureRotation)                                        |
| [`resource(RegistryKey<T>)`](/paper/dev/command-api/arguments/registry#resource-argument)                                               | registry element                                                                               |
| [`resourceKey(RegistryKey<T>)`](/paper/dev/command-api/arguments/registry#resource-key-argument)                                        | [](jd:paper:io.papermc.paper.registry.TypedKey) of a registry element                                                                |


---


# Paper-specific

Documentation for arguments handling miscellaneous Paper API values.

import BlockStateMp4 from "./assets/vanilla-arguments/blockstate.mp4?url";
import ItemStackMp4 from "./assets/vanilla-arguments/itemstack.mp4?url";
import NamespacedKeyMp4 from "./assets/vanilla-arguments/namespacedkey.mp4?url";
import TimeMp4 from "./assets/vanilla-arguments/time.mp4?url";
import UuidMp4 from "./assets/vanilla-arguments/uuid.mp4?url";
import ObjectiveCriteriaMp4 from "./assets/vanilla-arguments/objectivecriteria.mp4?url";

import Video from "/src/components/Video.astro";

The arguments in this section return objects frequently used in Paper API.

## Block state argument
The block state argument can be used for getting a block type and explicit, associated data.

### Example usage
```java
Commands.argument("state", ArgumentTypes.blockState())
    .executes(context -> {
        final BlockState state = context.getArgument("state", BlockState.class);
        // will be an unplaced snapshot which needs to be copied in order to be used later

        context.getSource().getSender().sendRichMessage("You specified a <block>!",
            Placeholder.component("block", Component.translatable(state.getType()))
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview
<Video src={BlockStateMp4} />

## Item argument
The item argument is the way to retrieve an [item](jd:paper:org.bukkit.inventory.ItemStack) following the same argument format as the Vanilla `/give <player> <item> [<amount>]`
command as its second argument. The user may also define components to further customize the `ItemStack`. If you only require an item type, you should instead
check out the [registry arguments](/paper/dev/command-api/arguments/registry).

### Example usage
```java
Commands.argument("item", ArgumentTypes.itemStack())
    .executes(context -> {
        final ItemStack item = context.getArgument("item", ItemStack.class);
        final Player player = context.getSource().getPlayerOrThrow();

        player.getInventory().addItem(item);
        context.getSource().getSender().sendRichMessage("<green>Successfully gave <player> a <item>",
            Placeholder.component("player", player.displayName()),
            Placeholder.component("item", Component.translatable(item).hoverEvent(item))
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview
<Video src={ItemStackMp4} />

## NamespacedKey argument
This argument allows the user to provide any artificial (namespaced) key. The return value of this argument is a
[](jd:paper:org.bukkit.NamespacedKey), which makes it useful when dealing with Bukkit API.

### Example usage
```java
Commands.argument("key", ArgumentTypes.namespacedKey())
    .executes(context -> {
        final NamespacedKey key = context.getArgument("key", NamespacedKey.class);

        context.getSource().getSender().sendRichMessage("You put in <aqua><key></aqua>!",
            Placeholder.unparsed("key", key.toString())
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview
<Video src={NamespacedKeyMp4} />

## Time argument
The time argument allows the user to define a time frame, similar to the Vanilla `/time set <time>` time argument. The user has 4 possible ways of inputting time:
* Just as a number: This resolves to as usual ticks (`/timearg 1` --> 1 tick)
* With a `t` suffix: This also resolves to ticks (`/timearg 1t` --> 1 tick)
* With a `s` suffix: This resolves to seconds, meaning multiplying the first number by 20. (`/timearg 1s` --> 20 ticks)
* With a `d` suffix. This resolves as in-game days, meaning multiplying the first number by 24000. (`/timearg 1d` --> 24000 ticks)

If you choose to use this argument, it is advised to explain to the users what these suffixes mean, as real time (`s` suffix) is mixed with in-game time (`t` and `d` suffix).

The `ArgumentTypes.time()` method has one additional overload: `ArgumentTypes.time(int minTime)`. This allows to set the minimum required amount of ticks this argument has to resolve to.
By default this value is set to 0.

### Example usage
```java
Commands.argument("time", ArgumentTypes.time())
    .executes(context -> {
        final int timeInTicks = IntegerArgumentType.getInteger(context, "time");
        final Player player = context.getSource().getPlayerOrThrow();

        player.getWorld().setFullTime(player.getWorld().getFullTime() + timeInTicks);
        player.sendPlainMessage("Moved time forward by " + timeInTicks + " ticks!");
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview
<Video src={TimeMp4} />

## UUID argument
The UUID argument allows the user to input a valid UUID. You can retrieve that value as a `UUID` object, which is used in various places, like `Bukkit.getOfflinePlayer(UUID)`.
This argument is not very user-friendly, which is why it is suggested to only use this as a moderation or debug argument (and at least providing suggestions completion). For user input regarding offline player
retrieval, the [player profiles argument](/paper/dev/command-api/arguments/entity-player#player-profiles-argument) is preferred, as it allows by-name lookup.

### Example usage - Lookup command
```java
Commands.argument("uuid", ArgumentTypes.uuid())
    .executes(context -> {
        final UUID uuid = context.getArgument("uuid", UUID.class);
        final OfflinePlayer result = Bukkit.getOfflinePlayer(uuid);

        context.getSource().getSender().sendRichMessage("Has <aqua><uuid></aqua> played before: <result:'<green>true</green>':'<red>false</red>'>",
            Placeholder.unparsed("uuid", uuid.toString()),
            Formatter.booleanChoice("result", result.hasPlayedBefore())
        );

        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview
<Video src={UuidMp4} />

## Objective criteria argument
You can retrieve the argument value as a `Criteria`, which can be used with `Scoreboard` objects.

### Example usage
```java
Commands.argument("criteria", ArgumentTypes.objectiveCriteria())
    .executes(context -> {
        final Criteria criteria = context.getArgument("criteria", Criteria.class);

        context.getSource().getSender().sendRichMessage("Default render type for <criteria>: <render_type>",
            Placeholder.unparsed("criteria", criteria.getName()),
            Placeholder.unparsed("render_type", criteria.getDefaultRenderType().name())
        );
        return Command.SINGLE_SUCCESS;
    })
```

### In-game preview
<Video src={ObjectiveCriteriaMp4} />


---


# Arguments and literals

An extensive guide to command arguments and literals.

:::note

In the [command tree docs](/paper/dev/command-api/basics/command-tree) we have looked at the structure of Brigadier commands and how to build up a command tree.
If you haven't finished reading that yet, we strongly recommend doing that before reading about arguments and literals.

:::

## Introduction

Each `.then(...)` method of an `ArgumentBuilder<CommandSourceStack, ?>` takes in another `ArgumentBuilder<CommandSourceStack, ?>` object. This abstract ArgumentBuilder
has two implementations: `RequiredArgumentBuilder` and `LiteralArgumentBuilder`. When using Brigadier with Paper, we create these objects by running either `Commands.literal(String)`
for the `LiteralArgumentBuilder` or `Commands.argument(String, ArgumentType<T>)` for the `RequiredArgumentBuilder`.

As an explanation to what the difference is, you can picture it like this:
* An argument is a variable input by the user. It is semi-unpredictable, but will always return a valid entry of the object that it is backing.
* A literal is a non-variable input by the user. It is mainly used as a way to define predictable input, since each literal is a new branch on our command tree.

## Literals
In code, literals generally cannot be accessed. Yet, due to the nature of our command tree, we can always know on what literal branch we currently are:
```java
Commands.literal("plant")
    .then(Commands.literal("tree")
        .executes(context -> {
            // Here we are on /plant tree
        })
    )
    .then(Commands.literal("grass")
        .executes(context -> {
            // Here we are on /plant grass
        })
    )
```

:::tip

You may notice the usage of the `executes` method. This method declares logic to our branches. If a branch has no `executes` method defined, it will not be executable.
For more information about execution logic, [click here](/paper/dev/command-api/basics/executors).

:::

## Arguments
Arguments are slightly more complex. They also define a new branch in a tree, but they are not directly predictable. Each argument is created using `Commands.argument(String, ArgumentType<T>)`.
That method returns a `RequiredArgumentBuilder`. The `T` type parameter declares the return type of the argument, which you can then use inside your `executes` method. That means that
if you put in an `ArgumentType<Integer>`, you can retrieve the value of that argument as an integer, requiring no manual parsing! There are a few build-in, primitive argument types
that we can use for arguments:

| Argument Type                     | Resolved Type | Possible Input      | Description                                                                                      |
|-----------------------------------|---------------|---------------------|--------------------------------------------------------------------------------------------------|
| BoolArgumentType.bool()           | Boolean       | true/false          | Only allows a boolean value                                                                      |
| IntegerArgumentType.integer()     | Integer       | 253, -123, 0        | Any valid integer                                                                                |
| LongArgumentType.longArg()        | Long          | 25418263123783      | Any valid long                                                                                   |
| FloatArgumentType.floatArg()      | Float         | 253.2, -25.0        | Any valid float                                                                                  |
| DoubleArgumentType.doubleArg()    | Double        | 4123.242, -1.1      | Any valid double                                                                                 |
| StringArgumentType.word()         | String        | letters-and+1234567 | A single word. May only contain letters and numbers and these characters: `+`, `-`, `_`, and `.` |
| StringArgumentType.string()       | String        | "with spaces"       | A single word, or, if quoted, any valid string with spaces                                       |
| StringArgumentType.greedyString() | String        | unquoted spaces     | The literal written input. May contain any characters. Has to be the last argument               |

### Boolean argument type and argument parsing
A boolean argument type is used for retrieving, well, a boolean. An example usage for that might be a `/serverflight` command which allows for enabling and disabling server flight
with `/serverflight true` and `/serverflight false`:

```java
Commands.literal("serverflight")
    .then(Commands.argument("allow", BoolArgumentType.bool())
        .executes(context -> {
            boolean allow = context.getArgument("allow", boolean.class);
            // Toggle server flying
        })
    )
```

Here, you can see how one would access an argument in-code. The first parameter for the `Commands.argument(String, ArgumentType<T>)` method takes in the node name. This is not required
by literals, as their name is the same as their value. But here we need a way to access the argument. The parameter of the executes-lambda has a method called
`V getArgument(String, Class<V>)`. The first parameter is the name of the argument we want to retrieve. The second parameter is the return value of the argument. As we are using
a boolean argument, we put in `boolean.class` and retrieve the argument value as such.

### Number arguments
All of the number arguments (like `IntegerArgumentType.integer()`) have three overloads:

| Overload                                        | Description                                               |
|-------------------------------------------------|-----------------------------------------------------------|
| `IntegerArgumentType.integer()`                 | Any value between Integer.MIN_VALUE and Integer.MAX_VALUE |
| `IntegerArgumentType.integer(int min)`          | Any value between min and Integer.MAX_VALUE               |
| `IntegerArgumentType.integer(int min, int max)` | Any value between min and max                             |

This is particularly useful for filtering out too high or too low input. As an example, we can define a `/flyspeed` command. As the
[](jd:paper:org.bukkit.entity.Player#setFlySpeed(float)) method only
accepts floats between -1 and 1, where -1 is an inverse direction, it would make sense to limit the values between 0 and 1 for in-bounds, non-negative speed values.
This can be achieved with the following command tree:

```java
Commands.literal("flyspeed")
    .then(Commands.argument("speed", FloatArgumentType.floatArg(0, 1.0F))
        .executes(context -> {
            float speed = context.getArgument("speed", float.class);
            // Set player's flight speed
            return Command.SINGLE_SUCCESS;
        })
    )
```

:::tip

Some arguments can have special ways of being retrieved. Most notably, all of the Brigadier-provided arguments (the ones mentioned on this page)
have a resolver to get their own argument value. For the float argument, this would look like this:

```java
float speed = FloatArgumentType.getFloat(context, "speed");
```

It generally does not matter whether you use `context.getArgument` or `FloatArgumentType.getFloat`, since it goes through the same logic, but in future documentation,
primitive values might be retrieved using their own parsers.

These parsers for Brigadier-native arguments exist. All of these take in `(CommandContext<?> context, String name)` as method parameters:
- `BoolArgumentType.getBool`
- `IntegerArgumentType.getInteger`
- `LongArgumentType.getLong`
- `FloatArgumentType.getFloat`
- `DoubleArgumentType.getDouble`
- `StringArgumentType.getString`

:::

Now, if we input a valid float between 0 and 1, the command would execute correctly:
![](./assets/valid-float.png)

But if we input a too small or too big float, it would throw an error **on the client**:
![](./assets/small-float.png)
![](./assets/big-float.png)

This is the main advantage of native arguments: The client itself performs simple error checking on the arguments, which makes user experience whilst running a command
way better, as they can see invalid input without sending the command to the server.

### String arguments
There are three string arguments: `word`, `string`, and `greedyString`.

The `word` string argument is the simplest one of these. It only accepts a single word consisting of alphanumerical characters and these special characters: `+`, `-`, `_`, and `.`.
* ✅ `.this_is_valid_input.`
* ❌ `this is invalid input`
* ❌ `"also_invalid"`
* ✅ `-10_numbers_are_valid`
* ❌ `@_@`

The `string` argument is slightly more complicated. If unquoted, it follows the same rules as the `word` argument. Only alphanumerical characters and the mentioned special characters.
But if you put your string into quotes, you can enter any combination of unicode characters you want to. Quotes `"` can be escaped using a backslash `\`.
* ✅ `this_is-valid-input`
* ✅ `"\"quotes\""`
* ❌ `this is invalid input`
* ✅ `"this is valid input again"`
* ✅ `"also_valid"`
* ✅ `"紙の神"`

The `greedyString` argument is the only argument which does not perform any parsing. Due to its "greedy" nature, it does not allow any arguments after its declaration. That also means, that
any input is completely valid and it requires no quotes. In fact, quotes are counted as literal characters.
* ✅ `this_is_valid_input`
* ✅ `this is valid as well input`
* ✅ `"this is valid input again"`
* ✅ `also_valid`
* ✅ `紙の神`

Here you can see the arguments in action:
![](./assets/string-arguments.gif)

## Further reference
### Minecraft arguments
Apart from these built-in Brigadier arguments, countless custom arguments are defined by Paper as well. These can be accessed in a static context with the `ArgumentTypes` class. You
can read more about these [here](/paper/dev/command-api/arguments/minecraft).

### Custom arguments
Sometimes you want to define your own, custom arguments. For that you can implement the `CustomArgumentType<T, N>` interface.
You can read more about these [here](/paper/dev/command-api/basics/custom-arguments).


---


# Executors

A guide to execution logic for Brigadier commands.

:::tip

This page requires knowledge about [Command Trees](/paper/dev/command-api/basics/command-tree) and [Arguments and Literals](/paper/dev/command-api/basics/arguments-and-literals). If you haven't read
through those articles, it is highly recommend to check those out beforehand!

:::

This page is dedicated to the `executes(...)` method from the `ArgumentBuilder` class.

## Examining the executes method
The `executes` method is defined as following:

```java title="ArgumentBuilder.java"
public T executes(Command<S> command);
```

The `Command<S>` interface is declared as a `FunctionalInterface`. That means that instead of putting in a class that implements it, we can just pass in a lambda expression.

```java title="Command.java"
@FunctionalInterface
public interface Command<S> {
    int SINGLE_SUCCESS = 1;

    int run(CommandContext<S> context) throws CommandSyntaxException;
}
```

Our lambda has one parameter and returns an integer. That is essentially that `run` method defined in that interface. The one parameter, `CommandContext<S>` is the one where
we get all the information about the sender who executed that command and all the command arguments. It has quite a few methods, but the main ones of use for us are
`S getSource()` and `V getArgument(String, Class<V>)`. We have taken a brief look at the `getArgument(...)` in the [Arguments and Literals](/paper/dev/command-api/basics/arguments-and-literals) chapter, but
in a nutshell, this is the method that we can retrieve arguments from. There will be more specific examples later on.

You should mainly notice the generic parameter `S` by the `getSource()` method. That is the type of the source of the command. For the executes method, this type is always a
`CommandSourceStack`. That class itself has these methods: `Location getLocation()`, `CommandSender getSender()`, and `@Nullable Entity getExecutor()`.
The most used method from that is `getSender()`, as that is the command sender who has actually run the command. For the target of a command, you should use `getExecutor()`,
which is relevant, if the command was ran via `/execute as <entity> run <our_command>`. It is not necessarily required, but is seen as good practice.

## Example: Flyspeed command
In the [Arguments and Literals](/paper/dev/command-api/basics/arguments-and-literals) chapter, we have briefly declared the structure for a `/flyspeed` command with the use of a ranged float argument.
But that command does not actually set the flyspeed of the executing player. In order to do that, we'd have to append an executor onto it, like this:

```java {4-6}
Commands.literal("flyspeed")
    .then(Commands.argument("speed", FloatArgumentType.floatArg(0, 1.0F))
        .executes(context -> {
            CommandSender sender = context.getSource().getSender(); // Retrieve the command sender
            // Retrieve the command executor, which may or may not be the same as the sender
            Entity executor = context.getSource().getExecutor();

            // Check whether the executor is a player, as you can only set a player's flight speed
            if (!(executor instanceof Player player)) {
                // If a non-player tried to set their own flight speed
                sender.sendPlainMessage("Only players can fly!");
                return Command.SINGLE_SUCCESS;
            }

            float speed = FloatArgumentType.getFloat(context, "speed"); // Retrieve the speed argument
            // Set the player's speed
            player.setFlySpeed(speed);

            if (sender == player) {
                // If the player executed the command themselves
                player.sendPlainMessage("Successfully set your flight speed to " + speed);
            } else {
                // If the speed was set by a different sender (Like using /execute)
                sender.sendRichMessage("Successfully set <player_name>'s flight speed to <speed>",
                    Placeholder.component("player_name", player.displayName()),
                    Placeholder.unparsed("speed", String.valueOf(speed))
                );
                player.sendPlainMessage("Your flight speed has been set to " + speed);
            }
            return Command.SINGLE_SUCCESS;
        })
    )
```

### Explanation
There is a lot to unpack, so let's break it down, top to bottom:

The first lines define a `/flyspeed` command root, with a float argument named "speed", which only allows values between 0 and 1.

Note the highlighted lines. We first retrieve the `CommandSourceStack` from our `CommandContext<CommandSourceStack>` and then finally retrieve its sender and executor.
A `CommandSender` is an interface, which declares the `sendMessage(...)`, `getServer()`, and `getName()` methods. It is implemented by all entities, including players,
and the `ConsoleCommandSender`, which is used if a console executes a command.

Next up we check whether our executor object is also an instance of a `Player`. If executor were null, this would be false, which is why we require no null check.
If the expression evaluates as true, we get a new `player` variable, which represents an actual player on the server that the command was executed by.

Then, we set the player's flight speed using the value retrieved from the player-provided float argument and send them a message to confirm the operation.
It is always recommended to send a confirmation message whether the command was successful, because otherwise a player might get confused to why a command is "not working".
If the executor was not a player, we can send a form of error message. In our case, we assume the sender to be a console, as an entity usually does not try to send such
a command.

Finally, we just return from the lambda expression providing a return value. As our command succeeded, we can return `Command.SINGLE_SUCCESS`, whose value is `1`.
Don't forget to close all your braces!

Running the command now works correctly:
![](./assets/flyspeed-player.png)
![](./assets/flyspeed-console.png)

We can even run it as another player, using `/execute as`:
![](./assets/flyspeed-proxied.png)

### Logic separation
Sometimes, if the command is too big or due to personal preference, you might not want to have your logic code in your executes scope, as it might be unreadable due of the amount of indentations.
In such an event we can, instead of defining our logic directly in the lambda expression, use another method instead. For that we can just call our method in the executes scope. This might look like this:

```java title="FlightSpeedCommand.java"
public class FlightSpeedCommand {

    public static LiteralCommandNode<CommandSourceStack> createCommand() {
      return Commands.literal("flyspeed")
          .then(Commands.argument("speed", FloatArgumentType.floatArg(0, 1.0F))
              .executes(context -> setFlySpeed(
                  context,
                  FloatArgumentType.getFloat(context, "speed") // this pattern also allows for building optional arguments easily
              ))
          )
          .build();
    }

    private static int setFlySpeed(CommandContext<CommandSourceStack> context, float speed) {
        CommandSender sender = context.getSource().getSender(); // Retrieve the command sender
        Entity executor = context.getSource().getExecutor(); // Retrieve the command executor, which may or may not be the same as the sender

        // Check whether the executor is a player, as you can only set a player's flight speed
        if (!(executor instanceof Player player)) {
            // If a non-player tried to set their own flight speed
            sender.sendPlainMessage("Only players can fly!");
            return Command.SINGLE_SUCCESS;
        }

        // Set the player's speed
        player.setFlySpeed(speed);

        if (sender == player) {
            // If the player executed the command themselves
            player.sendPlainMessage("Successfully set your flight speed to " + speed);
        } else {
            // If the speed was set by a different sender (Like using /execute)
            sender.sendRichMessage("Successfully set <player_name>'s flight speed to <speed>",
                Placeholder.component("player_name", player.displayName()),
                Placeholder.unparsed("speed", String.valueOf(speed))
            );
            player.sendPlainMessage("Your flight speed has been set to " + speed);
        }
        return Command.SINGLE_SUCCESS;
    }
}
```

As you can see, we have made our command tree way easily readable whilst preserving the same functionality.


---


# Introduction

A guide to Paper's Brigadier command API.

Paper's command system is built on top of Minecraft's Brigadier command system. This system provides a powerful and flexible way to define commands and arguments.
It offers many advantages above the previously widely used Bukkit command system:
- Less parsing or error checking required by the developer for arguments.
- Better user experience with client error checking.
- Integration with reload events, allowing the definition of commands usable in datapacks.
- Easier creation of subcommands.

:::note

To see a comparison between the new Brigadier system and the old Bukkit system, [click here](/paper/dev/command-api/misc/comparison-bukkit-brigadier).

:::

## Guide

:::tip

If the Brigadier API seems too complicated, you can start with
[basic commands](/paper/dev/command-api/misc/basic-command). They
provide a simple way of creating commands, with only a small learning curve.

:::

The following sites are worth-while to look through first when learning about Brigadier:
- [The Command Tree](/paper/dev/command-api/basics/command-tree)
- [Arguments and Literals](/paper/dev/command-api/basics/arguments-and-literals)
- [Command Executors](/paper/dev/command-api/basics/executors)
- [Command Registration](/paper/dev/command-api/basics/registration)
- [Command Requirements](/paper/dev/command-api/basics/requirements)
- [Argument Suggestions](/paper/dev/command-api/basics/argument-suggestions)
- [Custom Arguments](/paper/dev/command-api/basics/custom-arguments)

For a reference of more advanced arguments, you should look here:
- [Minecraft Arguments](/paper/dev/command-api/arguments/minecraft)

:::danger[Future pages]

The following pages will be added to the documentation in the future:

- **Tutorial: Creating Utility Commands**
- **The Command Dispatcher**
- **Forks and Redirects**
- **Tutorial: Extending the vanilla execute command**

:::

## Additional support
For support regarding the command API, you can always ask in our [Discord server](https://discord.gg/PaperMC) under the
[`#paper-dev`](https://discord.com/channels/289587909051416579/555462289851940864) channel!


---


# Registration

A guide to registering Brigadier commands.

In the previous chapters, we have taken an extensive look at how Brigadier works, but never actually elaborated on how to register commands. So we will be doing that right here!

## The LifecycleEventManager
In Paper, Brigadier commands are registered using the `LifecycleEventManager`. This is a special class which allows us to register commands in such a way that we never have to
worry about handling various server reload events, like `/reload`. Instead, whatever we register using the `LifecycleEventManager`, will be reregistered each time it is required.

But how does one get access to a `LifecycleEventManager` capable of registering commands? There are two "contexts" in which you can use a LifecycleEventManager. The first one,
and preferred one, is in the `PluginBootstrap` class of our plugin.

### Registering inside the plugin bootstrapper

:::note

This requires you to use a [Paper plugin](/paper/dev/getting-started/paper-plugins) (with a `paper-plugin.yml`).

If you are not using `paper-plugin.yml`, you can instead [register your commands inside your plugin's main class](#registering-inside-the-plugins-main-class).

:::

We can get access to a `LifecycleEventManager` capable of registering commands by running `context.getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> {})`
inside our bootstrap method, like this:

```java title="ExamplePluginBootstrap.java"
public final class ExamplePluginBootstrap implements PluginBootstrap {

    @Override
    public void bootstrap(final BootstrapContext context) {
        context.getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> {
            // register your commands here ...
        });
    }
}
```

A quick recap on what all of this means:
By running `context.getLifecycleManager()`, we get a `LifecycleEventManager<BootstrapContext>` object. We can call
`LifecycleEventManager#registerEventHandler(LifecycleEventType, LifecycleEventHandler)` on that to register our lifecycle event. The first parameter declares the lifecycle event type we want to register the handler for, the second parameter is an interface that looks like this:

```java
@FunctionalInterface
public interface LifecycleEventHandler<E extends LifecycleEvent> {
    void run(E event);
}
```

Due to it being a functional interface, we can, instead of implementing it, just pass in a lambda which has one parameter, `E`, and no return value. The `E` generic type is a
`ReloadableRegistrarEvent<Commands>`, which is thus also the type of our lambda parameter.

The `ReloadableRegistrarEvent<Commands>` class has two methods: `ReloadableRegistrarEvent.Cause cause()` and `Commands registrar()`. The more relevant method for us is
the `registrar` one. With it we can register our commands.

:::tip

Registering commands in the plugin bootstrapper allows for your commands to be used by datapack functions earlier in the server startup process.

:::

### Registering inside the plugin's main class
Getting access to a `LifecycleEventManager` for commands inside our plugin's main class is very similar to how you access it inside the PluginBootstrap class, with the difference
that instead of getting the `LifecycleEventManager` using the `BootstrapContext` provided to us in the bootstrap method of our PluginBootstrap class, we can just retrieve it using
`Plugin#getLifecycleManager`.

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        this.getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> {
            // register your commands here ...
        });
    }
}
```

This follows the same concept as the PluginBootstrap one, just that instead of being given a `LifecycleEventManager<BootstrapContext>`, we are instead given a
`LifecycleEventManager<Plugin>`. This doesn't really matter for our use cases, but you might as well be aware of that.
The rest of the methods works the exact same way as with the `PluginBootstrap` parameterized `LifecycleEventManager`.

## Registering commands using the Commands class
Now that we have access to the instance of a `Commands` class via `event.registrar()` in our event handler, we have access to a few overloads of the `Commands#register`
method.

### Registering a LiteralCommandNode
Most of the time, you will be using a `LiteralArgumentBuilder` to build up your command tree. In order to retrieve a `LiteralCommandNode` from that object, we need to call the
`LiteralArgumentBuilder#build()` method on it:

```java
LiteralArgumentBuilder<CommandSourceStack> command = Commands.literal("testcmd")
    .then(Commands.literal("argument_one"))
    .then(Commands.literal("argument_two"));

LiteralCommandNode<CommandSourceStack> buildCommand = command.build();
```

Or in short:

```java
LiteralCommandNode<CommandSourceStack> buildCommand = Commands.literal("testcmd")
    .then(Commands.literal("argument_one"))
    .then(Commands.literal("argument_two"))
    .build();
```

Now that we have retrieved our `LiteralCommandNode`, we can register it. For that we have multiple overloads, which optionally allow us to set aliases and/or the description.
Registering our "testcmd" might look like this:

```java
context.getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> {
    event.registrar().register(buildCommand);
});
```

### Registering a BasicCommand
A [](jd:paper:io.papermc.paper.command.brigadier.BasicCommand) is a Bukkit-like way of defining commands. Instead of building up a command tree,
we allow all user input and retrieve the arguments as a simple array of strings. This type of commands is particularly useful for very simple, text based commands,
like a `/broadcast` command. You can read up on more details about basic commands [here](/paper/dev/command-api/misc/basic-command).

Assuming you already have your `BasicCommand` object, we can register it like this:

```java
final BasicCommand basicCommand = ...;

this.getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> {
    event.registrar().register("commandname", basicCommand);
});
```

Similar to the `LiteralCommandNode`, we also have overloads for setting various additional information for our command.

## Further reference
* For a quick reference on the LifecycleEventManager, click [here](/paper/dev/lifecycle).


---


# Basic commands

An overview of a Bukkit-style command declaration using Brigadier.

For very simple commands Paper has a way to declare Bukkit-style commands by implementing the [](jd:paper:io.papermc.paper.command.brigadier.BasicCommand) interface.

This interface has one method you have to override:
- `void execute(CommandSourceStack source, String[] args)`

And three more, optional methods which you can, but don't have to override:
- `Collection<String> suggest(CommandSourceStack source, String[] args)`
- `boolean canUse(CommandSender sender)`
- `@Nullable String permission()`

## Simple usage
Implementing the execute method, your class might look like this:
```java title="YourCommand.java"
public class YourCommand implements BasicCommand {

    @Override
    public void execute(final CommandSourceStack source, final String[] args) {

    }
}
```

With a `CommandSourceStack` you can retrieve basic information about the sender of the command, the location the command was send from,
and the entity for which the command was executed for. You can find more information on [our page on command executors](/paper/dev/command-api/basics/executors).

## The optional methods
You can freely choose whether to implement either of the mentioned, optional methods. Here is a quick overview on what which one does:

### `suggest(CommandSourceStack, String[])`
This method returns some sort of `Collection<String>` and takes in a `CommandSourceStack` and a `String[] args` as parameters. This is similar to the
`onTabComplete(CommandSender, Command, String, String[])` method of the `TabCompleter` interface, which is used for tab completion on Bukkit commands.

Each entry in the collection that you return will be send to the client to be shown as suggestions the same way as with Bukkit commands.

### `canUse(CommandSender)`
With this method, you can set up a basic `requires` structure from Brigadier commands. [You can read more on that here](/paper/dev/command-api/basics/requirements).
This method returns a `boolean`, which is required to return `true` in order for a command sender to be able to execute that command.

:::note

If you override this method, overriding `permission()` does nothing. This is because the default implementation
uses the return value of `permission()`, which wouldn't be used anymore if you were to override it.

```java title="BasicCommand.java"
default boolean canUse(final CommandSender sender) {
    final String permission = this.permission();
    return permission == null || sender.hasPermission(permission);
}
```

:::

### `permission()`
With the permission method you can, similar to the `canUse` method, set the permission required to be able to execute and view this command.

## Registering basic commands
Registering a `BasicCommand` is very simple: In your plugin's main class, you can simply call one of the
[`registerCommand(...)`](jd:paper:org.bukkit.plugin.java.JavaPlugin#registerCommand(java.lang.String,io.papermc.paper.command.brigadier.BasicCommand))
methods inside the `onEnable` method.

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        BasicCommand yourCommand = ...;
        this.registerCommand("mycommand", yourCommand);
    }
}
```

### Basic commands are functional interfaces
Because you only have to override one method, you can directly pass in a lambda expression. This is not recommended for styling
reasons, as it makes the code harder to read.

```java
@Override
public void onEnable() {
    this.registerCommand(
        "quickcmd",
        (source, args) -> source.getSender().sendRichMessage("<yellow>Hello!")
    );
}
```

## Example: Broadcast command
As an example, we can create a simple broadcast command. We start by declaring creating a class which implements `BasicCommand` and overrides `execute` and `permission`:

```java title="BroadcastCommand.java"
public class BroadcastCommand implements BasicCommand {

    @Override
    public void execute(final CommandSourceStack source, final String[] args) {

    }

    @Override
    public String permission() {
        return "example.broadcast.use";
    }
}
```

Our permission is set to `example.broadcast.use`. In order to give yourself that permission, it is suggested that you use a plugin like [LuckPerms](https://luckperms.net) or just give yourself
operator permissions. You can also set this permission to be `true` by default. For this, please check out the [plugin.yml documentation](/paper/dev/plugin-yml).

Now, in our `execute` method, we tell the sender that at least one argument is required in order to send a broadcast in case they defined no
arguments (meaning that `args` has a length of 0):

```java
if (args.length == 0) {
    source.getSender().sendRichMessage("<red>You cannot send an empty broadcast!");
    return;
}
```

Next, we can retrieve the name of the executor of that command. If we do not find one, we can just get the name of the command sender, like this:

```java
final Component name = Objects.requireNonNullElseGet(source.getExecutor(), source::getSender).name();
```

This makes sure that we cover all cases and even allow the command to work correctly with `/execute as`.

Finally, we can build our broadcast message by joining the arguments to a string and send it via `Bukkit.broadcast(Component)`:

```java
final String message = String.join(" ", args);
final Component broadcastMessage = MiniMessage.miniMessage().deserialize(
    "<red><bold>BROADCAST</red> <name> <dark_gray>»</dark_gray> <message>",
    Placeholder.component("name", name),
    Placeholder.unparsed("message", message)
);

Bukkit.broadcast(broadcastMessage);
```

And we are done! As you can see, this is a very simple way to define commands. Here is the final result of our class:

```java title="BroadcastCommand.java"
public class BroadcastCommand implements BasicCommand {

    @Override
    public void execute(final CommandSourceStack source, final String[] args) {
        if (args.length == 0) {
            source.getSender().sendRichMessage("<red>You cannot send an empty broadcast!");
            return;
        }

        final Component name = Objects.requireNonNullElseGet(source.getExecutor(), source::getSender).name();

        final String message = String.join(" ", args);
        final Component broadcastMessage = MiniMessage.miniMessage().deserialize(
            "<red><bold>BROADCAST</red> <name> <dark_gray>»</dark_gray> <message>",
            Placeholder.component("name", name),
            Placeholder.unparsed("message", message)
        );

        Bukkit.getServer().broadcast(broadcastMessage);
    }

    @Override
    public String permission() {
        return "example.broadcast.use";
    }
}
```

Registering the command looks like this:

```java
@Override
public void onEnable() {
    this.registerCommand("broadcast", new BroadcastCommand());
}
```

And this is how it looks like in-game:
![](./assets/broadcast-command.png)

### Adding suggestions
Our broadcast command works pretty well, but it is lacking on suggestions. A very common kind of suggestion for text based commands are player names.
In order to suggest player names, we can just map all online players to their name, like this:

```java
@Override
public Collection<String> suggest(final CommandSourceStack source, final String[] args) {
    return Bukkit.getOnlinePlayers().stream().map(Player::getName).toList();
}
```

This works great, but as you can see here, it will always suggest all players, regardless of user input, which can feel unnatural at times:
![](./assets/broadcast-suggestions-unfinished.png)

In order to fix this, we have to do some changes:

First, we early return what we already have in case there is no arguments, as we cannot filter by input then:

```java
if (args.length == 0) {
    return Bukkit.getOnlinePlayers().stream().map(Player::getName).toList();
}
```

After this, we can add a `filter` step to our stream, where we filter all names by whether they start with our current input, which is `args[args.length - 1]`:

```java
return Bukkit.getOnlinePlayers().stream()
    .map(Player::getName)
    .filter(name -> name.toLowerCase().startsWith(args[args.length - 1].toLowerCase()))
    .toList();
```

And we are done! As you can see, suggestions still work fine:
![](./assets/broadcast-suggestions-finished.png)

But when there is no player who starts with an input, it just suggests nothing:
![](./assets/broadcast-suggestions-none.png)

### Final code
Here is the final code for our whole `BroadcastCommand` class, including the suggestions:

```java title="BroadcastCommand.java"
public class BroadcastCommand implements BasicCommand {

    @Override
    public void execute(final CommandSourceStack source, final String[] args) {
        if (args.length == 0) {
            source.getSender().sendRichMessage("<red>You cannot send an empty broadcast!");
            return;
        }

        final Component name = Objects.requireNonNullElseGet(source.getExecutor(), source::getSender).name();

        final String message = String.join(" ", args);
        final Component broadcastMessage = MiniMessage.miniMessage().deserialize(
            "<red><bold>BROADCAST</red> <name> <dark_gray>»</dark_gray> <message>",
            Placeholder.component("name", name),
            Placeholder.unparsed("message", message)
        );

        Bukkit.getServer().broadcast(broadcastMessage);
    }

    @Override
    public String permission() {
        return "example.broadcast.use";
    }

    @Override
    public Collection<String> suggest(final CommandSourceStack source, final String[] args) {
        if (args.length == 0) {
            return Bukkit.getOnlinePlayers().stream().map(Player::getName).toList();
        }

        return Bukkit.getOnlinePlayers().stream()
            .map(Player::getName)
            .filter(name -> name.toLowerCase().startsWith(args[args.length - 1].toLowerCase()))
            .toList();
    }
}
```


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


# Custom events

A guide to show you how to add custom events to your plugin.

Creating custom events is a great way to add functionality to your plugin.
This will allow other plugins to listen to your custom events and add functionality to your plugin.

## Creating a custom event

To create a custom event, you need to create a class that extends [](jd:paper:org.bukkit.event.Event).
Each event requires a [](jd:paper:org.bukkit.event.HandlerList) that will contain all the listeners that are listening to that event.
The only exception to this requirement is when you have an event class that cannot be fired, but serves as a parent for other events instead.
An example of this is [](jd:paper:org.bukkit.event.block.BlockPistonEvent), which cannot be listened to directly.

This list is used to call the listeners when the event is called.

:::note

Although `getHandlerList` is not inherited from `Event`, you need to add a static `getHandlerList()` method and return the `HandlerList` for your event.
Both methods are required for your event to work.

:::

```java title="PaperIsCoolEvent.java"
public class PaperIsCoolEvent extends Event {

    private static final HandlerList HANDLER_LIST = new HandlerList();

    public static HandlerList getHandlerList() {
        return HANDLER_LIST;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLER_LIST;
    }
}
```

Now that we have created our event, we can add some functionality to it.
Perhaps this will contain a message that will be broadcast to the server when the event is called.

```java title="PaperIsCoolEvent.java"
public class PaperIsCoolEvent extends Event {

    private static final HandlerList HANDLER_LIST = new HandlerList();
    private Component message;

    public PaperIsCoolEvent(Component message) {
        this.message = message;
    }

    public Component getMessage() {
        return this.message;
    }

    public void setMessage(Component message) {
        this.message = message;
    }

    public static HandlerList getHandlerList() {
        return HANDLER_LIST;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLER_LIST;
    }
}
```

## Calling the event

Now that we have created our event, we can call it.

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    // ...

    public void callCoolPaperEvent() {
        PaperIsCoolEvent coolEvent = new PaperIsCoolEvent(Component.text("Paper is cool!"));
        coolEvent.callEvent();
        // Plugins could have changed the message from inside their listeners here. So we need to get the message again.
        // This event structure allows for other plugins to change the message to their taste.
        // Like, for example, a plugin that adds a prefix to all messages.
        Bukkit.broadcast(coolEvent.getMessage());
    }
}
```

## Implementing cancellation

If you want to allow your event to be cancelled, you can implement the `Cancellable` interface.

```java title="PaperIsCoolEvent.java"
public class PaperIsCoolEvent extends Event implements Cancellable {

    private static final HandlerList HANDLER_LIST = new HandlerList();
    private Component message;
    private boolean cancelled;

    // ...

    @Override
    public boolean isCancelled() {
        return this.cancelled;
    }

    @Override
    public void setCancelled(boolean cancel) {
        this.cancelled = cancel;
    }
}
```

Now, when the event is called, you can check if it is cancelled and act accordingly.

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    // ...

    public void callCoolPaperEvent() {
        PaperIsCoolEvent coolEvent = new PaperIsCoolEvent(Component.text("Paper is cool!"));
        coolEvent.callEvent();
        if (!coolEvent.isCancelled()) {
            Bukkit.broadcast(coolEvent.getMessage());
        }
    }
}
```

When an event is cancellable, [](jd:paper:org.bukkit.event.Event#callEvent())
will return false if the event was cancelled. This allows you to directly use `callEvent` in your `if` statement,
instead of having to check [](jd:paper:org.bukkit.event.Cancellable#isCancelled()) manually.

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    // ...

    public void callCoolPaperEvent() {
        PaperIsCoolEvent coolEvent = new PaperIsCoolEvent(Component.text("Paper is cool!"));
        if (coolEvent.callEvent()) { // Directly get the output from callEvent
            Bukkit.broadcast(coolEvent.getMessage());
        }
    }
}
```


---


# Entity Pathfinder API

A guide to the Entity Pathfinder API.

The Entity Pathfinder API can be used to control the movement of entities in Minecraft. It allows you to set a path
for an entity to follow, such as moving to a location or following a player.

## Accessing the pathfinder

To access the pathfinder for a mob, you need to call [`getPathfinder()`](jd:paper:org.bukkit.entity.Mob#getPathfinder()) on the mob.
This will return an instance of [](jd:paper:com.destroystokyo.paper.entity.Pathfinder).

:::note

The pathfinder is only available for entities that implement [](jd:paper:org.bukkit.entity.Mob).

:::

Let's say that you have a [](jd:paper:org.bukkit.entity.Cow) and want to move it to a player.
You can do this by getting the pathfinder for the cow and then setting the path to the player's location:

```java
Cow cow = ...;
Player player = ...;

Pathfinder pathfinder = cow.getPathfinder();
// moveTo returns a boolean indicating whether the path was set successfully
boolean success = pathfinder.moveTo(player.getLocation());
```

If you want to access the current path for the cow, you can call [`getCurrentPath()`](jd:paper:com.destroystokyo.paper.entity.Pathfinder#getCurrentPath())
on the pathfinder:

```java
PathResult path = pathfinder.getCurrentPath();

// A PathResult is essentially a wrapper around a List of Locations. These can be accessed with:
List<Location> locations = path.getPoints();
// It is important to note that the list contains points that have already been passed,
// as well as future points. If you want to get the next point, you can use:
Location nextPoint = path.getNextPoint(); // Or locations.get(path.getNextPointIndex())
// Finally, you can access the final destination with:
Location destination = path.getFinalPoint();
```

## Pathfinding rules

The pathfinder is limited by Minecraft's own pathfinding logic.
For example, a polar bear cannot fly. This means that if you set a path for a polar bear to a location that is in the air,
it will not be able to reach it.

Some attributes can be set on the pathfinder to change the way that the pathfinder works. These are:
- [`setCanOpenDoors(boolean)`](jd:paper:com.destroystokyo.paper.entity.Pathfinder#setCanOpenDoors(boolean)): Whether the entity can open doors.
  This is relevant for zombies breaking down doors and villagers opening doors.
- [`setCanPassDoors(boolean)`](jd:paper:com.destroystokyo.paper.entity.Pathfinder#setCanPassDoors(boolean)): Whether the entity can pass through open doors.
- [`setCanFloat(boolean)`](jd:paper:com.destroystokyo.paper.entity.Pathfinder#setCanFloat(boolean)): Whether the entity can float in water.

These methods have respective getters as well.

## Stopping the pathfinding

You can call [`stopPathfinding()`](jd:paper:com.destroystokyo.paper.entity.Pathfinder#stopPathfinding()) on the pathfinder to cancel the entity
from pathfinding. This will also clear the current path. You can use
[`hasPath()`](jd:paper:com.destroystokyo.paper.entity.Pathfinder#hasPath()) to check if the pathfinder is currently running.


---


# Teleportation

The entity teleportation API and how to use it.

Entities can be instantaneously teleported to specific positions, synchronously and asynchronously with the
[`teleport`](jd:paper:org.bukkit.entity.Entity#teleport(org.bukkit.Location)) and
[`teleportAsync`](jd:paper:org.bukkit.entity.Entity#teleportAsync(org.bukkit.Location)) API.

:::tip[Performance]

If you expect to teleport into unloaded chunks, it is recommended to use the `teleportAsync` API,
as it avoids doing synchronous chunk loads, which put a lot of stress on the server's main thread -
hurting overall performance.

:::

```java
boolean success = entity.teleport(location); // loads chunks synchronously and teleports the entity

entity.teleportAsync(location).thenAccept(success -> { // loads chunks asynchronously and teleports the entity
    // this code is ran when the teleport completes
    // the Future is completed on the main thread, so it is safe to use the API here

    if (success) {
        // the entity was teleported successfully!
    }
});
```

:::danger

You should **NEVER** call `.get()`/`.join()` on the `teleportAsync` `Future` on the main thread,
as it **WILL** deadlock your server, if the chunk you're teleporting into is not loaded.

:::

## Look at

The [`lookAt`](jd:paper:org.bukkit.entity.Player#lookAt(org.bukkit.entity.Entity,io.papermc.paper.entity.LookAnchor,io.papermc.paper.entity.LookAnchor))
API allows you to make a player look at a certain position or entity.

```java
player.lookAt(
    position,
    LookAnchor.EYES // the player's eyes will be facing the position
);

player.lookAt(
    entity,
    LookAnchor.EYES // the player's eyes will be facing the entity
    LookAnchor.FEET // the player will be facing the entity's feet
);
```

## Teleport flags

Teleport flags offer a way to teleport entities whilst being able to customize behavior.
This allows you to do things like teleport players using relative flags and being able to retain passengers.

All available teleport flags can be found in the [](jd:paper:io.papermc.paper.entity.TeleportFlag) class.

### Relative teleportation

Teleport a player relatively, preventing velocity from being reset in the X, Y and Z axes.

```java
player.teleport(
    location,
    TeleportFlag.Relative.VELOCITY_X,
    TeleportFlag.Relative.VELOCITY_Y,
    TeleportFlag.Relative.VELOCITY_Z
);
```

### Retaining passengers

:::caution[Warning]

Since 1.21.10, this flag does not do anything, as it's been made the default behavior when teleporting entities.

:::

Teleport an entity with the [`RETAIN_PASSENGERS`](jd:paper:io.papermc.paper.entity.TeleportFlag$EntityState#RETAIN_PASSENGERS) flag,
allowing its passengers to be transferred with the entity.

```java
entity.teleport(location, TeleportFlag.EntityState.RETAIN_PASSENGERS);
```


---


# Supporting Paper and Folia

How to support both Folia and Paper within your plugin.

![](https://assets.papermc.io/brand/folia.png)

[Folia](https://github.com/PaperMC/Folia) is a fork of Paper, which is currently maintained by the PaperMC team.
It adds the ability to split the world into regions as outlined [here](/folia/reference/overview) in more depth.

# Mark plugin as supported on Folia

Plugins can't run on Folia if you don't have this field in your paper-plugin.yml (or plugin.yml, respectively):
```yaml
folia-supported: true
```

:::danger

Marking a plugin as supported on Folia is *not nearly enough* to support Folia.
You must specially develop your plugin with the intent of supporting Folia, keeping things mentioned on this page in mind.

:::

# Checking for Folia

Depending on what platform your plugin is running on, you may need to implement features differently. For this, you can
use this utility method to check if the current server is running Folia:

```java
private static boolean isFolia() {
    return ServerBuildInfo.buildInfo().isBrandCompatible(Key.key("papermc", "folia"));
}
```

## Schedulers

In order to support Paper and Folia, you must use the correct scheduler. Folia has different types of schedulers
that can be used for different things. They are:

- [Global](#global-scheduler)
- [Region](#region-scheduler)
- [Async](#async-scheduler)
- [Entity](#entity-scheduler)

If you use these schedulers when running Paper, they will be internally handled to provide the same functionality as if you were
running Folia.

### Global scheduler
The tasks that you run on the global scheduler will be executed on the global region, see [here](/folia/reference/overview#global-region) for
more information. You should use this scheduler for any tasks that do not belong to any particular region. These can be fetched with:
```java
GlobalRegionScheduler globalScheduler = server.getGlobalRegionScheduler();
```

### Region scheduler
The region scheduler will be in charge of running tasks for the region that owns a certain location. Do not use this scheduler for
operations on entities, as this scheduler is tied to the region. Each entity has its [own scheduler](#entity-scheduler)
which will follow it across regions. As an example, let's say I want to set a block to a beehive:
```java
Location locationToChange = ...;
RegionScheduler scheduler = server.getRegionScheduler();

scheduler.execute(plugin, locationToChange, () -> {
    locationToChange.getBlock().setType(Material.BEEHIVE);
});
```

We pass the location as a parameter to the [](jd:paper:io.papermc.paper.threadedregions.scheduler.RegionScheduler)
as it needs to work out which region to execute on.

### Async scheduler
The async scheduler can be used for running tasks independent of the server tick process. This can be fetched with:
```java
AsyncScheduler asyncScheduler = server.getAsyncScheduler();
```

### Entity scheduler
Entity schedulers are used for executing tasks on an entity. These will follow the entity wherever it goes, so you must use
these instead of the region schedulers.
```java
EntityScheduler scheduler = entity.getScheduler();
```


---


# Getting started

import PageCards from "/src/components/PageCards.astro";

Welcome to the Paper development guide! This guide includes information and tutorials on
how to start developing plugins for Paper.

<PageCards />


---


# Paper plugins

A development guide for how to write Paper-specific plugins.

Paper plugins allow developers to take advantage of more modern concepts introduced by Mojang, such as datapacks, to
expand the field of what the Paper API is able to introduce.

:::danger[Experimental]

This is experimental and may be subject to change.

:::

- [Bootstrapper](#bootstrapper)
- [Loader](#loaders)
- [Differences](#differences)

## How do I use them?
Similarly to Bukkit plugins, you have to introduce a `paper-plugin.yml` file into your JAR resources folder.
This will not act as a drop-in replacement for `plugin.yml`, as some things, as outlined in this guide, need to be declared differently.

It should be noted that you still have the ability to include both `paper-plugin.yml` and `plugin.yml` in the same JAR.

Here is an example configuration:
```yaml replace
name: Example-Plugin
version: '1.0'
main: com.example.paperplugin.ExamplePlugin
description: A Paper plugin showcase
api-version: '\{LATEST_PAPER_RELEASE}'
bootstrapper: com.example.paperplugin.ExamplePluginBootstrap
loader: com.example.paperplugin.ExamplePluginLoader
```

### Dependency declaration

Paper plugins change how to declare dependencies in your `paper-plugin.yml`:

```yml
dependencies:
  bootstrap:
    # Let's say that RegistryPlugin registers some data that your plugin needs to use
    # We don't need this during runtime, so it's not required in the server section.
    # However, can be added to both if needed
    RegistryPlugin:
      load: BEFORE
      required: true
      join-classpath: true # Defaults to true
  server:
    # Add a required "RequiredPlugin" dependency, which will load AFTER your plugin.
    RequiredPlugin:
      load: AFTER
      required: true
      # This means that your plugin will not have access to their classpath
      join-classpath: false
```

With Paper plugins, dependencies are split into two sections:
- `bootstrap` - These are dependencies that you will be using in the [bootstrap](#bootstrapper).
- `server` - These are dependencies that are used for the core functionality of your plugin, whilst the server is running.

Let's take a look at a dependency:
```yml
RegistryPlugin:
  load: BEFORE # Defaults to OMIT
  required: true # Defaults to true
  join-classpath: true # Defaults to true
```

- `load` (`BEFORE`|`AFTER`|`OMIT`): Whether this plugin should load before or after **your** plugin. Note: `OMIT` has undefined ordering behavior.
- `required`: Whether this plugin is required for your plugin to load.
- `join-classpath`: Whether your plugin should have access to their classpath. This is used for plugins that need to access other plugins internals directly.

:::note[Cyclic Loading]

Note that in certain cases, plugins may be able to introduce cyclic loading loops, which will prevent the server from starting.
Please read the [cyclic loading guide](#cyclic-plugin-loading) for more information.

:::

Here are a couple of examples:
```yml
# Suppose we require ProtocolLib to be loaded for our plugin
ProtocolLib:
  load: BEFORE
  required: true

# Now, we are going to register some details for a shop plugin
# So the shop plugin should load after our plugin
SuperShopsXUnlimited:
  load: AFTER
  required: false

# Now, we are going to need to access a plugins classpath
# So that we can properly interact with it.
SuperDuperTacoParty:
  required: true
  join-classpath: true
```

## What is it used for?
Paper plugins lay down the framework for some future API. Our goals are to open more modern API that better aligns
with Vanilla. Paper plugins allow us to do just that by making a new way to load plugin resources before the server
has started by using [bootstrappers](#bootstrapper).

## Bootstrapper
Paper plugins are able to identify their own bootstrapper by implementing
[](jd:paper:io.papermc.paper.plugin.bootstrap.PluginBootstrap)
and adding the class of your implementation to the bootstrapper field in the `paper-plugin.yml`.
```java title="ExamplePluginBootstrap.java"
public final class ExamplePluginBootstrap implements PluginBootstrap {

    @Override
    public void bootstrap(final BootstrapContext context) {

    }

    @Override
    public JavaPlugin createPlugin(final PluginProviderContext context) {
        return new ExamplePlugin("My custom parameter");
    }

}
```
A bootstrapper also allows you to change the way your plugin is initialized, allowing you to pass values into your plugin constructor.
Currently, bootstrappers do not offer much new API and are highly experimental. This may be subject to change once more API is introduced.

## Loaders
Paper plugins are able to identify their own plugin loader by implementing
[](jd:paper:io.papermc.paper.plugin.loader.PluginLoader)
and adding the class of your implementation to the loader field in the `paper-plugin.yml`.

The goal of the plugin loader is the creation of an expected/dynamic environment for the plugin to load into.
This, as of right now, only applies to creating the expected classpath for the plugin, e.g. supplying external libraries to the plugin.
```java title="ExamplePluginLoader.java"
public final class ExamplePluginLoader implements PluginLoader {

    @Override
    public void classloader(final PluginClasspathBuilder classpathBuilder) {
        classpathBuilder.addLibrary(new JarLibrary(Path.of("dependency.jar")));

        final MavenLibraryResolver resolver = new MavenLibraryResolver();
        resolver.addDependency(new Dependency(new DefaultArtifact("com.example:example:version"), null));
        resolver.addRepository(new RemoteRepository.Builder("paper", "default", "https://repo.papermc.io/repository/maven-public/").build());

        classpathBuilder.addLibrary(resolver);
    }
}
```
Currently, you are able to add two different library types:
[](jd:paper:io.papermc.paper.plugin.loader.library.impl.JarLibrary) and
[](jd:paper:io.papermc.paper.plugin.loader.library.impl.MavenLibraryResolver).

:::danger

If you wish to resolve libraries from Maven Central, use a mirror, as using Maven Central directly as a CDN is against the Maven Central Terms of Service, and users of your plugin may hit rate limits.

You should use Paper's default mirror, configured by the [`PAPER_DEFAULT_CENTRAL_REPOSITORY`](/paper/reference/system-properties#paper_default_central_repository) environment variable and [`org.bukkit.plugin.java.LibraryLoader.centralURL`](/paper/reference/system-properties#orgbukkitpluginjavalibraryloadercentralurl) system property:
```java
resolver.addRepository(new RemoteRepository.Builder("central", "default", MavenLibraryResolver.MAVEN_CENTRAL_DEFAULT_MIRROR).build());
```

Using the Maven Central repository (i.e. `*.maven.org` or `*.maven.apache.org`) will cause a warning to be shown in the console.

:::

## Differences

### Bukkit serialization system
Paper plugins still support the serialization system (`org.bukkit.configuration.serialization`) that Bukkit uses. However, custom classes will not be
automatically registered for serialization. In order to use [](jd:paper:org.bukkit.configuration.ConfigurationSection#getObject(java.lang.String,java.lang.Class)),
you **must** call [](jd:paper:org.bukkit.configuration.serialization.ConfigurationSerialization#registerClass(java.lang.Class))
before you attempt to fetch objects from configurations.

### Classloading isolation
Paper plugins are not able to access each other unless given explicit access by depending on another plugin, etc. This
helps prevent Paper plugins from accidentally accessing each other's dependencies, and in general helps ensure that
plugins are only able to access what they explicitly depend on.

Paper plugins have the ability to bypass this, being able to access OTHER plugins' classloaders by adding a `join-classpath` option to their `paper-plugin.yml`.

```yml
Plugin:
  join-classpath: true # Means you have access to their classpath
```

Note, other Paper plugins will still be unable to access your classloader.

### Load order logic split
In order to better take advantage of classloading isolation, Paper plugins do **not** use the `dependencies` field to determine load order.
This was done for a variety of reasons, mostly to allow better control and allow plugins to properly share classloaders.

See [declaring dependencies](#dependency-declaration) for more information on how to declare the load order of your plugin.

### Commands
Paper plugins do not use the `commands` field to register commands. This means that you do not need to include all
of your commands in the `paper-plugin.yml` file. Instead, you can register commands using the
[Brigadier Command API](/paper/dev/command-api/basics/introduction).

### Cyclic plugin loading

Cyclic loading describes the phenomenon when a plugin loading causes a loop that eventually cycles back to the original plugin.
Unlike Bukkit plugins, Paper plugins will not attempt to resolve cyclic loading issues.

```d2
style.fill: transparent
direction: right

Plugin A -> Plugin B
Plugin B -> Plugin C
Plugin C -> Plugin D
Plugin D -> Plugin A
```

However, if Paper detects a loop that cannot be resolved, you will get an error that looks like this:
```
[ERROR]: [LoadOrderTree] =================================
[ERROR]: [LoadOrderTree] Circular plugin loading detected:
[ERROR]: [LoadOrderTree] 1) PluginA -> PluginB -> PluginA
[ERROR]: [LoadOrderTree]    PluginA loadbefore: [PluginB]
[ERROR]: [LoadOrderTree]    PluginB loadbefore: [PluginA]
[ERROR]: [LoadOrderTree] Please report this to the plugin authors of the first plugin of each loop or join the PaperMC Discord server for further help.
[ERROR]: [LoadOrderTree] =================================
```

It is up to you to resolve these cyclical loading issues.


---


# Handler lists

An explanation to what an event's HandlerList is.

Every [](jd:paper:org.bukkit.event.Event) that can be listened to has a
[](jd:paper:org.bukkit.event.HandlerList) containing all the listeners that are listening to that event.
This list is used to call the listeners when the event is called.

## Getting the handler list for an event

To get the handler list for an event, you can call `getHandlerList()` on the specific event class.

```java title="ExampleListener.java"
public class ExampleListener implements Listener {

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        HandlerList handlerList = event.getHandlerList();
        // ...
    }

    // Or:

    public ExampleListener() {
        // Access the handler list through the static getter
        HandlerList handlerList = PlayerJoinEvent.getHandlerList();
        // ...
    }
}
```

## Unregistering a listener

To unregister a listener, you can call `unregister()` on the `HandlerList` that the listener is registered to.

```java title="ExampleListener.java"
public class ExampleListener implements Listener {

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        HandlerList handlerList = event.getHandlerList();
        handlerList.unregister(this);
        // ...
    }

    // Or:

    public ExampleListener() {
        // Access the handler list through the static getter
        HandlerList handlerList = PlayerJoinEvent.getHandlerList();
        handlerList.unregister(this);
        // Granted this is a pretty stupid example...
    }
}
```

You can unregister based on [](jd:paper:org.bukkit.event.Listener)
or [](jd:paper:org.bukkit.plugin.Plugin) for more convenience.
Likewise, you can also unregister all listeners for a specific event by calling
[`unregisterAll()`](jd:paper:org.bukkit.event.HandlerList#unregisterAll()) on the `HandlerList`.


---


# How plugins work

How plugins work in Paper.

Plugins are a way to extend the functionality of a Minecraft server. They are written in JVM-based languages such as
Java, Kotlin, Groovy or Scala. Plugins are loaded from the `plugins` folder in the server directory. Plugins will be
loaded from a `.jar` file.  Each plugin has a main class that is specified in the plugin's `plugin.yml` file. This
class must extend JavaPlugin, and is the entry point for the plugin and is where the plugin's lifecycle methods are
defined.

:::caution

We do not recommend writing code inside your main class's constructor as there are no guarantees about what
API is available at that point. Instead, you should use the `onLoad` method to initialize your plugin. Also,
do not call your plugin's constructor directly. This will cause issues with your plugin.

:::

## Plugin lifecycle

Plugins are loaded and unloaded at runtime. When a plugin is loaded, it is initialized and enabled. When a plugin is
unloaded, it is disabled and finalized.

### Initialization

When a plugin is loaded, it is initialized. This means that the plugin is loaded into memory and its `onLoad`
method is called. This method is used to initialize the plugin and set up any resources that it needs. Most of the
Bukkit API is not available at this point, so it is not safe to interact with it.

### Enabling

When a plugin is enabled, its `onEnable` method is called. This method is used to set up any resources that the plugin
needs to run. This method is called when the plugin is initialized but before the server has started ticking, so it is
safe to register event listeners and other resources that the plugin needs to run, however often not safe to interact
with a lot of APIs.

This is when you can also open database connections, start threads, and other things that are not safe to do in the
`onLoad` method.

### Disabling

When a plugin is disabled, its `onDisable` method is called. This method is used to clean up any resources that the
plugin has allocated. This method is called before all plugins are unloaded, and is meant for any cleanup that needs to
be done before the plugin is unloaded. This may include saving data to disk or closing connections to databases.

## Event listeners

Events are a way for plugins to listen to things that happen in the server and run code when they are fired. For
example, [](jd:paper:org.bukkit.event.player.PlayerJoinEvent) is fired when a player
joins the server. This is a more performant way to run code when something happens, as opposed to constantly checking.
See our [event listener page](/paper/dev/event-listeners) for more.

Some events are cancellable. This means that when the event is fired, it can be cancelled which negates or stops the
effect of the event. For example, [](jd:paper:org.bukkit.event.player.PlayerMoveEvent)
is cancellable. This means that when it is cancelled, the player will not move. This is useful for things like anti-cheat,
where you want to cancel the event if the player is moving too fast.

It is important to think about how "hot" an event is when writing event listeners. A "hot" event is an event that is fired
very often. For example, `PlayerMoveEvent` is fired every time a player moves. This means that if you have a lot of
expensive code in your event listener, it will be run every time a player moves. This can cause a lot of lag. It is
important to keep event listeners as lightweight as possible. One possible way is to quickly check if the event should
be handled, and if not, return. For example, if you only want to handle the event if the player is moving from one block
to another, you can check if the player's location has changed blocks. If it hasn't, you can return from the listener.

## Commands

Commands are a way for players, the console, RCON and command blocks to run code on the server. Commands are registered
by plugins and can be run by command senders. For example, the `/help` command is registered by the server and can be
run by players. Commands can be run by players by typing them in the chat or by running them from a command block.

Commands can have arguments. For example, the `/give` command takes an argument for the player to give the item to and
an argument for the item to give. Arguments are separated by spaces. For example, the command `/give Notch diamond` will
give the player named Notch a diamond. Note here that the arguments are `["Notch", "diamond"]`.

### Permissions

Permissions are a way to control who can run commands and who can listen to events. Permissions
are registered by plugins and can be checked by other plugins. Permissions can be granted to players and groups.
Permissions can have a hierarchical nature, if defined so by the plugin in their `plugin.yml`. For example, a
plugin can define `example.command.help` as a sub-permission of `example.command`. This means that if a player
has the `example.command` permission, they will also have the `example.command.help` permission.

:::note

Permission plugins can allow the usage of wildcard permissions using the `*` character to grant any permission
or sub-permission available, allowing hierarchical permissions even if not set by the plugin itself. For example,
granting `example.command.*` through a permission plugin with wildcard support will grant access to all permissions
starting with `example.command.` itself.

It is **not** recommended to use wildcard permissions, especially `*` (All permissions), as it can be a huge
security risk, as well as potentially causing unwanted side effects to a player. Use with caution.

:::

## Configuration

Plugins can have configuration files. These files are used to store data that the plugin needs to run. For example, a
plugin that adds a new block to the game might have a configuration file that stores the block's ID. Configuration files
should be stored in the plugin's data folder, within the `plugins` folder. The server offers a YAML configuration API
that can be used to read and write configuration files. See [here](/paper/dev/plugin-configurations) for more information.

## Scheduling tasks

Plugins can schedule tasks to run at a later time. This is useful for things like running code after a certain amount
of time has passed. For example, a plugin might want to run code after 5 seconds. This can be done by scheduling a task
to run after 100 ticks - one second is 20 ticks during normal operation. It is important to note that tasks might be
delayed if the server is lagging. For example, if the server is only running at 10 ticks per second, a task that is
scheduled to run after 100 ticks will take 10 seconds.

In Java, typically you could use [`Thread#sleep()`](jd:java:java.lang.Thread#sleep(long)) to delay
the execution of code. However, if the code is running on the main thread, this will cause the server to pause for the
delay. Instead, you should use the `Scheduler` API to schedule tasks to run later.
Learn more about the `Scheduler` API [here](/paper/dev/scheduler).

## Components

Since Minecraft 1.7 and the introduction of "components", plugins can now send messages to players that contain
rich text. This means that plugins can send messages that contain things like colors, bold text, and clickable links.
Colors were always possible, but only through the use of legacy color codes.

Paper implements a library called `Adventure` that makes it easy to create and send messages to players. Learn more
about the `Adventure` API [here](/adventure/) from their docs or our docs
[here](/paper/dev/component-api/introduction).


---


# Lifecycle API

An introduction to Paper's Lifecycle API.

The lifecycle API can be used for lifecycle-related registration. It is currently used when registering [Brigadier commands](/paper/dev/command-api/basics/introduction) and modifying [registries](/paper/dev/registries/#create-new-entries) or [datapacks](/paper/dev/lifecycle/datapacks/).
Generally, systems that are initialized very early in the startup process can take advantage of this
event system.

## LifecycleEventManager

The [](jd:paper:io.papermc.paper.plugin.lifecycle.event.LifecycleEventManager) is tied
to either a [](jd:paper:org.bukkit.plugin.Plugin) instance or a
[](jd:paper:io.papermc.paper.plugin.bootstrap.BootstrapContext) depending on where you access it from. For example in your plugin's main class:

```java title="ExamplePlugin.java"
@Override
public void onEnable() {
    final LifecycleEventManager<Plugin> lifecycleManager = this.getLifecycleManager();
}
```

Or, with a bootstrapper:

```java title="ExamplePluginBootstrap.java"
@Override
public void bootstrap(final BootstrapContext context) {
    final LifecycleEventManager<BootstrapContext> lifecycleManager = context.getLifecycleManager();
}
```

## LifecycleEvents

After obtaining the correct `LifecycleEventManager`, create an event handler by selecting an
event type from [](jd:paper:io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents):
```java title="ExamplePlugin.java"
@Override
public void onEnable() {
    final LifecycleEventManager<Plugin> lifecycleManager = this.getLifecycleManager();
    final PrioritizedLifecycleEventHandlerConfiguration<LifecycleEventOwner> config = LifecycleEvents.SOME_EVENT.newHandler(event -> {
        // Handler for the event
    });
}
```

### Configuration

Each handler created can be configured in several ways. The available configuration options
depend on the event type itself and will vary from event type to event type.

#### Priority

Setting the priority of a handler can determine where it runs relative to other handlers
on the same event type. The lower the number, the earlier it will be run. The default priority
is 0.

#### Monitor

Marking the handler as a monitor will cause it to be called after all other non-monitor handlers
have been called. Only use this to inspect some state in the event. Do not modify any state in
the handler.

The priority and monitor state are exclusive options, setting one will reset the other.

```java title="ExamplePlugin.java"
@Override
public void onEnable() {
    final LifecycleEventManager<Plugin> lifecycleManager = this.getLifecycleManager();
    final PrioritizedLifecycleEventHandlerConfiguration<LifecycleEventOwner> config = LifecycleEvents.SOME_EVENT.newHandler(event -> {
        // Handler for the event
    });
    config.priority(10); // sets a priority of 10
    // or
    config.monitor(); // marks the handler as a monitor
}
```

### Registering

Once the handler has been configured, it can be registered with the lifecycle manager:

```java title="ExamplePlugin.java"
@Override
public void onEnable() {
    final LifecycleEventManager<Plugin> lifecycleManager = this.getLifecycleManager();
    final PrioritizedLifecycleEventHandlerConfiguration<LifecycleEventOwner> config = LifecycleEvents.SOME_EVENT.newHandler(event -> {
        // Handler for the event
    }).priority(10);
    lifecycleManager.registerEventHandler(config);
}
```
There is also a shorthand way to register just the handler without doing any configuration:

```java title="ExamplePlugin.java"
@Override
public void onEnable() {
    final LifecycleEventManager<Plugin> lifecycleManager = this.getLifecycleManager();
    lifecycleManager.registerEventHandler(LifecycleEvents.COMMANDS, event -> {
        // Handler for the event
    });
}
```

:::note

Some event types have special behaviors that restrict certain mechanics. The reloading plugins
functionality (via `/bukkit:reload` or `Server#reload()`) is disabled if plugins register handlers
in certain situations. This is due to the plugin reloads having to fully unload the plugin and its
classes which is an issue if an event has to run while the plugin is unloaded.

:::

## Why does this exist?

We already have an event system, why do we need another one? This is a fair question. The answer is
that some of these events fire well before `JavaPlugin` instances are created, before the
`MinecraftServer` instance is created, right at the very start of server startup. These can be
before all the registries have been initialized which is one of the first things to happen on a Vanilla
server. The existing Bukkit event system is not designed to exist at this time, and modifying it to
support this environment is more trouble than just having a separate system for specific events that
can fire during this early initialization.

:::note[Technical Explanation]

Here is an ever-expanding list of specific reasons why we can't just modify the existing event
system to support this new need for events:

- You cannot have generics on Bukkit events because there is 0 compile time checking since they are
  registered reflectively. This is a problem because the events are mostly going to follow a very
  similar pattern, specifically the registry events. If we can’t use generics, there’s going to be
  many useless classes.

- Another reason is that the existing system has priorities, but always has them. With the lifecycle
  events, there may be some events for which we do not want to support priorities (it would
  be based purely on plugin load order then).

- Exists too late. `HandlerList` and event registration all use the `Plugin` instance which does not exist,
  and cannot exist, during the bootstrapper. Changing this would require a substantial rewrite of the
  existing system and probably confuse API users who expect all `RegisteredListeners` to have a
  Plugin attached.

- A new system lets us use interfaces and server implementations for events which dramatically
  simplifies them. With the Bukkit system you could kind of do this with a server impl event
  extending the API event, but interfaces are more flexible.

- A new system lets us enforce, at compile time, which events you can register where based on the
  context of the registration. So you can’t even register a handler for an event in the wrong spot,
  that will be a compiler error thanks to our implementation using generics.

:::


---


# Project setup

Step-by-step instructions on how to set up a plugin development environment.

import { FileTree, Tabs, TabItem } from "@astrojs/starlight/components";
import { LATEST_PAPER_RELEASE, LATEST_PAPER_BUILD_API_VERSION} from "/src/utils/versions";

As the Paper team primarily uses [IntelliJ IDEA](https://www.jetbrains.com/idea/), this guide will be focused on that IDE.
However, the steps below should apply to other IDEs as well, with some minor changes.

The Paper team uses [Gradle](https://gradle.org/) as its build system, and its tools are implemented for Gradle.
Most of the code below can be altered to work with other build systems, such as Maven, but this guide will only cover Gradle
using the **Kotlin DSL**.

Follow the guide [here](https://docs.gradle.org/current/userguide/migrating_from_maven.html) to learn how to migrate from Maven to Gradle.

## Creating a new project

Open your IDE and select the option to create a new project.
In IntelliJ, you will get the option to select the type of project you want to create - select `New Project`.
Select `Gradle - Kotlin DSL` and click `Create`.

You will land into the `build.gradle.kts` file where you can add your dependencies.

### Adding Paper as a dependency

To add Paper as a dependency, you will need to add the Paper repository and dependency to your `build.gradle.kts` file.

:::tip

If you want to reference a specific build, you can do so by replacing the + with the build identifier
(i.e. `{VERSION}.build.25-stable` for the 25th stable build of a version). Before `26.1` (`1.21.11` and below), the
version string format used was `{VERSION}-R0.1-SNAPSHOT`, with no way to reference a specific build.

:::

<Tabs syncKey="build-system">
  <TabItem label="Gradle">
    ```kotlin title="build.gradle.kts" replace
    repositories {
      maven(url = "https://repo.papermc.io/repository/maven-public/") {
        name = "papermc"
      }
    }

    dependencies {
      compileOnly("io.papermc.paper:paper-api:\{LATEST_PAPER_RELEASE}.build.+")
    }

    java {
      toolchain.languageVersion.set(JavaLanguageVersion.of(25))
    }
    ```
  </TabItem>
  <TabItem label="Maven (Discouraged)">
    If you want dynamic latest build version resolution with Maven, you will need to define your
    version as a range: `[\{LATEST_PAPER_RELEASE}.build,)`. For a specific build, you can
    use the standard variant: `\{LATEST_PAPER_BUILD_API_VERSION}`.

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
          <groupId>io.papermc.paper</groupId>
          <artifactId>paper-api</artifactId>
          <version>[\{LATEST_PAPER_RELEASE}.build,)</version>
          <scope>provided</scope>
        </dependency>
      </dependencies>
    </project>
    ```
  </TabItem>
</Tabs>

### Setting up the `src` directory

:::note

If your IDE creates a `src` directory automatically, you can skip this step.

:::

To set up the `src` directory, you will need to create a new directory called `src` and then create a new directory called `main` inside of it.
Inside of `main`, create two new directories called `java` and `resources`.

It should look like this:

<FileTree>
  - example-plugin/
    - build.gradle.kts
    - settings.gradle.kts
    - src/
      - main/
        - java/
        - resources/
</FileTree>

### Setting up the `java` directory

You will place your Java source files in the `java` directory. You first need to create some packages to organize your code.
For this example, we will create three packages called `com.example.paperplugin` and then create a class called `ExamplePlugin` inside of it.

<FileTree>
  - example-plugin/
    - build.gradle.kts
    - settings.gradle.kts
    - src/
      - main/
        - java/
          - com/
            - example/
              - paperplugin/
                - ExamplePlugin.java
        - resources/
</FileTree>

### Packages

You can see here that the `ExamplePlugin` class is inside the `com.example.paperplugin` package.
A package is a way to organize your code - essentially, it's a folder. Java packages are used to group related classes.
Oracle has a guide on [packages](https://docs.oracle.com/javase/tutorial/java/package/packages.html) if you want to learn more.

When [naming](https://docs.oracle.com/javase/tutorial/java/package/namingpkgs.html) your packages, you should use your domain name in reverse order. For example, if your domain name is `example.com`,
your package name should be `com.example`. If you do not have a domain name, you could use something like your GitHub username.
If you were Linus Torvalds, your package would be `io.github.torvalds`.

This is then followed by the name of your project.
For example, if your project was called `ExamplePlugin`, your package would be `io.github.torvalds.exampleplugin`.
This allows for a unique package name for every plugin.

### The _main_ class

The main class is the entry point to your plugin and will be the only class that extends
[](jd:paper:org.bukkit.plugin.java.JavaPlugin) in your plugin. It is considered
good practice to **not** name this class `Main`. Instead, choose a more descriptive name,
like your plugin's name. If your plugin is called `Example`, your main class could be called
`ExamplePlugin`. An example implementation of this class might look like this:

```java title="ExamplePlugin.java" collapse={1-6} showLineNumbers
package com.example.paperplugin;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class ExamplePlugin extends JavaPlugin implements Listener {
    @Override
    public void onEnable() {
        this.getServer().getPluginManager().registerEvents(this, this);
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        event.getPlayer().sendPlainMessage("Hello, " + event.getPlayer().getName() + "!");
    }
}
```

### Setting up the `resources`

The `resources` directory is where you will place your plugin's `plugin.yml` file. See the [Plugin YML](/paper/dev/plugin-yml) page for more information.

## Using the Minecraft Development IntelliJ plugin

Alternatively, you can use the [Minecraft Development IntelliJ plugin](https://plugins.jetbrains.com/plugin/8327-minecraft-development)
to create a new project.

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
Once you have installed the plugin, you can create a new project by going to `File > New > Project...` and selecting `Minecraft` from the list of options.

![](./assets/new-project-paper.png)

You will be asked to provide some information about your project.

| Field                 | Explanation                                                                                                                                                                                                                                                          |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Name**              | The name of your project.                                                                                                                                                                                                                                            |
| **Location**          | The location of your project. This is where the project files will be stored.                                                                                                                                                                                        |
| **Platform Type**     | The platform type you are developing for. This should be `Plugin`.                                                                                                                                                                                                   |
| **Platform**          | The platform you are developing for. This should be `Paper`.                                                                                                                                                                                                         |
| **Minecraft Version** | The version of Minecraft you are developing for.                                                                                                                                                                                                                     |
| **Plugin Name**       | The name of your plugin.                                                                                                                                                                                                                                             |
| **Main Class**        | The main class of your plugin. This should be the class that extends `JavaPlugin`.                                                                                                                                                                                   |
| **Optional Settings** | Here you can define things like authors, website, description, etc. These are optional and not required for the plugin to work.                                                                                                                                      |
| **Build System**      | The build system you want to use. Paper recommends using Gradle but you can use Maven if you prefer.                                                                                                                                                                 |
| **Paper Manifest**    | Whether you want to use the new Paper plugins or not. For now this is not recommended as it is still in development.                                                                                                                                                 |
| **Group ID**          | The group ID of your project. This is used for Maven and Gradle. This is usually your domain name in reverse. If you don't know what you should put here, you can use something like `io.github.<yourname>` or if you don't have GitHub you can use `me.<yourname>`. |
| **Artifact ID**       | The artifact ID of your project. This is used for Maven and Gradle. This is usually the name of your project. This is usually the same as the `Name` field.                                                                                                          |
| **Version**           | The version of your project. This is used for Maven and Gradle. This is usually `1.0-SNAPSHOT` and does not really matter for now.                                                                                                                                   |
| **JDK**               | The JDK you want to use. This can be anything from Java 25 and above.                                                                                                                                                                                                |

Now you can click on the `Create` button and IntelliJ will create the project for you.
If everything went well, you should see something like this:

![](./assets/paper-plugin-overview.png)

## Conclusion

You should now have a project set up with Paper as a dependency.
All you have left to do now is to compile your plugin and run it on a Paper server.

:::note

If you want to streamline the process of testing a plugin, you can use the [Run-Task](https://github.com/jpenilla/run-task) Gradle plugin.
It will automatically download a Paper server and run it for you.

:::

:::note

If you are using IntelliJ, you can use the Gradle GUI `Build` menu to compile your plugin - found on the top right of your IDE.
The output JAR of your plugin will be in the `build/libs` directory.

:::


---


# Recipes

How to create and manage recipes.

Recipes are a way to define a way to craft a particular item. They are defined by a plugin or
datapack, however we are only going to cover the plugin side of things here.

## [](jd:paper:org.bukkit.inventory.ShapedRecipe)

A shaped recipe is a recipe that requires a specific pattern of items in the crafting grid to craft an item.
These are created using a pattern string and a map of characters to items. The pattern strings are 3,
3-character strings that represent the rows of the crafting grid. They can be created as follows:

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        NamespacedKey key = new NamespacedKey(this, "television");

        ItemStack result = ItemStack.of(Material.BLACK_WOOL);
        result.setData(DataComponentTypes.ITEM_NAME, Component.text("Television"));

        ShapedRecipe recipe = new ShapedRecipe(key, result);
        recipe.shape(
            "AAA",
            "ABA",
            "AAA"
        );
        recipe.setIngredient('A', Material.WHITE_CONCRETE);
        recipe.setIngredient('B', Material.BLACK_STAINED_GLASS_PANE);

        this.getServer().addRecipe(recipe);
    }
}
```

This recipe would require a television to be crafted with one black stained glass pane surrounded
by white concrete. The recipe would look like this in the crafting grid:

```
AAA
ABA
AAA
```

<!-- TODO: this note is outdated for recent version, see the TODO in Server#addRecipe which now always resend recipes must wait once this one is resolved -->
:::note

You do not need to register the recipe within your plugin's `onEnable` method, You can register it
at any time. However, if you do not register it after the plugin has been enabled and there are
players online, you will need to either resend all the recipes to the players or use the boolean
parameter in the [`addRecipe`](jd:paper:org.bukkit.Server#addRecipe(org.bukkit.inventory.Recipe,boolean))
method to update all players with the new recipe.

:::

:::caution

You cannot use `minecraft:air` as an ingredient in a shaped recipe, this will cause an error instead just leave a space in the shape pattern.

:::

## [](jd:paper:org.bukkit.inventory.ShapelessRecipe)

A shapeless recipe is a recipe that requires a specific number of items in the crafting grid to craft an item.
These are created using a list of items. They can be created as follows:

```java title="ExamplePlugin.java"
public final class ExamplePlugin extends JavaPlugin {

    @Override
    public void onEnable() {
        NamespacedKey key = new NamespacedKey(this, "warrior_sword");
        ItemStack result = ItemStack.of(Material.DIAMOND_SWORD);

        ShapelessRecipe recipe = new ShapelessRecipe(key, result);
        recipe.addIngredient(3, Material.DIAMOND);
        recipe.addIngredient(2, Material.STICK);

        this.getServer().addRecipe(recipe);
    }
}
```

This recipe declares that you simply need 3 diamonds and 2 sticks to craft the item, without any specific
orientation of the cross pattern in the crafting grid. This could be crafted in any of the following ways:
```
  DSS   |   SDS   |   S D
  D     |   D     |   D
  D     |   D     |   D S
```
And, any other composition of the 5 items.


---


# Registries

A guide to registries and their modification on Paper.

:::danger[Experimental]
The Registry API and anything that uses it is currently experimental and may change in the future.
:::

## What is a registry?

In the context of Minecraft, a registry holds onto a set of values of the same type, identifying
each by a key. An example of such a registry would be the [ItemType registry](jd:paper:org.bukkit.Registry#ITEM) which holds all known item types.
Registries are available via the [](jd:paper:io.papermc.paper.registry.RegistryAccess) class or statically for built-in registries via [](jd:paper:org.bukkit.Registry).

While a large portion of registries are defined by the server and client independently, more and
more are defined by the server and sent to the client while joining the server.
This enables the server, and to that extent plugins, to define custom content for both itself and
clients playing on it.
Notable examples include **enchantments** and **biomes**.

### Retrieving values from a registry

To retrieve elements from a registry, their respective keys can be used.
The API defines two types of keys.
- [](jd:adventure:net.kyori.adventure.key:net.kyori.adventure.key.Key) represents a namespace and a value.
- [](jd:paper:io.papermc.paper.registry.TypedKey) wraps an Adventure key,
  but also includes the [key of
  the registry](jd:paper:io.papermc.paper.registry.TypedKey#registryKey()) the
  [](jd:paper:io.papermc.paper.registry.TypedKey) belongs to.

An example of retrieving the `Sharpness` enchantment using
[TypedKeys](jd:paper:io.papermc.paper.registry.TypedKey) looks as follows:

```java
// Fetch the enchantment registry from the registry access.
// For built-in registries the constants provided by the Registry class are equivalent.
final Registry<Enchantment> registry = RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);

// Get the sharpness enchantment using its key.
// getOrThrow may be replaced with get if the registry may not contain said value
final Enchantment enchantment = registry.getOrThrow(TypedKey.create(
    RegistryKey.ENCHANTMENT, Key.key("minecraft:sharpness"))
);

// Same as above, but using the instance's method
final Enchantment enchantment = registry.getOrThrow(
    RegistryKey.ENCHANTMENT.typedKey(Key.key("minecraft:sharpness"))
);

// Same as above, but using generated create method
// available for data-driven registries or "writable" ones
// (those bound to a lifecycle event in RegistryEvents).
final Enchantment enchantment = registry.getOrThrow(
    EnchantmentKeys.create(Key.key("minecraft:sharpness"))
);

// Same as above too, but using generated typed keys.
// Only Vanilla entries have generated keys, for custom entries, the above method must be used.
final Enchantment enchantment = registry.getOrThrow(EnchantmentKeys.SHARPNESS);
```

### Referencing registry values

Referencing entries in a registry is easier said than done.
While in most cases, a plain [](jd:java:java.util.Collection) of the values might suffice, alternative approaches are
more often used by Minecraft and will hence be encountered.

A [](jd:paper:io.papermc.paper.registry.set.RegistrySet) defines a
collection of elements that *relate* to a registry.

Its most common subtype is the
[](jd:paper:io.papermc.paper.registry.set.RegistryKeySet) which
simply holds onto [](jd:paper:io.papermc.paper.registry.TypedKey) instances.
An advantage of this data structure is its ability to remain valid even if the values of a
registry change.

A [](jd:paper:io.papermc.paper.registry.set.RegistryKeySet) can be
created via the factory methods on [](jd:paper:io.papermc.paper.registry.set.RegistrySet) like this:
```java
// Create a new registry key set that holds a collection enchantments
final RegistryKeySet<Enchantment> bestEnchantments = RegistrySet.keySet(
    RegistryKey.ENCHANTMENT,
    // Arbitrary keys of enchantments to store in the key set.
    EnchantmentKeys.CHANNELING,
    EnchantmentKeys.create(Key.key("papermc:softspoon"))
);
```

A [](jd:paper:io.papermc.paper.registry.tag.Tag) follows up the concept
of a [](jd:paper:io.papermc.paper.registry.set.RegistryKeySet)
but is itself named and can hence be referenced.
A list of Vanilla tags can be found [on the Minecraft Wiki](https://minecraft.wiki/w/Tag_(Java_Edition)#List_of_tag_types).

## Mutating registries

Beyond plain reading access to registries, Paper also offers a way for plugins to modify registries.

:::caution
Mutating registries needs to be done during the server's bootstrap phase.
As such, this section is only applicable to [Paper plugins](/paper/dev/getting-started/paper-plugins).

**Exceptions** thrown by plugins during this phase will cause the server to shutdown before loading,
as missing values or modifications to the registries would otherwise cause data loss.
:::

:::note
Mutating registries is done via the
[](jd:paper:io.papermc.paper.plugin.lifecycle.event.LifecycleEventManager).
See the [Lifecycle Events](/paper/dev/lifecycle) page for more information.
:::

The general entrypoint for mutating registries is
the [](jd:paper:io.papermc.paper.registry.event.RegistryEvents) type,
which provides an entry point for each registry that can be modified.
Modification of a registry can take two different forms.

### Create new entries

Creating new entries is done via the [`compose` lifecycle event](jd:paper:io.papermc.paper.registry.event.RegistryEventProvider#compose())
on the respective registries.
The compose event is called after a registry's content has been loaded from "vanilla" sources, like the built-in
datapack or any detected, enabled, datapacks. Plugins can hence register their own entries at this point.
The following example shows how to create a new enchantment:

```java title="ExamplePluginBootstrap.java"
public final class ExamplePluginBootstrap implements PluginBootstrap {

    @Override
    public void bootstrap(final BootstrapContext context) {
        // Register a new handler for the compose lifecycle event on the enchantment registry
        context.getLifecycleManager().registerEventHandler(RegistryEvents.ENCHANTMENT.compose(), event -> {
            event.registry().register(
                // The key of the registry
                // Plugins should use their own namespace instead of minecraft or papermc
                EnchantmentKeys.create(Key.key("papermc:pointy")),
                b -> b.description(Component.text("Pointy"))
                    .supportedItems(event.getOrCreateTag(ItemTypeTagKeys.SWORDS))
                    .anvilCost(1)
                    .maxLevel(25)
                    .weight(10)
                    .minimumCost(EnchantmentRegistryEntry.EnchantmentCost.of(1, 1))
                    .maximumCost(EnchantmentRegistryEntry.EnchantmentCost.of(3, 1))
                    .activeSlots(EquipmentSlotGroup.ANY)
            );
        });
    }
}
```

### Modifying existing entries

Modification of existing entries is useful for plugins that aim to change the way Vanilla entries
behave. For this, use the [`entryAdd` lifecycle event](jd:paper:io.papermc.paper.registry.event.RegistryEventProvider#entryAdd()).
The event is called for _\*any\*_ entry added to a registry, however the API provides an easy way to target a specific entry for modification.
The following example shows how to increase the maximum level of the `Sharpness` enchantment.

```java
@Override
public void bootstrap(final BootstrapContext context) {
    context.getLifecycleManager().registerEventHandler(RegistryEvents.ENCHANTMENT.entryAdd()
        // Increase the max level to 20
        .newHandler(event -> event.builder().maxLevel(20))
        // Configure the handler to only be called for the Vanilla sharpness enchantment.
        .filter(EnchantmentKeys.SHARPNESS)
    );
}
```


---


# Roadmap

Outlines the future intents and plans of the Paper project.

Paper offers a rich API with a wide range of features that can help you unlock the full potential of your server.
However, in order to make room for new features and improvements, some of the older APIs will be phased out. This page
is intended to document any future API changes that are planned or possible deprecations that may be coming up.

## Future plans

### Interface `ItemStack`s

When you create `ItemStack`s using the constructor, you create an API representation of an [](jd:paper:org.bukkit.inventory.ItemStack).
This is an object that delegates to a NMS-backed object, you should instead use [`ItemStack#of`](jd:paper:org.bukkit.inventory.ItemStack#of(org.bukkit.Material)) to get the NMS-backed object directly.

In the future, `ItemStack` will be converted to an interface and the constructor will be removed.

#### Precautions

- Avoid directly extending the `ItemStack` class.
  - Custom implementations of this class are not supported and **will** break.

### `ServerPlayer` reuse
*Note: Only applies to NMS usage, will not apply to API.*

Avoid directly storing player (`ServerPlayer`) entity instances. Currently, the player instance is reused when switching
worlds, however, in the future, this behavior will be reverted to match Vanilla behavior. API entities (wrappers) will
continue to function and will have their underlying instance replaced automatically.

This is done to help reduce possible inconsistencies between world switching between Vanilla and Paper.

## Deprecation policy

:::caution

It is highly recommended that you avoid using any APIs that are marked as deprecated.

:::

If you continue to use deprecated APIs, your server may become unstable and may not function as expected.
You may also experience performance issues and other problems. To ensure the best possible experience and longevity
of your plugins, it is important to stay up-to-date with the latest API changes and avoid using any APIs
that are marked for deprecation.

API marked with [`@Deprecated`](jd:java:java.lang.Deprecated) should not be used in your code base,
as alternative API may be able to be used instead. While certain API may continue to function despite being deprecated,
it **cannot** be promised that this API won't be marked as deprecated for removal in the future.
```java
@Deprecated
public void exampleMethod(); // Example deprecated method
```

### Deprecated for removal

In addition to being marked as `@Deprecated`, API may be marked as `forRemoval` with a given
[`@ApiStatus.ScheduledForRemoval`](https://javadoc.io/doc/org.jetbrains/annotations/latest/org/jetbrains/annotations/ApiStatus.ScheduledForRemoval.html) version.
API scheduled for removal should only occur within major release versions of Minecraft.
It is highly recommended you migrate away from API scheduled for removal.

It should be noted, that API scheduled for removal will be given adequate time to allow plugin developers to migrate
away from said API.
```java
@ApiStatus.ScheduledForRemoval(inVersion = "1.20")
@Deprecated(forRemoval = true)
public void exampleMethod(); // Example method marked for removal in 1.20
```

## Deprecation reasons

There are many possible reasons why an API might be deprecated.
Some of the common reasons why API can be deprecated is:

### Old API

As the game evolves, the API may represent concepts that no longer exist in the core game.

Old API is most likely not functional and/or may behave unexpectedly in newer versions of the game,
therefore it may be scheduled for removal.

### Duplicate API

Since Paper used to downstream Spigot, it can occasionally include APIs added by Spigot that clash with what Paper already has.
Typically, Paper will deprecate Spigot’s API in favor of their own API.

However, in cases where upstream offers a more powerful API, Paper’s may be deprecated instead.

### Obsolete API
Paper strives to improve on APIs that may already be included. There may be some cases where we have built new
APIs to offer as a replacement to another.

Obsolete API is expected for function for the far future and may not be scheduled for removal
for a fair amount of time.


---


# Scheduling

A guide on how to use BukkitScheduler to run code at specific times.

The [](jd:paper:org.bukkit.scheduler.BukkitScheduler) can be used to schedule your code to be run later or repeatedly.

:::note[Folia]

This guide is designed for non-Folia Bukkit servers. If you are using Folia, you should use its respective schedulers.

:::

## What is a tick?

Every game runs something called a game loop, which essentially executes all the logic of the game over and over.
A single execution of that loop in Minecraft is called a 'tick'.

In Minecraft, there are 20 ticks per second or in other words, one tick every 50 milliseconds. This means that the game loop is executed
20 times per second. A tick taking more than 50ms to execute is the moment when your server starts to fall behind on
its work and lag.

A task that should run after 100 ticks will run after 5 seconds (100 ticks / 20 ticks per second = 5 seconds). However,
if the server is only running at 10 ticks per second, a task that is scheduled to run after 100 ticks will take 10
seconds.

### Converting between human units and Minecraft ticks

Every method of the scheduler that takes a delay or period uses ticks as a unit of time.

Converting from human units to ticks and back is as simple as:
- `ticks = seconds * 20`
- `seconds = ticks / 20`

You can make your code more readable by using the
[](jd:java:java.util.concurrent.TimeUnit)
enum, e.g. to convert 5 minutes to ticks and back:
- `TimeUnit.MINUTES.toSeconds(5) * 20`
- `TimeUnit.SECONDS.toMinutes(ticks / 20)`

You can also use the `Tick` class from Paper to convert between human units and ticks, e.g. to convert 5 minutes to ticks:
`Tick.tick().fromDuration(Duration.ofMinutes(5))` will yield `6000` ticks.

## Obtaining the scheduler

To obtain a scheduler, you can use the [`getScheduler`](jd:paper:org.bukkit.Server#getScheduler()) method
on the [](jd:paper:org.bukkit.Server) class, e.g. in your `onEnable` method:

```java
@Override
public void onEnable() {
    BukkitScheduler scheduler = this.getServer().getScheduler();
}
```

## Scheduling tasks

Scheduling a task requires you to pass:

- Your plugin's instance
- The code to run, either with a [](jd:java:java.lang.Runnable)
or <code>[Consumer](jd:java:java.util.function.Consumer)<[BukkitTask](jd:paper:org.bukkit.scheduler.BukkitTask)></code>
- The delay in ticks before the task should run for the first time
- The period in ticks between each execution of the task, if you're scheduling a repeating task

### Difference between synchronous and asynchronous tasks

#### Synchronous tasks (on the main thread)

Synchronous tasks are tasks that are executed on the main server thread. This is the same
thread that handles all game logic.

All tasks scheduled on the main thread will affect the server's performance. If your task
is making web requests, accessing files, databases or otherwise time-consuming operations, you should consider using
an asynchronous task.

#### Asynchronous tasks (off the main thread)

Asynchronous tasks are tasks that are executed on separate threads, therefore will not directly affect
your server's performance.

:::caution

**Large portions of the Bukkit API are not safe to use from within asynchronous tasks**. If a method changes or
accesses the world state, it is not safe to be used from an asynchronous task.

:::

:::note

While the tasks are executed on separate threads, they are still started from the main thread
and will be affected if the server is lagging, an example would be 20 ticks not being exactly 1 second.

If you need a scheduler that runs independently of the server, consider using your own
[](jd:java:java.util.concurrent.ScheduledExecutorService).
You can follow [this guide](https://www.baeldung.com/java-executor-service-tutorial#ScheduledExecutorService) to learn how to use it.

:::

### Different ways to schedule tasks

#### Using `Runnable`

The [](jd:java:java.lang.Runnable) interface is used for the simplest tasks
that don't require a [](jd:paper:org.bukkit.scheduler.BukkitTask) instance.

You can either implement it in a separate class, e.g.:

```java title="MyRunnableTask.java"
public class MyRunnableTask implements Runnable {

    private final MyPlugin plugin;

    public MyRunnableTask(MyPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public void run() {
        this.plugin.getServer().broadcast(Component.text("Hello, World!"));
    }
}
```
```java
scheduler.runTaskLater(plugin, new MyRunnableTask(plugin), 20);
```

Or use a lambda expression, which is great for simple and short tasks:

```java
scheduler.runTaskLater(plugin, /* Lambda: */ () -> {
    plugin.getServer().broadcast(Component.text("Hello, World!"));
}, /* End of the lambda */ 20);
```

#### Using `Consumer<BukkitTask>`

The [](jd:java:java.util.function.Consumer) interface is used for tasks
that require a [](jd:paper:org.bukkit.scheduler.BukkitTask) instance (usually in repeated tasks),
e.g. when you want to cancel the task from inside it.

You can either implement it in a separate class similarly to the `Runnable`, e.g.:

```java title="MyConsumerTask.java"
public class MyConsumerTask implements Consumer<BukkitTask> {

    private final UUID entityId;

    public MyConsumerTask(UUID entityId) {
        this.entityId = entityId;
    }

    @Override
    public void accept(BukkitTask task) {
        Entity entity = Bukkit.getServer().getEntity(this.entityId);

        if (entity instanceof LivingEntity livingEntity) {
            livingEntity.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 20, 1));
            return;
        }

        task.cancel(); // The entity is no longer valid, there's no point in continuing to run this task
    }
}
```
```java
scheduler.runTaskTimer(plugin, new MyConsumerTask(someEntityId), 0, 20);
```

Or use a lambda expression, which again is much cleaner for short and simple tasks:

```java
scheduler.runTaskTimer(plugin, /* Lambda: */ task -> {
    Entity entity = Bukkit.getServer().getEntity(entityId);

    if (entity instanceof LivingEntity livingEntity) {
        livingEntity.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 20, 1));
        return;
    }

    task.cancel(); // The entity is no longer valid, there's no point in continuing to run this task
} /* End of the lambda */, 0, 20);
```

##### Using `BukkitRunnable`

[](jd:paper:org.bukkit.scheduler.BukkitRunnable) is a class that implements `Runnable`
and holds a `BukkitTask` instance. This means that you do not need to access the task from inside the `run()` method,
you can simply use the [`this.cancel()`](jd:paper:org.bukkit.scheduler.BukkitRunnable#cancel()) method:

```java title="CustomRunnable.java"
public class CustomRunnable extends BukkitRunnable {

    private final UUID entityId;

    public CustomRunnable(UUID entityId) {
        this.entityId = entityId;
    }

    @Override
    public void run() {
        Entity entity = Bukkit.getServer().getEntity(this.entityId);

        if (entity instanceof LivingEntity livingEntity) {
            livingEntity.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 20, 1));
            return;
        }

        this.cancel(); // The entity is no longer valid, there's no point in continuing to run this task
    }
}
```

This simply adds a potion effect until the entity dies.

#### Using a delay of 0 ticks

A delay of 0 ticks is treated as you wanting to run the task on the next tick. If you schedule a task with a delay of 0 ticks
while the server is starting, or before it is enabled, it will be executed before the server is enabled.


---


# paperweight-userdev

A guide on how to use the paperweight-userdev Gradle plugin to access internal code.

**paperweight** is the name of Paper's custom build tooling. The **paperweight-userdev** Gradle plugin part of that
provides access to internal code (also known as NMS) during development.

:::note

This guide is written using the Gradle Kotlin DSL and assumes you have some basic knowledge of Gradle.
If you want to see a fully-functioning plugin that uses **paperweight-userdev**,
check out this [example plugin](https://github.com/PaperMC/paperweight-test-plugin).

:::

## Why this is useful
This is the only supported way of accessing server internals, as redistributing the server JAR is against the
Minecraft EULA and general license assumption. Even if you manually depended on the patched server, you would be
hindering other people working on your project and would be missing deployed API javadocs/sources in your IDE.

On top of that, Spigot and pre-1.20.5 Paper versions still use Spigot mappings, which are a mix of obfuscated fields/methods
and mapped as well as custom named classes. This can make it hard to work with in a development environment. This plugin lets you use
fully deobfuscated types, names, and fields during development, and then remaps your plugin, so it can still be used with the obfuscated
server. However, this does not apply to reflection. Look at something like [this library](https://github.com/jpenilla/reflection-remapper) to be able to
use non-obfuscated names in reflection if you want to support obfuscated servers.

:::note[Removal of obfuscations in 26.1]

From Minecraft version **26.1** onwards, Paper no longer supports obfuscated plugins due to Mojang themselves
removing obfuscation of their server JAR. As Minecraft now ships unobfuscated, there are no 26.1 Spigot mappings
to obfuscate to. For this reason, the reobfuscation function no longer works for dev bundles for 26.1+.

:::

## Adding the plugin
Add the plugin to your `build.gradle.kts` file.

```kts title="build.gradle.kts" replace
plugins {
  id("io.papermc.paperweight.userdev") version "\{LATEST_USERDEV_RELEASE}"
}
```

:::note[Gradle Version]

Please make sure you are using the latest stable version of Gradle.
For more information on upgrading Gradle, check out the [Gradle Wrapper documentation](https://docs.gradle.org/current/userguide/gradle_wrapper.html).

:::

The latest version of `paperweight-userdev` supports dev bundles for Minecraft 1.17.1 and newer, so it's best practice to keep it up to date!
Only the latest version of `paperweight-userdev` is officially supported, and we will ask you to update first if you are having problems with old versions.
Furthermore, if you are having issues with `paperweight-userdev`, you should ask in the
[`#build-tooling-help`](https://discord.com/channels/289587909051416579/1078993196924813372) channel in our dedicated [Discord server](https://discord.gg/PaperMC)!

:::note[Snapshots]

**paperweight-userdev** SNAPSHOT (pre-release) versions are only available through Paper's Maven repository.
```kotlin title="settings.gradle.kts"
pluginManagement {
  repositories {
    gradlePluginPortal()
    maven("https://repo.papermc.io/repository/maven-public/")
  }
}
```

:::

## Adding the dev bundle dependency
If you try to load your Gradle project now, you will receive an error saying you have to declare
a dev bundle dependency. You can do that by adding to your `dependencies` block in your `build.gradle.kts`
file.

```kotlin title="build.gradle.kts" replace
dependencies {
  // Other Dependencies
  paperweight.paperDevBundle("\{LATEST_PAPER_RELEASE}.build.+")
}
```

:::tip

You should remove any dependency on the Paper API, as the dev bundle includes that.

:::

:::note[Configuring the Java toolchain for userdev setup]

A given dev bundle may not always support the Java toolchain Gradle is configured to use
(whether configured explicitly or inherited from the Gradle runtime).
If you are getting an error during the execution of `paperweightUserdevSetup` (especially patch application failures),
you can try setting paperweight's `javaLauncher` property to a different Java version.

For example, with 1.17.1:
```kts title="build.gradle.kts"
paperweight {
  javaLauncher = javaToolchains.launcherFor {
    // Example scenario:
    // Paper 1.17.1 was originally built with JDK 16 and the bundle
    // has not been updated to work with 21+ (but we want to compile with a 25 toolchain)
    languageVersion = JavaLanguageVersion.of(17)
  }
}
```

Among others, the [multi-project branch of the PaperMC/paperweight-test-plugin](https://github.com/PaperMC/paperweight-test-plugin/tree/multi-project)
makes use of this feature.

:::

## Reobfuscation (up to 1.21.11)

:::danger

Since Minecraft version **26.1**, Paper no longer supports remapping your plugin to Spigot
runtime mappings. This section is kept as a reference for older versions, however
reobfuscated plugins will not work from Paper 26.1 onwards!

:::

The `reobfJar` task creates a plugin JAR that is re-obfuscated to Spigot's runtime mappings.
This means it will work on standard Paper servers.

The output will be inside the `build/libs` folder. The JAR whose filename includes `-dev`
is Mojang-mapped (not re-obfuscated) and will not work on non-Paper servers.

:::note[Shadow]

If you have the shadow Gradle plugin applied in your build script, **paperweight-userdev** will
detect that and use the shaded JAR as the input for the `reobfJar` task.

The `-dev-all.jar` file in `build/libs` is the shaded, but not re-obfuscated JAR.

:::

You can make the `reobfJar` task run on the default `build` task with:
```kotlin title="build.gradle(.kts)"
tasks.assemble {
  dependsOn(tasks.reobfJar)
}
```

### 1.20.5 to 1.21.11

As of 1.20.5, Paper ships with a Mojang-mapped runtime instead of re-obfuscating the server to Spigot mappings.
Additionally, CraftBukkit classes will no longer be relocated into a versioned package.
This requires plugins to be deobfuscated before loading when necessary.

Most of this process is done automatically by paperweight, but there are some important things to know when using server internals (or "NMS") from now on.

#### Default mappings assumption

* By default, all Spigot/Bukkit plugins will be assumed to be Spigot-mapped if they do not specify their mappings namespace in the manifest.
  The other way around, all Paper plugins will be assumed to be Mojang-mapped if they do not specify their mappings namespace in the manifest.
* Spigot-mapped plugins will need to be deobfuscated on first load, Mojang-mapped plugins will not.

#### Compiling to Mojang mappings

:::note

This is the preferred option, as the one-time plugin remapping process during server startup will be skipped and it
may allow you to keep version compatibility across smaller updates without changes or additional modules.
However, this makes your plugin incompatible with Spigot servers.

:::

If you want your main output to use Mojang mappings, you need to remove all `dependsOn(reobfJar)` lines and add the following code to your build script:

```kotlin title="build.gradle.kts"
paperweight.reobfArtifactConfiguration = io.papermc.paperweight.userdev.ReobfArtifactConfiguration.MOJANG_PRODUCTION
```

#### Compiling to Spigot mappings

If you want your main output to use Spigot mappings, add the following code to your build script:

```kotlin title="build.gradle.kts"
paperweight.reobfArtifactConfiguration = io.papermc.paperweight.userdev.ReobfArtifactConfiguration.REOBF_PRODUCTION
```

This is useful for plugins that have loaders for both Spigot and Paper and want to keep compatibility with both.

:::note

If you are using Gradle with the Groovy DSL, you should instead access the fields via static methods like `getMOJANG_PRODUCTION()`.

:::


---


# Getting started

How to get started with downloading and setting up a Paper server.

## Requirements

:::tip

Paper requires at least **Java 25** to run, which [is easy to download and install](/misc/java-install).

:::

| Paper Version     | Recommended Java Version |
|-------------------|--------------------------|
| 1.7.10 to 1.11    | Java 8                   |
| 1.12 to 1.16.4    | Java 11                  |
| 1.16.5            | Java 16                  |
| 1.17 to 1.19      | Java 17                  |
| 1.20 to 1.21.11   | Java 21                  |
| 26.1+             | Java 25                  |

## Downloading Paper

Paper provides runnable server JARs directly from our
[website's downloads page](https://papermc.io/downloads/paper).

Click on the build number to download a file.

## Running the server

To run the server you will need to either create a startup script
or run a command in your terminal.

You can generate a startup script using our [Startup Script Generator](/misc/tools/start-script-gen).
You can also obtain the optimized terminal command to run the server there.

If you're just looking for a short command:
```bash
java -Xms4G -Xmx4G -jar paper.jar --nogui
```
Ensure you navigated your terminal to the directory of your server
and that you have replaced `paper.jar` with the name of the JAR you have downloaded.

The amount of RAM can be set by changing the numbers in the `Xmx` and `Xms` arguments.
`--nogui` disables Vanilla's GUI, so you don't get double interfaces when using the command line.

To configure your server, see the [Global Configuration](/paper/reference/global-configuration) and
[Per World Configuration](/paper/reference/world-configuration) pages.

## Updating the server

Updating Paper is simple! See our [Update Tutorial](/paper/updating) for more information.

## Migrating to Paper

### From Vanilla

Migrating from Vanilla is easy, but there are some differences, namely in world saves. Paper allows dimensions to have independent data (like gamerules).

Paper will handle this conversion for you automatically. No additional consideration is required.

### From CraftBukkit or Spigot

Paper is a drop-in replacement for both CraftBukkit and Spigot, you don't need to make any changes.

## Next steps

Take a look at our [Next Steps](/paper/next-steps) guide to get your server up and running with the best performance and
features.


---


# Migrating to or from Paper

It's simple to migrate your server to or from Paper. This page will help you get started.

It's simple to migrate your server to or from Paper. The steps below will help you get started.

:::caution[Backup your data before you start!]

Before you begin, please ensure you have a full backup of your server.

See our [Backup Guide](/paper/updating#step-1-backup) for more information.

:::

## Migrating to Paper

### From Vanilla

When migrating to Paper from Vanilla, the way worlds are stored will automatically be changed.
Should you ever want to go back to Vanilla, follow the [Vanilla Migration Guide](#to-vanilla)
closely, as manual changes will be required.

1. Stop your Vanilla server if it is running, and create a full backup.
2. Download Paper from [our downloads page](https://papermc.io/downloads) and replace your Vanilla
   server JAR with your freshly downloaded Paper JAR.
3. Rename the downloaded file to match the name specified in
   the [start command](/paper/getting-started#running-the-server).
4. Start your new Paper server.

You have now successfully migrated to Paper. If you encounter any issues, do not hesitate to reach
out for support on [our Discord server](https://discord.gg/papermc) (`#paper-help` channel).

### From Fabric/Forge

Because both Fabric and Forge use the Vanilla world directory structure, the same steps as the
[Vanilla Migration Guide](#from-vanilla) may be used, with one caveat. If your Fabric or Forge
server used mods that added new blocks, items, or other data to the game, Paper will be unable to
load these features.

Additionally, note that Paper does not support Fabric or Forge mods. You will need to find plugin
replacements. Any hybrids that attempt to support both mods and plugins are fundamentally flawed and
not recommended for use.

### From Spigot/CraftBukkit

Spigot and CraftBukkit modify the Vanilla world directory structure, making a direct migration as of `26.1`
fundamentally impossible. If you wish to migrate from Spigot/CraftBukkit anyway, you will
first need to **migrate from Spigot/CraftBukkit to Vanilla**, after which you can safely follow
the [Vanilla Migration Guide](#from-vanilla). For instructions on how to do this, please
refer to the Spigot documentation.

## Migrating from Paper

### To Vanilla

Because Paper shares a similar world structure to Vanilla, all you need to do is move around some files.
The following list shows which files you will need to move where. **Before you move around any files,
make sure your server is fully stopped**.

:::note

These steps assume a `level-name` (as set in `server.properties`) of `world`. If this is not the
case for you, replace `world` with your `level-name` for all steps below.

:::

The following files will need to be moved **from** `world/dimensions/minecraft/overworld/data/minecraft/`
**into** `world/data/minecraft/`:

- `game_rules.dat`
- `scheduled_events.dat`
- `wandering_trader.dat`
- `weather.dat`
- `world_gen_settings.dat`

After you have moved these files, you can now replace the Paper server JAR with a Vanilla server JAR
and start your Vanilla server!

### To Fabric/Forge

Because both Fabric and Forge use the same directory structure for world storage as Vanilla, follow
the [Vanilla Migration Guide](#to-vanilla) for this process. Note that neither Fabric nor Forge will
support Paper plugins! You will be required to find replacement mods.

## Other Migration

:::caution

The guides below display outdated information no longer relevant for modern Paper servers. They are
kept for historical purposes and people still using older versions. Please note that you will
**not receive support for using outdated versions.**

:::

### To Vanilla (pre 26.1)

Because Paper stores worlds slightly differently than Vanilla, manual work is required to migrate.
If these steps are not taken, your nether and end will look like they have been reset. Don't worry!
Even if this has happened, you haven't lost any data. The Vanilla server just doesn't know where to
find it.

Here is a chart to show the difference between how Vanilla and Paper store worlds.

| Server Software | Overworld | Nether                | End                   |
|-----------------|-----------|-----------------------|-----------------------|
| Vanilla         | `/world`  | `/world/DIM-1`        | `/world/DIM1`         |
| Paper           | `/world`  | `/world_nether/DIM-1` | `/world_the_end/DIM1` |

Follow these steps to migrate from Paper to Vanilla:

:::note

These steps assume a `level-name` (as set in `server.properties`) of `world`. If this is not the
case for you, replace `world` with your `level-name` for all steps below.

:::

1. Stop your Paper server, if it is running.
2. If you have already started your server with Vanilla, enter the `world` folder and delete both
   the `DIM-1` and `DIM1` folders. This step is only necessary should you have started your server
   with Vanilla.
3. Copy the `/world_nether/DIM-1` folder into the `/world` folder.
4. Copy the `/world_the_end/DIM1` folder into the `/world` folder.
5. Delete both the `/world_nether` and `/world_the_end` folders.
6. Replace your Paper JAR with a Vanilla server JAR.
7. Start your Vanilla server.

### To CraftBukkit or Spigot

Paper does **not** support migration to either CraftBukkit or Spigot!
While you may find success, **do not** reach out for
support with issues you encounter and note that data loss is possible.


---


# Bug fixes

An explanation of which Vanilla bugs we fix in Paper.

Paper fixes many gameplay and technical issues within Minecraft. The most prevalent fixes are to TNT duplication and bedrock breaking.

## Vanilla bug fixes

Paper fixes many Vanilla bugs that were not intended by Mojang. These bugs are patched to fix behavior or prevent abuse and
instability on the server. Some of our fixes are configurable, as we understand that some servers may want to keep the
Vanilla behavior. You will find these configuration options in the [global configuration](/paper/reference/global-configuration)
and the [world configuration](/paper/reference/world-configuration).

### What is intended behavior vs a bug?

When an issue is reported to us, we check Mojang's issue tracker. If the problem has been reported there, then we
check to see if it:

1) Has been confirmed as a bug
2) Has an assigned priority to it

If it meets these two criteria then we will accept changes to fix the bug, as it can take a long time for Mojang to fix
them (sometimes years). If an issue gets declined by Mojang, we normally do not "fix" it as it is intended behavior.

## Duplication bugs

Because TNT duping is considered a form of automated mining and not a resource dupe, we have provided an option to
restore it. This, undesirably, also re-enables carpet and rail duping, which normally we would not provide a config for,
but it's the same bug for those, so we have no choice. However, the config option is as follows:

```yaml title="config/paper-global.yml"
unsupported-settings:
  allow-piston-duplication: true
```

We also allow you to restore the ability to duplicate gravity blocks, such as sand, using end portals. This is not
recommended, as it can cause issues with the server, but we do provide a config option to restore this functionality:
```yaml title="config/paper-global.yml"
unsupported-settings:
  allow-unsafe-end-portal-teleportation: true
```

If you wish to re-enable tripwire hook duping exploits, you may do so by enabling the following config option:
```yaml title="config/paper-global.yml"
unsupported-settings:
  skip-tripwire-hook-placement-validation: true
```

:::caution
Enabling this option does not guarantee that every tripwire hook duplicator design will work.
Designs that rely on a same-tick door update may still fail because of Paper's block physics handling. See
[the maintainer explanation](https://github.com/PaperMC/Paper/issues/12114#issuecomment-2660579220)
for more context. The [original implementation](https://github.com/PaperMC/Paper/pull/12091)
was tested using [this duplicator design](https://www.youtube.com/watch?v=sRYuZn4r9RY).
:::

## Block breaking

We also fix the ability to break Bedrock and End Portal frames. We do also provide a config option to restore this
functionality, but it is not recommended:
```yaml title="config/paper-global.yml"
unsupported-settings:
  allow-permanent-block-break-exploits: true
```

## Afterword

We will not support you if you have issues whilst these settings are enabled, as they can cause unintended side effects.
These settings are also not guaranteed to be supported in the future and may have their behavior changed, or removed, at any time.

For legacy reasoning behind not having configuration options for many duplication bugs, see:
[#3724](https://github.com/PaperMC/Paper/issues/3724)


---


# Update checker

Documentation for Paper's built-in automatic update checker.

Since 1.21.11, Paper includes a built-in update checker that notifies server administrators on startup when a new version of Paper is available.

## How it works

When the server starts, Paper will check its current version against the latest available version in the stable channel on the PaperMC servers.
If a newer version is found, a notification message will be printed to the console and server logs.

Additionally, you can manually check for updates at any time by running the `version` command in the server console (or in-game with appropriate `bukkit.command.version` permission).

## What is sent

The update checker sends the following information to the PaperMC servers:
- Current Paper version
- Your server's client IP (as for any http request)

This information is not currently stored or analyzed by PaperMC, though requests pass through CloudFlare.

## Configuration
The update checker can be disabled in the `paper-global.yml` configuration file. The relevant section is as follows:

```yaml title="config/paper-global.yml"
update-checker:
  enabled: false
```

Alternatively you can disable the update checker by adding the following JVM argument when starting your server:

```bash
-Dpaper.disableStartupVersionCheck
```


---


# Next steps

How to proceed after starting your server.

Now that you have your server up and running, there are a few things you should do to ensure that your server is running smoothly.

## Configuration

One of the first things you should do is ensure your server is configured to your specifications.
Paper is highly configurable, and you can change many settings to suit your needs. We outline where
you can find these settings in the [Configuration](/paper/reference/configuration) guide.

## Plugins

One of the main reasons to use Paper is to take advantage of the many plugins which make use of our
expansive API. We have our own plugin repository, [Hangar](https://hangar.papermc.io/), where you can
find many plugins to use on your server. We also have a guide on how to install plugins
[here](/paper/adding-plugins).

![Hangar](./assets/hangar.png)

## Security

### Whitelisting

If you want to restrict who can join your server, you can use the whitelist feature. This allows you to
specify who can join your server, and stops anyone else from joining. You can use the whitelist from
the server console, or by editing the `whitelist.json` file in your server directory.

### Permissions

Permissions are a way to control what players can and cannot do on your server. You can use permissions
to restrict who can use certain commands, or who can access certain areas of your server. It is
common for plugins to use permissions to control who can use their features. You can use permission
plugins such as [LuckPerms](https://luckperms.net/) to manage the permissions which players will be granted.

## Backups

It's important to keep backups of your server. If something goes wrong, you can restore your server to a
previous state. We cover how to do this in the [Updating](/paper/updating) guide.

## Optimization

Out of the box, Paper is optimized for performance. However, there are many things you can do to further
optimize your server. One of the most common things to do is to make sure that you are running the
correct startup flags for your server. We have a tool that allows you to automatically generate a
startup script with the correct flags for your server. You can find this tool
[here](/misc/tools/start-script-gen). Beyond this, a guide such as [this one](https://paper-chan.moe/paper-optimization/)
will help you to further optimize your server.

## Making your server public

If you want to make your server public, you will need to port forward your server. This allows people
from outside your network to connect to your server. There is a guide made by
[NordVPN](https://nordvpn.com/blog/open-ports-on-router/) which explains what port forwarding is and how
to do it for your Paper server.

## Troubleshooting

If you encounter any issues with your server, you can follow our [Troubleshooting](/paper/basic-troubleshooting)
guide to help you diagnose and fix the issue. If you are unable to fix the issue, you can come and
ask for help in our [Discord](https://discord.gg/papermc) server!


---


# Profiling

How to profile your Paper server.

Profiling is a way to diagnose performance problems with your server.
A profiler measures certain characteristics of a running server, e.g. how often a method is called
and how much time it takes up in a single tick, how long and often the garbage collector runs and much more.

:::caution

_For profiling to be effective, the issue you are diagnosing must be actively occurring._

:::

If you need help with analyzing a performance issue, please bring a spark report to the
[PaperMC Discord server](https://discord.gg/PaperMC) (#paper-help) for assistance.

## spark

Starting with 1.21, Paper bundles the [spark](https://spark.lucko.me/) profiler, which is the preferred way
to profile Paper.

To start profiling your server, run this command:
```
/spark profiler start --timeout 600
```

After 10 minutes, this will return a URL to a profiler report, which you can analyze yourself or provide
to a developer of a plugin or the Paper support chats.

This is only a fraction of what spark can do, so if you want to learn about the different features of spark
or learn to analyze reports yourself, check out spark's documentation [here](https://spark.lucko.me/docs/).

:::tip

If you want to use a version of spark newer than the bundled one, simply place a standalone spark plugin JAR
into the `plugins` directory and set the [`paper.preferSparkPlugin`](/paper/reference/system-properties#paperprefersparkplugin)
system property to `true`.

If you want to use PlaceholderAPI [placeholders](https://spark.lucko.me/docs/misc/Placeholders)
from the bundled spark version, you need to install the [spark expansion](https://api.extendedclip.com/expansions/spark/)
from PAPI's eCloud (`/papi ecloud download spark` and `/papi reload`).

:::

## Timings

Paper also bundles the [Timings v2](https://timings.aikar.co/) profiler, however Timings has been unmaintained
for multiple years and its reports are difficult to read for beginners. It has been deprecated in favor of
spark and turned off by default in 1.21, see [this discussion](https://github.com/PaperMC/Paper/discussions/10565)
for more information.


---


# commands.yml

An explanation of Bukkit's commands.yml file.

import ConfigNode from "/src/components/ConfigNode.astro";
import CommandsYML from "/src/config/paper/commands.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure and default values for the legacy `commands.yml`.

Click on a leaf node to view the description for that setting.

:::

:::caution

The aliases defined in this legacy file do not support modern features, such as:
- Tab completion
- Permissions

:::

<ConfigNode data={parse(CommandsYML)} />


---


# bukkit.yml

An explanation of Bukkit's configuration file.

import ConfigNode from "/src/components/ConfigNode.astro";
import BukkitYML from "/src/config/paper/bukkit.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure and default values for `bukkit.yml`.

Click on a leaf node to view the description for that setting.

:::

<ConfigNode data={parse(BukkitYML)} />


---


# help.yml

An explanation of Bukkit's help.yml file.

import ConfigNode from "/src/components/ConfigNode.astro";
import HelpYML from "/src/config/paper/help.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure for `help.yml`.

Click on a leaf node to view the description for that setting.

:::

<ConfigNode data={parse(HelpYML)} />


---


# permissions.yml

An explanation of Bukkit's permissions.yml file.

import ConfigNode from "/src/components/ConfigNode.astro";
import PermissionsYML from "/src/config/paper/permissions.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure for `permissions.yml`.

Click on a leaf node to view the description for that setting.

:::

:::caution

This is NOT a replacement for a permissions plugin.

This file is used to define metadata about permissions themselves, including a description and a default value.

:::

<ConfigNode data={parse(PermissionsYML)} />


---


# CLI Arguments

Reference for all CLI arguments Paper recognizes.

Paper provides CLI arguments you can set to configure certain behavior. CLI arguments are always added directly
**after** the server file name when starting the server. For example:
```bash
java -jar server.jar --nogui
```

`--nogui` is referred to as a CLI argument (more specifically, as it has no value, a **flag**).
This page acts as a reference to all arguments Paper provides.

Some of these options are direct counterparts to settings you can modify in the `server.properties` file.
The CLI arguments always **override** those set in the `server.properties` file.

##### `-?, --help`
Prints a help message with all CLI arguments you may pass. Using this flag will not start the server.

##### `-C, --commands-settings <commands yml file>`
The path towards the command settings file. Defaults to `commands.yml`.

##### `-P, --plugins <plugin directory>`
The directory to look in for plugin JARs. Defaults to `plugins`.

##### `-S, --spigot-settings <yml file>`
The path towards the Spigot configuration file. Defaults to `spigot.yml`.

##### `-W, --universe, --world-container, --world-dir <world directory>`
The folder to put other world folders into. Defaults to `.` (this folder).

##### `--add-extra-plugin-dir, --add-plugin-dir <directory>`
Additional directory to look for plugin files in. May be specified multiple times for more than one
extra plugin directory.

##### `--add-extra-plugin-jar, --add-plugin <jar file>`
Additional plugin JAR file to load. May be specified multiple times for multiple plugin JARs.

##### `-b, --bukkit-settings <yml file>`
The path towards the Bukkit configuration file. Defaults to `bukkit.yml`.

##### `-c, --config <properties file>`
The path towards the Minecraft server properties file. Defaults to `server.properties`.

##### `--demo`
Whether to load the server in demo mode. This results in always the same world being generated and additional
demo reminders and help messages being sent.

##### `--bonusChest`
Whether to create a bonus chest on initial world creation.

##### `--eraseCache`
Whether to force cache erase during world upgrades. This removes data such as heightmap and light data,
which may be useful if you want to force recalculate those.

##### `--forceUpgrade`
Whether to force a full world upgrade on server start.

:::danger[Warning]

This setting should rarely ever be used. The upgrade system in Paper is fast enough to do
upgrades gradually as you play.

:::

##### `-h, --host, --server-ip <hostname or ip>`
The host to listen on.

##### `--initSettings`
Whether to only create setting files and then shut down the server before creating any worlds. This is useful
if you want to first set some configuration values, which may be relevant during world creation.

##### `--jfrProfile`
Whether to enable JFR (Java Flight Recorder) profiling.

##### `--noconsole`
Disables the console.

##### `--nogui`
Disables the graphical interface.

##### `--nojline`
Disables JLine and emulates the Vanilla console.

##### `-o, --online-mode <true|false>`
Whether to use online authentication.

##### `-p, --port, --server-port <port>`
The port to listen on.

##### `--paper, --paper-settings <yml file>`
The legacy Paper settings file path. Defaults to `paper.yml`.

:::danger[Warning]

This option is only used to migrate the legacy configuration file to the new format
and should not be used for new servers.

:::

##### `--paper-dir, --paper-settings-directory <config directory>`
Path to the Paper settings directory. Defaults to `config`.

##### `--pidFile <path>`
Path to the PID file.

##### `--recreateRegionFiles`
Whether to recreate region files during world upgrades.

##### `-s, --max-players, --size <value>`
The maximum amount of players.

##### `--safeMode`
Loads worlds only with the Vanilla datapack enabled.

##### `--server-name <name>`
The name of the server. Defaults to `Unknown Server`.

##### `--serverId <id>`
Sets the server identifier, which is used in crash files.

##### `-v, --version`
Prints the CraftBukkit version. This option prevents the server from starting.

##### `-w, --level-name, --world <name>`
Sets the world name.


---


# Commands

Documentation about all commands added by Paper.

This page explains all commands which are added by Paper.

## Bukkit commands

These commands are located under the `bukkit:` namespace.

### version (aliases: ver, about)

The version command displays the version information about the server, the output may look like this:

![](./assets/version-command-output.png)

You can also use this command to display version information about specific plugins.

![](./assets/plugin-version-command-output.png)

### plugins (alias: pl)

The plugins command displays the list of all loaded plugins. Paper differentiates between two types of
plugins: **Paper plugins** and **Bukkit plugins**. The difference is generally only relevant to plugin
developers ([guide to paper-plugin.yml](/paper/dev/getting-started/paper-plugins)). Plugins are marked
as **green** if no issues occurred whilst enabling them and their functionality can be assumed working.
Plugins marked **red** failed to load or were disabled. Check the startup logs for more information if
that happens.

Bukkit plugins furthermore have the possibility of being loaded **with legacy support** enabled. These
are marked with a **yellow star** in front of their name. That usually means the plugin was made for a
very old version of the game or the plugin author simply forgot to specify a target Minecraft version
for their plugin.

You can click on the plugins' names to display version information about that plugin. The click action
is equivalent to running `/version <plugin_name>`.

![](./assets/plugins-command-output.png)

### help (alias: ?)

The help command displays descriptions for all registered commands. It acts
as a quick reference to both built-in commands and any plugin-added commands.

### reload (alias: spigot reload)

:::danger[Deprecation]

The reload command is deprecated for removal. You should instead restart your server
if you wish to update your plugins, as the reload is known for causing issues with plugins.

If you are looking to reload the Paper configs, you can use [/paper reload](#reload).

:::

## Performance profiling

The `/mspt` and `/tps` commands, whilst working fine, are superseded by the `/spark` command,
and you should therefore switch to the `/spark` command instead.

### spark

The only command you should rely on for performance information is the `/spark` command.
The spark subcommands are documented [in the dedicated spark wiki](https://spark.lucko.me/docs/Command-Usage).

### tps

The tps command is a simple command to get the TPS (ticks per second, how often the game loop
is run per second. The higher, the better. Target TPS is 20.0) from the past 1, 5, and 15 minutes.

### mspt

The mspt command is another simple command to get the average, min, and max MSPT (milliseconds per tick, how much time
a tick takes. The lower, the better. MSPT should be below 50 for 20 TPS) of the server from the last 5, 10, and 60 seconds.

### timings

:::danger[Deprecation]

The timings command is deprecated for removal. You should instead use the [spark command](#spark) as a replacement.

More information can be viewed here: https://github.com/PaperMC/Paper/discussions/10565.

:::

## restart

The `/restart` command is part of Spigot's restart mechanism, which makes the server restart when it crashes
or the command is run manually.

:::note

For help setting up the restart script, see
[this gist by Prof_Bloodstone](https://gist.github.com/Prof-Bloodstone/6367eb4016eaf9d1646a88772cdbbac5).

:::

## paper
This section is dedicated to the subcommands of the in-game `/paper` command.

### chunkinfo
The `/paper chunkinfo [<world>]` command is used for displaying information about loaded chunks in a world.
You can specify the world to get info about with the `[<world>]` argument. If you set it to `*` or leave it
out, it will list information for all worlds.

The output differentiates between multiple types of loaded chunks. Here is a quick rundown of each type.
A more complete documentation may be found in the [Minecraft Wiki](https://minecraft.wiki/w/Chunk).

- `Total` As the name suggests, this number describes **all chunks** currently loaded.
- `Inactive` More commonly referred to as "inaccessible", are chunks which are not ticked, but where chunk generation occurs.
- `Full` Usually called **border chunks**. No ticking is happening, but entities and blocks are loaded and accessible.
- `Block Ticking` All game aspects work as expected, except that entities are not spawned naturally or ticked, but still accessible. Also called **lazy chunks**.
- `Entity Ticking` The chunk is being ticked fully.

### debug
The `/paper debug <chunks>` command is used to dump information about all currently loaded chunks to a file. The content
of this file is generally irrelevant for most server admins and is intended to be used by developers.

### dumpitem
The `/paper dumpitem [all]` command can be used to retrieve the data component representation of your currently held
item. Simply running `/paper dumpitem` will yield the item data, which you can use to represent this item in
commands which expect an item argument. `/paper dumpitem all` yields the **full data component representation**,
including default data components you do not have to explicitly declare.

### dumplisteners
The `/paper dumplisteners tofile|<className>` command is primarily intended for developers trying to figure out why
their event handlers might not be working as expected. Using `/paper dumplisteners tofile` will write all
currently registered event handlers to a file, whilst `/paper dumplisteners <className>` will print the registered
event handlers only for the specific event.

### dumpplugins
The `/paper dumpplugins` command is intended for developers trying to figure out issues with their dependencies or
loading order in relation to other plugins. It can also be used to debug bootstrapper providers, general load order,
and listing class loaders for the plugins.

### entity
The `/paper entity list [<filter>] [<world>]` command can be used to list all currently ticking entities.

The `[<filter>]` argument is used to filter the listed entities types and acts similar to a **regular expression**:
- You can use `*` to list **all** entities, which is the default value for this argument.
- You can list individual entities by providing `minecraft:<entity_type>` as the argument. The namespace here is very important.
- To list multiple entities, you can use the `*` as a greedy wildcard expression. For example, to list all entities,
  whose names start with **e**, you could use `minecraft:e*`.
- You can also use the `?` single-character wildcard expression. For example, to list `pig` and `piglin`, but **not**
  `piglin_brute`, you can provide `minecraft:pig???` as the filter.

The `[<world>]` argument declares the world you want to check the entities in. This defaults to the current world
of a player or to the overworld for the console.

The output will look similar to this:

```
Total Ticking: -78, Total Non-Ticking: 92
  10 (3) : minecraft:pig
  1 (0) : minecraft:piglin
* First number is ticking entities, second number is non-ticking entities
```

The comment at the end already clearly describes the purpose of the numbers.

### fixlight
The `/paper fixlight` command is a simple command to trigger a full re-calculation of the light map of all currently
loaded chunks. This can be used to fix any lighting issues which commonly occur with plugins like WorldEdit.

### heap
The `/paper heap` is a developer debug command to dump the current JVM heap to a `.hprof` file, which can be analyzed
to detect to amount of memory used by certain objects. The output file can be rather big, so having a bit of free
space on your disk is recommended before running this command (as a general rule, the file is usually smaller
than the currently used memory. You can check the memory consumption using the `/spark healthreport` command).

### holderinfo
The `/paper holderinfo [<world>]` command is used to gather the number of different chunks currently held in memory.

The `[<world>]` argument can be used to define the world to get the chunk holder information for. Leave blank to
default to `*`, which prints the information for all chunks.

In general, the types have the following meanings:
- `Total` The total amount of in-memory chunk holders.
- `Unloadable` The number of chunks that are safe to be unloaded.
- `Null` Chunks, which have received the unload signal, but whose scheduling locks are still held.
- `ReadOnly` The number of chunk holders, which are readable, but not writable to.
- `Proto` A "prototype" chunk, which is a fully working chunk loaded in memory, but which is not currently placed in the world.
- `Full` Represents the number of chunks currently placed in the world.

### mobcaps
Not to be confused with the [playermobcaps](#playermobcaps) subcommand, the `/paper mobcaps [<world>]` command displays
the **global** mob caps for all players in a world. The `[<world>]` argument defaults to the overworld and
can be set to retrieve the mob caps for other worlds as well. The command also lists the number of
chunks in which mobs can spawn.

### playermobcaps
The `/paper playermobcaps [<player>]` command is used to list the local mob caps for a specific player. The `[<player>]`
argument defaults to the player, who ran the command, if one exists.

### reload
The `/paper reload` command is an unsupported command which allows for runtime Paper-config reloading. If you get any issues
after using this command, please make sure to reproduce this on a freshly-started server before asking for help or
reporting it. Do note that this command **does not** reload non-Paper configs, like the `spigot.yml`.

### syncloadinfo
The `/paper syncloadinfo [clear]` command requires the `-Dpaper.debug-sync-loads=true` JVM flag to be explicitly set
before running the command. The command was historically used for debugging purposes during Paper development, but
the mechanism behind the command is currently unused, meaning that the written file will **always** look
like this:

```json
{
 "worlds": []
}
```

Outside of checking for whether the command is allowed to be run, the JVM flag is otherwise unused.

### version
The `/paper version` command is an alias to the standard `/version` command.


---


# Configuration

An overview of Paper's configuration files.

import { FileTree } from "@astrojs/starlight/components";

:::note

Many of our files have been comprehensively documented. If this is the case, they will offer a link to their page.
If this is not the case, they offer a brief explanation to what they are.

:::

<FileTree>
  - logs/ all logs for the server
    - latest.log the most recent log
    - \<yyyy-MM-dd\>-\<run-id\>.log.gz old logs compressed with gzip
  - config/
    - [paper-global.yml](/paper/reference/global-configuration)
    - [paper-world-defaults.yml](/paper/reference/world-configuration)
  - plugins/ you can place your plugin JARs here
    - .paper-remapped/ used to store remapped plugin JARs, learn more [here](https://forums.papermc.io/threads/important-dev-psa-future-removal-of-cb-package-relocation.1106/)
    - bStats/
      - config.yml stores configuration for bStats plugin metrics
    - spark/ plugin folder for the bundled spark profiler
      - [config.json](https://spark.lucko.me/docs/Configuration) the main spark config file
  - world/dimensions/\<namespace\>/\<key\>/
    - [paper-world.yml](#per-world-values) stores [configuration values](/paper/reference/world-configuration) that apply only to the world with the key `namespace:key`
  - [banned-ips.json](/paper/reference/vanilla-data-files#banned-ipsjson) stores IP addresses banned from the server
  - [banned-players.json](/paper/reference/vanilla-data-files#banned-playersjson) stores players banned from the server
  - [bukkit.yml](/paper/reference/bukkit-configuration)
  - [commands.yml](/paper/reference/bukkit-commands-configuration)
  - [eula.txt](/paper/reference/vanilla-data-files#eulatxt) stores the EULA consent status
  - [help.yml](/paper/reference/bukkit-help-configuration) stores configuration for the `/help` command
  - [ops.json](/paper/reference/vanilla-data-files#opsjson) stores information about players with operator status
  - [permissions.yml](/paper/reference/bukkit-permissions-configuration) stores additional permission definitions
  - [server.properties](/paper/reference/server-properties)
  - [spigot.yml](/paper/reference/spigot-configuration)
  - usercache.json caches players' Mojang API data, e.g. their head textures
  - [whitelist.json](/paper/reference/vanilla-data-files#whitelistjson) stores information about whitelisted players
</FileTree>

## Per-world configuration

One of the most powerful yet least understood features of the Paper configuration is setting
configuration options per world. While you cannot override every config option per world,
everything stored within `paper-world-defaults.yml` can be.

### Default values

Paper sets no per-world overrides out of the box, storing all default values in
`config/paper-world-defaults.yml`. Everything in this file can be overridden per world but isn't by
default. Changing something in `paper-world-defaults.yml` will change the value for all worlds where
you have not manually overridden it.

### Per-world values

To set a value for a specific world, edit `paper-world.yml` within the world folder. For example, if
you wanted to enable `lootables.auto-replenish` for a world with the key `custom:resource`, you would edit
`paper-world.yml` within the `world/dimensions/custom/resource` folder like so:

```yaml title=world/dimensions/custom/resource/paper-world.yml {3-4}
_version: 28

lootables:
  auto-replenish: true
```

Nothing but `_version` is set in `paper-world.yml` configuration files by default. In order to
override the default for an option, you must manually add it by copying from
`paper-world-defaults.yml`.

### Inheritance

All configuration not explicitly defined for a world is inherited from `paper-world-defaults.yml`.
This means that there is no need to repeat yourself between the `paper-world-defaults.yml` and each
individual `paper-world.yml`. You **do not need to and should not** copy the entire
`paper-world-default.yml` file into each `paper-world.yml` file you want to modify. Only copy the
exact value you want to change.

For a more complex real-world example: setting both different `spawn-limits` and `auto-replenish`
in two worlds.

```yaml title="paper-world-defaults.yml"
lootables:
  auto-replenish: true
entities:
  spawning:
    spawn-limits:
      ambient: 70
      axolotls: 10
      creature: 15
      monster: 5
      underground_water_creature: 5
      water_ambient: 5
      water_creature: 20
```

```yaml title="world/dimensions/minecraft/the_nether/paper-world.yml"
entities:
  spawning:
    spawn-limits:
      monster: 90
```

```yaml title="world/dimensions/custom/resource/paper-world.yml"
lootables:
  auto-replenish: false
entities:
  spawning:
    spawn-limits:
      axolotls: 8
      creature: 15
      monster: 2
```

This example demonstrates the concept of inheritance. For each world in `world/dimensions`, this is the effective
configuration which will be applied:

| Configuration Key                                           | minecraft/overworld | minecraft/the_nether | minecraft/the_end | custom/resource |
|-------------------------------------------------------------|---------------------|----------------------|-------------------|-----------------|
| `lootables.auto-replenish`                                  | `true`              | `true`               | `true`            | `false`         |
| `entities.spawning.spawn-limits.ambient`                    | `15`                | `15`                 | `15`              | `15`            |
| `entities.spawning.spawn-limits.axolotls`                   | `5`                 | `5`                  | `5`               | `8`             |
| `entities.spawning.spawn-limits.creature`                   | `10`                | `10`                 | `10`              | `15`            |
| `entities.spawning.spawn-limits.monster`                    | `70`                | `90`                 | `70`              | `2`             |
| `entities.spawning.spawn-limits.underground_water_creature` | `5`                 | `5`                  | `5`               | `5`             |
| `entities.spawning.spawn-limits.water_ambient`              | `20`                | `20`                 | `20`              | `20`            |
| `entities.spawning.spawn-limits.water_creature`             | `5`                 | `5`                  | `5`               | `5`             |

Notice that `world/dimensions/minecraft/the_end/paper-world.yml` was never modified. Because of this, it inherits all the
configuration options from `config/paper-world-defaults.yml`. Additionally, `auto-replenish` was
only disabled in `world/dimensions/custom/resource/paper-world.yml` because in `config/paper-world-defaults.yml`,
`auto-replenish` is set to `true`.


---


# Global configuration

An explanation of Paper's global configuration file.

import ConfigNode from "/src/components/ConfigNode.astro";
import PaperGlobalYML from "/src/config/paper/paper-global.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure and default values for the global configuration (`config/paper-global.yml`).

Click on a leaf node to view the description for that setting.

:::

<ConfigNode data={parse(PaperGlobalYML)} />


---


# Paper plugins

A guide to the ins and outs of Paper plugins.

This documentation page serves to explain all the new semantics and possible confusions that Paper plugins may introduce.

:::note

Developers can get more information on Paper plugins [here](/paper/dev/getting-started/paper-plugins).

:::

## What are they?

Paper plugins are plugins which are loaded by Paper's new plugin loading framework. Paper plugins are used by developers to
take advantage of modern systems Mojang provides, for example, datapacks.

![Plugin List](./assets/plugin-list.png)

## What is the difference?

When enabled, Paper plugins are **identical** to Bukkit plugins. This allows plugins to still fully communicate and support each other, meaning that even if a
plugin is a Bukkit or Paper plugin, they are both able to depend on each other just fine.

Paper plugins only support being loaded by Paper's Plugin Loader and may use new API unavailable to Bukkit plugins.

### How do I add Paper plugins?

Paper plugins are added the same as Bukkit plugins, therefore, you can follow [this guide](/paper/adding-plugins).

### Cyclic plugin loading

With the introduction of Paper plugins, Paper introduces a new plugin loader that fixes some odd issues.
However, as a result, this now causes [cyclic loading](/paper/dev/getting-started/paper-plugins#cyclic-plugin-loading) between plugins to no longer be supported.

If Paper detects a loop, your server will be shut down with an error.

:::danger[Legacy]

If your server **requires** this circular loading, you can enable this by adding the [`-Dpaper.useLegacyPluginLoading=true`](/paper/reference/system-properties#paperuselegacypluginloading) startup flag.
Please note that this may not be supported in the future.

:::


---


# Permissions

All permissions available in the default Paper server.

This page lists all permissions that are included in the default Paper server.

## Vanilla command permissions

The following is a list of permissions for Vanilla commands.

| Command                                                                        | Aliases                                               | Permission Node                        | Players Have Permission By Default?                       |
|--------------------------------------------------------------------------------|-------------------------------------------------------|----------------------------------------|-----------------------------------------------------------|
| [advancement](https://minecraft.wiki/w/Commands/advancement)                   |                                                       | minecraft.command.advancement          | No                                                        |
| [attribute](https://minecraft.wiki/w/Commands/attribute)                       |                                                       | minecraft.command.attribute            | No                                                        |
| [ban](https://minecraft.wiki/w/Commands/ban)                                   |                                                       | minecraft.command.ban                  | No                                                        |
| [ban-ip](https://minecraft.wiki/w/Commands/ban-ip)                             |                                                       | minecraft.command.ban-ip               | No                                                        |
| [banlist](https://minecraft.wiki/w/Commands/banlist)                           |                                                       | minecraft.command.banlist              | No                                                        |
| [bossbar](https://minecraft.wiki/w/Commands/bossbar)                           |                                                       | minecraft.command.bossbar              | No                                                        |
| [chase](https://minecraft.wiki/w/Commands/chase)                               |                                                       | minecraft.command.chase                | Yes                                                       |
| [clear](https://minecraft.wiki/w/Commands/clear)                               |                                                       | minecraft.command.clear                | No                                                        |
| [clone](https://minecraft.wiki/w/Commands/clone)                               |                                                       | minecraft.command.clone                | No                                                        |
| [compute](https://minecraft.wiki/w/Commands/compute)                           |                                                       | minecraft.command.compute              | No                                                        |
| [damage](https://minecraft.wiki/w/Commands/damage)                             |                                                       | minecraft.command.damage               | No                                                        |
| [data](https://minecraft.wiki/w/Commands/data)                                 |                                                       | minecraft.command.data                 | No                                                        |
| [datapack](https://minecraft.wiki/w/Commands/datapack)                         |                                                       | minecraft.command.datapack             | No                                                        |
| [debug](https://minecraft.wiki/w/Commands/debug)                               |                                                       | minecraft.command.debug                | No                                                        |
| [debugconfig](https://minecraft.wiki/w/Commands/debugconfig)                   |                                                       | minecraft.command.debugconfig          | No                                                        |
| [debugmobspawning](https://minecraft.wiki/w/Commands/debugmobspawning)         |                                                       | minecraft.command.debugmobspawning     | No                                                        |
| [debugpath](https://minecraft.wiki/w/Commands/debugpath)                       |                                                       | minecraft.command.debugpath            | No                                                        |
| [defaultgamemode](https://minecraft.wiki/w/Commands/defaultgamemode)           |                                                       | minecraft.command.defaultgamemode      | No                                                        |
| [deop](https://minecraft.wiki/w/Commands/deop)                                 |                                                       | minecraft.command.deop                 | No                                                        |
| [dialog](https://minecraft.wiki/w/Commands/dialog)                             |                                                       | minecraft.command.dialog               | No                                                        |
| [difficulty](https://minecraft.wiki/w/Commands/difficulty)                     |                                                       | minecraft.command.difficulty           | No                                                        |
| [effect](https://minecraft.wiki/w/Commands/effect)                             |                                                       | minecraft.command.effect               | No                                                        |
| [enchant](https://minecraft.wiki/w/Commands/enchant)                           |                                                       | minecraft.command.enchant              | No                                                        |
| [execute](https://minecraft.wiki/w/Commands/execute)                           |                                                       | minecraft.command.execute              | No                                                        |
| [fetchprofile](https://minecraft.wiki/w/Commands/fetchprofile)                 |                                                       | minecraft.command.fetchprofile         | No                                                        |
| [fill](https://minecraft.wiki/w/Commands/fill)                                 |                                                       | minecraft.command.fill                 | No                                                        |
| [fillbiome](https://minecraft.wiki/w/Commands/fillbiome)                       |                                                       | minecraft.command.fillbiome            | No                                                        |
| [forceload](https://minecraft.wiki/w/Commands/forceload)                       |                                                       | minecraft.command.forceload            | No                                                        |
| [function](https://minecraft.wiki/w/Commands/function)                         |                                                       | minecraft.command.function             | No                                                        |
| [gamemode](https://minecraft.wiki/w/Commands/gamemode)                         |                                                       | minecraft.command.gamemode             | No                                                        |
| [gamerule](https://minecraft.wiki/w/Commands/gamerule)                         |                                                       | minecraft.command.gamerule             | No                                                        |
| [give](https://minecraft.wiki/w/Commands/give)                                 |                                                       | minecraft.command.give                 | No                                                        |
| [help](https://minecraft.wiki/w/Commands/help)                                 |                                                       | minecraft.command.help                 | Yes                                                       |
| [item](https://minecraft.wiki/w/Commands/item)                                 |                                                       | minecraft.command.item                 | No                                                        |
| [jfr](https://minecraft.wiki/w/Commands/jfr)                                   |                                                       | minecraft.command.jfr                  | No                                                        |
| [kick](https://minecraft.wiki/w/Commands/kick)                                 |                                                       | minecraft.command.kick                 | No                                                        |
| [kill](https://minecraft.wiki/w/Commands/kill)                                 |                                                       | minecraft.command.kill                 | No                                                        |
| [list](https://minecraft.wiki/w/Commands/list)                                 |                                                       | minecraft.command.list                 | Yes                                                       |
| [locate](https://minecraft.wiki/w/Commands/locate)                             |                                                       | minecraft.command.locate               | No                                                        |
| [loot](https://minecraft.wiki/w/Commands/loot)                                 |                                                       | minecraft.command.loot                 | No                                                        |
| [me](https://minecraft.wiki/w/Commands/me)                                     |                                                       | minecraft.command.me                   | Yes                                                       |
| [msg](https://minecraft.wiki/w/Commands/msg)                                   | /w, /tell                                             | minecraft.command.msg                  | Yes                                                       |
| [op](https://minecraft.wiki/w/Commands/op)                                     |                                                       | minecraft.command.op                   | No                                                        |
| [pardon](https://minecraft.wiki/w/Commands/pardon)                             |                                                       | minecraft.command.pardon               | No                                                        |
| [pardon-ip](https://minecraft.wiki/w/Commands/pardon-ip)                       |                                                       | minecraft.command.pardon-ip            | No                                                        |
| [particle](https://minecraft.wiki/w/Commands/particle)                         |                                                       | minecraft.command.particle             | No                                                        |
| [perf](https://minecraft.wiki/w/Commands/perf)                                 |                                                       | minecraft.command.perf                 | No                                                        |
| [place](https://minecraft.wiki/w/Commands/place)                               |                                                       | minecraft.command.place                | No                                                        |
| [playsound](https://minecraft.wiki/w/Commands/playsound)                       |                                                       | minecraft.command.playsound            | No                                                        |
| [posteffect](https://minecraft.wiki/w/Commands/posteffect)                     |                                                       | minecraft.command.posteffect           | No                                                        |
| [publish](https://minecraft.wiki/w/Commands/publish)                           |                                                       | minecraft.command.publish              | No                                                        |
| [raid](https://minecraft.wiki/w/Commands/raid)                                 |                                                       | minecraft.command.raid                 | No                                                        |
| [random](https://minecraft.wiki/w/Commands/random)                             |                                                       | minecraft.command.random               | Yes without sequence argument, No with sequence argument. |
| [recipe](https://minecraft.wiki/w/Commands/recipe)                             |                                                       | minecraft.command.recipe               | No                                                        |
| [reload](https://minecraft.wiki/w/Commands/reload)                             |                                                       | minecraft.command.reload               | No                                                        |
| [return](https://minecraft.wiki/w/Commands/return)                             |                                                       | minecraft.command.return               | No                                                        |
| [ride](https://minecraft.wiki/w/Commands/ride)                                 |                                                       | minecraft.command.ride                 | No                                                        |
| [rotate](https://minecraft.wiki/w/Commands/rotate)                             |                                                       | minecraft.command.rotate               | No                                                        |
| [save-all](https://minecraft.wiki/w/Commands/save-all)                         |                                                       | minecraft.command.save-all             | No                                                        |
| [save-off](https://minecraft.wiki/w/Commands/save-off)                         |                                                       | minecraft.command.save-off             | No                                                        |
| [save-on](https://minecraft.wiki/w/Commands/save-on)                           |                                                       | minecraft.command.save-on              | No                                                        |
| [say](https://minecraft.wiki/w/Commands/say)                                   |                                                       | minecraft.command.say                  | No                                                        |
| [schedule](https://minecraft.wiki/w/Commands/schedule)                         |                                                       | minecraft.command.schedule             | No                                                        |
| [scoreboard](https://minecraft.wiki/w/Commands/scoreboard)                     |                                                       | minecraft.command.scoreboard           | No                                                        |
| [seed](https://minecraft.wiki/w/Commands/seed)                                 |                                                       | minecraft.command.seed                 | No                                                        |
| [setblock](https://minecraft.wiki/w/Commands/setblock)                         |                                                       | minecraft.command.setblock             | No                                                        |
| [serverpack](https://minecraft.wiki/w/Commands/serverpack)                     |                                                       | minecraft.command.serverpack           | No                                                        |
| [setidletimeout](https://minecraft.wiki/w/Commands/setidletimeout)             |                                                       | minecraft.command.setidletimeout       | No                                                        |
| [setworldspawn](https://minecraft.wiki/w/Commands/setworldspawn)               |                                                       | minecraft.command.setworldspawn        | No                                                        |
| [spawnpoint](https://minecraft.wiki/w/Commands/spawnpoint)                     |                                                       | minecraft.command.spawnpoint           | No                                                        |
| [spawn_armor_trims](https://minecraft.wiki/w/Commands/spawn_armor_trims)       |                                                       | minecraft.command.spawn_armor_trims    | No                                                        |
| [spectate](https://minecraft.wiki/w/Commands/spectate)                         |                                                       | minecraft.command.spectate             | No                                                        |
| [spreadplayers](https://minecraft.wiki/w/Commands/spreadplayers)               |                                                       | minecraft.command.spreadplayers        | No                                                        |
| [stop](https://minecraft.wiki/w/Commands/stop)                                 |                                                       | minecraft.command.stop                 | No                                                        |
| [stopsound](https://minecraft.wiki/w/Commands/stopsound)                       |                                                       | minecraft.command.stopsound            | No                                                        |
| [summon](https://minecraft.wiki/w/Commands/summon)                             |                                                       | minecraft.command.summon               | No                                                        |
| [tag](https://minecraft.wiki/w/Commands/tag)                                   |                                                       | minecraft.command.tag                  | No                                                        |
| [team](https://minecraft.wiki/w/Commands/team)                                 |                                                       | minecraft.command.team                 | No                                                        |
| [teammsg](https://minecraft.wiki/w/Commands/teammsg)                           | /tm                                                   | minecraft.command.teammsg              | Yes                                                       |
| [teleport](https://minecraft.wiki/w/Commands/teleport)                         | /tp                                                   | minecraft.command.teleport             | No                                                        |
| [tellraw](https://minecraft.wiki/w/Commands/tellraw)                           |                                                       | minecraft.command.tellraw              | No                                                        |
| [test](https://minecraft.wiki/w/Commands/test)                                 |                                                       | minecraft.command.test                 | No                                                        |
| [tick](https://minecraft.wiki/w/Commands/tick)                                 |                                                       | minecraft.command.tick                 | No                                                        |
| [time](https://minecraft.wiki/w/Commands/time)                                 |                                                       | minecraft.command.time                 | No                                                        |
| [title](https://minecraft.wiki/w/Commands/title)                               |                                                       | minecraft.command.title                | No                                                        |
| [transfer](https://minecraft.wiki/w/Commands/transfer)                         |                                                       | minecraft.command.transfer             | No                                                        |
| [trigger](https://minecraft.wiki/w/Commands/trigger)                           |                                                       | minecraft.command.trigger              | Yes                                                       |
| [version](https://minecraft.wiki/w/Commands/version)                           |                                                       | minecraft.command.version              | No                                                        |
| [warden_spawn_tracker](https://minecraft.wiki/w/Commands/warden_spawn_tracker) |                                                       | minecraft.command.warden_spawn_tracker | No                                                        |
| [waypoint](https://minecraft.wiki/w/Commands/waypoint)                         |                                                       | minecraft.command.waypoint             | No                                                        |
| [weather](https://minecraft.wiki/w/Commands/weather)                           |                                                       | minecraft.command.weather              | No                                                        |
| [whitelist](https://minecraft.wiki/w/Commands/whitelist)                       |                                                       | minecraft.command.whitelist            | No                                                        |
| [worldborder](https://minecraft.wiki/w/Commands/worldborder)                   |                                                       | minecraft.command.worldborder          | No                                                        |
| [xp](https://minecraft.wiki/w/Commands/xp)                                     | <span style="white-space: nowrap;">/experience</span> | minecraft.command.xp                   | No                                                        |

## Bukkit command permissions

The following is a list of permissions for Bukkit commands.

| Command | Aliases      | Permission Node        | Players Have Permission By Default? |
|---------|--------------|------------------------|-------------------------------------|
| help    | /?           | bukkit.command.help    | Yes                                 |
| plugins | /pl          | bukkit.command.plugins | Yes                                 |
| reload  | /rl          | bukkit.command.reload  | No                                  |
| restart |              | bukkit.command.restart | No                                  |
| timings |              | bukkit.command.timings | No                                  |
| version | /ver, /about | bukkit.command.version | Yes                                 |

## Paper command permissions

The following is a list of permissions for Paper commands.

| Command | Aliases | Permission Node      | Players Have Permission By Default? |
|---------|---------|----------------------|-------------------------------------|
| paper   |         | bukkit.command.paper | No                                  |

## Vanilla permissions

The following is a list of all additional Vanilla permissions.

| Permission Node                   | Description                                                                                                           | Players Have Permission By Default? |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------|-------------------------------------|
| minecraft                         | Gives the user the ability to use all vanilla utilities and commands.                                                 | No                                  |
| minecraft.admin.command\_feedback | Receive command broadcasts when sendCommandFeedback is true.                                                          | No                                  |
| minecraft.nbt.place               | Gives the user the ability to place restricted blocks with NBT in creative.                                           | No                                  |
| minecraft.nbt.copy                | Gives the user the ability to copy NBT in creative.                                                                   | Yes                                 |
| minecraft.debugstick              | Gives the user the ability to use the debug stick in creative.                                                        | No                                  |
| minecraft.debugstick.always       | Gives the user the ability to use the debug stick in all game modes.                                                  | No                                  |
| minecraft.commandblock            | Gives the user the ability to use command blocks.                                                                     | No                                  |
| minecraft.command.selector        | Gives the user the ability to use [target selectors](https://minecraft.wiki/w/Target_selectors) in command arguments. | No                                  |

## Bukkit permissions

The following is a list of all additional Bukkit permissions.

| Permission Node        | Description                                          | Players Have Permission By Default? |
|------------------------|------------------------------------------------------|-------------------------------------|
| bukkit.broadcast       | Allows the user to receive all broadcast messages    | No                                  |
| bukkit.broadcast.admin | Allows the user to receive administrative broadcasts | No                                  |
| bukkit.broadcast.user  | Allows the user to receive user broadcasts           | Yes                                 |

## Paper permissions

The following is a list of all additional Paper permissions.

| Permission Node                        | Description                                                      | Players Have Permission By Default? |
|----------------------------------------|------------------------------------------------------------------|-------------------------------------|
| bukkit.command.paper.chunkinfo         | Allows the user to run the chunkinfo sub command                 | No                                  |
| bukkit.command.paper.debug             | Allows the user to run the debug sub command                     | No                                  |
| bukkit.command.paper.dumpitem          | Allows the user to run the dumpitem sub command                  | No                                  |
| bukkit.command.paper.dumplisteners     | Allows the user to run the dumplisteners sub command             | No                                  |
| bukkit.command.paper.dumpplugins       | Allows the user to run the dumpplugins sub command               | No                                  |
| bukkit.command.paper.entity            | Allows the user to run the entity sub command                    | No                                  |
| bukkit.command.paper.fixlight          | Allows the user to run the fixlight sub command                  | No                                  |
| bukkit.command.paper.heap              | Allows the user to run the heap sub command                      | No                                  |
| bukkit.command.paper.holderinfo        | Allows the user to run the holderinfo sub command                | No                                  |
| bukkit.command.paper.mobcaps           | Allows the user to run the mobcaps sub command                   | No                                  |
| bukkit.command.paper.playermobcaps     | Allows the user to run the playermobcaps sub command             | No                                  |
| bukkit.command.paper.reload            | Allows the user to run the reload sub command                    | No                                  |
| bukkit.command.paper.syncloadinfo      | Allows the user to run the syncloadinfo sub command              | No                                  |
| bukkit.command.paper.version           | Allows the user to run the version sub command                   | No                                  |
| paper.antixray.bypass                  | Allows the user to bypass anti-xray if use-permission is enabled | No                                  |
| paper.bypass-visibility.tab-completion | Allows the user to see hidden players in command tab completions | No                                  |


---


# server.properties

An explanation of Minecraft's server.properties file.

import ConfigNode from "/src/components/ConfigNode.astro";
import ServerPropertiesYML from "/src/config/paper/server-properties.yml?raw";
import { parse } from "yaml";

:::note

The below page shows the settings and default values for the `server.properties` file.

Click on a property to learn more about it.

:::

<ConfigNode data={parse(ServerPropertiesYML)} lang="properties" />


---


# spigot.yml

An explanation of Spigot's configuration file.

import ConfigNode from "/src/components/ConfigNode.astro";
import SpigotYML from "/src/config/paper/spigot.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure and default values for `spigot.yml`

Click on a leaf node to view the description for that setting.

:::

:::note

To override a per-world option, create a new key under `world-settings` with the level-name (name of the folder).

:::

<ConfigNode data={parse(SpigotYML)} />


---


# System properties

Documentation for the system properties and environment variables Paper may check.

These system properties and environment variables can be set when you start your server allowing for the configuration
of various settings.

:::danger[Danger Ahead]

Setting flags for the JVM can alter how it operates and the same goes for the Paper server.
If you are unsure about what a flag does, it is recommended that you **do not use it**.

:::

## How they work

System properties are set when you start your server. For example, if you are using a `.bat` or a `.sh` file to start
your server, you can add the system properties to the file. For example:

```bash
java -Dcom.mojang.eula.agree=true -jar paper.jar
```

:::note

Some of Paper's system properties contain a `.` character in their name. When using PowerShell, these will require
wrapping in quotes.
i.e. `"-Dcom.mojang.eula.agree=true"`

:::

Where a `-D` is used to set a system property, and the system property is `com.mojang.eula.agree` with a value of
`true`. Otherwise, just add them to the start command.

:::note

Where a system property is stated as `unset`, setting it as `true` will work to enable it.

:::

[Environment variables](https://en.wikipedia.org/wiki/Environment_variable) are another way to pass values to Paper.
They can be set in various ways, depending on your operating system and how you start Paper.

In most cases, you will not need to use these, unless you are running Paper in a (Docker) container or such.

## List of system properties

#### paper.playerconnection.keepalive

- **default**: `30`
- **description**: Controls how long the player connection will wait before closing when not receiving any keepalives,
  in seconds.

#### timings.bypassMax

:::danger[Deprecation]

Timings are deprecated. Due to that, this flag does not have any effect.

:::

- **default**: `unset`
- **description**: Allows for bypassing the max amount of data to send to the Aikar's Timings API. Setting this will not
  permit bypassing the limit unless the API is configured to allow it.

#### LetMeReload

- **default**: `unset`
- **description**: This disables the reload confirmation message when using the `/reload` command.

#### paper.disableChannelLimit

- **default**: `unset`
- **description**: Disables the plugin channel limit for the server. This will disable the limit of 128 plugin channels
  per player.

#### net.kyori.adventure.text.warnWhenLegacyFormattingDetected

- **default**: `false`
- **description**: Enables or disables the warning when legacy formatting is detected in a chat component.

#### Paper.DisableClassPrioritization

- **default**: `unset`
- **description**: Disables the class prioritization system - mostly an issue when failing to relocate or shade
  properly.

#### Paper.disableFlushConsolidate

- **default**: `unset`
- **description**: Disables the netty flush consolidation system.

#### Paper.debugDynamicMissingKeys

- **default**: `unset`
- **description**: Enables debug logging for missing keys in NBT objects.

#### disable.watchdog

- **default**: `unset`
- **description**: Disables the watchdog warning system.

#### paper.explicit-flush

- **default**: `unset`
- **description**: Enables explicit flushing of the network channel.

#### Paper.enable-sync-chunk-writes

- **default**: `unset`
- **description**: Syncs writes on each write call. This has a performance impact, particularly on hard drives.

#### paper.debug-sync-loads

- **default**: `unset`
- **description**: Enables debug logging for sync chunk loads.

#### Paper.ignoreWorldDataVersion

- **default**: `unset`
- **description**: Ignores the world data version when loading a world. This is not recommended and will likely cause
  issues.

#### Paper.bypassHostCheck

- **default**: `unset`
- **description**: Bypasses the host pattern matching attempt for the client when connecting to the server.

#### paper.maxCustomChannelName

- **default**: `32767`
- **description**: Sets the largest size that a plugin channel name can take.

#### Paper.maxSignLength

- **default**: `80`
- **description**: Sets the maximum line length for signs.

#### Paper.minPrecachedDatafixVersion

- **default**: `Minecraft world version + 1`
- **description**: If you are expecting to convert a large number of chunks you might consider setting this to only
  convert from a point onwards.

#### Paper.WorkerThreadCount

- **default**: half of available physical (**not logical**) cores or `1` if 3 or fewer cores are available
- **description**: Sets the number of worker threads to use for chunk loading.
  See [here](/paper/reference/global-configuration#chunk_system_worker_threads) for more info.

#### Paper.MaxViewDistance

- **default**: `32`
- **description**: Overrides the maximum view distance of the server. This does not set the current view distance,
  it simply modifies the limit.

#### Paper.excessiveTELimit

- **default**: `750`
- **description**: Splits tile entities into multiple packets if there are more than this many.

#### io.papermc.paper.suppress.sout.nags

- **default**: `unset`
- **description**: Suppresses the nag message about using `System.out`/`System.err` in a plugin.
-

#### io.papermc.paper.sout.nags.timeout

- **default**: `5000`
- **description**: Time in milliseconds between nag messages about using `System.out`/`System.err` in a plugin.
  A value equal to or less than 0 results in time-based nags being disabled entirely.

#### io.papermc.paper.sout.nags.interval

- **default**: `200`
- **description**: Amount of repeated `System.out`/`System.err` uses to wait before nagging again. Gets reset if
  the timeout triggers first. A value equal to or less than 0 results in message-based nags being disabled entirely.

#### Paper.skipServerPropertiesComments

- **default**: `unset`
- **description**: Skips the comments in the `server.properties` file.

#### paper.alwaysPrintWarningState

- **default**: `unset`
- **description**: Always prints the warning state for the particular level.

#### Paper.parseYamlCommentsByDefault

- **default**: `true`
- **description**: Sets whether to parse comments in YAML files by default.

#### paperclip.patchonly

- **default**: `false`
- **description**: If the server is started via the Paperclip patch utility (the default distribution on the downloads
  page) then this sets whether it should only patch the Vanilla server and download libraries without starting the
  server.

#### Paper.IgnoreJavaVersion

- **default**: `false`
- **description**: Allows you to bypass the Java version check.
  See [here](/paper/faq#unsupported-java-detected-what-do-i-do) for more info.

#### paper.disableStartupVersionCheck

- **default**: `unset`
- **description**: If set, disables the automatic update checking on startup. See [here](/paper/misc/update-checker) for
  more info.

#### paper.useLegacyPluginLoading

- **default**: `false`
- **description**: Allows cyclic plugin loading. See [here](/paper/reference/paper-plugins#cyclic-plugin-loading) for
  more info.

#### paper.disableOldApiSupport

- **default**: `false`
- **description**: Disables plugin compatibility measures that can otherwise result in a considerable delay of class
  loading (also known as "Commodore" plugin rewriting). This generally requires all of your plugins to be compiled
  against a recent API version.

#### paper.preferSparkPlugin

- **default**: `false`
- **description**: Whether the bundled spark profiler should be disabled in favor of a standalone plugin. If the spark
  plugin is not found, the bundled version will be loaded regardless of the setting, unless it
  is [explicitly disabled](/paper/reference/global-configuration#spark_enabled).

#### paper.disableWorldSymlinkValidation

- **default**: `false`
- **description**: Disables the folder walk and symlink validation when loading a world. Significantly improves world
  loading speed on massive worlds (>1TB). This does not disable symlink verification of datapacks.

#### paper.disableMigrationDelay

:::caution

It is not suggested that you use this flag on production servers. Always make sure to back up important data
and know what you are doing.

:::

- **default**: `unset`
- **description**: Disables the 30-second delay before starting a world migration.

#### minecraft.api.session.host

- **default**: `https://sessionserver.mojang.com`
- **description**: Allows specifying of a custom session server URL e.g. for caching. [
  `minecraft.api.services.host`](#minecraftapiserviceshost) and [
  `minecraft.api.profiles.host`](#minecraftapiprofileshost) needs to be set too for this to apply.

#### minecraft.api.services.host

- **default**: `https://api.minecraftservices.com`
- **description**: Allows specifying of a custom services API URL e.g. for caching. [
  `minecraft.api.session.host`](#minecraftapisessionhost) and [
  `minecraft.api.profiles.host`](#minecraftapiprofileshost) needs to be set too for this to apply.

#### minecraft.api.profiles.host

- **default**: `https://api.mojang.com`
- **description**: Allows specifying of a custom profile API URL e.g. for caching. [
  `minecraft.api.session.host`](#minecraftapisessionhost) and [
  `minecraft.api.services.host`](#minecraftapiserviceshost) needs to be set too for this to apply.

#### com.mojang.eula.agree

- **default**: `false`
- **description**: Setting this to true indicates that you have agreed
  with [Mojang's EULA](https://aka.ms/MinecraftEULA), skipping `eula.txt` checks.

#### org.bukkit.plugin.java.LibraryLoader.centralURL

- **default**: `https://maven-central.storage-download.googleapis.com/maven2`
- **description**: Sets the default central repository URL, from which plugins' dependencies declared using the [
  `libraries`](/paper/dev/plugin-yml#libraries) plugin.yml field are resolved. This is overridden by the [
  `PAPER_DEFAULT_CENTRAL_REPOSITORY`](#paper_default_central_repository) environment variable, if it is set.

:::caution

If you wish to configure this with Maven Central, use a mirror, as using Maven Central directly as a CDN is against the
Maven Central Terms of Service, and you may hit rate limits.

By default, this uses Google's NA mirror of Maven Central. You may also use region-specific mirrors
listed [here](https://storage-download.googleapis.com/maven-central/index.html).

:::

#### paper.debugEntitiesWithInvalidIds

- **default**: `false`
- **description**: Enables logging the full entity NBT when an entity with a missing or otherwise invalid entity id is
  attempted to be loaded. (Whenever 'Skipping Entity with id' is logged to the console.)

#### paper.maxChatCommandInputSize

- **default**: `256`
- **description**: The maximum length a chat command may have. A Vanilla client cannot send more than 256 characters.

#### management.tls.keystore.password

- **default**: `unset`
- **description**: Overrides the value set for `management-server-tls-keystore-password` in `server.properties`.

## List of environment variables

#### PAPER_VELOCITY_SECRET

- **default**: `unset`
- **description**: Overrides the [
  `proxies.velocity.secret`](/paper/reference/global-configuration#proxies_velocity_secret) global configuration option.

#### PAPER_DEFAULT_CENTRAL_REPOSITORY

- **default**: `https://maven-central.storage-download.googleapis.com/maven2`
- **description**: Sets the default central repository URL, from which plugins' dependencies declared using the [
  `libraries`](/paper/dev/plugin-yml#libraries) plugin.yml field are resolved. This overrides the [
  `org.bukkit.plugin.java.LibraryLoader.centralURL`](#orgbukkitpluginjavalibraryloadercentralurl) system property, if it
  is set.

#### MINECRAFT_MANAGEMENT_TLS_KEYSTORE_PASSWORD

- **default**: `unset`
- **description**: Overrides the value set for `management-server-tls-keystore-password` in `server.properties`. This
  take precedence over the `management.tls.keystore.password` system property.

:::caution

If you wish to configure this with Maven Central, use a mirror, as using Maven Central directly as a CDN is against the
Maven Central Terms of Service, and you may hit rate limits.

By default, this uses Google's NA mirror of Maven Central. You may also use region-specific mirrors
listed [here](https://storage-download.googleapis.com/maven-central/index.html).

:::


---


# Vanilla data files

An explanation of Minecraft's data files.

import ConfigNode from "/src/components/ConfigNode.astro";
import { parse } from "yaml";
import EulaYML from "/src/config/paper/eula.yml?raw";
import BannedIpsYML from "/src/config/paper/banned-ips-single.yml?raw";
import BannedPlayersYML from "/src/config/paper/banned-players-single.yml?raw";
import OpsYML from "/src/config/paper/ops-single.yml?raw";
import WhitelistYML from "/src/config/paper/whitelist-single.yml?raw";

## `eula.txt`

`eula.txt` is a simple config file that allows you to accept the [EULA](https://aka.ms/MinecraftEULA),
which is required to run the Minecraft server.

<ConfigNode data={parse(EulaYML)} lang="properties" path={["eula"]} />

## `banned-ips.json`

`banned-ips.json` is a JSON file that stores IP addresses that are not allowed to connect to the server.

:::caution

This is a data file used by the server, not a configuration file.

We do not recommend editing this file directly, and this is provided for reference only.

Instead, use the `/ban-ip`, `/pardon-ip`, and `/banlist ips` commands to manage banned-ips.json.

:::

<ConfigNode data={parse(BannedIpsYML)} lang="json" path={["banned_ips"]} />

## `banned-players.json`

`banned-players.json` is a JSON file that stores players that are not allowed to connect to the server.

:::caution

This is a data file used by the server, not a configuration file.

We do not recommend editing this file directly, and this is provided for reference only.

Instead, use the `/ban`, `/pardon`, and `/banlist players` commands to manage banned-players.json.

:::

<ConfigNode data={parse(BannedPlayersYML)} lang="json" path={["banned_players"]} />

## `ops.json`

`ops.json` is a JSON file that stores player's operator status information.

In Vanilla, this is used as a rudimentary permissions system, and to allow certain player to bypass the player limit.

:::caution

This is a data file used by the server, not a configuration file.

We do not recommend editing this file directly, and this is provided for reference only.

Instead, use the `/op`, `/deop` commands to manage ops.json.

:::

<ConfigNode data={parse(OpsYML)} lang="json" path={["ops"]} />

## `whitelist.json`

`whitelist.json` is a JSON file that stores players that are allowed to connect to the server.

It is used in conjunction with the [`white-list`](/paper/reference/server-properties#white_list) option in `server.properties`.

:::caution

This is a data file used by the server, not a configuration file.

We do not recommend editing this file directly, and this is provided for reference only.

Instead, use the `/whitelist` command to manage whitelist.json.

:::

<ConfigNode data={parse(WhitelistYML)} lang="json" path={["whitelist"]} />


---


# World configuration

An explanation of Paper's world configuration file.

import ConfigNode from "/src/components/ConfigNode.astro";
import PaperWorldDefaultsYML from "/src/config/paper/paper-world-defaults.yml?raw";
import { parse } from "yaml";

:::note

The below YAML shows you the structure and default values for the world configuration (`config/paper-world-defaults.yml` and
`world/dimensions/<namespace>/<key>/paper-world.yml`).

Click on a leaf node to view the description for that setting.

:::

<ConfigNode data={parse(PaperWorldDefaultsYML)} />


---


# Updating

Paper has new features and fixes coming every day, this guide explains the updating process.

Updating Paper is an important part of running every server. With new features and fixes coming
every day, we recommend updating at least once per week to keep your server patched for the latest
bugs. Installing updates is very simple, but it's important to know how to do it correctly.

:::caution[Don't replace any JAR in a running server]

Unless you know exactly what and why you're doing what you're doing, it's never a good idea to
replace any JAR in a running server, be that plugins, or Paper itself.

:::

## Step 1. Backup

:::tip

If you are using a shared host, your host may provide a built-in way to back up. Consult their
documentation before continuing.

:::

This is the most important step, and yet the most frequently skipped. While it is unlikely that
updating Paper itself will cause any issues requiring you to restore from a backup, plugin
malfunctions or other accidents might! Updating is a great time to work in a backup. Having
functioning backups is essential to every server, big or small. The main things to back up are:

- The world folders
- Server Configuration Files
- Plugin Configuration Files & Plugin JARs

You should aim to have backups from multiple times, and keep them in a safe place. A common approach
is to keep rolling backups, so you always have a certain number of backups from a set amount of time.

## Step 2. Update plugins

Just like it's important to update Paper, it's equally important to keep plugins up to date. You
never know what plugin authors may be working on, be it bugfixes or new features.

A little known feature of Paper servers is the `update` folder. Here's how you use it.

1. Create a folder called `update` within the `plugins` folder.
2. One by one, download plugins you would like to update and put them in the `update` folder.
3. Restart your server, do not remove or modify any plugins outside the `update` folder.

By doing this, you are able to update all of your plugins at the same time without having the server
off, or replacing plugin JARs while the server is running. You do not need to restart your server
before updating Paper itself. This feature allows you to update both Paper and plugins all at the
same time, without needing any additional downtime.

## Step 3. Update Paper

:::tip

If you are using a shared host, your host may provide a built-in way to update! Consult their
documentation before continuing.

:::

Updating Paper itself is very simple.

1. Download a new JAR from [our downloads page](https://papermc.io/downloads).
2. Stop your server. It is not recommended and may cause issues to replace your Paper JAR while the server is running.
3. Rename the downloaded file to match the name specified in the [start command](/paper/getting-started#running-the-server).
4. Replace your old Paper JAR file with the new renamed one.
5. Start your server. Watch the startup log to ensure everything goes to plan. If there are any
   plugin conflicts or issues, you will see them here.

To minimize downtime caused by updates, some server owners will, rather than replacing their server
JAR, upload a new one and set their start script to use the new one on the next restart. Both of
these are valid update strategies.

:::caution[Automatic Updates]

While it may be convenient to install updates automatically (and Paper's [downloads service](/misc/downloads-service) allows you
to with ease), doing so is not recommended by Paper due to the possibility of plugin conflicts or
other issues that you may not know about. Always be present during updates, and keep a careful watch
on your server's log after the fact.

If you do choose to automatically install updates, ensure you have a functioning backup strategy in
place!

:::


---


# Vanilla-like experience

This page lists all changes that result in a different experience than Vanilla.

import ConfigNode from "/src/components/ConfigNode.astro";
import { filterVanilla } from "/src/utils/config";
import { parse } from "yaml";

import ServerPropertiesYML from "/src/config/paper/server-properties.yml?raw";
import PaperWorldDefaultsYML from "/src/config/paper/paper-world-defaults.yml?raw";
import PaperGlobalYML from "/src/config/paper/paper-global.yml?raw";
import SpigotYML from "/src/config/paper/spigot.yml?raw";

Due to the way the Bukkit API is implemented in Paper, the gameplay experience between Vanilla and Paper can have inconsistencies.
This can be furthered by efforts to fix bugs present in Vanilla Minecraft.
Whilst many people may not notice the inconsistencies, there are situations where they become problematic.
One example is that technical players may struggle getting their machines to work like they should.
This page aims to provide a starting point for players who want to get as close to Vanilla as possible.

:::note

This page is inspired by [Earthcomputer's collection](https://gist.github.com/Earthcomputer/2296da33b8cc91dba81b48103c0e1fe3) of Vanilla breaking changes.

:::

:::caution

This guide will only help you to get as close to Vanilla as possible.
Unfortunately, it currently is not possible to get a 100% Vanilla experience in Paper.

:::
## server.properties
<ConfigNode data={filterVanilla(parse(ServerPropertiesYML))} lang="properties" path={["server_properties"]} />

## paper-world-defaults.yml
<ConfigNode data={filterVanilla(parse(PaperWorldDefaultsYML))} path={["paper_world_defaults"]} />

## paper-global.yml
<ConfigNode data={filterVanilla(parse(PaperGlobalYML))} path={["paper_global"]} />

## spigot.yml
<ConfigNode data={filterVanilla(parse(SpigotYML))} path={["spigot"]} />

## Further considerations

* `settings.timeout-time` in `spigot.yml` mirrors the watchdog setting in the `server.properties` file. Keep in mind that the `spigot.yml` setting is in seconds while the default setting is in milliseconds.
* `watchdog` in `paper-global.yml` controls the watchdog early warning. While this is only a warning, you might want to disable it as it can get annoying.


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
