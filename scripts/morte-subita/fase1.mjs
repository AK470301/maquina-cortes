#!/usr/bin/env node
// Modo Morte Súbita — FASE 1 do cron (rodada pelo claude-free; o rodar-cron.ps1 roda --auto se ele falhar).
// Busca geral no YouTube pelos vídeos mais vistos sobre "GTA 6" e "GTA VI" (busca ordenada por visualizações, com
// --extractor-args youtube:lang=pt), publicados nos últimos 6 meses (--dateafter today-6months), e aplica APENAS o filtro
// de idioma: o vídeo precisa estar em português (comum.mjs → idiomaDoVideo). Também ficam de fora: live ainda em
// andamento/agendada, id já em logs/processados.txt e vídeo com menos de 21 s (não cabe um corte de 20–55 s).
// Nenhuma outra restrição de canal, formato ou tema.
//
// Uso: node scripts/morte-subita/fase1.mjs --teste                 teste seco: mostra os 3 que seriam escolhidos; não grava nada
//      node scripts/morte-subita/fase1.mjs --buscar [--rodada R]   grava fila-entrada/fase1-candidatos.json (3 escolhidos + reservas)
//      node scripts/morte-subita/fase1.mjs --preparar id1,id2,id3 --rodada R   grava os ids em logs/processados.txt, baixa e
//                                                                   transcreve em fila-entrada/ (fila-entrada/fase1.json = resultado)
//      node scripts/morte-subita/fase1.mjs --auto --rodada R       retoma entradas incompletas + --buscar + --preparar dos 3
// Opções: --quantos 3, --max-verificar 200 (vídeos extraídos por completo até achar os 3), --por-busca 200
import fs from 'node:fs';
import path from 'node:path';
import {FILA_ENTRADA, gravarProcessado, idiomaDoVideo, lerJson, lerProcessados, log, rodar} from './comum.mjs';
import {ARGS_YT, prepararVideo, retomarIncompletos} from './preparar.mjs';

const a = process.argv.slice(2);
const opt = (k, p = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : p);
const QUANTOS = Number(opt('--quantos', 3));
const RESERVAS = 3;
const MAX_VERIFICAR = Number(opt('--max-verificar', 200));
const POR_BUSCA = Number(opt('--por-busca', 200));
const RODADA = opt('--rodada', process.env.MS_RODADA || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
const BUSCAS = ['GTA 6', 'GTA VI'];
const F_CANDIDATOS = path.join(FILA_ENTRADA, 'fase1-candidatos.json');
const F_RESULTADO = path.join(FILA_ENTRADA, 'fase1.json');

// janela de 6 meses, igual ao --dateafter today-6months do yt-dlp
const limite = new Date();
limite.setMonth(limite.getMonth() - 6);
const DATA_MIN = limite.toISOString().slice(0, 10).replace(/-/g, '');

const urlBusca = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAM%253D`; // CAM= : ordenar por visualizações

async function listarBusca(q) {
  const r = await rodar('yt-dlp', ['--flat-playlist', '-J', '--playlist-end', String(POR_BUSCA), '--extractor-args', 'youtube:lang=pt', urlBusca(q)], {timeoutMs: 180e3});
  if (r.status !== 0) throw new Error(`busca "${q}" falhou: ${r.err.trim().split('\n').pop()}`);
  return (JSON.parse(r.out).entries || []).map((e) => ({...e, busca: q}));
}

async function completo(id) {
  // --dateafter today-6months: fora da janela o yt-dlp não devolve nada (saída vazia)
  const r = await rodar('yt-dlp', ['-J', '--skip-download', '--ignore-no-formats-error', '--dateafter', 'today-6months', ...ARGS_YT, `https://www.youtube.com/watch?v=${id}`], {timeoutMs: 120e3});
  if (r.status !== 0) return {erro: r.err.trim().split('\n').pop() || `yt-dlp ${r.status}`};
  const txt = r.out.trim();
  if (!txt || txt === 'null') return {foraDaJanela: true};
  return {info: JSON.parse(txt)};
}

