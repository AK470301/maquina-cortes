# CRON DO MODO MORTE SÚBITA (Agendador de Tarefas: \MaquinaCortes\MorteSubita09 e \MaquinaCortes\MorteSubita21).
#   rodar-cron.ps1 --turno 09|21   rodada normal
#   rodar-cron.ps1 ... --teste     teste seco: só a busca da Fase 1 (sem baixar, sem gravar processados) e o e-mail simulado
# Só roda se config\morte-subita.ativo existir (sem o arquivo, registra no log e sai).
#
# FASE 1 — claude-free (Claude Code apontando para o FreeLLMAPI em CLAUDE_FREE_URL, padrão http://127.0.0.1:31415, com
#   CLAUDE_FREE_TOKEN do .env): busca no YouTube os vídeos mais vistos sobre "GTA 6"/"GTA VI" dos últimos 6 meses,
#   filtra SÓ por idioma português, ignora lives em andamento e ids de logs\processados.txt e escolhe os 3 inéditos
#   mais vistos; grava os ids, baixa e transcreve em fila-entrada\. As variáveis do claude-free são apagadas no fim.
#   Se o proxy estiver fora do ar ou o claude-free não terminar, o próprio script roda fase1.mjs --auto (mesma regra).
#   0 vídeos inéditos: e-mail "o cron rodou às HH:MM e não encontrou vídeos novos em português" e fim (sem Fase 2).
# FASE 2 — claude oficial (sem as variáveis do proxy): skill morte-subita → cortes 20–55 s em cortes\<slug>\render\,
#   apaga o bruto/work/fila-entrada de cada vídeo e manda o e-mail de clipes gerados.
# Em TODA execução sai um e-mail de status do cron (alerta-email.mjs cron). Nunca publica (PIPELINE_HEADLESS=1).
# Log: logs\cron.log · saída do Claude: logs\claude-<rodada>-fase<N>.log · registro: logs\turnos\<data>-<turno>.ok
# Este arquivo é UTF-8 com BOM.
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'scripts\morte-subita\comum.ps1')
$script:ArquivoLog = Join-Path $R 'logs\cron.log'
$env:PIPELINE_HEADLESS = '1'
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

