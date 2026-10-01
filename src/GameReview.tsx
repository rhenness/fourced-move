import { useEffect, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { Check } from 'lucide-react';
import { StockfishAnalyzer } from './engine/stockfish';
import { moveToUci } from './game/chess';
import { compareEvaluations } from './game/classification';
import { buildReview, scoreLabel } from './game/review';
import type { MoveOption, StoredMoveReview } from './game/types';

export const QUALITY_COLORS: Record<MoveOption['quality'], string> = {
  Best: '#2f8a5c',
  Good: '#477c9e',
  Inaccurate: '#c28b26',
  Bad: '#a95843',
};

type Props = {
  move: Move | undefined;
  ply: number;
  review: StoredMoveReview | undefined;
  onAnalyzed: (review: StoredMoveReview) => void;
};

export default function GameReview({ move, ply, review, onAnalyzed }: Props) {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError('');
    if (!move || review) return;
    const analyzer = new StockfishAnalyzer();
    const controller = new AbortController();
    const position = new Chess(move.before);
    const legalMoves = position.moves({ verbose: true });
    const playedUci = moveToUci(move);

    void (async () => {
      try {
        const evaluated = await analyzer.analyze(
          move.before, legalMoves.map(moveToUci), controller.signal,
        );
        // Older games have no saved choices. Include the played move even if
        // it was outside the engine's initial set of principal variations.
        if (!evaluated.some((option) => option.uci === playedUci)) {
          evaluated.push(...await analyzer.analyze(
            move.before, [playedUci], controller.signal,
          ));
        }
        if (!controller.signal.aborted) {
          onAnalyzed(buildReview(move, ply, legalMoves, evaluated));
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not analyze this move.');
        }
      } finally {
        analyzer.dispose();
      }
    })();

    return () => {
      controller.abort();
      analyzer.dispose();
    };
  }, [move, ply, review, attempt, onAnalyzed]);

  if (!move) {
    return <p className="review-note">Starting position. Select a move to see its values.</p>;
  }

  return (
    <div className="move-review" aria-label="Move quality review">
      {!review && !error && <p role="status" className="review-note">Analyzing this historical move…</p>}
      {error && <div role="alert" className="review-note">
        <p>{error}</p>
        <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry move analysis</button>
      </div>}
      {review && <>
        <div className="review-options">
          {[...review.options].sort(compareEvaluations).map((option) => {
            const wasPlayed = option.uci === review.playedUci;
            return (
              <div
                className={`review-option${wasPlayed ? ' played' : ''}`}
                key={option.id}
                aria-label={`${option.san}, ${option.quality}, ${scoreLabel(option)}${wasPlayed ? ', played' : ''}`}
                style={{ '--quality-color': QUALITY_COLORS[option.quality] } as React.CSSProperties}
              >
                <span className="review-swatch" aria-hidden="true" />
                <span className="review-move">
                  <strong>{option.san}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="review-value">
                  <span className="review-quality">{option.quality}</span>
                  <strong>{scoreLabel(option)}</strong>
                </span>
                {wasPlayed && <Check className="review-check" aria-label="Move played" strokeWidth={3} />}
              </div>
            );
          })}
        </div>
      </>}
    </div>
  );
}
