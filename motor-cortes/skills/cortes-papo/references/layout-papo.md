# Layout papo: quem fala em cima, B-roll embaixo

Desenhado em `SplitCut.jsx` (motor em `~/.maquina-cortes-gta/engine/src/`), com `layout: "papo"`.

## Regiões (1080×1920, 30 fps)

| Região | O que tem |
|---|---|
| **Metade de cima** (0–960 px) | Quem fala, preenchendo a metade. Enquadramento por `focus` (`x`, `y` de 0 a 100; `{"x": 50, "y": 35}` põe o rosto um pouco acima do meio) ou por `crop` (`{x, y, w, h}` em pixels da origem, proporção ~1,125:1) quando há várias câmeras ou a câmera é pequena. Zoom a cada plano e flash nas viradas. |
| **Metade de baixo** (960–1920 px) | O gameplay do `work/bottom.mp4` (montado pelo `montar-bottom.mjs`), sem áudio; por cima, os `broll[].file` pontuais, se houver. Sem `bottom.mp4`, a câmera desfocada. |
| **Divisa** (y = 960) | Degradê escuro de ~340 px e a **legenda** por cima. |
| **Canto superior direito** | Marca d'água (opcional): logo circular e nome do perfil. |

## Fundo de gameplay e B-roll

- O fundo da metade de baixo é o `work/bottom.mp4`: montagem sorteada de trechos de 4–7 s de uma pasta de clipes de gameplay, feita por `node ~/.maquina-cortes-gta/engine/scripts/montar-bottom.mjs <pasta> work`. Sem áudio, recortada em 1080×960, sem desfoque. O `build.mjs` começa cada corte num ponto diferente dela (`bottomStart` força um ponto).
- Sem `bottom.mp4`, o fundo é a câmera desfocada (fraco: evite).
- **Não use Pexels nem trailers oficiais**: gameplay próprio ou licenciado, para não cair em Content ID.
- Momentos pontuais: `"broll": [{"file": "work/x.mp4|jpg", "at": 312.0, "dur": 3}]`, com `at` em segundos da origem; marque o mesmo segundo em `turns`.
- Imagens do Google (`images` com `query`) continuam como **popup** por cima, para coisas pontuais (um logo, um produto).

## Legenda

- Palavra por palavra, 1 a 3 palavras por vez, caixa alta, Montserrat Black 96 px com contorno preto.
- Cor base = `corBase` da paleta do streamer; a palavra falada e as `keywords` ficam na `corDestaque` (as keywords também 15% maiores).

## Cortes e ritmo

- **Pausas:** entre frases, toda pausa a partir de 0,3 s fica com ~0,2 s; dentro da frase, só as de 0,5 s ou mais.
- **Zoom:** o 1º plano entra em 112%; os ímpares, em 106%; os pares, em 100%. Planos quebrados a cada ~2,8 s (jump cut seco).
- **Ênfase:** marque em `turns` os momentos 🔊 dentro do corte (grito, risada, frase forte): entram flash e swoosh.
- **Volume:** −14 LUFS, pico ≤ −1 dBTP. O áudio é só a fala; o B-roll é mudo.
