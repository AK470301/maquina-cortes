#!/usr/bin/env node
// Valida o plano gerado por estrategia-tiktok-gta6 / estrategia-youtube-gta6 e faz o roteamento para as skills de edição.
// Uso:
//   node plano.mjs validar <plano.json> [<plano2.json> ...]           confere campos, durações, rota, sobreposição
//   node plano.mjs cuts <layout> <saida-cuts.json> <plano.json> [...]  grava um cuts.json só com os cortes desse layout
//                                                                     (gameplay | papo | cheia), pronto para a skill de edição,
//                                                                     com o título de topo e os sons dele (assets/sfx)
// Sai com código 1 se houver erro.
import fs from 'node:fs';
import path from 'node:path';
import {RAIZ, config} from './env.mjs';

const ROTA = {gameplay: 'cortes-gameplay', papo: 'cortes-papo'};
// Regra do B-roll: o fundo de assets/broll-gta6 (layout "papo") só entra quando a fala do trecho é sobre GTA 6
// ("sobre_gta6": true). Papo sobre outro assunto (GTA RP, react, IRL, resenha) fica só com o vídeo da live em tela
// cheia: layout "cheia", editado pela cortes-video. Corte "gameplay" não usa B-roll: mostra a própria tela da live.
const ROTA_LAYOUT = {gameplay: 'cortes-gameplay', papo: 'cortes-papo', cheia: 'cortes-video'};
const layoutDe = (c) => (c.tipo === 'gameplay' ? 'gameplay' : c.sobre_gta6 === false ? 'cheia' : 'papo');
// duração FINAL (depois de o build.mjs tirar as pausas) e janela BRUTA aceita na origem
const PLATAFORMA = {
  tiktok: {final: [62, 85], bruta: [64, 100], prefixo: 'tt-', hashtags: [3, 5], titulo: 90},
  youtube_short: {final: [35, 58], bruta: [36, 68], prefixo: 'yt-', hashtags: [3, 3], titulo: 60},
};
const TITULO_TOPO_MAX = 6; // palavras
const SFX_TITULO = ['impacto.wav', 'whoosh.wav'].map((f) => path.join(RAIZ, 'assets', 'sfx', f));
const CAMPOS = ['id', 'plataforma', 'tipo', 'skill_edicao', 'timestamp_inicio', 'timestamp_fim', 'nota_viralidade', 'titulo_topo_tela', 'titulo_seo', 'hashtags', 'edicao'];

