#!/usr/bin/env python3
"""
Parse Vision OCR output of a stitched Been timeline into structured records.

Input:
  ocr.json     — array of {text, x, y, w, h, conf} from ocr.swift
  stitched.png — same image (used to sample dot color: orange = visited, green = lived)

Output: JSON array of:
  { country, startMonth, startYear, endMonth, endYear, kind, raw }

Layout assumptions (Been "Compare Stats" timeline export):
  • each entry is two consecutive OCR lines: country, then date
  • country line: leading flag/dot glyph followed by the country name
  • date line: "Mon, YYYY" | "Mon - Mon, YYYY" | "Mon, YYYY - Mon, YYYY"
  • year-only lines ("2025", "1988", …) are section separators and ignored
"""
import json, re, sys
from PIL import Image

YEAR_RE = re.compile(r"^\s*\d{4}\s*$")
MONTH = r"[A-Z][a-z]{2}"

VALID_MONTHS = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

# Vision occasionally mis-OCRs a partially-clipped month: "Sep" reads as
# "Sen" (n→p) or "Seo" (o→p) when the descenders are cut off. Normalize.
MONTH_FIX = {"Sen": "Sep", "Seo": "Sep", "Sep.": "Sep", "Sept": "Sep"}

def fix_month(m: str) -> str:
    m = MONTH_FIX.get(m, m)
    return m if m in VALID_MONTHS else m

def clean_country(s: str) -> str:
    # Strip the leading flag/dot/bullet noise from the OCR'd country line.
    # Real country names: "United States of America", "El Salvador", "San
    # Marino", "St Lucia", "Côte d'Ivoire". Noise: "•", "+", "EK", "II",
    # "zK", "i-", lone uppercase letters, etc.
    s = s.strip()
    # Replace anything that isn't a letter, space, hyphen, or apostrophe.
    s = re.sub(r"[^A-Za-z\s'’\-]", " ", s)
    tokens = s.split()
    while tokens:
        t = tokens[0]
        if len(t) < 2:                          # single letter (e, I, K, …)
            tokens.pop(0); continue
        if not t[0].isupper():                   # starts lowercase ("zK", "i-")
            tokens.pop(0); continue
        if len(t) <= 2 and t.isupper():         # all-caps short ("EK", "II")
            tokens.pop(0); continue
        break
    return " ".join(tokens).strip()

def dedupe_by_y(lines, y_tol=10):
    """Vision often emits two observations per entry: one with the flag/dot
    glyph included (low x ≈ 80) and a clean one (x ≈ 150+). When two lines
    share roughly the same y, prefer the higher-x clean version."""
    lines = sorted(lines, key=lambda l: (l["y"], l["x"]))
    groups = []
    for ln in lines:
        if groups and abs(ln["y"] - groups[-1][0]["y"]) <= y_tol:
            groups[-1].append(ln)
        else:
            groups.append([ln])
    out = []
    for g in groups:
        # If any candidate text matches the date pattern, treat that as the
        # canonical version of this row regardless of x.
        date_cands = [l for l in g if parse_date(l["text"]) is not None]
        if date_cands:
            out.append(min(date_cands, key=lambda l: l["x"]))
            continue
        # Otherwise prefer the cleanest country candidate: highest x with
        # a plausible "Country Name" body.
        country_cands = [l for l in g
                         if re.match(r"^[^A-Za-z]{0,4}[A-Z][A-Za-z'’.\- ]{1,}$",
                                     l["text"].strip())]
        if country_cands:
            out.append(max(country_cands, key=lambda l: l["x"]))
            continue
        # Fall back to the first line in the group.
        out.append(g[0])
    return out

