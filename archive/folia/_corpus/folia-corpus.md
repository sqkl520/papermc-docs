
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


# Administration

import PageCards from "/src/components/PageCards.astro";

Welcome to the Folia administration guide! This guide includes information and tutorials
regarding the administration of a Folia server.

#### Reference

<PageCards path="src/content/docs/folia/admin/reference/index.mdx" />


---


# Reference

import PageCards from "/src/components/PageCards.astro";

A reference of how Folia works.

<PageCards />


---


# Frequently asked questions

Questions frequently asked by our community, answered by us!

## What server types can benefit from Folia?
Server types that naturally spread players out,
like skyblock or SMP, will benefit the most from Folia. The server
should have a sizeable player count, too.

## What hardware will Folia run best on?
Ideally, at least 16 _cores_ (not threads).

## How to best configure Folia?
First, it is recommended that the world is pre-generated so that the number
of chunk system worker threads required is reduced greatly.

The following is a _very rough_ estimation based on the testing
done before Folia was released on the test server we ran that
had ~330 players peak. So, it is not exact and will require further tuning -
just take it as a starting point.

The total number of cores on the machine available should be
taken into account. Then, allocate threads for:
- netty IO: ~4 per 200-300 players
- chunk system io threads: ~3 per 200-300 players
- chunk system workers if pre-generated, ~2 per 200-300 players
- There is no best guess for chunk system workers if not pre-generated, as
  on the test server we ran we gave 16 threads but chunk generation was still
  slow at ~300 players.
- GC Settings: ???? But, GC settings _do_ allocate concurrent threads, and you need
  to know exactly how many. This is typically through the `-XX:ConcGCThreads=n` flag. Do not
  confuse this flag with `-XX:ParallelGCThreads=n`, as parallel GC threads only run when
  the application is paused by GC and as such should not be taken into account.

After all of that allocation, the remaining cores on the system until 80%
allocation (total threads allocated < 80% of cpus available) can be
allocated to tickthreads (under global config, `threaded-regions.threads`).

The reason you should not allocate more than 80% of the cores is due to the
fact that plugins or even the server may make use of additional threads
that you cannot configure or even predict.

Additionally, the above is all a rough guess based on player count, but
it is very likely that the thread allocation will not be ideal, and you
will need to tune it based on usage of the threads that you end up seeing.

## What commands does Folia disable?
Folia currently disables a handful of commands. These are them:
- Bossbar commands
- Clone commands
- Data commands
- Datapack
- Debug
- Function
- Item commands
- Loot
- Reload
- Return
- Ride
- Rotate
- Schedule
- Scoreboard
- Spectate
- SpreadPlayers
- Tag
- Team
- TeamMsg
- Tick
- Trigger
- Perf
- SaveAll
- Restart


---


# Overview

An overview of how Folia works.

Described in this document is the abstract overview
of changes done by Folia. Folia splits the chunks within all loaded worlds
into independently ticking regions so that the regions are ticked
independently and in parallel. Described first will be intra region
operations, and then inter region operations.

## Rules for independent regions

In order to ensure that regions are independent, the rules for
maintaining regions must ensure that a ticking region
has no directly adjacent neighbor regions which are ticking.
The following rules guarantee the invariant is upheld:
1. Any ticking region may not grow while it is ticking.
2. Any ticking region must initially own a small buffer of chunks outside
   its perimeter.
3. Regions may not _begin_ to tick if they have a neighboring adjacent
   region.
4. Adjacent regions must eventually merge to form a single region.

Additionally, to ensure that a region is not composed of independent regions
(which would hinder parallelism), regions composed of more than
one independent area must be eventually split into independent regions
when possible.

Finally, to ensure that ticking regions may store and maintain data
about the current region (i.e. tick count, entities within the region, chunks
within the region, block/fluid tick lists, and more), regions have
their own data object that may only be accessed while ticking the region and
by the thread ticking the region. Also, there are callbacks to merging
or splitting regions so that the data object may be updated appropriately.

