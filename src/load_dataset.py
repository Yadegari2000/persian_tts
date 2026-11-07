"""
دانلود دیتاست amir0907/s8 و ذخیره در data/s8_arrow.
قبل از اجرا:  export HF_TOKEN="hf_..."   (اختیاری ولی توصیه‌شده)
اجرا:        python src/load_dataset.py
"""
import os
from pathlib import Path

from datasets import load_dataset, load_from_disk
from huggingface_hub import snapshot_download

REPO = "amir0907/s8"
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARROW_DIR = DATA_DIR / "s8_arrow"
RAW_DIR = DATA_DIR / "s8_raw"


def get_token():
    token = os.getenv("HF_TOKEN")
    if not token:
        print("HF_TOKEN is not defined")
    return token


def main():
    token = get_token()
    DATA_DIR.mkdir(exist_ok=True)

    try:
        ds = load_dataset(REPO, token=token, cache_dir=str(DATA_DIR / "hf_cache"))
        ds.save_to_disk(str(ARROW_DIR))
        print("OK: dataset at /data", ARROW_DIR)
        print(ds)
    except Exception as e:
        print("load_dataset error", e)
        path = snapshot_download(
            REPO, repo_type="dataset", token=token, local_dir=str(RAW_DIR)
        )
        print("OK (snapshot_download): files in", path)


if __name__ == "__main__":
    main()
