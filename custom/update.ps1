<#
Rebuilds the custom T3 Code on top of an official release.

  .\custom\update.ps1                 # rebase onto the latest stable release and build the installer
  .\custom\update.ps1 -Tag v0.1.7     # a specific release
  .\custom\update.ps1 -NoRebase       # rebuild the current branch as is
  .\custom\update.ps1 -Publish        # also push and publish a release the installed app updates from
  .\custom\update.ps1 -Install        # run the installer afterwards (closes T3 Code)

Exit codes: 0 done or already up to date, 2 rebase conflict (repo left mid-rebase), 1 anything else.
The custom commits live on the `custom` branch. refs/custom/base records the release they sit on.
#>
param(
  [string]$Tag,
  [switch]$NoRebase,
  [switch]$Publish,
  [switch]$Install,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$UpstreamRepo = "pingdotgg/t3code"
$CustomRepo = "santistebanc/t3code-custom"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
. "$env:APPDATA\vite-plus\env.ps1"
# Pick up tools installed since this shell started (Python for node-gyp).
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [Environment]::GetEnvironmentVariable("Path", "User") + ";" + $env:Path

function Run([string]$what, [scriptblock]$block) {
  Write-Host "==> $what" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

if ((git branch --show-current) -ne "custom") { throw "Check out the 'custom' branch first." }
if (git status --porcelain --untracked-files=no) { throw "Commit or stash your changes first." }

Run "Fetching upstream" { git fetch upstream --tags --quiet }

if (-not $Tag) {
  $Tag = gh release view -R $UpstreamRepo --json tagName -q .tagName
  if (-not $Tag) { throw "Could not find the latest release." }
}
$base = git rev-parse --verify --quiet refs/custom/base
if (-not $base) { throw "refs/custom/base is missing. Set it with: git update-ref refs/custom/base <release tag>" }

$target = git rev-parse "$Tag^{commit}"
if ($Publish -and -not $Force -and -not $NoRebase -and $target -eq $base) {
  gh release view $Tag -R $CustomRepo --json tagName 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Up to date: $Tag is already published." -ForegroundColor Green
    exit 0
  }
}

if (-not $NoRebase -and $target -ne $base) {
  Write-Host "==> Rebasing custom commits onto $Tag" -ForegroundColor Cyan
  git rebase --onto $Tag refs/custom/base custom
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Rebase stopped on a conflict. Resolve it, then:" -ForegroundColor Yellow
    Write-Host "  git add <files>; git rebase --continue"
    Write-Host "  git update-ref refs/custom/base $Tag"
    Write-Host "  .\custom\update.ps1 -NoRebase [-Publish]"
    Write-Host "To give up and go back: git rebase --abort"
    exit 2
  }
  git update-ref refs/custom/base $Tag
}

$baseTag = git describe --tags --exact-match refs/custom/base 2>$null | Select-Object -First 1
if (-not $baseTag) { throw "refs/custom/base does not point at a release tag." }
$version = $baseTag.TrimStart("v")

Run "Installing dependencies" { vp i }
Run "Typechecking web" { vp run --filter @t3tools/web typecheck }
Run "Testing custom changes" {
  Push-Location apps\web
  try { vp test run src/components/chat/threadDetailsItems.test.ts } finally { Pop-Location }
}

# Packaged Windows builds embed the same release's Linux CLI as the WSL runtime.
$wslDir = Join-Path $repo "release\wsl-runtime"
$wslArchive = Join-Path $wslDir "t3-$version-linux-x64.tar.gz"
if (-not (Test-Path $wslArchive)) {
  New-Item -ItemType Directory -Force $wslDir | Out-Null
  Run "Downloading WSL runtime for $baseTag" {
    gh release download $baseTag -R $UpstreamRepo -p "t3-$version-linux-x64.tar.gz" -D $wslDir --clobber
  }
}

# The installed app updates from this repo's releases, never from the official ones.
$env:T3CODE_DESKTOP_UPDATE_REPOSITORY = $CustomRepo
$env:T3CODE_DESKTOP_VERSION = $version
$env:T3CODE_DESKTOP_WSL_RUNTIME = $wslArchive
Remove-Item Env:GITHUB_REPOSITORY -ErrorAction SilentlyContinue
$releaseDir = Join-Path $repo "release"
Get-ChildItem $releaseDir -File -ErrorAction SilentlyContinue | Remove-Item
Run "Building the Windows installer ($version)" { vp run dist:desktop:win:x64 }

$installer = Get-ChildItem $releaseDir -Filter "*$version*x64*.exe" | Select-Object -First 1
if (-not $installer) { throw "Build finished but no installer was found in release\." }
Write-Host "Built $($installer.FullName)" -ForegroundColor Green

if ($Publish) {
  $assets = @($installer.FullName, "$($installer.FullName).blockmap", (Join-Path $releaseDir "latest.yml"))
  foreach ($asset in $assets) { if (-not (Test-Path $asset)) { throw "Missing release asset $asset" } }
  Run "Pushing the custom branch" { git push --force-with-lease origin custom }
  gh release view $baseTag -R $CustomRepo --json tagName 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Run "Removing the previous $baseTag release" { gh release delete $baseTag -R $CustomRepo --yes --cleanup-tag }
  }
  $notes = "Custom build of the official $baseTag release, with the commits on the custom branch."
  Run "Publishing release $baseTag" {
    gh release create $baseTag -R $CustomRepo --target (git rev-parse custom) --title "T3 Code Custom $version" --notes $notes @assets
  }
}

if ($Install) { Start-Process $installer.FullName }
