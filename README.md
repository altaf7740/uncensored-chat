# Qwen3.6-27B Uncensored — local chat server

Runs [HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive](https://huggingface.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive)
(Q8_K_P GGUF + vision projector) with llama.cpp: a web chat UI and an OpenAI-compatible API.

Uses the official `ghcr.io/ggml-org/llama.cpp:server-cuda` Docker image (CUDA 12). This host's
CUDA 13 toolkit can't compile for V100 (sm_70), so llama.cpp isn't built locally.

## Setup

```bash
docker pull ghcr.io/ggml-org/llama.cpp:server-cuda
hf download HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive \
  Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf \
  mmproj-Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-f16.gguf --local-dir models
```

Requires Docker with NVIDIA CDI devices (`nvidia.com/gpu=N`).

## Run

```bash
./start.sh                  # GPUs 0,1, port 8090, 64k context
GPUS=0,1,2,3 ./start.sh     # other GPUs (layers are split across them)
CTX=131072 ./start.sh       # longer context
PORT=8091 ./start.sh        # other port
MODEL=<file>.gguf ./start.sh  # another quant from models/
UI=builtin ./start.sh       # llama.cpp's own web UI instead of ui/index.html
./stop.sh
docker logs -f qwen36-chat  # logs
```

- Web chat: `http://<host>:8090` — `ui/index.html`, a single-file chat page: chat history,
  streaming, image attachments (paste / drag & drop), collapsible thinking with an on/off
  toggle, system prompt, temperature and max-token settings. Edit it and reload; no restart needed.
- API: `http://<host>:8090/v1/chat/completions` (OpenAI-compatible; supports images and `reasoning_effort`)
- Chats live in the browser's localStorage; the server doesn't log prompts.

Measured on 2× V100-SXM2 32 GB: ~1,050 tok/s prompt processing, ~22 tok/s generation
(the first request after start is slower while CUDA JIT-compiles kernels).
