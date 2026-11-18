---
name: morte-subita
description: Fase 2 do Modo Morte Súbita — transforma os vídeos já baixados e transcritos em fila-entrada/ em cortes verticais 20–55 s (gancho no 1º segundo) em cortes/<slug>/render/, sem trava de criador, tema ou spoiler (a única restrição de conteúdo é o idioma português, já filtrada na entrada), apaga o bruto e work/ e dispara o e-mail de clipes gerados. Use quando o rodar-cron.ps1 ou o processar-link.ps1 chamar a Fase 2, ou quando o usuário pedir para processar o que está em fila-entrada/.
---

# morte-subita (Fase 2)

O sistema opera em **Modo Morte Súbita** enquanto existir `R/config/morte-subita.ativo` (só o usuário desativa). A **única restrição de conteúdo é o idioma português** — já garantida pela Fase 1 / `processar-link.ps1`. **Não** aplique trava de criador (autorização, `proibido`), de tema (GTA 6 ou não) nem de spoiler. Ficam só critérios **técnicos**: duração final 20–55 s, gancho no 1º segundo, corte que se entende sozinho, áudio limpo e **sem música licenciada audível** (o motor não separa a trilha). Nunca publique: a aprovação é manual, do usuário.

- `R` = raiz do projeto (a pasta com `config/` e `.claude/`). `S` = `R/.claude/skills/pipeline-diario-gta6/scripts`. `M` = `R/scripts/morte-subita`. `E` = `~/.maquina-cortes-gta/engine/scripts`.
- Escreva pouco: só o relatório final.

## 1. Entradas

```bash
node M/fase2.mjs listar
```

Processe **cada** entrada com `"pronto": true`, uma de cada vez, na ordem. Para cada `<slug>`:

```bash
node M/fase2.mjs iniciar <slug>      # move source.mp4 + transcrição para R/cortes/<slug>/work/
```

Daqui em diante rode tudo **de dentro de `R/cortes/<slug>/`**. Se a entrada já estiver iniciada (`"iniciado": true`, o `work/` já existe), continue de onde parou.

## 2. Ler o vídeo

1. `node E/transcript-text.mjs work` (frases com 🔥 = mais reproduzido, 🔊 = pico de voz).
2. Mapa visual: `node E/mapa-visual.mjs work/source.mp4 work <intervalo>` (120 s em vídeo de mais de 1 h; 30–60 s em vídeo curto) e olhe as folhas de `work/mapa/`. Grave `work/trechos.json` (`[{"start":0,"end":600,"tipo":"papo"|"gameplay"|"video"}]`).
3. `work/entrada.json` traz título, canal e URL da fonte.

## 3. Plano: `work/plano-cortes.json`

Escolha **de 3 a 5 cortes** (1–2 em vídeo curto; um Short de 20–60 s pode virar 1 corte do vídeo inteiro), os mais fortes pelo critério técnico-viral: pico emocional, tensão com desfecho, gancho que prende sozinho na 1ª frase, autonomia. Sem sobreposição.

Formato = o mesmo do `plano.mjs` (contrato do motor), corte **duplo** do modo `crescimento`:

```json
{
  "live_id": "<slug>",
  "streamer": "<slug do canal, minúsculas com hífen>",
  "autorizacao": "nao_verificado",
  "cortes": [{
    "id": "c-01-<assunto-curto>",
    "plataformas": ["tiktok", "youtube_short"],
    "tipo": "gameplay | papo",
    "sobre_gta6": true,
    "skill_edicao": "cortes-gameplay | cortes-papo | cortes-video",
    "timestamp_inicio": "00:12:03.4", "timestamp_fim": "00:12:48.0",
    "nota_viralidade": 80,
    "titulo_topo_tela": "ATÉ 6 PALAVRAS",
    "titulo_seo": "título do YouTube, até 60 caracteres",
    "legenda_tiktok": "legenda do TikTok, até 90 caracteres",
    "hashtags": ["#gta6", "#gtavi", "#tema", "#cortes"],
    "riscos": [],
    "edicao": {"id": "c-01-<assunto-curto>", "layout": "gameplay | papo | cheia", "start": 723.4, "end": 768.0,
               "assunto": "...", "hook": "a frase que abre o corte", "nota": 8, "titulo": "ATÉ 6 PALAVRAS",
               "keywords": ["2 a 5", "palavras da fala"], "turns": [730.0, 745.5, 760.0]}
  }]
}
```

