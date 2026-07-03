param(
    [string]$StorageRoot = "storage/literature",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$root = (Resolve-Path (Join-Path $workspace $StorageRoot)).Path

if (-not $root.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean outside workspace: $root"
}

function Remove-MatchingJson {
    param(
        [string]$Directory,
        [scriptblock]$Predicate
    )

    if (-not (Test-Path $Directory)) {
        return
    }

    Get-ChildItem -LiteralPath $Directory -Filter "*.json" | ForEach-Object {
        $payload = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
        if (& $Predicate $payload $_.Name) {
            if ($DryRun) {
                Write-Output "Would remove $($_.FullName)"
            } else {
                Remove-Item -LiteralPath $_.FullName -Force
                Write-Output "Removed $($_.FullName)"
            }
        }
    }
}

$entities = Join-Path $root "entities"

Remove-MatchingJson (Join-Path $entities "literature_tasks") {
    param($item, $name)
    $recipients = @($item.recipientEmails) | ForEach-Object { "$_".ToLowerInvariant() }
    $fixedIds = @("task_digest_push.json", "task_digest_empty_result.json", "task_legacy_missing_recipient.json")
    return $fixedIds -contains $name -or (
        "$($item.query)".Trim().ToLowerInvariant() -eq "nanomaterials plant" -and
        $recipients -contains "recipient@example.com" -and
        [int]($item.count ?? 0) -eq 3 -and
        [double]($item.minScore ?? 0) -eq 50
    )
}

Remove-MatchingJson (Join-Path $entities "literature_scan_runs") {
    param($item, $name)
    $taskId = "$($item.taskId)"
    return $name -in @("scan_task_digest.json", "scan_empty_digest.json", "scan_legacy_missing_recipient.json") -or
        $taskId.StartsWith("task_digest_") -or
        $taskId -eq "task_legacy_missing_recipient"
}

Remove-MatchingJson (Join-Path $entities "literature_papers") {
    param($item, $name)
    $title = "$($item.title)".Trim().ToLowerInvariant()
    return $name.StartsWith("paper_test_") -or
        $title.StartsWith("full text acceptance paper") -or
        $title.StartsWith("crossref fallback")
}

Remove-MatchingJson (Join-Path $entities "literature_reports") {
    param($item, $name)
    return $name.StartsWith("report_test_")
}

Remove-MatchingJson (Join-Path $entities "literature_mail_deliveries") {
    param($item, $name)
    $taskId = "$($item.taskId)"
    return "$($item.kind)" -eq "mail_test" -or
        $name.StartsWith("mail_test_") -or
        $taskId.StartsWith("task_digest_") -or
        $taskId -eq "task_legacy_missing_recipient"
}
