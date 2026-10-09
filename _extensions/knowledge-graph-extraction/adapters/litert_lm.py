"""Explicit local LiteRT-LM authoring adapter. No installs, downloads or tools.

API reference: https://developers.google.com/edge/litert-lm/python
Adapted conceptually from the user's read-only Argumentation-Sandbox runtime.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading


def file_hash(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def runtime_identity() -> dict:
    try:
        distribution = importlib.metadata.distribution("litert-lm-api")
    except importlib.metadata.PackageNotFoundError as error:
        raise ValueError("Configured Python has no installed litert-lm-api; configure an existing local runtime. This command does not install it.") from error
    if not distribution.files:
        raise ValueError("LiteRT-LM installation has no file manifest; use a reproducibly installed distribution, not an untracked editable runtime.")
    fingerprint = hashlib.sha256()
    for item in sorted(distribution.files, key=lambda item: str(item).replace("\\", "/")):
        name = str(item).replace("\\", "/")
        if "__pycache__" in name.split("/") or name.endswith((".pyc", ".pyo")):
            continue
        path = Path(distribution.locate_file(item))
        if not path.is_file():
            raise ValueError(f"Installed runtime file is missing: {name}")
        fingerprint.update((name + "\0" + file_hash(path) + "\n").encode("utf-8"))
    return {"distribution": "litert-lm-api", "version": distribution.version, "sha256": fingerprint.hexdigest()}


def verify(manifest: dict) -> dict:
    runtime, generation = manifest["runtime"], manifest["generation"]
    if runtime["distribution"] != "litert-lm-api" or generation["backend"] != "cpu":
        raise ValueError("This adapter requires litert-lm-api and CPU inference.")
    if Path(runtime["python"]["path"]).resolve() != Path(sys.executable).resolve():
        raise ValueError("Configured Python executable differs from the running interpreter.")
    if file_hash(sys.executable) != runtime["python"]["sha256"]:
        raise ValueError("Python executable SHA-256 mismatch.")
    actual = runtime_identity()
    if actual["version"] != runtime["version"] or actual["sha256"] != runtime["sha256"]:
        raise ValueError("Installed LiteRT-LM version/fingerprint differs from the immutable manifest; review and re-pin the local runtime.")
    model = generation["artifact"]
    if not Path(model["path"]).is_file() or file_hash(model["path"]) != model["sha256"]:
        raise ValueError("Local generation artifact is missing or its SHA-256 differs from the manifest. No download is attempted.")
    if not runtime["licence"] or not generation["licence"] or not generation["revision"]:
        raise ValueError("Runtime/model licence and immutable revision metadata are required.")
    return {"runtime": runtime, "generation": generation}


def response_schema() -> dict:
    source = {"type": "object", "properties": {"path": {"type": "string"}, "anchor": {"type": "string"}},
              "required": ["path", "anchor"], "additionalProperties": False}
    record = {"type": "object", "properties": {
        "id": {"type": "string"}, "type": {"type": "string"}, "scope": {"type": "string"}, "source": source,
        "labels": {"type": "object", "additionalProperties": {"type": "string"}},
        "from": {"type": "string"}, "to": {"type": "string"},
        "properties": {"type": "object", "additionalProperties": {"type": ["string", "number", "boolean"]}},
        "weight": {"type": "number", "minimum": 0}},
        "required": ["id", "type", "scope", "source"], "additionalProperties": False}
    evidence = {"type": "object", "properties": {"start": {"type": "integer", "minimum": 0},
                "end": {"type": "integer", "minimum": 1}, "text": {"type": "string"}},
                "required": ["start", "end", "text"], "additionalProperties": False}
    candidate = {"type": "object", "properties": {"kind": {"type": "string", "enum": ["object", "relation"]},
                 "record": record, "evidence": evidence, "reason": {"type": "string"}},
                 "required": ["kind", "record", "evidence"], "additionalProperties": False}
    return {"type": "object", "properties": {"version": {"type": "integer", "enum": [0]},
            "candidates": {"type": "array", "items": candidate, "maxItems": 100}},
            "required": ["version", "candidates"], "additionalProperties": False}


def generate(input: dict) -> dict:
    request, prompt = input["request"], input["prompt"]
    provenance = verify(request["manifest"])
    if file_hash(__file__) != request["adapterHash"]:
        raise ValueError("Packaged adapter SHA-256 mismatch.")
    generation = request["manifest"]["generation"]
    if not isinstance(prompt, str) or len(prompt) > 100000:
        raise ValueError("Generation prompt must be bounded local text.")
    if not 512 <= generation["contextTokens"] <= 16384 or not 1 <= generation["outputTokens"] < generation["contextTokens"]:
        raise ValueError("Invalid bounded generation token policy.")
    if not 1 <= generation["timeoutSeconds"] <= 300:
        raise ValueError("Invalid bounded timeout policy.")
    cache = Path(input["cacheDirectory"])
    cache.mkdir(parents=True, exist_ok=True)
    import litert_lm as lm  # Imported only after local artifact/version checks.

    lm.set_min_log_severity(lm.LogSeverity.ERROR)
    with lm.Engine(generation["artifact"]["path"], backend=lm.Backend.CPU(), cache_dir=str(cache),
                   max_num_tokens=generation["contextTokens"], use_ringbuffers_local_attention=True) as engine:
        with engine.create_conversation(automatic_tool_calling=False, tools=[],
                sampler_config=lm.SamplerConfig(top_k=1, top_p=1.0, temperature=0.0),
                max_output_tokens=generation["outputTokens"], thinking_config=lm.ThinkingConfig(enable_thinking=False),
                constrained_decoding_config=lm.ConstrainedDecodingConfig(enable=True, provider=lm.LiteRtLmConstraintProviderType.LL_GUIDANCE)) as conversation:
            deadline = threading.Timer(generation["timeoutSeconds"], conversation.cancel_process)
            deadline.daemon = True
            deadline.start()
            try:
                response = conversation.send_message(prompt, response_format=lm.ResponseFormat.json(response_schema()),
                                                     thinking_config=lm.ThinkingConfig(enable_thinking=False))
            finally:
                deadline.cancel()
                deadline.join()
    # Thought channels are intentionally excluded. The source text is preserved elsewhere.
    output = "".join(part.get("text", "") for part in response.get("content", []) if part.get("type") == "text")
    return {"version": 0, "requestId": request["requestId"], "text": output, "provenance": provenance}


def main() -> None:
    # Native libraries sometimes log on fd 1. Keep protocol JSON on the original
    # stream and redirect their output before loading any inference library.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        if sys.argv[1:] == ["--probe"]:
            result = {"version": 0, "python": {"path": sys.executable, "sha256": file_hash(sys.executable)}, "runtime": runtime_identity()}
        else:
            raw = sys.stdin.buffer.read(4_000_001)
            if len(raw) > 4_000_000:
                raise ValueError("Adapter request exceeds the bounded protocol.")
            input = json.loads(raw.decode("utf-8"))
            if sys.argv[1:] == ["--verify"]:
                result = {"version": 0, "provenance": verify(input["manifest"])}
            elif not sys.argv[1:]:
                result = generate(input)
            else:
                raise ValueError("Unsupported adapter arguments.")
        protocol.write(json.dumps(result, ensure_ascii=False) + "\n")
        protocol.flush()
    except Exception as error:
        print(f"Knowledge Graph Extraction local adapter: {type(error).__name__}: {str(error)[:1200]}", file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        protocol.close()


if __name__ == "__main__":
    main()
