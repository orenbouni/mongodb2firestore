#!/usr/bin/env bash
# Starts the whole demo and verifies both data sources answer before handing
# back control:
#
#   IAP tunnel  -> mongo-db-demo:27017 via localhost:27018
#   API         -> localhost:8080   (Firestore over ADC + MongoDB over the tunnel)
#   Dashboard   -> localhost:5173
#
# Everything runs in the foreground of this script; Ctrl-C stops all three.
# Logs stream to .run/*.log.
#
#   ./start.sh                 full stack
#   ./start.sh --no-tunnel     skip the tunnel (Firestore only, or tunnel already up)
#   ./start.sh --seed          reseed both sources before starting
#
# Not to be confused with run.sh, which is a personal Claude Code launcher and
# has nothing to do with this app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/.run"
mkdir -p "$LOG_DIR"

WITH_TUNNEL=1
DO_SEED=0
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) WITH_TUNNEL=0 ;;
    --seed)      DO_SEED=1 ;;
    -h|--help)   sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# .env carries the project id, VM name/zone and ports. It is gitignored, so a
# fresh clone has to create it from .env.example first.
ENV_FILE="$ROOT/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "!! backend/.env is missing. Create it first:" >&2
  echo "     cp backend/.env.example backend/.env   # then fill in project id, VM name, zone" >&2
  exit 1
fi
set -a; . "$ENV_FILE"; set +a

API_PORT="${PORT:-8080}"
WEB_PORT="${VITE_PORT:-5173}"
MONGO_PORT="${MONGO_LOCAL_PORT:-27018}"
API="http://localhost:${API_PORT}"

c_ok=$'\033[32m'; c_bad=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$c_bad" "$c_off" "$*"; }
dim()  { printf '  %s%s%s\n' "$c_dim" "$*" "$c_off"; }

GROUPS_STARTED=()
PIDS=()
# Only ports this process actually bound. Never widen this to "the ports the app
# uses" - a second instance that bails because a port is taken would then kill
# the first instance on its way out.
OWNED_PORTS=()
SPAWN_LOG="$LOG_DIR/spawn.log"

# Each service is a tree - npm -> tsx -> node. npm does not forward signals, and
# killing only the listener leaves `tsx watch` orphaned, ready to respawn the
# server on the next file change. setsid puts each service in its own process
# group so one signal takes the whole tree down. With setsid the child's PID is
# its PGID, hence `kill -PID`.
spawn() { # spawn <dir> <cmd...>
  local dir=$1; shift
  setsid bash -c 'cd "$1" && shift && exec "$@"' _ "$dir" "$@" >>"$SPAWN_LOG" 2>&1 &
  local pid=$!
  GROUPS_STARTED+=("$pid")
  echo "$pid"
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  echo
  say "Shutting down..."
  for g in "${GROUPS_STARTED[@]:-}"; do
    [ -n "$g" ] && kill -TERM -- "-$g" 2>/dev/null || true
  done
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  sleep 1
  # Belt and braces: anything still holding a port, and any group that ignored
  # SIGTERM, gets SIGKILL.
  for g in "${GROUPS_STARTED[@]:-}"; do
    [ -n "$g" ] && kill -KILL -- "-$g" 2>/dev/null || true
  done
  for port in "${OWNED_PORTS[@]:-}"; do
    [ -n "$port" ] || continue
    lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  done
  ok "stopped"
  exit $code
}
trap cleanup EXIT INT TERM

