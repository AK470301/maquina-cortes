# CRON DO MODO MORTE SÚBITA (Agendador de Tarefas: \MaquinaCortes\MorteSubita09 e \MaquinaCortes\MorteSubita21).
#   rodar-cron.ps1 --turno 09|21   rodada normal
#   rodar-cron.ps1 ... --teste     teste seco: checagem do FreeLLMAPI + busca da Fase 1 (sem baixar nem gravar) + e-mail simulado
# Só roda se config\morte-subita.ativo existir (sem o arquivo, registra no log e sai).
#
# ORIENTADO A EVENTO: a Fase 2 só começa se a Fase 1 emitir fila-entrada\evento-fase1-sucesso.json.
#  0. (com a trava da rodada) apaga qualquer evento-fase1-sucesso.json de execuções anteriores.
#  1. scripts\garantir-freellmapi.ps1: o FreeLLMAPI precisa estar no ar (abre o .exe de config\freellmapi.json e espera
#     até 30 s). Falhou → e-mail "Cron Morte Súbita falhou na Fase 1: FreeLLMAPI indisponível" e exit 1.
#  2. FASE 1a — claude-free (ANTHROPIC_BASE_URL = CLAUDE_FREE_URL, ANTHROPIC_AUTH_TOKEN = CLAUDE_FREE_TOKEN do .env, só
#     durante a chamada): SÓ busca e seleção — os mais vistos de "GTA 6"/"GTA VI" dos últimos 6 meses, só filtro de idioma
#     português, até 3 inéditos gravados em fila-entrada\selecionados.json (fase1.mjs --selecionar); termina em minutos.
#     Sem fallback: se o claude-free falhar (sem tokens, rate limit, timeout de 45 min, erro de conexão, código ≠ 0) ou
#     não gravar a seleção → nenhum evento, e-mail com o erro e exit 1.
#     0 inéditos → e-mail "rodou normalmente, nenhum vídeo novo em português" e fim, sem Fase 2.
#     FASE 1b — este script, nativo (0 tokens, sem limite de 10 min por comando): fase1.mjs --preparar com os ids da
#     seleção grava os ids em logs\processados.txt, baixa e transcreve; como ÚLTIMO passo grava o evento
#     ({"status":"SUCESSO", data/hora, caminhos de vídeo e transcrição}). O --preparar tem trava própria
#     (fila-entrada\.preparar.lock) e recusa execução duplicada (código 3).
#  3. FASE 2 — claude oficial: só se o evento existir, for desta rodada, tiver status SUCESSO e TODOS os vídeos e
#     transcrições listados existirem no disco. Processa só os vídeos do evento. No fim o evento é apagado.
#  4. E-mail de status do cron em TODA execução. Nunca publica (PIPELINE_HEADLESS=1).
# Log: logs\cron.log · saída do Claude: logs\claude-<rodada>-fase<N>.log · registro: logs\turnos\<data>-<turno>.ok
# Este arquivo é UTF-8 com BOM.
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'scripts\morte-subita\comum.ps1')
$script:ArquivoLog = Join-Path $R 'logs\cron.log'
$env:PIPELINE_HEADLESS = '1'
$Evento = Join-Path $R 'fila-entrada\evento-fase1-sucesso.json'
$Selecao = Join-Path $R 'fila-entrada\selecionados.json'
$Garantir = Join-Path $R 'scripts\garantir-freellmapi.ps1'
Set-Location $R

$teste = $args -contains '--teste'
$resto = @($args | Where-Object { $_ -ne '--teste' })
$turno = if ($resto.Count -ge 2 -and $resto[0] -eq '--turno') { '{0:00}' -f [int]$resto[1] } elseif ((Get-Date).Hour -lt 15) { '09' } else { '21' }
$hora = (Get-Date).ToString('HH:mm')
$hoje = (Get-Date).ToString('yyyy-MM-dd')
$rodada = "$hoje-$turno" + $(if ($teste) { '-teste' } else { '' })
$env:MS_RODADA = $rodada

if (-not (Test-Path $AtivoMS)) {
  Registrar "=== $(Agora) cron ${turno}: config\morte-subita.ativo não existe; Modo Morte Súbita desativado, nada a fazer"
  exit 0
}

