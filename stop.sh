#!/usr/bin/env bash
# Stop the server (the container is started with --rm, so this also removes it)
docker stop qwen36-chat >/dev/null 2>&1 && echo "stopped" || echo "not running"
