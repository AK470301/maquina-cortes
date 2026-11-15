---
name: cortes-video
description: Corta vídeos em que a cena é o conteúdo (vlog, desafio, IRL, viagem, pegadinha, documentário) em vários Shorts, Reels ou TikToks verticais em tela cheia, com o recorte seguindo a pessoa e legenda animada na paleta do criador. Use quando o usuário pedir cortes, shorts ou clipes de um vlog, desafio, IRL ou vídeo de ação. Para podcast ou react, use cortes-papo; para gameplay, cortes-gameplay.
allowed-tools: Bash(node:*), Bash(yt-dlp:*), Bash(ffmpeg:*), Bash(ffprobe:*)
---

# cortes-video

Você recebe um vídeo longo em que **a cena é o conteúdo** (vlog, desafio, IRL) e entrega **vários cortes prontos** em 9:16, em **tela cheia**: o vídeo ocupa a tela toda, recortado seguindo a pessoa ou a ação, só com legenda. A edição é feita em Remotion e a transcrição roda localmente com whisper.cpp.

**Escopo.** Só trechos do tipo **video**: ação, deslocamento, desafio, reação no mundo real, várias pessoas em cena. Há outras duas skills que usam o mesmo motor:
- **`cortes-papo`:** gente sentada conversando para a câmera (podcast, react);
- **`cortes-gameplay`:** tela de jogo com webcam.

Se o vídeo inteiro for de outro tipo, acione a skill certa e continue de lá (a pasta `work/` é a mesma). Se for misto, corte só os trechos de vídeo e cite os outros no fim.

Escreva pouco no chat: nunca despeje a transcrição nem JSON inteiro.

## 0. Conferir a instalação

```bash
node ~/.maquina-cortes-gta/setup.mjs --check
```

Se o arquivo não existir (motor não instalado), rode `node "<skill>/../../instalador/setup.mjs"` (esse caminho existe quando as skills foram instaladas como plugin). Se ele não existir, peça para o usuário rodar `bash instalador/install.sh` (ou `instalador\install.ps1` no Windows) da pasta do repositório. A instalação leva alguns minutos e baixa arquivos grandes: avise antes.

## 1–5. Preparar o vídeo

Siga `~/.maquina-cortes-gta/docs/preparacao.md`: campos do `--check` e opcionais, marca d'água na primeira vez, vídeo + criador + paleta, download em `./cortes/<slug-do-video>/work/`, transcrição e mapa visual (`trechos.json`; aqui, intervalo de 60 s).

Só na tela cheia:
- **Resolução:** prefira 1080p ou mais. A tela cheia amplia o recorte central (de um quadro 1920×1080 sobra uma faixa de ~608×1080), e em 720p fica borrado.
- Proponha cortes **só dos trechos `video`**. Se o vídeo for de outro tipo, encaminhe como diz o guia (seção 6).

## 6. Escolher os cortes candidatos

Siga `~/.maquina-cortes-gta/docs/ganchos.md`, inclusive a seção **"Ganchos de ação"**:
- **Sinais:** 🔥 (mais reproduzido) e 🔊 (empolgação) pesam igual. Leia primeiro os blocos em volta deles.
- **Gancho de ação:** o gancho pode ser uma frase ou uma cena (o helicóptero pousando, a perseguição). Os primeiros 3 s precisam mostrar **o que está em jogo**.
- **Quantidade e duração:** de 3 a 5 cortes (2 em vídeo com menos de 5 min), de 20 a 60 s, com assuntos e ganchos diferentes e sem sobreposição.
- **Fim:** logo depois do payoff ou da reação.
- **Palavras-chave:** de 2 a 5 por corte (números, nomes, a palavra forte do gancho).

## 7. Aprovar com o usuário

| # | Trecho | Assunto | Gancho | Nota | Sinais |
|---|---|---|---|---|---|

Não renderize sem o OK, a menos que o usuário tenha dispensado a aprovação.

## 8. Enquadrar seguindo a pessoa (`focusTrack`)

