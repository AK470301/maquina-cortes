#!/usr/bin/env node
// Avisa por e-mail (API do Resend) quando há vídeos novos esperando aprovação nos postagem.json do projeto.
// Uso: node notificar-email.mjs            envia só os itens ainda não notificados e grava os ids em <projeto>/notificados.json
//      node notificar-email.mjs --teste    envia um e-mail de validação (com os pendentes atuais como exemplo), sem gravar nada
//      node notificar-email.mjs --simular  mostra o que seria enviado, sem enviar nem gravar
// Ambiente (<projeto>/.env): RESEND_API_KEY, EMAIL_DESTINO, EMAIL_REMETENTE (padrão onboarding@resend.dev, que só
// entrega para o e-mail dono da conta do Resend; para outro destino, verifique um domínio no Resend).
// Pendente = item com aprovado != true, que não foi enviado (postado.json) nem descartado ("descartado": true).
// postagem.json com "calibracao": true (lote de teste) é ignorado, exceto como exemplo no --teste.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {RAIZ, carregarEnv, lerJson} from './env.mjs';

carregarEnv();
const teste = process.argv.includes('--teste');
const simular = process.argv.includes('--simular');
const controle = path.join(RAIZ, 'notificados.json');
const notificados = lerJson(controle, {});
const NOME = {tiktok: 'TikTok', youtube_short: 'YouTube Shorts', youtube_longo: 'YouTube (vídeo longo)'};

const dur = (f) => {
  try {
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {encoding: 'utf8'}).trim());
  } catch {
    return null;
  }
};
const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

// pendentes de todos os postagem.json (cortes/*/ e compilados/*/)
function pendentes({incluirCalibracao}) {
  const lista = [];
  for (const pasta of ['cortes', 'compilados']) {
    const dir = path.join(RAIZ, pasta);
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir).sort()) {
      const f = path.join(dir, d, 'postagem.json');
      if (!fs.existsSync(f)) continue;
      const doc = lerJson(f, {itens: []});
      if (doc.calibracao && !incluirCalibracao) continue;
      const enviados = lerJson(path.join(dir, d, 'postado.json'), {});
      for (const it of doc.itens || []) {
        const chave = `${pasta}/${d}/${it.id}:${it.plataforma}`;
        if (it.aprovado || it.descartado || enviados[`${it.id}:${it.plataforma}`]?.ok) continue;
        const arq = path.resolve(path.dirname(f), it.arquivo || '');
        lista.push({chave, pasta: `${pasta}/${d}`, dirArquivo: path.dirname(arq), arquivo: path.basename(arq), id: it.id, plataforma: it.plataforma, titulo: it.titulo, duracao: fs.existsSync(arq) ? dur(arq) : null, semAutorizacao: !!it.sem_autorizacao, calibracao: !!doc.calibracao});
      }
    }
  }
  return lista;
}

function html(itens, {aviso}) {
  const linhas = itens
    .map(
      (v) => `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px">${esc(v.id)}<br><span style="color:#888;font-size:11px">${esc(v.arquivo)}</span></td>
  <td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(NOME[v.plataforma] || v.plataforma)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(v.titulo)}${v.semAutorizacao ? '<br><span style="color:#b45309;font-size:12px">SEM AUTORIZAÇÃO: aprove pelo nome</span>' : ''}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${mmss(v.duracao)}</td>
</tr>`,
    )
    .join('\n');
  const pastas = [...new Set(itens.map((v) => v.dirArquivo))].map((p) => `<code>${esc(p)}/</code>`).join(', ');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
${aviso ? `<p style="background:#eef6ff;border-left:4px solid #2563eb;padding:10px 12px;margin:0 0 16px">${aviso}</p>` : ''}
<h2 style="margin:0 0 6px">${itens.length} ${itens.length === 1 ? 'vídeo pronto' : 'vídeos prontos'} para aprovação</h2>
<p style="margin:0 0 18px;color:#555">Pipeline de cortes GTA 6. Nada foi publicado: os horários são preenchidos depois do seu OK.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="background:#fafafa;text-align:left"><th style="padding:8px 10px">ID</th><th style="padding:8px 10px">Plataforma</th><th style="padding:8px 10px">Título sugerido</th><th style="padding:8px 10px;text-align:right">Duração</th></tr>
${linhas}
</table>
<p style="margin:18px 0 0;color:#555;font-size:13px">Para aprovar, abra o Claude Code em <code>projeto-x</code> e diga, por exemplo: <em>"aprovo ${esc(itens[0]?.id || 'tt-01-...')}"</em>. Para assistir: ${pastas || '—'} (só os vídeos que esperam o seu OK; depois de publicados eles vão para <code>${esc(path.join(RAIZ, 'postados'))}/</code>).</p>
</div></body></html>`;
}

async function enviarEmail(assunto, corpoHtml) {
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

const novos = teste ? pendentes({incluirCalibracao: true}) : pendentes({incluirCalibracao: false}).filter((v) => !notificados[v.chave]);
if (!novos.length && !teste) {
  console.log(JSON.stringify({ok: true, enviado: false, motivo: 'nenhum vídeo novo pendente'}));
  process.exit(0);
}
const assunto = teste ? '[teste] Pipeline GTA 6: notificação por e-mail funcionando' : `${novos.length} ${novos.length === 1 ? 'vídeo pronto' : 'vídeos prontos'} para aprovação (GTA 6)`;
const corpo = html(novos, {aviso: teste ? 'E-mail de <b>teste</b>: os itens abaixo são exemplo (inclui o lote de calibração) e não foram marcados como notificados.' : ''});
if (simular) {
  console.log(JSON.stringify({ok: true, simulado: true, assunto, itens: novos.map(({chave, ...v}) => v)}, null, 2));
  process.exit(0);
}
try {
  const id = await enviarEmail(assunto, corpo);
  if (!teste) {
    const agora = new Date().toISOString();
    for (const v of novos) notificados[v.chave] = {em: agora, email: id};
    fs.writeFileSync(controle, JSON.stringify(notificados, null, 2));
  }
  console.log(JSON.stringify({ok: true, enviado: true, teste, email_id: id, itens: novos.length}));
} catch (e) {
  console.error(JSON.stringify({ok: false, erro: e.message}));
  process.exit(1);
}
