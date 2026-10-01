import { Chess, type Move, type PieceSymbol } from 'chess.js';
import type { MoveOption } from './types';

const pieceNames: Record<PieceSymbol, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

export function moveToUci(move: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function describeMove(move: Move): string {
  if (move.isKingsideCastle()) return 'Castle kingside';
  if (move.isQueensideCastle()) return 'Castle queenside';

  let detail = `${pieceNames[move.piece]} ${move.from}`;
  if (move.isCapture() || move.isEnPassant()) {
    detail += ` captures on ${move.to}`;
    if (move.isEnPassant()) detail += ' en passant';
  } else {
    detail += ` to ${move.to}`;
  }
  if (move.promotion) detail += `, promotes to ${pieceNames[move.promotion]}`;
  if (move.san.endsWith('#')) detail += ', checkmate';
  else if (move.san.endsWith('+')) detail += ', check';
  return detail;
}

export function createChess(pgn = ''): Chess {
  const chess = new Chess();
  if (pgn.trim()) chess.loadPgn(pgn);
  return chess;
}

export function playOfferedMove(
  chess: Chess,
  option: MoveOption,
  offered: MoveOption[],
  optionsFen: string,
): Move {
  if (chess.fen() !== optionsFen) throw new Error('These choices belong to an earlier position.');
  if (!offered.some((move) => move.uci === option.uci)) {
    throw new Error('That move was not one of the offered choices.');
  }
  return chess.move({
    from: option.from,
    to: option.to,
    promotion: option.promotion,
  });
}

export function gameStatus(chess: Chess): string | null {
  if (chess.isCheckmate()) {
    return `Checkmate — ${chess.turn() === 'w' ? 'Black' : 'White'} wins`;
  }
  if (chess.isStalemate()) return 'Draw by stalemate';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition';
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (chess.isDrawByFiftyMoves()) return 'Draw by the fifty-move rule';
  if (chess.isDraw()) return 'Draw';
  return null;
}
