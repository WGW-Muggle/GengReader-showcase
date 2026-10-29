import type { ReaderScope, ReadingLocation } from './types';

export interface ReaderModel {
  id: string;
  name: string;
  provider: 'openai-compatible' | 'anthropic';
  contextTokens: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}
export interface ReaderCitation {
  id: string;
  label: string;
  quote: string;
  location: ReadingLocation;
  endOffset: number;
}
export interface AnalysisCoverage {
  totalBlocks: number;
  completedBlocks: number;
  totalCharacters: number;
  completedCharacters: number;
  failedChunks: string[];
  missingPages: number;
  complete: boolean;
  totalChunks?: number;
  completedChunks?: number;
  attemptedChunks?: number;
  failures?: AnalysisFailure[];
  stopped?: {
    code: 'MODEL_FAILURE_CIRCUIT_OPEN';
    message: string;
    consecutiveFailures: number;
    unattemptedChunks: number;
  };
}
export interface AnalysisFailure {
  id: string;
  stage: 'request' | 'format' | 'identity' | 'storage' | 'unknown';
  code: string;
  message: string;
  chapterId?: string;
  blockCount?: number;
  characters?: number;
}
export interface ReaderSession {
  id: string;
  bookId: string;
  title: string;
  scope: ReaderScope;
  createdAt: number;
  updatedAt: number;
}
export interface ReaderMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'completed' | 'stopped' | 'failed';
  citations: ReaderCitation[];
  scope: ReaderScope;
  modelId: string | null;
  images?: ReaderChatImage[];
  modelName?: string;
  requestedModelId?: string;
  modelSwitched?: boolean;
  modelSwitchReason?: string;
  /** Elapsed time of observed provider reasoning, never its private content. */
  thinkingDurationMs?: number;
  createdAt: number;
}
export interface ReaderStreamActivity {
  phase: 'waiting' | 'thinking' | 'answering';
  startedAt: number;
  thinkingStartedAt?: number;
  thinkingDurationMs?: number;
}
export interface ReaderChatImage {
  id: string;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  url: string;
}
export interface MindMapNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  kind: 'source' | 'inference' | 'user';
  citations: ReaderCitation[];
  order: number;
  chapterId?: string;
  /** Maximum source reveal offset; derived on server, never trusted from input. */
  revealedAt: number;
  contextRanges?: Array<{ start: number; end: number }>;
}
export interface ReaderMindMap {
  id: string;
  bookId: string;
  title: string;
  status:
    'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  bookVersion: string;
  scope: ReaderScope;
  coverage: AnalysisCoverage;
  nodes: MindMapNode[];
  revision: number;
  userEdited: boolean;
  modelId: string;
  taskId: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface CharacterFact {
  text: string;
  citations: ReaderCitation[];
  kind: 'source' | 'inference' | 'user';
  revealedAt: number;
}
export interface ReaderCharacter {
  id: string;
  name: string;
  nameRevealedAt?: number;
  groupRevealedAt?: number;
  generationRevealedAt?: number;
  aliases: CharacterFact[];
  summary: CharacterFact[];
  appearance: CharacterFact[];
  personality: CharacterFact[];
  group: string;
  generation: number | null;
  firstAppearance: ReaderCitation | null;
  ambiguous: boolean;
  candidateIds: string[];
  identityConflicts?: CharacterIdentityConflict[];
  corrected: boolean;
  portrait?: {
    id: string;
    url: string;
    modelId: string;
    prompt: string;
    source: 'ai-imagined';
    version: number;
    revealedAt: number;
  };
}
export interface CharacterIdentityConflict {
  id: string;
  otherId: string;
  reason: string;
  leftCitations: ReaderCitation[];
  rightCitations: ReaderCitation[];
  revealedAt: number;
}
export interface CharacterRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description: string;
  citations: ReaderCitation[];
  revealedAt: number;
  kind: 'source' | 'inference' | 'user';
}
export interface CharacterAnalysis {
  id: string;
  bookId: string;
  status: ReaderMindMap['status'];
  bookVersion: string;
  scope: ReaderScope;
  coverage: AnalysisCoverage;
  characters: ReaderCharacter[];
  relations: CharacterRelation[];
  revision: number;
  taskId: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