port_busy() { lsof -ti:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Poll rather than sleep - Vite and tsx take an unpredictable moment to bind.
wait_for() { # wait_for <label> <seconds> <command...>
  local label=$1 limit=$2; shift 2
  local i=0
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$limit" ]; then bad "$label did not come up in ${limit}s"; return 1; fi
    sleep 1
  done
  ok "$label"
}

tcp_open() { timeout 2 bash -c "</dev/tcp/127.0.0.1/$1" 2>/dev/null; }

say ""
say "Aegis Legends - starting up"
say "==========================="

# ---- preflight -------------------------------------------------------------
say ""
say "Preflight"
for bin in node npm curl lsof; do
  command -v "$bin" >/dev/null || { bad "$bin not found on PATH"; exit 1; }
done
ok "node $(node --version)"

if [ "$WITH_TUNNEL" = 1 ]; then
  command -v gcloud >/dev/null || { bad "gcloud not found - needed for the IAP tunnel (use --no-tunnel to skip)"; exit 1; }
  # The backend reaches Firestore with Application Default Credentials, and the
  # tunnel needs an authenticated gcloud user. Both fail late and cryptically if
  # absent, so check up front.
  if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    bad "no Application Default Credentials"
    dim "run: gcloud auth application-default login"
    exit 1
  fi
  ok "gcloud ADC present"
fi

for dir in backend frontend; do
  if [ ! -d "$ROOT/$dir/node_modules" ]; then
    dim "installing $dir dependencies..."
    (cd "$ROOT/$dir" && npm install --silent)
  fi
done
ok "dependencies present"

# ---- 1. IAP tunnel to the MongoDB VM ---------------------------------------
if [ "$WITH_TUNNEL" = 1 ]; then
  say ""
  say "MongoDB tunnel"
  if port_busy "$MONGO_PORT"; then
    ok "port $MONGO_PORT already open - reusing existing tunnel"
    # Started by someone else, so leave it running when we exit.
  else
    OWNED_PORTS+=("$MONGO_PORT")
    SPAWN_LOG="$LOG_DIR/iap-tunnel.log"; : > "$SPAWN_LOG"
    spawn "$ROOT" "$ROOT/scripts/mongo-tunnel.sh" >/dev/null
    dim "$MONGO_VM:27017 -> localhost:$MONGO_PORT  ($LOG_DIR/iap-tunnel.log)"
    if ! wait_for "tunnel listening on $MONGO_PORT" 60 tcp_open "$MONGO_PORT"; then
      tail -15 "$LOG_DIR/iap-tunnel.log" >&2; exit 1
    fi
  fi
fi

# ---- 2. optional reseed ----------------------------------------------------
if [ "$DO_SEED" = 1 ]; then
  say ""
  say "Seeding"
  for src in firestore mongo; do
    dim "seeding $src..."
    (cd "$ROOT/backend" && npm run seed -- --source "$src" --clear \
        --players 200 --lobbies 20 --matches 120 >"$LOG_DIR/seed-$src.log" 2>&1) \
      && ok "$src seeded" || { bad "$src seed failed"; tail -15 "$LOG_DIR/seed-$src.log" >&2; exit 1; }
  done
fi

# ---- 3. API ----------------------------------------------------------------
say ""
say "API"
if port_busy "$API_PORT"; then bad "port $API_PORT is already in use"; exit 1; fi
OWNED_PORTS+=("$API_PORT")
SPAWN_LOG="$LOG_DIR/backend.log"; : > "$SPAWN_LOG"
spawn "$ROOT/backend" npm run dev >/dev/null
dim "$LOG_DIR/backend.log"
if ! wait_for "API on $API" 60 curl -sf "$API/api/system/sources"; then
  tail -20 "$LOG_DIR/backend.log" >&2; exit 1
fi

# ---- 4. verify both sources actually answer --------------------------------
# An API that boots proves nothing about reachability: Firestore creds and the
# Mongo tunnel are resolved lazily. /api/system/sources pings both.
say ""
say "Data sources"
SOURCES_JSON="$(curl -s "$API/api/system/sources")"
SOURCE_REPORT="$(printf '%s' "$SOURCES_JSON" | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d)).on("end", () => {
    let bad = 0;
    for (const s of JSON.parse(raw).sources ?? []) {
      const live = s.available && s.ping?.ok;
      if (!live) bad++;
      const detail = live ? `${s.ping.latencyMs}ms` : (s.ping?.error ?? "unreachable");
      console.log(`${live ? "OK" : "FAIL"}\t${s.info?.displayName ?? s.kind}\t${detail}`);
    }
    process.exitCode = bad ? 1 : 0;
  });
')" && SOURCES_OK=1 || SOURCES_OK=0

while IFS=$'\t' read -r status name detail; do
  [ -z "${status:-}" ] && continue
  if [ "$status" = OK ]; then ok "$name  ${c_dim}${detail}${c_off}"; else bad "$name  $detail"; fi
done <<< "$SOURCE_REPORT"

if [ "$SOURCES_OK" != 1 ]; then
  bad "not every source is reachable - the dashboard will load but one engine will error"
  dim "Firestore needs ADC + roles/datastore.user; MongoDB needs the IAP tunnel on $MONGO_PORT"
fi

# ---- 5. dashboard ----------------------------------------------------------
say ""
say "Dashboard"
if port_busy "$WEB_PORT"; then bad "port $WEB_PORT is already in use"; exit 1; fi
OWNED_PORTS+=("$WEB_PORT")
SPAWN_LOG="$LOG_DIR/frontend.log"; : > "$SPAWN_LOG"
spawn "$ROOT/frontend" npm run dev >/dev/null
dim "$LOG_DIR/frontend.log"
if ! wait_for "dashboard on http://localhost:$WEB_PORT" 60 curl -sf "http://localhost:$WEB_PORT"; then
  tail -20 "$LOG_DIR/frontend.log" >&2; exit 1
fi

say ""
say "==========================="
say "  Dashboard  http://localhost:$WEB_PORT"
say "  API        $API"
say "==========================="
say ""
dim "Ctrl-C to stop everything. Streaming backend log:"
say ""

# Hand the terminal to the backend log and keep the children alive.
tail -f "$LOG_DIR/backend.log" &
PIDS+=($!)
wait
