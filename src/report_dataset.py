"""
Report for raw datasets in data/ (man-1 and woman-1).
Run:  python main.py
"""
import statistics
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # save figures to files, no window needed
import matplotlib.pyplot as plt
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = [
    ROOT / "data" / "persian-tts-datasets-man-1",
    ROOT / "data" / "persian-tts-datasets-woman-1",
]
RAW_DIRS = RAW_DIR
OUT_DIR = ROOT / "outputs"


def read_metadata(raw_dir, split):
    """Read metadata lines as (filename, text). The CSV has no header."""
    path = raw_dir / f"{split}_metadata.csv"
    if not path.is_file():
        raise SystemExit(f"Missing metadata file: {path}")
    rows = []
    # errors="replace": a bad byte must not crash the whole report
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if line:
                name, _, text = line.partition("|")  # format: filename|text
                rows.append((name.strip(), text.strip()))
    return rows


def base_name(name):
    """Remove the .wav extension from a metadata name if it exists."""
    return name[:-4] if name.lower().endswith(".wav") else name


def audio_paths(raw_dir, split):
    """List wav files under <split>/audio, skipping symlinks and files outside the folder."""
    audio_dir = (raw_dir / split / "audio").resolve()
    if not audio_dir.is_dir():
        raise SystemExit(f"Missing audio folder: {audio_dir}")
    # symlinks could point outside the dataset, so they are ignored
    return [p for p in audio_dir.rglob("*.wav") if p.is_file() and not p.is_symlink()]


def read_header(path):
    """Return (duration_s, sample_rate, channels), or None for an unreadable file.
    sf.info reads only the header, so no audio samples are loaded."""
    try:
        info = sf.info(str(path))
    except RuntimeError:  # soundfile raises LibsndfileError (a RuntimeError) on bad files
        return None
    if info.samplerate <= 0:  # avoid division by zero on a corrupt header
        return None
    return info.frames / info.samplerate, info.samplerate, info.channels


def scan_split(raw_dir, split):
    """Scan one split once. Return (paths, headers, bad_count)."""
    paths = audio_paths(raw_dir, split)
    with ThreadPoolExecutor(max_workers=8) as pool:  # header reads are I/O bound
        results = list(pool.map(read_header, paths))
    headers = [r for r in results if r is not None]
    return paths, headers, len(results) - len(headers)


def section_counts(raw_dir, scans, splits):
    """Section 1: clip counts, metadata rows, and empty text."""
    print("=== Section 1: clip counts, metadata rows, empty text ===")
    totals = Counter()

    for split in splits:
        rows = read_metadata(raw_dir, split)
        paths, _, bad = scans[split]
        stems = {p.stem for p in paths}  # set is enough: only membership is checked
        missing = sum(1 for n, _ in rows if base_name(n) not in stems)
        empty_text = sum(1 for _, text in rows if not text)

        print(f"\n[{split}]")
        print(f"  audio clips in {split}/audio: {len(paths)}")
        print(f"  unreadable/corrupt wav files: {bad}")
        print(f"  rows in {split}_metadata.csv: {len(rows)}")
        print(f"  rows whose audio is missing: {missing}")
        print(f"  rows with empty text (null): {empty_text}")
        totals.update(audio=len(paths), rows=len(rows), empty=empty_text)

    if len(splits) > 1:
        print(f"\n[total: {' + '.join(splits)}]")
        print(f"  audio clips: {totals['audio']}")
        print(f"  metadata rows: {totals['rows']}")
        print(f"  rows with empty text (null): {totals['empty']}")


def section_durations(scans, splits):
    """Sections 2 and 3: total and mean duration, from the single scan."""
    print("=== Section 2: total duration / Section 3: mean clip length ===")
    everything = []
    for split in splits:
        durs = [h[0] for h in scans[split][1]]
        everything.extend(durs)
        print(f"\n[{split}]")
        if durs:
            print(f"  total duration: {sum(durs) / 60:.1f} min ({sum(durs):.0f} s)")
            print(f"  mean clip length: {statistics.fmean(durs):.2f} s")
        else:
            print("  no readable clips")

    if len(splits) > 1 and everything:
        print(f"\n[total: {' + '.join(splits)}]")
        print(f"  total duration: {sum(everything) / 60:.1f} min ({sum(everything):.0f} s)")
        print(f"  mean clip length: {statistics.fmean(everything):.2f} s")


def section_histogram(raw_dir, scans, splits):
    """Section 4: histogram of clip lengths, saved as a PNG."""
    print("=== Section 4: clip length histogram ===")
    durs = [h[0] for s in splits for h in scans[s][1]]
    if not durs:
        print("  no clips found, skipping histogram")
        return

    OUT_DIR.mkdir(exist_ok=True)
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.hist(durs, bins=50)
    ax.set_xlabel("Clip length (s)")
    ax.set_ylabel("Number of clips")
    ax.set_title(f"Clip length histogram - {raw_dir.name} ({' + '.join(splits)})")
    fig.tight_layout()
    out_path = OUT_DIR / f"duration_hist_{raw_dir.name}.png"
    fig.savefig(out_path, dpi=120)
    plt.close(fig)  # free memory held by the figure
    print(f"  histogram saved: {out_path.relative_to(ROOT)}")


def section_audio_format(scans, splits):
    """Section 5: how many clips use each (sample rate, channels) pair."""
    print("=== Section 5: sample rate and channels ===")
    formats = Counter((h[1], h[2]) for s in splits for h in scans[s][1])
    if not formats:
        print("  no clips found")
        return
    for (rate, channels), count in sorted(formats.items()):
        print(f"  {rate} Hz, {channels} channel(s): {count} clips")


def run_report():
    """Scan every dataset directory and its splits once, then print all report sections."""
    dirs = RAW_DIR if isinstance(RAW_DIR, list) else [RAW_DIR]
    for i, raw_dir in enumerate(dirs):
        if not raw_dir.is_dir():
            print(f"Directory not found: {raw_dir}")
            continue

        splits = [s for s in ["train", "test"] if (raw_dir / f"{s}_metadata.csv").is_file()]
        if not splits:
            print(f"No valid splits found in {raw_dir}")
            continue

        print(f"=== Dataset: {raw_dir.name} ===")
        scans = {split: scan_split(raw_dir, split) for split in splits}
        section_counts(raw_dir, scans, splits)
        print()
        section_durations(scans, splits)
        print()
        section_histogram(raw_dir, scans, splits)
        print()
        section_audio_format(scans, splits)

        if i < len(dirs) - 1:
            print("\n" + "=" * 50 + "\n")

