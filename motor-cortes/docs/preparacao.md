# Preparação (comum às três skills)

Vale para `cortes-papo`, `cortes-gameplay` e `cortes-video`: tudo o que vem antes de escolher os cortes. Cada skill diz, no seu SKILL.md, só o que muda para ela.

## 1. O `--check`

`node ~/.maquina-cortes-gta/setup.mjs --check` imprime um JSON. O que fazer com cada campo:

- **`engine: false` ou `whisperModel: false`:** rode `node "<skill>/../../instalador/setup.mjs"` (instalação como plugin) ou peça para o usuário rodar `bash instalador/install.sh` do repositório. A cópia em `~/.maquina-cortes-gta/setup.mjs` não instala o motor, só confere e configura. A instalação põe o Remotion e o whisper.cpp, leva alguns minutos e baixa arquivos grandes; avise o usuário antes.
- **`ffmpeg: false`:** peça para o usuário instalar o FFmpeg (o script mostra o comando para o sistema dele) e pare.
- **`ytdlp: false`:** só aceite arquivo de vídeo (não link) e diga como instalar o yt-dlp.
- **`ytdlpDesatualizado: true`:** avise que links do YouTube podem falhar e sugira atualizar (`yt-dlp -U` ou `pipx upgrade yt-dlp`). Siga assim mesmo.
- **Faltou algo opcional? Avise uma vez, em poucas linhas, com as opções**, sem parar o trabalho:
  - `pexelsKey: false` (só importa no layout papo): "Sem busca de B-roll no Pexels. Opções: (a) criar uma chave grátis em pexels.com/api e definir `PEXELS_API_KEY`; (b) mandar vídeos ou imagens de apoio; (c) seguir com imagens do Google ou só com a câmera desfocada embaixo."
  - `googleImagens: false`: "Sem busca de imagens no Google. Opções: (a) configurar `GOOGLE_API_KEY` e `GOOGLE_CSE_ID` (gratuito até 100 buscas por dia); (b) mandar as imagens; (c) seguir sem popups." Não raspe a página do Google (ele bloqueia com CAPTCHA).
  - `efeitosGerados: 0`: siga `efeitos-e-imagens.md` (efeitos da ElevenLabs só com o OK do usuário).
  - Depois da escolha do usuário, não pergunte de novo na mesma conversa.
- **Nunca peça nem escreva chaves de API no chat.** O usuário as define no ambiente.

## 2. Marca d'água (só na primeira vez)

Se `perfilConfigurado` for `false`, pergunte **numa única mensagem** se o usuário quer marca d'água. Se quiser, peça o nome do perfil e a logo (PNG ou JPG, de preferência quadrada).

- **Com marca:** `node ~/.maquina-cortes-gta/setup.mjs --profile "NOME" --logo "CAMINHO/DA/LOGO.png"`.
- **Sem marca:** `node ~/.maquina-cortes-gta/setup.mjs --sem-marca`.

**Nunca invente um nome ou uma logo de exemplo.** Depois disso não pergunte de novo, a menos que o usuário peça.

## 3. Vídeo, streamer e paleta

Peça o **vídeo de origem** (link ou arquivo) e **de quem é** (o streamer, o canal ou o criador), na mesma mensagem.

Se o slug dele (minúsculas, com hífen) não está em `streamers` no `--check`, monte a paleta uma vez, **depois de baixar o vídeo**:
1. Rode `node ~/.maquina-cortes-gta/engine/scripts/cores.mjs <logo ou work/source.mp4> [segundo]` e olhe também o quadro. Overlays de live costumam ter as cores da marca.
2. Proponha uma **cor base** para o texto (clara, em geral branco ou quase branco) e uma **cor de destaque** (forte, que se leia com contorno preto, por exemplo a cor principal da marca).
3. Com o OK do usuário, grave: `node ~/.maquina-cortes-gta/setup.mjs --streamer "slug" --nome "Nome" --cor-base "#FFFFFF" --cor-destaque "#RRGGBB"`.

## 4. Pasta de trabalho e download

Use `./cortes/<slug-do-video>/` na pasta atual e rode os comandos **de dentro dela**. Os arquivos de trabalho ficam em `work/`; os cortes prontos saem na própria pasta. **Se `work/source.mp4` já existir** (outra skill já baixou o mesmo vídeo), não baixe de novo.

```bash
yt-dlp -S "res:1080" -f "bv*+ba/b" --merge-output-format mp4 --no-playlist -o "work/source.%(ext)s" "LINK"
yt-dlp -J --skip-download --ignore-no-formats-error --no-playlist "LINK" > work/info.json
```

O segundo comando só salva os dados do vídeo, incluindo o gráfico **"mais reproduzido"** do YouTube. Ele é opcional: se falhar, apague `work/info.json` e siga.

- **Arquivo em vez de link:** copie-o para `work/source.mp4`. Se não for mp4, converta com `ffmpeg -i ARQ -c:v libx264 -c:a aac work/source.mp4`.
- **HTTP 429:** espere e tente de novo; se continuar, peça o arquivo.
- **Restrição de idade:** peça o arquivo. **Não use os cookies do navegador sem o usuário pedir.**

## 5. Transcrever (ou reaproveitar)

Se `work/captions.json` e `work/meta.json` já existirem para este `source.mp4` (mesma duração), **pule a transcrição**. Senão:

```bash
node ~/.maquina-cortes-gta/engine/scripts/transcribe.mjs work/source.mp4 work pt
```

Troque `pt` pelo idioma do vídeo. Um 4º argumento opcional limita aos primeiros N segundos (bom para testar em live de muitas horas). Para ler:

```bash
node ~/.maquina-cortes-gta/engine/scripts/transcript-text.mjs work
```

O comando imprime uma linha `Picos: ...` e depois linhas `[mm:ss] frase`. **🔥** marca os 10% mais reproduzidos do YouTube; **🔊** marca os picos de empolgação na voz (veja `ganchos.md`).

## 6. Mapa visual e `trechos.json`

Se `work/trechos.json` não existir:
1. Rode `node ~/.maquina-cortes-gta/engine/scripts/mapa-visual.mjs work/source.mp4 work <intervalo>` (120 s em live longa; 30 a 60 s em vídeo curto).
2. Olhe as folhas em `work/mapa/` e grave `work/trechos.json` como `[{"start": 0, "end": 3600, "tipo": "papo"}, {"start": 3600, "end": 5400, "tipo": "gameplay"}]`, com `tipo`:
   - **papo:** gente conversando para a câmera, sem jogo na tela → `cortes-papo`;
   - **gameplay:** a tela de um jogo ocupa o quadro → `cortes-gameplay`;
   - **video:** cena em que a ação é o conteúdo (vlog, desafio, IRL) → `cortes-video`.

**Tipo errado para esta skill?** Se o vídeo inteiro (ou a maior parte) for de outro tipo, diga em uma linha qual é e **acione a skill certa** (`/cortes-papo`, `/cortes-gameplay` ou `/cortes-video`), continuando de onde parou: `work/` (vídeo, transcrição, `trechos.json`) é o mesmo para as três. Se o vídeo for misto, corte só os trechos do tipo desta skill e cite os outros no fim.

## 7. Renderizar de novo só um corte

```bash
node ~/.maquina-cortes-gta/engine/scripts/build.mjs work . --so 01-o-id,02-outro-id
```

Ajuste o corte no `work/cuts.json` e use `--so` com o `id` dele: os outros não são renderizados de novo.
