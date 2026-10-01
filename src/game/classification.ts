import type { EngineScore, EvaluatedMove, Quality, Thresholds } from './types';
import { DEFAULT_THRESHOLDS } from './types';

const MATE_VALUE = 100_000;

export function scoreUtility(score: EngineScore): number {
  if (score.kind === 'cp') return score.value;
  return score.value > 0
    ? MATE_VALUE - score.value
    : -MATE_VALUE - score.value;
}

export function compareEvaluations(a: EvaluatedMove, b: EvaluatedMove): number {
  return scoreUtility(b.score) - scoreUtility(a.score);
}

export function classifyScore(
  score: EngineScore,
  best: EngineScore,
  isBestMove: boolean,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Quality {
  if (isBestMove) return 'Best';

  if (best.kind === 'cp' && score.kind === 'cp') {
    const loss = Math.max(0, best.value - score.value);
    if (loss <= thresholds.goodMax) return 'Good';
    if (loss <= thresholds.inaccurateMax) return 'Inaccurate';
    return 'Bad';
  }

  if (best.kind === 'mate' && best.value > 0) {
    return score.kind === 'mate' && score.value > 0 ? 'Good' : 'Bad';
  }

  if (best.kind === 'mate' && best.value < 0 && score.kind === 'mate' && score.value < 0) {
    const lostSurvivalPly = Math.max(0, Math.abs(best.value) - Math.abs(score.value));
    if (lostSurvivalPly === 0) return 'Good';
    if (lostSurvivalPly <= 2) return 'Inaccurate';
    return 'Bad';
  }

  if (best.kind === 'cp' && score.kind === 'mate' && score.value < 0) return 'Bad';
  return 'Good';
}

export type ClassifiedEvaluation = EvaluatedMove & { quality: Quality };

export function classifyMoves(
  evaluations: EvaluatedMove[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ClassifiedEvaluation[] {
  if (evaluations.length === 0) return [];
  const ranked = [...evaluations].sort(compareEvaluations);
  const best = ranked[0];
  return ranked.map((move, index) => ({
    ...move,
    quality: classifyScore(move.score, best.score, index === 0, thresholds),
  }));
}

function categoryComfort(
  move: ClassifiedEvaluation,
  best: ClassifiedEvaluation,
  thresholds: Thresholds,
): number {
  if (move.score.kind === 'cp' && best.score.kind === 'cp' && move.quality !== 'Best') {
    const preferredLoss: Record<Exclude<Quality, 'Best'>, number> = {
      Good: thresholds.goodMax / 2,
      Inaccurate: (thresholds.goodMax + thresholds.inaccurateMax) / 2,
      Bad: thresholds.inaccurateMax + 100,
    };
    return Math.abs(best.score.value - move.score.value - preferredLoss[move.quality]);
  }
  return Math.abs(scoreUtility(best.score) - scoreUtility(move.score));
}

export function selectFour(
  evaluations: EvaluatedMove[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ClassifiedEvaluation[] {
  const classified = classifyMoves(evaluations, thresholds);
  if (classified.length <= 4) return classified;

  const best = classified[0];
  const selected = [best];
  const desired: Exclude<Quality, 'Best'>[] = ['Good', 'Inaccurate', 'Bad'];

  for (const quality of desired) {
    const candidate = classified
      .filter((move) => move.quality === quality && !selected.includes(move))
      .sort((a, b) => categoryComfort(a, best, thresholds) - categoryComfort(b, best, thresholds))[0];
    if (candidate) selected.push(candidate);
  }

  const remaining = classified.filter((move) => !selected.includes(move));
  while (selected.length < 4 && remaining.length > 0) {
    const index = selected.length === 1 ? remaining.length - 1 : Math.floor((remaining.length - 1) / 2);
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected;
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
