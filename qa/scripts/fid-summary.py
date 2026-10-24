"""One line per fidelity scenario from a qa/scripts/fid-run.mjs evidence file.

    python qa/scripts/fid-summary.py qa/evidence/fresh/fid-all.json
"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
rows = json.load(open(sys.argv[1], encoding="utf8"))
for x in rows:
    m = x.get("metrics", {})
    g = lambda k: (x.get(k) or "-")[:4]
    print(
        f"{x['tool'][:24]:24} {x['test'][:30]:30} {x['verdict']:7} T={g('text'):4} L={g('layout'):4} F={g('formatting'):4} I={g('images'):4} Tb={g('tables'):4} "
        f"pg={m.get('srcPages')}/{m.get('outPages')} rec={m.get('textRecall')} med={m.get('posMedianPt')} w12={m.get('within12pt')} w36={m.get('within36pt')} "
        f"line={m.get('lineKept')} size={m.get('sizeAbsKept')} b={m.get('boldKept')} i={m.get('italicKept')} fb={m.get('falseBold')} col={m.get('colorKept')} "
        f"ord={m.get('readingOrder')} img={m.get('imagesSrc')}/{m.get('imagesOut')} iou={m.get('imageIoU')} ssim={m.get('pageSSIM')} {x.get('error', '')[:100]}"
    )
