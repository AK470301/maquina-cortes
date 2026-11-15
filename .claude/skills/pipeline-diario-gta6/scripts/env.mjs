// Raiz do projeto, leitura do <projeto>/.env e da configuração do pipeline (comum aos scripts).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
