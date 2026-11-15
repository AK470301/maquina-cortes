# Ritmo, viradas, imagens e efeitos sonoros (comum às três skills)

Vale para `cortes-papo`, `cortes-gameplay` e `cortes-video`. Os campos vão em cada corte do `work/cuts.json`.

**Ritmo (padrão).** Além de tirar as pausas, o `build.mjs` quebra os planos longos a cada ~2,8 s, sempre no começo de uma palavra, sem remover conteúdo. **Cada quebra é um jump cut seco: muda só o zoom (106% ↔ 100%), sem flash e sem swoosh.**
- `"ritmo": "normal"` só tira as pausas, sem quebrar os planos.
- `"ritmo": "rapido"` põe flash e swoosh em todos os jump cuts. Fica repetitivo; use só se o usuário pedir.
- `"cutEvery"` muda o intervalo, em segundos.

**Viradas de seção (swoosh + flash).** Liste no corte os segundos **do vídeo de origem** em `"turns": [312.8, 331.0]`, de 3 a 5 por corte: quando o assunto muda, quando entra um B-roll ou quando acontece algo marcante. Se o segundo cair numa pausa removida, a virada vai para o começo do plano seguinte.

**Pausas.** Entre frases, toda pausa a partir de 0,3 s fica com ~0,2 s. Dentro da frase, só pausas de 0,5 s ou mais são encurtadas; as menores fazem parte da fala.

**Menção a algo mostrável (produto, marca, lugar, pessoa).** Marque o segundo em `turns` e liste uma `image` daquilo naquele momento: swoosh → foto por ~1–2 s → volta ao ponto onde estava, com a fala e a legenda em sincronia.

**Imagens aparecendo (prints, fotos, logos).** Escolha 1 a 3 momentos do corte em que a fala cita algo mostrável (ex.: um lugar, um produto, uma pessoa) e liste-os em `images` no `cuts.json`, com `at` em **segundos do vídeo de origem** e `dur` em segundos:

```json
"images": [
  {"query": "Torre Eiffel", "at": 312.8, "dur": 2.2},
  {"file": "C:/imagens/produto.png", "at": 318.0}
]
```

A imagem entra com animação e um pop (na metade de baixo nos layouts divididos; no meio da tela na tela cheia). Se `at` cair numa pausa removida, ela entra no começo do plano seguinte.

**Popups com imagem real, nunca só texto.** Exemplos:
- a capa ou arte do jogo, filme ou produto quando falarem o nome dele;
- o logo da empresa quando disserem o nome dela;
- mapa ou foto aérea quando falarem de mapa;
- o personagem quando falarem dele;
- para comparar, as duas coisas lado a lado.

Prefira material oficial (site, arte de divulgação) e **não use material vazado**.

As duas fontes de imagem:
- `file` usa uma imagem do usuário.
- `query` busca no **Google** pela API oficial (Custom Search) e baixa a primeira imagem que servir. Precisa das variáveis `GOOGLE_API_KEY` e `GOOGLE_CSE_ID` do usuário (gratuito até 100 buscas por dia; veja o cabeçalho de `~/.maquina-cortes-gta/engine/scripts/buscar-imagens.mjs`). Sem elas, a imagem é pulada com um aviso: peça arquivos ao usuário ou use arte oficial baixada.

**Efeitos sonoros (whoosh, impacto, pop).** Ficam em `~/.maquina-cortes-gta/sfx/` e o `build.mjs` os usa sozinho:
- impacto no quadro 0;
- **whoosh só nas viradas de seção (`turns`)**;
- pop em cada imagem;
- **menos de 15 efeitos por 35 s**, bem abaixo da voz (`sfxGain` no `config.json`, padrão 0,6).

Se `efeitosGerados` for 0, **pergunte uma vez** se o usuário quer gerar os efeitos (usa créditos da conta ElevenLabs dele, 3 efeitos curtos) e, só com o OK, rode:

```bash
node ~/.maquina-cortes-gta/ferramentas/gerar-paleta-sfx.mjs
```

Isso usa o gerador embutido (em `~/.maquina-cortes-gta/ferramentas/sfx/`) e a variável `ELEVENLABS_API_KEY`. Nunca peça nem escreva a chave no chat. Sem efeitos gerados, o corte sai sem efeitos.
