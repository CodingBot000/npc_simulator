import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

from huggingface_hub import snapshot_download


def parse_args():
    parser = argparse.ArgumentParser(
        description="Download a Hugging Face snapshot into a persistent Runpod volume.",
    )
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--revision")
    parser.add_argument("--local-dir", required=True)
    parser.add_argument("--allow-pattern", action="append", default=[])
    parser.add_argument("--ignore-pattern", action="append", default=[])
    return parser.parse_args()


def main():
    args = parse_args()
    target_dir = Path(args.local_dir)
    marker_path = target_dir / ".snapshot_complete.json"
    expected_marker = {
        "repo_id": args.repo_id,
        "revision": args.revision,
        "allow_patterns": args.allow_pattern,
        "ignore_patterns": args.ignore_pattern,
    }

    if marker_path.exists():
        try:
            existing_marker = json.loads(marker_path.read_text(encoding="utf-8"))
            if existing_marker == expected_marker:
                print(
                    f"Snapshot cache hit: {args.repo_id}@{args.revision or 'default'}",
                    flush=True,
                )
                return
        except json.JSONDecodeError:
            pass

    target_dir.mkdir(parents=True, exist_ok=True)
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    download_dir = target_dir
    tmp_dir = None
    if os.environ.get("DOWNLOAD_VIA_TMP") == "1":
        tmp_root = Path(os.environ.get("DOWNLOAD_TMP_ROOT", tempfile.gettempdir()))
        tmp_root.mkdir(parents=True, exist_ok=True)
        safe_repo = args.repo_id.replace("/", "__")
        safe_revision = (args.revision or "default").replace("/", "__")
        tmp_dir = tmp_root / f"npc-sim-{safe_repo}-{safe_revision}"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        download_dir = tmp_dir
        print(
            f"Downloading snapshot through temporary dir: {download_dir} -> {target_dir}",
            flush=True,
        )

    snapshot_download(
        repo_id=args.repo_id,
        revision=args.revision or None,
        local_dir=str(download_dir),
        local_dir_use_symlinks=False,
        token=token,
        allow_patterns=args.allow_pattern or None,
        ignore_patterns=args.ignore_pattern or None,
    )
    if tmp_dir is not None:
        print(f"Copying snapshot into volume target: {target_dir}", flush=True)
        shutil.copytree(tmp_dir, target_dir, dirs_exist_ok=True)
        shutil.rmtree(tmp_dir)

    marker_path.write_text(
        json.dumps(expected_marker, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Snapshot cache ready: {args.repo_id}@{args.revision or 'default'}", flush=True)


if __name__ == "__main__":
    main()
