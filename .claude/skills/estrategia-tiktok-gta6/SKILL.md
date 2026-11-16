---
name: estrategia-tiktok-gta6
description: Analisa a transcrição de uma live sobre GTA 6 e devolve o plano de cortes para o TikTok (pt-BR, 62–85 s finais, Creator Rewards): nota de viralidade, título de topo (hook visual), SEO e o bloco de edição já no formato do cuts.json do motor de cortes. Use quando o pipeline-diario-gta6 pedir o plano do TikTok ou o usuário pedir para minerar cortes de GTA 6 para TikTok. Não renderiza nada.
---

# estrategia-tiktok-gta6

Você lê uma live já transcrita e grava **`work/plano-tiktok.json`**. Quem edita são as skills `cortes-gameplay` e `cortes-papo`. Não há narração: o hook é **visual** (título fixo no topo com som de impacto). Não escreva o plano no chat.

## 1. Entrada

Da pasta `./cortes/<slug-da-live>/work/` (preparada pelo `~/.maquina-cortes-gta/docs/preparacao.md`):
- `captions.json` e a saída de `node ~/.maquina-cortes-gta/engine/scripts/transcript-text.mjs work` (frases com 🔥 e 🔊);
- `trechos.json` (mapa visual: o que é `gameplay` e o que é `papo`);
- o slug do streamer e o status de autorização dele em `../../autorizacoes.json`. No plano, `autorizacao` é `autorizado` | `politica_publica_de_clipes` | `nao_verificado` (`pendente` ou streamer ausente viram `nao_verificado`).

## 2. Classificar cada candidato (define a skill de edição)

| `tipo` | Quando | `skill_edicao` | `edicao.layout` |
|---|---|---|---|
| `gameplay` | o streamer **está jogando**: jogo ativo na tela, com ou sem webcam (descoberta no mapa, bug, missão, reação durante a partida) | `cortes-gameplay` | `gameplay` |
| `papo` + `"sobre_gta6": true` | **sem jogo controlado na tela** e a fala é **sobre GTA 6**: reação a trailer/notícia, debate, teoria, opinião | `cortes-papo` | `papo` (fundo de gameplay de GTA 6) |
| `papo` + `"sobre_gta6": false` | sem jogo controlado na tela e a fala é sobre **outro assunto** (GTA RP, react, resenha, IRL, história pessoal) | `cortes-video` | `cheia` (só o vídeo da live em 9:16, **sem B-roll**) |

Todo corte leva o campo **`sobre_gta6`** (`true` | `false`): a fala do trecho é especificamente sobre GTA 6? Ele decide o B-roll e as hashtags; o `plano.mjs` recusa o plano sem ele. Em corte `gameplay` o layout não muda (a tela da live aparece embaixo), mas o campo vale para as hashtags. React com o vídeo assistido na tela: classifique como `gameplay` (câmera em cima, a tela embaixo) para não perder o que está sendo reagido.

Use o `trechos.json`; em dúvida, extraia um quadro do meio do trecho e olhe. Vlog/IRL só entra no **modo aquecimento** (item da fila com `"aquecimento": true`, até 18/11/2026), como `papo` com `"sobre_gta6": false`. No aquecimento vale o momento viral de qualquer assunto: nas notas, leia "GTA 6" como "o assunto do corte".

## 3. Nota de viralidade (0–100)

Leia primeiro os blocos com 🔥 e 🔊 (`~/.maquina-cortes-gta/docs/ganchos.md`):

| Critério | Peso | Sinais |
|---|---|---|
| Pico emocional | 25 | 🔊 com fala (grito, risada, susto), chat acelerando |
| Tensão com desfecho | 20 | pergunta ou aposta que se resolve dentro da janela |
| Valor de busca | 20 | termo buscável: lugar de Leonida, Vice City, Jason/Lucia, missão, bug, final, segredo |
| Potencial de debate | 15 | opinião forte, divergência com o chat, comparação com GTA 5/RDR2 |
| Gancho na 1ª frase | 10 | a fala que abre o corte já prende sozinha (sem narração para salvar um começo morno) |
| Autonomia | 10 | entende-se sem o resto da live |

Separadamente, a **nota do gancho (0–10)** do `ganchos.md` → `edicao.nota`.

**Descarte** se: nota < 70; gancho < 6; sem desfecho; **música licenciada audível** (rádio do jogo, música de fundo: o motor não separa a trilha); vazamento ou build não oficial; spoiler sem aviso; ofensa ou exposição de terceiros.

**Meta: 3 TikToks por dia** (12:00, 18:00 e 21:00 BRT). Por live, entregue **até 4 candidatos** ranqueados pela nota, sem sobreposição e com `assunto` diferentes; o pipeline junta as lives do dia, publica os 3 melhores e guarda o resto como reserva para os dias seguintes. Ids: `tt-01-<assunto-curto>`, `tt-02-…`.

## 4. Duração (crítica para monetizar)

- **Final: 62–85 s.** Abaixo de 61 s o vídeo não entra no Creator Rewards.
- O `build.mjs` tira as pausas, então o final sai menor que a janela (`end − start`). Razão final ÷ bruta medida na calibração (vídeo editado, poucas pausas): **0,91–0,98**. Live crua tem mais pausas: conte com **~0,85**.
- **Janela bruta:** mire em ~74 s finais → **live crua: 84–92 s**; vídeo editado: 76–82 s. Aceito pelo validador: 64–100 s.
- Termine sempre num fim de frase (payoff). O pipeline confere a duração real depois do render (`conferir.mjs`) e manda ajustar `end` se precisar.