const seg = (ts) => {
  const m = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(ts || ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};
const ler = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cortesDe = (planos) =>
  planos.flatMap((f) => {
    const p = ler(f);
    return [...(p.cortes || []), ...(p.shorts || [])].map((c) => ({...c, _plano: f, _autorizacao: p.autorizacao, _streamer: p.streamer}));
  });

function validar(arquivos) {
  const erros = [];
  const avisos = [];
  const cortes = cortesDe(arquivos);
  const ids = new Set();
  for (const c of cortes) {
    const onde = `[${c.id || '?'}]`;
    for (const k of CAMPOS) if (c[k] === undefined || c[k] === null || c[k] === '') erros.push(`${onde} falta "${k}"`);
    if (c.roteiro_hook_tts || c.comentarios_tts) erros.push(`${onde} campos de narração TTS não existem mais (roteiro_hook_tts/comentarios_tts): use titulo_topo_tela`);
    const P = PLATAFORMA[c.plataforma];
    if (!P) {
      erros.push(`${onde} plataforma "${c.plataforma}" inválida (tiktok | youtube_short)`);
      continue;
    }
    if (ids.has(c.id)) erros.push(`${onde} id repetido`);
    ids.add(c.id);
    if (!String(c.id).startsWith(P.prefixo)) erros.push(`${onde} id de ${c.plataforma} deve começar com "${P.prefixo}"`);
    if (!ROTA[c.tipo]) erros.push(`${onde} tipo "${c.tipo}" inválido (gameplay | papo)`);
    if (typeof c.sobre_gta6 !== 'boolean') erros.push(`${onde} falta "sobre_gta6" (true | false): a fala do trecho é sobre GTA 6? Decide o B-roll e as hashtags`);
    const e = c.edicao || {};
    if (e.id !== c.id) erros.push(`${onde} edicao.id deve ser igual ao id do corte`);
    const layoutEsperado = layoutDe(c);
    if (e.layout !== layoutEsperado) erros.push(`${onde} edicao.layout deve ser "${layoutEsperado}"${layoutEsperado === 'cheia' ? ' (papo que não é sobre GTA 6 não leva B-roll de GTA 6)' : ''}`);
    if (ROTA[c.tipo] && c.skill_edicao !== ROTA_LAYOUT[layoutEsperado]) erros.push(`${onde} layout "${layoutEsperado}" deve ir para "${ROTA_LAYOUT[layoutEsperado]}", não "${c.skill_edicao}"`);
    if (c.sobre_gta6 === false && (c.hashtags || []).some((h) => /^#gta(6|vi)$/i.test(h))) erros.push(`${onde} hashtag de GTA 6 num corte que não é sobre GTA 6`);
    if (e.titulo !== c.titulo_topo_tela) erros.push(`${onde} edicao.titulo deve ser igual a titulo_topo_tela`);
    const ini = seg(c.timestamp_inicio);
    const fim = seg(c.timestamp_fim);
    if (Number.isNaN(ini) || Number.isNaN(fim)) erros.push(`${onde} timestamps devem estar em HH:MM:SS(.s)`);
    else {
      if (Math.abs(ini - e.start) > 0.6 || Math.abs(fim - e.end) > 0.6) erros.push(`${onde} timestamp_inicio/fim não batem com edicao.start/end (${ini}/${fim} vs ${e.start}/${e.end})`);
      const bruta = e.end - e.start;
      if (bruta < P.bruta[0] || bruta > P.bruta[1]) erros.push(`${onde} janela bruta de ${bruta.toFixed(1)} s fora de ${P.bruta[0]}–${P.bruta[1]} s (final precisa dar ${P.final[0]}–${P.final[1]} s)`);
    }
    if (!(c.nota_viralidade >= 0 && c.nota_viralidade <= 100)) erros.push(`${onde} nota_viralidade deve ser 0–100`);
    if (!(e.nota >= 6 && e.nota <= 10)) erros.push(`${onde} edicao.nota (nota do gancho, 0–10) precisa ser ≥ 6`);
    if (!Array.isArray(e.keywords) || e.keywords.length < 2 || e.keywords.length > 5) erros.push(`${onde} edicao.keywords: de 2 a 5`);
    if (Array.isArray(e.turns)) for (const t of e.turns) if (t < e.start || t > e.end) erros.push(`${onde} turn ${t} fora do corte`);
    const palavras = String(c.titulo_topo_tela || '').trim().split(/\s+/).filter(Boolean).length;
    if (palavras > TITULO_TOPO_MAX) erros.push(`${onde} titulo_topo_tela com ${palavras} palavras (máx. ${TITULO_TOPO_MAX})`);
    if (String(c.titulo_seo || '').length > P.titulo) erros.push(`${onde} titulo_seo com mais de ${P.titulo} caracteres`);
    const h = Array.isArray(c.hashtags) ? c.hashtags : [];
    if (h.length < P.hashtags[0] || h.length > P.hashtags[1]) erros.push(`${onde} ${h.length} hashtags (esperado ${P.hashtags.join('–')})`);
    if (h.some((x) => !/^#[\p{L}\p{N}_]+$/u.test(x))) erros.push(`${onde} hashtag mal formada`);
    if (c.plataforma === 'youtube_short' && !h.includes('#shorts')) erros.push(`${onde} Short precisa de #shorts`);
    if (c._autorizacao === 'proibido') erros.push(`${onde} streamer com status "proibido": não entra em plano nenhum`);
    if (c._autorizacao === 'nao_verificado' && !c.bloqueado_publicacao) {
      // modo_revisao_manual (pipeline.config.json): o corte segue, mas só sai com OK item a item na tabela de publicação
      if (config().modo_revisao_manual) avisos.push(`${onde} streamer sem autorização registrada: publicação só com OK manual deste item`);
      else erros.push(`${onde} streamer não verificado: bloqueado_publicacao deve ser true (ou ative modo_revisao_manual)`);
    }
    if ((c.riscos || []).includes('musica_licenciada')) erros.push(`${onde} música licenciada audível: o motor não separa a trilha; descarte ou troque o trecho`);
    if (c.contem_spoiler) avisos.push(`${onde} tem spoiler: título de topo começa com "SPOILER" e nada de spoiler no título/capa`);
  }
  const porPlat = {};
  for (const c of cortes) (porPlat[`${c._plano}|${c.plataforma}`] ||= []).push(c);
  for (const lista of Object.values(porPlat)) {
    const ord = lista.filter((c) => c.edicao).sort((a, b) => a.edicao.start - b.edicao.start);
    for (let i = 1; i < ord.length; i++)
      if (ord[i].edicao.start < ord[i - 1].edicao.end) erros.push(`[${ord[i].id}] sobrepõe [${ord[i - 1].id}] na mesma plataforma`);
  }
  for (const f of SFX_TITULO) if (!fs.existsSync(f)) avisos.push(`falta ${f}: o título entra sem som`);
  return {cortes, erros, avisos};
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'validar') {
  const {cortes, erros, avisos} = validar(rest);
  const resumo = cortes.map((c) => ({id: c.id, plataforma: c.plataforma, tipo: c.tipo, skill: c.skill_edicao, layout: c.edicao?.layout, sobre_gta6: c.sobre_gta6, bruta_s: c.edicao ? +(c.edicao.end - c.edicao.start).toFixed(1) : null, nota: c.nota_viralidade, titulo_topo: c.titulo_topo_tela, bloqueado: !!c.bloqueado_publicacao}));
  console.log(JSON.stringify({ok: !erros.length, cortes: resumo, erros, avisos}, null, 2));
  process.exit(erros.length ? 1 : 0);
} else if (cmd === 'cuts') {
  const [tipo, saida, ...planos] = rest;
  if (!ROTA_LAYOUT[tipo] || !saida || !planos.length) {
    console.error('Uso: node plano.mjs cuts <gameplay|papo|cheia> <saida-cuts.json> <plano.json> [...]');
    process.exit(1);
  }
  const {cortes, erros} = validar(planos);
  if (erros.length) {
    console.error(erros.join('\n'));
    process.exit(1);
  }
  const doTipo = cortes.filter((c) => layoutDe(c) === tipo);
  const streamers = [...new Set(doTipo.map((c) => c._streamer))];
  if (streamers.length > 1) {
    console.error(`Cortes de streamers diferentes (${streamers.join(', ')}): um cuts.json por live.`);
    process.exit(1);
  }
  const sfx = SFX_TITULO.filter((f) => fs.existsSync(f));
  const cuts = {layout: tipo, streamer: streamers[0] || null, clips: doTipo.map((c) => ({...c.edicao, tituloDur: 4, tituloSfx: sfx}))};
  fs.mkdirSync(path.dirname(path.resolve(saida)), {recursive: true});
  fs.writeFileSync(saida, JSON.stringify(cuts, null, 2));
  console.log(JSON.stringify({skill: ROTA_LAYOUT[tipo], arquivo: saida, clips: cuts.clips.map((c) => c.id)}));
} else {
  console.error('Comandos: validar | cuts (veja o cabeçalho do arquivo)');
  process.exit(1);
}
