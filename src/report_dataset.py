"""
Report for the raw amir0907/s8 dataset in data/s8_raw.
Run:  python src/report_dataset.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "s8_raw"
SPLITS = ["train", "test"]


def read_metadata(split):
    """Read each metadata line as (filename, text). The CSV has no header."""
    path = RAW_DIR / f"{split}_metadata.csv"
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            name, _, text = line.partition("|")
            rows.append((name.strip(), text.strip()))
    return rows


def audio_files(split):
    """Return a set of audio file base names found under <split>/audio."""
    audio_dir = RAW_DIR / split / "audio"
    return {p.stem for p in audio_dir.rglob("*.wav")}


def base_name(name):
    """Remove the .wav extension from a metadata name if it exists."""
    return name[:-4] if name.lower().endswith(".wav") else name


def section_counts():
    print("=== Section 1: clip counts, metadata rows, empty text ===")
    total_audio = 0
    total_rows = 0
    total_empty = 0

    for split in SPLITS:
        rows = read_metadata(split)
        wavs = audio_files(split)
        names = [base_name(n) for n, _ in rows]
        missing = set(names) - wavs
        empty_text = sum(1 for _, text in rows if not text)

        total_audio += len(wavs)
        total_rows += len(rows)
        total_empty += empty_text

        print(f"\n[{split}]")
        print(f"  audio clips in {split}/audio: {len(wavs)}")
        print(f"  rows in {split}_metadata.csv: {len(rows)}")
        print(f"  rows whose audio is missing: {sum(1 for n in names if n in missing)}")
        print(f"  rows with empty text (null): {empty_text}")

    print("\n[total: train + test]")
    print(f"  audio clips: {total_audio}")
    print(f"  metadata rows: {total_rows}")
    print(f"  rows with empty text (null): {total_empty}")


if __name__ == "__main__":
    section_counts()
