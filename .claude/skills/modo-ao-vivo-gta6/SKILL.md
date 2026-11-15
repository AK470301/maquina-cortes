---
name: modo-ao-vivo-gta6
description: Captura cortes de lives da Twitch enquanto elas acontecem. Liga o radar (scripts/radar-ao-vivo.mjs), que grava a live com o streamlink, acompanha o chat por IRC e, a cada pico de mensagens, corta ~65 s, transcreve, renderiza em 9:16 com legenda na paleta do streamer e deixa o vídeo em para-postar/ esperando o OK. Use quando o usuário pedir para acompanhar uma live ao vivo, ligar o radar, o modo ao vivo, cortar "na hora" o que está acontecendo numa live, ou para revisar, aprovar e publicar os cortes LIVE-- que o radar gerou. Para VODs de lives já encerradas, use pipeline-diario-gta6.
---

# modo-ao-vivo-gta6

Módulo separado do pipeline diário: não usa a fila do dia nem o agendamento das 09:00 e 19:00, e pode rodar ao mesmo tempo que eles. `R` = raiz do projeto (a pasta que contém este `.claude/`); `S` = `R/.claude/skills/pipeline-diario-gta6/scripts`.

```
streamlink ─► fila/live-<canal>.ts ─┐
chat (IRC) ─► pico de mensagens ────┴─► corte ─► whisper ─► render 9:16 ─► para-postar/LIVE--<canal>--<data>.mp4
                                                                        └─► cortes/ao-vivo-<canal>/postagem.json ─► e-mail
                                                    revisão ─► OK do usuário ─► publicar.mjs (sai na hora)
```

## 1. Antes de ligar

1. **Autorização** (`R/autorizacoes.json`, mesma regra do pipeline): canal de streamer `proibido` é recusado pelo radar; `autorizado` e `politica_publica_de_clipes` seguem normais; qualquer outro status gera cortes marcados **SEM AUTORIZAÇÃO**, que só saem com OK nominal daquele item. O canal é ligado ao streamer pela URL da Twitch no `R/streamers.json`; canal que não está lá conta como `nao_verificado`.
2. **O canal existe e está certo?** `node scripts/radar-ao-vivo.mjs --testar-irc <canal>` entra no chat por alguns segundos. `entrou_no_canal: false` quase sempre é nome errado (a Twitch não responde ao JOIN de canal inexistente).
3. **É live de GTA 6?** O radar grava o que o canal estiver transmitindo. Ele anota a categoria e o título da live em cada item e avisa quando não batem com os termos do `streamers.json`; nesse caso descarte na revisão.
4. **Disco:** a gravação em `best` ocupa de 2 a 3 GB por hora por canal em `R/fila/`. Confira o espaço livre antes de uma live longa ou de vários canais; `--qualidade 720p60,best` reduz bastante.
5. **Paleta:** sem `~/.maquina-cortes-gta/streamers/<slug>.json` a legenda sai em branco e amarelo (o radar avisa na partida).

## 2. Ligar o radar

Rode da raiz, em segundo plano, e acompanhe por `R/fila/radar.log`:

```bash
node scripts/radar-ao-vivo.mjs --canais coringa,paulinholokobr,luquet4
```

| opção | padrão | para que serve |
|---|---|---|
| `--duracao` | 65 | segundos do corte (TikTok monetiza de 62 a 85 s) |
| `--antes` | 45 | quanto do corte vem antes do pico (o chat reage depois do lance) |
| `--fator` | 3 | pico = mensagens dos últimos 10 s ≥ fator × média dos 5 min anteriores |
| `--piso` | 8 | mínimo de mensagens em 10 s (chat parado não dispara) |
| `--cooldown` | 90 | segundos entre dois cortes do mesmo canal |
| `--max-hora` | 6 | teto de cortes por canal por hora (0 = sem teto) |
| `--plataforma` | tiktok | `youtube_short` pede `--duracao` de 35 a 58 |
| `--qualidade` | best | qualidade pedida ao streamlink |

O radar pode ficar ligado antes de a live começar: o streamlink espera, e quando a live acaba o `.ts` é apagado e ele volta a esperar a próxima. Para desligar, Ctrl+C (ou encerre o processo e confira que não sobrou `streamlink` rodando nem `fila/live-*.ts`). Cada corte gera um e-mail; o teto de 6 por canal por hora evita enxurrada. Em chat muito agitado, suba `--piso`/`--fator` para ficar só com os picos maiores.

**Ensaio sem live:** `node scripts/radar-ao-vivo.mjs --simular <video local> [--canal <canal>] [--pico <s>]` testa o detector com um chat sintético e faz o corte completo do vídeo. O resultado vai para `cortes/ao-vivo-simulacao-<canal>/` como calibração (nunca é publicado nem avisado); apague o `.mp4` e a pasta depois.

## 3. Revisar os cortes

Cada corte vira um item em `R/cortes/ao-vivo-<canal>/postagem.json` com `ao_vivo: true`, `aprovado: false`, a `transcricao`, uma `chat_amostra` do momento do pico, a `categoria`/`titulo_live` e um **título de rascunho** (`titulo_provisorio: true`, tirado da fala). Para cada item pendente:

1. Leia a transcrição e a amostra do chat; se precisar, veja quadros do vídeo em `R/para-postar/`.
2. **Descarte** (`"descartado": true`, depois `node $S/para-postar.mjs <postagem.json>` para tirar o arquivo) quando: tocar música licenciada, a live não for de GTA 6, o pico for de sorteio, raid, anúncio ou conversa sem lance, ou o trecho não se sustentar sozinho.
3. Para os que ficam, escreva o **título definitivo** (curto, o lance em primeiro lugar, sem enganar), ajuste `descricao` e `hashtags` e apague `titulo_provisorio`. O `publicar.mjs` recusa item que ainda tem o rascunho.
4. Mostre a tabela e espere o OK:

| id | canal | título | duração | autorização |
|---|---|---|---|---|

Itens **SEM AUTORIZAÇÃO** pedem OK nominal ("pode publicar o live-luquet4-…"); lembre em uma linha que a revisão manual não substitui a permissão do streamer.

## 4. Publicar (só com OK)

Marque `aprovado: true` no que teve OK (e `aprovado_sem_autorizacao: true` só nos que tiveram o OK nominal). Depois:

```bash
node $S/publicar.mjs cortes/ao-vivo-<canal>/postagem.json --teste --so <id>   # valida e mostra o corpo do post
node $S/publicar.mjs cortes/ao-vivo-<canal>/postagem.json --so <id>           # envia
```

Item `ao_vivo: true` **sai na hora** (`publishNow` na Zernio): não entra na fila das 12:00, 18:00 e 21:00 nem conta para o limite de 3 por dia. O mesmo vale para qualquer item de outro `postagem.json` quando o usuário pedir para postar já: acrescente `--agora` (com `--so`, só para os ids pedidos). Para um corte ao vivo entrar na fila de horários em vez de sair na hora, tire o `ao_vivo` do item.

O radar nunca publica, e a rodada automática (`PIPELINE_HEADLESS=1`) continua bloqueada no `publicar.mjs`, com ou sem `--agora`. Enviado com sucesso, o vídeo vai de `para-postar/` para `postados/`.
