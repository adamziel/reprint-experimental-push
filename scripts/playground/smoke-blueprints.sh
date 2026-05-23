#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for blueprint in \
  "$repo/fixtures/playground/remote-base.blueprint.json" \
  "$repo/fixtures/playground/local-edited.blueprint.json" \
  "$repo/fixtures/playground/remote-changed.blueprint.json"
do
  printf 'Running %s\n' "${blueprint#$repo/}"
  npx --yes @wp-playground/cli@latest run-blueprint \
    --blueprint="$blueprint" \
    --verbosity=quiet
done

