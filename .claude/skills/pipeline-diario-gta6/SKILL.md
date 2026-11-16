---
name: pipeline-diario-gta6
description: Roda o fluxo diário dos canais de cortes de GTA 6 de ponta a ponta: prepara as lives do dia, gera os planos do TikTok e do YouTube, monta o fundo de gameplay, roteia cada corte para cortes-gameplay ou cortes-papo, renderiza com título de topo, confere durações (TikTok 62–85 s, Shorts 35–58 s), alimenta o banco do compilado 16:9 de 8–12 min e prepara a publicação. Use quando o usuário pedir o pipeline do dia, os cortes diários de GTA 6 ou o compilado da semana.
---

# pipeline-diario-gta6

Orquestra as skills `estrategia-tiktok-gta6`, `estrategia-youtube-gta6`, `cortes-gameplay` e `cortes-papo` e os scripts desta pasta. **Sem narração:** o hook é o título de topo; o que sai de `render/` é o arquivo final. Escreva pouco no chat: só tabelas de decisão e o relatório final.

```
lives do dia ─► preparar (transcrição + trechos.json)
             ─► estrategia-tiktok-gta6 ─► plano-tiktok.json ┐
             ─► estrategia-youtube-gta6 ─► plano-youtube.json ┤─► validar ─► aprovação
                                                              │
       assets/broll-gta6 ─► montar-bottom ─► work/bottom.mp4  │
       tipo gameplay ─► cortes-gameplay (enquadrar + build) ──┤
       tipo papo     ─► cortes-papo     (enquadrar + build) ──┤─► render/ ─► conferir duração
                                                              │
       segmentos_para_compilado ─► banco ─► (≥6 de uma tese) ─► compilado.mjs 16:9 8–12 min
                                                              └─► postagem ─► aprovação ─► publicar
```

- `R` = a raiz do projeto, isto é, a pasta que contém este `.claude/` (no Windows `C:\Users\Lucas\Documents\maquina-cortes`; no Linux de origem `/home/lucas/Documents/projeto-x`). As skills de estratégia rodam de `R/cortes/<live>/` e por isso chegam à raiz por `../../`. Na raiz: `para-postar/` (vídeos esperando o OK), `postados/` (já enviados), `streamers.json`, `autorizacoes.json`, `pipeline.config.json`, `.env`, `assets/`, `fila/`, `banco-compilado/`, `cortes/`, `compilados/`).
- `S` = `R/.claude/skills/pipeline-diario-gta6/scripts`.
- `E` = `~/.maquina-cortes-gta/engine/scripts`.

## 0. Conferir

1. `node ~/.maquina-cortes-gta/setup.mjs --check`. Se faltar o motor, siga o passo 0 de `cortes-papo`.
2. Leia `R/pipeline.config.json`:
   - **`modo_revisao_manual`** (`true`/`false`). Em `R/autorizacoes.json`, `autorizado` e `politica_publica_de_clipes` publicam normalmente; `pendente`, `nao_verificado` ou streamer ausente contam como **sem autorização**; `proibido` (o streamer declarou que não permite) é bloqueado sempre, inclusive com revisão manual. Com `true`, os cortes deles seguem o fluxo e aparecem na tabela de publicação marcados **SEM AUTORIZAÇÃO**, e só saem com OK explícito **daquele item**. Com `false`, ficam bloqueados. Antes de pedir esse OK, lembre em uma linha que a revisão manual não substitui a permissão.
   - **`publicador`**: `zernio` (9A, padrão), `webhook` (9A) ou `maquina` (9B).
3. `R/assets/sfx/impacto.wav` e `whoosh.wav` existem (sons do título de topo e das transições do compilado). `R/assets/broll-gta6/` tem clipes? Se estiver vazia, avise uma vez: sem `bottom.mp4` a metade de baixo dos cortes de papo fica com a câmera desfocada.
4. Velocidade: o render do Remotion usa `~/.maquina-cortes-gta/config.json` → `render` (`concurrency`, `gl`); os encodes do ffmpeg usam o encoder do `node $S/encoder.mjs` (NVENC → AMF → QSV → VAAPI → libx264, testado de verdade).

