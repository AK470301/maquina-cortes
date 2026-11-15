# Enquadramento em tela cheia

Usado com `layout: "cheia"` (o motor é o mesmo, em `~/.maquina-cortes-gta/engine/src/SplitCut.jsx`).

## Como o recorte funciona

- O quadro da origem (em geral 16:9) é ampliado até cobrir 1080×1920. De um vídeo 1920×1080 fica visível uma faixa vertical de **~608×1080 px**: um terço da largura.
- `x` (0 a 100) diz onde fica essa faixa: com `0` aparece a borda esquerda, com `50` o centro e com `100` a borda direita. Para centralizar algo que está na posição horizontal *p* do quadro (em %), use `x ≈ (p − 15,8) / 68,4 × 100`, limitado a 0–100. Exemplos:
  - algo a 1/3 da largura → `x ≈ 25`;
  - no centro → `x = 50`;
  - a 2/3 → `x ≈ 75`.
- Para medir *p*, use `mapa-visual.mjs ... --guias`: as linhas ficam a 25%, 50% e 75% da largura.
- Em vídeo 16:9, `y` não muda nada, porque a altura já preenche a tela.
- Cada plano (os jump cuts a cada ~2,8 s e os cortes de pausa) usa o ponto do `focusTrack` mais recente antes do início dele.

## Exemplos

| Cena | Foco |
|---|---|
| Uma pessoa falando para a câmera, no centro | `x: 50` |
| Pessoa no terço esquerdo, olhando para a direita | `x: 20–30` |
| Duas pessoas no carro (motorista à esquerda) | em quem está falando; troque o ponto quando a fala muda de pessoa |
| Plano aberto com o objeto do gancho (helicóptero, carro) | no objeto enquanto ele é o assunto; depois volte para a pessoa |
| Mapa, gráfico ou tela com texto | `x: 50`, ou prefira não cortar esse trecho, porque texto largo não cabe |

## A legenda

- Fica no **terço inferior** (centro em y = 1250), com um degradê escuro atrás. Rostos costumam ficar na metade de cima e não são cobertos.
- Se o rosto ou a ação importante estiver embaixo, use `"captionY"` no corte, com um valor como 1500 (centro vertical da legenda, em px).

## Qualidade

- Prefira origem em 1080p ou mais: a faixa visível é ampliada cerca de 1,8×.
- Câmera tremida ou rápida demais vira um borrão no recorte. Escolha trechos em que a ação fica num lugar.
