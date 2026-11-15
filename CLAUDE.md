# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An automation project (PT-BR) that turns Brazilian streamers' **GTA 6 live VODs** into short-form content for two monetization targets: TikTok (Creator Rewards, cuts of 62–85 s) and YouTube (YPP: Shorts of 35–58 s plus 16:9 compilations of 8–12 min). Daily target: 3 TikToks + 3 Shorts, published at 12:00 / 18:00 / 21:00 BRT. All user-facing text, comments and docs are in Portuguese — keep it that way.

This repo holds the orchestration (three project skills in `.claude/skills/`, Node scripts, config) **and a vendored copy of the editing engine in `motor-cortes/`**: a snapshot (`git archive`) of the MIT-licensed **maquina-cortes-gta** by Pedro Cardoso (upstream `github.com/pedroxcardoso/maquina-cortes-gta`, snapshot of commit `c10a180` on the user's local branch `correcoes`, which adds the top-screen title, render options and `montar-bottom.mjs`). Keep its `LICENSE` and `THIRD_PARTY.md`. `motor-cortes/` has its own CLAUDE.md. The engine does transcription, pause removal, captions and the 9:16 render. **Single copy of the code:** the installed locations are symlinks into `motor-cortes/` — `~/.maquina-cortes-gta/engine → motor-cortes/motor` (its `node_modules/`, ~900 MB with Remotion's Chrome, lives there and is git-ignored), `~/.maquina-cortes-gta/docs`, `/ferramentas` and `/setup.mjs` → their `motor-cortes/` counterparts, and `~/.claude/skills/cortes-{papo,gameplay,video}` → `motor-cortes/skills/*`. So editing `motor-cortes/` takes effect immediately; no sync step. `~/.maquina-cortes-gta` itself stays a real directory for runtime data that must never enter the repo: `whisper.cpp/` + model, `config.json`, `streamers/` (palettes), `contas/` (OAuth tokens), `agenda.json`. `setup.mjs` skips copies whose source and destination resolve to the same path, so re-running it is safe. Pre-migration code backup: `~/.maquina-cortes-gta.bak-codigo-2026-11-15/`. The user's old clone at `~/Documents/cortes/maquina-cortes-gta` is no longer used.

There is no build, lint or test suite here. Scripts are dependency-free ESM (Node 18, global `fetch`/`FormData`).

## Commands

```bash
S=.claude/skills/pipeline-diario-gta6/scripts
E=~/.maquina-cortes-gta/engine/scripts

node $S/coletar.mjs --teste [--horas 168]        # which live VODs would enter today's queue (no writes)
node $S/plano.mjs validar work/plano-*.json       # validate strategy plans (run from cortes/<live>/)
node $S/plano.mjs cuts papo|gameplay work/cuts.json work/plano-*.json   # route a plan into the engine's cuts.json
node $E/montar-bottom.mjs assets/broll-gta6 work  # build the gameplay background for papo cuts
node $E/build.mjs work render [--so <id>]          # render (engine)
node $S/conferir.mjs render work/plano-*.json     # enforce final durations per platform
node $S/compilado.mjs compilado.json compilado.mp4
node $S/para-postar.mjs postagem.json            # copy the proposal's videos into para-postar/ (idempotent)
node $S/agendar.mjs postagem.json --teste         # preview auto-assigned peak-hour slots
node $S/publicar.mjs postagem.json --teste [--so <full-id>]   # dry run; without --teste it really posts
node $S/notificar-email.mjs --simular | --teste   # pending-approval email (Resend)
node $S/encoder.mjs --testar                      # re-detect fastest H.264 encoder (cached in .cache/)
./rodar-diario.sh --turno 09|19 | --repescagem    # the cron entrypoint (see crontab -l)
```

`--so` matches the **full** item id (`tt-01-gasolina-nos-carros`, not `tt-01`).

## Architecture

Flow (orchestrated by the `pipeline-diario-gta6` skill, numbered steps in its SKILL.md):

