$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $repoRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$ArgumentList = @()
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
}

function Get-PackageJson {
    return Get-Content -Raw -LiteralPath "package.json" | ConvertFrom-Json
}

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
    throw "Cannot release from a detached HEAD."
}

$origin = (& git remote get-url origin 2>$null).Trim()
if (-not $origin) {
    throw "No git remote named 'origin' is configured."
}

$dirty = (& git status --porcelain)
if ($dirty) {
    Write-Host "Working tree is not clean:"
    $dirty | ForEach-Object { Write-Host $_ }
    throw "Commit or stash changes before running release:patch."
}

$before = Get-PackageJson
$packageName = [string]$before.name
$oldVersion = [string]$before.version

Write-Host "Release target: $packageName $oldVersion -> patch bump"
Write-Host "Push target: $origin ($branch)"

Invoke-Checked "npm" @("version", "patch", "--no-git-tag-version")

$after = Get-PackageJson
$newVersion = [string]$after.version
if ($newVersion -eq $oldVersion) {
    throw "npm version did not change package.json version."
}

$readmePath = "README.md"
if (Test-Path -LiteralPath $readmePath) {
    $readme = Get-Content -Raw -LiteralPath $readmePath
    $pattern = [regex]::Escape($packageName) + "-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.vsix"
    $replacement = "$packageName-$newVersion.vsix"
    $updated = [regex]::Replace($readme, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
    if ($updated -ne $readme) {
        Set-Content -LiteralPath $readmePath -Value $updated -NoNewline
    }
}

$changelogPath = "CHANGELOG.md"
if (Test-Path -LiteralPath $changelogPath) {
    $changelog = Get-Content -Raw -LiteralPath $changelogPath
    $updated = [regex]::Replace($changelog, "(?m)^## Unreleased\s*$", "## $newVersion", 1)
    if ($updated -ne $changelog) {
        Set-Content -LiteralPath $changelogPath -Value $updated -NoNewline
    } else {
        Write-Host "CHANGELOG.md has no '## Unreleased' section to finalize."
    }
}

Invoke-Checked "npm" @("test")
Invoke-Checked "npm" @("run", "package")
Invoke-Checked "npm" @("audit")
Invoke-Checked "git" @("diff", "--check")

$filesToStage = @("package.json", "package-lock.json", "README.md")
if (Test-Path -LiteralPath $changelogPath) {
    $filesToStage += $changelogPath
}
Invoke-Checked "git" @("add", $filesToStage)
$staged = (& git diff --cached --name-only)
if (-not $staged) {
    throw "No version bump changes were staged."
}

Invoke-Checked "git" @("commit", "-m", "Bump version to $newVersion")
Invoke-Checked "git" @("push", "-u", "origin", $branch)

Write-Host "Released $packageName $newVersion to $origin ($branch)."
