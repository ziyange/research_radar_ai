$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [string] $Name,
        [scriptblock] $Command
    )

    Write-Host ""
    Write-Host "==> $Name"
    & $Command
}

$env:APP_ENV = "test"
$env:AI_PROVIDER = "mock"
$env:RETRIEVAL_PROVIDER = "mock"
$env:DATABASE_URL = "sqlite+memory://phase1"
$env:RUN_LIVE_RETRIEVAL_TESTS = "0"
$env:RUN_POSTGRES_TESTS = "0"
$env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:8010/api/v1"

Invoke-Step "Backend tests" { python -m pytest }
Invoke-Step "Ruff" { ruff check --no-cache }
Invoke-Step "Web lint" { npm run lint:web }
Invoke-Step "Web typecheck" { npx tsc --noEmit --project apps/web/tsconfig.json }
Invoke-Step "Web build" { npm run build }
Invoke-Step "Recommendation eval" { python services/api/evals/recommendation_eval.py --top-n 10 }
Invoke-Step "AI safety eval" { python services/api/evals/ai_safety_eval.py }

Write-Host ""
Write-Host "Phase 1 local acceptance checks passed."
