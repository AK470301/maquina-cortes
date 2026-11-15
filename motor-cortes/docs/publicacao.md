# Publicação no YouTube Shorts, TikTok e Instagram Reels (comum às três skills)

Opcional. Só publique quando o usuário pedir, e **só depois do OK dele na tabela final**: publicar não tem desfazer.

`P` = `node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs`. Rode tudo **da pasta do corte** (a mesma do `build.mjs`).

## 1. Conferir as contas

`P status` mostra, para cada plataforma, se a conta está conectada (`conectada`), quais variáveis faltam (`variaveisFaltando`), o limite do Instagram e o que está na fila.

- **Faltam variáveis:** mostre ao usuário a seção "Criar os apps" desta plataforma. **Nunca peça nem escreva chaves, segredos ou tokens no chat**: ele define as variáveis no ambiente dele.
- **Não conectada:** o login abre o navegador e espera até 5 min. Peça para o usuário rodar ele mesmo: `! node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs conectar youtube` (ou `tiktok`, `instagram`).
- Publique só nas plataformas conectadas; cite as outras em uma linha.

## 2. Montar `work/publicacao.json`

```json
{
  "clips": [
    {
      "id": "01-preco-do-cafe",
      "arquivo": "01-preco-do-cafe.mp4",
      "capaSegundo": 2.4,
      "youtube": {"titulo": "O café dobrou de preço (e ninguém explicou o porquê)", "descricao": "…\n\n#Shorts #economia #cafe", "tags": ["café", "inflação"], "quando": "2026-11-20T18:00:00-03:00"},
      "tiktok": {"legenda": "o café DOBROU 😳 #economia #cafe #fyp", "modo": "rascunho"},
      "instagram": {"legenda": "O café dobrou de preço… e a explicação é pior. #economia #cafe #reels", "quando": "2026-11-21T18:00:00-03:00"}
    }
  ]
}
```

- `id` e `arquivo` vêm do `cuts.json` e dos MP4s renderizados (`arquivo` é relativo à pasta do corte).
- Uma plataforma só entra se tiver o bloco dela. Tire o bloco para não publicar ali.
- **`quando`** (opcional): data ISO **com fuso** (`-03:00` em Brasília), pelo menos 15 min no futuro. Sem `quando`, publica na hora.
- **`capaSegundo`**: o segundo **do corte renderizado** (não da origem). Extraia 3 ou 4 quadros (`ffmpeg -ss <s> -i 01-....mp4 -frames:v 1 work/capa-teste.jpg`) e escolha o com rosto e emoção claros, sem legenda pela metade.

### Texto de cada plataforma

**Hashtag do streamer (obrigatória, automática):** toda descrição/legenda, em todas as plataformas, leva a hashtag do streamer: `#<slug>` do `cuts.json`, ou a fixada com `setup.mjs --streamer <slug> --hashtag "#tag"`. O `enviar`, o `kit` e o `--teste` acrescentam no fim se faltar (o `--teste` mostra onde). Escreva-a você mesmo na legenda para ficar no lugar certo.

O texto sai do **gancho** e do **assunto** do corte. Não invente fatos, não prometa o que o corte não entrega, e não copie o mesmo texto nas três.

| | Regras |
|---|---|
| **YouTube** | `titulo` até 100 caracteres, sem `<` ou `>`, com a curiosidade do gancho na frente. `descricao` com 1–2 frases e 3–5 hashtags, incluindo `#Shorts`. `tags` com 3–8 termos. |
| **TikTok** | `legenda` curta (1 linha) e 3–5 hashtags. `modo`: `"rascunho"` (padrão) ou `"direto"` (ver limites). |
| **Instagram** | `legenda` com 1–2 frases e 3–5 hashtags (máx. 30), incluindo `#reels`. |

### Horários

**Preferências salvas:** se o `--check` mostrar `config.publicacao`, use-as sem perguntar de novo:
- `horarios`: os horários do dia, por exemplo `["12:00", "18:00", "21:00"]` (um corte por horário);
- `fuso`: o fuso das datas, por exemplo `-03:00`;
- `plataformas`: onde publicar;
- `tiktokModo` / `instagramModo`: o modo padrão de cada uma (`"manual"` = kit para o usuário agendar no navegador).

