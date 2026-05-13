#!/usr/bin/env bash
# Validate Crockford Base32 log tags in .log("TAG", ...) calls.
# Crockford Base32 excludes: I, L, O, U
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BAD=0

while IFS= read -r match; do
  file="${match%%:*}"
  rest="${match#*:}"
  line="${rest%%:*}"
  tag=$(echo "$rest" | grep -oP '\.log\(\s*"\K[A-Za-z0-9]+')
  if echo "$tag" | grep -qiE '[ILOU]'; then
    echo "  ❌ ${file}:${line}  tag \"${tag}\" contains invalid Crockford Base32 char (I/L/O/U)"
    BAD=1
  fi
done < <(grep -rn '\.log("[A-Za-z0-9]\{8\}"' "$ROOT/packages/" --include='*.ts' \
  | grep -v node_modules | grep -v '/dist/')

if [ "$BAD" -eq 0 ]; then
  echo "  ✅ All log tags are valid Crockford Base32"
fi
exit $BAD
