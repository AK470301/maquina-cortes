// Peças comuns do Modo Morte Súbita (fase1.mjs, preparar.mjs, finalizar.mjs, alerta-email.mjs).
// Estado em disco:
//   config/morte-subita.ativo   trava do modo (existe = ativo; só o usuário desativa)
//   logs/processados.txt        ids do YouTube já usados (um por linha: id<TAB>data<TAB>título); nunca é apagado
//   logs/clipes-gerados.jsonl   uma linha por vídeo finalizado (rodada, origem, cortes) — base do e-mail do cron
//   logs/morte-subita.log       log das fases
//   fila-entrada/<slug>/        vídeo baixado + transcrição esperando a Fase 2 (entrada.json com "pronto": true)
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RAIZ, carregarEnv, lerJson, morteSubita, travar} from '../../.claude/skills/pipeline-diario-gta6/scripts/env.mjs';

export {RAIZ, lerJson, morteSubita};
carregarEnv();

export const LOGS = path.join(RAIZ, 'logs');
export const PROCESSADOS = path.join(LOGS, 'processados.txt');
export const CLIPES_GERADOS = path.join(LOGS, 'clipes-gerados.jsonl');
export const FILA_ENTRADA = path.join(RAIZ, 'fila-entrada');
export const ENGINE = path.join(os.homedir(), '.maquina-cortes-gta', 'engine', 'scripts');
fs.mkdirSync(LOGS, {recursive: true});
fs.mkdirSync(FILA_ENTRADA, {recursive: true});

export function log(texto) {
  const linha = `${new Date().toISOString()} ${texto}`;
  console.error(linha);
  fs.appendFileSync(path.join(LOGS, 'morte-subita.log'), linha + '\n');
}

export const slugify = (t) =>
  String(t || 'video')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'video';

// ── histórico de ids (logs/processados.txt) ──
export function lerProcessados() {
  if (!fs.existsSync(PROCESSADOS)) return new Set();
  return new Set(
    fs
      .readFileSync(PROCESSADOS, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.split('\t')[0].trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}
export function gravarProcessado(id, titulo = '') {
  const soltar = travar(`${PROCESSADOS}.lock`, {esperaMs: 15e3, velhaMs: 60e3});
  try {
    if (lerProcessados().has(id)) return false;
    fs.appendFileSync(PROCESSADOS, `${id}\t${new Date().toISOString()}\t${String(titulo).replace(/[\t\r\n]+/g, ' ')}\n`);
    return true;
  } finally {
    soltar();
  }
}

// ── processos ──
export function rodarSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 512 * 2 ** 20, windowsHide: true, ...opts});
  return {status: r.status ?? (r.error ? -1 : 0), out: r.stdout || '', err: (r.stderr || '') + (r.error ? String(r.error.message) : '')};
}
export function rodar(cmd, args, {timeoutMs = 0, ...opts} = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {windowsHide: true, ...opts});
    let out = '';
    let err = '';
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (err += d));
    const t = timeoutMs ? setTimeout(() => p.kill(), timeoutMs) : null;
    p.on('close', (status) => (t && clearTimeout(t), resolve({status, out, err})));
    p.on('error', (e) => (t && clearTimeout(t), resolve({status: -1, out, err: err + e.message})));
  });
}
export const duracaoDe = (f) => {
  const r = rodarSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]);
  const d = Number(r.out.trim());
  return r.status === 0 && Number.isFinite(d) ? d : null;
};

