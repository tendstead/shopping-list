# Together · Shared Shopping List

A small shared shopping app for one household. Prepare a reusable checklist at
home, shop on separate phones, and keep an immutable record of finished trips.
The interface is available in English and German. There is no application login.

## Run locally

Install Docker Engine and Compose. All build tools and services run in containers.

```sh
cp .env.example .env
make up
```

Open <http://127.0.0.1:8080>. `make down` stops the app without deleting PostgreSQL
storage. `make logs` follows container logs. Initial layouts are Aldi, Walmart,
Home · A, and Home · B; add your household's checklist in **Edit**.

**Shopping list** switches between preparation and shopping on this device.
Counters control needed quantities, person tags are optional, and purchased items
move into **In cart**. **Arrange** offers drag handles and move-up/move-down buttons;
the selected layout is shared, while each phone chooses its own layout and view.
Tap **Finish** twice: purchases reset, unfinished items carry over, and the trip
appears in **History**. Editing the checklist and managing layouts require a
connection. Trip changes, one-time additions and existing-layout ordering can be
queued while disconnected.

The app saves pending changes in IndexedDB and retries automatically. **Needs
attention** presents competing shared and local values, or a late change from a
finished trip, for explicit review. History stays unchanged. Do not clear browser
site data while changes are pending. HTTP supports online use and disconnected
editing while the app is loaded. Reopening offline requires the shell to have been
cached in a secure context, normally trusted HTTPS; see [deployment](docs/deployment.md).

## Deployment

The app has no login. Follow the [deployment guide](docs/deployment.md) for
access controls and trusted HTTPS. Run one app replica so all connected devices
receive live updates.

The app is capped at 1 CPU/128 MiB and bundled PostgreSQL at 1 CPU/512 MiB.
See the [resource budget table](docs/deployment.md#container-resource-budgets)
for deployment requirements.
