# Rodada automática do pipeline de cortes GTA 6 no Windows (equivalente ao rodar-diario.sh do Linux).
#   rodar-diario.ps1 --turno 09|19   chamado pelo Agendador de Tarefas às 09:00 e 19:00
#   rodar-diario.ps1 --repescagem    chamado ao ligar o PC: roda se algum turno de HOJE já passou e não tem registro
#   ... --teste                      ensaio: coletar.mjs --teste e notificar-email.mjs --simular; não grava fila nem
#                                    registro de turno, não chama o Claude e não envia e-mail
# Coleta as VODs novas e, se houver, chama o Claude Code em modo headless até a tabela de publicação; no fim, avisa por
# e-mail os vídeos novos esperando aprovação (notificar-email.mjs).
# Nunca publica: PIPELINE_HEADLESS=1 faz o publicar.mjs aceitar só --teste, e o headless-settings.json libera só o
# necessário (o resto é recusado sem perguntar, com --permission-mode dontAsk).
# Registro dos turnos: fila\turnos\<AAAA-MM-DD>-<09|19>.ok (gravado só quando a rodada termina bem).
# Log: fila\cron.log (o mesmo do Linux). Tarefas: pasta MaquinaCortes do Agendador (Turno09, Turno19, Repescagem).
# Este arquivo é UTF-8 com BOM: o Windows PowerShell 5.1 lê os acentos errado sem ele.
$ErrorActionPreference = 'Continue'
$env:PIPELINE_HEADLESS = '1'
$R = $PSScriptRoot
$S = Join-Path $R '.claude\skills\pipeline-diario-gta6\scripts'
$Turnos = @('09', '19')
Set-Location $R
# Modo Morte Súbita ativo (config\morte-subita.ativo): este cron antigo (streamers.json) fica parado; quem roda é o
# rodar-cron.ps1 (tarefas MorteSubita09/MorteSubita21). Volta a rodar sozinho quando o modo for desativado.
if (Test-Path (Join-Path $R 'config\morte-subita.ativo')) {
  [IO.File]::AppendAllText((Join-Path $R 'fila\cron.log'), "=== $((Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')) rodar-diario.ps1 ignorado: Modo Morte Súbita ativo (use rodar-cron.ps1)`r`n", (New-Object Text.UTF8Encoding $false))
  exit 0
}
New-Item -ItemType Directory -Force (Join-Path $R 'fila\turnos') | Out-Null
# o node escreve em UTF-8; sem isto os acentos chegam trocados ao log
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$arquivoLog = Join-Path $R 'fila\cron.log'
$utf8 = New-Object Text.UTF8Encoding $false
function Registrar([string]$linha) {
  Write-Host $linha
  [IO.File]::AppendAllText($arquivoLog, $linha + "`r`n", $utf8)
}
function Agora { (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') }
# roda um script do pipeline mandando a saída (normal e de erro) para a tela e para o log; devolve o código de saída
function Rodar([string]$script, [string[]]$argumentos) {
  & node (Join-Path $S $script) @argumentos 2>&1 | ForEach-Object { Registrar "$_" }
  return $LASTEXITCODE
}

$teste = $args -contains '--teste'
$resto = @($args | Where-Object { $_ -ne '--teste' })
$modo = 'turno'
$turno = ''
if ($resto.Count -ge 1 -and $resto[0] -eq '--repescagem') {
  $modo = 'repescagem'
} elseif ($resto.Count -ge 1 -and $resto[0] -eq '--turno') {
  if ($resto.Count -ge 2) { $turno = '{0:00}' -f [int]$resto[1] }
} else {
  # rodada manual: turno pela hora
  $turno = if ((Get-Date).Hour -lt 14) { '09' } else { '19' }
}
if ($modo -eq 'turno' -and $Turnos -notcontains $turno) {
  Registrar "=== $(Agora) turno inválido: use --turno 09, --turno 19 ou --repescagem"
  exit 1
}
$hoje = (Get-Date).ToString('yyyy-MM-dd')
$marca = if ($teste) { ' [teste]' } else { '' }

$perdidos = @()
if ($modo -eq 'repescagem') {
  # turnos de hoje que já passaram e não foram registrados
  $hhmm = [int](Get-Date).ToString('HHmm')
  foreach ($t in $Turnos) {
    if ($hhmm -ge [int]"${t}00" -and -not (Test-Path (Join-Path $R "fila\turnos\$hoje-$t.ok"))) { $perdidos += $t }
  }
  if ($perdidos.Count -eq 0) {
    Registrar "=== $(Agora) repescagem${marca}: nenhum turno de hoje perdido"
    exit 0
  }
  # espera a rede (até 5 min) antes de falar com YouTube/Twitch/Zernio
  for ($i = 0; $i -lt 30; $i++) {
    try { [Net.Dns]::GetHostAddresses('www.youtube.com') | Out-Null; break } catch { Start-Sleep -Seconds 10 }
  }
  Registrar "=== $(Agora) repescagem${marca} dos turnos: $($perdidos -join ' ')"
}

# trava: só uma rodada por vez (o arquivo fica aberto com exclusividade até este processo terminar)
$trava = $null
try {
  $trava = [IO.File]::Open((Join-Path $R 'fila\.rodada.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
  Registrar "=== $(Agora) já há uma rodada em andamento; esta foi pulada"
  exit 0
}

$alvo = if ($modo -eq 'repescagem') { $perdidos -join ' ' } else { $turno }
Registrar "=== $(Agora) início${marca} ($modo $alvo)"
if ($teste) {
  $codigo = Rodar 'coletar.mjs' @('--teste')
  if ((Rodar 'notificar-email.mjs' @('--simular')) -ne 0) { Registrar '=== aviso: a simulação do e-mail falhou' }
} else {
  $codigo = Rodar 'coletar.mjs' @('--disparar')
  # avisa os vídeos novos esperando aprovação (não repete os já avisados)
  if ((Rodar 'notificar-email.mjs' @()) -ne 0) { Registrar '=== aviso: notificação por e-mail falhou' }
  if ($codigo -eq 0) {
    $feitos = if ($modo -eq 'repescagem') { $perdidos } else { @($turno) }
    foreach ($t in $feitos) { [IO.File]::WriteAllText((Join-Path $R "fila\turnos\$hoje-$t.ok"), (Agora) + "`r`n", $utf8) }
  }
}
Registrar "=== $(Agora) fim${marca} (código $codigo)"
$trava.Close()
exit $codigo
