# Garante que o FreeLLMAPI (proxy local do claude-free) está no ar ANTES de qualquer execução do claude-free.
# Chamado pelo rodar-cron.ps1 (Fase 1) e pela função claude-free do perfil do PowerShell.
#   scripts\garantir-freellmapi.ps1             checa; se a API não responde, abre o .exe e espera até 30 s
#   scripts\garantir-freellmapi.ps1 -Capturar   (re)grava em config\freellmapi.json o .exe do processo que escuta a porta
# Saudável = porta TCP aberta E GET /v1/models com HTTP 200 e JSON {"object":"list"} (com o CLAUDE_FREE_TOKEN do .env;
# sem token no .env, um 401 já prova que o servidor responde). Código de saída: 0 no ar, 1 não pôde ser iniciado.
# Este arquivo é UTF-8 com BOM (Windows PowerShell 5.1).
param([switch]$Capturar, [int]$LimiteSeg = 30)
$ErrorActionPreference = 'Continue'
$R = Split-Path $PSScriptRoot -Parent
$cfgArq = Join-Path $R 'config\freellmapi.json'

function LerEnv([string]$chave) {
  $f = Join-Path $R '.env'
  if (-not (Test-Path $f)) { return $null }
  foreach ($l in [IO.File]::ReadAllLines($f)) { if ($l -match "^\s*$chave\s*=\s*(.*?)\s*$") { return ($Matches[1] -replace '^["'']|["'']$', '') } }
  return $null
}
$url = LerEnv 'CLAUDE_FREE_URL'; if (-not $url) { $url = 'http://127.0.0.1:31415' }
$uri = [Uri]$url
$token = LerEnv 'CLAUDE_FREE_TOKEN'
if (-not $token -and $env:ANTHROPIC_AUTH_TOKEN) { $token = $env:ANTHROPIC_AUTH_TOKEN }

function PortaAberta {
  $c = New-Object Net.Sockets.TcpClient
  try { return ($c.ConnectAsync($uri.Host, $uri.Port).Wait(1500) -and $c.Connected) } catch { return $false } finally { $c.Close() }
}
function ApiSaudavel {
  if (-not (PortaAberta)) { return $false }
  $h = @{}; if ($token) { $h = @{ Authorization = "Bearer $token"; 'x-api-key' = $token } }
  try {
    $r = Invoke-WebRequest "$($url.TrimEnd('/'))/v1/models" -Headers $h -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200 -and (($r.Content | ConvertFrom-Json).object -eq 'list'))
  } catch {
    $st = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
    return (-not $token -and $st -eq 401)
  }
}
# o .exe do processo que escuta a porta (o Electron abre vários FreeLLMAPI.exe; vale o dono da porta)
function CapturarExe {
  $con = Get-NetTCPConnection -LocalPort $uri.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $con) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($con.OwningProcess)"
  if (-not $p -or -not $p.ExecutablePath) { return $null }
  $dados = [ordered]@{ exe = $p.ExecutablePath; processo = $p.Name; porta = $uri.Port; url = $url; health = '/v1/models'; capturado_em = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') }
  New-Item -ItemType Directory -Force (Split-Path $cfgArq) | Out-Null
  [IO.File]::WriteAllText($cfgArq, ($dados | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  return $p.ExecutablePath
}

if ($Capturar) {
  $exe = CapturarExe
  if (-not $exe) { Write-Host "[freellmapi] nenhum processo escutando a porta $($uri.Port): abra o FreeLLMAPI e rode de novo com -Capturar"; exit 1 }
  Write-Host "[freellmapi] capturado: $exe → config\freellmapi.json"
}

if (ApiSaudavel) {
  if (-not (Test-Path $cfgArq)) { CapturarExe | Out-Null }   # primeira vez: guarda o caminho enquanto ele está no ar
  Write-Host "[freellmapi] OK: $url respondendo (porta $($uri.Port) aberta, /v1/models HTTP 200)"
  exit 0
}

# fora do ar: abre o .exe salvo e espera a porta responder (checa a cada 2 s, até $LimiteSeg s)
$exe = $null
if (Test-Path $cfgArq) { try { $exe = (Get-Content $cfgArq -Raw -Encoding UTF8 | ConvertFrom-Json).exe } catch {} }
if (-not $exe -or -not (Test-Path $exe)) {
  Write-Host "[freellmapi] ERRO: o FreeLLMAPI não pôde ser iniciado: $url não responde e não há .exe válido em config\freellmapi.json (abra o app e rode scripts\garantir-freellmapi.ps1 -Capturar)"
  exit 1
}
Write-Host "[freellmapi] $url não responde: iniciando $exe"
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null
for ($t = 0; $t -lt $LimiteSeg; $t += 2) {
  Start-Sleep -Seconds 2
  if (ApiSaudavel) { Write-Host "[freellmapi] OK: no ar depois de $($t + 2) s"; exit 0 }
}
Write-Host "[freellmapi] ERRO: o FreeLLMAPI não pôde ser iniciado: $url não respondeu em $LimiteSeg s depois de abrir $exe"
exit 1
