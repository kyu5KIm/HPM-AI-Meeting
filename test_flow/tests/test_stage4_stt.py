import base64
import io
import shutil
import subprocess
import wave

import pytest

import stt_long_audio as sla

needs_ffmpeg = pytest.mark.skipif(not sla.ffmpeg_available(), reason="ffmpeg not installed")

TONE, GAP, COUNT = 4.0, 1.0, 14  # 4초 발화 + 1초 무음 x 14 = 70초


@pytest.fixture(scope="module")
def meeting_audio(tmp_path_factory):
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    path = tmp_path_factory.mktemp("audio") / "meeting.webm"
    inputs, filters = [], []
    for i in range(COUNT):
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={300 + 40 * (i % 3)}:duration={TONE}",
                   "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=mono:d={GAP}"]
    concat = "".join(f"[{j}:a]" for j in range(COUNT * 2)) + f"concat=n={COUNT * 2}:v=0:a=1[out]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", concat, "-map", "[out]", "-c:a", "libopus", str(path)], check=True)
    return path


def truth():
    """발화 i는 [5i, 5i+4]초, 화자는 X, Y, Z 순환."""
    return [{"start": i * (TONE + GAP), "end": i * (TONE + GAP) + TONE, "who": "XYZ"[i % 3], "text": f"발화{i:02d}"} for i in range(COUNT)]


class FakeApi:
    """잘라낸 조각 구간에 걸치는 발화를 조각 기준 시간으로 돌려준다. 참고 화자가 오면 그 이름을 쓴다."""

    def __init__(self):
        self.windows = []
        self.calls = []
        self.who_by_name = {}

    def transcribe(self, path, names, refs):
        start, end = self.windows[len(self.calls)] if self.windows else (0.0, 70.0)
        self.calls.append({"path": path, "names": names, "refs": refs})
        letters = {}
        segments = []
        for utt in truth():
            if utt["end"] <= start or utt["start"] >= end:
                continue
            rel_start, rel_end = max(utt["start"], start) - start, min(utt["end"], end) - start
            known = [n for n in (names or []) if self.who_by_name.get(n) == utt["who"]]
            if not known and utt["who"] not in letters:
                letters[utt["who"]] = "ABC"[len(letters)]
            label = known[0] if known else letters[utt["who"]]
            segments.append({"speaker": label, "start": rel_start, "end": rel_end, "text": utt["text"]})
        return segments, " ".join(s["text"] for s in segments), "ko"


def spy_windows(monkeypatch, api):
    original = sla.extract_clip

    def extract(source, start, end, target, *, wav=False):
        if not wav:
            api.windows.append((start, end))
        return original(source, start, end, target, wav=wav)

    monkeypatch.setattr(sla, "extract_clip", extract)


def test_plan_cuts_prefers_silence():
    silences = [(9.0, 10.0), (19.2, 20.0), (29.0, 30.0)]
    assert sla.plan_cuts(35.0, 20.0, silences, 3.0) == [0.0, 19.6, 35.0]
    assert sla.plan_cuts(35.0, 20.0, [], 3.0) == [0.0, 20.0, 35.0]
    assert sla.plan_cuts(15.0, 20.0, silences, 3.0) == [0.0, 15.0]


def test_speaker_map_keeps_known_names():
    speakers = sla.SpeakerMap()
    first = speakers.assign(["A", "B", "A"])
    assert first == {"A": "SPEAKER_00", "B": "SPEAKER_01"}
    speakers.references["SPEAKER_00"] = "data:"
    second = speakers.assign(["SPEAKER_00", "A"])
    assert second == {"SPEAKER_00": "SPEAKER_00", "A": "SPEAKER_02"}


@needs_ffmpeg
def test_short_audio_is_sent_once(meeting_audio):
    api = FakeApi()
    result = sla.transcribe_long_audio(meeting_audio, api.transcribe, diarize=True, settings=sla.SttSettings(segment_sec=600))
    assert result["chunks"] == 1 and len(api.calls) == 1
    assert api.calls[0]["path"].endswith(".mp3")  # 모노·16kHz·저비트레이트로 줄인 파일을 보낸다
    assert [s["speaker"] for s in result["segments"][:3]] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"]


