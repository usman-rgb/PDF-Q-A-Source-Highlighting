export interface UploadResponse {
  doc_id: string;
  filename: string;
  pages: number;
  chunks: number;
  message: string;
}

export interface StoredDocument extends UploadResponse {
  important: boolean;
  reviewed: boolean;
  created_at: string;
}

export interface DocumentRecord extends UploadResponse {
  file: File;
}

export interface SourceChunk {
  doc_id: string;
  filename: string;
  text: string;
  page: number;         // 0-indexed
  page_label: string;
  bbox: [number, number, number, number]; // [x0, y0, x1, y1] normalised 0-1
  chunk_index: number;
  score: number;
}

export interface QueryResponse {
  answer: string;
  sources: SourceChunk[];
  doc_id: string;
  doc_ids: string[];
  question: string;
  timestamp: string;
}

export interface InsightResponse {
  mode: "summary" | "key_points";
  answer: string;
  sources: SourceChunk[];
  doc_id: string;
  doc_ids: string[];
  timestamp: string;
}

export interface AppState {
  docId: string | null;
  filename: string | null;
  isUploading: boolean;
  isQuerying: boolean;
  currentPage: number;
  totalPages: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any | null;
  pendingHighlights: SourceChunk[];
  documents: DocumentRecord[];
  compareMode: boolean;
}
