// Kit de publicação manual: para as plataformas em modo "manual", uma pasta com os vídeos renomeados na ordem
// de publicação e um LEGENDAS.txt com dia, hora, capa e legenda de cada um. O usuário agenda pelo navegador
// (Meta Business Suite para o Instagram, TikTok Studio para o TikTok).
import fs from 'node:fs';
import path from 'node:path';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ONDE = {
  instagram: 'Agende em business.facebook.com → Planejador (ou "Criar Reel") → enviar o vídeo → colar a legenda → "Programar".',
  tiktok: 'Agende em tiktok.com/tiktokstudio/upload → enviar o vídeo → colar a legenda → "Programar" (até 10 dias à frente).',
  youtube: 'Agende em studio.youtube.com → Criar → Enviar vídeos → colar título e descrição → "Programar".',
};

// a data e a hora vêm do próprio texto ISO (já está no fuso do usuário)
export function rotulo(quando) {
  if (!quando) return {arquivo: 'sem-horario', texto: 'sem horário (publique quando quiser)', ordem: Infinity};
  const data = quando.slice(0, 10);
  const hora = quando.slice(11, 16);
  const [a, m, d] = data.split('-');
  const dow = DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()];
  return {arquivo: `${data} ${hora.replace(':', 'h')}`, texto: `${d}/${m} (${dow}) às ${hora}`, ordem: Date.parse(quando)};
}

function copiar(origem, destino) {
  fs.rmSync(destino, {force: true});
  try {
    fs.linkSync(origem, destino); // mesmo disco: não ocupa espaço extra
  } catch {
    fs.copyFileSync(origem, destino);
  }
}

// devolve [{plataforma, corte, arquivo, quando}] do que entrou no kit
export function gerarKit(pub, {base, destino, plataformas}) {
  const itens = [];
  for (const c of pub.clips) {
    for (const p of plataformas) {
      const d = c[p];
      if (!d || d.modo !== 'manual') continue;
      itens.push({p, c, d, r: rotulo(d.quando)});
    }
  }
  const feitos = [];
  for (const p of plataformas) {
    const meus = itens.filter((i) => i.p === p).sort((x, y) => x.r.ordem - y.r.ordem);
    if (!meus.length) continue;
    const pasta = path.join(destino, p);
    fs.mkdirSync(pasta, {recursive: true});
    const linhas = [`KIT ${p.toUpperCase()}: ${meus.length} corte(s)`, ONDE[p], ''];
    meus.forEach(({c, d, r}, i) => {
      const nome = `${r.arquivo} - ${c.id}.mp4`;
      copiar(path.resolve(base, c.arquivo), path.join(pasta, nome));
      linhas.push(`=== ${i + 1}. ${r.texto}: ${c.id} ===`);
      linhas.push(`Arquivo: ${nome}`);
      if (c.capaSegundo != null) linhas.push(`Capa: o quadro em ${String(c.capaSegundo).replace('.', ',')} s do vídeo`);
      if (d.titulo) linhas.push(`Título:\n${d.titulo}`);
      linhas.push(`${p === 'youtube' ? 'Descrição' : 'Legenda'}:\n${d.legenda || d.descricao || ''}`, '');
      feitos.push({plataforma: p, corte: c.id, arquivo: path.join(pasta, nome), quando: d.quando || null});
    });
    fs.writeFileSync(path.join(pasta, 'LEGENDAS.txt'), linhas.join('\n'));
  }
  return feitos;
}
