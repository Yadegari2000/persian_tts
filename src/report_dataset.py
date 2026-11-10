"""
Report for the raw amir0907/s8 dataset in data/s8_raw.
Run:  python src/report_dataset.py
"""
from pathlib import Path

import soundfile as sf

# Project paths, resolved from this file's location so the script works from any folder
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
                continue  # skip blank lines
            name, _, text = line.partition("|")  # format: filename|text
            rows.append((name.strip(), text.strip()))
    return rows


def audio_files(split):
    """Return a dict: audio base name -> full path, searching under <split>/audio."""
    audio_dir = RAW_DIR / split / "audio"
    return {p.stem: p for p in audio_dir.rglob("*.wav")}


def base_name(name):
    """Remove the .wav extension from a metadata name if it exists."""
    return name[:-4] if name.lower().endswith(".wav") else name


def section_counts():
    """Section 1: clip counts, metadata rows, and empty text per split and in total."""
    print("=== Section 1: clip counts, metadata rows, empty text ===")
    total_audio = 0
    total_rows = 0
    total_empty = 0

    for split in SPLITS:
        rows = read_metadata(split)
        wavs = audio_files(split)
        names = [base_name(n) for n, _ in rows]
        missing = set(names) - set(wavs)  # metadata names with no matching wav file
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


def clip_durations(split):
    """Return a list with the duration (in seconds) of every wav file under <split>/audio.
    sf.info reads only the file header, so no audio samples are loaded into memory."""
    durations = []
    for path in audio_files(split).values():
        info = sf.info(str(path))
        durations.append(info.frames / info.samplerate)  # duration = frames / sample rate
    return durations


def total_duration_seconds(split):
    """Sum of all clip durations in a split, in seconds."""
    return sum(clip_durations(split))


def section_total_duration():
    """Section 2: total duration of clips per split and for both splits together."""
    print("=== Section 2: total duration ===")
    grand_total = 0.0

    for split in SPLITS:
        seconds = total_duration_seconds(split)
        grand_total += seconds
        print(f"\n[{split}]")
        print(f"  total duration: {seconds / 60:.1f} min ({seconds:.0f} s)")

    print("\n[total: train + test]")
    print(f"  total duration: {grand_total / 60:.1f} min ({grand_total:.0f} s)")


def section_mean_duration():
    """Section 3: mean clip length per split and across both splits together."""
    print("=== Section 3: mean clip length ===")
    all_durations = []

    for split in SPLITS:
        durations = clip_durations(split)
        all_durations.extend(durations)
        if not durations:
            print(f"\n[{split}] no clips found")
            continue
        # mean = sum of lengths divided by number of clips
        print(f"\n[{split}]")
        print(f"  mean clip length: {sum(durations) / len(durations):.2f} s")

    if all_durations:
        print("\n[total: train + test]")
        print(f"  mean clip length: {sum(all_durations) / len(all_durations):.2f} s")


if __name__ == "__main__":
    section_counts()
    print()
    section_total_duration()
    print()
    section_mean_duration()
