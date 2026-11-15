#!/usr/bin/env node
// Envia os vídeos aprovados para a Zernio (pipeline.config.json → publicador: "zernio", ver zernio.mjs)
// ou para um webhook/API REST (publicador: "webhook": n8n, Make, Zapier, serviço próprio), que faz a postagem.
// Uso: node publicar.mjs <postagem.json> [--teste] [--so id1,id2] [--agora]
//   --teste  valida e mostra o que seria enviado, sem enviar
//   --agora  publica na hora os aprovados (com --so, só esses), em vez de usar os horários de pico; item com
//            "ao_vivo": true (radar-ao-vivo.mjs) já sai na hora sem precisar do --agora
// Ambiente (ou <projeto>/.env): zernio → ZERNIO_API_KEY (+ ZERNIO_TIKTOK_ACCOUNT_ID/ZERNIO_YOUTUBE_ACCOUNT_ID opcionais);
//   webhook → POST_API_URL (obrigatória), POST_API_KEY (vai como "Authorization: Bearer ...").
//
// postagem.json (o pipeline grava depois da tabela de publicação):
// {"itens": [{"id": "tt-01-predio-secreto", "arquivo": "../../para-postar/<live>--tt-01-predio-secreto.mp4",  relativo ao postagem.json (para-postar.mjs)
//             "plataforma": "tiktok" | "youtube_short" | "youtube_longo",
//             "titulo": "...", "descricao": "...", "hashtags": ["#gta6", "#gtavi"],
//             "agendado_para": "2026-11-16T18:00:00-03:00",   ISO com fuso; vazio = próximo horário de pico livre (agendar.mjs)
//             "publicar_agora": false, "nota": 86, "assunto": "combustível",     opcionais: postar já / ordem / não repetir no dia
//             "aprovado": true,                                                        OK do usuário na tabela
//             "sem_autorizacao": false, "aprovado_sem_autorizacao": false }]}           ver modo_revisao_manual
//
// zernio: o .mp4 sobe por URL pré-assinada e vira um post agendado (scheduledFor) ou imediato (publishNow).
//   TikTok: legenda = titulo + descricao + hashtags. YouTube: título = titulo, descrição = descricao + hashtags.
// webhook: cada item vira um POST multipart/form-data com os campos:
//   arquivo (o .mp4), titulo, descricao, hashtags (separadas por espaço: "#gta6 #gtavi"), plataforma, agendado_para, id
// e o cabeçalho Idempotency-Key = <id>:<plataforma>. Resposta 2xx = enviado. 429/5xx/erro de rede: 3 tentativas.
// O que foi enviado fica em postado.json (ao lado do postagem.json) e não é reenviado; o .mp4 enviado com sucesso é movido
// de <projeto>/para-postar/ para <projeto>/postados/ e o caminho é atualizado no postado.json e no postagem.json.
import fs from 'node:fs';
import path from 'node:path';
import {RAIZ, carregarEnv, config, lerJson} from './env.mjs';
import {contasZernio, corpoPost, enviarZernio, alvoZernio} from './zernio.mjs';
import {preencherHorarios} from './agendar.mjs';
import {moverParaPostados} from './para-postar.mjs';

carregarEnv();
const args = process.argv.slice(2);
const teste = args.includes('--teste');
const soIdx = args.indexOf('--so');
const so = soIdx >= 0 ? new Set(args[soIdx + 1].split(',')) : null;
const arquivo = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--so');
if (!arquivo) {
  console.error('Uso: node publicar.mjs <postagem.json> [--teste] [--so id1,id2]');
  process.exit(1);
}
// rodada automática (rodar-diario.sh → claude -p): publicar exige o OK humano da tabela, então ali só vale --teste
if (process.env.PIPELINE_HEADLESS && !teste) {
  console.error('Rodada automática (PIPELINE_HEADLESS): publicação bloqueada. Rode --teste aqui e publique numa sessão com o usuário.');
  process.exit(3);
}
const base = path.dirname(path.resolve(arquivo));
const doc = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const itens = doc.itens || [];
// lote de teste (calibração do pipeline ou --simular do radar ao vivo): nunca é publicado
if (doc.calibracao && !teste) {
  console.error('Este postagem.json é de calibração ("calibracao": true): material de teste não é publicado.');
  process.exit(1);
}
const registroFile = path.join(base, 'postado.json');
const registro = lerJson(registroFile, {});
const revisaoManual = !!config().modo_revisao_manual;
const PLATS = ['tiktok', 'youtube_short', 'youtube_longo'];
const publicador = config().publicador || 'webhook';
if (!['zernio', 'webhook'].includes(publicador)) {
  console.error(`publicador "${publicador}" não é tratado por este script (use zernio ou webhook; maquina = kit do motor)`);
  process.exit(1);
}

