#!/bin/zsh
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
frontend_root="$(cd "$script_dir/../.." && pwd)"
repo_root="$(cd "$frontend_root/.." && pwd)"
current_limit="$(ulimit -n)"
hard_limit="$(ulimit -Hn)"
target_limit="$current_limit"

if [[ "$hard_limit" == "unlimited" ]]; then
  target_limit=1048576
elif [[ "$hard_limit" -gt "$current_limit" ]]; then
  target_limit="$hard_limit"
fi

if [[ "$target_limit" -gt "$current_limit" ]]; then
  ulimit -n "$target_limit" || true
fi

export NPC_SIMULATOR_ROOT="${NPC_SIMULATOR_ROOT:-$repo_root}"

if [[ -x "$frontend_root/node_modules/.bin/next" ]]; then
  exec "$frontend_root/node_modules/.bin/next" dev "$@"
fi

if [[ -x "$repo_root/node_modules/.bin/next" ]]; then
  exec "$repo_root/node_modules/.bin/next" dev "$@"
fi

exec next dev "$@"