# trava: uma rodada por vez (a mesma do cron antigo)
$trava = $null
try {
  $trava = [IO.File]::Open((Join-Path $R 'fila\.rodada.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
  Registrar "=== $(Agora) já há uma rodada em andamento; esta ($rodada) foi pulada"
  exit 0
}

# espera a rede (até 5 min): o PC pode ter acabado de ligar (tarefa com "executar assim que possível")
for ($i = 0; $i -lt 30; $i++) { try { [Net.Dns]::GetHostAddresses('www.youtube.com') | Out-Null; break } catch { Start-Sleep -Seconds 10 } }

Registrar "=== $(Agora) MORTE SÚBITA início rodada $rodada (turno $turno, $hora)"

if ($teste) {
  Registrar '--- teste seco: busca da Fase 1 (sem baixar nem gravar) e e-mail simulado'
  $c = RodarNode 'fase1.mjs' @('--teste')
  $env:PIPELINE_SEM_EMAIL = '1'
  RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'vazio', '--simular') | Out-Null
  Registrar "=== $(Agora) fim do teste seco (código $c)"
  $trava.Close()
  exit $c
}

# ── FASE 1: claude-free ──
$urlFree = LerEnv 'CLAUDE_FREE_URL'; if (-not $urlFree) { $urlFree = 'http://127.0.0.1:31415' }
$tokFree = LerEnv 'CLAUDE_FREE_TOKEN'
$uri = [Uri]$urlFree
$fase1Json = Join-Path $R 'fila-entrada\fase1.json'
$viaFree = $false
if ($tokFree -and (PortaAberta $uri.Host $uri.Port)) {
  Registrar "--- Fase 1 pelo claude-free ($urlFree)"
  $env:ANTHROPIC_BASE_URL = $urlFree
  $env:ANTHROPIC_AUTH_TOKEN = $tokFree
  try {
    $p1 = PromptDe 'prompt-fase1.md' @{ RODADA = $rodada }
    $cod1 = RodarClaude $p1 (Join-Path $R "logs\claude-$rodada-fase1.log") 240
    Registrar "--- claude-free terminou (código $cod1)"
    $viaFree = $true
  } finally {
    LimparEnvFree   # encerra o claude-free e limpa as variáveis locais antes de qualquer outra coisa
    Remove-Item $p1 -Force -ErrorAction SilentlyContinue
  }
} else {
  Registrar "--- claude-free indisponível (proxy $urlFree fora do ar ou sem CLAUDE_FREE_TOKEN no .env)"
}
LimparEnvFree

$f1 = if (Test-Path $fase1Json) { try { Get-Content $fase1Json -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null } } else { $null }
if (-not $f1 -or $f1.rodada -ne $rodada) {
  Registrar "--- Fase 1 sem resultado desta rodada$(if ($viaFree) { ' do claude-free' }): rodando fase1.mjs --auto"
  RodarNode 'fase1.mjs' @('--auto', '--rodada', $rodada) | Out-Null
} elseif ($f1.status -eq 'preparando') {
  Registrar '--- o preparo ficou pela metade: retomando'
  RodarNode 'preparar.mjs' @('--retomar') | Out-Null
}
$f1 = if (Test-Path $fase1Json) { try { Get-Content $fase1Json -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null } } else { $null }
$prontos = @(NodeJson 'fase2.mjs' @('listar') | Where-Object { $_.pronto })
$selecionados = if ($f1 -and $f1.rodada -eq $rodada) { @($f1.selecionados).Count } else { 0 }
Registrar "--- Fase 1: $selecionados vídeo(s) inédito(s) selecionado(s); $($prontos.Count) pronto(s) em fila-entrada"

if ($prontos.Count -eq 0) {
  if (-not $f1 -or $f1.rodada -ne $rodada) {
    RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'erro', '--detalhe', 'A busca da Fase 1 falhou (rede, YouTube ou yt-dlp). Veja logs\cron.log e logs\morte-subita.log.') | Out-Null
    Registrar "=== $(Agora) fim: a busca da Fase 1 falhou (e-mail enviado)"
  } elseif ($selecionados -eq 0) {
    # 0 inéditos: avisa já e encerra sem chamar a Fase 2
    RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'vazio') | Out-Null
    New-Item -ItemType Directory -Force (Join-Path $R 'logs\turnos') | Out-Null
    [IO.File]::WriteAllText((Join-Path $R "logs\turnos\$hoje-$turno.ok"), (Agora) + " vazio`r`n", $utf8)
    Registrar "=== $(Agora) fim: nenhum vídeo novo em português (e-mail enviado)"
  } else {
    RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'erro', '--detalhe', 'Os vídeos foram selecionados, mas nenhum terminou o download/transcrição. Eles serão retomados na próxima rodada.') | Out-Null
    Registrar "=== $(Agora) fim: preparo falhou (e-mail enviado)"
  }
  $trava.Close()
  exit 0
}

# ── FASE 2: claude oficial (sem as variáveis do proxy) ──
Registrar '--- Fase 2 pelo claude oficial'
$p2 = PromptDe 'prompt-fase2.md' @{ RODADA = $rodada; ALVO = ''; QUAIS = 'TODAS as entradas prontas' }
$cod2 = RodarClaude $p2 (Join-Path $R "logs\claude-$rodada-fase2.log") 600
Remove-Item $p2 -Force -ErrorAction SilentlyContinue
Registrar "--- claude oficial terminou (código $cod2)"

$gerados = @()
$fj = Join-Path $R 'logs\clipes-gerados.jsonl'
if (Test-Path $fj) { $gerados = @(Get-Content $fj -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.rodada -eq $rodada }) }
$restantes = @(NodeJson 'fase2.mjs' @('listar'))
if ($gerados.Count -gt 0) {
  $det = if ($restantes.Count) { "Ficaram em fila-entrada para a próxima rodada: $(($restantes | ForEach-Object { $_.slug }) -join ', ')." } else { '' }
  RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'ok', '--detalhe', $det) | Out-Null
  New-Item -ItemType Directory -Force (Join-Path $R 'logs\turnos') | Out-Null
  [IO.File]::WriteAllText((Join-Path $R "logs\turnos\$hoje-$turno.ok"), (Agora) + "`r`n", $utf8)
  $final = 0
} else {
  RodarNode 'alerta-email.mjs' @('cron', '--rodada', $rodada, '--hora', $hora, '--status', 'erro', '--detalhe', "A Fase 2 terminou com código $cod2 sem clipe finalizado. Veja logs\claude-$rodada-fase2.log; os vídeos continuam em fila-entrada/cortes para a próxima rodada.") | Out-Null
  $final = 1
}
Registrar "=== $(Agora) MORTE SÚBITA fim rodada $rodada (código $final)"
$trava.Close()
exit $final
