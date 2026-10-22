"""긴 회의 녹음을 OpenAI 전사 API 제한 안에서 처리한다.

OpenAI 전사 API는 파일당 25MB, 모델별 최대 길이 제한이 있다. 녹음을 모노·16kHz·저비트레이트로 줄이고,
그래도 크거나 길면 무음 구간 근처에서 잘라 순서대로 전사한 뒤 하나로 합친다.

- 조각 경계는 무음 구간 가운데를 우선 쓰고, 조각끼리 STT_SEGMENT_OVERLAP_SEC만큼 겹친다.
- 겹친 구간의 발화는 경계(cut) 이전에 시작하면 앞 조각, 이후에 시작하면 뒤 조각 것을 쓴다.
- 화자분리 모델이면 앞 조각에서 화자별 음성 샘플(2~10초)을 뽑아 다음 조각에 참고 화자로 넘긴다(최대 4명).
"""
from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

MAX_KNOWN_SPEAKERS = 4
REFERENCE_MIN_SEC = 2.0
REFERENCE_MAX_SEC = 10.0
SILENCE_RE = re.compile(r"silence_(start|end): (-?[0-9.]+)")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass
class SttSettings:
    max_upload_mb: float = 24.0
    segment_sec: float = 1200.0
    overlap_sec: float = 4.0
    silence_search_sec: float = 30.0
    bitrate: str = "32k"
    speaker_references: bool = True

    @classmethod
    def from_env(cls) -> "SttSettings":
        return cls(
            max_upload_mb=_env_float("STT_MAX_UPLOAD_MB", 24.0),
            # gpt-4o 전사 모델은 요청당 길이 제한(약 1,400~1,500초로 보고됨)이 있어 20분 단위로 자른다.
            segment_sec=_env_float("STT_SEGMENT_SEC", 1200.0),
            overlap_sec=_env_float("STT_SEGMENT_OVERLAP_SEC", 4.0),
            silence_search_sec=_env_float("STT_SILENCE_SEARCH_SEC", 30.0),
            bitrate=os.getenv("STT_AUDIO_BITRATE", "32k"),
            speaker_references=os.getenv("STT_SPEAKER_REFERENCES", "true").lower() == "true",
        )


# transcribe_once(path, known_names, known_references) -> (segments, text, language)
# segments: [{"speaker": str|None, "start": float, "end": float|None, "text": str}], 시간은 파일 기준(초)
TranscribeOnce = Callable[[str, list[str] | None, list[str] | None], tuple[list[dict[str, Any]], str, str | None]]


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=False)


def probe_duration(path: str | Path) -> float:
    completed = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)])
    try:
        return float(completed.stdout.strip())
    except ValueError as exc:
        raise RuntimeError(f"ffprobe could not read audio duration: {completed.stderr.strip()[-300:]}") from exc


def compress_audio(source: str | Path, target: Path, bitrate: str) -> Path:
    completed = _run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-b:a", bitrate, str(target)])
    if completed.returncode != 0 or not target.exists():
        raise RuntimeError(f"ffmpeg could not convert audio: {completed.stderr.strip()[-300:]}")
    return target


def find_silences(path: str | Path, noise_db: int = -35, min_sec: float = 0.4) -> list[tuple[float, float]]:
    completed = _run(["ffmpeg", "-v", "info", "-i", str(path), "-af", f"silencedetect=noise={noise_db}dB:d={min_sec}", "-f", "null", "-"])
    silences: list[tuple[float, float]] = []
    start: float | None = None
    for kind, value in SILENCE_RE.findall(completed.stderr):
        if kind == "start":
            start = max(0.0, float(value))
        elif start is not None:
            silences.append((start, float(value)))
            start = None
    return silences


def plan_cuts(duration: float, segment_sec: float, silences: list[tuple[float, float]], search_sec: float) -> list[float]:
    """조각 경계 목록 [0, c1, c2, ..., duration]. 목표 지점 ±search_sec 안의 가장 가까운 무음 가운데를 쓴다."""
    cuts = [0.0]
    while duration - cuts[-1] > segment_sec:
        target = cuts[-1] + segment_sec
        candidates = [
            (start + end) / 2
            for start, end in silences
            if cuts[-1] + segment_sec / 2 < (start + end) / 2 <= target and abs((start + end) / 2 - target) <= search_sec
        ]
        cuts.append(min(candidates, key=lambda c: abs(c - target)) if candidates else target)
    cuts.append(duration)
    return cuts


def extract_clip(source: Path, start: float, end: float, target: Path, *, wav: bool = False) -> Path:
    args = ["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-to", f"{end:.3f}", "-i", str(source)]
    args += ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"] if wav else ["-c", "copy"]
    completed = _run(args + [str(target)])
    if completed.returncode != 0 or not target.exists():
        raise RuntimeError(f"ffmpeg could not cut audio: {completed.stderr.strip()[-300:]}")
    return target


def _wav_data_url(path: Path) -> str:
    return "data:audio/wav;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