// corte do radar ao vivo ("ao_vivo": true) ou chamada com --agora: sai na hora, fora da fila dos horários de pico.
// Continua valendo tudo o que vem depois: só sai com "aprovado": true (e o OK extra de quem não tem autorização).
const agora = args.includes('--agora');
for (const it of itens) {
  if ((so && !so.has(it.id)) || !(agora || it.ao_vivo)) continue;
  it.publicar_agora = true;
  it.agendado_para = '';
}

// aprovados sem horário ganham o próximo horário de pico livre (agendar.mjs); no --teste só mostra a proposta
const agenda =await preencherHorarios(arquivo, itens, {so, gravar: !teste, registro});

const plano = [];
const erros = [];
for (const it of itens) {
  if (so && !so.has(it.id)) continue;
  const chave = `${it.id}:${it.plataforma}`;
  const onde = `[${chave}]`;
  const motivo = (m) => plano.push({chave, acao: 'pular', motivo: m});
  if (registro[chave]?.ok) {
    motivo('já enviado');
    continue;
  }
  if (!it.aprovado) {
    motivo('sem OK na tabela');
    continue;
  }
  if (it.sem_autorizacao && !(revisaoManual && it.aprovado_sem_autorizacao)) {
    motivo(revisaoManual ? 'sem autorização: falta o OK manual deste item (aprovado_sem_autorizacao)' : 'sem autorização e modo_revisao_manual desligado');
    continue;
  }
  const f = path.resolve(base, it.arquivo || '');
  if (!it.arquivo || !fs.existsSync(f)) erros.push(`${onde} arquivo não encontrado: ${it.arquivo}`);
  if (!PLATS.includes(it.plataforma)) erros.push(`${onde} plataforma inválida (${PLATS.join(' | ')})`);
  if (!it.titulo) erros.push(`${onde} falta titulo`);
  // corte do radar ao vivo nasce com um rascunho de título tirado da fala: não vai ao ar sem o título definitivo
  if (it.titulo_provisorio) erros.push(`${onde} título ainda é o rascunho automático: escreva o definitivo e tire "titulo_provisorio"`);
  if (publicador === 'zernio' && it.plataforma !== 'tiktok' && (it.titulo || '').length > 100) erros.push(`${onde} titulo do YouTube passa de 100 caracteres`);
  if (it.agendado_para) {
    if (!/[+-]\d{2}:\d{2}$|Z$/.test(it.agendado_para) || Number.isNaN(Date.parse(it.agendado_para))) erros.push(`${onde} agendado_para precisa ser ISO com fuso (ex.: 2026-11-16T18:00:00-03:00)`);
    else if (Date.parse(it.agendado_para) < Date.now() + 15 * 60e3) erros.push(`${onde} agendado_para precisa estar pelo menos 15 min no futuro`);
  }
  if (!Array.isArray(it.hashtags) || it.hashtags.some((h) => !/^#[\p{L}\p{N}_]+$/u.test(h))) erros.push(`${onde} hashtags devem ser uma lista de "#tag"`);
  plano.push({chave, acao: 'enviar', arquivo: f, item: it});
}

const url = process.env.POST_API_URL;
let contas = {};
let destino = null;
if (publicador === 'zernio') {
  const z = await contasZernio();
  contas = z.contas;
  erros.push(...z.erros);
  destino = `zernio (tiktok: ${contas.tiktok_nome || '—'}, youtube: ${contas.youtube_nome || '—'})`;
  for (const p of plano.filter((x) => x.acao === 'enviar')) {
    if (!z.erros.length && !contas[alvoZernio(p.item.plataforma)]) erros.push(`[${p.chave}] nenhuma conta ${alvoZernio(p.item.plataforma)} conectada na Zernio`);
  }
} else {
  if (!url && !teste) erros.push('POST_API_URL não definida (ambiente ou .env)');
  destino = url ? new URL(url).host : null;
}
const resumo = plano.map(({chave, acao, motivo, item}) => ({chave, acao, ...(motivo ? {motivo} : {}), ...(item ? {titulo: item.titulo, quando: item.agendado_para || 'agora', sem_autorizacao: !!item.sem_autorizacao} : {})}));
if (teste || erros.length) {
  const corpos = teste && publicador === 'zernio' && !erros.length ? plano.filter((x) => x.acao === 'enviar').map((p) => ({chave: p.chave, corpo: corpoPost(p.item, contas)})) : undefined;
  console.log(JSON.stringify({ok: !erros.length, teste: true, publicador, destino, horarios_preenchidos: agenda.atribuidos, avisos_agenda: agenda.avisos, plano: resumo, ...(corpos ? {corpos} : {}), erros}, null, 2));
  process.exit(erros.length ? 1 : 0);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function enviar({chave, arquivo: f, item}) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const form = new FormData();
    form.append('arquivo', new Blob([fs.readFileSync(f)], {type: 'video/mp4'}), path.basename(f));
    form.append('titulo', item.titulo);
    form.append('descricao', item.descricao || '');
    form.append('hashtags', (item.hashtags || []).join(' '));
    form.append('plataforma', item.plataforma);
    form.append('agendado_para', item.agendado_para || '');
    form.append('id', item.id);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {...(process.env.POST_API_KEY ? {Authorization: `Bearer ${process.env.POST_API_KEY}`} : {}), 'Idempotency-Key': chave},
        body: form,
        signal: AbortSignal.timeout(10 * 60e3),
      });
      const corpo = (await r.text()).slice(0, 2000);
      let resposta = corpo;
      try {
        resposta = JSON.parse(corpo);
      } catch {}
      if (r.ok) return {ok: true, status: r.status, resposta};
      if (r.status !== 429 && r.status < 500) return {ok: false, status: r.status, resposta};
      if (tentativa === 3) return {ok: false, status: r.status, resposta};
    } catch (e) {
      if (tentativa === 3) return {ok: false, erro: e.message};
    }
    await esperar(5000 * tentativa);
  }
}

const resultados = [];
for (const p of plano.filter((x) => x.acao === 'enviar')) {
  const r = publicador === 'zernio' ? await enviarZernio(p, contas) : await enviar(p);
  // enviado com sucesso: o vídeo sai de para-postar/ e vai para postados/ (falhou: fica em para-postar/ para nova tentativa)
  if (r.ok) {
    const novo = moverParaPostados(p.arquivo);
    if (novo) {
      p.item.arquivo = path.relative(base, novo);
      r.movido_para = path.relative(RAIZ, novo);
    }
  }
  registro[p.chave] = {...r, em: new Date().toISOString(), arquivo: p.item.arquivo, agendado_para: p.item.agendado_para || null};
  fs.writeFileSync(registroFile, JSON.stringify(registro, null, 2));
  doc.itens = itens;
  fs.writeFileSync(arquivo, JSON.stringify(doc, null, 2));
  resultados.push({chave: p.chave, ...r});
}
console.log(JSON.stringify({horarios_preenchidos: agenda.atribuidos, enviados: resultados, pulados: resumo.filter((x) => x.acao === 'pular')}, null, 2));
process.exit(resultados.every((r) => r.ok) ? 0 : 1);