The implementation of these rules is described in [Region Logic](/folia/reference/region-logic).

The end result of applying these rules is that a ticking region can ensure that
only the current thread has write access to any data contained within the region,
and that at any given time the number of independent regions is close to maximum.

## Intra-region operations

Intra-region operations refer to any operations that only deal with data
for a single region by the owning region, or to merge/split logic.

### Ticking for independent regions

Independent regions tick independently and in parallel. To tick independently
means that regions maintain their own deadlines for scheduling the next tick. For
example, consider two regions A and B such that A's next tick start is at t=15ms
and B's next tick start is at t=0ms. Consider the following sequence of events:
1. At t = 0ms, B begins to tick.
2. At t = 15ms, A begins to tick.
3. At t = 20ms, B is finished its tick. It is then scheduled to tick again at t = 50ms.
4. At t = 50ms, B begins its 2nd tick.
5. At t = 70ms, B finishes its 2nd tick and is scheduled to tick again at t = 100ms.
6. At t = 95ms, A finishes its _first_ tick. It is scheduled to tick again at t = 95ms.

It is important to note that at no time was B's schedule affected by the fact that
A fell behind its 20TPS target.

To implement the described behavior, each region maintains a repeating
task on a scheduled executor (see `SchedulerThreadPool`) that schedules
tasks according to an earliest-start-time-first scheduling algorithm. The
algorithm is similar to EDF, but schedules according to start time. However,
given that the deadline for each tick is 50ms + the start time, it behaves
identically to the EDF algorithm.

The EDF-like algorithm is selected so that as long as the thread pool is
not maximally utilized, that all regions that take <= 50ms to tick will
maintain 20TPS. However, the scheduling algorithm is neither NUMA aware
nor CPU core aware - it will not make attempts (when n regions > m threads)
to pin regions to certain cores.

Since regions tick independently, they maintain their own tick counters. The
implications of this are described in the next section.

### Tick counters

In standard Vanilla, there are several important tick counters: Current Tick,
Game Time Tick, and Daylight Time Tick. The Current Tick counter is used
for determining the tick number since the server has booted. The Game Time
Tick is maintained per world and is used to schedule block ticks
for redstone, fluids, and other physics events. The Daylight Time Tick
is simply the number of ticks since noon, maintained per world.

In Folia, the Current Tick is maintained per region. The Game Time Tick
is split into two counters: Redstone Time and Global Game Time.
Redstone Time is maintained per region. Global Game Time and
Daylight Time are maintained by the "global region."

At the start of each region tick, the global game time tick and
daylight time tick are copied from the global region and any time
the current region retrieves those values, it will retrieve from
the copy received at the start of tick. This is to ensure that
for any two calls to retrieve the tick number throughout the tick,
that those two calls report the same tick number.

The global game time is maintained for a couple of reasons:
1. There needs to be a counter representing how many ticks a world
   has existed for, since the game does track total number of days
   the world has gone on for.
2. Significant amounts of new entity AI code uses game time (for
   a reason I cannot divine) to store absolute deadlines of tasks.
   It is not impossible to write code to adjust the deadlines of
   all of these tasks, but the amount of work is significant.

#### Global region

The global region is a single scheduled task that is always scheduled
to run at 20TPS that is responsible for maintaining data that is not
tied to any specific region: game rules, global game time, daylight time,
console command handling, world border, weather, and others. Unlike the other
regions, the global region does not need to perform any special logic
for merging or splitting because it is never split or merged - there is
only one global region at any time. The global region does not own
any region specific data.

#### Merging and splitting region tick times

Since redstone and current ticks are maintained per region, there needs
to be appropriate logic to adjust the tick deadlines used by the block/fluid
tick scheduler and anything else that schedules by redstone/current
absolute tick time so that the relative deadline is unaffected.