Para cada corte aprovado:
1. Monte uma folha de contato só do trecho, **com linhas-guia**: `node ~/.maquina-cortes-gta/engine/scripts/mapa-visual.mjs work/source.mp4 work/foco-01 3 <start> <end> --guias`. Isso dá uma miniatura a cada 3 s, com o minuto de cada uma. Cada miniatura ganha linhas verticais a 25% (amarela), 50% (vermelha) e 75% (amarela) da largura.
2. Olhe as miniaturas e anote, para cada uma, a posição horizontal *p* (em %, usando as linhas-guia) do **centro da ação**: o rosto de quem fala, a pessoa em movimento, o objeto do gancho. **Converta para o foco:** `x = (p − 15,8) / 0,684`, limitado a 0–100. Por exemplo, p = 25 dá x = 13, p = 50 dá x = 50 e p = 75 dá x = 87. Não use *p* direto como `x`: isso desloca o recorte, e o rosto vai para a borda.
3. Grave no corte `"focusTrack": [{"at": <segundo da origem>, "x": 50, "y": 40}, ...]`, um ponto por miniatura (`at` = o minuto dela menos ~1,5 s), juntando as seguidas com o mesmo `x`.

Regras:
- O `build.mjs` aplica a cada plano o ponto mais recente antes do início dele. A troca cai sempre num jump cut, então não aparece pulando.
- `x` decide o que fica visível na faixa central; `y` só importa em vídeo mais vertical que 9:16 (raro).
- **Duas pessoas conversando lado a lado:** foque em quem está falando naquele trecho (olhe a transcrição).
- **Plano aberto** (paisagem, várias pessoas espalhadas): mantenha `x: 50`.

Veja `references/enquadramento-tela-cheia.md`.

## 9. Montar o `cuts.json` e renderizar

```json
{
  "layout": "cheia",
  "streamer": "slug-do-criador",
  "clips": [
    {
      "id": "01-o-helicoptero",
      "start": 0.0,
      "end": 47.5,
      "assunto": "a aposta",
      "hook": "Esse helicóptero está trazendo o esquadrão militar…",
      "nota": 8,
      "keywords": ["helicóptero", "100 mil"],
      "focusTrack": [{"at": 0, "x": 35, "y": 40}, {"at": 9.5, "x": 50, "y": 45}],
      "turns": [21.0]
    }
  ]
}
```

```bash
node ~/.maquina-cortes-gta/engine/scripts/build.mjs work .
```

`turns`, `images` (popups no meio da tela) e efeitos sonoros funcionam como em `~/.maquina-cortes-gta/docs/efeitos-e-imagens.md`.

Depois do render, **confira 2 ou 3 quadros de cada corte** (`ffmpeg -ss <s> -i 01-....mp4 -frames:v 1 quadro.jpg`). Se a pessoa saiu do quadro, ajuste o `focusTrack` no `cuts.json` e renderize só esse corte de novo: `build.mjs work . --so <id>`.

## 10. Entregar

Responda curto:
- os arquivos;
- uma tabela com **assunto, gancho, duração, nota e sinais**;
- um **título curto sugerido** por corte;
- se houver trechos de outro tipo no `trechos.json`, uma linha citando-os com a skill certa.

## 11. Publicar (opcional, só se o usuário pedir)

Siga `~/.maquina-cortes-gta/docs/publicacao.md`:
1. `node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs status`. Se uma conta não estiver conectada, peça para o usuário rodar o `conectar` ele mesmo (com `!`).
2. Rode `publicar.mjs horarios <n>` para pegar os próximos horários livres, escreva `work/publicacao.json` (título, descrição e hashtags a partir do gancho; capa; um horário por corte; `"modo": "manual"` nas plataformas sem API) e rode `enviar ... --teste`.
3. Mostre a tabela (corte, plataforma, título/legenda, quando, ação) e **só publique com o OK explícito do usuário**.
4. Rode `enviar` (YouTube e o que tiver API) e `kit` (o que for manual), e entregue os links, o estado de cada envio e as pastas do kit.

## Regras

- Só trechos de vídeo/ação; papo e gameplay são das outras skills.
- Layout: o vídeo em tela cheia seguindo a pessoa, a legenda no terço inferior, na paleta do criador.
- Nunca publique sem o OK do usuário na tabela de publicação.
- Nunca renderize sem aprovação, a menos que ela tenha sido dispensada.
- Se algo falhar, veja `~/.maquina-cortes-gta/docs/problemas.md`.
