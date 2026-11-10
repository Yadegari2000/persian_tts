"""
Report for the raw amir0907/s8 dataset in data/s8_raw.
Run:  python src/report_dataset.py
"""
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # save figures to files, no window needed
import matplotlib.pyplot as plt
import soundfile as sf

# Project paths, resolved from this file's location so the script works from any folder
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "s8_raw"
OUT_DIR = ROOT / "outputs"
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


def section_histogram():
    """Section 4: histogram of clip lengths for train + test, saved as a PNG."""
    print("=== Section 4: clip length histogram ===")
    all_durations = []
    for split in SPLITS:
        all_durations.extend(clip_durations(split))

    if not all_durations:
        print("  no clips found, skipping histogram")
        return

    OUT_DIR.mkdir(exist_ok=True)  # create outputs/ if it does not exist
    plt.figure(figsize=(8, 4))
    plt.hist(all_durations, bins=50)  # 50 bins across the range of clip lengths
    plt.xlabel("Clip length (s)")
    plt.ylabel("Number of clips")
    plt.title("Clip length histogram (train + test)")
    plt.tight_layout()

    out_path = OUT_DIR / "duration_hist.png"
    plt.savefig(out_path, dpi=120)
    plt.close()  # free memory held by the figure
    print(f"  histogram saved: {out_path.relative_to(ROOT)}")


def section_audio_format():
    """Section 5: sample rates and channel counts found across all wav files.
    Counter shows how many clips use each (sample rate, channels) pair."""
    print("=== Section 5: sample rate and channels ===")
    formats = Counter()  # key: (sample_rate, channels), value: number of clips

    for split in SPLITS:
        for path in audio_files(split).values():
            info = sf.info(str(path))
            formats[(info.samplerate, info.channels)] += 1

    if not formats:
        print("  no clips found")
        return

    for (rate, channels), count in sorted(formats.items()):
        print(f"  {rate} Hz, {channels} channel(s): {count} clips")


if __name__ == "__main__":
    section_counts()
    print()
    section_total_duration()
    print()
    section_mean_duration()
    print()
    section_histogram()
    print()
    section_audio_format()
