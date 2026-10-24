#!/bin/bash
# Double-click this file on a Mac to start the photobooth for an event.
cd "$(dirname "$0")" || exit 1

# Install packages the first time
if [ ! -d node_modules ]; then
  echo "Installing packages, this takes a minute the first time..."
  npm install || { echo "Install failed. Is Node.js installed? (https://nodejs.org)"; read -r -p "Press Enter to close."; exit 1; }
fi

# Open full screen in Chrome (its own profile remembers the camera permission), or the default browser
open_booth() {
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --kiosk --no-first-run --user-data-dir="$HOME/Library/Application Support/trilogy-photobooth-browser" http://localhost:3000
  else
    open http://localhost:3000
  fi
}

# Already running (e.g. started earlier)? Then just open it.
if curl -s -o /dev/null http://localhost:3000/api/status; then
  echo "The photobooth is already running. Opening it."
  open_booth
  exit 0
fi

# Start the booth (print mode). This window shows its messages: keep it open while the booth runs.
npm start &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

# Wait until the booth is ready (up to 40 seconds)
for _ in $(seq 1 40); do
  curl -s -o /dev/null http://localhost:3000/api/status && break
  sleep 1
done

open_booth

echo ""
echo "The photobooth is running. To finish: press Cmd + Q in the booth window, then Ctrl + C here."
wait $SERVER
