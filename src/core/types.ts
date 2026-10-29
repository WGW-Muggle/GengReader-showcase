export type BookFormat = 'epub' | 'pdf';
export type BookStatus = 'queued' | 'parsing' | 'ready' | 'error' | 'deleted';
export type TaskStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Offsets are UTF-16 indices into the immutable, parsed text of this file version. */
export interface ReadingLocation {
  bookId: string;
  version: string;
  chapterId?: string;
  blockId?: string;
  offset: number;
  globalOffset: number;
  page?: number;
  quote?: string;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface ReadingProgress {
  bookId: string;
  location: ReadingLocation;
  maxReadOffset: number;
  percentage: number;
  revision: number;
  updatedAt: number;
  settings: Record<string, unknown>;
}

export interface ReaderBook {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  status: BookStatus;
  version: string;
  filename: string;
  size: number;
  language: string;
  coverUrl: string | null;
  chapterCount: number;
  pageCount: number;
  totalCharacters: number;
  /** Ordered location coordinate extent; PDF reserves fixed space for each page's future OCR. */
  positionExtent: number;
  scanned: boolean;
  warnings: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
  lastReadAt: number | null;
  progress: ReadingProgress | null;
}

export interface ReaderChapter {
  id: string;
  bookId: string;
  title: string;
  index: number;
  href: string;
  pageStart: number | null;
  pageEnd: number | null;
  startOffset: number;
  endOffset: number;
  source: 'epub' | 'bookmark' | 'inferred' | 'manual';
}

export interface ReaderBlock {
  id: string;
  bookId: string;
  chapterId: string;
  order: number;
  text: string;
  html: string;
  originalStartOffset?: number;
  page: number | null;
  startOffset: number;
  endOffset: number;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface ReaderAnnotation {
  id: string;
  bookId: string;
  kind: 'note' | 'highlight' | 'bookmark';
  text: string;
  quote: string;
  color: string;
  location: ReadingLocation;
  endLocation?: ReadingLocation;
  source: 'user' | 'ai';
  sourceEnd: number;
  discussionId: string | null;
  nodeId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReaderScope {
  type: 'selection' | 'chapter' | 'chapters' | 'read' | 'book' | 'pages';
  chapterId?: string;
  chapterIds?: string[];
  pageStart?: number;
  pageEnd?: number;
  start?: ReadingLocation;
  end?: ReadingLocation;
  includeUnread?: boolean;
}

export interface ScopeResult {
  book: ReaderBook;
  blocks: ReaderBlock[];
  scope: ReaderScope;
  maxReadOffset: number;
  totalCharacters: number;
  includesUnread: boolean;
  coverage: {
    parsedBlocks: number;
    selectedBlocks: number;
    scannedPages: number;
    complete: boolean;
  };
}

export interface ReaderTask {
  id: string;
  userId: string;
  bookId: string | null;
  kind: string;
  status: TaskStatus;
  progress: number;
  message: string;
  input: Record<string, unknown>;
  result: unknown;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskContext {
  task: ReaderTask;
  signal: AbortSignal;
  checkpoint(
    progress: number,
    message?: string,
    result?: unknown
  ): Promise<void>;
  throwIfCancelled(): Promise<void>;
}
export type TaskHandler = (context: TaskContext) => Promise<unknown>;

export type ApiResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: { code: string; message: string } };
