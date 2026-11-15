#!/usr/bin/env node
// Gera as falas TTS do canal a partir de um roteiro.json: [{"id": "tt-01-x-hook", "texto": "..."}].
// Uso: node tts.mjs <roteiro.json> <pasta-saida> [--refazer]
// Para cada fala grava <id>.mp3 e <id>.json ({"texto", "palavras": [{"t", "inicio", "fim"}]}), usado na legenda da narração.
// Provedor:
//   - ElevenLabs, se ELEVENLABS_API_KEY estiver no ambiente (precisa também de ELEVENLABS_VOICE_ID; modelo em
//     ELEVENLABS_MODEL_ID ou eleven_multilingual_v2);
//   - senão, edge-tts (gratuito) com a voz TTS_VOZ_EDGE ou pt-BR-AntonioNeural, velocidade TTS_VELOCIDADE_EDGE ou +8%.
//     Usa o Python do venv do projeto (<projeto>/.venv) ou o python3 do sistema com o pacote edge-tts.
// Chaves só no ambiente ou no <projeto>/.env, nunca no chat. Arquivos já gerados são mantidos, a menos que use --refazer.
// A voz é a do canal; nunca clone a do streamer.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {carregarEnv, RAIZ} from './env.mjs';

carregarEnv();
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const refazer = args.includes('--refazer');
const [roteiro, pasta] = args.filter((a) => !a.startsWith('--'));
if (!roteiro || !pasta) {
  console.error('Uso: node tts.mjs <roteiro.json> <pasta-saida> [--refazer]');
  process.exit(1);
}
fs.mkdirSync(pasta, {recursive: true});
const {ELEVENLABS_API_KEY: key, ELEVENLABS_VOICE_ID: voz, ELEVENLABS_MODEL_ID: modelo = 'eleven_multilingual_v2'} = process.env;

if (!key) {
  const py = [path.join(RAIZ, '.venv', 'bin', 'python'), path.join(RAIZ, '.venv', 'Scripts', 'python.exe')].find((p) => fs.existsSync(p)) || 'python3';
  const r = spawnSync(
    py,
    [path.join(AQUI, 'edge_tts_lote.py'), roteiro, pasta, '--voz', process.env.TTS_VOZ_EDGE || 'pt-BR-AntonioNeural', '--velocidade', process.env.TTS_VELOCIDADE_EDGE || '+8%', ...(refazer ? ['--refazer'] : [])],
    {stdio: 'inherit'},
  );
  if (r.error || r.status === null) {
    console.error(`edge-tts não rodou (${r.error?.message || 'interrompido'}). Instale: python3 -m venv ${RAIZ}/.venv && ${RAIZ}/.venv/bin/pip install edge-tts`);
    process.exit(2);
  }
  process.exit(r.status);
}

if (!voz) {
  console.error('ELEVENLABS_API_KEY definida, mas falta ELEVENLABS_VOICE_ID (a voz do canal).');
  process.exit(2);
}
// ElevenLabs com tempos por caractere → tempos por palavra
const itens = JSON.parse(fs.readFileSync(roteiro, 'utf8'));
const feitos = [];
for (const {id, texto} of itens) {
  const mp3 = path.join(pasta, `${id}.mp3`);
  const meta = path.join(pasta, `${id}.json`);
  if (!refazer && fs.existsSync(mp3) && fs.existsSync(meta)) {
    feitos.push({id, arquivo: mp3, status: 'mantido'});
    continue;
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voz)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {'xi-api-key': key, 'Content-Type': 'application/json'},
    body: JSON.stringify({text: texto, model_id: modelo, voice_settings: {stability: 0.45, similarity_boost: 0.8, style: 0.25}}),
  });
  if (!r.ok) {
    feitos.push({id, status: `erro ${r.status}: ${(await r.text()).slice(0, 200)}`});
    continue;
  }
  const j = await r.json();
  fs.writeFileSync(mp3, Buffer.from(j.audio_base64, 'base64'));
  const al = j.alignment || j.normalized_alignment || {characters: [], character_start_times_seconds: [], character_end_times_seconds: []};
  const palavras = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) palavras.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = {t: '', inicio: al.character_start_times_seconds[i], fim: 0};
    cur.t += ch;
    cur.fim = al.character_end_times_seconds[i];
  });
  if (cur) palavras.push(cur);
  fs.writeFileSync(meta, JSON.stringify({texto, palavras}));
  feitos.push({id, arquivo: mp3, status: 'gerado'});
}
console.log(JSON.stringify(feitos, null, 2));
process.exit(feitos.some((f) => f.status.startsWith('erro')) ? 1 : 0);
