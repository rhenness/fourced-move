import type { Color, PieceSymbol, Square } from 'chess.js';

export type Quality = 'Best' | 'Good' | 'Inaccurate' | 'Bad';

export type EngineScore =
  | { kind: 'cp'; value: number }
  | { kind: 'mate'; value: number };

export type EvaluatedMove = {
  uci: string;
  score: EngineScore;
  depth: number;
};

export type MoveOption = {
  id: string;
  uci: string;
  san: string;
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  description: string;
  quality: Quality;
  score: EngineScore;
};

export type Thresholds = {
  goodMax: number;
  inaccurateMax: number;
};

export type StoredTurn = {
  fen: string;
  options: MoveOption[];
};

export type StoredFailure = {
  option: MoveOption;
  score: number;
  options?: MoveOption[];
};

export type MoveStats = {
  best: number;
  good: number;
};

export type PersistedGame = {
  version: 1;
  pgn: string;
  orientation: Color;
  turn: StoredTurn | null;
  failure?: StoredFailure | null;
  stats?: MoveStats;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  goodMax: 50,
  inaccurateMax: 150,
};