## 1. Entrada

- **Fila do coletor:** sem links na mensagem, leia `R/fila/<data de hoje>.json` (gerada por `node $S/coletar.mjs`) e processe os itens com `status: "pendente"`; ao terminar cada live, mude o status para `processado` (ou `falhou` com o motivo).
- **Links na mensagem:** use-os; pergunte só o slug do streamer, se não estiver no `R/streamers.json`. Prefira VOD de live com 50 min ou mais: vídeo já editado por terceiros tem mais risco de Content ID. Se o usuário disser "sem aprovação", pule a aprovação de render do passo 3 (a de publicação nunca se pula).

## 2. Preparar cada live

Em `R/cortes/<slug-da-live>/` (rode tudo dessa pasta), siga `~/.maquina-cortes-gta/docs/preparacao.md`: download em `work/`, transcrição, `transcript-text.mjs` e mapa visual (`trechos.json`), **uma vez**. Se o download vier em AV1/VP9, converta para H.264 antes do render (`ffprobe` mostra o codec), com o encoder do `encoder.mjs`.

## 3. Planos e aprovação

1. Acione `estrategia-tiktok-gta6` → `work/plano-tiktok.json`.
2. Acione `estrategia-youtube-gta6` → `work/plano-youtube.json`.
3. Valide os dois juntos:
   ```bash
   node $S/plano.mjs validar work/plano-tiktok.json work/plano-youtube.json
   ```
   Corrija até `"ok": true`.
4. Mostre uma tabela única e espere o OK:

| id | plataforma | tipo → skill | trecho | nota | título de topo | título | bloqueado |
|---|---|---|---|---|---|---|---|

## 4. Fundo de gameplay (só cortes de papo **sobre GTA 6**)

O fundo de `R/assets/broll-gta6/` só entra em corte `papo` com `"sobre_gta6": true` (layout `papo`). Papo sobre outro assunto (GTA RP, react, IRL, resenha) tem `"sobre_gta6": false`, layout `cheia` e fica só com o vídeo da live em 9:16: não misture contextos. Se nenhum corte do plano tiver layout `papo`, pule este passo.

```bash
node $E/montar-bottom.mjs R/assets/broll-gta6 work
```

Sorteia trechos de 4–7 s dos clipes da pasta (sem áudio, 1080×960) em `work/bottom.mp4`. Pasta vazia: mantém o `work/bottom.mp4` que existir; sem nenhum dos dois, código 2 → avise que a metade de baixo fica com a câmera desfocada e siga.

## 5. Roteamento e render

O tipo decide a skill. **Um tipo por vez** (o `build.mjs` renderiza todos os clipes do `cuts.json`):

```bash
node $S/plano.mjs cuts gameplay work/cuts.json work/plano-tiktok.json work/plano-youtube.json
```

O `cuts` já põe em cada clipe o `titulo` de topo, `tituloDur: 4` e os sons dele (`tituloSfx` = impacto + whoosh). Se houver cortes `gameplay`, acione **`cortes-gameplay`** com:

> Modo pipeline. A live já está preparada em `work/` e o `work/cuts.json` já tem os cortes aprovados (start, end, hook, keywords, turns, titulo, tituloSfx). Pule os passos 0–7. Faça só o passo 8 (enquadrar) e o passo 9 com saída em `render/`: `node ~/.maquina-cortes-gta/engine/scripts/build.mjs work render`. Não mude start/end/keywords/turns/titulo/tituloSfx. As durações deste plano (até 100 s de janela) valem no lugar do limite de 60 s da skill. Não publique.

