"""Qdrant 서버 없이 로컬 파일 Qdrant로 문서를 적재하고 rag_eval을 실행한다.

test_flow 코드는 그대로 두고, QdrantClient(...) 호출이 모두 하나의 로컬 인스턴스를 쓰도록 바꿔 끼운다.
Qdrant Cloud에 연결할 수 없을 때 평가용으로 쓴다. 로컬 모드는 payload 인덱스를 쓰지 않으므로 속도 측정용은 아니다.

사용 (test_flow 폴더에서, LOCAL_QDRANT_PATH로 저장 폴더 지정):
  python rag_eval/local_qdrant.py ingest . ../backend/hpm/media/documents/1 1
  RAG_DENSE_K=20 RAG_BM25_K=20 python rag_eval/local_qdrant.py eval . -- --eval-set rag_eval/eval_set.jsonl --label cand20 --project-id 1
  python rag_eval/local_qdrant.py peek .
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
mode, tf = sys.argv[1], Path(sys.argv[2]).resolve()
os.chdir(tf)
sys.path.insert(0, str(tf))

import qdrant_client  # noqa: E402

_Orig = qdrant_client.QdrantClient
_inst = None


class _LocalQdrant:
    """Every QdrantClient(...) call returns one shared local instance."""

    def __new__(cls, *args, **kwargs):
        global _inst
        if _inst is None:
            _inst = _Orig(path=os.environ["LOCAL_QDRANT_PATH"])
            _inst.close = lambda *a, **k: None
        return _inst


qdrant_client.QdrantClient = _LocalQdrant

import config  # noqa: E402,F401  loads .env

if mode == "ingest":
    docs, project_id = Path(sys.argv[3]), sys.argv[4]
    from document_ingest import ingest_pdf_chunks
    from internal_docs.service import _normalize_document_metadata

    work = Path(tempfile.mkdtemp(prefix="hpm_eval_ingest_"))
    pdf_dir = work / "pdf_data"
    pdf_dir.mkdir()
    for p in sorted(docs.iterdir()):
        if p.is_file():
            shutil.copy2(p, pdf_dir / p.name)
    metadata = _normalize_document_metadata({"project_id": str(project_id)})
    print("metadata:", metadata)
    result = ingest_pdf_chunks(pdf_dir, work / "parsed", work / "chunks", metadata,
                               collection=config.qdrant_collection_for_project(project_id))
    parser = result["parser"]
    print("parser:", {k: parser.get(k) for k in ("backend", "pdf_count", "success", "failed", "blocks", "elapsed_sec")})
    for r in parser.get("records", []):
        if r.get("status") != "success":
            print("  failed:", r.get("source_filename"), r.get("reason"))
    print("chunks:", len(result["chunks"]), "upserted:", result["upserted"])
    print("work dir:", work)
elif mode == "eval":
    import runpy
    i = sys.argv.index("--")
    sys.argv = ["rag_eval.run_eval"] + sys.argv[i + 1:]
    runpy.run_module("rag_eval.run_eval", run_name="__main__")
elif mode == "peek":
    c = qdrant_client.QdrantClient()
    for col in c.get_collections().collections:
        print(col.name, c.count(col.name, exact=True).count)
