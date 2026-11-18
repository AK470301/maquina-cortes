# ENTRADA MANUAL UNIFICADA DO MODO MORTE SÚBITA: uma URL (live, vídeo longo ou Short) e mais nada.
#   .\processar-link.ps1 <url>             processa
#   .\processar-link.ps1 <url> --forcar    aceita vídeo que não parece estar em português (única restrição de conteúdo)
#   .\processar-link.ps1 <url> --teste     só inspeciona e diz o que faria
# 1. Inspeciona com `yt-dlp --dump-json --no-playlist`.
# 2. is_live = true  → liga o Radar Ao Vivo naquele canal numa janela própria (Twitch: chat; Kick e YouTube: pico de
#                      áudio). Cada clipe do radar dispara o e-mail (notificar-email.mjs). Para parar: Ctrl+C na janela
#                      do radar ou crie fila\parar-radar.
#    is_live = false → baixa e transcreve (scripts\morte-subita\preparar.mjs) em fila-entrada\, grava o id em
#                      logs\processados.txt e chama o claude oficial com a skill morte-subita: cortes 20–55 s com gancho
#                      no 1º segundo, sem trava de criador/tema/spoiler, MP4 finais em cortes\<slug>\render\, bruto e
#                      work\ apagados, e-mail de clipes gerados. Nada é publicado: a aprovação é sua.
# Este arquivo é UTF-8 com BOM.
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'scripts\morte-subita\comum.ps1')
$script:ArquivoLog = Join-Path $R 'logs\processar-link.log'
$env:PIPELINE_HEADLESS = '1'
Set-Location $R

$url = @($args | Where-Object { $_ -match '^https?://' })[0]
$forcar = $args -contains '--forcar'
$teste = $args -contains '--teste'
if (-not $url) { Write-Host 'Uso: .\processar-link.ps1 <url> [--forcar] [--teste]'; exit 1 }
if (-not (Test-Path $AtivoMS)) { Write-Host 'config\morte-subita.ativo não existe: o Modo Morte Súbita está desativado.'; exit 1 }
LimparEnvFree   # este fluxo usa sempre o claude oficial

Registrar "=== $(Agora) processar-link: $url"
$tmpInfo = Join-Path $env:TEMP "morte-subita-info-$PID.json"
$tmpErr = Join-Path $env:TEMP "morte-subita-info-$PID.err"
& yt-dlp --dump-json --no-playlist --extractor-args 'youtube:lang=pt' $url 2>$tmpErr | Out-File -Encoding utf8 $tmpInfo
if ($LASTEXITCODE -ne 0) {
  Registrar "yt-dlp não conseguiu ler a URL: $((Get-Content $tmpErr -Encoding UTF8 | Select-Object -Last 1))"
  exit 1
}
$info = Get-Content $tmpInfo -Raw -Encoding UTF8 | ConvertFrom-Json
$aoVivo = ($info.is_live -eq $true) -or ($info.live_status -eq 'is_live')
Registrar "título: $($info.title) · canal: $(if ($info.channel) { $info.channel } else { $info.uploader }) · is_live: $aoVivo · extrator: $($info.extractor_key)"

