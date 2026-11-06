#!/usr/bin/env bash
# Run a command in the project's Python environment (WSL).
#   ./run.sh python -m pipeline.ingest ...      ./run.sh pytest
# From Windows:  wsl ./run.sh pytest
# The venv lives in the WSL home, not in this Windows folder: venvs on /mnt/c are slow.
set -euo pipefail
cd "$(dirname "$0")"
export UV_PROJECT_ENVIRONMENT="$HOME/.venvs/interactive-book"
exec uv run "$@"