When merging a region x (from) into a region y (into or to),
we can either adjust both the deadlines of x and y or just one of x and y.
It is simply easier to adjust one, and arbitrarily the region x is chosen.
Then, the deadlines of x must be adjusted so that considering the current
ticks of y that the relative deadlines remain unchanged.

Consider a deadline d1 = from tick + relative deadline in region x.
We then want the adjusted deadline d2 to be d2 = to tick + relative deadline
in region y, so that the relative tick deadline is maintained. We can
achieve this by applying an offset o to d1 so that d1 + o = d2, and the
offset used is o = tick to - tick from. This offset must be calculated
for redstone tick and current tick separately, since the logic to increase
redstone tick can be turned off by the `Level#tickTime` field.

Finally, the split case is easy - when a split occurs,
the independent regions from the split inherit the redstone/current tick
from the parent region. Thus, the relative deadlines are maintained as there
is no tick number change.

In all cases, redstone or any other events scheduled by current tick
remain unaffected when regions split or merge as the relative deadline
is maintained by applying an offset in the merge case and by copying
the tick number in the split case.

## Inter-region operations

Inter-region operations refer to operations that work with other regions that are not
the current ticking region that are in a completely unknown state. These
regions may be transient, may be ticking, or may not even exist.

### Utilities to assist operations

In order to assist in inter region operations, several utilities are provided.
In NMS, these utilities are the `EntityScheduler`, the `RegionizedTaskQueue`,
the global region task queue, and the region-local data provider
`RegionizedData`. The Folia API has similar analogues, but does not have
a region-local data provider as the NMS data provider holds critical
locks and is invoked in critical areas of code when performing any
callback logic and is thus highly susceptible to fatal plugin errors
involving lengthy I/O or world state modification.

#### `EntityScheduler`

The `EntityScheduler` allows tasks to be scheduled to be executed on the
region that owns the entity. This is particularly useful when dealing
with entity teleportation, as once an entity begins an asynchronous
teleport the entity cannot tick until the teleport has completed, and
the timing is undefined.

#### `RegionizedTaskQueue`

The `RegionizedTaskQueue` allows tasks to be scheduled to be executed on
the next tick of a region that owns a specific location, or creating
such region if it does not exist. This is useful for tasks that may
need to edit or retrieve world/block/chunk data outside the current region.

#### Global region task queue

The global region task queue is simply used to perform edits on data
that the global region owns, such as game rules, day time, weather,
or to execute commands using the console command sender.

#### `RegionizedData`

The `RegionizedData` class allows regions to define region-local data,
which allow regions to store data without having to consider concurrent
data access from other regions. For example, current per region
entity/chunk/block/fluid tick lists are maintained so that regions do not
need to consider concurrent access to these data sets.

The utilities allow various cross-region issues to be resolved in a
simple fashion, such as editing block/entity/world state from any region
by using tasks queues, or by avoiding concurrency issues by using
RegionizedData. More advanced operations such as teleportation,
player respawning, and portalling, all make use of these utilities
to ensure the operation is thread-safe.

### Entity intra- and inter-dimension teleports

Entities need special logic in order to teleport safely between
other regions or other dimensions. In all cases however, the call to
teleport/place an entity must be invoked on the region owning the entity.
The `EntityScheduler` can be used to easily schedule code to execute in such
a context.

#### Simple teleportation

In a simple teleportation, the entity already exists in a world at a location
and the target location and dimension are known.
This operation is split into two parts: transform and async place.
In this case, the transform operation removes the entity from the current
world, then adjusts the position. The async place operation schedules a task
to the target location using the `RegionizedTaskQueue` to add the entity to
the target dimension at the target position.

The various implementation details such as non-player entities being
copied in the transform operation are left out, as those are not relevant
for the high level overview.

Things such as player login and player respawn are generally
considered simple teleportation. The player login case only differs
since the player does not exist in any world at the start, and that the async
transform must additionally find a place to spawn the player.
The player respawn is similar to the player login as the respawn
differs by having the player in the world at the time of respawn.