if ($aoVivo) {
  # canal no formato do radar: twitch → nome; kick → kick:nome; youtube → yt:<id do canal UC...>
  $ex = "$($info.extractor_key)".ToLower()
  $canal = $null
  if ($ex -like 'twitch*') { $canal = ("$($info.uploader_id)" -replace '^@', '').ToLower(); if (-not $canal -and $url -match 'twitch\.tv/([\w-]+)') { $canal = $Matches[1].ToLower() } }
  elseif ($ex -like 'kick*') { if ($url -match 'kick\.com/([\w-]+)') { $canal = 'kick:' + $Matches[1].ToLower() } }
  elseif ($ex -like 'youtube*') { if ($info.channel_id) { $canal = "yt:$($info.channel_id)" } }
  if (-not $canal) { Registrar "não sei ligar o radar para esta live ($ex): o radar aceita Twitch, Kick e YouTube"; exit 1 }
  $lock = Join-Path $R 'fila\.radar.lock'
  if (Test-Path $lock) {
    $dono = try { (Get-Content $lock -Raw | ConvertFrom-Json).pid } catch { $null }
    if ($dono -and (Get-Process -Id $dono -ErrorAction SilentlyContinue)) {
      Registrar "já existe um radar ligado (processo $dono). O radar acompanha vários canais ao mesmo tempo, mas só um radar por vez: pare o atual (Ctrl+C ou crie fila\parar-radar) e ligue de novo com --canais incluindo $canal"
      exit 1
    }
  }
  if ($teste) { Registrar "[teste] ligaria: node scripts\radar-ao-vivo.mjs --canais $canal"; exit 0 }
  Registrar "live detectada: ligando o Radar Ao Vivo em $canal (janela própria; e-mail a cada clipe)"
  Start-Process -FilePath $env:ComSpec -ArgumentList '/k', "chcp 65001 >nul & title Radar ao vivo - $canal & node scripts\radar-ao-vivo.mjs --canais $canal" -WorkingDirectory $R
  exit 0
}

# ── vídeo gravado: preparar + Fase 2 ──
if ($info.live_status -eq 'is_upcoming') { Registrar 'a live ainda não começou: rode de novo quando ela estiver no ar'; exit 1 }
$lingua = NodeJson 'idioma.mjs' @($tmpInfo)
if ($lingua -and -not $lingua.pt -and -not $forcar) {
  Registrar "o vídeo não parece estar em português ($($lingua.idioma); $($lingua.evidencia)). Única restrição do Modo Morte Súbita. Para processar mesmo assim: --forcar"
  exit 1
}
if ($teste) { Registrar "[teste] baixaria, transcreveria e cortaria: $($info.title) ($($info.duration) s, idioma $($lingua.idioma))"; exit 0 }

$rodada = 'link-' + (Get-Date).ToString('yyyyMMdd-HHmmss')
$env:MS_RODADA = $rodada
Registrar '--- baixando e transcrevendo (pode demorar)'
$prep = NodeJson 'preparar.mjs' @($url, '--origem', 'link', '--rodada', $rodada, '--info', $tmpInfo)
Remove-Item $tmpInfo, $tmpErr -Force -ErrorAction SilentlyContinue
if (-not $prep -or -not $prep.ok) { Registrar "preparo falhou: $($prep.erro)"; exit 1 }
if ($info.id) { & node -e "import('./scripts/morte-subita/comum.mjs').then(m=>m.gravarProcessado(process.argv[1], process.argv[2]))" $info.id "$($info.title)" }
Registrar "--- pronto em fila-entrada\$($prep.slug); chamando o claude oficial (Fase 2)"

$p2 = PromptDe 'prompt-fase2.md' @{ RODADA = $rodada; ALVO = ", link manual"; QUAIS = "SOMENTE a entrada $($prep.slug)" }
$saida = Join-Path $R "logs\claude-$rodada.log"
$cod = RodarClaude $p2 $saida 600
Remove-Item $p2 -Force -ErrorAction SilentlyContinue
Get-Content $saida -Encoding UTF8 | Select-Object -Last 15 | ForEach-Object { Write-Host $_ }
$resumo = Join-Path $R "cortes\$($prep.slug)\cortes.json"
if (Test-Path $resumo) {
  $r = Get-Content $resumo -Raw -Encoding UTF8 | ConvertFrom-Json
  Registrar "=== $(Agora) $(@($r.cortes).Count) corte(s) em $($r.pasta_render) (e-mail de clipes gerados enviado pelo finalizar)"
  exit 0
}
Registrar "=== $(Agora) a Fase 2 terminou (código $cod) sem finalizar: veja $saida"
exit 1
