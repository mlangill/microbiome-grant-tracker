#!/usr/bin/env python3
"""Validate data/grants.yaml and build the static site.

Usage:
    python scripts/build.py            # validate + build into _site/
    python scripts/build.py --check    # validate only (non-zero exit on errors)
    python scripts/build.py --out DIR  # build into another directory
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE_SRC = ROOT / "site"

REQUIRED = ["id", "title", "funder", "funder_country", "category", "microbiome_focus",
            "canadian_eligibility", "deadlines", "amount", "url", "summary", "last_verified", "added"]
ENUMS = {
    "category": {"microbiome", "adjacent", "open-program"},
    "microbiome_focus": {"human", "general", "animal", "environmental", "none"},
    "canadian_eligibility": {"lead", "partner", "none"},
    "funder_country": {"CA", "US", "EU", "UK", "INTL", "OTHER"},
}
AMOUNT_KEYS = {"currency", "max_per_year", "max_total", "typical_per_year", "typical_total", "note"}
VERIFY_FIELDS = {"deadlines", "amount", "eligibility", "url", "duration"}


def as_date(value, where, errors):
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value))
    except ValueError:
        errors.append(f"{where}: bad date {value!r} (use YYYY-MM-DD)")
        return None


def validate(grants, config):
    errors, seen = [], set()
    if not isinstance(grants, list):
        return ["grants.yaml must be a list of entries"]
    for i, g in enumerate(grants):
        where = f"entry #{i + 1} ({g.get('id', '?')})"
        for key in REQUIRED:
            if key not in g:
                errors.append(f"{where}: missing '{key}'")
        if g.get("id") in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(g.get("id"))
        for key, allowed in ENUMS.items():
            if key in g and g[key] not in allowed:
                errors.append(f"{where}: {key}={g[key]!r} not in {sorted(allowed)}")
        if not str(g.get("url", "")).startswith("https://"):
            errors.append(f"{where}: url must start with https://")
        amount = g.get("amount") or {}
        if not isinstance(amount, dict):
            errors.append(f"{where}: amount must be a mapping")
        else:
            extra = set(amount) - AMOUNT_KEYS
            if extra:
                errors.append(f"{where}: unknown amount keys {sorted(extra)}")
            cur = amount.get("currency")
            if cur not in config["fx_to_cad"]:
                errors.append(f"{where}: currency {cur!r} missing from config fx_to_cad")
        for j, d in enumerate(g.get("deadlines") or []):
            if "type" not in d or "date" not in d:
                errors.append(f"{where}: deadline #{j + 1} needs 'type' and 'date'")
            else:
                as_date(d["date"], where, errors)
        if not g.get("deadlines") and not g.get("rolling") and not g.get("anticipated"):
            errors.append(f"{where}: no deadlines -> set rolling: true or anticipated: true")
        for f in g.get("needs_verification") or []:
            if f not in VERIFY_FIELDS:
                errors.append(f"{where}: needs_verification field {f!r} not in {sorted(VERIFY_FIELDS)}")
        for key in ("last_verified", "added"):
            if key in g:
                as_date(g[key], where, errors)
    return errors


def normalise_amount(g, fx):
    a = g.get("amount") or {}
    rate = fx.get(a.get("currency", "CAD"), 1.0)
    dur = (g.get("duration_years") or {}).get("max") or (g.get("duration_years") or {}).get("min")
    per_year = a.get("max_per_year") or a.get("typical_per_year")
    total = a.get("max_total") or a.get("typical_total")
    typical = not (a.get("max_per_year") or a.get("max_total"))
    if per_year is None and total is not None and dur:
        per_year = total / max(dur, 1)
    if total is None and per_year is not None and dur:
        total = per_year * dur
    return {
        "cad_per_year": round(per_year * rate) if per_year is not None else None,
        "cad_total": round(total * rate) if total is not None else None,
        "is_typical": bool(typical and (per_year or total)),
    }


def score(g, weights):
    s = weights["funder_canadian"] if g["funder_country"] == "CA" else 0
    s += weights["eligibility"].get(g["canadian_eligibility"], 0)
    s += weights["category"].get(g["category"], 0)
    s += weights["microbiome_focus"].get(g["microbiome_focus"], 0)
    return s


def enrich(grants, config):
    out = []
    for g in grants:
        e = dict(g)
        e["deadlines"] = sorted(
            [{**d, "date": as_date(d["date"], "", []).isoformat()} for d in g.get("deadlines") or []],
            key=lambda d: d["date"],
        )
        e["last_verified"] = str(g["last_verified"])
        e["added"] = str(g["added"])
        e["rolling"] = bool(g.get("rolling"))
        e["anticipated"] = bool(g.get("anticipated"))
        e["needs_verification"] = g.get("needs_verification") or []
        e["normalised"] = normalise_amount(g, config["fx_to_cad"])
        e["score"] = score(g, config["score"])
        out.append(e)
    out.sort(key=lambda e: (-e["score"], e["deadlines"][-1]["date"] if e["deadlines"] else "9999"))
    return out


def ics_escape(text):
    return str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def ics_fold(line):
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > (75 if not parts else 74):
            parts.append(cur.decode("utf-8"))
            cur = b""
        cur += b
    parts.append(cur.decode("utf-8"))
    return "\r\n ".join(parts)


def build_ics(grants, today):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Langille Lab//Microbiome Grant Tracker//EN",
             "CALSCALE:GREGORIAN", "X-WR-CALNAME:Microbiome grant deadlines"]
    for g in grants:
        for d in g["deadlines"]:
            day = dt.date.fromisoformat(d["date"])
            if day < today - dt.timedelta(days=30):
                continue
            approx = " (estimated)" if d.get("approx") else ""
            lines += [
                "BEGIN:VEVENT",
                f"UID:{g['id']}-{re.sub(r'[^a-z0-9]+', '-', d['type'].lower()).strip('-')}-{d['date']}@microbiome-grant-tracker",
                f"DTSTAMP:{stamp}",
                f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
                f"DTEND;VALUE=DATE:{(day + dt.timedelta(days=1)).strftime('%Y%m%d')}",
                ics_fold("SUMMARY:" + ics_escape(f"{d['type'][:1].upper()}{d['type'][1:]}{approx}: {g['title']}")),
                ics_fold("DESCRIPTION:" + ics_escape(f"{g['funder']}\n{g['summary']}\n{g['url']}")),
                ics_fold("URL:" + g["url"]),
                "END:VEVENT",
            ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate only")
    ap.add_argument("--out", default=str(ROOT / "_site"))
    args = ap.parse_args()

    config = yaml.safe_load((DATA / "config.yaml").read_text())
    grants = yaml.safe_load((DATA / "grants.yaml").read_text()) or []
    errors = validate(grants, config)
    if errors:
        print("Validation failed:", *errors, sep="\n  - ", file=sys.stderr)
        sys.exit(1)
    print(f"OK: {len(grants)} grant entries valid")
    if args.check:
        return

    today = dt.date.today()
    enriched = enrich(grants, config)
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(SITE_SRC, out)
    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
        "closing_soon_days": config["closing_soon_days"],
        "fx_to_cad": config["fx_to_cad"],
        "grants": enriched,
    }
    (out / "grants.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False))
    (out / "deadlines.ics").write_text(build_ics(enriched, today), newline="")
    print(f"Built site in {out}")


if __name__ == "__main__":
    main()
