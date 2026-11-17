#!/usr/bin/env node
// Confere a duração de cada corte renderizado contra a faixa da plataforma (substitui a checagem que o narrar.mjs fazia).
// Uso: node conferir.mjs <pasta-render> <plano.json> [<plano2.json> ...]
// Faixas finais do modo do pipeline (modo.mjs): crescimento = 20–55 s em tudo (corte duplo TikTok + Shorts);
// monetizacao = TikTok 62–85 s (Creator Rewards exige > 60 s), Shorts 35–58 s. Sai com código 1 se algum estiver fora
// ou faltar, e diz quanto ajustar o "end" (em segundos de vídeo final; na origem é um pouco mais, por causa das pausas).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {modo, plataformaDoCorte} from './modo.mjs';

const M = modo();
const FAIXA = Object.fromEntries(Object.entries(M.faixas).map(([k, v]) => [k, v.final]));
const [pasta, ...planos] = process.argv.slice(2);
if (!pasta || !planos.length) {
  console.error('Uso: node conferir.mjs <pasta-render> <plano.json> [...]');
  process.exit(1);
}
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());
const linhas = [];
for (const f of planos) {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const c of [...(p.cortes || []), ...(p.shorts || [])]) {
    const arq = path.join(pasta, `${c.id}.mp4`);
    const plat = plataformaDoCorte(c);
    const [min, max] = FAIXA[plat] || [0, Infinity];
    if (!fs.existsSync(arq)) {
      linhas.push({id: c.id, ok: false, erro: 'não renderizado'});
      continue;
    }
    const d = dur(arq);
    const ok = d >= min && d <= max;
    linhas.push({id: c.id, plataforma: c.plataformas ? c.plataformas.join('+') : plat, modo: M.nome, duracao: +d.toFixed(1), faixa: `${min}–${max}`, ok, ...(ok ? {} : {ajuste: d < min ? `estique ~${(min - d + 2).toFixed(1)} s` : `encurte ~${(d - max + 2).toFixed(1)} s`})});
  }
}
console.log(JSON.stringify(linhas, null, 2));
process.exit(linhas.every((l) => l.ok) ? 0 : 1);
