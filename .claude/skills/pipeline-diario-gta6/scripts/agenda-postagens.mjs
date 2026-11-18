#!/usr/bin/env node
// Módulo central de agendamento de postagens (regras em config/postagem.json; definidas pelo usuário em 2026-11-18
// para evitar o bloqueio de spam / 0 views no YouTube). Usado pelo publicar.mjs (via agendar.mjs) para TODO envio:
// aprovação manual, cortes do radar ao vivo e compilados. Não existe mais envio "na hora" fora destas regras.
//
// Unidade = um corte (id): as plataformas do mesmo corte (TikTok + Shorts) saem no mesmo horário e contam como 1.
// Regras, para um lote de N cortes a partir de agora:
//   - no máximo limite_dia (5) cortes por dia, contando os já postados e os já agendados naquela data;
//   - só dentro da janela janela_inicio–janela_fim (07:30–21:30, fuso da config);
//   - para o dia D: T_inicio = max(agora + antecedência, 07:30 de D, último post (até 21:30 de D) + espaco_min);
//     R = 21:30 de D − T_inicio; se R < 0 ou o dia já tem 5 → dia D+1 (T_inicio 07:30, R = 840 min);
//     K = min(restantes, vagas do dia, ⌊R / (espaco_min + 2 × variacao_min)⌋, no mínimo 1) — passo ≥ 150 min para o
//     sorteio não ser anulado pela trava de 2 h (senão tudo sairia de 120 em 120 min, regular);
//     passo = R / K; base_i = T_inicio + i × passo; horário = base_i + sorteio inteiro uniforme em [−15, +15] min;
//   - travas rígidas depois do sorteio: nunca antes de 07:30 nem do T_inicio-mínimo (agora + antecedência);
//     sempre ≥ anterior + espaco_min (se ficar menor, empurra para anterior + 120); nunca depois de 21:30 —
//     se empurrar para respeitar as 2 h passar das 21:30, esse corte e os seguintes vão para D+1, que é
//     recalculado proporcionalmente com a janela inteira (07:30–21:30) do novo dia.
// Ocupação considerada: todos os postado.json (enviados e agendados, menos os cancelados), os itens aprovados com
// horário nos postagem.json e os posts agendados na Zernio (deduplicados).
//
// CLI: node agenda-postagens.mjs --simular <N> [--vazio]   tabela de N cortes fictícios a partir de agora (não grava nada;
//      --vazio ignora a ocupação real, para ver a distribuição de um dia limpo)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RAIZ, carregarEnv, config, lerJson} from './env.mjs';
import {postsAgendadosZernio} from './zernio.mjs';

const PADRAO = {limite_dia: 5, janela_inicio: '07:30', janela_fim: '21:30', espaco_min: 120, variacao_min: 15, fuso: '-03:00', antecedencia_min: 16, dias_max: 60};
export const ARQUIVO_REGRAS = path.join(RAIZ, 'config', 'postagem.json');

export function regras() {
  const r = {...PADRAO};
  for (const [k, v] of Object.entries(lerJson(ARQUIVO_REGRAS, {}))) if (!k.startsWith('_')) r[k] = v;
  return r;
}

const MIN = 60e3;
const offsetMin = (fuso) => {
  const [, s, h, m] = /([+-])(\d{2}):(\d{2})/.exec(fuso);
  return (s === '-' ? -1 : 1) * (Number(h) * 60 + Number(m));
};
export const isoNoFuso = (ms, fuso) => new Date(ms + offsetMin(fuso) * MIN).toISOString().slice(0, 19) + fuso;
export const diaNoFuso = (ms, fuso) => isoNoFuso(ms, fuso).slice(0, 10);
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const horaDe = (dia, hhmm, fuso) => Date.parse(`${dia}T${hhmm}:00${fuso}`);
const sortearInt = (a, b, rng) => a + Math.floor(rng() * (b - a + 1));

