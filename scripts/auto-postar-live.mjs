#!/usr/bin/env node
// Postagem automática dos cortes de UMA live do radar (pedido explícito do usuário, 2026-11-18, live do Davy Jones).
// Vigia cortes/ao-vivo-<canal>/postagem.json e, para cada corte novo do radar (os 2 itens: TikTok + Shorts):
//   - transcrição com [MÚSICA…] / ♪  → NÃO posta: fica em para-postar/ esperando o OK manual ("auto": "retido-musica");
//   - passou do teto do dia (--max-dia, padrão 8 cortes, TikTok + Shorts contam como 1) → idem ("retido-teto");
//   - senão: título fixo numerado (--titulo "… #N"), hashtags por plataforma, aprovado (inclusive sem autorização)
//     e publicar.mjs --so <id> --acima-do-teto --sem-escalonamento → sai na hora (publishNow), sem agendamento.
// Uso: node scripts/auto-postar-live.mjs --canal yt-ucjabkiy17zamctnqhh0bqoq --titulo "GTA 6 AO VIVO com Davy Jones 🔥"
//        [--tags-tiktok "#gta6 #gtavi #davyjones #aovivo"] [--tags-youtube "#gta6 #gtavi #shorts"] [--max-dia 8]
// Parar: Ctrl+C ou criar fila/parar-auto-postar. Log: fila/auto-postar.log. Contagem do dia: fila/auto-postar.json.
// Uma instância por vez (fila/.auto-postar.lock). Não mexe em cortes que já têm o campo "auto" (já decididos).
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {RAIZ, carregarEnv, atualizarJson, lerJson, travar, donoDaTrava} from '../.claude/skills/pipeline-diario-gta6/scripts/env.mjs';

