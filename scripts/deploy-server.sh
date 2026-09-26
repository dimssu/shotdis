#!/usr/bin/env bash
# Deploys the SHOTDIS game server to Google Cloud Run from source (Dockerfile).
# Usage: scripts/deploy-server.sh [project] [region] [allowed-origins]
set -euo pipefail
PROJECT="${1:-${GCP_PROJECT:-gen-lang-client-0165222175}}"
REGION="${2:-${GCP_REGION:-asia-south1}}"
ORIGINS="${3:-${ALLOWED_ORIGINS:-https://shotdis.vercel.app}}"
SERVICE="shotdis-server"

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8787 \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 250 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 3600 \
  --set-env-vars "ROOM_SIZE=8,BOT_FILL=4,ALLOWED_ORIGINS=${ORIGINS}" \
  --quiet

gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)'
