export type PreparationSourceLike = {
  document_id?: number | string | null;
  title?: string | null;
  file_url?: string | null;
};

export function dedupePreparationSources<T extends PreparationSourceLike>(sources?: T[] | null): T[] {
  if (!sources?.length) return [];

  const byKey = new Map<string, T>();
  for (const source of sources) {
    const documentId = source.document_id;
    const key =
      documentId !== undefined && documentId !== null && String(documentId).trim() !== ""
        ? `document:${documentId}`
        : `fallback:${source.file_url || source.title || ""}`;

    if (!byKey.has(key)) {
      byKey.set(key, source);
    }
  }

  return Array.from(byKey.values());
}
