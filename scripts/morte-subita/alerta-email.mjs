#!/usr/bin/env node
// Modo Morte Súbita — os dois gatilhos obrigatórios de e-mail (mesmo envio Resend do notificar-email.mjs, mesmo .env):
//  a) Alerta de Clipe Gerado: node alerta-email.mjs clipes <cortes/slug> [--simular]
//     (chamado pelo fase2.mjs finalizar, ou seja, por todo fluxo que gera clipe de VOD: cron e processar-link.ps1;
//     o radar ao vivo avisa cada clipe pelo notificar-email.mjs, que já existia)
//  b) Alerta de Status do Cron: node alerta-email.mjs cron --rodada R --hora 09:00 --status ok|vazio|erro [--detalhe "..."] [--simular]
//     (chamado pelo rodar-cron.ps1 em TODA execução, inclusive quando não há vídeo novo em português)
// --simular (ou PIPELINE_SEM_EMAIL=1) mostra o que seria enviado, sem enviar.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLIPES_GERADOS, FILA_ENTRADA, RAIZ, cartao, enviarEmail, esc, lerJson, lerJsonl, mmss} from './comum.mjs';

const td = 'padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top';
const fmtViews = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

function tabelaCortes(cortes) {
  if (!cortes.length) return '<p style="color:#555">Nenhum corte renderizado.</p>';
  const linhas = cortes
    .map(
      (c) => `<tr><td style="${td};font-family:monospace;font-size:12px">${esc(c.id)}</td>
<td style="${td}"><b>${esc(c.titulo_topo)}</b><br><span style="font-size:13px">YouTube: ${esc(c.titulo_seo)}</span><br><span style="font-size:13px;color:#555">TikTok: ${esc(c.legenda_tiktok)}</span></td>
<td style="${td};text-align:right">${mmss(c.duracao_s)}</td></tr>
<tr><td colspan="3" style="padding:0 10px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#666">${esc(c.arquivo)}</td></tr>`,
    )
    .join('\n');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="background:#fafafa;text-align:left"><th style="padding:8px 10px">ID</th><th style="padding:8px 10px">Títulos</th><th style="padding:8px 10px;text-align:right">Duração</th></tr>${linhas}</table>`;
}

const fonteHtml = (v) =>
  `<p style="margin:0 0 14px;color:#444;font-size:14px">Fonte: <a href="${esc(v.url)}">${esc(v.titulo)}</a> — ${esc(v.canal || '?')} · ${fmtViews(v.views)} views · ${esc(v.idioma || '')} · origem: ${esc(v.origem || '?')}</p>`;

export async function emailClipes(resumo) {
  const n = resumo.cortes.length;
  const assunto = `${n} ${n === 1 ? 'clipe gerado' : 'clipes gerados'}: ${String(resumo.video.titulo || resumo.slug).slice(0, 70)}`;
  const corpo = cartao(
    `${n} ${n === 1 ? 'clipe pronto' : 'clipes prontos'} em render/`,
    `${fonteHtml(resumo.video)}
${tabelaCortes(resumo.cortes)}
${resumo.falhas?.length ? `<p style="color:#b45309;font-size:13px">Não renderizados: ${resumo.falhas.map((f) => esc(f.id)).join(', ')}</p>` : ''}
<p style="margin:16px 0 0;color:#555;font-size:13px">Pasta: <code>${esc(resumo.pasta_render)}</code><br>Proposta de publicação (tudo <b>aprovado: false</b>): <code>${esc(resumo.postagem)}</code><br>
Nada foi publicado. Para aprovar, abra o Claude Code em <code>${esc(RAIZ)}</code> e diga, por exemplo, <em>"aprovo ${esc(resumo.cortes[0]?.id || 'c-01-...')}"</em>.
Vídeo bruto e <code>work/</code> já apagados (${(resumo.liberado_mb ?? 0).toFixed(0)} MB).</p>`,
  );
  return enviarEmail(assunto, corpo);
}

export async function emailCron({rodada, hora, status, detalhe = ''}) {
  const f1 = lerJson(path.join(FILA_ENTRADA, 'fase1.json'), {});
  const fase1 = f1.rodada === rodada ? f1 : {};
  const gerados = lerJsonl(CLIPES_GERADOS).filter((g) => g.rodada === rodada);
  const cortes = gerados.flatMap((g) => g.cortes.map((c) => ({...c, fonte: g.video.titulo})));
  let titulo;
  let assunto;
  let corpo;
  if (status === 'vazio') {
    assunto = `Cron das ${hora}: rodou normalmente, nenhum vídeo novo em português`;
    titulo = `Cron das ${hora}: nenhum vídeo inédito em português`;
    corpo = `<p style="background:#eef6ff;border-left:4px solid #2563eb;padding:10px 12px">O cron das <b>${esc(hora)}</b> rodou normalmente, mas não havia vídeos inéditos em português na janela (mais vistos sobre "GTA 6"/"GTA VI" publicados nos últimos 6 meses). A Fase 2 não foi chamada.</p>
${fase1.verificados != null ? `<p style="color:#555;font-size:13px">Vídeos verificados nos metadados: ${fase1.verificados}.</p>` : ''}`;
  } else {
    const ok = status === 'ok' && cortes.length > 0;
    assunto = ok ? `Cron das ${hora}: ${cortes.length} ${cortes.length === 1 ? 'clipe gerado' : 'clipes gerados'} de ${gerados.length} ${gerados.length === 1 ? 'vídeo' : 'vídeos'}` : `Cron das ${hora}: problema na rodada`;
    titulo = ok ? `Cron das ${hora}: rodada concluída` : `Cron das ${hora}: a rodada não terminou bem`;
    const sel = (fase1.selecionados || []).map((s) => `<li>${esc(s.titulo)} — ${esc(s.canal || '?')} · ${fmtViews(s.views)} views</li>`).join('');
    const falhas = (fase1.falhas || []).map((s) => `<li>${esc(s.titulo || s.id)}: ${esc(s.erro)}</li>`).join('');
    corpo = `${sel ? `<p style="margin:0 0 6px"><b>Vídeos inéditos selecionados (Fase 1):</b></p><ul style="margin:0 0 14px">${sel}</ul>` : ''}
${falhas ? `<p style="margin:0 0 6px;color:#b45309"><b>Falhas no preparo:</b></p><ul style="margin:0 0 14px">${falhas}</ul>` : ''}
${gerados.map((g) => `${fonteHtml(g.video)}${tabelaCortes(g.cortes)}`).join('<hr style="border:0;border-top:1px solid #eee;margin:18px 0">') || '<p style="color:#b45309">Nenhum clipe foi gerado nesta rodada.</p>'}
${detalhe ? `<p style="margin:14px 0 0;color:#555;font-size:13px">${esc(detalhe)}</p>` : ''}`;
  }
  return enviarEmail(assunto, cartao(titulo, `${corpo}<p style="margin:16px 0 0;color:#888;font-size:12px">Rodada ${esc(rodada)} · log: ${esc(path.join(RAIZ, 'logs', 'cron.log'))}</p>`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, alvo] = process.argv.slice(2);
  const a = process.argv.slice(2);
  const opt = (k, p = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : p);
  try {
    let id;
    if (cmd === 'clipes') {
      const f = path.resolve(RAIZ, alvo || '', 'cortes.json');
      if (!fs.existsSync(f)) throw new Error(`não achei ${f} (gerado pelo fase2.mjs finalizar)`);
      id = await emailClipes(JSON.parse(fs.readFileSync(f, 'utf8')));
    } else if (cmd === 'cron') {
      id = await emailCron({rodada: opt('--rodada'), hora: opt('--hora', '?'), status: opt('--status', 'ok'), detalhe: opt('--detalhe', '')});
    } else throw new Error('Uso: alerta-email.mjs clipes <cortes/slug> | cron --rodada R --hora HH:MM --status ok|vazio|erro');
    console.log(JSON.stringify({ok: true, email: id}));
  } catch (e) {
    console.log(JSON.stringify({ok: false, erro: e.message}));
    process.exit(1);
  }
}