1. **Collect** — `coletar.mjs` reads `streamers.json`, lists only recorded lives (YouTube `/streams` with `live_status == was_live`; Twitch `archives`), hard floor of 50 min (`MIN_ABSOLUTO_MIN`, config can raise but never lower), GTA 6 terms in title/description, and writes `fila/<date>.json` (dedup via `fila/processados.json`).
2. **Prepare** each live in `cortes/<slug>/work/` following the engine's `docs/preparacao.md` (download, whisper transcription, `trechos.json`).
3. **Plan** — skills `estrategia-tiktok-gta6` and `estrategia-youtube-gta6` write `work/plano-tiktok.json` / `work/plano-youtube.json`. Each cut carries an `edicao` block that **is a clip of the engine's `cuts.json` contract** (documented in the header of the engine's `build.mjs`), minus framing fields (`crop`/`gameCrop`/`focus`), which the editing skill measures from frames. `plano.mjs` is the contract checker between the two.
4. **Route & render** — `tipo: gameplay → cortes-gameplay`, `tipo: papo → cortes-papo`, one type at a time (the engine renders every clip in `cuts.json`; copies kept as `work/cuts-<tipo>.json`). `plano.mjs cuts` injects the top-screen title (`titulo`, `tituloDur`, `tituloSfx` from `assets/sfx/`). Output in `render/` is final — there is no post-processing step.
5. **Check** — `conferir.mjs` (final duration after pause removal; the plan's raw window must account for ~0.85 ratio on raw lives, 0.91–0.98 on edited videos).
6. **Compilation** — YouTube segments accumulate in `banco-compilado/segmentos.json`; `compilado.mjs` builds 16:9 with ffmpeg (2 s text cards + whoosh between source clips, `<out>.capitulos.txt` for chapters).
7. **Publish** — proposal written to `cortes/<live>/postagem.json` (all `aprovado: false`), `para-postar.mjs` copies each video to `para-postar/<live>--<id>.mp4` and repoints `arquivo` there (origin kept in `arquivo_render`; re-run after a re-render), `notificar-email.mjs` emails new pending ids (dedup in `notificados.json`), the user approves in a session, then `publicar.mjs` → `agendar.mjs` fills empty `agendado_para` with the next free peak slot (max 3/day/platform, compilation at 20:00; occupancy = Zernio scheduled posts + every `postagem.json`, deduplicated) → `zernio.mjs` (presigned upload + `POST /posts`). Sent items are recorded in `postado.json` and never re-sent; on a confirmed send `publicar.mjs` moves the file from `para-postar/` to `postados/` and updates both JSONs (failures stay in `para-postar/`). So `para-postar/` always holds exactly what awaits the user's OK.

`env.mjs` is shared by all scripts: `RAIZ` (project root, overridable with `PROJETO_GTA6`), `.env` loader (does not override real env vars), `config()` = `pipeline.config.json` (`modo_revisao_manual`, `publicador`, `zernio` settings, `agenda`).

## Invariants (decisions already made by the user — don't reopen)

- **No TTS narration.** It was removed on purpose; old scripts are in `arquivo/narracao-tts/` for reference only. The hook is the visual top-screen title (≤ 6 words, first 4 s, impact + whoosh).
- **Authorization** (`autorizacoes.json`): `autorizado` / `politica_publica_de_clipes` publish normally; `pendente` / `nao_verificado` require a per-item approval when `modo_revisao_manual: true` (`aprovado_sem_autorizacao`); `proibido` (streamer's channel explicitly forbids cuts — currently alanzoka and Flow Games) is blocked everywhere: collector skips it and `plano.mjs` rejects it. Statuses come from what the channel actually states; never set `autorizado` without evidence.
- **The unattended run never publishes.** `rodar-diario.sh` sets `PIPELINE_HEADLESS=1` (makes `publicar.mjs` exit 3 unless `--teste`) and `coletar.mjs --disparar` launches `claude -p --permission-mode dontAsk --settings .claude/headless-settings.json`. Prefix `deny` rules alone are bypassable, so keep the env guard when touching the publisher.
- **B-roll** only from `assets/broll-gta6/` (muted). Current files are cuts of official Rockstar trailers as a placeholder until the user records their own gameplay (see its `LEIA.md`). No Pexels, no third-party gameplay, no leaks.
- `postagem.json` with `"calibracao": true` marks test material: never publish it; the notifier and `para-postar.mjs` ignore it. (The original calibration lots were deleted on 2026-11-15.)
- Licensed music audible in a segment ⇒ discard the segment (the engine can't separate tracks).

## Environment notes

- Git: `origin` = `git@github.com-pessoal:AK470301/maquina-cortes.git` (host alias from `~/.ssh/config` that selects the user's GitHub key `id_ed25519_meu_github`; plain `git@github.com:` would not use it), branch `main`. `.gitignore` excludes `.env`, all media (`*.mp4`, `cortes/`, `compilados/`, `para-postar/*`, `postados/*`, `assets/broll-gta6/*.mp4`) and runtime state (`fila/`, `notificados.json`, `postado.json`, `postagem.json`, `banco-compilado/segmentos.json`); `.env.example` lists the variables. The user's GitHub SSH key is mapped to the host alias `github.com-pessoal` in `~/.ssh/config`; `ssh` to GitHub hangs when run from Claude's tools (probably waiting for a key passphrase), so pushes are run by the user in their own terminal; commit locally and stop. `.gitignore` also excludes `*.zip`: local backups (e.g. `backup-seguro-migrar.zip`) contain the `.env`.
- `.env` (600, git-ignored) holds `ZERNIO_*`, `RESEND_API_KEY`/`EMAIL_*`, `POST_API_*` (webhook alternative), `FFMPEG_HW`. Never print or echo values.
- GPU is an AMD Radeon 680M: VAAPI works only through `/usr/bin/ffmpeg` (`FFMPEG_HW`); the static ffmpeg in `~/.local/bin` (first on PATH) can't load the system libva. Remotion doesn't use the GPU on Linux, so 9:16 renders stay CPU-bound (~2.4 s per output second).
- Cron (`crontab -l`): turns at 09:00 and 19:00 plus `@reboot` catch-up; per-turn markers in `fila/turnos/<date>-<turn>.ok` are written only on success; log in `fila/cron.log`.
