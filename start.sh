#!/bin/bash
XVFB="/nix/store/ykck7gdd6szwrb3qnpb5y5fvjlnmzhz0-xorg-server-21.1.18/bin/Xvfb"
pkill -f "Xvfb :99" 2>/dev/null
rm -f /tmp/.X99-lock
sleep 1
if [ -x "$XVFB" ]; then
  echo "Starting Xvfb virtual display on :99..."
  "$XVFB" :99 -screen 0 1280x800x24 -ac &
  export DISPLAY=:99
  sleep 2
  echo "Xvfb running, DISPLAY=$DISPLAY"
else
  echo "Xvfb not found, running headless"
fi
exec node server.js