@needs_ffmpeg
def test_long_audio_is_split_merged_and_speakers_stay_consistent(meeting_audio, monkeypatch):
    api = FakeApi()
    spy_windows(monkeypatch, api)
    settings = sla.SttSettings(segment_sec=20.0, overlap_sec=4.0, silence_search_sec=3.0)

    original_collect = sla._collect_references

    def collect(speakers, segments, audio, work):
        original_collect(speakers, segments, audio, work)
        # 가짜 API가 참고 화자 이름 -> 실제 화자를 알 수 있게 첫 등장 발화로 연결한다.
        for name in speakers.references:
            seg = next(s for s in segments if s["speaker"] == name) if any(s["speaker"] == name for s in segments) else None
            if seg:
                api.who_by_name.setdefault(name, next(u["who"] for u in truth() if u["text"] == seg["text"]))

    monkeypatch.setattr(sla, "_collect_references", collect)
    result = sla.transcribe_long_audio(meeting_audio, api.transcribe, diarize=True, settings=settings)

    assert result["chunks"] >= 3
    # 경계는 무음(4~5초 사이 1초 공백) 가운데여야 한다.
    for start, _end in api.windows[1:]:
        cut = start + settings.overlap_sec / 2
        assert abs((cut % (TONE + GAP)) - (TONE + GAP / 2)) < 0.6, cut

    segs = result["segments"]
    assert [s["text"] for s in segs] == [u["text"] for u in truth()]  # 빠짐·중복 없음
    for seg, utt in zip(segs, truth()):
        assert seg["start"] == pytest.approx(utt["start"], abs=0.05)
        assert seg["end"] == pytest.approx(utt["end"], abs=0.05)

    # 같은 실제 화자는 회의 전체에서 같은 이름을 가진다.
    names_by_who = {}
    for seg, utt in zip(segs, truth()):
        names_by_who.setdefault(utt["who"], set()).add(seg["speaker"])
    assert all(len(names) == 1 for names in names_by_who.values()), names_by_who

    # 두 번째 조각부터 참고 화자(최대 4명, 2~10초 WAV)를 넘긴다.
    assert api.calls[0]["names"] is None
    later = api.calls[1]
    assert later["names"] and len(later["names"]) <= 4
    for ref in later["refs"]:
        assert ref.startswith("data:audio/wav;base64,")
        with wave.open(io.BytesIO(base64.b64decode(ref.split(",", 1)[1]))) as wav:
            assert 2.0 <= wav.getnframes() / wav.getframerate() <= 10.0


@needs_ffmpeg
def test_size_limit_forces_split(meeting_audio):
    api = FakeApi()
    settings = sla.SttSettings(segment_sec=600, max_upload_mb=0.1, speaker_references=False)
    result = sla.transcribe_long_audio(meeting_audio, api.transcribe, diarize=False, settings=settings)
    assert result["chunks"] >= 2 and len(api.calls) == result["chunks"]
    assert all(call["names"] is None for call in api.calls)


def test_model_runtime_passes_known_speakers(monkeypatch, tmp_path):
    import model_runtime as mr

    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"ID3")
    seen = {}

    class Transcriptions:
        def create(self, **kwargs):
            seen.update(kwargs)
            return {"segments": [{"speaker": "SPEAKER_00", "start": 1.5, "end": 3.0, "text": "안녕하세요"}], "text": "안녕하세요"}

    fake_client = type("C", (), {"audio": type("A", (), {"transcriptions": Transcriptions()})()})()
    monkeypatch.setattr(mr, "_client", lambda: fake_client)
    monkeypatch.setattr(mr, "STT_MODEL_ID", "gpt-4o-transcribe-diarize")
    segments, _text, _lang = mr._transcribe_once(str(audio), "ko", True, ["SPEAKER_00"], ["data:audio/wav;base64,AAA="])
    assert seen["response_format"] == "diarized_json" and seen["chunking_strategy"] == "auto"
    assert seen["extra_body"] == {"known_speaker_names": ["SPEAKER_00"], "known_speaker_references": ["data:audio/wav;base64,AAA="]}
    assert segments[0]["start"] == 1.5 and segments[0]["end"] == 3.0


@needs_ffmpeg
def test_transcribe_audio_file_end_to_end_shape(meeting_audio, monkeypatch):
    import model_runtime as mr

    api = FakeApi()
    monkeypatch.setattr(mr, "_transcribe_once", lambda path, lang, diarize, names=None, refs=None: api.transcribe(path, names, refs))
    monkeypatch.setenv("STT_SEGMENT_SEC", "600")
    out = mr.transcribe_audio_file(str(meeting_audio))
    assert out["segments"][0]["time"] == "[00:00]" and out["segments"][1]["time"] == "[00:05]"
    assert out["text"].splitlines()[0] == "SPEAKER_00: 발화00"
    assert out["chunks"] == 1
