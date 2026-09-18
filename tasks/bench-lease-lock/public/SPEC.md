# LEASE, a lock service with leased locks and wait queues

A lock service guards five resources, R1 to R5. Clients are named C1 to C8. `events.log` is the complete input: one event per line, in the order the service processes them. A line has the form

    <tick> <client> <action> <resource> [<lease>]

`tick` is a non-negative integer clock value. Ticks never decrease from one line to the next; events with equal ticks are processed in the order they appear. `action` is `LOCK`, `UNLOCK` or `RENEW`. `LOCK` and `RENEW` carry a positive integer `lease` (a number of ticks); `UNLOCK` carries none.

## State

Each resource has:

- a holder: one client, or nobody;
- if it has a holder, a deadline: a tick number;
- a wait queue: an ordered list of requests, each being a client together with a lease length. It starts empty.

At the start every resource has nobody as holder and an empty queue.

## Expiry

The service never wakes up by itself. Before it processes an event that names resource X, it looks at X only: if X has a holder and the holder's deadline is less than or equal to the event's tick, that holder loses X exactly as if it had unlocked it at that tick (see UNLOCK below for what happens next). Other resources are not looked at. A resource that no later event names keeps whatever state it had after the last event that named it, even if its deadline has passed.

## Events

`LOCK X n`, by client c. First apply the expiry check to X. Then:

- if X has nobody as holder, c becomes the holder with deadline equal to the tick plus n;
- otherwise the request (c, n) is added to the end of X's wait queue.

`UNLOCK X`, by client c. First apply the expiry check to X. Then, if c is the holder of X, c stops being the holder. If the wait queue is not empty, its first request (d, m) is removed from the queue and d becomes the holder with deadline equal to the tick plus m; if the queue is empty, X is left with nobody as holder. If c is not the holder of X, nothing changes.

`RENEW X n`, by client c. First apply the expiry check to X. Then, if c is the holder of X, its deadline becomes the tick plus n. Otherwise nothing changes.

The hand-over described under UNLOCK applies whenever a holder loses a resource, whether by UNLOCK or by the expiry check.

## Answer

After the last event has been processed, print one line describing the five resources in the order R1 to R5, joined by a single space. Each resource is written as `R<k>:<state>[<queue>]`. `<state>` is `free` when the resource has nobody as holder, otherwise `<client>@<deadline>` (for example `C3@41`). `<queue>` is the clients in the wait queue from first to last, separated by `,` with no spaces, empty when the queue is empty. For example: `R1:C3@41[C2,C5] R2:free[] R3:C7@60[]`.
