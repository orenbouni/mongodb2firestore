# Aegis Legends: Galactic Arena

A high-concurrency multiplayer-gaming workload running against **Google Cloud Firestore**
and **MongoDB on a Compute Engine VM**, with a live switch between the two so you can watch
the same game do the same work on either engine.

The dashboard drives real inserts, reads, updates and deletes, so activity shows up in the
Firestore console and in MongoDB's own metrics rather than being simulated client-side.

> **Placeholders.** This README uses `your-project-id`, `mongo-demo-vm`, `10.0.0.10` and
> `203.0.113.10` as stand-ins. Put your real values in `backend/.env`, which is gitignored.

---

## What is actually running

| | Firestore | MongoDB |
|---|---|---|
| Target | `projects/<project-id>/databases/aegis-legends` (Native) | `mongo-demo-vm`, Compute Engine |
| Auth | ADC → `roles/datastore.user` | Cloud IAM via IAP TCP tunnel |
| Reachability | `firestore.googleapis.com:443` | `localhost:27018` → tunnel → `<vm-ip>:27017` |
| Realtime | `onSnapshot` listeners (server push) | polling (see [Realtime](#realtime-is-not-symmetric)) |
| Transactions | multi-document `runTransaction` | single-document atomic ops (see [Transactions](#transactions-are-not-symmetric-either)) |

Both sit behind one `DataAdapter` interface, so every API route is written once and the
source switch is a parameter, not a second code path.

---

## Quick start

```bash
cd backend
cp .env.example .env       # fill in your project id, VM name and zone
```

Then one command from the repo root:

```bash
./start.sh
```

It opens the IAP tunnel, starts the API and the dashboard, and pings both engines
before handing back control — so a broken credential or an unreachable VM shows up
as a failed check rather than an empty panel. Ctrl-C stops all three.

```
  --no-tunnel    skip the tunnel (Firestore only, or one is already running)
  --seed         reseed both sources first
```

Or run the three pieces by hand, in three terminals:

```bash
# 1 - IAP tunnel to the MongoDB VM (leave running)
./scripts/mongo-tunnel.sh

# 2 - API
cd backend
npm install
npm run seed -- --source firestore --clear --players 200 --lobbies 20 --matches 120
npm run seed -- --source mongo     --clear --players 200 --lobbies 20 --matches 120
npm run dev

# 3 - Dashboard
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The header carries the **Firestore / MongoDB switch**. The panel below it shows which engine
you are on, its connection string, resolved host and IP addresses, credential type, and
whether the live feed is server-push or polled.

---

## Generating database activity

The **Simulation & control** panel runs a continuous mixed workload against whichever source
is selected. This is the part to watch if you want traffic visible in the cloud console.

**Four operation kinds**, each a real round trip:

| Op | What it does |
|---|---|
| **Insert** | `BulkWriter` / `bulkWrite` batches of players (+ inventory), lobbies or matches |
| **Read** | rotates through point reads + sub-collection fetch, region-scoped range queries, and `count()` aggregations |
| **Update** | samples random players and writes MMR drift, rank re-evaluation, a credit payout and a session timestamp |
| **Delete** | removes the oldest matches, then completed lobbies |

Deletes deliberately never touch player documents — a long mixed run would otherwise erode
the dataset that the read and update paths depend on.

**Controls:** record type, total amount, time frame, operation interval (1 ms → 60 s), and
an **operation mix** with weights per op. Presets cover balanced, read-heavy, write-heavy and
churn profiles. The server previews the plan — ticks, ops per tick, expected op totals and
estimated documents — before you commit.

Each run reports per-operation counters, documents touched per operation, and a rolling
activity log with per-batch latency. Four one-shot buttons fire a single burst of each kind.

### Rare operations actually run

Allocating a tick's slots by rounding each weight independently starves rare operations: at
4 slots per tick, a 5 % delete weight wants 0.2 of a slot, floors to zero, and never fires.
The scheduler therefore carries fractional credit **across** ticks, so 0.2 per tick
accumulates and triggers a delete roughly every fifth tick. A 5 % weight means 5 % of
operations, not "zero because it rounded down".

---

## The data model

```
players/{playerId}                     username, region, level, rankTier, mmr,
  └── inventory/{itemId}               stats{}, currency{}, createdAt, lastLoginAt
lobbies/{lobbyId}                      gameMode, status, maxPlayers, playerList[]
matches/{matchId}                      lobbyId, durationSeconds, winningTeam, scoreboard[]
```

MongoDB has no sub-collections, so `inventory` is a top-level collection keyed
`{playerId}:{itemId}` with a compound index on `(playerId, powerRating)`. The adapter hides
the difference; the API returns identical shapes from both.

Two fields exist to make queries possible rather than to model the game:

- **`usernameLower`** — Firestore has no `LIKE`, so prefix search is a range scan
  (`>= term`, `< term + `) over a lowercased copy.
- **`participantIds`** — you cannot query inside an array of maps, so the scoreboard's
  player IDs are denormalised into a flat array for `array-contains`.

Random document selection differs too: MongoDB has `$sample`, Firestore has no equivalent,
so the workload seeks to a randomly generated key and takes the next document by name.

---

## Firestore capabilities on display

**Atomic transactions.** The marketplace purchase reads the wallet, verifies the balance,
debits credits and plasma cores, and writes the inventory document as one unit. Buy the Void
Reaper (24 000 cr) with a poor player — the rejection is a real transaction abort, and the
panel reports the before/after balance and the latency.

**Aggregations.** The KPI row and region chart are `count()`, `average()` and `sum()`
aggregation queries, not client-side reductions over fetched documents.

`average('mmr')` and `sum('currency.credits')` are issued as **two** aggregation queries
rather than one. Combining them would require a dedicated `(currency.credits, mmr)`
composite index to serve a statistic nothing else queries — the extra round trip is cheaper
than the index.

**Cursor pagination.** Player search and match history use `startAfter` + `limit` with an
opaque base64 cursor. There is no `offset` anywhere; deep pages cost the same as shallow ones.

**Snapshot listeners.** The lobby browser and leaderboard are driven by `onSnapshot`,
relayed to the browser over a single SSE connection per source.

### A note on `__name__` and composite indexes

Keyset pagination needs a stable tiebreaker, so queries order by `mmr desc, __name__ desc`.
The direction matters: Firestore auto-indexes a single field with `__name__` in the *same*
direction, so `__name__ asc` after `mmr desc` demands a composite index for **every** filter
combination. Sorting both descending keeps unfiltered queries index-free and holds the index
count down. `firestore.indexes.json` reflects this.

Apply the indexes with:

```bash
./scripts/deploy-indexes.sh          # uses gcloud; jq required
```

---

## Where the two engines genuinely differ

The demo does not pretend the engines are interchangeable.

### Realtime is not symmetric

Firestore pushes changes over gRPC. MongoDB change streams require a replica set, and a
single standalone `mongod` has none — so the Mongo adapter polls every 1.5 s and emits only
when the payload changed. The connection panel names the mechanism in use rather than
implying both are push. Point `MONGODB_URI` at a replica set instead and the adapter
detects it via the `hello` command and the panel updates.

### Transactions are not symmetric either

The same standalone limitation rules out multi-document transactions. Rather than pretending,
the Mongo purchase path puts every precondition **in the update filter**:

```js
findOneAndUpdate(
  { _id: playerId,
    'currency.credits':     { $gte: price },
    'currency.plasmaCores': { $gte: cores } },
  { $inc: { 'currency.credits': -price, 'currency.plasmaCores': -cores } },
)
```

That debit is genuinely atomic — concurrent buyers cannot overdraw, because the balance check
and the decrement are one document-level operation. The following inventory insert is
compensated (refunded) if it fails. Against a replica set the adapter uses a real
multi-document transaction instead. Lobby joins use the same technique: the capacity check
lives in the filter, so a full lobby cannot be oversubscribed.

---

## Seeder

```bash
npm run seed -- --help

  --players <n>                 default 100
  --inventory-per-player <n>    default 5
  --lobbies <n>                 default 10
  --matches <n>                 default 50
  --batch-size <n>              default 500 (Firestore's commit ceiling)
  --source <firestore|mongo>    default firestore
  --clear                       wipe target collections first
```

Usernames, item names and stat distributions are generated rather than sampled — MMR is drawn
from a clamped Gaussian, rarity is weighted so Legendaries stay rare, and level correlates
with MMR so the data reads as plausible progression.

---

## Setting up MongoDB access

A stock Compute Engine MongoDB install binds `127.0.0.1`, so nothing off the box can reach it.
Two changes:

1. `/etc/mongod.conf` → `bindIp: 0.0.0.0`, keeping a backup, then `systemctl restart mongod`.
2. Connect through an **IAP TCP tunnel** instead of a public IP.

```bash
gcloud compute ssh <vm-name> --zone=<zone> --tunnel-through-iap --command="
  sudo cp -n /etc/mongod.conf /etc/mongod.conf.bak.orig
  sudo sed -i 's/^\(\s*\)bindIp:.*/\1bindIp: 0.0.0.0/' /etc/mongod.conf
  sudo systemctl restart mongod"
```

This only stays safe if the VM's VPC restricts ingress to the IAP range
`35.235.240.0/20`. Under that rule, binding all interfaces does **not** expose MongoDB to the
internet — port 27017 is unreachable from the external IP, and Cloud IAM authenticates every
connection before it reaches the database. Verify before relying on it:

```bash
gcloud compute firewall-rules list \
  --filter="network=<vpc-name> AND direction=INGRESS" \
  --format="table(name,sourceRanges.list(),allowed[].map().firewall_rule().list())"
```

If `27017` is reachable from a wider range, **enable MongoDB authentication first** — the
setup above assumes IAM is the only thing gating the network path.

To revert:

```bash
gcloud compute ssh <vm-name> --zone=<zone> --tunnel-through-iap \
  --command="sudo cp /etc/mongod.conf.bak.orig /etc/mongod.conf && sudo systemctl restart mongod"
```

---

## Running against a local Firestore

The demo targets real Firestore and the real VM, which is the point of it — the numbers in the
console are the ones you are watching. If you need an offline Firestore anyway, the emulator is
still supported — point the client at it directly:

```bash
gcloud emulators firestore start --host-port=localhost:8200 --database-mode=firestore-native

cd backend
FIRESTORE_EMULATOR_HOST=localhost:8200 npm run seed -- --players 200
FIRESTORE_EMULATOR_HOST=localhost:8200 ./start.sh --no-tunnel
```

Pick a port other than 8080 for the emulator — that is the API's default. When
`FIRESTORE_EMULATOR_HOST` is set the client skips credential resolution entirely, and the
connection panel says so.

---

## API

Every route takes `?source=firestore|mongo` (or an `x-data-source` header).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/system/sources` | both engines' status, connection info, host addresses |
| `GET` | `/api/system/aggregates` | `count()` / `average()` / `sum()` metrics |
| `GET` | `/api/stream` | SSE: lobbies, leaderboard, aggregates, workload progress |
| `GET` | `/api/players` | cursor-paginated, filter by region / tier / username prefix |
| `GET` | `/api/players/:id` | profile + inventory + computed loadout |
| `POST` | `/api/players/:id/purchase` | **atomic** marketplace purchase |
| `POST` | `/api/players/:id/inventory/:itemId/equip` | equip/unequip, one item per slot |
| `GET` | `/api/leaderboard` | mmr desc, winRate desc; region / tier filters |
| `GET` | `/api/lobbies` | active match sessions |
| `POST` | `/api/lobbies/:id/join` | transactional join with capacity check |
| `POST` | `/api/lobbies/:id/complete` | close lobby, write match, apply MMR deltas |
| `GET` | `/api/matches` | cursor-paginated history, optional `playerId` |
| `POST` | `/api/simulation/plan` | preview ticks, op totals and document estimate |
| `POST` | `/api/simulation/start` | begin a mixed-workload run |
| `POST` | `/api/admin/workload/:op` | one-shot `read` \| `update` \| `delete` burst |
| `POST` | `/api/admin/bulk-insert` | one-shot insert burst |
| `POST` | `/api/admin/clear` | wipe the selected source |

---

## Security rules

`firestore.rules` targets the case that needs it — a game client reading Firestore directly
with the Web SDK for `onSnapshot`. The backend uses the Admin SDK and bypasses rules entirely.

The rule encoded there: a client may read what the game displays and write nothing that
carries value. Currency, MMR, match results and lobby membership are server-authoritative; a
client that could write them could mint credits or fake a win. Players may edit their own
`username` / `lastLoginAt` and toggle `isEquipped` on items they own. Everything else is denied.

---

## Layout

```
backend/src/
  config/       firestore.ts (ADC resolution), mongo.ts, env.ts
  adapters/     firestoreAdapter.ts, mongoAdapter.ts, registry.ts
  domain/       types.ts (the DataAdapter contract), generator.ts, catalog.ts
  services/     playerService, leaderboardService, matchService, simulationService
  routes/       system, players, leaderboard, matches, simulation, stream
  scripts/      seed.ts
frontend/src/
  components/   SourceSwitch, LobbyBrowser, LeaderboardTable, PlayerInspector,
                ControlPanel, charts, primitives
  hooks/        useLiveStream.ts (SSE)
  services/     api.ts
firestore.rules · firestore.indexes.json
start.sh        one command: tunnel + API + dashboard, both sources verified
scripts/        deploy-indexes.sh · mongo-tunnel.sh
```

### Dashboard colour

Charts use a palette validated for colour-vision deficiency against the dark surface. The two
source hues (blue `#3987e5` / aqua `#199e70`) clear a worst-adjacent CVD ΔE of 69.8 at ≥3:1
contrast; the four operation hues clear ΔE 35.9. Rank-tier badges use a single-hue ordinal
ramp with monotone lightness rather than six unrelated colours. Operation names and rank names
are always rendered next to their swatch, so nothing rests on colour alone.
