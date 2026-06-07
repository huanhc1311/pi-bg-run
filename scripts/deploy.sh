#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$HOME/.pi/agent/extensions"
LINK_NAME="$EXT_DIR/pi-bg-run"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OLD_FILE="$EXT_DIR/bg-run.ts"

# Parse flags
UNDEPLOY=false
if [[ "${1:-}" == "--undeploy" ]]; then
  UNDEPLOY=true
fi

if [[ "$UNDEPLOY" == true ]]; then
  echo "🗑️  Removing pi-bg-run extension..."
  if [[ -L "$LINK_NAME" ]]; then
    rm "$LINK_NAME"
    echo "✅ Removed symlink: $LINK_NAME"
  elif [[ -d "$LINK_NAME" ]]; then
    rm -rf "$LINK_NAME"
    echo "✅ Removed directory: $LINK_NAME"
  else
    echo "⚠️  Not found: $LINK_NAME"
  fi
  echo ""
  echo "Run /reload in Pi to apply changes."
  exit 0
fi

# Deploy
echo "🚀 Deploying pi-bg-run extension..."

# Check project has node_modules
if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
  echo "📦 Installing dependencies..."
  cd "$PROJECT_DIR" && npm install
fi

# Remove old single-file extension if it exists
if [[ -f "$OLD_FILE" ]]; then
  echo "⚠️  Found old extension: $OLD_FILE"
  rm "$OLD_FILE"
  echo "   Removed old extension."
fi

# Remove existing symlink/directory if exists
if [[ -L "$LINK_NAME" ]]; then
  rm "$LINK_NAME"
elif [[ -d "$LINK_NAME" ]]; then
  rm -rf "$LINK_NAME"
fi

# Create symlink
ln -s "$PROJECT_DIR" "$LINK_NAME"

echo "✅ Symlinked: $LINK_NAME → $PROJECT_DIR"
echo ""
echo "Run /reload in Pi to load the extension."