// distribui n cortes; `ocupados` = horários (ms) já tomados, um por corte. Devolve, em ordem, um objeto por corte:
// {quando, dia, base, desvio_min, ajustes: [...]} — `ajustes` diz qual trava rígida mexeu no horário sorteado.
export function distribuir(n, ocupados = [], {agora = Date.now(), rng = Math.random, r = regras()} = {}) {
  const fixos = [...ocupados].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const out = [];
  const cedo = agora + r.antecedencia_min * MIN;
  const espaco = r.espaco_min * MIN;
  let dia = diaNoFuso(agora, r.fuso);
  for (let d = 0; out.length < n && d < r.dias_max; d++, dia = somaDias(dia, 1)) {
    const ini = horaDe(dia, r.janela_inicio, r.fuso);
    const fim = horaDe(dia, r.janela_fim, r.fuso);
    const todos = [...fixos, ...out.map((o) => o.quando)];
    const doDia = todos.filter((t) => diaNoFuso(t, r.fuso) === dia).length;
    // posts até 2 h depois do fim da janela também contam (ex.: um envio antigo do radar às 21:45 ou 23:00)
    const antes = todos.filter((t) => t <= fim + espaco);
    const ultimo = antes.length ? Math.max(...antes) : -Infinity;
    const tInicio = Math.max(cedo, ini, ultimo + espaco);
    const R = fim - tInicio;
    const vagas = r.limite_dia - doDia;
    if (R < 0 || vagas <= 0) continue;
    // quantos cabem: o passo proporcional precisa ser ≥ espaco + 2 × variacao (150 min), senão o sorteio de ±15 min
    // é anulado pela trava de 2 h e os horários saem exatamente de 120 em 120 min (o padrão regular que se quer evitar).
    // Um dia inteiro (840 min) continua comportando os 5; uma tarde de 522 min comporta 3.
    const K = Math.min(n - out.length, vagas, Math.max(1, Math.floor(R / (espaco + 2 * r.variacao_min * MIN))));
    const passo = R / K;
    let anterior = ultimo;
    for (let i = 0; i < K; i++) {
      const base = tInicio + i * passo;
      const desvio = sortearInt(-r.variacao_min, r.variacao_min, rng);
      let t = base + desvio * MIN;
      const ajustes = [];
      if (t < ini) (t = ini), ajustes.push('janela 07:30');
      if (t < cedo) (t = cedo), ajustes.push('antecedência');
      if (t < anterior + espaco) (t = anterior + espaco), ajustes.push('mínimo 2 h');
      // minuto cheio para cima: nunca desfaz as travas de baixo
      t = Math.ceil(t / MIN) * MIN;
      if (t > fim) {
        if (anterior + espaco > fim) break; // este e os seguintes vão para o dia seguinte (janela inteira, recalculada)
        (t = fim), ajustes.push('janela 21:30');
      }
      out.push({quando: t, dia, base, desvio_min: desvio, ajustes});
      anterior = t;
    }
  }
  return out;
}

