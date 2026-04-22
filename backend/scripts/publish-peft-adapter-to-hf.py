import argparse
import json
import os
import re
from pathlib import Path


def slugify(value: str) -> str:
    lowered = (value or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "adapter"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Upload a PEFT adapter directory to Hugging Face Hub.")
    parser.add_argument("--adapter-dir", required=True)
    parser.add_argument("--repo-id")
    parser.add_argument("--repo-name-prefix", default="npc-sim")
    parser.add_argument("--run-id")
    visibility = parser.add_mutually_exclusive_group()
    visibility.add_argument("--public", action="store_true")
    visibility.add_argument("--private", action="store_true")
    parser.add_argument("--commit-message")
    parser.add_argument("--token")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    token = args.token or os.getenv("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN is required.")

    adapter_dir = Path(args.adapter_dir).resolve()
    if not adapter_dir.exists() or not adapter_dir.is_dir():
        raise SystemExit(f"adapter directory not found: {adapter_dir}")

    adapter_config_path = adapter_dir / "adapter_config.json"
    adapter_model_path = adapter_dir / "adapter_model.safetensors"
    if not adapter_config_path.exists():
        raise SystemExit(f"missing adapter_config.json: {adapter_config_path}")
    if not adapter_model_path.exists():
        raise SystemExit(f"missing adapter_model.safetensors: {adapter_model_path}")

    from huggingface_hub import HfApi

    api = HfApi(token=token)
    repo_id = args.repo_id
    if not repo_id:
        whoami = api.whoami(token=token)
        namespace = whoami.get("name")
        if not namespace:
            raise SystemExit("unable to resolve Hugging Face namespace for token")
        run_slug = slugify(args.run_id or adapter_dir.name)
        repo_name = f"{slugify(args.repo_name_prefix)}-{run_slug}-adapter"
        repo_id = f"{namespace}/{repo_name}"

    private = False if args.public else True
    if args.private:
        private = True

    api.create_repo(
        repo_id=repo_id,
        repo_type="model",
        private=private,
        exist_ok=True,
        token=token,
    )
    api.upload_folder(
        folder_path=str(adapter_dir),
        repo_id=repo_id,
        repo_type="model",
        path_in_repo="",
        commit_message=args.commit_message or f"Upload adapter from {adapter_dir.name}",
        ignore_patterns=["checkpoints/**", "*.log", "*.tmp"],
    )

    print(
        json.dumps(
            {
                "repoId": repo_id,
                "repoUrl": f"https://huggingface.co/{repo_id}",
                "private": private,
                "adapterDir": str(adapter_dir),
            }
        )
    )


if __name__ == "__main__":
    main()
