#!/usr/bin/env bash
# Deploys the SHOTDIS frontend to Vercel production.
# Requires the project to be linked (`vercel link`) and VITE_SERVER_URL set in Vercel env.
set -euo pipefail
vercel deploy --prod --yes
