#!/usr/bin/env python3
"""Gera as falas do roteiro com edge-tts (gratuito, sem chave) e o tempo de cada palavra, para a legenda.

Uso: python edge_tts_lote.py <roteiro.json> <pasta-saida> [--voz pt-BR-AntonioNeural] [--velocidade +8%] [--refazer]
Para cada {"id", "texto"} grava <id>.mp3 e <id>.json ({"texto", "palavras": [{"t", "inicio", "fim"}]}, em segundos).
Imprime um JSON com o status de cada fala. O texto vai para o serviço de voz da Microsoft (Edge Read Aloud).
"""
import argparse
import asyncio
import json
import os
import sys

import edge_tts


async def gerar(texto, voz, velocidade, mp3, meta):
    com = edge_tts.Communicate(texto, voz, rate=velocidade, boundary="WordBoundary")
    palavras = []
    with open(mp3 + ".tmp", "wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                ini = chunk["offset"] / 1e7  # unidades de 100 ns
                palavras.append({"t": chunk["text"], "inicio": round(ini, 3), "fim": round(ini + chunk["duration"] / 1e7, 3)})
    os.replace(mp3 + ".tmp", mp3)
    with open(meta, "w", encoding="utf-8") as f:
        json.dump({"texto": texto, "palavras": palavras}, f, ensure_ascii=False)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("roteiro")
    ap.add_argument("pasta")
    ap.add_argument("--voz", default="pt-BR-AntonioNeural")
    ap.add_argument("--velocidade", default="+8%")
    ap.add_argument("--refazer", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.pasta, exist_ok=True)
    with open(a.roteiro, encoding="utf-8") as f:
        itens = json.load(f)
    feitos = []
    for it in itens:
        mp3 = os.path.join(a.pasta, f"{it['id']}.mp3")
        meta = os.path.join(a.pasta, f"{it['id']}.json")
        if not a.refazer and os.path.exists(mp3) and os.path.exists(meta):
            feitos.append({"id": it["id"], "arquivo": mp3, "status": "mantido"})
            continue
        try:
            await gerar(it["texto"], a.voz, a.velocidade, mp3, meta)
            feitos.append({"id": it["id"], "arquivo": mp3, "status": "gerado"})
        except Exception as e:  # rede, voz inválida, serviço fora do ar
            feitos.append({"id": it["id"], "status": f"erro: {e}"})
    print(json.dumps(feitos, ensure_ascii=False, indent=2))
    sys.exit(1 if any(f["status"].startswith("erro") for f in feitos) else 0)


asyncio.run(main())