# trava: uma rodada por vez (a mesma do cron antigo). Uma rodada pulada aqui NÃO mexe no evento da que está rodando.
$trava = $null
try {
  $trava = [IO.File]::Open((Join-Path $R 'fila\.rodada.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
  Registrar "=== $(Agora) já há uma rodada em andamento; esta ($rodada) foi pulada"
  exit 0
}

# 0. limpeza inicial: nenhum evento de rodada anterior pode disparar a Fase 2 desta
if (-not $teste) { Remove-Item $Evento, $Selecao -Force -ErrorAction SilentlyContinue }

function Encerrar([int]$codigo, [string]$msg) {
  Registrar "=== $(Agora) $msg"
  $trava.Close()
  exit $codigo
}
# falha da Fase 1: nada de evento, e-mail de alerta, fim (a Fase 2 não é tocada)
function FalhaFase1([string]$motivo, [string]$detalhe) {
  Remove-Item $Evento -Force -ErrorAction SilentlyContinue
  RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'falha-fase1', '--motivo', $motivo, '--detalhe', $detalhe) | Out-Null
  Encerrar 1 "MORTE SÚBITA fim rodada ${rodada}: falhou na Fase 1 ($motivo); Fase 2 não iniciada"
}
function LerJsonArq([string]$f) { if (Test-Path $f) { try { return (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {} } return $null }

# espera a rede (até 5 min): o PC pode ter acabado de ligar (tarefa com "executar assim que possível")
for ($i = 0; $i -lt 30; $i++) { try { [Net.Dns]::GetHostAddresses('www.youtube.com') | Out-Null; break } catch { Start-Sleep -Seconds 10 } }

Registrar "=== $(Agora) MORTE SÚBITA início rodada $rodada (turno $turno, $hora)"

# 1. FreeLLMAPI no ar (obrigatório antes de qualquer claude-free)
$saidaG = & $Garantir 2>&1 | Out-String
$codG = $LASTEXITCODE
$saidaG.Trim() -split "`r?`n" | ForEach-Object { Registrar $_ }

if ($teste) {
  Registrar '--- teste seco: busca da Fase 1 (sem baixar nem gravar) e e-mail simulado'
  $c = RodarNode 'fase1.mjs' @('--teste')
  $env:PIPELINE_SEM_EMAIL = '1'
  RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'vazio', '--simular') | Out-Null
  Encerrar $c "fim do teste seco (FreeLLMAPI: $(if ($codG -eq 0) { 'ok' } else { 'INDISPONÍVEL' }); busca: código $c)"
}

if ($codG -ne 0) { FalhaFase1 'FreeLLMAPI indisponível' $saidaG.Trim() }

# 2. FASE 1a pelo claude-free: só busca + seleção
$urlFree = LerEnv 'CLAUDE_FREE_URL'; if (-not $urlFree) { $urlFree = 'http://127.0.0.1:31415' }
$tokFree = LerEnv 'CLAUDE_FREE_TOKEN'
if (-not $tokFree) { FalhaFase1 'claude-free sem CLAUDE_FREE_TOKEN no .env' 'Copie o token da função claude-free do perfil do PowerShell para CLAUDE_FREE_TOKEN no .env.' }
$log1 = Join-Path $R "logs\claude-$rodada-fase1.log"
Registrar "--- Fase 1a (busca e seleção) pelo claude-free ($urlFree)"
$env:ANTHROPIC_BASE_URL = $urlFree
$env:ANTHROPIC_AUTH_TOKEN = $tokFree
$p1 = $null
try {
  $p1 = PromptDe 'prompt-fase1.md' @{ RODADA = $rodada }
  $cod1 = RodarClaude $p1 $log1 45
} finally {
  LimparEnvFree   # encerra o claude-free e limpa as variáveis locais antes de qualquer outra coisa
  if ($p1) { Remove-Item $p1 -Force -ErrorAction SilentlyContinue }
}
Registrar "--- claude-free terminou (código $cod1)"
$saida1 = if (Test-Path $log1) { $t = [IO.File]::ReadAllText($log1); $t.Substring([Math]::Max(0, $t.Length - 4000)) } else { '' }
$f1 = LerJsonArq (Join-Path $R 'fila-entrada\fase1.json')
$f1DestaRodada = $f1 -and $f1.rodada -eq $rodada

# por que a Fase 1 falhou (lido da saída do claude-free)
function MotivoFase1 {
  if ($cod1 -eq 124) { return 'timeout do claude-free (45 min)' }
  if ($saida1 -match '(?i)rate.?limit|too many requests|\b429\b') { return 'rate limit do provedor' }
  if ($saida1 -match '(?i)insufficient|quota|credit|out of tokens|no (more )?tokens|token limit|limite de tokens|sem tokens') { return 'sem tokens / cota esgotada' }
  if ($saida1 -match '(?i)ECONNREFUSED|ECONNRESET|ETIMEDOUT|connection (error|refused)|fetch failed|socket hang up|unable to connect|network error') { return 'erro de conexão com o FreeLLMAPI' }
  if ($saida1 -match '(?i)API Error|overloaded|internal server error|\b5\d\d\b') { return 'erro da API do FreeLLMAPI' }
  if ($cod1 -ne 0) { return "claude-free saiu com código $cod1" }
  return 'o claude-free terminou sem gravar fila-entrada\selecionados.json'
}

if ($cod1 -ne 0) { FalhaFase1 (MotivoFase1) $saida1 }

$sel = LerJsonArq $Selecao
if (-not $sel -or $sel.rodada -ne $rodada) {
  if ($f1DestaRodada -and $f1.status -eq 'vazio') {
    # 0 inéditos: avisa já e encerra sem baixar nada nem chamar a Fase 2
    RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'vazio') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $R 'logs\turnos') | Out-Null
    [IO.File]::WriteAllText((Join-Path $R "logs\turnos\$hoje-$turno.ok"), (Agora) + " vazio`r`n", $utf8)
    Encerrar 0 "MORTE SÚBITA fim rodada ${rodada}: nenhum vídeo novo em português (e-mail enviado; Fase 2 não iniciada)"
  }
  FalhaFase1 (MotivoFase1) $saida1
}
$ids = @(@($sel.ids) | Where-Object { $_ -match '^[\w-]{11}$' })
if ($ids.Count -lt 1 -or $ids.Count -gt 3) { FalhaFase1 'seleção inválida em selecionados.json' "ids: $(@($sel.ids) -join ', ')" }

