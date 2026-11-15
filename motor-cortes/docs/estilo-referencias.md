# Estilo dos cortes

O guia de estilo comum às três skills. Cada item diz se **já está no motor** ou se é **ideia futura** (ainda não implementada; não prometa ao usuário).

## Três layouts, um por tipo de trecho
- **Papo** (`cortes-papo`): quem fala em cima (50%), B-roll embaixo (50%), legenda na divisa. *(Feito.)*
- **Gameplay** (`cortes-gameplay`): webcam em cima (~38%), o jogo do mesmo momento embaixo (~62%), legenda na divisa; sem webcam, o jogo ocupa a tela e a legenda vai para o terço inferior. *(Feito.)*
- **Tela cheia** (`cortes-video`): a cena ocupa a tela, recortada seguindo a pessoa; legenda no terço inferior. *(Feito.)*
- Cada skill corta só os trechos do seu tipo (`work/trechos.json`) e cita, no fim, os trechos das outras.

## Base do corte
- **Jump cuts secos** a cada ~2,8 s, sempre no começo de uma palavra, alternando o zoom (106% ↔ 100%). **Sem swoosh nos jump cuts.** *(Feito.)*
- Marca do canal (opcional) pequena no canto superior direito; nada mais fixo na tela. *(Feito.)*
- *Ideia futura:* legenda por frase (3 a 6 palavras, 1 a 2 linhas) como alternativa à legenda palavra por palavra.

## Legenda e paleta
- Palavra por palavra, caixa alta, Montserrat Black com contorno preto. *(Feito.)*
- **Paleta do streamer** (`~/.maquina-cortes-gta/streamers/<slug>.json`): cor base no texto, cor de destaque na palavra falada. *(Feito.)*
- **Palavras-chave** (`keywords` no corte, 2 a 5): sempre na cor de destaque e 15% maiores. *(Feito.)*

## Virada de seção = swoosh + flash
- Só em mudança de assunto, entrada de B-roll ou momento marcante, listadas em `turns`. *(Feito.)*

## Popups com imagem real
- Popups sempre com imagem real, nunca só texto. *(Feito: `images`, com animação e pop.)*
- Exemplos: a arte oficial do jogo, filme ou produto citado; o logo da empresa citada; o lugar de que se fala; as duas coisas lado a lado ao comparar.
- Não escreva na tela o que a legenda já diz.
- Material feito por fãs leva a tarja "não oficial"; **não use material vazado**.

## Som
- Voz na frente. Sem música (ou bem baixa, ≈ −33 LUFS).
- **Poucos efeitos:** impacto no quadro 0, whoosh nas viradas e pop em cada popup; **menos de 15 por 35 s**. *(Feito.)*
- **Mix final em −14 LUFS**, pico ≤ −1 dBTP, aplicado pelo `build.mjs` em cada corte. *(Feito.)*

## Ritmo e silêncio
- **Pausa entre frases a partir de 0,3 s vira ~0,2 s.** A pausa dentro da frase fica, a menos que passe de 0,5 s. *(Feito.)*

## Escolha do trecho
- Primeiro os sinais: **🔥 mais reproduzido** (gráfico do YouTube, via `yt-dlp -J`) e **🔊 picos de empolgação** na voz. Depois, o gancho com nota ≥ 6 decide. *(Feito.)*
- O usuário aprova a lista de candidatos antes do render. *(Feito.)*
