---
title: "Using the scheduler"
source: "https://docs.papermc.io/velocity/dev/scheduler-api/"
description: "A guide to the Scheduler API within Velocity allowing tasks to be run."
fetched_at: "2026-10-19T21:16:10.850Z"
---

# Using the scheduler

The Velocity scheduler lets you decide when and how your plugin tasks run, allowing fine control over execution. On Velocity, there is no main thread. All tasks run using the Velocity scheduler are thus run asynchronously.

## Running a delayed task

All scheduling works by using a [`TaskBuilder`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/Scheduler.TaskBuilder.html) returned from the [`Scheduler`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/Scheduler.html). This fluent builder may be chained to configure the details of the scheduling.

```java
server.getScheduler()
  .buildTask(plugin, () -> {
    // do stuff here
  })
  .delay(2L, TimeUnit.SECONDS)
  .schedule();
```

Here, we are scheduling a task to run 2 seconds later. Velocity requires the instance of your plugin, `plugin` above. If you are scheduling a task from your main plugin class you may simply use `this`.

Time arguments are specified as a `long` with a [`TimeUnit`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/TimeUnit.html). Using time units makes scheduling delayed tasks more readable and allows for greater precision. `2L, TimeUnit.SECONDS` is far easier to understand than the ambiguous `2000L`.

You can also use a [`Duration`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Duration.html) to specify the time arguments, e.g.: `Duration.ofSeconds(5L)`.

## Running a repeating task

Creating a repeating task is similar to a delayed task, but you must also specify [`repeat(long, TimeUnit)`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/Scheduler.TaskBuilder.html#repeat\(long,java.util.concurrent.TimeUnit\)). This example will repeat every 5 minutes.

```java
server.getScheduler()
  .buildTask(plugin, () -> {
    // do stuff here
  })
  .repeat(5L, TimeUnit.MINUTES)
  .schedule();
```

## Running a task now

Tasks use the scheduler’s cached thread pool for all execution, which reuses threads. To take advantage of this thread pool for running async tasks which run now, simply omit calling the *delay* and *repeat* methods of the `TaskBuilder`.

## Cancellation

The [`schedule()`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/Scheduler.TaskBuilder.html#schedule\(\)) method returns a [`ScheduledTask`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/ScheduledTask.html), which may then be used to cancel the task involved via the [`cancel()`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/ScheduledTask.html#cancel\(\)) method. Tasks cannot be uncancelled.

Additionally, [`task.status()`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/ScheduledTask.html#status\(\)) returns the current status of the task.

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

You can also schedule *self-cancelling* tasks using a `Consumer<ScheduledTask>`.

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

You can get all tasks scheduled by a plugin with [`tasksByPlugin(Object)`](https://jd.papermc.io/velocity/com/velocitypowered/api/scheduler/Scheduler.html#tasksByPlugin\(java.lang.Object\)).

```java
Collection<ScheduledTask> tasks = server.getScheduler().tasksByPlugin(plugin);
// then you can control them, for example, cancel all task scheduled by a plugin
for (ScheduledTask task : tasks) {
  task.cancel();
}
```
