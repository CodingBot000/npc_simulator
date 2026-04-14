#!/bin/zsh
set -euo pipefail

PORT="${1:-9222}"
URL="${2:-about:blank}"
PROFILE_DIR="${TMPDIR:-/tmp}/codex-chrome-cdp"
APP_PATH="/Applications/Google Chrome.app"
CHROME_BIN="$APP_PATH/Contents/MacOS/Google Chrome"
LOG_PATH="/tmp/codex-chrome-cdp.log"
PLAYWRIGHT_CACHE="${HOME}/Library/Caches/ms-playwright"

mkdir -p "$PROFILE_DIR"

find_playwright_shell() {
  find "$PLAYWRIGHT_CACHE" -maxdepth 3 -type f -name "chrome-headless-shell" 2>/dev/null | sort | tail -n 1
}

find_playwright_chromium() {
  find "$PLAYWRIGHT_CACHE" -maxdepth 5 -type f -name "chrome" 2>/dev/null | rg '/chrome-linux/|/chrome-mac/|/chrome-mac-arm64/' | sort | tail -n 1
}

wait_for_cdp() {
  for _ in {1..40}; do
    if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  return 1
}

launch_with_binary() {
  local bin="$1"
  if [[ -z "$bin" || ! -x "$bin" ]]; then
    return 1
  fi

  "$bin" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    "$URL" >"$LOG_PATH" 2>&1 &

  if wait_for_cdp; then
    echo "Chrome started with CDP on port $PORT"
    echo "Launcher: $bin"
    echo "Profile: $PROFILE_DIR"
    exit 0
  fi

  return 1
}

if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "CDP is already available on port $PORT"
  echo "Profile: $PROFILE_DIR"
  exit 0
fi

PLAYWRIGHT_SHELL_BIN="$(find_playwright_shell || true)"
if launch_with_binary "$PLAYWRIGHT_SHELL_BIN"; then
  :
fi

PLAYWRIGHT_CHROMIUM_BIN="$(find_playwright_chromium || true)"
if launch_with_binary "$PLAYWRIGHT_CHROMIUM_BIN"; then
  :
fi

if pgrep -f "$CHROME_BIN" >/dev/null 2>&1; then
  echo "An existing Chrome process is already running." >&2
  echo "Quit Chrome completely if you want to retry the system Chrome fallback." >&2
fi

if command -v open >/dev/null 2>&1; then
  if open -a "$APP_PATH" --args \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run \
    --no-default-browser-check \
    "$URL"; then
    if wait_for_cdp; then
      echo "Chrome started with CDP on port $PORT"
      echo "Launcher: open -a $APP_PATH"
      echo "Profile: $PROFILE_DIR"
      exit 0
    fi
  fi
fi

if [[ -x "$CHROME_BIN" ]]; then
  if launch_with_binary "$CHROME_BIN"; then
    :
  fi
fi

echo "Chrome launch attempted with CDP on port $PORT, but the port did not open." >&2
echo "Tried Playwright browser cache first, then system Chrome." >&2
echo "If this still fails, run \`npx playwright install chromium\` once and retry." >&2
echo "Log: $LOG_PATH" >&2
exit 1
