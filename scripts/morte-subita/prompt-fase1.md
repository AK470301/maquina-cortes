Você é a FASE 1 do Modo Morte Súbita (rodada {{RODADA}}). Seu trabalho é SÓ escolher os vídeos: trabalhe em silêncio,
sem perguntas, não edite arquivos à mão e não baixe nada. Rode cada comando em primeiro plano (sem background, sem
Monitor, sem sleep): os dois terminam em poucos minutos.

1. Rode exatamente: node scripts/morte-subita/fase1.mjs --buscar --rodada {{RODADA}}
2. Leia o JSON. A ÚNICA restrição é o idioma: cada item de "selecionados" precisa estar em PORTUGUÊS (campos "idioma" e
   "evidencia"; título original). Não aplique nenhum outro filtro de canal, formato ou tema.
   - Se um selecionado claramente não estiver em português, troque-o pelo primeiro item de "reservas" que esteja.
   - Se "selecionados" vier vazio: pare aqui e responda só "FASE1 VAZIA" (o script já registrou o resultado).
3. Grave a lista aprovada rodando:
   node scripts/morte-subita/fase1.mjs --selecionar <ids separados por vírgula, no máximo 3, do mais visto para o menos> --rodada {{RODADA}}
   Isso grava fila-entrada/selecionados.json. NÃO rode --preparar nem --auto: o download, a transcrição e o evento de
   sucesso são feitos pelo rodar-cron.ps1 depois que você terminar.
4. Responda só "FASE1 SELECIONADA: <ids>" e termine imediatamente.
