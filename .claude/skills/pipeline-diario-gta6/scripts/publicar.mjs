#!/usr/bin/env node
// Envia os vídeos aprovados para a Zernio (pipeline.config.json → publicador: "zernio", ver zernio.mjs)
// ou para um webhook/API REST (publicador: "webhook": n8n, Make, Zapier, serviço próprio), que faz a postagem.
// Uso: node publicar.mjs <postagem.json> [--teste] [--so id1,id2] [--agora] [--agendar id1,id2] [--acima-do-teto]
//   --teste    valida e mostra o que seria enviado, sem enviar
//   --agora    publica já os aprovados (com --so, só esses), em vez de usar os horários de pico; item com
//              "ao_vivo": true (radar-ao-vivo.mjs) já é tratado assim sem precisar do --agora
//   --agendar  tira a urgência desses ids ("ao_vivo": false) e os encaixa nos horários de pico dos próximos dias
//   --acima-do-teto  confirma o envio imediato além do teto diário (só com o OK explícito do usuário)
// Envio imediato é escalonado para não sair tudo no mesmo segundo (pipeline.config.json → "ao_vivo"): o primeiro sai
// na hora se não houve outro envio imediato nos últimos 20 min; cada um dos seguintes é agendado 25 min depois do
// anterior; no máximo 4 por dia, contando o que já foi enviado em todos os postado.json do projeto.
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
import {RAIZ, carregarEnv, config, gravarJson, lerJson, salvarItens} from './env.mjs';
import {contasZernio, corpoPost, enviarZernio, alvoZernio} from './zernio.mjs';
import {agendaConfig, preencherHorarios} from './agendar.mjs';
import {moverParaPostados} from './para-postar.mjs';

carregarEnv();
const args = process.argv.slice(2);
const teste = args.includes('--teste');
const soIdx = args.indexOf('--so');
const so = soIdx >= 0 ? new Set(args[soIdx + 1].split(',')) : null;
const agendarIdx = args.indexOf('--agendar');
const paraFila = new Set(agendarIdx >= 0 ? String(args[agendarIdx + 1] || '').split(',').filter(Boolean) : []);
const arquivo = args.find((a, i) => !a.startsWith('--') && !['--so', '--agendar'].includes(args[i - 1]));
if (!arquivo) {
  console.error('Uso: node publicar.mjs <postagem.json> [--teste] [--so id1,id2] [--agora] [--agendar id1,id2] [--acima-do-teto]');
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

// ── envio imediato: corte do radar ("ao_vivo": true) ou chamada com --agora ──
// Fica fora da fila dos horários de pico, mas é escalonado (ver o cabeçalho). Continua valendo tudo o que vem depois:
// só sai com "aprovado": true (e o OK extra de quem não tem autorização).
const agora = args.includes('--agora');
const regra = {intervalo_min: 25, folga_min: 20, por_dia: 4, ...(config().ao_vivo || {})};
const fuso = agendaConfig().fuso;
const fusoMin = (fuso[0] === '-' ? -1 : 1) * (Number(fuso.slice(1, 3)) * 60 + Number(fuso.slice(4, 6)));
const isoNoFuso = (ms) => new Date(ms + fusoMin * 60e3).toISOString().slice(0, 19) + fuso;
const diaNoFuso = (ms) => isoNoFuso(ms).slice(0, 10);
const errosEscalonamento = [];

// --agendar: o item deixa de ser urgente e vai para a fila normal (agendar.mjs, logo abaixo)
for (const id of paraFila) if (!itens.some((it) => it.id === id)) errosEscalonamento.push(`--agendar: não existe item "${id}" neste postagem.json`);
for (const it of itens) {
  if (!paraFila.has(it.id)) continue;
  if (it.ao_vivo || it.publicar_agora) it.agendado_para = '';
  it.ao_vivo = false;
  it.publicar_agora = false;
}

// envios imediatos já feitos (este postado.json e os das outras pastas): quando cada um foi ou vai ao ar
function enviosImediatos(ignorar = new Set()) {
  const out = [];
  const daqui = path.resolve(registroFile);
  for (const pasta of ['cortes', 'compilados']) {
    const dir = path.join(RAIZ, pasta);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'postado.json');
      const reg = path.resolve(f) === daqui ? registro : lerJson(f, {});
      // publicação dupla: o mesmo corte (mesmo id) no TikTok e no YouTube conta como um envio só
      const vistos = new Set();
      for (const [chave, r] of Object.entries(reg)) {
        // registro antigo não tem "imediato": sem horário agendado, saiu na hora
        if (!r?.ok || !(r.imediato ?? !r.agendado_para)) continue;
        const id = chave.replace(/:[^:]+$/, '');
        // a outra metade de um corte que está saindo agora (reenvio de quem falhou): não empurra o próprio par
        if (vistos.has(id) || (path.resolve(f) === daqui && ignorar.has(id))) continue;
        vistos.add(id);
        const ms = Date.parse(r.sai_em || r.agendado_para || r.em);
        if (!Number.isNaN(ms)) out.push(ms);
      }
    }
  }
  return out;
}

// fora do --teste a mudança fica gravada mesmo que o item ainda não esteja aprovado (o --agendar não aprova nada)
if (paraFila.size && !teste && !errosEscalonamento.length) salvarItens(arquivo, itens);

