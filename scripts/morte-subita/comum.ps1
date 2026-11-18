# Funções comuns do rodar-cron.ps1 e do processar-link.ps1 (Modo Morte Súbita). Carregado com ". arquivo".
# UTF-8 com BOM: o Windows PowerShell 5.1 lê os acentos errado sem ele.
$R = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$M = Join-Path $R 'scripts\morte-subita'
$AtivoMS = Join-Path $R 'config\morte-subita.ativo'
$SettingsHeadless = Join-Path $R '.claude\headless-settings.json'
New-Item -ItemType Directory -Force (Join-Path $R 'logs'), (Join-Path $R 'fila-entrada'), (Join-Path $R 'fila') | Out-Null
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$utf8 = New-Object Text.UTF8Encoding $false

function Agora { (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') }
function Registrar([string]$linha) {
  Write-Host $linha
  [IO.File]::AppendAllText($script:ArquivoLog, $linha + "`r`n", $utf8)
}
# roda um script node do modo, com a saída na tela e no log; devolve o código de saída
function RodarNode([string]$script, [string[]]$argumentos) {
  & node (Join-Path $M $script) @argumentos 2>&1 | ForEach-Object { Registrar "$_" }
  return $LASTEXITCODE
}
# roda um script node e devolve o stdout como objeto JSON (stderr vai para o log)
function NodeJson([string]$script, [string[]]$argumentos) {
  $tmpErr = [IO.Path]::GetTempFileName()
  $saida = & node (Join-Path $M $script) @argumentos 2>$tmpErr
  Get-Content $tmpErr -Encoding UTF8 | ForEach-Object { [IO.File]::AppendAllText($script:ArquivoLog, "$_`r`n", $utf8) }
  Remove-Item $tmpErr -Force -ErrorAction SilentlyContinue
  try { return (($saida | Out-String) | ConvertFrom-Json) } catch { return $null }
}
# lê uma variável do <projeto>\.env (sem exibir o valor)
function LerEnv([string]$chave) {
  $f = Join-Path $R '.env'
  if (-not (Test-Path $f)) { return $null }
  foreach ($l in [IO.File]::ReadAllLines($f)) {
    if ($l -match "^\s*$chave\s*=\s*(.*?)\s*$") { return ($Matches[1] -replace '^["'']|["'']$', '') }
  }
  return $null
}
function PortaAberta([string]$hostName, [int]$porta) {
  $c = New-Object Net.Sockets.TcpClient
  try { $ok = $c.ConnectAsync($hostName, $porta).Wait(1500); return ($ok -and $c.Connected) } catch { return $false } finally { $c.Close() }
}
# roda o Claude Code em modo headless com o prompt de um arquivo; mata a árvore inteira se passar do tempo
function RodarClaude([string]$arquivoPrompt, [string]$arquivoSaida, [int]$timeoutMin) {
  $cmd = "claude -p --permission-mode dontAsk --settings `"$SettingsHeadless`" < `"$arquivoPrompt`" >> `"$arquivoSaida`" 2>&1"
  $p = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', $cmd -WorkingDirectory $R -PassThru -WindowStyle Hidden
  if (-not $p.WaitForExit($timeoutMin * 60 * 1000)) {
    & taskkill /PID $p.Id /T /F 2>&1 | Out-Null
    return 124
  }
  return $p.ExitCode
}
# grava o prompt com as marcas trocadas num arquivo temporário e devolve o caminho
function PromptDe([string]$modelo, [hashtable]$trocas) {
  $t = [IO.File]::ReadAllText((Join-Path $M $modelo), $utf8)
  foreach ($k in $trocas.Keys) { $t = $t.Replace("{{$k}}", $trocas[$k]) }
  $f = Join-Path $env:TEMP ("morte-subita-" + [IO.Path]::GetFileNameWithoutExtension($modelo) + "-" + $PID + ".md")
  [IO.File]::WriteAllText($f, $t, $utf8)
  return $f
}
function LimparEnvFree {
  Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
}
