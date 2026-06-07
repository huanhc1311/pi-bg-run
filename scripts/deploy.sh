#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$HOME/.pi/agent/extensions"
DEST="$EXT_DIR/pi-bg-run"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OLD_FILE="$EXT_DIR/bg-run.ts"

# Parse flags
UNDEPLOY=false
if [[ "${1:-}" == "--undeploy" ]]; then
  UNDEPLOY=true
fi

if [[ "$UNDEPLOY" == true ]]; then
  echo "Removing pi-bg-run extension..."
  if [[ -L "$DEST" ]]; then
    rm "$DEST"
    echo "Removed symlink: $DEST"
  elif [[ -d "$DEST" ]]; then
    rm -rf "$DEST"
    echo "Removed directory: $DEST"
  else
    echo "Not found: $DEST"
  fi
  echo ""
  echo "Run /reload in Pi to apply changes."
  exit 0
fi

# Deploy
echo "Deploying pi-bg-run extension..."

# Verify build exists
if [[ ! -f "$PROJECT_DIR/dist/index.js" ]]; then
  echo "Error: dist/index.js not found. Run 'npm run build' first."
  exit 1
fi

# Remove old single-file extension if it exists
if [[ -f "$OLD_FILE" ]]; then
  echo "Found old extension: $OLD_FILE"
  rm "$OLD_FILE"
fi

# Remove existing symlink/directory if exists
if [[ -L "$DEST" ]]; then
  rm "$DEST"
elif [[ -d "$DEST" ]]; then
  rm -rf "$DEST"
fi

# Copy built file only
mkdir -p "$DEST"
cp "$PROJECT_DIR/dist/index.js" "$DEST/index.js"

echo "Deployed: $DEST/index.js"
echo ""
echo "Run /reload in Pi to load the extension."