export async function buscar() {
  const ja = lerProcessados();
  const listas = await Promise.all(BUSCAS.map(listarBusca));
  const porId = new Map();
  for (const e of listas.flat()) if (!porId.has(e.id)) porId.set(e.id, e);
  const descartados = [];
  const fila = [];
  for (const e of porId.values()) {
    if (!/^[\w-]{11}$/.test(e.id || '')) descartados.push({id: e.id, titulo: e.title, motivo: 'não é vídeo (playlist/canal)'});
    else if (['is_live', 'is_upcoming'].includes(e.live_status)) descartados.push({id: e.id, titulo: e.title, motivo: `live ${e.live_status === 'is_live' ? 'em andamento' : 'agendada'}`});
    else if (ja.has(e.id)) descartados.push({id: e.id, titulo: e.title, motivo: 'já processado (logs/processados.txt)'});
    else fila.push(e);
  }
  fila.sort((x, y) => (y.view_count || 0) - (x.view_count || 0));
  const escolhidos = [];
  let verificados = 0;
  // extração completa em lotes de 6, na ordem de visualizações, até ter os escolhidos + reservas
  for (let i = 0; i < fila.length && escolhidos.length < QUANTOS + RESERVAS && verificados < MAX_VERIFICAR; i += 6) {
    const lote = fila.slice(i, Math.min(i + 6, fila.length, i + (MAX_VERIFICAR - verificados)));
    verificados += lote.length;
    const res = await Promise.all(lote.map((e) => completo(e.id)));
    lote.forEach((e, k) => {
      const {info, erro, foraDaJanela} = res[k];
      const base = {id: e.id, titulo: info?.title || e.title, canal: info?.channel || e.channel, views: info?.view_count ?? e.view_count};
      if (erro) return descartados.push({...base, motivo: `erro ao ler metadados: ${erro}`});
      if (foraDaJanela || (info.upload_date && info.upload_date < DATA_MIN)) return descartados.push({...base, motivo: 'publicado há mais de 6 meses'});
      if (['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) return descartados.push({...base, motivo: `live não terminada (${info.live_status})`});
      // restrito por idade / só para membros: sem login o yt-dlp não lê formatos nem idioma e não baixa (cookies do
      // navegador só com pedido explícito do usuário) — limite técnico, não de conteúdo
      if (info.availability === 'needs_auth' || info.availability === 'subscriber_only' || info.availability === 'premium_only' || !(info.formats || []).length)
        return descartados.push({...base, motivo: `não baixável sem login (${info.availability || 'sem formatos'}${info.age_limit ? `, ${info.age_limit}+` : ''})`});
      if (!(info.duration >= 21)) return descartados.push({...base, motivo: `curto demais para um corte de 20–55 s (${info.duration ?? '?'} s)`});
      const lingua = idiomaDoVideo(info);
      if (!lingua.pt) return descartados.push({...base, motivo: `não está em português (${lingua.idioma}; ${lingua.evidencia})`});
      escolhidos.push({...base, url: info.webpage_url, publicado: info.upload_date, duracao_s: info.duration, idioma: lingua.idioma, evidencia: lingua.evidencia, busca: e.busca, _info: info});
    });
  }
  escolhidos.sort((x, y) => (y.views || 0) - (x.views || 0));
  return {rodada: RODADA, janela_desde: DATA_MIN, resultados_busca: porId.size, verificados, selecionados: escolhidos.slice(0, QUANTOS), reservas: escolhidos.slice(QUANTOS), descartados};
}

const semInfo = ({_info, ...c}) => c;

async function preparar(ids, candidatos) {
  const doc = {rodada: RODADA, inicio: new Date().toISOString(), status: 'preparando', selecionados: [], preparados: [], falhas: []};
  const gravar = () => fs.writeFileSync(F_RESULTADO, JSON.stringify(doc, null, 2));
  const todos = [...(candidatos?.selecionados || []), ...(candidatos?.reservas || [])];
  for (const id of ids) {
    const c = todos.find((x) => x.id === id) || {id, url: `https://www.youtube.com/watch?v=${id}`};
    doc.selecionados.push(semInfo(c));
  }
  gravar();
  for (const c of doc.selecionados) {
    gravarProcessado(c.id, c.titulo || ''); // grava ANTES de baixar: um vídeo que quebra o download não volta toda rodada
    try {
      const info = todos.find((x) => x.id === c.id)?._info || null;
      const r = await prepararVideo(c.url || `https://www.youtube.com/watch?v=${c.id}`, {origem: 'cron', rodada: RODADA, info});
      doc.preparados.push({id: c.id, slug: r.slug, titulo: c.titulo});
    } catch (e) {
      log(`[fase1] ${c.id}: ${e.message}`);
      doc.falhas.push({id: c.id, titulo: c.titulo, erro: e.message});
    }
    gravar();
  }
  doc.status = doc.preparados.length ? 'concluido' : 'falhou';
  doc.fim = new Date().toISOString();
  gravar();
  return doc;
}

function semSelecao(cand) {
  const doc = {rodada: RODADA, inicio: new Date().toISOString(), fim: new Date().toISOString(), status: 'vazio', selecionados: [], preparados: [], falhas: [], verificados: cand.verificados};
  fs.writeFileSync(F_RESULTADO, JSON.stringify(doc, null, 2));
  return doc;
}

const resumo = (c) => ({rodada: c.rodada, janela_desde: c.janela_desde, resultados_busca: c.resultados_busca, verificados: c.verificados, selecionados: c.selecionados.map(semInfo), reservas: c.reservas.map(semInfo), descartados_por_motivo: Object.entries(c.descartados.reduce((n, d) => ((n[d.motivo.replace(/ \(.*$|:.*$/, '')] = (n[d.motivo.replace(/ \(.*$|:.*$/, '')] || 0) + 1), n), {})).map(([m, n]) => `${n} × ${m}`)});

try {
  if (a.includes('--teste')) {
    console.log(JSON.stringify({teste_seco: true, ...resumo(await buscar())}, null, 2));
  } else if (a.includes('--buscar')) {
    const c = await buscar();
    fs.writeFileSync(F_CANDIDATOS, JSON.stringify(c, null, 2));
    if (!c.selecionados.length) semSelecao(c);
    console.log(JSON.stringify({...resumo(c), gravado: F_CANDIDATOS}, null, 2));
  } else if (a.includes('--preparar')) {
    const ids = String(opt('--preparar', '')).split(',').map((s) => s.trim()).filter(Boolean).slice(0, QUANTOS);
    if (!ids.length) throw new Error('--preparar precisa de ids separados por vírgula');
    const cand = lerJson(F_CANDIDATOS, null);
    console.log(JSON.stringify(await preparar(ids, cand), null, 2));
  } else if (a.includes('--auto')) {
    const retomados = await retomarIncompletos();
    const c = await buscar();
    fs.writeFileSync(F_CANDIDATOS, JSON.stringify(c, null, 2));
    const doc = c.selecionados.length ? await preparar(c.selecionados.map((x) => x.id), c) : semSelecao(c);
    console.log(JSON.stringify({...doc, retomados}, null, 2));
  } else {
    console.error('Uso: fase1.mjs --teste | --buscar | --preparar id1,id2 --rodada R | --auto --rodada R');
    process.exit(1);
  }
} catch (e) {
  log(`[fase1] erro: ${e.message}`);
  console.log(JSON.stringify({ok: false, erro: e.message}));
  process.exit(1);
}