carregarEnv();
// DESATIVADO em 2026-11-18: o usuário voltou à aprovação manual e o envio imediato foi removido do publicar.mjs
// (risco de bloqueio de spam no YouTube). Mantido só como referência.
console.error("auto-postar-live.mjs está desativado: a postagem é manual e segue config/postagem.json (5/dia, 07:30–21:30, mínimo 2 h).");
process.exit(1);
const args = process.argv.slice(2);
const opt = (n, p) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : p;
};
const canal = opt('--canal');
const tituloBase = opt('--titulo');
if (!canal || !tituloBase) {
  console.error('Uso: node scripts/auto-postar-live.mjs --canal <rótulo do radar, ex. yt-ucjab…> --titulo "<título base>" [--max-dia 8]');
  process.exit(1);
}
const tags = {
  tiktok: opt('--tags-tiktok', '#gta6 #gtavi #aovivo').split(/\s+/).filter(Boolean),
  youtube_short: opt('--tags-youtube', '#gta6 #gtavi #shorts').split(/\s+/).filter(Boolean),
};
const maxDia = Number(opt('--max-dia', 8));
const POSTAGEM = path.join(RAIZ, 'cortes', `ao-vivo-${canal}`, 'postagem.json');
const ESTADO = path.join(RAIZ, 'fila', 'auto-postar.json');
const LOG = path.join(RAIZ, 'fila', 'auto-postar.log');
const PARAR = path.join(RAIZ, 'fila', 'parar-auto-postar');
const PUBLICAR = path.join(RAIZ, '.claude', 'skills', 'pipeline-diario-gta6', 'scripts', 'publicar.mjs');
const MUSICA = /\[[^\]]*m[uú]sica[^\]]*\]|\[[^\]]*music[^\]]*\]|♪|\(m[uú]sica/i;

const brt = (ms = Date.now()) => new Date(ms - 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
function log(msg) {
  const linha = `${brt()} [auto-postar] ${msg}`;
  console.log(linha);
  fs.appendFileSync(LOG, linha + '\n');
}

const TRAVA = path.join(RAIZ, 'fila', '.auto-postar.lock');
const dono = donoDaTrava(TRAVA);
if (dono) {
  console.error(`Já existe um auto-postar rodando (processo ${dono.pid}). Pare ele (Ctrl+C ou fila/parar-auto-postar) antes.`);
  process.exit(1);
}
const soltar = travar(TRAVA, {esperaMs: 0});
const sair = () => {
  try {
    soltar();
  } catch {}
  log('encerrado');
  process.exit(0);
};
process.on('SIGINT', sair);
process.on('SIGHUP', sair);
if (fs.existsSync(PARAR)) fs.rmSync(PARAR);

function marcar(id, campos) {
  atualizarJson(POSTAGEM, {itens: []}, (doc) => {
    for (const it of doc.itens || []) if (it.id === id) Object.assign(it, typeof campos === 'function' ? campos(it) : campos);
  });
}

function rodada() {
  if (!fs.existsSync(POSTAGEM)) return;
  const doc = lerJson(POSTAGEM, {itens: []});
  const grupos = new Map();
  for (const it of doc.itens || []) if (it.ao_vivo && !it.auto && !it.descartado) (grupos.get(it.id) || grupos.set(it.id, []).get(it.id)).push(it);
  const fila = [...grupos.values()].sort((a, b) => Date.parse(a[0].capturado_em) - Date.parse(b[0].capturado_em));
  for (const grupo of fila) {
    const id = grupo[0].id;
    const arq = path.resolve(path.dirname(POSTAGEM), grupo[0].arquivo || '');
    if (!fs.existsSync(arq)) continue; // vídeo ainda não está lá
    const em = new Date().toISOString();
    if (MUSICA.test(grupo[0].transcricao || '')) {
      marcar(id, {auto: 'retido-musica', auto_em: em});
      log(`${id}: transcrição marca música → NÃO postado, espera o seu OK em para-postar/`);
      continue;
    }
    const est = lerJson(ESTADO, {dias: {}, numero: 0});
    const dia = brt().slice(0, 10);
    if ((est.dias[dia] || 0) >= maxDia) {
      marcar(id, {auto: 'retido-teto', auto_em: em});
      log(`${id}: teto de ${maxDia} cortes automáticos hoje atingido → espera o seu OK em para-postar/`);
      continue;
    }
    const n = est.numero + 1;
    const titulo = `${tituloBase} #${n}`;
    marcar(id, (it) => {
      const {titulo_provisorio, ...resto} = it;
      return {...resto, titulo, hashtags: tags[it.plataforma] || tags.tiktok, aprovado: true, aprovado_sem_autorizacao: true, auto: 'aprovado', auto_em: em};
    });
    // titulo_provisorio precisa sumir do item (Object.assign não apaga chave)
    atualizarJson(POSTAGEM, {itens: []}, (d) => {
      for (const it of d.itens || []) if (it.id === id) delete it.titulo_provisorio;
    });
    log(`${id}: aprovado como "${titulo}" → publicando agora (TikTok + Shorts)`);
    const r = spawnSync(process.execPath, [PUBLICAR, POSTAGEM, '--so', id, '--acima-do-teto', '--sem-escalonamento'], {cwd: RAIZ, encoding: 'utf8', timeout: 20 * 60e3});
    const saida = `${r.stdout || ''}${r.stderr || ''}`.trim();
    const reg = lerJson(path.join(path.dirname(POSTAGEM), 'postado.json'), {});
    const ok = grupo.map((it) => `${it.plataforma}: ${reg[`${it.id}:${it.plataforma}`]?.ok ? 'enviado' : 'FALHOU'}`);
    if (r.status === 0 && grupo.every((it) => reg[`${it.id}:${it.plataforma}`]?.ok)) {
      atualizarJson(ESTADO, {dias: {}, numero: 0}, (e) => {
        e.dias[dia] = (e.dias[dia] || 0) + 1;
        e.numero = n;
      });
      log(`${id}: ${ok.join(' · ')} (${(est.dias[dia] || 0) + 1}/${maxDia} hoje)`);
    } else {
      marcar(id, {auto: 'falhou'});
      log(`${id}: publicação com problema (código ${r.status}; ${ok.join(' · ')}). Saída:\n${saida.slice(-1500)}`);
    }
  }
}

log(`ligado para ${canal} · título "${tituloBase} #N" · até ${maxDia} cortes por dia · música → segura · TikTok ${tags.tiktok.join(' ')} · YouTube ${tags.youtube_short.join(' ')}`);
for (;;) {
  if (fs.existsSync(PARAR)) {
    fs.rmSync(PARAR);
    sair();
  }
  try {
    rodada();
  } catch (e) {
    log(`erro: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 15e3));
}
