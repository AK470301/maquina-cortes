#!/usr/bin/env node
// Preenche o "agendado_para" dos itens aprovados e ainda não enviados de um postagem.json com o algoritmo central de
// agenda-postagens.mjs (regras em config/postagem.json: até 5 cortes/dia, janela 07:30–21:30, mínimo 2 h entre cortes,
// distribuição proporcional nas horas restantes + sorteio de ±15 min). Desde 2026-11-18 substitui os horários de pico
// fixos (12:00/18:00/21:00) e o envio imediato do radar: TODO item passa por aqui, inclusive "ao_vivo"/"publicar_agora".
// O horário de quem ainda não foi enviado é sempre recalculado (um agendado_para manual não fura as regras).
// As plataformas do mesmo corte (mesmo id) recebem o mesmo horário e contam como 1 corte no dia.
// Com config/pausa-postagem.ativo, só calcula (não grava).
// Uso: node agendar.mjs <postagem.json> [--so id1,id2] [--teste]   (--teste mostra a proposta sem gravar)
// Como módulo: preencherHorarios(arquivo, itens, {so, gravar, registro}) — o publicar.mjs chama antes de enviar.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {carregarEnv, config, lerJson, pausaPostagem, salvarItens} from "./env.mjs";
import {distribuir, isoNoFuso, ocupacao, regras} from "./agenda-postagens.mjs";

// compatibilidade: o fuso da agenda (config/postagem.json)
export function agendaConfig() {
  return {...(config().agenda || {}), fuso: regras().fuso};
}

const aprovadoDeVerdade = (it) => it.aprovado && !it.descartado && (!it.sem_autorizacao || it.aprovado_sem_autorizacao);

export async function preencherHorarios(arquivo, itens, {so = null, gravar = true, registro = {}} = {}) {
  const pasta = path.basename(path.dirname(path.resolve(arquivo)));
  const alvo = itens.filter((it) => (!so || so.has(it.id)) && aprovadoDeVerdade(it) && !registro[`${it.id}:${it.plataforma}`]?.ok);
  if (!alvo.length) return {atribuidos: [], avisos: []};
  // ordem: maior "nota" primeiro; empate = ordem do arquivo
  const ids = [...new Set(alvo.map((it) => it.id))];
  const nota = (id) => Math.max(...alvo.filter((it) => it.id === id).map((it) => it.nota ?? 0));
  ids.sort((a, b) => nota(b) - nota(a));
  const {tempos, avisos, regras: r} = await ocupacao({ignorar: new Set(ids.map((id) => `${pasta}|${id}`))});
  const slots = distribuir(ids.length, tempos, {r});
  const atribuidos = [];
  ids.forEach((id, k) => {
    const s = slots[k];
    for (const it of alvo.filter((x) => x.id === id)) {
      it.publicar_agora = false;
      it.agendado_para = s ? isoNoFuso(s.quando, r.fuso) : "";
      if (s) atribuidos.push({id, plataforma: it.plataforma, agendado_para: it.agendado_para, desvio_min: s.desvio_min, ajustes: s.ajustes});
    }
    if (!s) avisos.push(`[${id}] sem vaga nos próximos ${r.dias_max} dias`);
  });
  if (gravar && !pausaPostagem() && atribuidos.length) salvarItens(arquivo, itens);
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
  console.log(JSON.stringify({gravado: !args.includes("--teste") && !pausaPostagem(), pausa: pausaPostagem(), ...r}, null, 2));
}
