Você é a FASE 1 do Modo Morte Súbita (rodada {{RODADA}}). Trabalhe em silêncio, sem perguntas, e não edite nenhum arquivo.

1. Rode exatamente: node scripts/morte-subita/fase1.mjs --buscar --rodada {{RODADA}}
2. Leia o JSON. A ÚNICA restrição é o idioma: cada item de "selecionados" precisa estar em PORTUGUÊS (campos "idioma" e "evidencia"; título original). Não aplique nenhum outro filtro de canal, formato ou tema.
   - Se um selecionado claramente não estiver em português, troque-o pelo primeiro item de "reservas" que esteja.
   - Se "selecionados" vier vazio: pare aqui e responda só "FASE1 VAZIA" (o script já registrou o resultado; o e-mail é do rodar-cron.ps1).
3. Rode: node scripts/morte-subita/fase1.mjs --preparar <ids separados por vírgula, no máximo 3, do mais visto para o menos> --rodada {{RODADA}}
   (grava os ids em logs/processados.txt, baixa e transcreve em fila-entrada/; pode demorar — espere terminar).
4. Responda só com a última linha do JSON de status ("status": concluido | falhou) e termine.
