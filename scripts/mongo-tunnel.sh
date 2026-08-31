#!/usr/bin/env bash
# Opens an IAP TCP tunnel to the MongoDB VM.
#
# The VM should sit on a VPC whose only ingress rule allows the IAP range
# (35.235.240.0/20). MongoDB is then unreachable from the internet even with
# mongod bound to 0.0.0.0, because Cloud IAM authenticates every connection
# before a packet reaches port 27017.
#
# Configure via environment or a .env file; nothing here hardcodes a real host.
#   GCP_PROJECT_ID    project containing the VM
#   MONGO_VM          instance name
#   MONGO_ZONE        instance zone
#   MONGO_LOCAL_PORT  local end of the tunnel (default 27018)
#
# Leave this running in its own terminal; the backend connects to the local end.
set -euo pipefail

ENV_FILE="$(dirname "$0")/../backend/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

PROJECT="${GCP_PROJECT_ID:-}"
INSTANCE="${MONGO_VM:-}"
ZONE="${MONGO_ZONE:-}"
LOCAL_PORT="${MONGO_LOCAL_PORT:-27018}"

if [ -z "$PROJECT" ] || [ -z "$INSTANCE" ] || [ -z "$ZONE" ]; then
  cat >&2 <<'USAGE'
Missing configuration. Set these first, e.g.:

  export GCP_PROJECT_ID=your-project-id
  export MONGO_VM=mongo-demo-vm
  export MONGO_ZONE=us-central1-a

  ./scripts/mongo-tunnel.sh

Or add MONGO_VM / MONGO_ZONE to backend/.env (which is gitignored).
USAGE
  exit 1
fi

echo "IAP tunnel  localhost:${LOCAL_PORT}  ->  ${INSTANCE}:27017  (${ZONE})"
echo "Connection string: mongodb://127.0.0.1:${LOCAL_PORT}/?directConnection=true"
echo

exec gcloud compute start-iap-tunnel "$INSTANCE" 27017 \
  --local-host-port="localhost:${LOCAL_PORT}" \
  --zone="$ZONE" \
  --project="$PROJECT"
