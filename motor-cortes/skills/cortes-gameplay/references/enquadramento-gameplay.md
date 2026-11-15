# Enquadramento de gameplay

Usado com `layout: "gameplay"`. Todas as medidas estão em **pixels do vídeo de origem**.

## As duas áreas

| Área | Tamanho na tela | Proporção | Campo |
|---|---|---|---|
| Webcam (em cima) | 1080×730 | ~1,48:1 | `crop` |
| Jogo (embaixo) | 1080×1190 | ~0,91:1 | `gameCrop` |
| Jogo sem webcam | 1080×1920 | 9:16 | `gameCrop` + `"semCamera": true` |

Num quadro 1920×1080, um `gameCrop` 0,91 de altura total mede **984×1080**: cerca de metade da largura. O `x` do recorte decide qual metade aparece. Se o recorte tiver outra proporção, o motor amplia até cobrir a área e corta o que sobrar, pelo centro do recorte.

## Onde fica o foco, por gênero

| Gênero | Foco do `gameCrop` |
|---|---|
| Tiro em primeira pessoa (FPS) | **centro da tela**, com a mira no meio: `x = (1920 − 984) / 2 = 468` |
| Terceira pessoa (GTA, ação, aventura) | o **personagem**, em geral no centro ou um pouco abaixo; centralize nele |
| Corrida | o **carro** e a pista à frente; inclua o velocímetro só se ele for parte do gancho |
| Estratégia, MOBA, visão de cima | a **área da briga**, não o minimapa nem a barra de habilidades |
| Luta (2D) | os **dois lutadores**; se não couberem, use `semCamera` com um recorte mais largo, ou outra skill |
| Terror | o **susto**: o centro, ou de onde vem a ameaça |

## Webcam

- Aperte no **rosto e nos ombros**: a reação é o que vende o corte.
- Corte fora a moldura do overlay, o nome do streamer e os alertas.
- **Webcam pequena** (menos de ~300 px de largura na origem) fica borrada ampliada. Avise o usuário e, se o rosto for ilegível, prefira `semCamera`.
- Se o streamer muda a webcam de lugar durante a live, cada corte tem o seu `crop`: confira em quadros do próprio trecho.

## Legenda

- Na divisa, em y = 730 (padrão). Se cobrir a mira ou a barra de vida, use `"captionY"` (por exemplo 1700, perto do pé da tela) ou mova o `gameCrop` para que o elemento fique longe da divisa.
- Sem webcam, ela vai para o terço inferior (y = 1250).
