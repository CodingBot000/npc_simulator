import argparse
import json
import tempfile
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser(
        description="Derive an MLX runtime artifact from a PEFT adapter."
    )
    parser.add_argument("--model", required=True)
    parser.add_argument("--runtime-base-model")
    parser.add_argument("--adapter-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--runtime-kind", default="mlx_fused_model")
    parser.add_argument("--manifest-path", required=True)
    return parser


def main():
    args = build_parser().parse_args()
    if args.runtime_kind != "mlx_fused_model":
        raise ValueError(f"Unsupported runtime kind: {args.runtime_kind}")

    from mlx_lm import convert
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    output_dir = Path(args.output_dir)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(args.manifest_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    base_model = AutoModelForCausalLM.from_pretrained(
        args.model,
        trust_remote_code=True,
    )
    model = PeftModel.from_pretrained(base_model, args.adapter_dir)
    merged_model = model.merge_and_unload()
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)

    with tempfile.TemporaryDirectory(prefix="merged_hf_model_") as merged_dir:
        merged_dir_path = Path(merged_dir)
        merged_model.save_pretrained(str(merged_dir_path), safe_serialization=True)
        tokenizer.save_pretrained(str(merged_dir_path))
        convert(
            hf_path=str(merged_dir_path),
            mlx_path=str(output_dir),
            quantize=True,
            q_bits=4,
            trust_remote_code=True,
        )

    manifest = {
        "baseModelId": args.model,
        "runtimeBaseModelId": args.runtime_base_model,
        "canonicalArtifact": {
            "kind": "peft_adapter",
            "path": str(Path(args.adapter_dir).resolve()),
        },
        "runtimeArtifact": {
            "kind": args.runtime_kind,
            "path": str(output_dir.resolve()),
        },
        "derivation": {"status": "succeeded"},
    }
    with manifest_path.open("w", encoding="utf8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
