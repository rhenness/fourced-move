import type { Move } from 'chess.js';
import { describeMove, moveToUci } from './chess';
import { classifyMoves, selectFour } from './classification';
import type { EvaluatedMove, MoveOption, StoredMoveReview } from './types';

export function moveLabel(move: Move): string {
  return `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ${move.san}`;
}

export function scoreLabel(option: Pick<MoveOption, 'score'>): string {
  if (option.score.kind === 'mate') {
    return option.score.value > 0
      ? `Mate in ${option.score.value}`
      : `Mated in ${Math.abs(option.score.value)}`;
  }
  const pawns = option.score.value / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function buildReview(
  move: Move,
  ply: number,
  legalMoves: Move[],
  evaluated: EvaluatedMove[],
): StoredMoveReview {
  const classified = classifyMoves(evaluated);
  const playedUci = moveToUci(move);
  const choices = selectFour(evaluated);
  const played = classified.find((option) => option.uci === playedUci);
  if (played && !choices.some((option) => option.uci === playedUci)) {
    choices.push(played);
  }
  const byUci = new Map(legalMoves.map((legalMove) => [moveToUci(legalMove), legalMove]));
  const options = choices.flatMap((result): MoveOption[] => {
    const legalMove = byUci.get(result.uci);
    if (!legalMove) return [];
    return [{
      id: result.uci,
      uci: result.uci,
      san: legalMove.san,
      from: legalMove.from,
      to: legalMove.to,
      promotion: legalMove.promotion,
      piece: legalMove.piece,
      captured: legalMove.captured,
      description: describeMove(legalMove),
      quality: result.quality,
      score: result.score,
    }];
  });
  return { ply, fen: move.before, playedUci, options };
}
