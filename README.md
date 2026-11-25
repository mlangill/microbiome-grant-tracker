# Microbiome Grant Tracker

A public tracker of upcoming microbiome research funding calls, maintained by the [Langille Lab](https://morganlangille.com/) at Dalhousie University.

**Site:** https://morganlangille.com/microbiome-grant-tracker/

**Focus:** Canadian funders and human microbiome research first, plus open Canadian programs that fund microbiome work (CIHR Project Grant, NSERC Discovery, NFRF, CFI, …) and international calls that Canadian researchers can apply to.

For each call the tracker lists the funder, deadlines (with estimated dates marked), funding amount (converted to CAD for filtering), duration and a link to the official call page. You can filter by region, call type, human microbiome focus, deadline window and a minimum funding amount (per year or total), and subscribe to all deadlines as a calendar feed ([deadlines.ics](https://morganlangille.com/microbiome-grant-tracker/deadlines.ics)).

Listings are refreshed weekly. Always confirm details on the funder's page before applying.

## How it works
- Data lives in [`data/grants.yaml`](data/grants.yaml); the sources checked each week are in [`data/sources.yaml`](data/sources.yaml).
- [`scripts/build.py`](scripts/build.py) validates the data and builds the static site; GitHub Actions deploys it to Pages on every push and daily.
- A weekly automated update searches for new calls, re-checks existing ones and commits changes. See [`CLAUDE.md`](CLAUDE.md) for the schema and update rules.

## Suggest a call
Open an issue with a link to the official call page, or edit `data/grants.yaml` and send a pull request.

## Local preview
```
pip install pyyaml
python scripts/build.py && python -m http.server -d _site 8000
```
