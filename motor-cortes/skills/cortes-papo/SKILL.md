---
name: cortes-papo
description: Corta vídeos e lives de conversa (podcast, react, opinião, notícia, debate, entrevista) em vários Shorts, Reels ou TikToks verticais, com legenda animada na paleta do streamer, gameplay de fundo na metade de baixo e pausas cortadas. Use quando o usuário pedir cortes, shorts, clipes, reels ou vídeo vertical a partir de um link ou arquivo, inclusive quando ele não disser o tipo do vídeo (a skill identifica o tipo e encaminha). Para trechos com jogo na tela, use cortes-gameplay; para vlog, desafio ou IRL, use cortes-video.
allowed-tools: Bash(node:*), Bash(yt-dlp:*), Bash(ffmpeg:*), Bash(ffprobe:*)
---

# cortes-papo

Você recebe um vídeo longo ou uma live de **conversa** e entrega **vários cortes prontos** em 9:16, cada um sobre um assunto diferente. Você escolhe o gancho de cada corte a partir da transcrição e de dois sinais extras, o trecho mais reproduzido e os picos de empolgação. O usuário aprova a lista antes do render. A edição é feita em Remotion e a transcrição roda localmente com whisper.cpp.

**Escopo.** Só trechos de **papo**: opinião, histórias, debates, notícias, explicações, sem jogo ativo na tela. Há outras duas skills que usam o mesmo motor:
- **`cortes-gameplay`:** trechos com a tela de um jogo e a webcam;
- **`cortes-video`:** vídeo em que a cena é o conteúdo (vlog, desafio, IRL).

Se o vídeo inteiro for de outro tipo, acione a skill certa e continue de lá (a pasta `work/` é a mesma). Se ele for misto, corte só os trechos de papo e cite os outros no fim.

Escreva pouco no chat: nunca despeje a transcrição nem JSON inteiro. Mostre só o que o usuário precisa decidir ou receber.

`<skill>` = a pasta onde este SKILL.md está. `~/.maquina-cortes-gta` = pasta de dados comum às três skills (motor, whisper, paletas, guias em `docs/`).

## 0. Conferir a instalação

```bash
node ~/.maquina-cortes-gta/setup.mjs --check
```

Se o arquivo não existir, ou der `engine: false`, `whisperModel: false` ou faltar `~/.maquina-cortes-gta/docs/`, rode `node "<skill>/../../instalador/setup.mjs"` (esse caminho existe quando as skills foram instaladas como plugin). Se ele não existir, peça para o usuário rodar `bash instalador/install.sh` (ou `instalador\install.ps1` no Windows) da pasta do repositório. A instalação põe o Remotion e o whisper.cpp, leva alguns minutos e baixa arquivos grandes: avise o usuário antes.

## 1–5. Preparar o vídeo

Siga `~/.maquina-cortes-gta/docs/preparacao.md`: campos do `--check` e opcionais, marca d'água na primeira vez, vídeo + streamer + paleta, download em `./cortes/<slug-do-video>/work/`, transcrição e mapa visual (`trechos.json`).

Só no papo:
- **Metade de baixo = gameplay.** Ela vem do **`work/bottom.mp4`**, montado por sorteio de trechos de uma pasta de clipes de gameplay do jogo (veja o passo 8.1). Sem pasta e sem `bottom.mp4`, o fundo cai na câmera desfocada: avise o usuário, porque fica fraco.
- O usuário pode mandar junto vídeos ou imagens de apoio (opcional) para momentos pontuais (`broll` com `file`).
- Proponha cortes **só dos trechos `papo`**. Se o vídeo for de outro tipo, encaminhe como diz o guia (seção 6).

## 6. Escolher os cortes candidatos

Siga `~/.maquina-cortes-gta/docs/ganchos.md`. Resumo:
1. **Comece pelos sinais.** Leia primeiro os blocos em volta das marcas 🔥 e 🔊. Eles indicam onde olhar, mas o trecho ainda precisa de um gancho com nota ≥ 6.
2. **Mapeie os assuntos** e escolha **de 3 a 5 cortes** (2 se o vídeo tiver menos de 5 minutos), de **20 a 60 s**, cada um com assunto e gancho diferentes, sem sobreposição.
3. **Comece o corte na frase de gancho** (curiosidade, fato específico, conflito ou opinião forte) e **termine no payoff**.
4. Para cada corte, anote:
   - **palavras-chave:** de 2 a 5 (números, nomes, a palavra forte do gancho), exatamente como aparecem na fala.

## 7. Aprovar com o usuário (antes de renderizar)

| # | Trecho | Assunto | Gancho (a frase) | Nota | Sinais |
|---|---|---|---|---|---|
| 1 | 12:30–13:05 | inflação | "Em 2024 o preço do café dobrou." | 8 | 🔥🔊 |

