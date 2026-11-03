# API and synchronization

The SPA and API share an origin. JSON mutation requests require
`Content-Type: application/json`; browser writes from other origins are rejected.
The household has one active `tripId` and a monotonically increasing `revision`.

| Method and path | Purpose |
| --- | --- |
| GET `/api/state` | Authoritative active items and named layouts |
| GET `/api/history` | Read-only completed snapshots, newest first |
| GET `/api/history/{id}` | One completed trip |
| GET `/api/events` | SSE `ready` and committed `change` events |
| POST `/api/operations` | Queued `trip_set`, `layout_order`, one-time `item_add` |
| POST `/api/items` | Add a reusable checklist item |
| PATCH `/api/items/{id}` | `item_edit`: name, counter, showTags, tags |
| DELETE `/api/items/{id}` | `item_delete`, with complete base item |
| POST `/api/layouts` | `layout_add` |
| PATCH `/api/layouts/{id}` | `layout_rename` |
| DELETE `/api/layouts/{id}` | `layout_delete`, with complete base layout |
| POST `/api/finish` | Atomically finish this trip at its exact revision |
| GET `/health/live`, `/health/ready` | Process health / database connectivity |

Every mutation is an operation, for example:

```json
{"id":"unique-operation-id","tripId":"current-trip-id","kind":"trip_set","itemId":"milk","field":"count","base":0,"value":2}
```

For trip changes, `field` is `needed`, `count`, `selectedTags`, or `purchased`.
The relevant field's previous value is `base`. New items include `itemId`, `name`,
`reusable`, `counter`, `showTags`, and available `tags`. Layout ordering includes
`layoutId`, `base` (the old full order), and `value` (the resulting full order).
Finish uses `id`, `tripId`, `kind: "finish"`, and `revision`.

Success returns `{state, history?, replay?}`. A conflict returns HTTP409 with
`{state, problem:{code,message,current?}}`; invalid controls return422. Independent
fields merge; an already-applied identical value converges. Competing absolute
counts are choices, not additive increments. The exact acknowledged request id
can be retried indefinitely; reusing it for a different request is rejected.
Conflicting requests are not acknowledged. Choosing a new value creates a new id
with the freshly reviewed base. Requests from a finished trip require review even
when a field's value happens to match. Finish retries keep the original operation
id so a lost response cannot finish another trip.

State row locking, history insertion, operation acknowledgment and trip rotation
share a PostgreSQL transaction. Failed mutations cannot partially update state.
SSE signals are published after commit and include revision/operation id; dropped
signals and server restarts are recovered by an authoritative fetch on startup,
SSE reconnect, network reconnect and app focus. Idle clients use heartbeats, not
periodic database queries. The browser durably stores snapshots and the FIFO queue
before marking changes saved locally. Reordering conflicts show both resulting
orders. A queue pauses at the first conflict; subsequent changes remain retained.

Migration files are embedded and checksum checked under a startup advisory lock.
Never edit a migration after it is deployed or merged to the default branch; add
a new numbered SQL file. The database schema named by DB_SEARCH_PATH must exist.
There are no mutation endpoints for completed trip history.
