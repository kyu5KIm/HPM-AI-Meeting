from __future__ import annotations

from fastapi import HTTPException, UploadFile


async def read_upload(file: UploadFile, max_mb: int) -> bytes:
    """업로드를 읽는다. 한도를 넘으면 메모리에 다 올리기 전에 413으로 거절한다."""
    limit = max_mb * 1024 * 1024
    too_large = HTTPException(status_code=413, detail=f"Uploaded file is larger than {max_mb}MB: {file.filename or ''}")
    if file.size is not None and file.size > limit:
        raise too_large
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise too_large
    return content
