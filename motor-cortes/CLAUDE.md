# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin (PT-BR) with three skills — `cortes-papo`, `cortes-gameplay`, `cortes-video` — that turn a long video/live into 3–5 vertical Shorts (1080×1920, 30 fps). Claude (following each `SKILL.md`) decides *what* to cut and *how to frame it* by reading the transcript and video thumbnails; deterministic Node scripts do the heavy work (transcribe, measure silences, remap captions, render with Remotion, normalize to −14 LUFS). All user-facing text, code comments, commit messages and docs are in Portuguese — keep it that way.

## Repo vs. installed copies (important)

Nothing runs from this repo directly. Installation copies files elsewhere:

- `bash instalador/install.sh` (or `instalador\install.ps1`) → copies `skills/*` to `~/.claude/skills/` and runs `instalador/setup.mjs`.
- `setup.mjs` installs the shared **engine** in `~/.maquina-cortes-gta/`:
  - `engine/` ← `motor/` (Remotion project; `npm install` + `npx remotion browser ensure` on first install only)
  - `whisper.cpp/` + `ggml-<model>.bin` (via `@remotion/install-whisper-cpp`, version pinned in `WHISPER_VERSION`)
  - `docs/` ← `docs/` (guides shared by all three skills)
  - `ferramentas/` ← `ferramentas/` (`gerar-paleta-sfx.mjs` and `sfx/`)
  - `setup.mjs` copies itself here so the skills can call `node ~/.maquina-cortes-gta/setup.mjs --check|--profile|--streamer`; that copy cannot install (it has no `motor/` next to it)
  - `config.json` (profile/logo/watermark, `whisperModel`, `language`), `streamers/<slug>.json` (caption palette)

Shared code lives at the repo root (`motor/`, `docs/`, `ferramentas/`, `instalador/`); each `skills/<nome>/` holds only `SKILL.md` + its framing reference and depends on the installed engine. Installed with `install.sh`, the skills don't carry the installer; installed as a plugin, they reach it at `<skill>/../../instalador/setup.mjs`. After editing `motor/src`, `motor/scripts`, `docs/` or `ferramentas/`, re-run `node instalador/setup.mjs` to sync them into `~/.maquina-cortes-gta` (it re-copies `src/` and `scripts/` without touching `node_modules`). Edits to `SKILL.md` need `install.sh` again (or a manual copy) to reach `~/.claude/skills/`.

## Commands

```bash
node instalador/setup.mjs                            # install / update engine, docs, ferramentas (idempotent)
node ~/.maquina-cortes-gta/setup.mjs --check         # JSON status: node, ffmpeg, yt-dlp age, keys, engine, whisper model, streamers
node ~/.maquina-cortes-gta/setup.mjs --streamer slug --cor-base "#FFFFFF" --cor-destaque "#RRGGBB" [--nome "Nome"]
node ~/.maquina-cortes-gta/setup.mjs --profile "NOME" --logo PATH | --sem-marca

# pipeline (run from a working dir such as ./cortes/<slug>/; scripts live in the installed engine)
E=~/.maquina-cortes-gta/engine/scripts
node $E/transcribe.mjs work/source.mp4 work pt [max_seconds]   # → captions.json, silences.json, energia.json, meta.json, audio16k.wav
node $E/transcript-text.mjs work                                # "[mm:ss] frase" with 🔥 (most replayed, from info.json) and 🔊 (energy peaks)
node $E/mapa-visual.mjs work/source.mp4 work [intervalo_s=120] [inicio_s] [fim_s] [--guias]   # thumbnail sheets
node $E/cores.mjs <imagem|video> [segundo]                      # dominant colors, for proposing a palette
node $E/build.mjs work out                                      # reads work/cuts.json, renders each clip
node $E/build.mjs work out --so 01-id,02-id                     # re-render only these clip ids

# publicação (opcional; run from the cut folder)
P=~/.maquina-cortes-gta/ferramentas/publicar/publicar.mjs
node $P conectar youtube|tiktok|instagram                       # OAuth via browser, loopback http://localhost:8723/callback/
node $P status                                                  # connected accounts, missing env vars, IG quota, queue
node $P enviar work/publicacao.json [--so ids] [--plataforma yt,tt,ig] [--teste] [--forcar]
node $P fila                                                    # publish due queue items (cron every 15 min)
node $P kit work/publicacao.json                                # manual mode: kit-publicacao/<plataforma>/ with ordered files + LEGENDAS.txt
node $P horarios <n>                                            # next n free slots from config.publicacao (agenda.json avoids clashes)

cd ~/.maquina-cortes-gta/engine && npm run studio               # Remotion Studio for the SplitCut composition

# Python SFX generator tests (offline, unittest)
python3 -m unittest discover -s ferramentas/sfx/tests
node --test ferramentas/publicar/tests/                          # publishing tool tests (offline, mocked fetch)
```

