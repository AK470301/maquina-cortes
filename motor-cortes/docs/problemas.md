# Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `ffmpeg: false` no `--check` | FFmpeg fora do PATH | Windows: `winget install Gyan.FFmpeg` · macOS: `brew install ffmpeg` · Linux: `apt install ffmpeg`. Abra um terminal novo depois. |
| `ytdlpDesatualizado: true` ou yt-dlp falha com `HTTP Error 400` / `Requested format is not available` em todo vídeo | yt-dlp antigo: o YouTube muda com frequência | Atualize: `yt-dlp -U`, `pipx upgrade yt-dlp`, `winget upgrade yt-dlp` ou `brew upgrade yt-dlp`. No Linux, o do `apt` costuma ser antigo: `sudo apt remove yt-dlp && pipx install yt-dlp`. |
| `ytdlp: false` | yt-dlp não instalado | Windows: `winget install yt-dlp` · macOS: `brew install yt-dlp` · Linux: `pipx install yt-dlp`. Sem ele, só vale arquivo de vídeo. |
| yt-dlp: `HTTP Error 429` | O YouTube limitou as requisições | Espere alguns minutos e tente de novo. Se continuar, peça o arquivo de vídeo. |
| yt-dlp: `Sign in to confirm your age` | Vídeo com restrição de idade | Baixe o vídeo no navegador (logado) e passe o arquivo para a skill. Usar `--cookies-from-browser` dá acesso ao seu login: só faça se você quiser. |
| As pausas não foram cortadas | A live tem música ou som de jogo por baixo, então nada fica abaixo de -35 dB | Normal em live e react. Ajuste o limiar em `silencedetect=noise=-35dB` no `transcribe.mjs` (ex.: `-28dB`) ou corte as pausas pela transcrição. Gagueira e "é..." não são cortados. |
| O render falha com caminho que tem espaço | (corrigido) versões antigas chamavam o Remotion por um shell | Atualize a skill; o `build.mjs` agora chama o CLI direto pelo Node. |
| Câmera do streamer borrada | Origem em 720p e câmera pequena (live com várias câmeras) | Use uma origem com o streamer em plano grande, ou baixe em resolução maior. |
| yt-dlp: `Requested format is not available` | O vídeo não tem formato combinado | Use `-f "bv*+ba/b"` com `--merge-output-format mp4` (como no `SKILL.md`). Não filtre por `height`: em vídeo vertical a altura é a maior medida. |
| `npm install` falha | Sem internet ou versão antiga do Node | Use Node 18+ (de preferência 22+) e rode `node instalador/setup.mjs` de novo. |
| whisper.cpp não instala (macOS/Linux) | Ele é compilado na máquina | Instale as ferramentas de compilação (`xcode-select --install` no macOS, `build-essential` no Linux) e rode o setup de novo. |
| `Model ... does not exist` | O modelo não foi baixado | Rode `bash instalador/install.sh` (ou `node instalador/setup.mjs`) na pasta do repositório; o modelo fica em `~/.maquina-cortes-gta/whisper.cpp/`. |
| Legenda errada em português | Modelo pequeno demais | Em `~/.maquina-cortes-gta/config.json`, troque `whisperModel` para `medium` e rode o setup (baixa mais arquivos). |
| Legenda fora de sincronia | Vídeo de origem com taxa de quadros variável | Converta antes: `ffmpeg -i ARQ -vf fps=30 -c:a aac work/source.mp4`. |
| Rosto cortado na metade de cima | Streamer fora do centro | Ajuste `focus` (ou `crop`) no `cuts.json`. Na tela cheia, ajuste os pontos do `focusTrack`. |
| Aviso "B-roll ... ignorado" ou metade de baixo só com a câmera desfocada | Sem `PEXELS_API_KEY` ou nenhum vídeo achado | Crie a chave grátis em pexels.com/api, tente outro termo (em inglês) ou passe arquivos em `broll[].file`. |
| Jogo mal enquadrado no gameplay | `gameCrop` fora do foco da ação ou na proporção errada | Proporção ~0,91 (1080×1190) com webcam, 9:16 sem webcam. Olhe 2 ou 3 quadros do trecho e refaça. |
| Legenda da cor errada | O `streamer` do `cuts.json` não tem paleta salva | Rode `setup.mjs --streamer <slug> --cor-base ... --cor-destaque ...`. |
| O render demora | Remotion renderiza no seu computador | É normal; o 1º render também baixa o Chrome headless. |
| Corte sem som da pessoa | O arquivo de origem não tem áudio | Confira com `ffprobe -show_streams work/source.mp4`. |
| Pausas entre frases não foram cortadas, mas as longas sim | A frase anterior não terminou com pontuação na transcrição (o whisper às vezes não põe ponto) | Pausas de 0,3–0,5 s só saem quando a palavra anterior fecha a frase (`.`, `!`, `?`). Para cortar todas, use `minLong: 0.3` em `segmentsFor()` no `build.mjs`. |
| Aviso "Volume de ... não foi ajustado" | O `loudnorm` do ffmpeg falhou (corte sem áudio ou ffmpeg muito antigo) | O corte fica como saiu do render. Confira o áudio com `ffprobe -show_streams` e atualize o FFmpeg. |
| Nenhuma marca 🔥 | O vídeo não tem o gráfico "mais reproduzido", a origem é arquivo ou o `info.json` não foi gerado | Normal. Se você souber o minuto do pico, diga à skill. |
| Marcas 🔊 demais ou em lugares sem fala | Live com música, jogo alto ou alertas | Ignore as marcas sem fala; o gancho decide. |