Depois: `cp work/cuts.json work/cuts-gameplay.json`. Repita com `papo` → **`cortes-papo`** (mesmos argumentos; o fundo já é o `work/bottom.mp4` do passo 4, sem Pexels) e `cp work/cuts.json work/cuts-papo.json`. Se houver cortes de layout `cheia` (papo que não é sobre GTA 6), repita com `cheia` → **`cortes-video`** (mesmo texto; o passo de enquadrar ali é medir o `focusTrack` da pessoa; **sem B-roll**) e `cp work/cuts.json work/cuts-cheia.json`.

Para refazer um corte: copie o `cuts-<tipo>.json` de volta para `work/cuts.json`, ajuste e rode `build.mjs work render --so <id>`.

## 6. Conferir

```bash
node $S/conferir.mjs render work/plano-tiktok.json work/plano-youtube.json
```

Recusa duração final fora de **TikTok 62–85 s / Shorts 35–58 s** e diz quanto ajustar: mude `end` no `cuts-<tipo>.json` (curto: estique até o próximo fim de frase; longo: corte no payoff anterior), atualize `edicao.end`/`timestamp_fim` no plano e re-renderize com `--so <id>`. Depois extraia 2 quadros de cada `render/<id>.mp4` (um em ~1 s, com o título; outro no meio) e olhe: enquadramento, título, legenda, fundo.

## 7. Banco do compilado

Acrescente os `segmentos_para_compilado` não bloqueados do `plano-youtube.json` a `R/banco-compilado/segmentos.json` (lista; crie se não existir), cada um com `fonte` = caminho absoluto do `work/source.mp4`, `streamer` (slug), `streamer_nome`, `link` da live, `data` e `"usado": false`.

## 8. Compilado 16:9 (até 2 por semana)

Monte quando uma tese tiver **≥ 6 segmentos não usados** (de preferência de ≥ 2 streamers) e o último compilado tiver saído há ≥ 3 dias (veja `R/compilados/`):

1. Escolha 6–9 segmentos, do forte para o mais forte; o 2º melhor dá a abertura (8–10 s dele).
2. Em `R/compilados/<AAAA-MM-DD>-<tese>/`, escreva `compilado.json` (formato no cabeçalho de `$S/compilado.mjs`): `streamer` = nome de exibição, `contexto` do banco, `fechamento.texto` com a pergunta para os comentários.
3. `node $S/compilado.mjs compilado.json compilado.mp4`. Ele recusa fora de 8–12 min ou com capítulo < 10 s: some, tire ou alongue segmentos.
4. Marque os segmentos como `"usado": true`.
5. Thumb: extraia quadros com rosto e emoção e proponha 2 opções com o `texto_thumb` (até 3 palavras).

## 9. Publicação (só com OK)

Tabela com **todos** os itens (TikTok, Shorts e compilado), arquivo = **`render/<id>.mp4`** (o compilado: `compilado.mp4`):

| id | plataforma | título | hashtags | quando | autorização |
|---|---|---|---|---|---|

- `tt-*` → `tiktok`; `yt-*` → `youtube_short` (descrição com `#Shorts`); compilado → `youtube_longo` (2 linhas com palavra-chave e tese, capítulos do `compilado.mp4.capitulos.txt`, crédito + link de cada live; **sem** `#Shorts`).
- **Meta diária: 3 TikToks + 3 Shorts** (mais o compilado quando houver). Junte os candidatos de todas as lives do dia, ordene pela nota e proponha os 3 melhores de cada plataforma para hoje; os demais entram na tabela como **reserva** (aprovados, eles vão para os próximos dias).
- **Horários: automáticos.** Deixe `agendado_para` vazio e preencha `nota` e `assunto` em cada item da postagem: o `publicar.mjs` chama o `agendar.mjs`, que dá a cada aprovado o próximo horário de pico livre (12:00, 18:00, 21:00 BRT; compilado às 20:00; `pipeline.config.json` → `agenda`), no máximo 3 por dia por plataforma, sem repetir horário já agendado na Zernio ou em outra postagem, e sem dois itens do mesmo `assunto` no mesmo dia. Horário dado pelo usuário é respeitado. Para mostrar a coluna "quando" na tabela antes do OK, rode `node $S/agendar.mjs postagem.json --teste` (com os itens marcados como aprovados só na simulação).
- Coluna autorização: `ok` ou **SEM AUTORIZAÇÃO**. Item bloqueado (`modo_revisao_manual: false`) nem entra.

