#!/usr/bin/env node
// Diz se um vídeo está em português a partir do JSON do yt-dlp (a única restrição de conteúdo do Modo Morte Súbita).
// Uso: node scripts/morte-subita/idioma.mjs <info.json>   → {"idioma", "pt", "evidencia"}
import fs from 'node:fs';
import {idiomaDoVideo} from './comum.mjs';

const f = process.argv[2];
if (!f) {
  console.error('Uso: node idioma.mjs <info.json>');
  process.exit(1);
}
console.log(JSON.stringify(idiomaDoVideo(JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')))));
