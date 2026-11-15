// Toda descrição/legenda leva uma hashtag com o nome do streamer. Ela vem do "streamer" do work/cuts.json
// (ex.: "coringa" → #coringa) ou do campo "hashtag" em ~/.maquina-cortes-gta/streamers/<slug>.json
// (ex.: "#loudcoringa"). Se a legenda escrita esquecer, a hashtag é acrescentada no fim.
import path from 'node:path';
import {HOME, lerJson} from './contas.mjs';

export function hashtagDoStreamer(slug, home = HOME) {
  if (!slug) return null;
  const fixa = lerJson(path.join(home, 'streamers', `${slug}.json`), {}).hashtag;
  const tag = (fixa || slug).replace(/^#/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase();
  return tag ? `#${tag}` : null;
}

const tem = (texto, tag) => new RegExp(`(^|\\s)${tag}(?![\\p{L}\\p{N}_])`, 'iu').test(texto || '');

const juntar = (texto, tag) => {
  const t = (texto || '').trimEnd();
  return t ? `${t} ${tag}` : tag;
};

// devolve o pub com a hashtag garantida em cada plataforma e a lista do que foi acrescentado
export function garantirHashtag(pub, tag) {
  const acrescentadas = [];
  if (!tag) return {pub, acrescentadas};
  for (const c of pub.clips || []) {
    const campos = [
      ['youtube', 'descricao'],
      ['tiktok', 'legenda'],
      ['instagram', 'legenda'],
    ];
    for (const [p, campo] of campos) {
      if (!c[p]) continue;
      if (tem(c[p][campo], tag)) continue; // sempre na descrição/legenda, mesmo se já estiver no título
      c[p][campo] = juntar(c[p][campo], tag);
      acrescentadas.push(`${c.id}/${p}`);
    }
  }
  return {pub, acrescentadas};
}

// o streamer do vídeo: "streamer" no publicacao.json ou no work/cuts.json ao lado
export function streamerDoPub(pub, pubAbs) {
  return pub.streamer || lerJson(path.join(path.dirname(pubAbs), 'cuts.json'), {}).streamer || null;
}