class SpeakerMap:
    """조각마다 다른 화자 라벨을 회의 전체에서 일관된 SPEAKER_00.. 이름으로 바꾼다."""

    def __init__(self) -> None:
        self.next_index = 0
        self.references: dict[str, str] = {}  # 이름 -> wav data URL (최대 4명)

    def new_name(self) -> str:
        name = f"SPEAKER_{self.next_index:02d}"
        self.next_index += 1
        return name

    def assign(self, labels: list[str | None]) -> dict[str | None, str]:
        mapping: dict[str | None, str] = {}
        for label in labels:
            if label in mapping:
                continue
            # 참고 화자로 넘긴 이름이 그대로 돌아오면 같은 사람으로 본다.
            mapping[label] = label if label in self.references else self.new_name()
        return mapping


def _pick_reference(segments: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    spoken = [s for s in segments if s["speaker"] == name and s.get("end") is not None]
    usable = [s for s in spoken if float(s["end"]) - float(s["start"]) >= REFERENCE_MIN_SEC]
    return max(usable, key=lambda s: float(s["end"]) - float(s["start"]), default=None)


def _collect_references(speakers: SpeakerMap, segments: list[dict[str, Any]], audio: Path, work: Path) -> None:
    for name in dict.fromkeys(s["speaker"] for s in segments):
        if len(speakers.references) >= MAX_KNOWN_SPEAKERS or name in speakers.references:
            continue
        best = _pick_reference(segments, name)
        if best is None:
            continue
        start = float(best["start"])
        end = min(float(best["end"]), start + REFERENCE_MAX_SEC)
        try:
            clip = extract_clip(audio, start, end, work / f"ref_{name}.wav", wav=True)
        except RuntimeError:
            continue
        speakers.references[name] = _wav_data_url(clip)


def transcribe_long_audio(
    audio_path: str | Path,
    transcribe_once: TranscribeOnce,
    *,
    diarize: bool,
    settings: SttSettings | None = None,
) -> dict[str, Any]:
    """녹음 길이와 크기에 관계없이 전사한다. 반환: {segments, text, language, chunks}"""
    settings = settings or SttSettings.from_env()
    audio_path = Path(audio_path)
    if not ffmpeg_available():
        if audio_path.stat().st_size > settings.max_upload_mb * 1024 * 1024:
            raise RuntimeError("ffmpeg is required to split recordings larger than the OpenAI upload limit. Install ffmpeg.")
        segments, text, language = transcribe_once(str(audio_path), None, None)
        return {"segments": _relabel_single(segments), "text": text, "language": language, "chunks": 1}

    with tempfile.TemporaryDirectory(prefix="stt_long_") as tmp:
        work = Path(tmp)
        compressed = compress_audio(audio_path, work / "audio.mp3", settings.bitrate)
        duration = probe_duration(compressed)
        size_ok = compressed.stat().st_size <= settings.max_upload_mb * 1024 * 1024
        if size_ok and duration <= settings.segment_sec:
            segments, text, language = transcribe_once(str(compressed), None, None)
            return {"segments": _relabel_single(segments), "text": text, "language": language, "chunks": 1}

        # 비트레이트 때문에 크기가 넘치면 조각 길이를 줄인다.
        segment_sec = settings.segment_sec
        if not size_ok:
            bytes_per_sec = compressed.stat().st_size / max(duration, 1.0)
            segment_sec = min(segment_sec, 0.9 * settings.max_upload_mb * 1024 * 1024 / bytes_per_sec)
        cuts = plan_cuts(duration, segment_sec, find_silences(compressed), settings.silence_search_sec)

        speakers = SpeakerMap()
        merged: list[dict[str, Any]] = []
        texts: list[str] = []
        language: str | None = None
        half = settings.overlap_sec / 2
        for index in range(len(cuts) - 1):
            cut_start, cut_end = cuts[index], cuts[index + 1]
            window_start = max(0.0, cut_start - half)
            window_end = min(duration, cut_end + half)
            piece = extract_clip(compressed, window_start, window_end, work / f"part_{index:03d}.mp3")
            names = refs = None
            if diarize and settings.speaker_references and speakers.references:
                names = list(speakers.references)
                refs = [speakers.references[name] for name in names]
            segments, text, chunk_language = transcribe_once(str(piece), names, refs)
            language = language or chunk_language
            texts.append(text)

            kept = []
            for seg in segments:
                start = float(seg.get("start") or 0) + window_start
                if not (cut_start <= start < cut_end or (index == len(cuts) - 2 and start >= cut_start)):
                    continue
                end = seg.get("end")
                kept.append({**seg, "start": start, "end": float(end) + window_start if end is not None else None})
            mapping = speakers.assign([seg.get("speaker") for seg in kept])
            for seg in kept:
                seg["speaker"] = mapping[seg.get("speaker")]
            if diarize and settings.speaker_references:
                _collect_references(speakers, kept, compressed, work)
            merged.extend(kept)

        merged.sort(key=lambda seg: seg["start"])
        return {"segments": merged, "text": "\n".join(t for t in texts if t), "language": language, "chunks": len(cuts) - 1}


def _relabel_single(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    speakers = SpeakerMap()
    mapping = speakers.assign([seg.get("speaker") for seg in segments])
    return [{**seg, "speaker": mapping[seg.get("speaker")]} for seg in segments]
