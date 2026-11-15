---
name: cortes-gameplay
description: Corta lives e vídeos de gameplay (qualquer jogo, com ou sem webcam) em vários Shorts, Reels ou TikToks verticais: webcam em cima, jogo embaixo, legenda animada na paleta do streamer. Use quando o usuário pedir cortes, shorts ou clipes de uma live de jogo, de jogadas, clutch, rage, sustos, reações durante a partida ou momentos engraçados no jogo. Para podcast ou react sem jogo na tela, use cortes-papo; para vlog ou desafio, cortes-video.
allowed-tools: Bash(node:*), Bash(yt-dlp:*), Bash(ffmpeg:*), Bash(ffprobe:*)
---

# cortes-gameplay

Você recebe uma live ou um vídeo de **gameplay** e entrega **vários cortes prontos** em 9:16:
- a **webcam** do streamer em cima, apertada no rosto e na reação;
- o **jogo do mesmo momento** embaixo, recortado no foco da ação;
- a legenda na divisa.

Sem webcam, o jogo ocupa a tela toda. A edição é feita em Remotion e a transcrição roda localmente com whisper.cpp.

**Escopo.** Só trechos de **gameplay**: jogadas, reações durante a partida, momentos engraçados no jogo. Há outras duas skills que usam o mesmo motor:
- **`cortes-papo`:** conversa sem jogo na tela;
- **`cortes-video`:** vlog, desafio ou IRL.

Se o vídeo inteiro for de outro tipo, acione a skill certa e continue de lá (a pasta `work/` é a mesma). Se a live for mista, corte só os trechos de gameplay e cite os outros no fim.

Escreva pouco no chat: nunca despeje a transcrição nem JSON inteiro.

## 0. Conferir a instalação

```bash
node ~/.maquina-cortes-gta/setup.mjs --check
```

Se o arquivo não existir (motor não instalado), rode `node "<skill>/../../instalador/setup.mjs"` (esse caminho existe quando as skills foram instaladas como plugin). Se ele não existir, peça para o usuário rodar `bash instalador/install.sh` (ou `instalador\install.ps1` no Windows) da pasta do repositório. A instalação leva alguns minutos e baixa arquivos grandes: avise antes.

## 1–5. Preparar a live

Siga `~/.maquina-cortes-gta/docs/preparacao.md`: campos do `--check` e opcionais, marca d'água na primeira vez, live + streamer + paleta, download em `./cortes/<slug-do-video>/work/`, transcrição e mapa visual (`trechos.json`).

Só no gameplay:
- **Não há vídeo de baixo:** o jogo vem da própria live.
- **Resolução:** prefira 1080p ou mais. A webcam costuma ser pequena e é ampliada várias vezes.
- **Live de muitas horas:** para testar rápido, transcreva só um pedaço (4º argumento do `transcribe.mjs`).
- **Som do jogo:** música e efeitos do jogo podem gerar 🔊 falsos e esconder as pausas. Confira se há fala no trecho e veja `~/.maquina-cortes-gta/docs/problemas.md`.
- **No mapa visual, anote onde fica a webcam.** Ela costuma ficar no mesmo lugar a live inteira, mas confira se o layout da live muda (tela de espera, "só câmera", outro jogo).
- Proponha cortes **só dos trechos `gameplay`**. Se o vídeo for de outro tipo, encaminhe como diz o guia (seção 6).

## 6. Escolher os cortes candidatos

Siga `~/.maquina-cortes-gta/docs/ganchos.md`, inclusive **"Ganchos de ação"**:
- **🔊 pesa mais aqui:** grito, risada e susto costumam ser o melhor corte de gameplay. Comece pelos 🔊 e depois veja os 🔥.
- **O começo** é a **preparação da jogada**: a frase ou o momento que mostra o que está em jogo ("se eu passar daqui…", o chefe aparecendo).
- **O fim** vem logo depois da **reação**.
- **Se entende sozinho:** quem nunca jogou entende o que aconteceu? Se precisar de contexto, a fala do streamer tem que dar esse contexto.
- **Quantidade e duração:** de 3 a 5 cortes, de 15 a 60 s (jogada rápida pode ter 15 s), com momentos diferentes e sem sobreposição.
- **Palavras-chave:** de 2 a 5 por corte (o nome do chefe, o número, a palavra do grito).

## 7. Aprovar com o usuário

| # | Trecho | Momento | Gancho (fala ou cena) | Nota | Sinais |
|---|---|---|---|---|---|

