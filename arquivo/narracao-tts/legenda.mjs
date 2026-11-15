// Legenda da narração TTS (ASS queimado com libass), num estilo diferente da legenda do streamer:
// texto amarelo em caixa preta, para o espectador distinguir a voz do canal da voz da live.
import fs from 'node:fs';

// palavras com tempo de uma fala: do <id>.json gerado pelo tts.mjs; sem ele, distribui o texto pela duração do áudio
export function palavrasDaFala(mp3, texto, duracao) {
  const meta = mp3.replace(/\.mp3$/i, '.json');
  if (fs.existsSync(meta)) {
    const j = JSON.parse(fs.readFileSync(meta, 'utf8'));
    if (j.palavras?.length) return j.palavras;
    texto ||= j.texto;
  }
  if (!texto) return [];
  const ps = texto.split(/\s+/).filter(Boolean);
  const pesos = ps.map((p) => p.length + 1);
  const soma = pesos.reduce((a, b) => a + b, 0);
  let t = 0;
  return ps.map((p, i) => {
    const d = (duracao * pesos[i]) / soma;
    const w = {t: p, inicio: t, fim: t + d};
    t += d;
    return w;
  });
}

// agrupa em blocos de até 3 palavras / 20 caracteres (como a legenda do motor) e desloca para o tempo do vídeo
export function blocos(palavras, deslocamento, fimMax = Infinity) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({texto: cur.map((w) => w.t).join(' '), inicio: deslocamento + cur[0].inicio, fim: deslocamento + cur.at(-1).fim});
    cur = [];
  };
  for (const w of palavras) {
    const chars = cur.reduce((s, x) => s + x.t.length + 1, 0) + w.t.length;
    if (cur.length >= 3 || (cur.length && chars > 20)) flush();
    cur.push(w);
    if (/[.!?…,:;]$/.test(w.t)) flush();
  }
  flush();
  // cada bloco fica na tela até o próximo começar (sem piscar), no máximo 0,6 s além da última palavra
  return out.map((b, i) => ({...b, fim: Math.min(fimMax, Math.max(b.fim, Math.min(out[i + 1]?.inicio ?? b.fim + 0.3, b.fim + 0.6)))}));
}

const ts = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const limpar = (t) => t.replace(/[{}\\]/g, '').toUpperCase();

// estilo: posicao "baixo" (acima da zona da interface do app) ou "cima"
export function escreverAss(arquivo, eventos, {largura, altura, tamanho, posicao = 'baixo', margemV}) {
  const align = posicao === 'cima' ? 8 : 2;
  const mv = margemV ?? Math.round(altura * (posicao === 'cima' ? 0.12 : 0.22));
  const mh = Math.round(largura * 0.12);
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${largura}
PlayResY: ${altura}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Narracao,DejaVu Sans,${tamanho},&H0000D4FF,&H0000D4FF,&H40000000,&H00000000,-1,0,0,0,100,100,1,0,3,${Math.round(tamanho * 0.22)},0,${align},${mh},${mh},${mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${eventos.map((e) => `Dialogue: 0,${ts(e.inicio)},${ts(e.fim)},Narracao,,0,0,0,,${limpar(e.texto)}`).join('\n')}
`;
  fs.writeFileSync(arquivo, ass);
}