const imediatos = itens.filter((it) => (!so || so.has(it.id)) && (agora || it.ao_vivo) && !paraFila.has(it.id));
for (const it of imediatos) {
  it.publicar_agora = true;
  it.agendado_para = ''; // o horário de quem sai já é sempre recalculado aqui
}
const escalonamento = [];
{
  const naVez = imediatos.filter((it) => it.aprovado && (!it.sem_autorizacao || (revisaoManual && it.aprovado_sem_autorizacao)) && !registro[`${it.id}:${it.plataforma}`]?.ok);
  if (naVez.length) {
    const feitos = enviosImediatos(new Set(naVez.map((it) => it.id)));
    const agoraMs = Date.now();
    const ultimo = feitos.length ? Math.max(...feitos) : null;
    const porDia = {};
    for (const ms of feitos) porDia[diaNoFuso(ms)] = (porDia[diaNoFuso(ms)] || 0) + 1;
    // null = sai na hora. Houve envio imediato há pouco (ou há um escalonado ainda por sair): entra na sequência dele,
    // nunca a menos de 16 min de agora (um horário agendado precisa de folga para o upload).
    let proximo = ultimo !== null && agoraMs - ultimo < regra.folga_min * 60e3 ? Math.max(ultimo + regra.intervalo_min * 60e3, agoraMs + 16 * 60e3) : null;
    const fora = [];
    // publicação dupla: os itens do mesmo corte (mesmo id, uma plataforma cada) saem juntos e contam como um envio
    const grupos = new Map();
    for (const it of naVez) (grupos.get(it.id) || grupos.set(it.id, []).get(it.id)).push(it);
    for (const [id, grupo] of grupos) {
      const quando = proximo ?? agoraMs;
      const dia = diaNoFuso(quando);
      if ((porDia[dia] || 0) >= regra.por_dia && !args.includes('--acima-do-teto')) {
        fora.push(id);
        continue;
      }
      porDia[dia] = (porDia[dia] || 0) + 1;
      for (const it of grupo) {
        if (proximo !== null) it.agendado_para = isoNoFuso(quando);
        escalonamento.push({id: it.id, plataforma: it.plataforma, sai: proximo === null ? 'agora' : it.agendado_para, em_minutos: Math.round((quando - agoraMs) / 60e3)});
      }
      proximo = quando + regra.intervalo_min * 60e3;
    }
    if (fora.length)
      errosEscalonamento.push(
        `teto de ${regra.por_dia} envios imediatos por dia: não cabe(m) ${fora.join(', ')}. Mande para os horários de pico com --agendar ${fora.join(',')} ou, com o OK explícito do usuário, repita com --acima-do-teto`,
      );
  }
}

// aprovados sem horário ganham o próximo horário de pico livre (agendar.mjs); no --teste só mostra a proposta
const agenda =await preencherHorarios(arquivo, itens, {so, gravar: !teste, registro});

const plano = [];
const erros = [...errosEscalonamento];
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
  console.log(JSON.stringify({ok: !erros.length, teste: true, publicador, destino, horarios_preenchidos: agenda.atribuidos, avisos_agenda: agenda.avisos, escalonamento, plano: resumo, ...(corpos ? {corpos} : {}), erros}, null, 2));
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
  // Publicação dupla: o mesmo arquivo serve ao item do TikTok e ao do YouTube; só sai de para-postar/ quando todos os
  // itens que usam o arquivo foram enviados (aí o caminho novo vale para todos eles)
  const irmaos = itens.filter((o) => o !== p.item && !o.descartado && path.resolve(base, o.arquivo || '') === p.arquivo);
  const faltaIrmao = irmaos.some((o) => !registro[`${o.id}:${o.plataforma}`]?.ok);
  if (r.ok && !faltaIrmao) {
    const novo = moverParaPostados(p.arquivo);
    if (novo) {
      const rel = path.relative(base, novo);
      for (const o of [p.item, ...irmaos]) {
        o.arquivo = rel;
        const k = `${o.id}:${o.plataforma}`;
        if (registro[k]) registro[k].arquivo = rel;
      }
      r.movido_para = path.relative(RAIZ, novo);
    }
  } else if (r.ok) r.aguardando = 'o vídeo fica em para-postar/ até a outra plataforma deste corte ser enviada';
  const em = new Date().toISOString();
  // "imediato" e "sai_em" alimentam o escalonamento dos próximos envios (intervalo de 25 min e teto por dia)
  registro[p.chave] = {...r, em, arquivo: p.item.arquivo, agendado_para: p.item.agendado_para || null, imediato: !!p.item.publicar_agora, sai_em: p.item.agendado_para || em};
  gravarJson(registroFile, registro);
  // só os itens deste processo: um corte que o radar acrescentou durante o upload continua no arquivo
  salvarItens(arquivo, itens);
  resultados.push({chave: p.chave, ...r});
}
console.log(JSON.stringify({horarios_preenchidos: agenda.atribuidos, escalonamento, enviados: resultados, pulados: resumo.filter((x) => x.acao === 'pular')}, null, 2));
process.exit(resultados.every((r) => r.ok) ? 0 : 1);
