#!/usr/bin/env bash
# Rodada automática do pipeline de cortes GTA 6.
#   rodar-diario.sh --turno 09|19   chamado pelo cron às 09:00 e 19:00
#   rodar-diario.sh --repescagem    chamado no boot (@reboot): roda se algum turno de HOJE já passou e não tem registro
# Coleta as VODs novas e, se houver, chama o Claude Code em modo headless até a tabela de publicação; no fim, avisa por
# e-mail os vídeos novos esperando aprovação (notificar-email.mjs).
# Nunca publica: PIPELINE_HEADLESS=1 faz o publicar.mjs aceitar só --teste, e o headless-settings.json libera só o
# necessário (o resto é recusado sem perguntar, com --permission-mode dontAsk).
# Registro dos turnos: fila/turnos/<AAAA-MM-DD>-<09|19>.ok (gravado só quando a rodada termina).
set -u
export HOME=/home/lucas
export PATH=/home/lucas/.local/bin:/usr/local/bin:/usr/bin:/bin
export PIPELINE_HEADLESS=1
R=/home/lucas/Documents/projeto-x
S=$R/.claude/skills/pipeline-diario-gta6/scripts
TURNOS=(09 19)
cd "$R" || exit 1
mkdir -p fila/turnos

modo=""
turno=""
case "${1:-}" in
  --turno) modo=turno; turno="${2:-}" ;;
  --repescagem) modo=repescagem ;;
  *) modo=turno; turno=$( [ "$(date +%H)" -lt 14 ] && echo 09 || echo 19 ) ;;  # rodada manual: turno pela hora
esac
hoje=$(date +%F)

if [ "$modo" = repescagem ]; then
  # turnos de hoje que já passaram e não foram registrados
  perdidos=()
  for t in "${TURNOS[@]}"; do
    if [ "$(date +%H%M)" -ge "${t}00" ] && [ ! -f "fila/turnos/$hoje-$t.ok" ]; then perdidos+=("$t"); fi
  done
  if [ ${#perdidos[@]} -eq 0 ]; then
    echo "=== $(date -Is) repescagem: nenhum turno de hoje perdido"
    exit 0
  fi
  # espera a rede (até 5 min) antes de falar com YouTube/Twitch/Zernio
  for _ in $(seq 1 30); do getent hosts www.youtube.com >/dev/null 2>&1 && break; sleep 10; done
  echo "=== $(date -Is) repescagem dos turnos: ${perdidos[*]}"
fi

exec 9>fila/.rodada.lock
if ! flock -n 9; then
  echo "=== $(date -Is) já há uma rodada em andamento; esta foi pulada"
  exit 0
fi

echo "=== $(date -Is) início ($modo ${turno:-${perdidos[*]:-}})"
node "$S/coletar.mjs" --disparar
codigo=$?
# avisa os vídeos novos esperando aprovação (não repete os já avisados)
node "$S/notificar-email.mjs" || echo "=== aviso: notificação por e-mail falhou"

if [ $codigo -eq 0 ]; then
  if [ "$modo" = repescagem ]; then
    for t in "${perdidos[@]}"; do date -Is > "fila/turnos/$hoje-$t.ok"; done
  else
    date -Is > "fila/turnos/$hoje-$turno.ok"
  fi
fi
echo "=== $(date -Is) fim (código $codigo)"
exit $codigo
