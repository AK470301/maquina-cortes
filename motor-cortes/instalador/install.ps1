# Instala as skills cortes-papo, cortes-gameplay e cortes-video e o motor comum (Windows / PowerShell).
# Uso (da raiz do repositório):  powershell -ExecutionPolicy Bypass -File instalador\install.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$skills = Join-Path $env:USERPROFILE '.claude\skills'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale o Node.js 18+ (recomendado 22+): https://nodejs.org' }

New-Item -ItemType Directory -Force $skills | Out-Null
foreach ($s in 'cortes-papo', 'cortes-gameplay', 'cortes-video') {
  $dest = Join-Path $skills $s
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Copy-Item -Recurse -Force (Join-Path $repo "skills\$s") $dest
  Write-Host "Skill copiada para $dest"
}

# o motor (Remotion + whisper.cpp), os guias e as ferramentas ficam em ~/.maquina-cortes-gta, iguais para as três
node (Join-Path $repo 'instalador\setup.mjs')
Write-Host "`nPronto. Abra o Claude Code e use /cortes-papo, /cortes-gameplay ou /cortes-video"
