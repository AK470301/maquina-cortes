# Como escolher os cortes pelo gancho

Você tem a transcrição (palavras com tempo) e, quando existirem, dois sinais extras (🔥 e 🔊, ver abaixo). Escolha por **o que a frase faz com quem ouve**, não pelo assunto em si.

## O que torna uma frase um bom gancho (nota 0 a 10)

Some pontos, sem passar de 10:

| Critério | Pontos | Como reconhecer na transcrição |
|---|---:|---|
| **Abre uma lacuna** de curiosidade | 0–3 | A frase levanta uma pergunta ou tensão que só o resto do corte responde ("o erro que quase todo mundo vai cometer…", "isso aqui muda tudo…"). Vale mais quando não entrega a resposta de cara. |
| **Fato específico** | 0–2 | Número, nome, data, comparação ("35 minutos", "100 mil dólares", "maior que três estádios"). |
| **Conflito ou opinião forte** | 0–2 | Discorda, reclama, se surpreende, dá um veredito. |
| **Entra direto** | 0–1 | A 1ª frase já é o ponto. Sem "então, galera", "bom, vamos lá", "voltando ao assunto". |
| **Tem payoff dentro do corte** | 0–1 | A resposta ou a conclusão chega antes de acabar. |
| **Se entende sozinho** | 0–1 | Quem não viu o resto do vídeo entende do que se fala em 5 s. |

- **9–10:** gancho forte, use. **6–8:** bom. **Abaixo de 6:** descarte, mesmo que o assunto seja bom.
- Penalize: promessa que o corte não cumpre; trecho que só faz sentido com contexto anterior; piada interna.

## Sinais extras (🔥 e 🔊)

O `transcript-text.mjs` marca as linhas da transcrição:

| Marca | O que é | De onde vem |
|---|---|---|
| 🔥 | Entre os 10% trechos **mais reproduzidos** do vídeo | Gráfico do YouTube (`work/info.json`, via `yt-dlp -J`). Só existe em vídeo do YouTube com audiência suficiente; live recém-terminada pode ainda não ter. |
| 🔊 | **Pico de empolgação**: a voz fica bem mais alta que o normal desse vídeo (grito, risada, surpresa) | `work/energia.json`, medido pelo `transcribe.mjs` no próprio áudio. Funciona com link ou arquivo. |

Como usar:

- **Os sinais dizem onde olhar, não o que cortar.** Leia primeiro os blocos em volta das marcas, mas o corte só entra se tiver um gancho com nota ≥ 6.
- **Os sinais não somam pontos na nota.** A nota mede só a frase de gancho. Mostre os sinais numa coluna à parte, na tabela de aprovação.
- **🔥🔊 juntos** no mesmo trecho é o candidato mais forte: o público voltou para ver e a pessoa reagiu.
- **Reação sem gancho não basta.** Um grito sozinho não se entende fora de contexto. O corte começa na frase que **prepara** a reação ("olha o que acontece se você...") e termina logo depois dela.
- **🔊 falso:** em live com música, jogo alto ou alerta de doação, um pico pode ser só barulho. Confira se há fala naquele trecho.
- **🔥 no começo do vídeo** às vezes é só gente pulando a introdução; desconfie de pico nos primeiros 30 s.
- Sem marcas (vídeo curto, arquivo sem link, áudio uniforme): escolha só pela transcrição, como sempre.

## Assuntos e ganchos diferentes

- Faça primeiro um **mapa de assuntos** (um por bloco temático do vídeo). Cada corte sai de **um bloco diferente**.
- Dois cortes **não** abrem com a mesma ideia nem com a mesma estrutura de frase. Se dois ganchos forem parecidos, fique com o de maior nota.
- Espalhe os cortes ao longo do vídeo; evite tirar tudo do mesmo minuto.

## Onde começar e terminar

- **Início:** no começo da frase de gancho (use o tempo da primeira palavra, e recue ~0,2 s). Corte o aquecimento antes dela.
- **Fim:** no fim da frase que fecha o raciocínio (payoff), até ~0,3 s depois da última palavra. Não deixe frase pela metade nem "né?" solto.
- **Duração:** 20 a 60 s. Abaixo de 20 s costuma não ter payoff; acima de 60 s perde ritmo (mas um assunto excelente pode chegar a ~75 s).
- Não corte no meio de uma palavra; use os tempos de `captions.json`.

## Formatos de gancho que funcionam bem em corte de conversa

- **Afirmação surpreendente + consequência:** "Isso aqui vai ser o maior problema do lançamento."
- **Comparação com o que o público conhece:** "É do tamanho de três estádios."
- **Pergunta direta ao espectador:** "Você sabia que…?"
- **Reação forte ao vivo:** quando a pessoa se surpreende ou discorda, a frase seguinte costuma ser o gancho.
- **Número ou nome na primeira frase.**

## Ganchos de ação (gameplay e tela cheia)

Em `cortes-gameplay` e `cortes-video`, o gancho pode ser **visual**: a jogada, o susto, o helicóptero pousando. Mesmo assim:
- o começo do corte precisa deixar claro **o que está em jogo** em até 3 s (a fala que prepara, ou a própria cena);
- dê a nota pelo trecho todo (preparação + ação + reação), com os mesmos critérios: lacuna, fato, conflito, entra direto, payoff, se entende sozinho;
- termine logo depois da reação: o payoff é a reação, não a explicação depois dela.

## O que NÃO fazer

- Não escolha o trecho só porque é engraçado fora de contexto.
- Não invente gancho: o texto da legenda é o que a pessoa falou.
- Não mude o sentido ao encurtar; as pausas são removidas, as frases não.