Pergunte se aprova, se quer trocar algum ou se quer outros. Não renderize sem esse OK, a menos que o usuário tenha dispensado a aprovação.

## 8. Montar o `cuts.json`

1. **Fundo de gameplay:** monte o `work/bottom.mp4` sorteando trechos de 4–7 s (sem áudio) da pasta de clipes do jogo:
   `node ~/.maquina-cortes-gta/engine/scripts/montar-bottom.mjs <pasta-de-clipes> work` (o pipeline-diario-gta6 passa `assets/broll-gta6/`). Pasta vazia: mantém o `work/bottom.mp4` que existir; sem nenhum dos dois, a câmera desfocada fica no fundo (avise). Cada corte começa num ponto diferente do `bottom.mp4`. Extraia um quadro do `bottom.mp4` e confira. **Não use Pexels** nem trailers oficiais (Content ID). Arquivos do usuário para momentos pontuais continuam em `broll[].file`.
2. **Enquadramento de quem fala:** extraia um quadro do trecho e olhe. Ajuste `focus`, ou use `crop` com várias câmeras ou câmera pequena. Veja `references/layout-papo.md`.
3. Grave `work/cuts.json`:

```json
{
  "layout": "papo",
  "streamer": "slug-do-streamer",
  "clips": [
    {
      "id": "01-preco-do-cafe",
      "start": 750.2,
      "end": 785.0,
      "assunto": "inflação",
      "hook": "Em 2024 o preço do café dobrou.",
      "nota": 8,
      "focus": {"x": 50, "y": 35},
      "keywords": ["café", "dobrou", "2024"],
      "turns": [762.5, 774.0]
    }
  ]
}
```

- Os tempos (`start`, `end`, `broll[].at`, `turns`, `images[].at`) são **segundos do vídeo de origem**.
- **Ênfase:** ponha em `turns` os momentos 🔊 dentro do corte e as trocas de B-roll (de 3 a 5 por corte). Neles entram flash e swoosh.
- Ritmo, popups (`images`) e efeitos sonoros: `~/.maquina-cortes-gta/docs/efeitos-e-imagens.md`.

## 9. Renderizar

```bash
node ~/.maquina-cortes-gta/engine/scripts/build.mjs work .
```

Para cada corte, o `build.mjs`:
- tira as pausas;
- refaz as legendas na paleta do streamer;
- põe o gameplay do `bottom.mp4` na metade de baixo (e os `broll[].file`, se houver);
- renderiza `./01-....mp4` em 1080×1920 a 30 fps;
- padroniza o volume em −14 LUFS.

Se algum corte falhar, mostre o erro e renderize os outros. O primeiro render pode baixar o Chrome headless do Remotion. Para refazer só um corte depois de ajustar o `cuts.json`: `build.mjs work . --so <id>`.

## 10. Entregar

Responda curto:
- a lista dos arquivos;
- uma tabela com **assunto, gancho, duração, nota e sinais** de cada corte;
- um **título curto sugerido** por corte;
- se o `trechos.json` tiver trechos de outro tipo, uma linha como: "Há gameplay em 1:00:00–1:30:00 (use /cortes-gameplay)".

## 11. Publicar (opcional, só se o usuário pedir)

Siga `~/.maquina-cortes-gta/docs/publicacao.md`:
1. `node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs status`. Se uma conta não estiver conectada, peça para o usuário rodar o `conectar` ele mesmo (com `!`).
2. Rode `publicar.mjs horarios <n>` para pegar os próximos horários livres, escreva `work/publicacao.json` (título, descrição e hashtags a partir do gancho; capa; um horário por corte; `"modo": "manual"` nas plataformas sem API) e rode `enviar ... --teste`.
3. Mostre a tabela (corte, plataforma, título/legenda, quando, ação) e **só publique com o OK explícito do usuário**.
4. Rode `enviar` (YouTube e o que tiver API) e `kit` (o que for manual), e entregue os links, o estado de cada envio e as pastas do kit.

## Regras

- Só trechos de papo; gameplay e tela cheia são das outras skills.
- Layout: quem fala em cima (50%), gameplay embaixo (50%), legenda na divisa, na paleta do streamer. Detalhes em `references/layout-papo.md`; estilo comum em `~/.maquina-cortes-gta/docs/estilo-referencias.md`.
- Nunca publique sem o OK do usuário na tabela de publicação.
- Nunca renderize sem o usuário aprovar os candidatos, a menos que ele tenha dispensado a aprovação.
- Não peça a logo nem a paleta de novo depois da primeira vez.
- Cada vídeo tem a sua pasta. Não reaproveite `cuts.json` de outro vídeo; a transcrição e o `trechos.json` do mesmo vídeo, sim.
- Se algo falhar, veja `~/.maquina-cortes-gta/docs/problemas.md`.
