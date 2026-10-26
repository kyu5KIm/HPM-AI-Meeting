from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parent))

from term_correction import apply_stt_term_corrections, get_active_term_rules


class SttTermCorrectionTests(unittest.TestCase):
    def test_corrects_safe_ai_and_infra_terms(self) -> None:
        corrected, corrections = apply_stt_term_corrections("알에이지 검색은 큐드란트와 에스쓰리를 사용합니다.")

        self.assertIn("RAG", corrected)
        self.assertIn("Qdrant", corrected)
        self.assertIn("S3", corrected)
        self.assertGreaterEqual(len(corrections), 3)

    def test_skips_ambiguous_pm_term_by_default(self) -> None:
        corrected, corrections = apply_stt_term_corrections("PM이 스코프를 다시 확인했습니다.")

        self.assertEqual("PM이 스코프를 다시 확인했습니다.", corrected)
        self.assertEqual([], corrections)

    def test_does_not_replace_single_syllable_korean_alias_inside_words(self) -> None:
        corrected, corrections = apply_stt_term_corrections("연락 주세요.")

        self.assertEqual("연락 주세요.", corrected)
        self.assertEqual([], corrections)

    def test_does_not_translate_common_korean_terms_by_default(self) -> None:
        corrected, corrections = apply_stt_term_corrections("회의록과 요구사항을 정리합니다.")

        self.assertEqual("회의록과 요구사항을 정리합니다.", corrected)
        self.assertEqual([], corrections)

    def test_active_rules_are_loaded_from_glossary(self) -> None:
        aliases = {rule.alias for rule in get_active_term_rules()}

        self.assertIn("알에이지", aliases)
        self.assertIn("큐드란트", aliases)
        self.assertNotIn("락", aliases)


if __name__ == "__main__":
    unittest.main()