- **Rota pelo layout:** jogo na tela → `tipo: gameplay`, layout `gameplay`, `cortes-gameplay`. Gente falando sem jogo, sobre GTA 6 → `papo` + `sobre_gta6: true`, layout `papo` (fundo de gameplay), `cortes-papo`. Fala sobre outro assunto, vlog, IRL, cena → `papo` + `sobre_gta6: false`, layout `cheia`, `cortes-video`. `sobre_gta6` é técnico aqui (decide o fundo), não trava conteúdo.
- **Duração:** final 20–55 s; janela bruta aceita 21–65 s. Vídeo já editado rende 0,91–0,98 do bruto; live crua ~0,85.
- **Gancho:** `edicao.start` ~0,2 s antes da 1ª palavra do `hook` (o validador recusa fala começando > 1 s depois do start). Termine num fim de frase.
- `hashtags` 3–5, sem `#shorts`. `keywords` exatamente como aparecem na fala. Não preencha `crop`, `gameCrop`, `focus`, `tituloSfx`.
- `musica_licenciada` em `riscos` = descarte o trecho (limite técnico). Spoiler, criador e tema **não** descartam nada.

Valide e corrija até `"ok": true` (avisos de "sem autorização" são esperados e não bloqueiam):

```bash
node ../../.claude/skills/pipeline-diario-gta6/scripts/plano.mjs validar work/plano-cortes.json
```

## 4. Render (um layout por vez)

Para cada layout presente no plano (`gameplay`, `papo`, `cheia`):

1. Só para `papo`: `node E/montar-bottom.mjs ../../assets/broll-gta6 work` (código 2 = sem fundo; siga).
2. `node ../../.claude/skills/pipeline-diario-gta6/scripts/plano.mjs cuts <layout> work/cuts.json work/plano-cortes.json`
3. Acione a skill de edição do layout (`cortes-gameplay` / `cortes-papo` / `cortes-video`) com:
   > Modo pipeline. O vídeo já está preparado em `work/` e o `work/cuts.json` já tem os cortes aprovados (start, end, hook, keywords, turns, titulo, tituloSfx). Pule os passos de checagem, download, transcrição, escolha e aprovação. Faça só o enquadramento e o render com saída em `render/`: `node ~/.maquina-cortes-gta/engine/scripts/build.mjs work render`. Não mude start/end/keywords/turns/titulo/tituloSfx. Não crie paleta nem marca d'água (sem paleta = branco e amarelo). Não publique.
4. Copie `work/cuts.json` para `work/cuts-<layout>.json`.

## 5. Conferir

```bash
node ../../.claude/skills/pipeline-diario-gta6/scripts/conferir.mjs render work/plano-cortes.json
```

Fora de 20–55 s: ajuste `end` no `work/cuts-<layout>.json` e no plano (`edicao.end`/`timestamp_fim`), copie de volta para `work/cuts.json` e `build.mjs work render --so <id>`. No máximo 2 tentativas por corte; se ainda falhar, **tire o corte do plano** e siga. Extraia 1 quadro em ~1 s de cada `render/<id>.mp4` e olhe (título, legenda, enquadramento).

## 6. Finalizar (obrigatório, logo depois de confirmar os MP4)

```bash
node ../../scripts/morte-subita/fase2.mjs finalizar <slug>
```

Ele confere os MP4 de `render/`, grava `postagem.json` (tudo `aprovado: false`) e `cortes.json`, **apaga o vídeo bruto, a pasta `work/` inteira e `fila-entrada/<slug>`**, e dispara o e-mail **Alerta de Clipe Gerado**. Se responder `"ok": false` porque não há MP4 válido, o `work/` fica para nova tentativa: registre a falha e passe para a próxima entrada.

## 7. Relatório

| slug | cortes em render/ | durações | e-mail | falhas |
|---|---|---|---|---|

Se um vídeo falhar, siga com os outros. Nunca apague `render/`, `logs/processados.txt` nem `fila/processados.json`.