**Antes de pedir o OK, grave a proposta** em `postagem.json` na pasta da live (formato no cabeçalho de `$S/publicar.mjs`), com todos os itens em `aprovado: false`, `agendado_para` vazio, `nota`, `assunto` e `sem_autorizacao`. Depois rode `node $S/para-postar.mjs postagem.json`: ele copia cada vídeo da proposta (do `render/`, ou o `compilado.mp4`) para `R/para-postar/<live>--<id>.mp4` e aponta o `arquivo` do item para lá (a origem fica em `arquivo_render`). Se um corte for re-renderizado (`build.mjs --so`), rode de novo: a cópia é trocada. Em seguida rode `node $S/notificar-email.mjs`: ele manda um e-mail (Resend) com quantidade, plataforma, título, duração e id de cada vídeo novo pendente, e guarda os ids em `R/notificados.json` para nunca repetir. Na rodada automática (`PIPELINE_HEADLESS`) o pipeline **para aqui**; o `rodar-diario.sh` também chama a notificação no fim, por garantia.

Espere o OK. Pode-se aprovar tudo **exceto** os SEM AUTORIZAÇÃO, que pedem OK nominal ("pode publicar o yt-02"). Item recusado: `"descartado": true` (some dos e-mails; rodar o `para-postar.mjs` de novo tira a cópia de `para-postar/`).

### 9A. `publicador: "zernio"` ou `"webhook"`

Atualize o `postagem.json` da proposta (o `arquivo` já aponta para `para-postar/`): `aprovado: true` só no que teve OK; `sem_autorizacao: true` nos sem autorização e `aprovado_sem_autorizacao: true` só nos que tiveram o OK nominal. Depois:

```bash
node $S/publicar.mjs postagem.json --teste   # valida; corrija os erros
node $S/publicar.mjs postagem.json           # envia (Zernio ou POST_API_URL, conforme o publicador)
```

- **Zernio:** `--teste` confere as contas conectadas (TikTok/YouTube) e mostra o corpo de cada post. O vídeo sobe por URL pré-assinada; com `agendado_para`, o post fica agendado na Zernio, sem, sai na hora. Ajustes (privacidade do TikTok, `draft`, categoria/playlist do YouTube) em `R/pipeline.config.json` → `zernio`. Sem `ZERNIO_API_KEY` no `R/.env`, ou sem conta da plataforma conectada no painel da Zernio, pare e avise.
- **Webhook:** sem `POST_API_URL` no `R/.env`, pare e avise.

O que já foi enviado fica em `postado.json` (com `post_id` da Zernio) e não é reenviado. **Cada envio confirmado move o vídeo de `R/para-postar/` para `R/postados/`** e atualiza o caminho no `postado.json` e no `postagem.json`; se o envio falhar, o arquivo fica em `para-postar/` para nova tentativa.

### 9B. `publicador: "maquina"`

Siga `~/.maquina-cortes-gta/docs/publicacao.md` com `work/publicacao.json` (`arquivo` = `render/<id>.mp4`).

## Rotina diária automática (opcional)

`node $S/coletar.mjs` lê `R/streamers.json` e procura, nas últimas 24 h, **só VODs de live** (YouTube: aba `/streams` com `was_live`; Twitch: `archives`; Kick: `/videos`) com **50 min ou mais** e termos de GTA 6; grava `R/fila/<data>.json`. Streamer com status `proibido` no `autorizacoes.json` é pulado sempre.

