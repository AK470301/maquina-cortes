#!/usr/bin/env bash
# Instala as skills cortes-papo, cortes-gameplay e cortes-video e o motor comum (macOS / Linux / Git Bash).
# Uso (da raiz do repositório):  bash instalador/install.sh
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="$HOME/.claude/skills"

command -v node >/dev/null || { echo "Instale o Node.js 18+ (recomendado 22+): https://nodejs.org"; exit 1; }

mkdir -p "$SKILLS"
for s in cortes-papo cortes-gameplay cortes-video; do
  rm -rf "$SKILLS/$s"
  cp -R "$REPO/skills/$s" "$SKILLS/$s"
  echo "Skill copiada para $SKILLS/$s"
done

# o motor (Remotion + whisper.cpp), os guias e as ferramentas ficam em ~/.maquina-cortes-gta, iguais para as três
node "$REPO/instalador/setup.mjs"
echo
echo "Pronto. Abra o Claude Code e use /cortes-papo, /cortes-gameplay ou /cortes-video"
