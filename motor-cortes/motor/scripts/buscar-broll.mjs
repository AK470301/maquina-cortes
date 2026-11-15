#!/usr/bin/env node
// Busca vídeos de apoio (B-roll) no Pexels (API oficial, gratuita) e baixa para uma pasta.
// Precisa de uma variável de ambiente sua:
//   PEXELS_API_KEY  chave grátis em https://www.pexels.com/api/ (os vídeos do Pexels podem ser usados sem atribuição)
// Uso: node scripts/buscar-broll.mjs "city traffic night" <pasta_destino> [quantidade] [prefixo]
// Prefira termos em inglês. Imprime um JSON [{file, dur, autor, url}]. Nunca imprime a chave.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function searchBroll(query, dest, n = 1, prefix = 'broll', {details = false} = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('Defina PEXELS_API_KEY (grátis em pexels.com/api) para buscar vídeos de apoio.');
  const url = new URL('https://api.pexels.com/videos/search');
  url.search = new URLSearchParams({query, orientation: 'landscape', per_page: String(Math.min(40, n * 6)), size: 'medium'}).toString();
  const r = await fetch(url, {headers: {Authorization: key}, signal: AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`Pexels respondeu HTTP ${r.status} (confira a chave e a cota)`);
  const videos = ((await r.json()).videos || []).filter((v) => v.duration >= 5 && v.duration <= 30);
  fs.mkdirSync(dest, {recursive: true});
  const out = [];
  for (const v of videos) {
    if (out.length >= n) break;
    // o maior arquivo mp4 de até 1080p de altura
    const f = (v.video_files || [])
      .filter((x) => x.file_type === 'video/mp4' && x.height && x.height <= 1080 && x.width >= x.height)
      .sort((a, b) => b.height - a.height)[0];
    if (!f) continue;
    try {
      const res = await fetch(f.link, {redirect: 'follow', signal: AbortSignal.timeout(60000)});
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 80_000_000) continue;
      const file = path.join(dest, `${prefix}-${out.length + 1}.mp4`);
      fs.writeFileSync(file, buf);
      out.push({file, dur: v.duration, autor: v.user?.name || null, url: v.url});
    } catch {
      /* tenta o próximo */
    }
  }
  return details ? out : out.map((o) => o.file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [query, dest, n, prefix] = process.argv.slice(2);
  if (!query || !dest) {
    console.error('Uso: node scripts/buscar-broll.mjs "termo em inglês" <pasta_destino> [quantidade] [prefixo]');
    process.exit(1);
  }
  searchBroll(query, dest, Number(n || 1), prefix || 'broll', {details: true})
    .then((files) => {
      console.log(JSON.stringify(files, null, 2));
      process.exit(files.length ? 0 : 2);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
