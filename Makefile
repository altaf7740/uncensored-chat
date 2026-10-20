# Qwen3.6-27B Uncensored chat server (llama.cpp in Docker). Run `make help`.
# Any variable can be overridden: make start GPUS=0,1 SPLIT=layer CTX=131072
SHELL := /bin/bash

NAME   ?= qwen36-chat
IMAGE  ?= ghcr.io/ggml-org/llama.cpp:server-cuda
REPO   ?= HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive
MODEL  ?= Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf
MMPROJ ?= mmproj-Qwen3.6-27B-Uncensored-HauhauCS-Aggressive-f16.gguf
GPUS   ?= 0,1,2,3,4,5,6,7
# tensor: every GPU works on every token (~48 tok/s on 8x V100); layer: GPUs take turns (~22 tok/s)
SPLIT  ?= tensor
CTX    ?= 65536
PORT   ?= 8090
# ui: the chat page in ui/; builtin: llama.cpp's own web UI
UI     ?= ui

# The image is used because this host's CUDA 13 toolkit can't compile for V100 (sm_70)
comma := ,
DEVICES := $(foreach g,$(subst $(comma), ,$(GPUS)),--device nvidia.com/gpu=$(g))
UI_ARGS := $(if $(filter ui,$(UI)),-v $(CURDIR)/ui:/ui:ro,)
UI_FLAG := $(if $(filter ui,$(UI)),--path /ui,)

.PHONY: help setup pull download start stop restart logs status bench

help: ## Show targets and settings
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-9s %s\n", $$1, $$2}'
	@echo; echo "  GPUS=$(GPUS) SPLIT=$(SPLIT) CTX=$(CTX) PORT=$(PORT) UI=$(UI)"

setup: pull download ## Pull the server image and download the model

pull: ## Pull the llama.cpp CUDA server image
	docker pull $(IMAGE)

download: ## Download the model and vision projector into models/
	hf download $(REPO) $(MODEL) $(MMPROJ) --local-dir models

start: ## Start the server in the background
	@test -f models/$(MODEL) || { echo "models/$(MODEL) missing: run 'make download'"; exit 1; }
	@docker run -d --rm --name $(NAME) $(DEVICES) -p $(PORT):8080 \
	  -v $(CURDIR)/models:/models:ro $(UI_ARGS) $(IMAGE) \
	  -m /models/$(MODEL) --mmproj /models/$(MMPROJ) \
	  --n-gpu-layers 999 --split-mode $(SPLIT) --ctx-size $(CTX) --jinja $(UI_FLAG) \
	  --host 0.0.0.0 --port 8080 >/dev/null
	@echo "starting on GPUs $(GPUS) ($(SPLIT) split) -> http://0.0.0.0:$(PORT)"
	@echo -n "loading"; for i in $$(seq 200); do \
	  curl -sf localhost:$(PORT)/health >/dev/null && { echo " ready"; exit 0; }; \
	  docker ps -q -f name=^$(NAME)$$ | grep -q . || { echo " crashed (rerun without --rm to see docker logs)"; exit 1; }; \
	  echo -n .; sleep 3; done; echo " still loading, see: make logs"

stop: ## Stop the server
	@docker stop $(NAME) >/dev/null 2>&1 && echo stopped || echo "not running"

restart: stop start ## Restart the server

logs: ## Follow the server log (prompts are never logged)
	docker logs -f $(NAME)

status: ## Show whether the server is up and GPU memory use
	@curl -sf localhost:$(PORT)/health >/dev/null && echo "up: http://0.0.0.0:$(PORT)" || echo "down"
	@nvidia-smi --query-gpu=index,memory.used,utilization.gpu --format=csv,noheader

bench: ## Measure prompt and generation speed
	@for r in 1 2; do curl -s localhost:$(PORT)/v1/chat/completions -H 'Content-Type: application/json' \
	  -d '{"messages":[{"role":"user","content":"Write a 300-word story about a lighthouse."}],"max_tokens":300,"chat_template_kwargs":{"enable_thinking":false}}' \
	  | python3 -c "import sys,json;t=json.load(sys.stdin)['timings'];print(f\"generation {t['predicted_per_second']:.1f} tok/s\")"; done
