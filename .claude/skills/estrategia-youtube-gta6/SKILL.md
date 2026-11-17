---
name: estrategia-youtube-gta6
description: Analisa a transcrição de uma live sobre GTA 6 e devolve o plano para o YouTube (pt-BR): Shorts de 35–58 s finais com título de topo (hook visual) no formato do cuts.json do motor de cortes, e segmentos para o banco do compilado 16:9 de 8–12 min, com SEO e checagem de conteúdo reutilizado. Use quando o pipeline-diario-gta6 pedir o plano do YouTube ou o usuário pedir Shorts/compilado de GTA 6 para o YouTube. Não renderiza nada.
---

# estrategia-youtube-gta6

Você lê uma live já transcrita e grava **`work/plano-youtube.json`** com duas saídas: **Shorts** (editados por `cortes-gameplay`/`cortes-papo`) e **segmentos de compilado** (guardados num banco e montados pelo `pipeline-diario-gta6`). Não há narração. Não escreva o plano no chat.

Papel de cada formato: **Shorts trazem inscritos** (Shorts não contam para as 4.000 horas); **compilados trazem horas assistidas**.

## 1. Entrada

A mesma da `estrategia-tiktok-gta6` (seção 1). Se o `plano-tiktok.json` desta live já existir, leia: um Short pode sair do mesmo momento de um TikTok, mas com janela e título de topo próprios.

## 2. Classificar (define a skill de edição)

Igual ao TikTok (seção 2 de lá, incluindo o campo obrigatório **`sobre_gta6`** e o modo aquecimento): `gameplay` (jogo ativo na tela) → `cortes-gameplay`, `edicao.layout: "gameplay"`; `papo` sobre GTA 6 (reação a trailer, debate, teoria, sem jogo controlado) → `cortes-papo`, `edicao.layout: "papo"`; `papo` sobre outro assunto (`"sobre_gta6": false`) → `cortes-video`, `edicao.layout: "cheia"`, sem B-roll. Segmento de compilado: só de trecho com `"sobre_gta6": true`.

## 3. Notas (0–100)

| Critério | Peso Short | Peso segmento | Sinais |
|---|---|---|---|
| Impacto no 1º segundo | 25 | 5 | o primeiro quadro e a primeira frase já prendem |
| Pico emocional | 20 | 15 | 🔊 com fala, chat acelerando |
| Valor de busca | 15 | 25 | lugar, missão, personagem, segredo, "como fazer" |
| Potencial de loop | 15 | 0 | o fim conversa com o começo |
| Opinião do streamer | 10 | 30 | ele analisa, compara, discorda (é o que sustenta o vídeo sem narração) |
| Encaixe em uma tese | 0 | 15 | serve a um tema de compilado com outros momentos |
| Autonomia | 15 | 10 | entende-se sem o resto da live |

Short: nota ≥ 75 e gancho (`ganchos.md`) ≥ 6. Segmento: nota ≥ 65. Descartes iguais aos do TikTok, com peso maior aqui: **música licenciada audível** (Content ID bloqueia) e violência gráfica no começo.

**Modo `crescimento` (`R/pipeline.config.json` → `"modo"`, o atual):** não grave `shorts`. Todo corte já sai no YouTube Shorts pela publicação dupla do plano da `estrategia-tiktok-gta6` (seção 0 de lá). Aqui, só os `segmentos_para_compilado`. No modo `monetizacao`, siga a seção 4 normalmente.

**Meta: 3 Shorts por dia** (12:00, 18:00 e 21:00 BRT), além do compilado 16:9 (20:00) quando houver material. Por live, entregue **até 4 Shorts** candidatos e até 5 segmentos; o pipeline publica os 3 melhores Shorts do dia e guarda o resto como reserva. Ids: `yt-01-<assunto>`; segmentos `seg-<slug-da-live>-01`.

## 4. Shorts (35–58 s finais)

- **Janela bruta:** razão final ÷ bruta ~0,85 em live crua (0,93–0,97 em vídeo editado). Mire em ~48 s finais → **live crua: 54–60 s**; vídeo editado: 50–54 s. Aceito: 36–68 s.
- **Começo:** o motor não reordena; o `start` cai na frase/quadro que já prende.
- **`titulo_topo_tela`**: até 6 palavras, primeiros 4 s, com impacto + whoosh (mesmas regras do TikTok, seção 5).
- **Loop:** prefira terminar numa frase que conversa com o começo.
- Bloco `edicao` idêntico ao do TikTok (seção 6 da `estrategia-tiktok-gta6`), com `titulo` = `titulo_topo_tela`.
- **Metadados:** `titulo_seo` até 60 caracteres com a palavra-chave no começo; `hashtags` exatamente 3: `#gta6`, 1 temática e `#shorts` (com `"sobre_gta6": false`: 2 do tema real, sem `#gta6`, e `#shorts`).

## 5. Segmentos de compilado

