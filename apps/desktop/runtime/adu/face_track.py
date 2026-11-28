"""Talk-frame sampling and Haar face tracking for Koubo Studio.

Adapted from MIT adu-motion-video scripts/face_tracking.py. Official MotionGit
packs are not used. A missing detector or video yields a wide fixed framing
and must not crash ingest.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def probe(video: Path) -> dict:
    raw = subprocess.check_output(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height,duration', '-of', 'json', str(video)],
        text=True, encoding='utf-8',
    )
    stream = (json.loads(raw).get('streams') or [{}])[0]
    width = int(stream.get('width') or 0)
    height = int(stream.get('height') or 0)
    duration = float(stream.get('duration') or 0)
    if width <= 0 or height <= 0 or duration <= 0:
        raise ValueError('Cannot probe talking-head video')
    return {'width': width, 'height': height, 'duration': duration}


def extract_frames(video: Path, directory: Path, sample_fps: float) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / 'f_%05d.jpg'
    subprocess.check_call(
        ['ffmpeg', '-y', '-i', str(video), '-vf', f'fps={sample_fps}',
         '-q:v', '5', str(pattern)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return sorted(directory.glob('f_*.jpg'))


YUNET_NAME = 'face_detection_yunet_2023mar.onnx'
BUNDLED_YUNET = Path(__file__).resolve().parent / 'data' / YUNET_NAME


def yunet_path() -> Path | None:
    if BUNDLED_YUNET.is_file():
        return BUNDLED_YUNET
    return None


def _row_from_box(image: Path, sample_fps: float, clock_fps: int, width: int, height: int, x, y, fw, fh):
    index = int(image.stem.split('_')[-1])
    t = (index - 1) / sample_fps
    frame = int(round(t * clock_fps)) + 1
    return (frame, t, (float(x) + float(fw) / 2) / width, (float(y) + float(fh) / 2) / height, float(fh) / height)


def detect_faces(images: list[Path], sample_fps: float, clock_fps: int) -> tuple[list, str, list[str]]:
    rows = []
    warnings: list[str] = []
    try:
        import cv2
        import numpy as np
    except (ImportError, OSError) as exc:
        return [], 'wide-fixed-fallback', [f'Local detector unavailable ({exc.__class__.__name__}); retain a wide fixed framing and review the presenter']

    haar = cascade_path() if hasattr(cv2, 'CascadeClassifier') else None
    yunet = yunet_path() if hasattr(cv2, 'FaceDetectorYN_create') else None
    if haar is None and yunet is None:
        return [], 'wide-fixed-fallback', ['Local detector unavailable; retain a wide fixed framing and review the presenter']

    detector = 'opencv-haar' if haar is not None else 'opencv-yunet'
    cascade = None
    yn = None
    try:
        if haar is not None:
            cascade = cv2.CascadeClassifier(str(haar))
            if cascade.empty():
                cascade = None
        if cascade is None and yunet is not None:
            yn = cv2.FaceDetectorYN_create(str(yunet), '', (320, 320), 0.7, 0.3, 5000)
            detector = 'opencv-yunet'
        if cascade is None and yn is None:
            return [], 'wide-fixed-fallback', ['Local detector unavailable; retain a wide fixed framing and review the presenter']
        for image in images:
            raw = np.frombuffer(image.read_bytes(), dtype=np.uint8)
            if cascade is not None:
                pixels = cv2.imdecode(raw, cv2.IMREAD_GRAYSCALE)
                if pixels is None:
                    continue
                height, width = pixels.shape
                faces = cascade.detectMultiScale(
                    pixels, scaleFactor=1.1, minNeighbors=5,
                    minSize=(max(24, width // 20), max(24, height // 30)),
                )
                if len(faces):
                    x, y, fw, fh = max(faces, key=lambda face: face[2] * face[3])
                    rows.append(_row_from_box(image, sample_fps, clock_fps, width, height, x, y, fw, fh))
                continue
            pixels = cv2.imdecode(raw, cv2.IMREAD_COLOR)
            if pixels is None:
                continue
            height, width = pixels.shape[:2]
            yn.setInputSize((width, height))
            _ok, faces = yn.detect(pixels)
            if faces is not None and len(faces):
                x, y, fw, fh = max(faces, key=lambda face: face[2] * face[3])[:4]
                rows.append(_row_from_box(image, sample_fps, clock_fps, width, height, x, y, fw, fh))
    except Exception as exc:  # noqa: BLE001 — keep ingest running
        warnings.append(f'Detector failed ({exc.__class__.__name__}); retain a wide fixed framing and review the presenter')
        return [], 'wide-fixed-fallback', warnings
    return rows, detector, warnings


def smooth(rows: list, duration: float, clock_fps: int) -> dict:
    if not rows:
        rows = [(1, 0.0, 0.5, 0.42, 0.28), (max(1, int(round(duration * clock_fps))), duration, 0.5, 0.42, 0.28)]
    if rows[0][0] > 1:
        rows.insert(0, (1, 0.0, *rows[0][2:]))
    last_frame = max(1, int(round(duration * clock_fps)))
    if rows[-1][0] < last_frame:
        rows.append((last_frame, duration, *rows[-1][2:]))
    face = {
        'f': [r[0] for r in rows],
        't': [round(r[1], 4) for r in rows],
    }
    for key, index in (('cx', 2), ('cy', 3), ('h', 4)):
        values = [r[index] for r in rows]
        face[key] = [
            round(sum(values[max(0, i - 2):i + 3]) / len(values[max(0, i - 2):i + 3]), 4)
            for i in range(len(values))
        ]
    return face



HAAR_NAME = 'haarcascade_frontalface_default.xml'
BUNDLED_HAAR = Path(__file__).resolve().parent / 'data' / HAAR_NAME


def cascade_path() -> Path | None:
    import os
    asked = (os.environ.get('KOUBO_HAAR_CASCADE') or '').strip()
    candidates = [Path(asked)] if asked else []
    candidates.append(BUNDLED_HAAR)
    try:
        import cv2
        haarcascades = getattr(getattr(cv2, 'data', None), 'haarcascades', None)
        if haarcascades:
            candidates.append(Path(haarcascades) / HAAR_NAME)
    except (ImportError, OSError, AttributeError):
        pass
    for path in candidates:
        if path and path.is_file():
            return path
    return None


def detector_available() -> bool:
    try:
        import cv2
        if hasattr(cv2, 'CascadeClassifier') and cascade_path() is not None:
            return True
        if hasattr(cv2, 'FaceDetectorYN_create') and yunet_path() is not None:
            return True
        return False
    except (ImportError, OSError, AttributeError):
        return False


def prepare_talk(video: Path, out_dir: Path, sample_fps: float = 8.0, clock_fps: int = 60,
                 keep_frames: bool = False) -> dict:
    info = probe(video)
    frame_dir = out_dir / 'talk' / 'clip_000'
    images: list[Path] = []
    if detector_available():
        images = extract_frames(video, frame_dir, sample_fps)
        rows, detector, warnings = detect_faces(images, sample_fps, clock_fps)
    else:
        rows, detector, warnings = [], 'wide-fixed-fallback', [
            'Local detector unavailable; retain a wide fixed framing and review the presenter'
        ]
    if not rows:
        detector = 'wide-fixed-fallback'
        warnings.append('No reliable face found; this is wide framing, not verified tracking')
    else:
        gaps = [rows[0][1]] + [b[1] - a[1] for a, b in zip(rows, rows[1:])]
        if gaps and max(gaps) > 1:
            warnings.append('Face detection gaps exceed one second; inspect turns and crop joins')
    face = smooth(rows, info['duration'], clock_fps)
    payload = {
        'mode': detector,
        'fps': clock_fps,
        'sampleFps': sample_fps,
        'width': info['width'],
        'height': info['height'],
        'duration': info['duration'],
        'samples': len(face['t']),
        'warnings': warnings,
        'reviewRequired': True,
        **face,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'face.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not keep_frames:
        for image in images:
            image.unlink(missing_ok=True)
        try:
            frame_dir.rmdir()
            (out_dir / 'talk').rmdir()
        except OSError:
            pass
    print(json.dumps({k: payload[k] for k in ('mode', 'samples', 'width', 'height', 'warnings')}, ensure_ascii=False))
    return payload


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(prog='prepare-talk')
    parser.add_argument('--video', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--sample-fps', type=float, default=8.0)
    parser.add_argument('--fps', type=int, default=60)
    parser.add_argument('--keep-frames', action='store_true')
    args = parser.parse_args(argv)
    try:
        prepare_talk(Path(args.video), Path(args.out), args.sample_fps, args.fps, args.keep_frames)
    except Exception as exc:  # noqa: BLE001 — report and leave ingest to fall back
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
