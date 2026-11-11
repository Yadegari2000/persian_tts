"""
دانلود دیتاست amir0907/s8 و ذخیره در data/s8_arrow.
قبل از اجرا:  export HF_TOKEN="hf_..."   (اختیاری ولی توصیه‌شده)
اجرا:        python src/load_dataset.py
"""
import os
from pathlib import Path

from datasets import load_dataset, load_from_disk
from huggingface_hub import snapshot_download

REPO = [
    "https://huggingface.co/datasets/amir0907/s8",
    "https://huggingface.co/datasets/amir0907/Persian-TTS-Speaker0"
]
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def extract_repo_id(url_or_repo: str) -> str:
    """Extract Hugging Face dataset repo id from a URL or repo identifier."""
    url_or_repo = url_or_repo.strip().rstrip("/")
    prefix = "https://huggingface.co/datasets/"
    if url_or_repo.startswith(prefix):
        return url_or_repo[len(prefix):]
    http_prefix = "http://huggingface.co/datasets/"
    if url_or_repo.startswith(http_prefix):
        return url_or_repo[len(http_prefix):]
    if "huggingface.co/datasets/" in url_or_repo:
        return url_or_repo.split("huggingface.co/datasets/")[-1]
    return url_or_repo


def get_target_dir(repo_id: str) -> Path:
    """Get destination directory under data/, checking existing folders."""
    folder_name = repo_id.split("/")[-1]
    if (DATA_DIR / folder_name).exists() and any((DATA_DIR / folder_name).iterdir()):
        return DATA_DIR / folder_name
    if (DATA_DIR / f"{folder_name}_raw").exists() and any((DATA_DIR / f"{folder_name}_raw").iterdir()):
        return DATA_DIR / f"{folder_name}_raw"
    return DATA_DIR / folder_name


def get_token():
    token = os.getenv("HF_TOKEN")
    if not token:
        print("HF_TOKEN is not defined")
    return token


def main():
    token = get_token()
    DATA_DIR.mkdir(exist_ok=True)

    for item in REPO:
        repo_id = extract_repo_id(item)
        target_dir = get_target_dir(repo_id)

        # Skip if dataset is already downloaded
        if target_dir.exists() and any(target_dir.iterdir()):
            print(f"Skipping {repo_id}: already downloaded at {target_dir}")
            continue

        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            ds = load_dataset(repo_id, token=token, cache_dir=str(DATA_DIR / "hf_cache"))
            ds.save_to_disk(str(target_dir))
            print("OK: dataset at /data", target_dir)
            print(ds)
        except Exception as e:
            print("load_dataset error", e)
            path = snapshot_download(
                repo_id, repo_type="dataset", token=token, local_dir=str(target_dir)
            )
            print("OK (snapshot_download): files in", path)


if __name__ == "__main__":
    main()
