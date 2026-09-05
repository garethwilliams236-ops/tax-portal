#!/usr/bin/env bash
# Same pattern as the CRM: source this before `npm run dev`.
#   source scripts/load-env.sh
set -a
if [ -f .env.local ]; then
  . ./.env.local
  echo "loaded .env.local"
else
  echo "no .env.local — copy .env.example and fill it in" >&2
fi
set +a
