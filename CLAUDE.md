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

Live radar (skill `modo-ao-vivo-gta6`, independent of the daily queue and of the 09:00/19:00 tasks):

```bash
node scripts/radar-ao-vivo.mjs --canais coringa,luquet4 [--duracao 65 --antes 45 --fator 3 --piso 8 --cooldown 90 --max-hora 6]
node scripts/radar-ao-vivo.mjs --testar-irc <canal>                 # joins the chat for 20 s and counts messages
node scripts/radar-ao-vivo.mjs --simular <video> [--canal <canal>]  # synthetic-chat detector test + full clip, saved as calibration
node $S/publicar.mjs cortes/ao-vivo-<canal>/postagem.json --so <id> [--agora]   # --agora: post now instead of the peak slots
node $S/publicar.mjs cortes/ao-vivo-<canal>/postagem.json --agendar <id1>,<id2>  # move live clips to the normal peak-slot queue
```

## Live radar

`scripts/radar-ao-vivo.mjs` (dependency-free; imports `env.mjs` and `encoder.mjs` from the pipeline skill; needs `streamlink` — on Windows winget puts it in `%LOCALAPPDATA%\Programs\Streamlink\bin`, which the script also probes). Per Twitch channel: an anonymous read-only IRC socket (`irc.chat.twitch.tv:6667`, `NICK justinfan<n>`) and `streamlink twitch.tv/<canal> <qualidade> -o fila/live-<canal>.ts --retry-streams 30 --force`. Every 10 s the `Detector` compares the last 10 s of chat with the per-10 s average of the previous 5 min; a spike needs ≥ `--fator`× the average, ≥ `--piso` messages, 1 min of history and the per-channel cooldown; at most `--max-hora` clips per channel per hour (default 6, 0 = no cap). On a spike it waits for the post-spike footage, then (one clip at a time, async so the chat keeps being read) cuts from the growing `.ts`, transcribes with the engine's whisper.cpp (`main -ml 1 -sow -oj`, one segment per word), writes an `.ass` (3-word pages, spoken word in the streamer's highlight colour) and renders 1080×1920 with ffmpeg through `encoderH264()` (blurred copy of the video as background, 16:9 window centred, −14 LUFS). Output: `para-postar/LIVE--<canal>--<AAAAMMDD-HHMMSS>.mp4` plus an item in `cortes/ao-vivo-<canal>/postagem.json` (`ao_vivo: true`, `aprovado: false`, `titulo_provisorio: true`, transcript, chat sample, live category), then `notificar-email.mjs`. When streamlink exits (live over) the `.ts` is deleted after pending clips finish and streamlink is relaunched to wait for the next live. Log: `fila/radar.log`. Defaults: `--qualidade 720p60,720p,best` (the 16:9 window is 1080 px wide) and `--max-gb 6` (the `.ts` only grows; past the cap, with no pending clip, the recording restarts). Operational guards: a single radar at a time (`fila/.radar.lock`, PID-based); leftover `fila/live-*.ts` and `%TEMP%/radar-*` are removed at start-up; on Windows `streamlink.exe` is a launcher with a `python.exe` child, so the radar kills the whole tree (`taskkill /T /F`) on Ctrl+C, window close (SIGHUP) and exit; `fila/parar-radar` stops it like Ctrl+C and `fila/clipar-<canal>` (or `fila/clipar`) forces a clip on the next tick, bypassing the detector and the hourly cap. `PIPELINE_SEM_EMAIL=1` makes `notificar-email.mjs` behave as `--simular` (rehearsals).

Rules that tie it to the rest: the radar never publishes; `proibido` channels are refused and non-authorized ones produce `sem_autorizacao: true` items (same per-item OK as the pipeline). In `publicar.mjs`, items with `ao_vivo: true` — or any approved item when called with `--agora` — are **immediate sends**: they get `publicar_agora`, skip `agendar.mjs`' peak slots, and are staggered (`pipeline.config.json` → `ao_vivo`: `intervalo_min` 25, `folga_min` 20, `por_dia` 4). The first approved one goes out with `publishNow` unless another immediate send happened (or is still scheduled) within the last 20 min, in which case it joins that sequence (last + 25 min, never less than 16 min from now); each following one in the batch is scheduled 25 min after the previous, in `postagem.json` order. At most 4 immediate sends per day, counted across every `postado.json` (records carry `imediato` and `sai_em`; legacy records without `agendado_para` count as immediate): past the cap the whole run is refused, naming the ids, until the user either moves them to the normal queue with `--agendar id1,id2` (sets `ao_vivo: false`, peak slots of the next days; it does not approve anything) or explicitly confirms with `--acima-do-teto`. The times are recomputed on every run and shown under `escalonamento` in `--teste`. Approval and the `PIPELINE_HEADLESS` guard still apply. `publicar.mjs` also refuses items that still carry `titulo_provisorio` and any `postagem.json` with `calibracao: true` (which `--simular` writes to `cortes/ao-vivo-simulacao-<canal>/`). `para-postar.mjs` leaves `ao_vivo` items where they are (they have no `render/` origin) and deletes the file when one is `descartado`.

