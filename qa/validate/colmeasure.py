"""Column layout measurements between a reference PDF and an output PDF — QA only.

    python qa/validate/colmeasure.py REF.pdf OUT.pdf [--page N] [--split X] [--from Y]   -> one JSON line

Words are grouped into lines per column (split at X points, default the page centre). For each column:
x-range, number of lines, the first line's top (column start), paragraph heights (blocks of lines separated
by a gap larger than 1.5x the line pitch), and line-wrap agreement — the share of reference lines whose last
word ends a line in the output too (same word, same occurrence), i.e. lines that break in the same place.
"""
import argparse
import json
import re
import sys

import pymupdf

sys.stdout.reconfigure(encoding="utf-8")


def lines_of(page, split, top=0):
    cols = {0: [], 1: []}
    for x0, y0, x1, y1, w, b, l, n in page.get_text("words"):
        if y0 < top:
            continue
        col = 0 if (x0 + x1) / 2 < split else 1
        cols[col].append((round(y1, 1), x0, x1, y0, re.sub(r"\W+", "", w.lower())))
    out = {}
    for c, ws in cols.items():
        ws.sort(key=lambda t: (t[0], t[1]))
        lines = []
        for t in ws:
            if lines and abs(lines[-1]["base"] - t[0]) < 2:
                lines[-1]["words"].append(t)
            else:
                lines.append({"base": t[0], "words": [t]})
        for ln in lines:
            ln["x0"] = min(w[1] for w in ln["words"])
            ln["x1"] = max(w[2] for w in ln["words"])
            ln["top"] = min(w[3] for w in ln["words"])
            ln["last"] = ln["words"][-1][4]
        out[c] = lines
    return out


def paragraphs(lines):
    if len(lines) < 2:
        return [round(lines[0]["base"] - lines[0]["top"], 1)] if lines else []
    pitches = sorted(b["base"] - a["base"] for a, b in zip(lines, lines[1:]))
    pitch = pitches[len(pitches) // 4]
    blocks, start = [], 0
    for i in range(1, len(lines) + 1):
        if i == len(lines) or lines[i]["base"] - lines[i - 1]["base"] > pitch * 1.5:
            blocks.append(round(lines[i - 1]["base"] - lines[start]["top"], 1))
            start = i
    return blocks


def ends(lines):
    seen, out = {}, []
    for ln in lines:
        k = ln["last"]
        seen[k] = seen.get(k, 0) + 1
        out.append((k, seen[k]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("out")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--split", type=float)
    ap.add_argument("--from", dest="top", type=float, default=0, help="ignore words above this y (points, top-down): a full-width title")
    a = ap.parse_args()
    R, O = pymupdf.open(a.ref), pymupdf.open(a.out)
    rp, op = R[a.page - 1], O[a.page - 1]
    split = a.split or rp.rect.width / 2
    rl, ol = lines_of(rp, split, a.top), lines_of(op, split, a.top)
    res = {"pagesRef": R.page_count, "pagesOut": O.page_count, "columns": []}
    for c in (0, 1):
        r, o = rl[c], ol[c]
        re_, oe = ends(r), set(ends(o))
        same = sum(1 for e in re_ if e in oe)
        res["columns"].append({
            "column": c + 1,
            "linesRef": len(r), "linesOut": len(o),
            "xRef": [round(min((l["x0"] for l in r), default=0), 1), round(max((l["x1"] for l in r), default=0), 1)],
            "xOut": [round(min((l["x0"] for l in o), default=0), 1), round(max((l["x1"] for l in o), default=0), 1)],
            "startRef": round(r[0]["top"], 1) if r else None, "startOut": round(o[0]["top"], 1) if o else None,
            "paragraphsRef": paragraphs(r), "paragraphsOut": paragraphs(o),
            "lineBreaksSame": f"{same}/{len(r)}", "lineBreaksSamePct": round(same / max(1, len(r)) * 100, 1),
        })
    print(json.dumps(res))


if __name__ == "__main__":
    main()
