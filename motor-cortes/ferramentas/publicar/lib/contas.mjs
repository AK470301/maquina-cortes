// Onde ficam os tokens das contas conectadas e a fila de agendamentos. Nada disso vai para o repositório.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PLATAFORMAS = ['youtube', 'tiktok', 'instagram'];
export const ALIAS = {yt: 'youtube', tt: 'tiktok', ig: 'instagram'};

// MAQUINA_CORTES_HOME existe para os testes; no uso normal é ~/.maquina-cortes-gta
export const HOME = process.env.MAQUINA_CORTES_HOME || path.join(os.homedir(), '.maquina-cortes-gta');
export const CONTAS = path.join(HOME, 'contas');
export const FILA = path.join(HOME, 'fila.json');

const arquivoConta = (p) => path.join(CONTAS, `${p}.json`);

export function lerConta(p) {
  try {
    return JSON.parse(fs.readFileSync(arquivoConta(p), 'utf8'));
  } catch {
    return null;
  }
}

// o arquivo tem tokens: só o dono lê (0600)
export function salvarConta(p, conta) {
  fs.mkdirSync(CONTAS, {recursive: true, mode: 0o700});
  const f = arquivoConta(p);
  fs.writeFileSync(f, JSON.stringify(conta, null, 2), {mode: 0o600});
  try {
    fs.chmodSync(f, 0o600);
  } catch {}
}

export function contasConectadas() {
  return Object.fromEntries(PLATAFORMAS.map((p) => [p, fs.existsSync(arquivoConta(p))]));
}

// Credenciais dos apps sem precisar de variável de ambiente (as variáveis, se existirem, têm prioridade):
// - contas/youtube-cliente.json: o JSON baixado do Google Cloud ("Baixar JSON" do cliente OAuth)
// - contas/apps.env: linhas CHAVE=valor (TIKTOK_CLIENT_KEY, META_APP_ID, ...)
export function carregarCredenciais(env = process.env) {
  const g = lerJson(path.join(CONTAS, 'youtube-cliente.json'), null);
  const c = g?.installed || g?.web;
  if (c) {
    env.YOUTUBE_CLIENT_ID ||= c.client_id;
    env.YOUTUBE_CLIENT_SECRET ||= c.client_secret;
  }
  try {
    for (const linha of fs.readFileSync(path.join(CONTAS, 'apps.env'), 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}

export function lerJson(f, padrao) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return padrao;
  }
}

// grava num temporário e renomeia: um erro no meio não corrompe o arquivo
export function gravarJson(f, dados) {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, f);
}
