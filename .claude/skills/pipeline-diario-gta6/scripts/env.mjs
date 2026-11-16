// Raiz do projeto, leitura do <projeto>/.env e da configuração do pipeline (comum aos scripts).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {travar} from '../../../../motor-cortes/motor/scripts/trava.mjs';

// scripts → pipeline-diario-gta6 → skills → .claude → <projeto>
export const RAIZ = process.env.PROJETO_GTA6 || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// carrega <projeto>/.env sem sobrescrever o que já está no ambiente; linhas "CHAVE=valor", # comenta, valor vazio é ignorado
export function carregarEnv() {
  const f = path.join(RAIZ, '.env');
  if (!fs.existsSync(f)) return;
  for (const linha of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function config() {
  const f = path.join(RAIZ, 'pipeline.config.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

export const lerJson = (f, padrao) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : padrao);

// ── JSON compartilhado entre processos (postagem.json, postado.json, notificados.json) ──
// O radar ao vivo, a rodada automática e uma sessão de aprovação podem gravar ao mesmo tempo. Duas proteções:
// gravarJson() escreve num temporário e renomeia (quem lê nunca pega o arquivo pela metade) e atualizarJson() relê o
// arquivo sob trava antes de alterar (uma gravação não apaga o que outro processo acrescentou nesse meio-tempo).
export {travar, travarAsync, donoDaTrava, TRAVA_RENDER} from '../../../../motor-cortes/motor/scripts/trava.mjs';

const pausa = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function gravarJson(f, obj) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  // Windows: o rename falha (EPERM/EBUSY) enquanto outro processo está com o destino aberto; tenta de novo
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, f);
      return;
    } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        fs.rmSync(tmp, {force: true});
        throw e;
      }
      pausa(50);
    }
  }
}

// lê o arquivo de novo (ou usa `padrao`), aplica fn(doc) (que altera ou devolve o novo doc) e grava, tudo sob trava
export function atualizarJson(f, padrao, fn) {
  const soltar = travar(`${f}.lock`, {esperaMs: 15e3, velhaMs: 60e3});
  try {
    const doc = lerJson(f, padrao);
    const novo = fn(doc) ?? doc;
    gravarJson(f, novo);
    return novo;
  } finally {
    soltar();
  }
}

// grava os itens alterados por este processo num postagem.json sem perder os que outro processo acrescentou:
// troca os que têm o mesmo id + plataforma e mantém o resto do arquivo como está no disco
export function salvarItens(arquivo, itens) {
  const chave = (it) => `${it.id}:${it.plataforma}`;
  const meus = new Map(itens.map((it) => [chave(it), it]));
  return atualizarJson(arquivo, {itens: []}, (doc) => {
    doc.itens = (doc.itens || []).map((it) => meus.get(chave(it)) ?? it);
  });
}