// ── idioma: a ÚNICA restrição de conteúdo do Modo Morte Súbita é o vídeo estar em português ──
// Ordem das evidências (da mais forte para a mais fraca), sobre o JSON completo do yt-dlp:
//  1. faixa de áudio marcada "original" (vídeo com várias dublagens: vale a original, não a dublagem pt-BR automática);
//  2. campo "language" (idioma do áudio declarado pelo canal);
//  3. legenda automática "<idioma>-orig" quando só há uma (a do idioma falado);
//  4. texto do título + descrição (palavras comuns do português contra as do inglês/espanhol).
// Obs.: com --extractor-args youtube:lang=pt o YouTube devolve títulos TRADUZIDOS na busca; por isso o título só
// entra como última evidência, e lido da extração completa (que traz o título original).
// só marcas EXCLUSIVAS de cada língua ("como", "para", "que" existem em pt e es e enganam); limites Unicode, porque o
// \b do JavaScript não reconhece letra acentuada
const palavras = (lista) => new RegExp(String.raw`(?<!\p{L})(?:${lista.join('|')})(?!\p{L})`, 'giu');
const PT = palavras(["não", "nao", "você", "voce", "vocês", "pra", "isso", "essa", "esse", "então", "também", "muito", "agora", "jogo", "vídeo", "ninguém", "coisa", "coisas", "chegou", "melhor", "nós", "inscreva-se", "\\p{L}+ções", "\\p{L}+ção", "\\p{L}+ões"]);
const EN = palavras(["the", "you", "this", "that", "with", "what", "everything", "need", "know", "before", "new", "first", "best", "never", "how", "why", "about", "just", "from", "have", "here", "finally", "subscribe"]);
const ES = palavras(["el", "los", "las", "del", "pero", "muy", "también", "nuevo", "juego", "días", "reacción", "ningún", "suscríbete", "aquí", "año", "\\p{L}+ción", "\\p{L}*ñ\\p{L}*", "[¿¡]"]);
export function idiomaDoVideo(j) {
  const audios = (j.formats || []).filter((f) => f.acodec && f.acodec !== 'none' && f.language);
  const original = audios.find((f) => /original/i.test(f.format_note || ''));
  if (original) return {idioma: original.language, pt: /^pt/i.test(original.language), evidencia: 'faixa de áudio original'};
  if (j.language) return {idioma: j.language, pt: /^pt/i.test(j.language), evidencia: 'campo language'};
  const orig = Object.keys(j.automatic_captions || {}).filter((k) => /-orig$/.test(k));
  if (orig.length === 1) return {idioma: orig[0].replace(/-orig$/, ''), pt: /^pt/i.test(orig[0]), evidencia: 'legenda automática original'};
  const subs = Object.keys(j.subtitles || {});
  const texto = `${j.title || ''} ${j.description || ''}`.slice(0, 3000);
  const n = (re) => (texto.match(re) || []).length;
  const [pt, en, es] = [n(PT), n(EN), n(ES)];
  const ehPt = pt >= 3 && pt > en * 2 && pt > es * 2;
  return {idioma: ehPt ? 'pt (texto)' : 'indefinido', pt: ehPt, evidencia: `texto do título/descrição (pt ${pt}, en ${en}, es ${es}${subs.length ? `; legendas: ${subs.slice(0, 4).join(', ')}` : ''})`};
}

// ── e-mail: o mesmo envio do notificar-email.mjs (API do Resend, RESEND_API_KEY/EMAIL_DESTINO/EMAIL_REMETENTE do .env).
// O notificar-email.mjs fica intacto (aviso de pendentes de aprovação); este é o mesmo canal, para os alertas do modo.
export const simularEmail = () => process.argv.includes('--simular') || !!process.env.PIPELINE_SEM_EMAIL;
export async function enviarEmail(assunto, corpoHtml) {
  if (simularEmail()) {
    console.log(JSON.stringify({ok: true, simulado: true, assunto, html_bytes: corpoHtml.length}));
    return 'simulado';
  }
  const {RESEND_API_KEY: key, EMAIL_DESTINO: para, EMAIL_REMETENTE: de = 'onboarding@resend.dev'} = process.env;
  if (!key || !para) throw new Error('RESEND_API_KEY e EMAIL_DESTINO precisam estar no .env');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({from: `Pipeline GTA 6 <${de}>`, to: [para], subject: assunto, html: corpoHtml}),
    signal: AbortSignal.timeout(30e3),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.id;
}
export const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
export const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
export const cartao = (titulo, corpo) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="max-width:760px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<p style="margin:0 0 8px;font-size:12px;color:#b91c1c;font-weight:bold;letter-spacing:.05em">MODO MORTE SÚBITA</p>
<h2 style="margin:0 0 14px">${titulo}</h2>
${corpo}
</div></body></html>`;

export const lerJsonl = (f) =>
  fs.existsSync(f)
    ? fs
        .readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