**Para escolher os horários, rode `P horarios <n>`** (n = número de cortes). Ele devolve os próximos horários livres em todas as plataformas, sem repetir os já usados por outros vídeos (`~/.maquina-cortes-gta/agenda.json`), e você dá um horário por corte, na ordem da melhor nota para a pior.

Sem preferências salvas, pergunte uma vez e grave em `config.json` → `publicacao`. Se o usuário não souber, sugira 1 corte por dia às 18h. Não publique todos juntos. Espalhe os assuntos: dois cortes do mesmo tema não saem no mesmo dia.

## Modo manual (kit): quando a plataforma não tem API configurada

Com `"modo": "manual"` no bloco da plataforma (TikTok ou Instagram, ou quando `config.publicacao.*Modo` for `"manual"`), o `enviar` não publica nada ali. Depois do OK da tabela, rode:

```bash
node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs kit work/publicacao.json
```

Isso cria `kit-publicacao/<plataforma>/` na pasta do corte, com os vídeos renomeados na ordem de publicação (`2026-11-15 12h00 - 01-id.mp4`) e um `LEGENDAS.txt` com dia, hora, capa e legenda de cada um. Entregue ao usuário o caminho das pastas e o passo a passo:

- **Instagram:** business.facebook.com → Planejador (ou Criar Reel) → enviar o vídeo → colar a legenda → "Programar" no dia e hora do arquivo. Precisa do Facebook com a Página ligada ao Instagram.
- **TikTok:** tiktok.com/tiktokstudio/upload → enviar o vídeo → colar a legenda → "Programar" (até 10 dias à frente).

No modo manual, o bloco aceita `quando` (é o horário que vai no nome do arquivo) e `legenda`.

## 3. Aprovar com o usuário

Primeiro: `P enviar work/publicacao.json --teste`. Isso valida o arquivo e mostra o plano sem enviar nada. Corrija os erros que aparecerem. Depois mostre:

| Corte | Plataforma | Título / legenda | Quando | Ação |
|---|---|---|---|---|
| 01-preco-do-cafe | YouTube | O café dobrou de preço (e ninguém…) | 20/11 18:00 | agendar |
| 01-preco-do-cafe | TikTok | o café DOBROU 😳 #economia… | — | rascunho |

Só com o **OK explícito** dessa tabela:

```bash
node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs enviar work/publicacao.json
```

- `--so 01-id,02-id` e `--plataforma yt,tt,ig` limitam o envio.
- O resultado fica em `work/publicado.json`. Rodar de novo **não** reenvia o que já foi (`publicado`, `agendado`, `rascunho`, `na-fila`); os que deram `erro` são tentados de novo. `--forcar` reenvia tudo; use só se o usuário pedir.

Entregue os links (YouTube e Instagram), o estado de cada envio e, para o TikTok em rascunho, a legenda para ele colar no app.

## Como cada plataforma agenda

| | Agendamento | Computador ligado na hora? |
|---|---|---|
| **YouTube** | nativo: sobe como privado e o YouTube publica sozinho no horário | não |
| **TikTok `rascunho`** | não tem: o vídeo vai para o app e o usuário posta quando quiser | não |
| **TikTok `direto`** e **Instagram** | fila local (`~/.maquina-cortes-gta/fila.json`), publicada pelo comando `fila` | **sim** |

Para a fila andar, o comando `fila` precisa rodar a cada 15 min. Ensine o usuário a configurar isso uma vez:

- **Linux/macOS** (`crontab -e`): `*/15 * * * * node ~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs fila >> ~/.maquina-cortes-gta/fila.log 2>&1`. As variáveis de ambiente das plataformas precisam estar disponíveis no cron, por exemplo definidas no começo do crontab.
- **Windows:** no Agendador de Tarefas, crie uma tarefa que se repete a cada 15 min e roda `node %USERPROFILE%\.maquina-cortes-gta\ferramentas\publicar\publicar.mjs fila`.