Cada segmento é um trecho de **60–90 s** (sem narração, o compilado precisa de trechos maiores para chegar a 8 min) em que o streamer **explica ou opina**. Para cada um:
- `capitulo`: título do capítulo (cartão e capítulo do YouTube), até 6 palavras;
- `contexto`: **uma linha** de texto (até ~90 caracteres) que aparece no cartão de 2 s antes do trecho: o que está em jogo;
- `teses`: 1–3 de uma lista estável: `segredos-leonida`, `bugs-engracados`, `reacoes-historia`, `teorias-comunidade`, `comparacao-gta5`, `missoes-dificeis`, `easter-eggs` (crie outra só se nenhuma servir).

O compilado usa o vídeo **16:9 original** da live, então não há bloco `edicao`.

## 6. Compilado (o que o pipeline monta)

- **6–9 segmentos** de uma tese, de preferência de **lives e streamers diferentes**; 8–12 min no total.
- Cartão de título → abertura (~8–10 s do 2º melhor momento) → [cartão de 2 s → trecho] × N → cartão de fechamento com pergunta para os comentários. Ordem do forte para o mais forte.
- Título até 65 caracteres com palavra-chave, número e promessa; texto da thumb até 3 palavras; descrição com a palavra-chave nas 2 primeiras linhas, capítulos e crédito + link de cada live.

## 7. Conformidade

1. **Conteúdo reutilizado:** sem narração, o risco no pedido do YPP é maior. Compense com curadoria (tese clara, trechos de streamers diferentes, cartões de contexto) e prefira trechos de opinião a trechos que só mostram imagens oficiais do jogo.
2. **Conteúdo inautêntico/em massa:** varie título de topo, layout e ordem; todo vídeo passa por revisão humana (a tabela de aprovação).
3. **Direitos:** `nao_verificado` (inclui `pendente`) → mesma regra do TikTok (`modo_revisao_manual`). Crédito e link sempre.
4. **Content ID:** sem música licenciada audível; sem trailer oficial da Rockstar além de trechos curtos.
5. **Spoilers:** "SPOILER:" no título de topo; nunca no título ou na thumb.
6. **Anunciantes:** sem palavrão no título, na thumb e nos 7 primeiros segundos; sem violência gráfica nos primeiros 30 s do compilado.

## 8. Saída: `work/plano-youtube.json`

```json
{
  "live_id": "slug-da-live",
  "streamer": "slug-do-streamer",
  "streamer_nome": "Nome do Streamer",
  "autorizacao": "autorizado",
  "fonte_16x9": "/abs/cortes/slug-da-live/work/source.mp4",
  "shorts": [
    {
      "id": "yt-01-bug-da-moto",
      "plataforma": "youtube_short",
      "tipo": "gameplay",
      "skill_edicao": "cortes-gameplay",
      "timestamp_inicio": "02:10:05.0",
      "timestamp_fim": "02:11:02.0",
      "duracao_alvo_s": [35, 58],
      "nota_viralidade": 88,
      "categoria": "bug",
      "titulo_topo_tela": "A MOTO FOI PRO CÉU",
      "titulo_seo": "GTA 6: o bug que lançou a moto pro céu",
      "hashtags": ["#gta6", "#bugsgta6", "#shorts"],
      "palavra_chave_busca": "gta 6 bug",
      "contem_spoiler": false,
      "riscos": [],
      "bloqueado_publicacao": false,
      "edicao": {
        "id": "yt-01-bug-da-moto",
        "layout": "gameplay",
        "start": 7805.0,
        "end": 7862.0,
        "assunto": "bug da moto",
        "hook": "Não, não, não, olha isso!",
        "nota": 8,
        "titulo": "A MOTO FOI PRO CÉU",
        "keywords": ["moto", "céu"],
        "turns": [7820.0, 7835.0, 7848.0]
      }
    }
  ],
  "segmentos_para_compilado": [
    {
      "id": "seg-slug-da-live-01",
      "timestamp_inicio": "00:45:12.0",
      "timestamp_fim": "00:46:22.0",
      "start": 2712.0,
      "end": 2782.0,
      "nota_viralidade": 79,
      "capitulo": "O prédio que ninguém achou",
      "contexto": "Ele jura que esse prédio não aparece em nenhum trailer",
      "teses": ["segredos-leonida", "easter-eggs"],
      "palavra_chave_busca": "gta 6 segredos",
      "contem_spoiler": false,
      "riscos": [],
      "bloqueado_publicacao": false
    }
  ],
  "compilado_sugerido": {
    "tese": "segredos-leonida",
    "titulo_seo": "GTA 6: 7 segredos de Leonida que os streamers acharam",
    "texto_thumb": "ninguém viu isso",
    "hashtags": ["#gta6", "#leonida", "#gtavi"]
  }
}
```

Depois de gravar, valide os Shorts e corrija até passar:

```bash
node ../../.claude/skills/pipeline-diario-gta6/scripts/plano.mjs validar work/plano-youtube.json
```
