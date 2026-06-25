#!/usr/bin/env bash
set -euo pipefail

export APP_ENV=test
export AI_PROVIDER=mock
export RETRIEVAL_PROVIDER=mock
export DATABASE_URL="sqlite+memory://phase1"
export RUN_LIVE_RETRIEVAL_TESTS=0
export RUN_POSTGRES_TESTS=0
export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8010/api/v1"

run_step() {
  printf '\n==> %s\n' "$1"
  shift
  "$@"
}

run_step "Backend tests" python -m pytest
run_step "Ruff" ruff check --no-cache
run_step "Web lint" npm run lint:web
run_step "Web typecheck" npx tsc --noEmit --project apps/web/tsconfig.json
run_step "Web build" npm run build
run_step "Recommendation eval" python services/api/evals/recommendation_eval.py --top-n 10
run_step "AI safety eval" python services/api/evals/ai_safety_eval.py

printf '\nPhase 1 local acceptance checks passed.\n'
