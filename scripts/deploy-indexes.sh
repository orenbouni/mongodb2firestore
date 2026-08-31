#!/usr/bin/env bash
# Applies firestore.indexes.json to a Firestore database via gcloud.
#
# The Firebase CLI can do this in one shot, but it expects a Firebase project
# config; gcloud works against a bare Cloud project, so we drive it per index.
# Index builds are asynchronous - the script starts them all and returns.
set -euo pipefail

ENV_FILE="$(dirname "$0")/../backend/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

PROJECT="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
DATABASE="${FIRESTORE_DATABASE_ID:-aegis-legends}"
SPEC="$(dirname "$0")/../firestore.indexes.json"

if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "Set GCP_PROJECT_ID or run: gcloud config set project <project-id>" >&2
  exit 1
fi

command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

echo "Applying $(jq '.indexes | length' "$SPEC") composite indexes"
echo "  project : $PROJECT"
echo "  database: $DATABASE"
echo

jq -r '
  .indexes[]
  | .collectionGroup as $cg
  | [ .fields[]
      | if .arrayConfig then "field-path=\(.fieldPath),array-config=\(.arrayConfig)"
        else "field-path=\(.fieldPath),order=\(.order)" end
    ] as $cfg
  | "\($cg)\t\($cfg | join("\t"))"
' "$SPEC" | while IFS=$'\t' read -r collection_group rest; do
  args=()
  while IFS=$'\t' read -r cfg; do
    [ -n "$cfg" ] && args+=(--field-config="$cfg")
  done < <(printf '%s\n' "$rest" | tr '\t' '\n')

  echo "-> $collection_group  (${#args[@]} fields)"
  gcloud firestore indexes composite create \
    --project="$PROJECT" \
    --database="$DATABASE" \
    --collection-group="$collection_group" \
    --query-scope=COLLECTION \
    "${args[@]}" \
    --async 2>&1 | sed 's/^/   /' || echo "   (already exists or failed - continuing)"
done

echo
echo "All index builds submitted. Track progress with:"
echo "  gcloud firestore indexes composite list --project=$PROJECT --database=$DATABASE"
