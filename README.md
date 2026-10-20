# Uncensored Chat — Qwen3.6-27B on llama.cpp

Self-hosted chat for [HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive](https://huggingface.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive)
(Q8_K_P GGUF + vision projector): a web chat page and an OpenAI-compatible API, served by
llama.cpp's official CUDA 12 Docker image. Nothing is loaded from the internet at runtime.

## Layout

```
Makefile          setup / start / stop / logs / status / bench
ui/index.html     chat page (served by llama-server via --path)
ui/style.css
ui/app.js
ui/vendor/        marked + DOMPurify, bundled so the page works offline
models/           model files (git-ignored, filled by `make download`)
```

## Usage

```bash
make setup        # pull the image + download the model (~33 GB)
make start        # all 8 GPUs, tensor split, port 8090, 64k context
make stop
make logs | status | bench | help
```

Override any setting on the command line:

```bash
make start GPUS=0,1 SPLIT=layer   # fewer GPUs
make start CTX=131072             # longer context
make start PORT=8091              # another port
make start UI=builtin             # llama.cpp's own web UI instead of ui/
make start MODEL=<file>.gguf      # another quant in models/
```

- Web chat: `http://<host>:8090` — chat history, streaming, image attachments (paste / drag &
  drop), thinking on/off with collapsible reasoning, system prompt, temperature, max tokens.
  Edits to `ui/` show up on reload; no restart needed.
- API: `http://<host>:8090/v1/chat/completions` (OpenAI-compatible, accepts images).
- Chats live in the browser's localStorage; the server doesn't log prompts.

## Speed (V100-SXM2 32 GB)

| GPUs | Split | Generation |
|---|---|---|
| 8 | tensor (default) | ~48 tok/s |
| 8 | layer | ~21 tok/s |
| 2 | layer | ~21 tok/s |
| 8 | row | crashes at load |

The first request after start is slower while CUDA JIT-compiles kernels.

Requirements: Docker with NVIDIA CDI devices (`nvidia.com/gpu=N`), `hf` CLI for the download.
This host's CUDA 13 toolkit can't compile for V100 (sm_70), hence the prebuilt CUDA 12 image.