#### Portal teleport

Portal teleport differs from simple teleportation as portalling does
_not_ know the exact location of the teleport. Thus, the transform step
does not update the entity position, but rather a new operation is inserted
between transform and async place: an async search/create, which is responsible
for finding and/or creating the exit portal.

Additionally, the current Vanilla code can refuse a teleport if the
entity is non-player and the nether exit portal does not already exist. But
since the portal location is only determined by the async place, it is
too late to abort - so, the portal logic has been re-done so that there is no
difference between players and entities. Now both entities and players
create exit portals, whether it be for the nether or end.

#### Shutdown during teleport

Since the teleport happens over multiple steps, the server shutdown
process must deal with uncompleted teleportations manually.

## Server shutdown process

The shutdown process occurs by spawning a separate shutdown thread,
which then runs the shutdown logic:
1. Shutdown the tick region scheduler, stopping any further ticks
2. Halt metrics processing
3. Disable plugins
4. Stop accepting new connections
5. Send disconnect (but do not remove) packets to all players
6. Halt the chunk systems for all worlds
7. Execute shutdown logic for all worlds by finish all pending teleports
   for all regions, then saving all chunks in the world, and finally
   saving the level data for the world (level.dat and other .dat files).
8. Save all players
9. Shutting down the resource manager
10. Releasing the level lock
11. Halting remaining executors (Util executor, region I/O threads, etc.)

The important differences to Vanilla is that the player kick and
world saving logic is replaced by steps 5-8.

For step 5, the players cannot be kicked before teleportations are finished,
as kicking would save the player dat file. So, save is moved after.

For step 6, the chunk system halt is done before saving so that all chunk
generation is halted. This will reduce the load on the server as it shuts
down, which may be critical in memory-constrained scenarios.

For step 7, teleportations are completed differently depending on the type:
simple or portal.

Simple teleportations are completed by ensuring the addition
of the teleporting entity to the destination chunk specified
by teleportation. This allows the entity to be saved at the target
position, as if the teleportation did complete before shutdown.

Portal teleportations are completed by forcing the addition
of the teleporting entity to the source chunk, from where the entity should
have been teleported _from_. Since the target location is not known, the entity
can only be placed back at the origin (no teleportation). While this behavior
is not ideal, the shutdown logic _must_ account for any broken world state -
which means that finding or creating the target exit portal may not be an option.

The teleportation completion must be performed before the world save so that
the teleport completed entities save.

For step 8, only save players after the teleportations are completed.

The remaining steps are Vanilla.


---


# Region logic

An overview to how Folia's regionizer works.

## Fundamental regionizing logic

## Region

A region is simply a set of owned chunk positions and implementation
defined unique data object tied to that region. It is important
to note that for any non-dead region x, that for each chunk position y
it owns that there is no other non-dead region z such that
the region z owns the chunk position y.

## Regionizer

Each world has its own regionizer. The regionizer is a term used
to describe the logic that the class `ThreadedRegionizer` executes
to create, maintain, and destroy regions. Maintenance of regions is
done by merging nearby regions together, marking which regions
are eligible to be ticked, and finally by splitting any regions
into smaller independent regions. Effectively, it is the logic
performed to ensure that groups of nearby chunks are considered
a single independent region.

## Guarantees the regionizer provides

The regionizer provides a set of important invariants that allows
regions to tick in parallel without race conditions:

### First invariant

The first invariant is simply that any chunk holder that exists
has one, and only one, corresponding region.

### Second invariant

The second invariant is that for every _existing_ chunk holder x that is
contained in a region that every each chunk position within the
"merge radius" of x is owned by the region. Effectively, this invariant
guarantees that the region is not close to another region, which allows
the region to assume while ticking it can create data for chunk holders
"close" to it.

### Third invariant

