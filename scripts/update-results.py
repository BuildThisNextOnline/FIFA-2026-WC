#!/usr/bin/env python3
"""
Fetch the openfootball WC2026 feed and write data/results.json
containing only completed matches (those with ft scores).

Used by the GitHub Action update-results.yml.
Run from repo root: python scripts/update-results.py
"""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

FEED_URL = (
    "https://raw.githubusercontent.com/openfootball/worldcup.json"
    "/master/2026/worldcup.json"
)
OUTPUT = Path("data/results.json")


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(
        url, headers={"User-Agent": "wc2026-update-results/1.0"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


ROUND_LABELS = {
    "Round of 32": "R32", "Round of 16": "R16",
    "Quarter-final": "QF", "Quarter-finals": "QF",
    "Semi-final": "SF", "Semi-finals": "SF",
    "Match for third place": "3rd", "Third place": "3rd",
    "Final": "Final",
}


def group_label(match: dict) -> str:
    g = match.get("group") or ""
    import re
    m = re.match(r"Group ([A-L])", g, re.I)
    if m:
        return m.group(1)
    r = match.get("round") or ""
    return ROUND_LABELS.get(r, r or "?")


def extract_completed(data: dict) -> list[dict]:
    completed = []
    match_idx = 0

    # openfootball 2026 uses flat top-level matches array
    raw_matches = data.get("matches") or []
    if not raw_matches:
        # Fallback: nested groups format
        for group in data.get("groups", []):
            raw_matches.extend(group.get("matches", []))
        for rnd in (data.get("knockout") or {}).get("rounds", []):
            raw_matches.extend(rnd.get("matches", []))

    for m in raw_matches:
        num = m.get("num")
        label = group_label(m)
        mid = f"m{num}" if num is not None else f"{label}_{match_idx}"
        score_raw = m.get("score") or {}
        ft = score_raw.get("ft")
        if ft and len(ft) >= 2:
            home = m.get("team1") or ""
            away = m.get("team2") or ""
            if isinstance(home, dict):
                home = home.get("name") or ""
            if isinstance(away, dict):
                away = away.get("name") or ""
            entry = {
                "id": mid,
                "group": label,
                "home": home,
                "away": away,
                "date": m.get("date"),
                "score": {
                    "ft_home": ft[0],
                    "ft_away": ft[1],
                    "et_home": score_raw["et"][0] if score_raw.get("et") else None,
                    "et_away": score_raw["et"][1] if score_raw.get("et") else None,
                    "pen_winner": None,
                },
            }
            completed.append(entry)
        match_idx += 1

    return completed


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Fetching {FEED_URL}")
    try:
        data = fetch_json(FEED_URL)
    except urllib.error.URLError as e:
        print(f"ERROR: Failed to fetch feed: {e}", file=sys.stderr)
        sys.exit(1)

    completed = extract_completed(data)
    print(f"Found {len(completed)} completed matches")

    # Merge with existing results.json — repo data wins on conflict
    existing = []
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text())
        except json.JSONDecodeError:
            pass

    existing_ids = {r["id"] for r in existing}
    new_entries = [r for r in completed if r["id"] not in existing_ids]
    merged = existing + new_entries

    # Also update any existing entries that now have ET/pen data
    existing_map = {r["id"]: r for r in existing}
    for entry in completed:
        if entry["id"] in existing_map:
            # Prefer repo version unless live has more data (ET/pen)
            repo_entry = existing_map[entry["id"]]
            if repo_entry["score"].get("et_home") is None and entry["score"].get("et_home") is not None:
                repo_entry["score"]["et_home"] = entry["score"]["et_home"]
                repo_entry["score"]["et_away"] = entry["score"]["et_away"]

    merged_sorted = sorted(merged, key=lambda r: (r.get("date") or "", r["id"]))
    OUTPUT.write_text(json.dumps(merged_sorted, ensure_ascii=False, indent=2))
    print(f"Wrote {len(merged_sorted)} entries to {OUTPUT}")


if __name__ == "__main__":
    main()