## 5. Hook visual

- **`titulo_topo_tela`**: frase de **até 6 palavras**, fixa no topo nos **primeiros 4 s**, entrando com som de impacto + whoosh. Ela não repete a primeira fala: completa ou provoca ("GASOLINA VAI ACABAR NO GTA 6?", "NEM O DIRETOR ESPERAVA ISSO"). Com a palavra-chave quando couber.
- O corte **começa na frase de gancho do streamer** (`edicao.hook`): sem narração, os primeiros 2 s de fala precisam prender sozinhos.
- O fim fecha o assunto; se a última frase puxar comentário ("e vocês, o que acham?"), melhor.
- `contem_spoiler: true` → o título de topo começa com "SPOILER:".

## 6. Bloco `edicao` (contrato do motor)

É **um clipe do `cuts.json`** do `~/.maquina-cortes-gta/engine/scripts/build.mjs`, sem enquadramento:
- `id` (igual ao do corte), `layout`, `start`, `end` (segundos da origem; `start` ~0,2 s antes da 1ª palavra), `assunto`, `hook` (a frase do streamer que abre), `nota` (0–10), **`titulo`** (igual a `titulo_topo_tela`);
- `keywords`: 2–5, exatamente como aparecem na fala;
- `turns`: 3–5 segundos da origem (virada de assunto, grito, momento marcante): entram flash e swoosh;
- **não** preencha `crop`, `gameCrop`, `focus`, `semCamera`, `captionY`, `broll`, `tituloSfx`: enquadramento é da skill de edição; o fundo de gameplay e os sons do título, do pipeline.

## 7. Metadados

- `titulo_seo` (vira a legenda): até 90 caracteres, palavra-chave no começo + gancho.
- `hashtags`: 3–5. Com `"sobre_gta6": true`: fixas `#gta6` `#gtavi`; mais 1 de tema (`#leonida`, `#vicecity`, `#bugsgta6`) e 1 de formato (`#cortes`). Com `"sobre_gta6": false`: **sem** `#gta6`/`#gtavi` (o `plano.mjs` recusa); use o tema real (`#gtarp`, `#react`, `#resenha`, o jogo da live) e `#cortes`. A do streamer o publicador põe.
- `palavra_chave_busca`: o termo que aparece no título de topo, no título e na fala.

## 8. Conformidade

1. `autorizacao: nao_verificado` → leia `modo_revisao_manual` em `../../pipeline.config.json`: `false` → `bloqueado_publicacao: true`; `true` → `false`, e o pipeline exige OK manual item a item.
2. Sem narração, a transformação vem do título de topo, do fundo de gameplay, dos cortes de pausa, do zoom e da legenda. Prefira trechos com **opinião ou reação do streamer** (mais originais) a trechos que só repetem informação.
3. Nada de vazamento, build não oficial ou material sob embargo.
4. Sem dueto/costura; não reenviar corte já postado por outro canal.

## 9. Saída: `work/plano-tiktok.json`

```json
{
  "live_id": "slug-da-live",
  "streamer": "slug-do-streamer",
  "autorizacao": "autorizado",
  "cortes": [
    {
      "id": "tt-01-predio-secreto",
      "plataforma": "tiktok",
      "tipo": "gameplay",
      "skill_edicao": "cortes-gameplay",
      "timestamp_inicio": "01:28:41.0",
      "timestamp_fim": "01:30:06.0",
      "duracao_alvo_s": [62, 85],
      "nota_viralidade": 86,
      "notas_por_criterio": {"pico_emocional": 22, "tensao_desfecho": 18, "valor_busca": 16, "debate": 12, "gancho_1a_frase": 9, "autonomia": 9},
      "categoria": "descoberta_mapa",
      "titulo_topo_tela": "PRÉDIO SECRETO EM VICE CITY?",
      "titulo_seo": "GTA 6: o prédio secreto de Vice City que ninguém tinha visto",
      "hashtags": ["#gta6", "#gtavi", "#vicecity", "#cortes"],
      "palavra_chave_busca": "gta 6 vice city segredo",
      "contem_spoiler": false,
      "riscos": [],
      "bloqueado_publicacao": false,
      "edicao": {
        "id": "tt-01-predio-secreto",
        "layout": "gameplay",
        "start": 5321.0,
        "end": 5406.0,
        "assunto": "prédio secreto",
        "hook": "Mano, que prédio é esse aqui?",
        "nota": 8,
        "titulo": "PRÉDIO SECRETO EM VICE CITY?",
        "keywords": ["prédio", "Vice City"],
        "turns": [5345.0, 5362.0, 5380.5]
      }
    }
  ]
}
```

`categoria`: `descoberta_mapa` | `bug` | `reacao_historia` | `teoria` | `debate`. `riscos`: lista livre (`spoiler`, `palavrao`, `violencia_grafica`…); `musica_licenciada` nunca entra no plano: o corte é descartado.

Depois de gravar, valide e corrija até passar:

```bash
node ../../.claude/skills/pipeline-diario-gta6/scripts/plano.mjs validar work/plano-tiktok.json
```
