"""Sync a fixed snapshot of remade Chapters 1/3; never change Chapter 2 or text.

Requires Pillow. Example (run from the project root):
python scripts/sync-remade-images.py --source ../词卡配图重制_前三章_1比1 \
  --chapter3-through 92 --record docs/image-sync-2026-11-02.json

Omit --chapter3-through to snapshot all Chapter 3 PNGs present at startup.
Original PNGs and previous web assets are retained. Repeated runs reuse verified
hash-named assets. Learning records and vocabulary fields are never rewritten.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import argparse
import json
from pathlib import Path
import re
import shutil
import time

from PIL import Image

PROJECT = Path(__file__).resolve().parents[1]
COURSE = PROJECT / 'public/course.json'
FRAMES = PROJECT / 'public/uploads/rounded-photo-frames.json'
CHAPTERS = {1: 'geography', 3: 'ch03'}
ALLOWED = {'imageUrl', 'imageZoomUrl', 'imageFrame'}


def key(name):
    match = re.fullmatch(r'(\d{3})_(.+)\.png', name, re.IGNORECASE)
    if not match:
        raise ValueError(f'Unexpected image filename: {name}')
    return int(match[1]), match[2].casefold()


def stamp(path):
    status = path.stat()
    return status.st_size, status.st_mtime_ns


def image_bytes(image, size, quality):
    output = BytesIO()
    view = image if image.size == (size, size) else image.resize((size, size), Image.Resampling.LANCZOS)
    view.save(output, 'WEBP', quality=quality, method=6)
    return output.getvalue()


def write_asset(path, raw, expected_size):
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError(f'Existing hash-named asset differs: {path.name}')
    else:
        # Keep a reserve even if other applications consume disk space meanwhile.
        if shutil.disk_usage(PROJECT).free < len(raw) + 128 * 1024**2:
            raise OSError('Not enough free disk space; course mappings remain unchanged')
        path.write_bytes(raw)
    with Image.open(path) as check:
        check.load()
        if check.format != 'WEBP' or check.size != (expected_size, expected_size):
            raise ValueError(f'Invalid generated asset: {path.name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--chapter3-through', type=int)
    parser.add_argument('--record', required=True, type=Path)
    args = parser.parse_args()
    if args.chapter3_through is not None and not 1 <= args.chapter3_through <= 166:
        parser.error('--chapter3-through must be between 1 and 166')
    record_path = (PROJECT / args.record).resolve()
    if not record_path.is_relative_to(PROJECT) or record_path.suffix != '.json':
        parser.error('--record must be a JSON file inside this project')
    course_raw, frames_raw = COURSE.read_bytes(), FRAMES.read_bytes()
    before, frames_before = json.loads(course_raw), json.loads(frames_raw)
    course, frames = deepcopy(before), deepcopy(frames_before)
    snapshot_at = datetime.now(timezone.utc).isoformat()
    selected = []
    counts = {}
    for chapter, chapter_id in CHAPTERS.items():
        words = [w for w in course['course']['words'] if w['chapter'] == chapter_id]
        expected = {key(w['imageName']): w for w in words}
        if len(expected) != len(words):
            raise ValueError(f'Ambiguous course image names in Chapter {chapter}')
        sources = {}
        for path in sorted((args.source / f'Chapter{chapter}').glob('*.png')):
            image_key = key(path.name)
            if chapter == 3 and args.chapter3_through is not None and image_key[0] > args.chapter3_through:
                continue
            if image_key not in expected or image_key in sources:
                raise ValueError(f'Unmatched or ambiguous source: Chapter{chapter}/{path.name}')
            sources[image_key] = path
        if chapter == 1 and (len(words) != 240 or set(sources) != set(expected)):
            raise ValueError('Chapter 1 must have all 240 matching PNGs')
        if chapter == 3 and args.chapter3_through is not None:
            if {entry[0] for entry in sources} != set(range(1, args.chapter3_through + 1)):
                raise ValueError('The requested Chapter 3 snapshot has missing files')
        counts[f'Chapter{chapter}'] = {'synced': len(sources), 'total': len(words), 'retained': len(words) - len(sources)}
        selected.extend((chapter, expected[k], path, stamp(path)) for k, path in sources.items())
    reserve = max(512 * 1024**2, int(len(selected) * 1.5 * 1024**2) + 128 * 1024**2)
    free = shutil.disk_usage(PROJECT).free
    if free < reserve:
        raise OSError(f'Need at least {reserve // 1024**2} MiB free; available {free // 1024**2} MiB')
    print(json.dumps({'snapshotAt': snapshot_at, 'chapters': counts, 'freeMiB': free // 1024**2}, ensure_ascii=False), flush=True)
    time.sleep(1)
    if any(stamp(path) != status for _, _, path, status in selected):
        raise ValueError('A source is still being written; retry after it finishes')

    def convert(item):
        chapter, word, path, status = item
        raw = path.read_bytes()
        if stamp(path) != status:
            raise ValueError(f'Source changed during read: {path.name}')
        source_hash = sha256(raw).hexdigest()
        directory = PROJECT / 'public/uploads' / f'chapter{chapter}-remade'
        directory.mkdir(parents=True, exist_ok=True)
        stem = f'{path.stem}-{source_hash[:16]}'
        preview, zoom = directory / f'{stem}-960.webp', directory / f'{stem}-1254.webp'
        with Image.open(BytesIO(raw)) as image:
            image.load()
            if image.format != 'PNG' or image.size != (1254, 1254) or image.mode != 'RGB':
                raise ValueError(f'Expected readable RGB 1254x1254 PNG: {path.name}')
            write_asset(preview, image_bytes(image, 960, 90), 960)
            write_asset(zoom, image_bytes(image, 1254, 94), 1254)
        return {
            'chapter': chapter, 'wordId': word['id'], 'source': path.name,
            'sourceSha256': source_hash, 'sourceBytes': len(raw),
            'sourceModifiedAt': datetime.fromtimestamp(status[1] / 1e9, timezone.utc).isoformat(),
            'oldImageUrl': word['imageUrl'], 'oldImageZoomUrl': word.get('imageZoomUrl'),
            'imageUrl': '/' + preview.relative_to(PROJECT / 'public').as_posix(),
            'imageZoomUrl': '/' + zoom.relative_to(PROJECT / 'public').as_posix(),
            'previewBytes': preview.stat().st_size, 'zoomBytes': zoom.stat().st_size,
        }

    manifest = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item in pool.map(convert, selected):
            manifest.append(item)
            if len(manifest) % 20 == 0 or len(manifest) == len(selected):
                print(f'Converted {len(manifest)}/{len(selected)}', flush=True)
    by_id = {item['wordId']: item for item in manifest}
    for word in course['course']['words']:
        if word['id'] not in by_id:
            continue
        item = by_id[word['id']]
        word['imageUrl'], word['imageZoomUrl'] = item['imageUrl'], item['imageZoomUrl']
        if word.get('imageFrame'):
            word['imageFrame'] = {'left': 0, 'top': 0, 'width': 1, 'height': 1, 'aspectRatio': 1}
        frames['frames'][word['id']] = {'url': item['imageUrl'], 'left': 0, 'top': 0, 'width': 1, 'height': 1, 'background': '#ffffff'}
    for old, new in zip(before['course']['words'], course['course']['words'], strict=True):
        if old['id'] not in by_id:
            assert old == new, 'An unsynced word changed'
        assert {k: v for k, v in old.items() if k not in ALLOWED} == {k: v for k, v in new.items() if k not in ALLOWED}, 'Non-image vocabulary changed'
    for word_id, old_frame in frames_before['frames'].items():
        if word_id not in by_id:
            assert frames['frames'][word_id] == old_frame, 'An unrelated image frame changed'
    assert {k: v for k, v in frames.items() if k != 'frames'} == {k: v for k, v in frames_before.items() if k != 'frames'}
    if any(stamp(path) != status for _, _, path, status in selected):
        raise ValueError('A source changed during conversion; course mappings were not updated')
    if COURSE.read_bytes() != course_raw or FRAMES.read_bytes() != frames_raw:
        raise ValueError('Course/frame mappings changed concurrently; refusing to overwrite')
    summary = {'snapshotAt': snapshot_at, 'chapters': counts, 'chapter2Unchanged': True, 'nonImageFieldsUnchanged': True,
               'preview': {'size': 960, 'quality': 90}, 'zoom': {'size': 1254, 'quality': 94},
               'webMiB': round(sum(item['previewBytes'] + item['zoomBytes'] for item in manifest) / 1024**2, 2)}
    record_path.parent.mkdir(parents=True, exist_ok=True)
    record_path.write_text(json.dumps({**summary, 'files': manifest}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    try:
        FRAMES.write_text(json.dumps(frames, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
        COURSE.write_text(json.dumps(course, ensure_ascii=False, separators=(',', ':')), encoding='utf-8', newline='\n')
    except Exception:
        COURSE.write_bytes(course_raw)
        FRAMES.write_bytes(frames_raw)
        raise
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
