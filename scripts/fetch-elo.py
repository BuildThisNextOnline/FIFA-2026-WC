#!/usr/bin/env python3
"""
Scrapes current Elo ratings for all 48 WC2026 teams from eloratings.net
and writes data/elo-seed.json.

Run from repo root: python scripts/fetch-elo.py

Fails loudly (non-zero exit) if any of the 48 teams cannot be matched.

Data source: eloratings.net/World.tsv — a tab-separated file with columns:
  rank_prev, rank, code2, rating, ...
where code2 is a 2-letter ISO-like country code used by the site.
"""

import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

TSV_URL = "https://www.eloratings.net/World.tsv"
OPENFOOTBALL_URL = (
    "https://raw.githubusercontent.com/openfootball/worldcup.json"
    "/master/2026/worldcup.json"
)

# eloratings.net 2-letter site code → canonical project team name.
# These are NOT standard ISO-3166; they are site-specific.
# Verified against World.tsv 2026-06-12.
# Group draw sourced from openfootball/worldcup.json worldcup.groups.json.
CODE_TO_CANONICAL = {
    # Group A
    "MX": "Mexico",
    "ZA": "South Africa",
    "KR": "Korea Republic",
    "CZ": "Czech Republic",
    # Group B
    "CA": "Canada",
    "BA": "Bosnia & Herzegovina",
    "QA": "Qatar",
    "CH": "Switzerland",
    # Group C
    "BR": "Brazil",
    "MA": "Morocco",
    "HT": "Haiti",
    "SQ": "Scotland",        # eloratings.net uses SQ for Scotland
    # Group D
    "US": "USA",
    "PY": "Paraguay",
    "AU": "Australia",
    "TR": "Turkey",
    # Group E
    "DE": "Germany",
    "CW": "Curaçao",
    "CI": "Côte d'Ivoire",
    "EC": "Ecuador",
    # Group F
    "NL": "Netherlands",
    "JP": "Japan",
    "SE": "Sweden",
    "TN": "Tunisia",
    # Group G
    "BE": "Belgium",
    "EG": "Egypt",
    "IR": "IR Iran",
    "NZ": "New Zealand",
    # Group H
    "ES": "Spain",
    "CV": "Cape Verde",
    "SA": "Saudi Arabia",
    "UY": "Uruguay",
    # Group I
    "FR": "France",
    "SN": "Senegal",
    "IQ": "Iraq",
    "NO": "Norway",
    # Group J
    "AR": "Argentina",
    "DZ": "Algeria",
    "AT": "Austria",
    "JO": "Jordan",
    # Group K
    "PT": "Portugal",
    "CD": "DR Congo",
    "UZ": "Uzbekistan",
    "CO": "Colombia",
    # Group L
    "EN": "England",
    "HR": "Croatia",
    "GH": "Ghana",
    "PA": "Panama",
}

WC2026_TEAMS = set(CODE_TO_CANONICAL.values())


def fetch_bytes(url: str, retries: int = 3) -> bytes:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; wc2026-elo-fetcher/1.0)",
        "Referer": "https://www.eloratings.net/World",
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read()
        except urllib.error.URLError as e:
            if attempt == retries - 1:
                raise
            print(f"  Retry {attempt+1}/{retries}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)


def parse_tsv(raw: bytes) -> dict[str, int]:
    """Parse World.tsv → {site_code: elo_rating}."""
    text = raw.decode("utf-8")
    ratings = {}
    for line in text.strip().splitlines():
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        code = parts[2].strip()
        try:
            rating = int(parts[3].strip())
        except ValueError:
            continue
        if code:
            ratings[code] = rating
    return ratings


def fetch_openfootball_teams() -> list[str]:
    """Cross-check team list against live openfootball feed (warn only)."""
    try:
        data = json.loads(fetch_bytes(OPENFOOTBALL_URL).decode("utf-8"))
    except Exception as e:
        print(f"  Warning: openfootball feed unavailable ({e})", file=sys.stderr)
        return []
    teams = set()
    for group in data.get("groups", []):
        for team in group.get("teams", []):
            name = (team.get("name") or team.get("code") or "").strip()
            if name:
                teams.add(name)
    print(f"  openfootball feed: {len(teams)} teams found")
    return sorted(teams)


def main():
    output_path = Path("data/elo-seed.json")
    output_path.parent.mkdir(exist_ok=True)

    # Fetch TSV
    print(f"Fetching Elo ratings: {TSV_URL}")
    raw = fetch_bytes(TSV_URL)
    site_ratings = parse_tsv(raw)
    print(f"  Parsed {len(site_ratings)} teams from TSV")

    # Cross-check openfootball feed (non-blocking)
    print(f"\nFetching openfootball feed: {OPENFOOTBALL_URL}")
    feed_teams = fetch_openfootball_teams()

    # Map codes → canonical names
    result: dict[str, int] = {}
    missing_codes: list[str] = []
    for code, canonical in CODE_TO_CANONICAL.items():
        if code in site_ratings:
            result[canonical] = site_ratings[code]
        else:
            missing_codes.append(f"{code} ({canonical})")

    if missing_codes:
        print(f"\nERROR: Could not find ratings for {len(missing_codes)} team(s):", file=sys.stderr)
        for c in missing_codes:
            print(f"  - {c}", file=sys.stderr)
        print("\nCodes available in TSV:", sorted(site_ratings.keys()), file=sys.stderr)
        sys.exit(1)

    if len(result) != 48:
        print(f"ERROR: Expected 48 teams, got {len(result)}", file=sys.stderr)
        sys.exit(1)

    # Warn if feed teams don't match our canonical set
    if feed_teams:
        feed_set = set(feed_teams)
        our_set = set(result.keys())
        if feed_set != our_set:
            extra = our_set - feed_set
            absent = feed_set - our_set
            if extra:
                print(f"\nWARNING: In our list but not in feed: {sorted(extra)}", file=sys.stderr)
            if absent:
                print(f"WARNING: In feed but not our list: {sorted(absent)}", file=sys.stderr)

    # Write output sorted by rating desc
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "eloratings.net",
        "source_url": TSV_URL,
        "note": "Site uses custom 2-letter codes; see CODE_TO_CANONICAL in fetch-elo.py",
        "team_count": len(result),
        "ratings": dict(sorted(result.items(), key=lambda x: -x[1])),
    }
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"\nWrote {len(result)} ratings to {output_path}")

    print("\nTop 10 by Elo:")
    for i, (team, elo) in enumerate(list(output["ratings"].items())[:10], 1):
        print(f"  {i:2}. {team:<25} {elo}")


if __name__ == "__main__":
    main()