## Architecture

Flow (orchestrated by the `pipeline-diario-gta6` skill, numbered steps in its SKILL.md):

1. **Collect** — `coletar.mjs` reads `streamers.json`, lists only recorded lives (YouTube `/streams` with `live_status == was_live`; Twitch `archives`), hard floor of 50 min (`MIN_ABSOLUTO_MIN`, config can raise but never lower), GTA 6 terms in title/description, and writes `fila/<date>.json` (dedup via `fila/processados.json`).
2. **Prepare** each live in `cortes/<slug>/work/` following the engine's `docs/preparacao.md` (download, whisper transcription, `trechos.json`).
3. **Plan** — skills `estrategia-tiktok-gta6` and `estrategia-youtube-gta6` write `work/plano-tiktok.json` / `work/plano-youtube.json`. Each cut carries an `edicao` block that **is a clip of the engine's `cuts.json` contract** (documented in the header of the engine's `build.mjs`), minus framing fields (`crop`/`gameCrop`/`focus`), which the editing skill measures from frames. `plano.mjs` is the contract checker between the two.
4. **Route & render** — `tipo: gameplay → cortes-gameplay`, `tipo: papo → cortes-papo`, one type at a time (the engine renders every clip in `cuts.json`; copies kept as `work/cuts-<tipo>.json`). `plano.mjs cuts` injects the top-screen title (`titulo`, `tituloDur`, `tituloSfx` from `assets/sfx/`). Output in `render/` is final — there is no post-processing step.
5. **Check** — `conferir.mjs` (final duration after pause removal; the plan's raw window must account for ~0.85 ratio on raw lives, 0.91–0.98 on edited videos).
6. **Compilation** — YouTube segments accumulate in `banco-compilado/segmentos.json`; `compilado.mjs` builds 16:9 with ffmpeg (2 s text cards + whoosh between source clips, `<out>.capitulos.txt` for chapters).
7. **Publish** — proposal written to `cortes/<live>/postagem.json` (all `aprovado: false`), `para-postar.mjs` copies each video to `para-postar/<live>--<id>.mp4` and repoints `arquivo` there (origin kept in `arquivo_render`; re-run after a re-render), `notificar-email.mjs` emails new pending ids (dedup in `notificados.json`), the user approves in a session, then `publicar.mjs` → `agendar.mjs` fills empty `agendado_para` with the next free peak slot (max 3/day/platform, compilation at 20:00; occupancy = Zernio scheduled posts + every `postagem.json`, deduplicated) → `zernio.mjs` (presigned upload + `POST /posts`). Sent items are recorded in `postado.json` and never re-sent; on a confirmed send `publicar.mjs` moves the file from `para-postar/` to `postados/` and updates both JSONs (failures stay in `para-postar/`). So `para-postar/` always holds exactly what awaits the user's OK.

**Concurrency.** The radar, the scheduled run and an approval session can touch the same files at once. `motor-cortes/motor/scripts/trava.mjs` is the only lock primitive (exclusive-create lock file holding the owner PID; stale when the PID is dead); `env.mjs` re-exports it and adds `gravarJson` (temp file + rename), `atualizarJson` (re-read under `<file>.lock`, mutate, write) and `salvarItens` (writes back only this process's items by `id:plataforma`, keeping items another process appended). Every writer of `postagem.json`, `postado.json`, `notificados.json`, `fila/*.json` and `.cache/encoder.json` goes through them — don't reintroduce a bare `writeFileSync` on those. Heavy renders are serialized machine-wide by `~/.maquina-cortes-gta/render.lock`: `build.mjs` takes it per clip (so a live clip can slip in between two VOD clips) and the radar takes it around whisper + ffmpeg; both proceed without it after a long wait (30 / 20 min) rather than dropping work. Whisper here is a CPU build, so the contention is CPU (Remotion + whisper), not VRAM or NVENC sessions.

`env.mjs` is shared by all scripts: `RAIZ` (project root, overridable with `PROJETO_GTA6`), `.env` loader (does not override real env vars), `config()` = `pipeline.config.json` (`modo_revisao_manual`, `publicador`, `zernio` settings, `agenda`).

## Invariants (decisions already made by the user — don't reopen)

- **No TTS narration.** It was removed on purpose; old scripts are in `arquivo/narracao-tts/` for reference only. The hook is the visual top-screen title (≤ 6 words, first 4 s, impact + whoosh).
- **Authorization** (`autorizacoes.json`): `autorizado` / `politica_publica_de_clipes` publish normally; `pendente` / `nao_verificado` require a per-item approval when `modo_revisao_manual: true` (`aprovado_sem_autorizacao`); `proibido` (streamer's channel explicitly forbids cuts — currently alanzoka and Flow Games) is blocked everywhere: collector skips it and `plano.mjs` rejects it. Statuses come from what the channel actually states; never set `autorizado` without evidence.
- **The unattended run never publishes.** `rodar-diario.sh` sets `PIPELINE_HEADLESS=1` (makes `publicar.mjs` exit 3 unless `--teste`) and `coletar.mjs --disparar` launches `claude -p --permission-mode dontAsk --settings .claude/headless-settings.json`. Prefix `deny` rules alone are bypassable, so keep the env guard when touching the publisher.
- **B-roll** only from `assets/broll-gta6/` (muted). Current files are cuts of official Rockstar trailers as a placeholder until the user records their own gameplay (see its `LEIA.md`). No Pexels, no third-party gameplay, no leaks.
- `postagem.json` with `"calibracao": true` marks test material: never publish it; the notifier and `para-postar.mjs` ignore it. (The original calibration lots were deleted on 2026-11-15.)
- Licensed music audible in a segment ⇒ discard the segment (the engine can't separate tracks).

## Environment notes

- Git: `origin` = `https://github.com/AK470301/maquina-cortes.git`, branch `main`; on the Windows machine `git push origin main` works from Claude's tools (HTTPS with the stored credential, verified 2026-11-16). On the old Linux machine the remote was the SSH host alias `github.com-pessoal`, whose pushes hung from Claude's tools. `.gitignore` excludes `.env`, all media (`*.mp4`, `cortes/`, `compilados/`, `para-postar/*`, `postados/*`, `assets/broll-gta6/*.mp4`) and runtime state (`fila/`, `notificados.json`, `postado.json`, `postagem.json`, `banco-compilado/segmentos.json`); `.env.example` lists the variables. `.gitignore` also excludes `*.zip`: local backups (e.g. `backup-seguro-migrar.zip`) contain the `.env`.
- `.env` (600, git-ignored) holds `ZERNIO_*`, `RESEND_API_KEY`/`EMAIL_*`, `POST_API_*` (webhook alternative), `FFMPEG_HW`. Never print or echo values.
- GPU is an AMD Radeon 680M: VAAPI works only through `/usr/bin/ffmpeg` (`FFMPEG_HW`); the static ffmpeg in `~/.local/bin` (first on PATH) can't load the system libva. Remotion doesn't use the GPU on Linux, so 9:16 renders stay CPU-bound (~2.4 s per output second).
- **Windows machine** (`C:\Users\Lucas\Documents\maquina-cortes`, migrated 2026-11-15; the Linux notes above and below describe the original machine, whose root was `/home/lucas/Documents/projeto-x`): the engine links are directory junctions (`%USERPROFILE%\.maquina-cortes-gta\{engine,docs,ferramentas}` and `%USERPROFILE%\.claude\skills\cortes-*` → `motor-cortes\...`); `~/.maquina-cortes-gta/setup.mjs` is a plain copy there, so re-run `node motor-cortes/instalador/setup.mjs` after editing the installer. GPU is an NVIDIA GTX 1660 SUPER: `encoder.mjs` picks `h264_nvenc` with `FFMPEG_HW=ffmpeg` (candidate order NVENC → AMF → QSV → VAAPI → libx264, each really tested). `claude` is an npm `claude.cmd`, so `coletar.mjs --disparar` launches it through the shell with the prompt on stdin on `win32`. The cron equivalent is `rodar-diario.ps1` (UTF-8 **with BOM**, required by Windows PowerShell 5.1; same arguments plus `--teste` for a dry run) registered in Task Scheduler under `\MaquinaCortes\`: `Turno09`, `Turno19`, `Repescagem` (boot + logon triggers, 2 min delay). Tasks run as the logged-on user only. Skill docs reach the project root as `../../` from `cortes/<live>/` instead of an absolute path.
- Cron (`crontab -l`): turns at 09:00 and 19:00 plus `@reboot` catch-up; per-turn markers in `fila/turnos/<date>-<turn>.ok` are written only on success; log in `fila/cron.log`.
