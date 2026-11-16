#!/usr/bin/env node
// Preenche o "agendado_para" dos itens aprovados que estão sem horário, nos horários de pico (pipeline.config.json →
// "agenda"): por padrão 12:00, 18:00 e 21:00 BRT, no máximo 3 por dia por plataforma (TikTok e Shorts), e o compilado
// 16:9 às 20:00 (1 por dia). Não encavala: considera ocupados os posts já agendados na Zernio e os itens aprovados com
// horário em todos os postagem.json do projeto (cortes/*/ e compilados/*/). O que não cabe no dia vai para o seguinte.
// Ordem: maior "nota" primeiro; dois itens com o mesmo "assunto" não caem no mesmo dia da mesma plataforma.
// Item com "publicar_agora": true não é tocado (sai na hora). Item com horário manual é respeitado.
// Uso: node agendar.mjs <postagem.json> [--so id1,id2] [--teste]   (--teste mostra a proposta sem gravar)
// Como módulo: preencherHorarios(arquivo, itens, {gravar}) — o publicar.mjs chama antes de enviar.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RAIZ, carregarEnv, config, lerJson, salvarItens} from './env.mjs';
import {postsAgendadosZernio} from './zernio.mjs';

const PADRAO = {horarios: ['12:00', '18:00', '21:00'], horario_longo: '20:00', fuso: '-03:00', por_dia: {tiktok: 3, youtube_short: 3, youtube_longo: 1}, antecedencia_min: 30, dias_max: 30};

export function agendaConfig() {
  const a = config().agenda || {};
  return {...PADRAO, ...a, por_dia: {...PADRAO.por_dia, ...(a.por_dia || {})}};
}

// relógio no fuso da agenda ("-03:00"): "YYYY-MM-DD" e "HH:MM"
const offsetMin = (fuso) => {
  const [, s, h, m] = /([+-])(\d{2}):(\d{2})/.exec(fuso);
  return (s === '-' ? -1 : 1) * (Number(h) * 60 + Number(m));
};
const noFuso = (ms, fuso) => new Date(ms + offsetMin(fuso) * 60e3).toISOString();
const diaNoFuso = (ms, fuso) => noFuso(ms, fuso).slice(0, 10);
const horaNoFuso = (ms, fuso) => noFuso(ms, fuso).slice(11, 16);
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const horariosDe = (plat, ag) => (plat === 'youtube_longo' ? [ag.horario_longo] : ag.horarios);
const aprovadoDeVerdade = (it) => it.aprovado && (!it.sem_autorizacao || it.aprovado_sem_autorizacao);

// todos os postagem.json do projeto
function arquivosPostagem() {
  const out = [];
  for (const pasta of ['cortes', 'compilados']) {
    const dir = path.join(RAIZ, pasta);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, 'postagem.json');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

async function ocupacao(ag, arquivoAtual, itensAtuais) {
  const ocup = []; // {plataforma, quando, assunto}
  const avisos = [];
  if ((config().publicador || '') === 'zernio') {
    const z = await postsAgendadosZernio();
    if (z.erro) avisos.push(`Zernio: ${z.erro} (sigo só com a ocupação local)`);
    for (const p of z.posts) {
      let plataforma = p.plataforma;
      // a Zernio não separa Short de vídeo longo: o horário do longo identifica o compilado
      if (plataforma === 'youtube') plataforma = horaNoFuso(p.quando, ag.fuso) === ag.horario_longo ? 'youtube_longo' : 'youtube_short';
      ocup.push({plataforma, quando: p.quando, assunto: null});
    }
  }
  const atual = path.resolve(arquivoAtual);
  for (const f of arquivosPostagem()) {
    const itens = path.resolve(f) === atual ? itensAtuais : lerJson(f, {itens: []}).itens || [];
    for (const it of itens) if (it.agendado_para && aprovadoDeVerdade(it)) ocup.push({plataforma: it.plataforma, quando: Date.parse(it.agendado_para), assunto: it.assunto || null});
  }
  // o mesmo post aparece na Zernio e no postagem.json local: conta uma vez (fica o registro local, que tem o assunto)
  const unicos = new Map();
  for (const o of ocup) {
    const k = `${o.plataforma}|${Math.round(o.quando / 60e3)}`;
    if (!unicos.has(k) || o.assunto) unicos.set(k, o);
  }
  return {ocup: [...unicos.values()], avisos};
}

export async function preencherHorarios(arquivo, itens, {so = null, gravar = true, registro = {}} = {}) {
  const ag = agendaConfig();
  const alvo = itens
    .filter((it) => (!so || so.has(it.id)) && aprovadoDeVerdade(it) && !it.agendado_para && !it.publicar_agora && !registro[`${it.id}:${it.plataforma}`]?.ok)
    .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0));
  if (!alvo.length) return {atribuidos: [], avisos: []};
  const {ocup, avisos} = await ocupacao(ag, arquivo, itens);
  const minimo = Date.now() + ag.antecedencia_min * 60e3;
  const hoje = diaNoFuso(Date.now(), ag.fuso);
  const atribuidos = [];
  for (const it of alvo) {
    const limite = ag.por_dia[it.plataforma] ?? 3;
    let feito = null;
    for (let n = 0; n < ag.dias_max && !feito; n++) {
      const dia = somaDias(hoje, n);
      const doDia = ocup.filter((o) => o.plataforma === it.plataforma && diaNoFuso(o.quando, ag.fuso) === dia);
      if (doDia.length >= limite) continue;
      if (it.assunto && doDia.some((o) => o.assunto && o.assunto === it.assunto)) continue;
      for (const h of horariosDe(it.plataforma, ag)) {
        const iso = `${dia}T${h}:00${ag.fuso}`;
        const ms = Date.parse(iso);
        if (ms < minimo) continue;
        if (ocup.some((o) => o.plataforma === it.plataforma && Math.abs(o.quando - ms) < 60e3)) continue;
        feito = iso;
        break;
      }
    }
    if (!feito) {
      avisos.push(`[${it.id}] sem horário livre nos próximos ${ag.dias_max} dias`);
      continue;
    }
    it.agendado_para = feito;
    ocup.push({plataforma: it.plataforma, quando: Date.parse(feito), assunto: it.assunto || null});
    atribuidos.push({id: it.id, plataforma: it.plataforma, agendado_para: feito});
  }
  if (gravar && atribuidos.length) salvarItens(arquivo, itens);
  return {atribuidos, avisos};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  carregarEnv();
  const args = process.argv.slice(2);
  const soIdx = args.indexOf('--so');
  const so = soIdx >= 0 ? new Set(args[soIdx + 1].split(',')) : null;
  const arquivo = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--so');
  if (!arquivo) {
    console.error('Uso: node agendar.mjs <postagem.json> [--so id1,id2] [--teste]');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const registro = lerJson(path.join(path.dirname(path.resolve(arquivo)), 'postado.json'), {});
  const r = await preencherHorarios(arquivo, doc.itens || [], {so, gravar: !args.includes('--teste'), registro});
  console.log(JSON.stringify({gravado: !args.includes('--teste'), ...r}, null, 2));
}