The third invariant is that a ticking region _cannot_ expand
the chunk positions it owns as it ticks. The third invariant
is important as it prevents ticking regions from "fighting"
over non-owned nearby chunks, to ensure that they truly tick
in parallel, no matter what chunk loads they may issue while
ticking.

To comply with the first invariant, the regionizer will
create "transient" regions _around_ ticking regions. Specifically,
around in this context means close enough that would require a merge,
but not far enough to be considered independent. The transient regions
created in these cases will be merged into the ticking region
when the ticking region finishes ticking.

Both of the second invariant and third invariant combined allow
the regionizer to guarantee that a ticking region may create
and then access chunk holders around it (i.e. sync loading) without
the possibility that it steps on another region's toes.

### Fourth invariant

The fourth invariant is that a region is only in one of four
states: "transient", "ready", "ticking", or "dead."

The "ready" state allows a state to transition to the "ticking" state,
while the "transient" state is used as a state for a region that may
not tick. The "dead" state is used to mark regions which should
not be use.

The states transitions are explained later, as it ties in
with the regionizer's merge and split logic.

## Regionizer implementation

The regionizer implementation is a description of how
the class `ThreadedRegionizer` adheres to the four invariants
described previously.

### Splitting the world into sections

The regionizer does not operate on chunk coordinates, but rather
on "region section coordinates." Region section coordinates simply
represent a grouping of NxN chunks on a grid, where N is some power
of two. The actual number is left ambiguous, as region section coordinates
are only an internal detail of how chunks are grouped.
For example, with N=16 the region section (0,0) encompasses all
chunks x in [0,15] and z in [0,15]. This concept is similar to how
the chunk coordinate (0,0) encompasses all blocks x in [0, 15]
and z in [0, 15]. Another example with N=16, the chunk (17, -5) is
contained within region section (1, -1).

Region section coordinates are used only as a performance
tradeoff in the regionizer, as by approximating chunks to their
region coordinate allows it to treat NxN chunks as a single
unit for regionizing. This means that regions do not own chunks positions,
but rather own region section positions. The grouping of NxN chunks
allows the regionizing logic to be performed only on
the creation/destruction of region sections.
For example with N=16 this means up to NxN-1=255 possible
less operations in areas such as addChunk/region recalculation
assuming region sections are always full.

### Implementation variables

The implementation variables control how aggressively the
regionizer will maintain regions and merge regions.

#### Recalculation count

The recalculation count is the minimum number of region sections
that a region must own to allow it to re-calculate. Note that
a recalculation operation simply calculates the set of independent
regions that exist within a region to check if a split can be
performed.
This is a simple performance knob that allows split logic to be
turned off for small regions, as it is unlikely that small regions
can be split in the first place.

#### Max dead section percent

The max dead section percent is the minimum percent of dead
sections in a region that must exist before a region can run
re-calculation logic.

#### Empty section creation radius

The empty section creation radius variable is used to determine
how many empty region sections are to exist around _any_
region section with at least one chunk.

Internally, the regionizer enforces the third invariant by
preventing ticking regions from owning new region sections.
The creation of empty sections around any non-empty section will
then enforce the second invariant.

#### Region section merge radius

The merge radius variable is used to ensure that for any
existing region section x that for any other region section y within
the merge radius are either owned by region that owns x
or are pending a merge into the region that owns x or that the
region that owns x is pending a merge into the region that owns y.

#### Region section chunk shift

The region section chunk shift is simply log2(grid size N). Thus,
N = 1 << region section chunk shift. The conversion from
chunk position to region section is additionally defined as
region coordinate = chunk coordinate >> region section chunk shift.

### Operation

The regionizer is operated by invoking `ThreadedRegionizer#addChunk(x, z)`
or `ThreadedRegionizer#removeChunk(x, z)` when a chunk holder is created
or destroyed.

