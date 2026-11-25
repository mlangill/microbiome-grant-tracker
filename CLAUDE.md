# Microbiome Grant Tracker — instructions for Claude

This repo builds a public GitHub Pages site listing upcoming microbiome research funding
calls for the Langille Lab (Dalhousie University, Halifax, NS). Preference order:
**Canadian funders and human microbiome calls first**, then open Canadian programs that can
fund microbiome work (CIHR Project Grant, NSERC DG, NFRF, CFI, …), then international calls
that Canadian researchers can actually apply to.

## Layout
- `data/grants.yaml` — the data (one entry per call). **This is the only file the weekly update normally edits.**
- `data/sources.yaml` — funders/pages/search queries to check each week.
- `data/config.yaml` — FX rates to CAD, scoring weights, "closing soon" window.
- `scripts/build.py` — validates the YAML and builds `_site/` (`grants.json`, `deadlines.ics`, static files).
- `site/` — static front-end (index.html, app.js, style.css). Status, filtering and archiving happen client-side.
- `.github/workflows/pages.yml` — builds and deploys on every push to `main` and daily.

## Entry schema (data/grants.yaml)
```yaml
- id: kebab-case-unique-id          # stable; never reuse for a different call
  title: Program – specific competition/cycle
  funder: Funder name
  funder_country: CA | US | EU | UK | INTL | OTHER
  category: microbiome | adjacent | open-program
  #   microbiome   = the call itself is about the microbiome
  #   adjacent     = disease/area where microbiome work fits (IBD, cancer, AMR, aging…)
  #   open-program = open competition usable for microbiome research
  microbiome_focus: human | general | animal | environmental | none
  canadian_eligibility: lead | partner | none   # can a Canada-based PI lead / be a funded partner?
  rolling: true            # optional: continuous intake (then deadlines: [])
  anticipated: true        # optional: next cycle expected but not yet announced
  deadlines:               # [] allowed only if rolling or anticipated
    - {type: LOI, date: 2027-01-15}
    - {type: full application (invited), date: 2027-03-01, approx: true}   # approx = estimated
  amount: {currency: CAD, max_per_year: 100000, max_total: 300000, typical_per_year: ..., typical_total: ..., note: "free text"}
  duration_years: {min: 1, max: 3}
  url: https://official.funder.page/...   # funder's own page or official call document
  summary: One or two sentences on scope and stage.
  eligibility: Key eligibility constraints.
  tags: [IBD, foundation]
  needs_verification: [deadlines, amount, eligibility, url, duration]   # fields not confirmed on the funder page
  last_verified: 2026-11-25
  added: 2026-11-25
```
Put the word "invited" in a deadline `type` if only invited applicants can submit at that stage.

## Weekly update procedure (runs unattended; commit directly to `main`)
1. `git pull`, then read `data/grants.yaml` and `data/sources.yaml`.
2. **Re-check existing entries** whose next deadline is within ~120 days, that have
   `needs_verification` or `approx` dates, or `anticipated: true`. Visit the funder's page
   (WebSearch/WebFetch). When the funder publishes real dates/amounts: update them, drop
   `approx`/`anticipated`, remove fields from `needs_verification`, set `last_verified` to today.
3. **Roll recurring programs forward**: when a cycle closes (all deadlines past), keep the closed
   entry (the site archives it) and, if the program recurs, add a new entry for the next cycle with
   `anticipated: true`, `approx: true` dates estimated from the last cycle and
   `needs_verification: [deadlines]`.
4. **Find new calls**: check priority-1 and -2 sources in `sources.yaml` and run the listed search
   queries. Add calls that match the scope above. Include international calls only if Canadian
   researchers can lead or be funded partners (most NIH microbiome NOFOs exclude non-U.S.
   organisations — skip those). Skip trainee-only awards (fellowships, studentships) and calls
   restricted to one other country.
5. **Accuracy rules**: never invent dates or amounts. Use the funder's page as `url`. If a detail
   only comes from a university research office page or an earlier cycle, record it but flag it in
   `needs_verification` (and `approx: true` for dates). Leave unknown amounts out of numeric fields
   and explain in `amount.note`.
6. Validate: `python scripts/build.py --check` must pass (install with `pip install pyyaml` if needed).
7. Commit and push to `main` only if something changed. Commit message format:
   ```
   Weekly update YYYY-MM-DD: +N new, M updated

   Added: <id> (<funder>, next deadline)
   Updated: <id> — <what changed>
   Rolled forward: <id>
   ```
   End the message with the session's attribution lines. If nothing changed, do not commit.
8. Do not edit `site/`, `scripts/` or the workflow during a weekly update unless a build is broken.

## Local preview
```
pip install pyyaml
python scripts/build.py && python -m http.server -d _site 8000
```
