"""Explicit CPU encoder for caller-installed Sentence Transformers artifacts.

No hub lookup, package installation, remote code or automatic model download.
"""
from __future__ import annotations
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys


def file_hash(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def distribution_identity(name: str) -> dict:
    try:
        distribution = importlib.metadata.distribution(name)
    except importlib.metadata.PackageNotFoundError as error:
        raise ValueError(f"Configured Python has no installed {name}; configure an existing local encoder. This adapter does not install it.") from error
    if not distribution.files:
        raise ValueError(f"Installed {name} has no reproducible file manifest.")
    fingerprint = hashlib.sha256()
    for item in sorted(distribution.files, key=lambda item: str(item).replace("\\", "/")):
        name = str(item).replace("\\", "/")
        if "__pycache__" in name.split("/") or name.endswith((".pyc", ".pyo")):
            continue
        path = Path(distribution.locate_file(item))
        if not path.is_file():
            raise ValueError("An installed encoder runtime file is missing.")
        fingerprint.update((name + "\0" + file_hash(path) + "\n").encode("utf-8"))
    return {"version": distribution.version, "sha256": fingerprint.hexdigest()}


DEPENDENCIES = ("torch", "transformers", "tokenizers", "safetensors", "numpy")


def verify(manifest: dict) -> dict:
    runtime, embedding = manifest["runtime"], manifest["embedding"]
    if runtime["distribution"] != "sentence-transformers":
        raise ValueError("Encoder requires sentence-transformers.")
    if Path(runtime["python"]["path"]).resolve() != Path(sys.executable).resolve() or file_hash(sys.executable) != runtime["python"]["sha256"]:
        raise ValueError("Encoder Python executable/hash mismatch.")
    for name, expected in [("sentence-transformers", runtime)] + [(name, runtime["dependencies"][name]) for name in DEPENDENCIES]:
        actual = distribution_identity(name)
        if actual["version"] != expected["version"] or actual["sha256"] != expected["sha256"] or not expected["licence"]:
            raise ValueError(f"Installed {name} differs from the pinned encoder manifest/version/licence metadata.")
    original = Path(embedding["directory"])
    if any(path.is_symlink() for path in [original, *original.parents]):
        raise ValueError("Encoder artifact directory must not use symbolic links.")
    root = original.resolve(strict=True)
    actual_files = set()
    for child in root.rglob("*"):
        if child.is_symlink():
            raise ValueError("Encoder artifact directory contains a symbolic link.")
        if child.is_file():
            name = child.relative_to(root).as_posix()
            actual_files.add(name)
            if name not in embedding["files"] or file_hash(child) != embedding["files"][name]:
                raise ValueError("Encoder artifact inventory/hash mismatch; all local model files must be pinned.")
    if actual_files != set(embedding["files"]):
        raise ValueError("Pinned encoder artifact files are missing.")
    modules = json.loads((root / "modules.json").read_text(encoding="utf-8"))
    allowed = {"sentence_transformers.models.Transformer", "sentence_transformers.models.Pooling",
               "sentence_transformers.models.Normalize", "sentence_transformers.models.Dense",
               # The official EmbeddingGemma 2 export uses these standard module names.
               "sentence_transformers.base.modules.transformer.Transformer",
               "sentence_transformers.sentence_transformer.modules.pooling.Pooling",
               "sentence_transformers.base.modules.normalize.Normalize"}
    if not isinstance(modules, list) or not modules:
        raise ValueError("Encoder requires a standard Sentence Transformers modules.json profile.")
    for module in modules:
        if module.get("type") not in allowed:
            raise ValueError("Custom executable Sentence Transformers modules are unsupported.")
        if not (root / module.get("path", "")).resolve().is_relative_to(root):
            raise ValueError("Encoder module path escapes its immutable model directory.")
    bundle_hash = hashlib.sha256(json.dumps(embedding["files"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    return {"model": embedding["model"], "dimensions": embedding["dimensions"], "artifactSha256": bundle_hash,
            "revision": embedding["revision"], "licence": embedding["licence"], "runtime": {
                "name": "sentence-transformers", "version": runtime["version"], "sha256": runtime["sha256"],
                "licence": runtime["licence"], "dependencies": runtime["dependencies"]}}


def encode(input: dict) -> dict:
    request = input["request"]
    if file_hash(__file__) != request["adapterHash"]:
        raise ValueError("Encoder adapter SHA-256 mismatch.")
    provenance = verify(request["manifest"])
    from sentence_transformers import SentenceTransformer
    import torch
    policy = request["manifest"]["embedding"]
    version_two = policy["model"] == "google/embeddinggemma-2"
    options = {"device": "cpu", "local_files_only": True, "trust_remote_code": False,
               "truncate_dim": policy["dimensions"], "model_kwargs": {"torch_dtype": torch.float32}}
    if version_two:
        options["config_kwargs"] = {"vision_config": None, "audio_config": None}
    model = SentenceTransformer(policy["directory"], **options)
    if model.dtype != torch.float32:
        raise ValueError("CPU encoder must use float32; float16 is unsafe for EmbeddingGemma 2.")
    query_name, document_name = ("SearchQuery", "Document") if version_two else ("query", "document")
    query_prefix, document_prefix = model.prompts.get(query_name), model.prompts.get(document_name)
    if not isinstance(query_prefix, str) or not query_prefix or not isinstance(document_prefix, str) or not document_prefix:
        raise ValueError("Encoder model must declare query/document task prefixes.")
    if version_two and (query_prefix != "task: search result | query: " or document_prefix != "title: none | text: "):
        raise ValueError("EmbeddingGemma 2 requires its standard SearchQuery/Document retrieval prompts.")
    maximum = min(int(model.max_seq_length), 8192 if version_two else 2048)
    if maximum < 1:
        raise ValueError("Encoder must declare a positive token budget.")
    provenance.update({"queryPrefix": query_prefix, "documentPrefix": document_prefix,
                       "encodingProfile": "embeddinggemma-2-text-search-f32-v1" if version_two else "legacy-text-search-f32-v1",
                       "maxTokens": maximum})

    def vector(text: str, query: bool) -> list[float]:
        prefix = query_prefix if query else document_prefix
        count = len(model.tokenizer(prefix + text, truncation=False, add_special_tokens=True)["input_ids"])
        if count > maximum:
            raise ValueError("Encoder input exceeds its token budget; select a smaller source slice/window. Silent truncation is refused.")
        if version_two:
            values = model.encode(text, prompt_name=query_name if query else document_name,
                                  truncate_dim=policy["dimensions"], normalize_embeddings=True, show_progress_bar=False).tolist()
        else:
            values = (model.encode_query(text, normalize_embeddings=True, show_progress_bar=False) if query else
                      model.encode_document(text, normalize_embeddings=True, show_progress_bar=False)).tolist()
        if len(values) != policy["dimensions"] or not all(math.isfinite(value) for value in values) or not any(value != 0 for value in values):
            raise ValueError("Encoder returned invalid dimensions/nonfinite/zero values.")
        return values

    query = request["query"]
    output_query = {"version": 0, "provenance": provenance, "text": query["text"],
                    "textHash": hashlib.sha256(query["text"].encode("utf-8")).hexdigest(), "vector": vector(query["text"], True)}
    items = [{**item, "vector": vector(item["text"], False)} for item in request["items"]]
    return {"version": 0, "requestId": request["requestId"], "index": {"version": 0, "provenance": provenance, "items": items},
            "query": output_query}


def main() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        if sys.argv[1:] == ["--probe"]:
            result = {"version": 0, "python": {"path": sys.executable, "sha256": file_hash(sys.executable)},
                      "runtime": {"distribution": "sentence-transformers", **distribution_identity("sentence-transformers"),
                                  "dependencies": {name: distribution_identity(name) for name in DEPENDENCIES}}}
        else:
            raw = sys.stdin.buffer.read(16_000_001)
            if len(raw) > 16_000_000:
                raise ValueError("Encoder request exceeds the bounded protocol.")
            input = json.loads(raw.decode("utf-8"))
            if sys.argv[1:] == ["--verify"]:
                result = {"version": 0, "provenance": verify(input["manifest"])}
            elif not sys.argv[1:]:
                result = encode(input)
            else:
                raise ValueError("Unsupported encoder adapter arguments.")
        protocol.write(json.dumps(result, ensure_ascii=False) + "\n")
        protocol.flush()
    except Exception as error:
        print(f"Knowledge Graph Extraction local encoder: {type(error).__name__}: {str(error)[:1200]}", file=sys.stderr)
        raise SystemExit(1) from None
    finally:
        protocol.close()


if __name__ == "__main__":
    main()