Não renderize sem o OK, a menos que o usuário tenha dispensado a aprovação.

## 8. Enquadrar a webcam e o jogo

Para cada corte, extraia 2 ou 3 quadros do trecho em tamanho real (não use miniaturas para medir pixels) (`ffmpeg -ss <s> -i work/source.mp4 -frames:v 1 work/q-01-a.jpg`), olhe e defina, **em pixels do vídeo de origem** (veja `meta.json` para largura e altura):
- **`crop`:** o retângulo da **webcam**, apertado no rosto e nos ombros, sem a borda ou moldura do overlay, na proporção **~1,48:1** (1080×730). Se a webcam tiver outra proporção, aperte no rosto: o motor amplia até cobrir a área.
- **`gameCrop`:** o **foco da ação** no jogo, na proporção **~0,91:1** (1080×1190), por exemplo 984×1080 num quadro 1920×1080. **Não inclua a webcam nem os overlays** (chat, alertas, metas). Exemplos por gênero estão em `references/enquadramento-gameplay.md`.
- **Todo corte com webcam precisa de `crop`.** Sem ele, o motor põe o jogo em tela cheia (e avisa no render).
- **Sem webcam** (ou webcam escondida no trecho): `"semCamera": true` e um `gameCrop` em **9:16** (por exemplo 608×1080). O jogo ocupa a tela e a legenda vai para o terço inferior.
- Se a legenda na divisa cobrir algo importante (mira, barra de vida), use `"captionY"` (centro da legenda, em px, por exemplo 1700).

## 9. Montar o `cuts.json` e renderizar

```json
{
  "layout": "gameplay",
  "streamer": "slug-do-streamer",
  "clips": [
    {
      "id": "01-o-chefe-final",
      "start": 5321.0,
      "end": 5358.5,
      "assunto": "o chefe final",
      "hook": "Se eu errar esse pulo eu perco duas horas.",
      "nota": 9,
      "crop": {"x": 1480, "y": 760, "w": 400, "h": 270},
      "gameCrop": {"x": 468, "y": 0, "w": 984, "h": 1080},
      "keywords": ["duas horas", "pulo"],
      "turns": [5349.2]
    }
  ]
}
```

```bash
node ~/.maquina-cortes-gta/engine/scripts/build.mjs work .
```

- **`turns`:** o momento da jogada e o do grito (de 3 a 5 por corte). Neles entram flash e swoosh.
- **`images` e efeitos sonoros:** como em `~/.maquina-cortes-gta/docs/efeitos-e-imagens.md`. Em gameplay, use popups raramente: o jogo já é a imagem.
- **Depois do render**, confira 2 quadros de cada corte. Se a webcam ou a ação saiu do quadro, ajuste o corte no `cuts.json` e renderize só ele de novo: `build.mjs work . --so <id>`.

## 10. Entregar

Responda curto:
- os arquivos;
- uma tabela com **momento, gancho, duração, nota e sinais**;
- um **título curto sugerido** por corte;
- se houver trechos de outro tipo no `trechos.json`, uma linha citando-os com a skill certa.

## 11. Publicar (opcional, só se o usuário pedir)

Siga `~/.maquina-cortes-gta/docs/publicacao.md`:
1. `node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs status`. Se uma conta não estiver conectada, peça para o usuário rodar o `conectar` ele mesmo (com `!`).
2. Rode `publicar.mjs horarios <n>` para pegar os próximos horários livres, escreva `work/publicacao.json` (título, descrição e hashtags a partir do gancho; capa; um horário por corte; `"modo": "manual"` nas plataformas sem API) e rode `enviar ... --teste`.
3. Mostre a tabela (corte, plataforma, título/legenda, quando, ação) e **só publique com o OK explícito do usuário**.
4. Rode `enviar` (YouTube e o que tiver API) e `kit` (o que for manual), e entregue os links, o estado de cada envio e as pastas do kit.

## Regras

- Só trechos de gameplay; papo e tela cheia são das outras skills.
- Layout: webcam em cima (~38%), jogo embaixo (~62%), legenda na divisa, na paleta do streamer. Sem webcam, o jogo fica em tela cheia.
- Nunca publique sem o OK do usuário na tabela de publicação.
- Nunca renderize sem aprovação, a menos que ela tenha sido dispensada.
- Se algo falhar, veja `~/.maquina-cortes-gta/docs/problemas.md`.
