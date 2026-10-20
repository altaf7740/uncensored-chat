#!/usr/bin/env bash
# Serve Qwen3.6-27B Uncensored with llama.cpp (web chat UI + OpenAI-compatible API).
#   ./start.sh                 GPUs 0,1 (default)
#   GPUS=0,1,2,3 ./start.sh    any list of GPU ids; layers are split across them
#   CTX=131072 ./start.sh      context length in tokens (default 65536)
#   PORT=8091 ./start.sh       port (default 8090)
#   UI=builtin ./start.sh      llama.cpp's own web UI instead of ui/index.html
# Uses the official llama.cpp CUDA 12 image: this host's CUDA 13 toolkit can't build for V100 (sm_70).
cd "$(dirname "$0")"
GPUS="${GPUS:-0,1}"
CTX="${CTX:-65536}"
PORT="${PORT:-8090}"
MODEL="${MODEL:-Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf}"
MMPROJ="${MMPROJ:-mmproj-Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-f16.gguf}"
IMAGE="ghcr.io/ggml-org/llama.cpp:server-cuda"
UI_ARGS=(--path /ui)
[ "${UI:-}" = builtin ] && UI_ARGS=()

devices=()
for g in ${GPUS//,/ }; do devices+=(--device "nvidia.com/gpu=$g"); done

docker run -d --rm --name qwen36-chat "${devices[@]}" \
  -p "$PORT:8080" -v "$(pwd)/models:/models:ro" -v "$(pwd)/ui:/ui:ro" \
  "$IMAGE" \
  -m "/models/$MODEL" --mmproj "/models/$MMPROJ" \
  --n-gpu-layers 999 --ctx-size "$CTX" --jinja "${UI_ARGS[@]}" \
  --host 0.0.0.0 --port 8080 >/dev/null || exit 1
echo "starting on GPUs $GPUS -> http://0.0.0.0:$PORT  (logs: docker logs -f qwen36-chat)"
