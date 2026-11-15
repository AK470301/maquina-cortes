// Horários de publicação: calcula os próximos horários livres a partir das preferências
// (config.json → publicacao.horarios e .fuso) e guarda os já usados em ~/.maquina-cortes-gta/agenda.json,
// para dois vídeos diferentes não caírem no mesmo horário.
import path from 'node:path';
import {HOME, gravarJson, lerJson} from './contas.mjs';
import {LIMITES} from './validar.mjs';

export const AGENDA = path.join(HOME, 'agenda.json');
export const PADRAO = {horarios: ['18:00'], fuso: '-03:00'};

export function preferencias() {
  const p = lerJson(path.join(HOME, 'config.json'), {}).publicacao || {};
  return {...PADRAO, ...p};
}

const minutosFuso = (fuso) => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(fuso);
  if (!m) throw new Error(`fuso inválido: ${fuso} (use -03:00)`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};

export const lerAgenda = () => lerJson(AGENDA, {});

export function ocupar(plataforma, quando) {
  if (!quando) return;
  const a = lerAgenda();
  const t = Date.parse(quando);
  a[plataforma] = [...new Set([...(a[plataforma] || []), t])].filter((x) => x > Date.now() - 86400e3).sort((x, y) => x - y);
  gravarJson(AGENDA, a);
}

// próximos n horários livres em TODAS as plataformas pedidas, no formato ISO com fuso
export function proximosHorarios(n, {horarios, fuso, plataformas, agenda = {}, agora = Date.now()}) {
  const off = minutosFuso(fuso);
  const usados = new Set(plataformas.flatMap((p) => agenda[p] || []));
  const minimo = agora + LIMITES.antecedenciaMin * 60000;
  const hs = [...horarios].sort();
  const res = [];
  const hoje = new Date(agora + off * 60000); // "relógio" no fuso escolhido, lido em UTC
  for (let d = 0; res.length < n && d < 366; d++) {
    const dia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + d));
    const data = dia.toISOString().slice(0, 10);
    for (const h of hs) {
      const iso = `${data}T${h}:00${fuso}`;
      const t = Date.parse(iso);
      if (t >= minimo && !usados.has(t)) res.push(iso);
      if (res.length >= n) break;
    }
  }
  return res;
}
