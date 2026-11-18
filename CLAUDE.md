# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠ MODO MORTE SÚBITA — the only operating mode

**Since 2026-11-18 (GTA 6 launch) this system operates exclusively in Modo Morte Súbita.** It is active while `config/morte-subita.ativo` exists, and **only the user can deactivate or revert it, by an explicit manual command** ("desative o Modo Morte Súbita" or equivalent). Never deactivate it, delete the state file, re-enable the old flow or reintroduce content locks on your own initiative, not even to "fix" something.

**The ONLY content restriction is that videos must be in Portuguese.** No creator lock (authorization status, `proibido`), no theme lock (GTA 6 or not), no spoiler lock, no channel/format restriction. What remains are **technical** limits only: final duration 20–55 s with the hook in the 1st second, no audible licensed music (the engine can't separate tracks), video must be downloadable without login (age-restricted needs browser cookies, which are only used if the user asks), clip ≥ 21 s source. **Nothing is ever published automatically:** every clip waits for the user's manual approval (`postagem.json` items are `aprovado: false`; `publicar.mjs` and its `PIPELINE_HEADLESS` guard are unchanged, and items from creators without registered authorization still need a per-item OK).

All user-facing text, comments and docs are in Portuguese (PT-BR) — keep it that way.

Pre-Morte-Súbita backup (scripts, `.claude/`, engine scripts, `CLAUDE.md`, `streamers.json`, `autorizacoes.json`, `pipeline.config.json`, old cron scripts, `.env`, Task Scheduler XMLs): `backup-pre-morte-subita/` (git-ignored). The previous commit `6e90b41` is the last pre-Morte-Súbita state in git.

## Commands

```bash
M=scripts/morte-subita
.\processar-link.ps1 <url> [--teste] [--forcar]     # manual entry: live → radar; VOD/long/Short → cuts in render/ + e-mail
.\rodar-cron.ps1 --turno 09|21 [--teste]            # the cron (Task Scheduler MorteSubita09 / MorteSubita21)
node $M/fase1.mjs --teste                           # dry run of Phase 1: the 3 most-viewed unseen PT videos (no writes)
node $M/fase1.mjs --buscar | --preparar id1,id2 --rodada R | --auto --rodada R
node $M/preparar.mjs <url> [--origem link] | --retomar   # download + transcribe one video into fila-entrada/<slug>/
node $M/fase2.mjs listar | iniciar <slug> | finalizar <slug>
node $M/alerta-email.mjs clipes <cortes/slug> | cron --rodada R --hora HH:MM --status ok|vazio|erro   [--simular]
node $M/idioma.mjs <info.json>                      # is this yt-dlp JSON in Portuguese?
node scripts/radar-ao-vivo.mjs --canais coringa,kick:coringa,yt:UCxxxxxxxxxxxxxxxxxxxxxx   # live radar
```

There is no build, lint or test suite. Scripts are dependency-free ESM (Node 18+, global `fetch`). `PIPELINE_SEM_EMAIL=1` (or `--simular`) turns every e-mail into a printout.

## Flows

### 1. Cron (09:00 and 21:00) — `rodar-cron.ps1`

Task Scheduler `\MaquinaCortes\MorteSubita09` and `\MorteSubita21` (daily, logged-on user, "start when available" so a missed run executes at the next boot/logon, 16 h limit). The script first checks `config/morte-subita.ativo` (absent → logs and exits), takes `fila/.rodada.lock`, sets `PIPELINE_HEADLESS=1` and `MS_RODADA=<date>-<turno>`.

- **Phase 1 — `claude-free`**: Claude Code pointed at the local FreeLLMAPI proxy (`CLAUDE_FREE_URL`, default `http://127.0.0.1:31415`, and `CLAUDE_FREE_TOKEN` in `.env` — the same values as the user's `claude-free` function in the PowerShell profile, which Task Scheduler doesn't load). It runs `claude -p --permission-mode dontAsk --settings .claude/headless-settings.json` with `scripts/morte-subita/prompt-fase1.md`, which drives `fase1.mjs --buscar` then `--preparar`. `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` are set only around that call and removed right after (`finally`). If the proxy is down, the token is missing, or no `fila-entrada/fase1.json` for this rodada appears, the script runs `fase1.mjs --auto` itself (same rules, deterministic).
  - `fase1.mjs`: YouTube search for `"GTA 6"` and `"GTA VI"` sorted by view count (`results?search_query=…&sp=CAM%253D`, `--flat-playlist`, 200 per term, `--extractor-args youtube:lang=pt`), merged and re-sorted by `view_count`; then full extraction (`--dateafter today-6months`), 6 in parallel, up to 200 checks, until 3 + 3 reserves pass. Drops: live in progress/upcoming/`post_live`, ids in `logs/processados.txt`, outside 6 months, not downloadable without login (`needs_auth`, no formats), < 21 s, **not Portuguese**.
  - Language (`comum.mjs` → `idiomaDoVideo`), strongest evidence first: audio format marked "original" (multi-dub videos: an English video with an auto pt-BR dub is rejected), `language` field, single `<lang>-orig` auto caption, then a text heuristic on title + description using only language-exclusive markers with Unicode boundaries. `lang=pt` makes YouTube return **translated titles in the search listing**, so titles from the flat search are never used for the decision.
  - 0 unseen PT videos → e-mail "o cron rodou às HH:MM e não encontrou vídeos novos em português", turn marker, exit (no Phase 2). 1–3 → ids appended to `logs/processados.txt` **before** downloading, then `preparar.mjs` downloads (≤ 1080p, H.264 preferred, original audio track; AV1/VP9 converted with `encoder.mjs`) and transcribes (engine whisper.cpp, `pt`) into `fila-entrada/<slug>/` (`entrada.json` gets `"pronto": true` at the end; unfinished entries are resumed by `--retomar`/`--auto`).
- **Phase 2 — official `claude`** (proxy variables guaranteed unset): `prompt-fase2.md` → skill **`morte-subita`** (`.claude/skills/morte-subita/SKILL.md`): for each ready entry, `fase2.mjs iniciar` moves it to `cortes/<slug>/work/`, the visual map + `work/plano-cortes.json` (3–5 double cuts in the `plano.mjs` contract, `c-` ids, `plataformas: ["tiktok","youtube_short"]`), `plano.mjs validar`, render per layout through `cortes-gameplay` / `cortes-papo` / `cortes-video`, `conferir.mjs`, then `fase2.mjs finalizar`.
- At the end, **always** one cron status e-mail (`alerta-email.mjs cron`): clips generated (from `logs/clipes-gerados.jsonl` for this rodada), selection, preparation failures, or an explicit error. Entries left in `fila-entrada/` (or `cortes/<slug>/work/` already started) are picked up by the next run.
- Logs: `logs/cron.log`, `logs/morte-subita.log`, Claude output in `logs/claude-<rodada>-fase1|2.log`; turn markers `logs/turnos/<date>-<turno>.ok`.

### 2. Manual link — `processar-link.ps1 <url>`

Inspects with `yt-dlp --dump-json --no-playlist`. `is_live: true` → starts the live radar in its own window for that channel (Twitch name, `kick:<name>`, or `yt:<channel_id>`); refuses if another radar is running (one radar at a time; it can watch several channels). `is_live: false` → language check (only restriction; `--forcar` overrides), `preparar.mjs` into `fila-entrada/`, id appended to `logs/processados.txt`, then the official `claude -p` with `prompt-fase2.md` restricted to that slug. Same cleanup and clip e-mail as the cron. Log: `logs/processar-link.log`.

### 3. Live radar — `scripts/radar-ao-vivo.mjs`

Unchanged mechanics (streamlink recording, spike → 40 s clip, whisper, ffmpeg 9:16, output in `para-postar/LIVE--…mp4` + `cortes/ao-vivo-<canal>/postagem.json`, then `notificar-email.mjs` per clip). Morte Súbita changes: `proibido` channels are no longer refused (clips are born `sem_autorizacao`), and **YouTube lives** are supported as `yt:<UC… channel id>` or `yt:@handle` (records `youtube.com/channel/<id>/live`, audio-spike detector like Kick, label `yt-<canal>`). Twitch = chat-spike detector; Kick/YouTube = `DetectorAudio` (`--audio-db`, uncalibrated). Operational details (lock, `fila/parar-radar`, `fila/clipar-<canal>`, Windows process-tree kill, `--max-gb`) are in the header of the script and in the `modo-ao-vivo-gta6` skill.

## Mandatory rules (all flows)

- **Cleanup after render:** as soon as the final MP4s are confirmed in `cortes/<slug>/render/`, `fase2.mjs finalizar <slug>` deletes the raw video, **the whole `work/` folder** and `fila-entrada/<slug>/`. It refuses (exit 1, nothing deleted) when no valid MP4 exists, so a failed render can be retried. The radar already deletes its temp folder per clip and its `.ts` when a live ends. Never delete `render/`, `postados/`, `logs/processados.txt` or `fila/processados.json` (history of processed ids). `finalizar` writes, before deleting, `cortes/<slug>/postagem.json` (proposal, `aprovado: false`, `arquivo: render/<id>.mp4`, `morte_subita: true`, `fonte`) and `cortes/<slug>/cortes.json` (summary), and appends to `logs/clipes-gerados.jsonl`. Re-rendering after `finalizar` is not possible (work/ is gone) — fix inside Phase 2 before finalizing.
- **E-mail triggers** (Resend API, `RESEND_API_KEY`/`EMAIL_DESTINO`/`EMAIL_REMETENTE` in `.env`; `notificar-email.mjs` is kept intact and still used by the radar; `scripts/morte-subita/comum.mjs` → `enviarEmail` is the same call for the new alerts): (a) **clip generated** — `finalizar` for every VOD flow (cron and manual link) with summary, titles and `render/` paths; the radar per clip via `notificar-email.mjs`; (b) **cron status** — every `rodar-cron.ps1` run, including "rodou normalmente, mas não havia vídeos inéditos em português".
- `plano.mjs` under Morte Súbita (`env.mjs` → `morteSubita()`): skips the `proibido` error, the "no #gta6 on non-GTA-6 cut" rule and the spoiler warning; adds a non-blocking "sem autorização" warning. Everything technical (fields, durations from `modo.mjs` preset `crescimento` = 20–55 s, hook ≤ 1 s, layout routing, `musica_licenciada`, overlap) still blocks. `sobre_gta6` is still required: it only picks the B-roll background (`papo` + true → `assets/broll-gta6/` bottom; false → layout `cheia`).
- **No TTS narration** (removed on purpose; `arquivo/narracao-tts/` is reference only). The hook is the top-screen title (≤ 6 words, 3 s, impact + whoosh from `assets/sfx/`).
- **B-roll** only from `assets/broll-gta6/` (muted; currently official trailer cuts as placeholder). No Pexels, no third-party gameplay as background.
- **Never publish without the user's OK.** Publishing (`publicar.mjs` → Zernio, peak slots via `agendar.mjs`, live immediate-send stagger) is unchanged and only happens in an interactive session after explicit approval; see the `pipeline-diario-gta6` skill, step 9, for the approval/publish procedure. `.claude/headless-settings.json` (used by both phases) allows node/ffmpeg/yt-dlp/cd/file tools and denies `rm`, `curl`, `git push`, the engine publisher and WebFetch.

## Deactivating Modo Morte Súbita (only on the user's explicit command)

1. Delete `config/morte-subita.ativo`. Immediately: `rodar-cron.ps1` and `processar-link.ps1` stop doing anything, `plano.mjs` and the radar return to the creator/theme/spoiler rules, and the old `rodar-diario.ps1` (which no-ops while the file exists) runs again.
2. Task Scheduler (admin PowerShell, because the old tasks were registered elevated): `Disable-ScheduledTask -TaskPath '\MaquinaCortes\' -TaskName MorteSubita09` and `MorteSubita21` (optional — they no-op without the state file); make sure `Turno09`, `Turno19` and `Repescagem` are enabled (`Enable-ScheduledTask`). Their original XMLs are in `backup-pre-morte-subita/agendador/` (`schtasks /create /xml <file> /tn \MaquinaCortes\<name>`).
3. Restore this file from `backup-pre-morte-subita/CLAUDE.md` (or from git at `6e90b41`), which documents the streamer pipeline, monetization modes and the old cron. The Morte Súbita scripts can stay; `logs/` keeps the history.
4. The old "modo aquecimento" in `streamers.json` expired on 2026-11-18; on reactivating the old flow, delete its `aquecimento`/`_aquecimento` keys and the "Modo aquecimento" sections of the pipeline and strategy skills (keep the permanent `sobre_gta6` B-roll rule).

## Engine and architecture (unchanged)

The repo holds the orchestration (skills in `.claude/skills/`, Node scripts, config) and a vendored copy of the MIT-licensed editing engine in `motor-cortes/` (snapshot of `github.com/pedroxcardoso/maquina-cortes-gta` commit `c10a180`, branch `correcoes`; keep its `LICENSE` and `THIRD_PARTY.md`; it has its own CLAUDE.md). Installed locations are links into `motor-cortes/`: `~/.maquina-cortes-gta/{engine,docs,ferramentas}` and `~/.claude/skills/cortes-{papo,gameplay,video}` (directory junctions on Windows; `engine/node_modules/` ~900 MB is git-ignored). `~/.maquina-cortes-gta` itself keeps runtime data: `whisper.cpp/` + model, `config.json`, `streamers/` (caption palettes; unknown creators get white + yellow), `contas/`. The engine's `build.mjs` header documents the `cuts.json` contract that `plano.mjs` checks.

**Concurrency:** `motor-cortes/motor/scripts/trava.mjs` is the only lock primitive; `env.mjs` re-exports it with `gravarJson`/`atualizarJson`/`salvarItens` — every writer of `postagem.json`, `postado.json`, `notificados.json`, `fila/*.json`, `.cache/encoder.json` goes through them. `logs/processados.txt` is appended under `<file>.lock`. Heavy renders are serialized machine-wide by `~/.maquina-cortes-gta/render.lock` (`build.mjs` per clip, the radar around whisper + ffmpeg). Cron runs are serialized by `fila/.rodada.lock`; one radar at a time by `fila/.radar.lock`.

## Environment notes

- Windows machine `C:\Users\Lucas\Documents\maquina-cortes`. GPU NVIDIA GTX 1660 SUPER: `encoder.mjs` picks `h264_nvenc` (`FFMPEG_HW=ffmpeg`). Whisper is a CPU build. `claude` is an npm `claude.cmd`; scripts call it through `cmd /c` with the prompt on stdin. streamlink lives in `%LOCALAPPDATA%\Programs\Streamlink\bin`. `.ps1` files are UTF-8 **with BOM** (Windows PowerShell 5.1).
- `.env` (git-ignored; never print values): `ZERNIO_*`, `RESEND_API_KEY`/`EMAIL_*`, `POST_API_*`, `FFMPEG_HW`, `CLAUDE_FREE_URL`, `CLAUDE_FREE_TOKEN`.
- Git: `origin` = `https://github.com/AK470301/maquina-cortes.git`, branch `main`; `git push origin main` works from Claude's tools. `.gitignore` excludes `.env`, media, `cortes/`, `para-postar/*`, `postados/*`, runtime state (`fila/`, `fila-entrada/`, `logs/`, `notificados.json`, `postado.json`, `postagem.json`), `backup-*/` and `*.zip`.
- Legacy, inactive while Morte Súbita is on: `rodar-diario.ps1`/`.sh` + `coletar.mjs` (streamer VOD queue from `streamers.json`), the strategy skills `estrategia-tiktok-gta6`/`estrategia-youtube-gta6`, compilations (`compilado.mjs`). Their documentation is in `backup-pre-morte-subita/CLAUDE.md` and in the skills themselves.