**Em produção:** o `crontab` roda `R/rodar-diario.sh --turno 09` e `--turno 19` (log em `R/fila/cron.log`) e, no boot, `@reboot sleep 120 && rodar-diario.sh --repescagem`, que roda se um turno de hoje já passou sem registro em `R/fila/turnos/<data>-<turno>.ok` (gravado só quando a rodada termina bem). O script fixa PATH e HOME, impede duas rodadas ao mesmo tempo (`flock`), chama `coletar.mjs --disparar` (que abre `claude -p` com `--permission-mode dontAsk --settings R/.claude/headless-settings.json`) e, no fim, `notificar-email.mjs`. Com `PIPELINE_HEADLESS=1`, o `publicar.mjs` só aceita `--teste`: **a rodada automática para na tabela de publicação**, e publicar é sempre numa sessão com o usuário. Suspender/retomar o notebook não conta como boot: só desligar e ligar dispara a repescagem.

**No Windows** o equivalente é o `R/rodar-diario.ps1` (mesmos argumentos, mais `--teste` para um ensaio que não grava nada nem chama o Claude), agendado no Agendador de Tarefas na pasta `MaquinaCortes`: `Turno09` (09:00), `Turno19` (19:00) e `Repescagem` (2 min depois de ligar o PC). A trava é o arquivo `R/fila/.rodada.lock` aberto com exclusividade e o log é o mesmo `R/fila/cron.log`.

## Modo aquecimento (até 18/11/2026)

Enquanto valer o bloco `aquecimento` do `R/streamers.json` (data `ate`, inclusive; depois o coletor o ignora sozinho e volta o filtro estrito de GTA 6):

- a coleta dispensa o termo de GTA 6 (menos nos canais com `"filtro_estrito": true`, como a CazéTV), põe o **Coringa primeiro** na fila, com janela de 72 h e sem teto de lives por rodada. Processe a fila **na ordem em que ela vem**;
- cada item da fila traz `"aquecimento": true` e `"gta6_no_titulo"`. Live que não é de GTA 6 (GTA RP, react, IRL, resenha, outro jogo) também rende corte: vale o momento viral. A regra "Vlog/IRL não entra" fica suspensa: trecho só de câmera ou IRL é `papo` com `"sobre_gta6": false` (layout `cheia` → `cortes-video`);
- VOD muito longa (4 h ou mais): para entregar no mesmo dia, pode baixar e transcrever só uma parte (`--download-sections` do yt-dlp); anote no relatório qual parte foi minerada;
- B-roll de GTA 6 e hashtags `#gta6`/`#gtavi` só em corte com `"sobre_gta6": true`;
- o compilado 16:9 continua só com segmentos de GTA 6.

## 10. Relatório do dia

| id | plataforma | skill | duração final | nota | status (publicado / agendado / kit / bloqueado / falhou) |
|---|---|---|---|---|---|

Mais: segmentos novos no banco por tese, se saiu compilado ou quando sai o próximo, e passos pulados (sem fundo de gameplay, sem autorização, render que falhou) com o motivo.

## Regras

- Rota fixa pelo layout: `gameplay` → `cortes-gameplay`; `papo` (fala sobre GTA 6, com B-roll) → `cortes-papo`; `cheia` (papo sobre outro assunto, sem B-roll) → `cortes-video`. Vlog/IRL não entra fora do modo aquecimento.
- Nunca publique sem o OK da tabela. Corte sem autorização: bloqueado, ou (com `modo_revisao_manual`) só com OK nominal do item.
- Música licenciada audível = trecho descartado (o motor não separa a trilha).
- B-roll só de `R/assets/broll-gta6/` (gameplay próprio ou licenciado); nada de Pexels nem trailer oficial no fundo. E só quando a fala do trecho é sobre GTA 6 (`"sobre_gta6": true`).
- Chaves e tokens só no ambiente do usuário, nunca no chat ou em arquivo do projeto.
- Se um corte falhar, siga com os outros e registre no relatório.
