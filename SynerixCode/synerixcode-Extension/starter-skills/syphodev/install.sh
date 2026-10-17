#!/usr/bin/env bash
# Install the Roblox skills into Claude Code (macOS / Linux / Git Bash).
#   bash install.sh
# Copies skills/* to ~/.claude/skills and agents/* to ~/.claude/agents.
# A skill folder that already exists is backed up first, and your LOCAL.md is carried over.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
skills_dst="$HOME/.claude/skills"
agents_dst="$HOME/.claude/agents"
mkdir -p "$skills_dst" "$agents_dst"
stamp="$(date +%Y%m%d-%H%M%S)"

for src in "$here"/skills/*/; do
  name="$(basename "$src")"
  dst="$skills_dst/$name"
  local_md=""
  if [ -d "$dst" ]; then
    [ -f "$dst/LOCAL.md" ] && local_md="$(mktemp)" && cp "$dst/LOCAL.md" "$local_md"
    mkdir -p "$HOME/.claude/skills-backup-$stamp"
    mv "$dst" "$HOME/.claude/skills-backup-$stamp/$name"
    echo "  backed up existing $name"
  fi
  cp -R "$src" "$dst"
  if [ -n "$local_md" ]; then mv "$local_md" "$dst/LOCAL.md"; fi
  echo "  installed skill $name"
done
for a in "$here"/agents/*.md; do
  cp "$a" "$agents_dst/"
  echo "  installed agent $(basename "$a" .md)"
done
echo
echo "Done. Restart Claude Code, then type:  /roblox-skills-setup"
