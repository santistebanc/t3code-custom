<#
Rebuilds the custom T3 Code on top of an official release.

  .\custom\update.ps1                 # rebase onto the latest stable release, build, offer to install
  .\custom\update.ps1 -Tag v0.1.7     # a specific release
  .\custom\update.ps1 -NoRebase       # rebuild the current branch as is
  .\custom\update.ps1 -Install        # install without asking (closes T3 Code)

The custom commits live on the `custom` branch. refs/custom/base records the release they sit on.
#>
param(
  [string]$Tag,
  [switch]$NoRebase,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
. "$env:APPDATA\vite-plus\env.ps1"

function Run([string]$what, [scriptblock]$block) {
  Write-Host "==> $what" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

if ((git branch --show-current) -ne "custom") { throw "Check out the 'custom' branch first." }
if (git status --porcelain --untracked-files=no) { throw "Commit or stash your changes first." }

Run "Fetching upstream" { git fetch upstream --tags --quiet }

if (-not $Tag) {
  $Tag = gh release view -R pingdotgg/t3code --json tagName -q .tagName
  if (-not $Tag) { throw "Could not find the latest release." }
}
$base = git rev-parse --verify --quiet refs/custom/base
if (-not $base) { throw "refs/custom/base is missing. Set it with: git update-ref refs/custom/base <release tag>" }

if (-not $NoRebase) {
  $target = git rev-parse "$Tag^{commit}"
  if ($target -eq $base) {
    Write-Host "Already on $Tag." -ForegroundColor Green
  } else {
    Write-Host "==> Rebasing custom commits onto $Tag" -ForegroundColor Cyan
    git rebase --onto $Tag refs/custom/base custom
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "Rebase stopped on a conflict. Resolve it (or ask an agent to), then:" -ForegroundColor Yellow
      Write-Host "  git add <files>; git rebase --continue"
      Write-Host "  git update-ref refs/custom/base $Tag"
      Write-Host "  .\custom\update.ps1 -NoRebase"
      Write-Host "To give up and go back: git rebase --abort"
      exit 1
    }
    git update-ref refs/custom/base $Tag
  }
}

$baseTag = git describe --tags --exact-match refs/custom/base 2>$null | Select-Object -First 1
if (-not $baseTag) { $baseTag = $Tag }
$version = $baseTag.TrimStart("v")

Run "Installing dependencies" { vp i }

# Packaged Windows builds embed the same release's Linux CLI as the WSL runtime.
$wslDir = Join-Path $repo "release\wsl-runtime"
$wslArchive = Join-Path $wslDir "t3-$version-linux-x64.tar.gz"
if (-not (Test-Path $wslArchive)) {
  New-Item -ItemType Directory -Force $wslDir | Out-Null
  Run "Downloading WSL runtime for $baseTag" {
    gh release download $baseTag -R pingdotgg/t3code -p "t3-$version-linux-x64.tar.gz" -D $wslDir --clobber
  }
}

# No update repository is set, so the build has no update feed and never auto-updates to the official app.
Remove-Item Env:T3CODE_DESKTOP_UPDATE_REPOSITORY, Env:GITHUB_REPOSITORY -ErrorAction SilentlyContinue
$env:T3CODE_DESKTOP_VERSION = $version
$env:T3CODE_DESKTOP_WSL_RUNTIME = $wslArchive
Run "Building the Windows installer ($version)" { vp run dist:desktop:win:x64 }

$installer = Get-ChildItem (Join-Path $repo "release") -Filter "*$version*x64*.exe" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "Build finished but no installer was found in release\." }
Write-Host "Built $($installer.FullName)" -ForegroundColor Green

if (-not $Install) {
  $answer = Read-Host "Install now? This closes T3 Code. [y/N]"
  if ($answer -notmatch "^(y|yes)$") { exit 0 }
}
Start-Process $installer.FullName
