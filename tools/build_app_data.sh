#!/usr/bin/env bash
# Builds the data files the app reads (the same layout the Claude artifact uses) from the server branches,
# into the folder given as $1. Run from the repository root with the branches fetched.
set -euo pipefail
OUT="$1"; rm -rf "$OUT"; mkdir -p "$OUT"
tmp=$(mktemp -d)
git show origin/data:data/summary.json > "$tmp/summary.json"
python3 tools/split.py "$tmp/summary.json" "$OUT"
python3 - "$tmp/summary.json" "$OUT/version.json" <<'PY'
import json,sys;json.dump({"updated":json.load(open(sys.argv[1]))["updated"]},open(sys.argv[2],"w"))
PY
take(){ # take <branch> <path in branch> <dest dir>
  mkdir -p "$3"; git archive "origin/$1" "$2" | tar -x -C "$tmp"; cp -r "$tmp/$2/." "$3/"; }
take data data/br "$OUT/br"
take bd data/bd "$OUT/bd" && rm -f "$OUT/bd/log.txt"
take geo data/geo "$OUT/geo" && rm -f "$OUT/geo/log.txt" "$OUT/geo/report.json"
git show origin/geo:data/storegeo.json > "$OUT/storegeo.json"
take images img "$OUT/img" && rm -f "$OUT/img/misses.json" "$OUT/img/hd/misses.json"
cp app/static/* "$OUT/"
touch "$OUT/.nojekyll"
echo "app data: $(du -sh "$OUT" | cut -f1), $(find "$OUT" -type f | wc -l) files"