// todos os horários ocupados do projeto, um por corte (as plataformas de um mesmo corte contam uma vez)
export async function ocupacao({ignorar = new Set(), zernio = true} = {}) {
  const r = regras();
  const porCorte = new Map(); // "pasta|id" → ms
  const marcar = (k, ms) => {
    if (!Number.isFinite(ms)) return;
    if (!porCorte.has(k) || ms < porCorte.get(k)) porCorte.set(k, ms);
  };
  for (const base of ['cortes', 'compilados']) {
    const dir = path.join(RAIZ, base);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir)) {
      const reg = lerJson(path.join(dir, d, 'postado.json'), {});
      for (const [chave, rec] of Object.entries(reg)) {
        if (!rec?.ok || rec.cancelado) continue;
        const id = chave.replace(/:[^:]+$/, '');
        marcar(`${d}|${id}`, Date.parse(rec.sai_em || rec.agendado_para || rec.em));
      }
      const doc = lerJson(path.join(dir, d, 'postagem.json'), {itens: []});
      for (const it of doc.itens || []) {
        if (!it.agendado_para || !it.aprovado || it.descartado || ignorar.has(`${d}|${it.id}`)) continue;
        if (reg[`${it.id}:${it.plataforma}`]?.ok) continue;
        marcar(`${d}|${it.id}`, Date.parse(it.agendado_para));
      }
    }
  }
  const avisos = [];
  const tempos = [...porCorte.values()];
  if (zernio && (config().publicador || '') === 'zernio') {
    const z = await postsAgendadosZernio();
    if (z.erro) avisos.push(`Zernio: ${z.erro} (sigo só com a ocupação local)`);
    // post agendado na Zernio que não está nos registros locais: ocupa o horário (2 min de tolerância para deduplicar)
    for (const p of z.posts) if (!tempos.some((t) => Math.abs(t - p.quando) <= 2 * MIN)) tempos.push(p.quando);
  }
  return {tempos: tempos.sort((a, b) => a - b), avisos, regras: r};
}

// ── simulação ──
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  carregarEnv();
  const args = process.argv.slice(2);
  const i = args.indexOf('--simular');
  const n = Number(args[i + 1]);
  if (i < 0 || !(n > 0)) {
    console.error('Uso: node agenda-postagens.mjs --simular <N> [--vazio]');
    process.exit(1);
  }
  const {tempos, avisos, regras: r} = args.includes('--vazio') ? {tempos: [], avisos: [], regras: regras()} : await ocupacao();
  const agora = Date.now();
  const res = distribuir(n, tempos, {agora, r});
  const hhmm = (ms) => isoNoFuso(ms, r.fuso).slice(11, 16);
  console.log(`Simulação (nada é gravado nem enviado) · agora ${isoNoFuso(agora, r.fuso).replace('T', ' ').slice(0, 16)} · regras: ${r.limite_dia}/dia, ${r.janela_inicio}–${r.janela_fim}, mínimo ${r.espaco_min} min, sorteio ±${r.variacao_min} min`);
  const porDia = {};
  for (const t of tempos) porDia[diaNoFuso(t, r.fuso)] = (porDia[diaNoFuso(t, r.fuso)] || 0) + 1;
  const futuros = tempos.filter((t) => t >= agora - 864e5);
  console.log(`Ocupação real considerada: ${tempos.length} cortes${futuros.length ? ` (últimas 24 h e futuro: ${futuros.map((t) => isoNoFuso(t, r.fuso).slice(5, 16).replace('T', ' ')).join(', ')})` : ''}`);
  for (const a of avisos) console.log('aviso:', a);
  console.log('\n| # | Data | Horário | Base (sem sorteio) | Desvio | Ajuste de trava | Intervalo desde o anterior | Corte nº no dia |');
  console.log('|---|---|---|---|---|---|---|---|');
  let anterior = tempos.length ? Math.max(...tempos.filter((t) => t <= (res[0]?.quando ?? Infinity))) : null;
  const contagem = {...porDia};
  res.forEach((o, k) => {
    contagem[o.dia] = (contagem[o.dia] || 0) + 1;
    const intervalo = anterior !== null && Number.isFinite(anterior) ? `${Math.round((o.quando - anterior) / MIN)} min` : '—';
    console.log(`| ${k + 1} | ${o.dia.split('-').reverse().join('/')} | ${hhmm(o.quando)} | ${hhmm(o.base)} | ${o.desvio_min >= 0 ? '+' : ''}${o.desvio_min} min | ${o.ajustes.join(', ') || '—'} | ${intervalo} | ${contagem[o.dia]}/${r.limite_dia} |`);
    anterior = o.quando;
  });
  if (res.length < n) console.log(`\n${n - res.length} corte(s) sem vaga nos próximos ${r.dias_max} dias`);
}