There is no lint config, JS test suite or build step for the repo itself. Requires Node 18+ (22+ preferred), ffmpeg/ffprobe, and a recent yt-dlp (setup warns if older than 120 days).

## Architecture

- **`motor/scripts/build.mjs`** is the core: reads `source.mp4`, `captions.json`, `silences.json`, `meta.json`, `cuts.json` (optional `bottom.mp4`) from the work dir. Per clip it shortens pauses to ~0.2 s (producing `segments`), remaps word timings to the new timeline, marks `keywords` (accent/case/punctuation-insensitive multi-word match), resolves the streamer palette and watermark, then invokes Remotion with `--props` and finally loudness-normalizes. The `cuts.json` schema is documented in the header comment of `build.mjs` — it is the contract between the SKILL.md instructions and the engine; keep both in sync when changing it.
- **Layouts**: `cuts.json.layout` (overridable per clip) is `"papo"` (speaker top 50%, B-roll bottom), `"gameplay"` (webcam top ~38%, `gameCrop` of the game bottom ~62%, or full game with `semCamera`), or `"cheia"` (full screen, `focusTrack` follows the person). All three are rendered by the single Remotion composition `SplitCut` (`motor/src/SplitCut.jsx`, registered in `Root.jsx`, whose `defaultProps` show the prop shape `build.mjs` produces).
- **Skills**: each `SKILL.md` is a numbered procedure (check install → watermark/palette first-run → download with yt-dlp → transcribe → pick cuts by hook → user approval → write `cuts.json` → build). Skill-specific framing rules live in each skill's `references/`; shared rules (setup/download/transcription steps in `preparacao.md`, hooks, effects, style, troubleshooting) live in `docs/` and are read by the other skills from `~/.maquina-cortes-gta/docs/`.
- **Optional integrations** are env-var gated and must never be requested or written in chat: `PEXELS_API_KEY` (`buscar-broll.mjs`), `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` (`buscar-imagens.mjs`), `ELEVENLABS_API_KEY` (`gerar-paleta-sfx.mjs` → `sfx/generate_sound.py`, bundled third-party MIT code, see `THIRD_PARTY.md`).
- **Publishing** (`ferramentas/publicar/`, step 11 of each skill, rules in `docs/publicacao.md`): dependency-free Node (`fetch`). `work/publicacao.json` is the contract the skill writes (per clip: `arquivo`, `capaSegundo` in rendered-clip seconds, and optional `youtube`/`tiktok`/`instagram` blocks with text and `quando`); `lib/validar.mjs` checks it; `lib/hashtag.mjs` appends the streamer hashtag (`#<slug>` or `hashtag` in `streamers/<slug>.json`) to every description/caption. `work/publicado.json` records what was sent so re-runs don't duplicate. YouTube schedules natively (`publishAt`); TikTok defaults to drafts (inbox) because unaudited apps can only post privately; TikTok direct and Instagram schedule through the local queue `~/.maquina-cortes-gta/fila.json`. Instagram uses Facebook Login for Business + resumable upload (Instagram Login would need a public video URL). App credentials come from env vars (`YOUTUBE_CLIENT_*`, `TIKTOK_CLIENT_*`, `META_APP_*`); tokens live in `~/.maquina-cortes-gta/contas/` (0600). Publishing is irreversible: skills must get explicit approval of the publication table first.
- Plugin metadata: `.claude-plugin/plugin.json` and `marketplace.json` (bump `version` there on releases).