# 2b. FASE 1b nativa: download + transcrição + evento (sem LLM, sem tokens, sem limite de tempo por comando)
Registrar "--- Fase 1b (download e transcrição) nativa: $($ids -join ', ')"
$codP = RodarNode 'fase1.mjs' @('--preparar', ($ids -join ','), '--rodada', $rodada)
Registrar "--- preparo terminou (código $codP)"
if ($codP -eq 3) { FalhaFase1 'preparo duplicado recusado' 'Outro fase1.mjs --preparar já estava rodando (fila-entrada\.preparar.lock).' }
$f1 = LerJsonArq (Join-Path $R 'fila-entrada\fase1.json')
$f1DestaRodada = $f1 -and $f1.rodada -eq $rodada
if (-not (Test-Path $Evento)) {
  $det = if ($f1DestaRodada -and @($f1.falhas).Count) { (@($f1.falhas) | ForEach-Object { "$($_.titulo): $($_.erro)" }) -join "`n" } else { "fase1.mjs --preparar saiu com código $codP sem gravar o evento; veja logs\cron.log e logs\morte-subita.log." }
  FalhaFase1 'download/transcrição falhou' $det
}

# 3. gatilho da Fase 2: evento desta rodada, SUCESSO, 1–3 vídeos, e todos os arquivos listados no disco
$ev = LerJsonArq $Evento
$faltando = @()
if ($ev) { foreach ($v in @($ev.videos)) { foreach ($f in @($v.video, $v.transcricao)) { if (-not $f -or -not (Test-Path -LiteralPath $f)) { $faltando += "$f" } } } }
$nVideos = if ($ev) { @($ev.videos).Count } else { 0 }
if (-not $ev -or $ev.status -ne 'SUCESSO' -or $ev.rodada -ne $rodada -or $nVideos -lt 1 -or $nVideos -gt 3 -or $faltando.Count) {
  FalhaFase1 'evento de sucesso inválido' ("status=$($ev.status) rodada=$($ev.rodada) videos=$nVideos faltando: " + ($faltando -join '; '))
}
$slugs = @($ev.videos | ForEach-Object { $_.slug })
Registrar "--- evento de sucesso da Fase 1 conferido: $nVideos vídeo(s) com vídeo e transcrição no disco ($($slugs -join ', '))"

Registrar '--- Fase 2 pelo claude oficial'
LimparEnvFree
$p2 = PromptDe 'prompt-fase2.md' @{ RODADA = $rodada; ALVO = ''; QUAIS = "SOMENTE as entradas listadas em fila-entrada/evento-fase1-sucesso.json ($($slugs -join ', '))" }
try {
  $cod2 = RodarClaude $p2 (Join-Path $R "logs\claude-$rodada-fase2.log") 600
} finally {
  Remove-Item $p2 -Force -ErrorAction SilentlyContinue
  Remove-Item $Evento -Force -ErrorAction SilentlyContinue   # Fase 2 concluída: o evento é consumido
}
Registrar "--- claude oficial terminou (código $cod2); evento apagado"

# 4. e-mail de status
$gerados = @()
$fj = Join-Path $R 'logs\clipes-gerados.jsonl'
if (Test-Path $fj) { $gerados = @(Get-Content $fj -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.rodada -eq $rodada }) }
$restantes = @(NodeJson 'fase2.mjs' @('listar'))
$det = if ($restantes.Count) { "Ficaram em fila-entrada (rode processar de novo ou a skill morte-subita numa sessão): $(($restantes | ForEach-Object { $_.slug }) -join ', ')." } else { '' }
if ($gerados.Count -gt 0) {
  RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'ok', '--detalhe', $det) | Out-Null
  New-Item -ItemType Directory -Force (Join-Path $R 'logs\turnos') | Out-Null
  [IO.File]::WriteAllText((Join-Path $R "logs\turnos\$hoje-$turno.ok"), (Agora) + "`r`n", $utf8)
  Encerrar 0 "MORTE SÚBITA fim rodada $rodada (código 0)"
}
RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'erro', '--detalhe', "A Fase 2 terminou com código $cod2 sem clipe finalizado. Veja logs\claude-$rodada-fase2.log. $det") | Out-Null
Encerrar 1 "MORTE SÚBITA fim rodada $rodada (código 1)"