Additionally, `ThreadedRegion#tryMarkTicking` can be used by a caller
that attempts to move a region from the "ready" state to the "ticking"
state. It is vital to note that this function will return false if
the region is not in the "ready" state, as it is possible
that even a region considered to be "ready" in the past (i.e. scheduled
to tick) may be unexpectedly marked as "transient." Thus, the caller
needs to handle such cases. The caller that successfully marks
a region as ticking must mark it as non-ticking by using
`ThreadedRegion#markNotTicking`.

The function ThreadedRegion#markNotTicking returns true if the
region was migrated from "ticking" state to "ready" state, and false
in all other cases. Effectively, it returns whether the current region
may be later ticked again.

### Region section state

A region section state is one of "dead" or "alive." A region section
may additionally be considered "non-empty" if it contains
at least one chunk position, and "empty" otherwise.

A region section is considered "dead" if and only if the region section
is also "empty" and that there exist no other "empty" sections within the
empty section creation radius.

The existence of the dead section state is purely for performance, as it
allows the recalculation logic of a region to be delayed until the region
contains enough dead sections. However, dead sections are still
considered to belong to the region that owns them just as alive sections.

### Addition of chunks (`addChunk`)

The addition of chunks to the regionizer boils down to two cases:

#### Target region section already exists and is not empty

In this case, it simply adds the chunk to the section and returns.

#### Target region section does not exist or is empty

In this case, the region section will be created if it does not exist.
Additionally, the region sections in the "create empty radius" will be
created as well.

Then, any region in the create empty radius + merge radius are collected
into a set X. This set represents the regions that need to be merged
later to adhere to the second invariant.

If the set X contains no elements, then a region is created in the ready
state to own all of the created sections.

If the set X contains just 1 region, then no regions need to be merged
and no region state is modified, and the sections are added to this
1 region.

Merge logic needs to occur when there are more than 1 region in the
set X. From the set X, a region x is selected that is not ticking. If
no such x exists, then a region x is created. Every region section
created is added to the set x, as it is the section that is known
to not be ticking - this is done to adhere to the third invariant.

Every region y in the set X that is not x is merged into x if
y is not in the ticking state, otherwise x runs the merge later
logic into y.

### Merge later logic

A merge later operation may only take place from
a non-ticking, non-dead region x into a ticking region y.
The merge later logic relies on maintaining a set of regions
to merge into later per region, and another set of regions
that are expected to merge into this region.
Effectively, a merge into later operation from x into y will add y into x's
merge into later set, and add x into y's expecting merge from set.

When the ticking region finishes ticking, the ticking region
will perform the merge logic for all expecting merges.

### Merge logic

A merge operation may only take place between a dead region x
and another region y which may be either "transient"
or "ready." The region x is effectively absorbed into the
region y, as the sections in x are moved to the region y.

The merge into later is also forwarded to the region y,
such so that the regions x was to merge into later, y will
now merge into later.

Additionally, if there is implementation specific data
on region x, the region callback to merge the data into the
region y is invoked.

The state of the region y may be updated after a merge operation
completes. For example, if the region x was "transient", then
the region y should be downgraded to transient as well. Specifically,
the region y should be marked as transient if region x contained
merge later targets that were not y. The downgrading to transient is
required to adhere to the second invariant.

### Removal of chunks (`removeChunk`)

Removal of chunks from region sections simple updates
the region sections state to "dead" or "alive", as well as the
region sections in the empty creation radius. It will not update
any region state, and nor will it purge region sections.

### Region tick start (`tryMarkTicking`)

The tick start simply migrates the state to ticking, so that
invariants #2 and #3 can be met.

### Region tick end (`markNotTicking`)

At the end of a tick, the region's new state is not immediately known.

First, the region must process its pending merges.

After it processes its pending merges, it must then check if the
region is now pending merge into any other region. If it is, then
it transitions to the transient state.

Otherwise, it will process the removal of dead sections and attempt
to split into smaller regions. Note that it is guaranteed
that if a region can be possibly split, it must remove dead sections,
otherwise, this would contradict the rules used to build the region
in the first place.


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