def parse_date(raw: str):
    s = raw.replace("—", "-").replace("–", "-").strip()
    s = s.replace(",", ", ").replace("  ", " ")
    parts = [p.strip().rstrip(",").strip() for p in s.split("-")]
    if len(parts) == 1:
        m = re.match(rf"^({MONTH})\.?,?\s*(\d{{4}})$", parts[0])
        if m:
            mo, yr = m.group(1), int(m.group(2))
            return mo, yr, mo, yr
    elif len(parts) == 2:
        a, b = parts
        mb = re.match(rf"^({MONTH})\.?,?\s*(\d{{4}})$", b)
        if not mb: return None
        end_mo, end_yr = mb.group(1), int(mb.group(2))
        # case 1: "May - Jun, 2025"  (no year on the left → same year)
        ma1 = re.match(rf"^({MONTH})\.?,?$", a)
        if ma1:
            return ma1.group(1), end_yr, end_mo, end_yr
        # case 2: "Sep, 1988 - Dec, 2026"
        ma2 = re.match(rf"^({MONTH})\.?,?\s*(\d{{4}})$", a)
        if ma2:
            return ma2.group(1), int(ma2.group(2)), end_mo, end_yr
    return None

def sample_dot_color(img, line):
    # The dot is at the very left of each entry, vertically centered on the
    # country-name line. The country-text bounding box starts after both the
    # dot and the flag emoji (typically x ≈ 87+); the dot itself sits around
    # x ≈ 45-55 in the 752-wide canvas.
    cy = line["y"] + line["h"] // 2
    W = img.size[0]
    H = img.size[1]
    cy = max(0, min(H - 1, cy))
    # Average a few pixels to be robust against anti-aliasing.
    rs, gs, bs = [], [], []
    for x in (44, 48, 52, 56):
        if 0 <= x < W:
            r, g, b = img.getpixel((x, cy))[:3]
            rs.append(r); gs.append(g); bs.append(b)
    if not rs: return "unknown", (0, 0, 0)
    r, g, b = sum(rs) / len(rs), sum(gs) / len(gs), sum(bs) / len(bs)
    # Orange ~ (225, 145, 30); Green ~ (120, 195, 65); Background ~ (240, 240, 240)
    if max(r, g, b) - min(r, g, b) < 30:
        return "unknown", (round(r), round(g), round(b))
    if g > r:
        return "lived", (round(r), round(g), round(b))
    return "visited", (round(r), round(g), round(b))

def main():
    if len(sys.argv) != 4:
        print("usage: parse.py <ocr.json> <stitched.png> <out.json>", file=sys.stderr)
        sys.exit(2)
    ocr = json.load(open(sys.argv[1]))
    img = Image.open(sys.argv[2]).convert("RGB")
    out_path = sys.argv[3]

    lines = dedupe_by_y(ocr)
    entries = []
    skipped = []
    i = 0
    while i < len(lines):
        line = lines[i]
        text = line["text"].strip()
        if YEAR_RE.match(text):
            i += 1
            continue
        # Try (country, date) pair with the next line.
        if i + 1 < len(lines):
            nxt = lines[i + 1]
            parsed = parse_date(nxt["text"])
            if parsed:
                country = clean_country(text)
                start_mo, start_yr, end_mo, end_yr = parsed
                start_mo = fix_month(start_mo)
                end_mo = fix_month(end_mo)
                kind, rgb = sample_dot_color(img, line)
                entries.append({
                    "country": country,
                    "startMonth": start_mo,
                    "startYear": start_yr,
                    "endMonth": end_mo,
                    "endYear": end_yr,
                    "kind": kind,
                    "dotRGB": rgb,
                    "raw": {"country": text, "date": nxt["text"], "y": line["y"]},
                })
                i += 2
                continue
        skipped.append({"text": text, "y": line["y"]})
        i += 1

    print(f"parsed {len(entries)} entries, skipped {len(skipped)}", file=sys.stderr)
    if skipped:
        for s in skipped:
            print(f"  skipped @y={s['y']}: {s['text']!r}", file=sys.stderr)
    with open(out_path, "w") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
    print(f"wrote {out_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