Um item que falha 3 vezes sai da fila e fica como `erro` no `publicado.json`.

## Limites

| | Limite | Observação |
|---|---|---|
| **YouTube** | ~100 envios por dia | Capa personalizada exige canal verificado e pode não aparecer em Shorts. Se um vídeo público voltar **privado**, o projeto do Google precisa da auditoria da API; até lá, publique à mão no Studio. |
| **TikTok** | ~15 posts por dia; 5 rascunhos pendentes por dia | **Sem a auditoria do TikTok, o modo `direto` só publica como privado** (`SELF_ONLY`). Por isso o padrão é `rascunho`. A auditoria leva semanas e é pedida no portal de desenvolvedores. |
| **Instagram** | 100 posts por 24 h | Precisa de conta **profissional** ligada a uma Página do Facebook. `P status` mostra o uso. |

## Criar os apps (uma vez, feito pelo usuário)

Em todos, cadastre a URI de retorno **`http://localhost:8723/callback/`** (troque a porta com `MAQUINA_CORTES_PORTA_OAUTH`, se preciso).

### YouTube
1. Em console.cloud.google.com, crie um projeto e ative a **YouTube Data API v3**.
2. Em "Tela de consentimento OAuth", escolha o tipo externo, adicione o próprio e-mail como usuário de teste e o escopo `youtube.upload`.
3. Em "Credenciais", crie um **ID do cliente OAuth** do tipo **App para computador**.
4. Defina `YOUTUBE_CLIENT_ID` e `YOUTUBE_CLIENT_SECRET`.

Com o app em modo de teste, o login do Google expira em 7 dias. Para não precisar reconectar, publique o app (não é preciso enviar para verificação para uso próprio).

### TikTok
1. Em developers.tiktok.com, crie um app de plataforma **Desktop**.
2. Adicione os produtos **Login Kit** e **Content Posting API** e os escopos `video.upload` e `video.publish`. Cadastre a URI de retorno.
3. Envie o app para revisão (sem ela, só a conta do dono e contas de teste funcionam).
4. Defina `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET`.

O login do TikTok dura cerca de 1 ano; depois disso, conecte de novo.

### Instagram
1. A conta do Instagram precisa ser **profissional** (Empresa ou Criador) e estar **ligada a uma Página do Facebook**.
2. Em developers.facebook.com, crie um app do tipo **Empresa** e adicione **Facebook Login for Business**. Cadastre a URI de retorno em "URIs de redirecionamento do OAuth válidos".
3. Peça as permissões `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement` e `business_management`. Em modo de desenvolvimento, elas funcionam para quem tem papel no app (adicione a própria conta).
4. Defina `META_APP_ID` e `META_APP_SECRET`. Com várias contas ligadas, defina também `INSTAGRAM_USUARIO` (o @ desejado) antes de conectar.

## Problemas

| Sintoma | O que fazer |
|---|---|
| `não conectado` | O usuário roda `conectar <plataforma>` (ele mesmo, com `!`). |
| `defina ... no ambiente` | Falta a variável do app; veja "Criar os apps". |
| `redirect_uri` inválida / `redirect_uri_mismatch` | A URI cadastrada no app tem que ser exatamente `http://localhost:8723/callback/`. |
| `Não consegui abrir a porta 8723` | Feche o que usa a porta ou defina `MAQUINA_CORTES_PORTA_OAUTH` (e cadastre a nova URI). |
| Google sem `refresh_token` | Remova o acesso do app em myaccount.google.com/permissions e conecte de novo. |
| TikTok `unaudited_client_can_only_post_to_private_accounts` | Use `modo: "rascunho"` ou peça a auditoria. |
| TikTok `spam_risk_too_many_pending_share` | Há 5 rascunhos esperando no app; poste ou apague alguns. |
| Instagram "Nenhuma Página com conta profissional" | Ligue o Instagram à Página (Configurações da Página → Contas vinculadas) e conecte de novo. |
| Item da fila não saiu | O computador estava desligado ou o cron não roda; veja `~/.maquina-cortes-gta/fila.log` e `P status`. |
