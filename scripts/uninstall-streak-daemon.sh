#!/usr/bin/env bash
set -euo pipefail
SERVICE="qms-streak-daemon.service"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "$SERVICE" 2>/dev/null || true
fi
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$SERVICE"
rm -f "$UNIT"
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
fi
echo "已移除 $SERVICE"
