import { act, fireEvent, render, screen } from '@testing-library/react';
import { Chess, type Move } from 'chess.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { describeMove, moveToUci } from './game/chess';
import type { EvaluatedMove, MoveOption, PersistedGame, StoredMoveReview } from './game/types';

const engine = vi.hoisted(() => ({ analyze: vi.fn(), dispose: vi.fn() }));
vi.mock('./engine/stockfish', () => ({
  StockfishAnalyzer: class { analyze = engine.analyze; dispose = engine.dispose; },
}));
vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { position: string; arrows: unknown[] } }) =>
    <div data-testid="board" data-fen={options.position} data-arrows={JSON.stringify(options.arrows)} />,
}));

function option(move: Move, value: number, quality: MoveOption['quality'] = 'Good'): MoveOption {
  return {
    id: moveToUci(move), uci: moveToUci(move), san: move.san,
    from: move.from, to: move.to, promotion: move.promotion,
    piece: move.piece, captured: move.captured, description: describeMove(move),
    quality, score: { kind: 'cp', value },
  };
}

function saveGame(sans = ['e4', 'e5', 'Nf3'], fen?: string, failed = true) {
  const chess = fen ? new Chess(fen) : new Chess();
  const reviews: StoredMoveReview[] = [];
  for (const [index, san] of sans.entries()) {
    const before = chess.fen();
    const legalMoves = chess.moves({ verbose: true });
    const move = chess.move(san);
    reviews.push({
      ply: index + 1, fen: before, playedUci: moveToUci(move),
      options: [option(move, 30 - index * 40, index === sans.length - 1 && failed ? 'Bad' : 'Good'),
        option(legalMoves.find((legal) => legal.san !== san)!, 80 - index * 20, 'Best')],
    });
  }
  const last = reviews.at(-1)!;
  const game: PersistedGame = {
    version: 1, pgn: chess.pgn(), orientation: 'w', turn: null,
    failure: failed ? { option: last.options[0], options: last.options, score: sans.length - 1 } : null,
    moveReviews: reviews, stats: { best: 0, good: sans.length - 1 }, streak: sans.length - 1,
  };
  localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
  return { chess, game, moves: chess.history({ verbose: true }) };
}

const closeResult = () => fireEvent.click(screen.getByRole('button', { name: 'Review position' }));
const boardFen = () => screen.getByTestId('board').getAttribute('data-fen');
const evaluations = (fen: string): EvaluatedMove[] => new Chess(fen).moves({ verbose: true }).map((move, index) => ({
  uci: moveToUci(move), score: { kind: 'cp', value: 100 - index * 10 }, depth: 12,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('fourced-move.visited.v1', 'true');
  engine.analyze.mockReset();
  engine.dispose.mockClear();
});

describe('completed game review', () => {
  it('shows all quality-colored arrows immediately on the played position', () => {
    const { game, moves } = saveGame();
    const legalMoves = new Chess(moves[2].before).moves({ verbose: true });
    const alternatives = legalMoves.filter((move) => moveToUci(move) !== moveToUci(moves[2])).slice(0, 3);
    const choices = [option(moves[2], -200, 'Bad'), option(alternatives[0], 100, 'Best'),
      option(alternatives[1], 80, 'Good'), option(alternatives[2], 0, 'Inaccurate')];
    game.moveReviews![2].options = choices;
    game.failure!.options = choices;
    localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
    render(<App />);
    closeResult();
    const expectedArrows = choices.map((choice, index) => ({
      startSquare: choice.from, endSquare: choice.to,
      color: ['#a95843', '#2f8a5c', '#477c9e', '#c28b26'][index],
    }));
    const arrows = () => JSON.parse(screen.getByTestId('board').getAttribute('data-arrows')!);
    expect(boardFen()).toBe(moves[2].after);
    expect(arrows()).toEqual(expectedArrows);
    const playedChoice = screen.getByLabelText(/Nf3, Bad, -2.00, played/);
    fireEvent.mouseEnter(playedChoice);
    expect(boardFen()).toBe(moves[2].after);
    expect(arrows()).toEqual(expectedArrows);
    fireEvent.mouseLeave(playedChoice);
    expect(boardFen()).toBe(moves[2].after);
    expect(arrows()).toEqual(expectedArrows);
    fireEvent.click(screen.getByRole('button', { name: 'Previous move' }));
    expect(boardFen()).toBe(moves[1].after);
    expect(arrows()).toHaveLength(2);
    expect(arrows()).toContainEqual({ startSquare: 'e7', endSquare: 'e5', color: '#477c9e' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to starting position' }));
    expect(arrows()).toHaveLength(0);
  });

  it('steps through saved positions and values without changing the saved game', () => {
    const { moves, game } = saveGame();
    render(<App />);
    closeResult();
    expect(boardFen()).toBe(moves[2].after);
    expect(screen.getByLabelText(/Nf3, Bad, -0.50, played/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next move' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Show played position' })).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('board').getAttribute('data-arrows')!)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous move' }));
    expect(boardFen()).toBe(moves[1].after);
    expect(screen.getByLabelText(/e5, Good, -0.10, played/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review 1... e5' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    expect(boardFen()).toBe(moves[0].after);
    expect(screen.getByLabelText(/e4, Good, \+0.30, played/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(boardFen()).toBe(moves[0].before);
    expect(screen.getByRole('button', { name: 'Previous move' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Preview move/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(boardFen()).toBe(moves[0].after);
    fireEvent.click(screen.getByRole('button', { name: 'Go to final position' }));
    expect(boardFen()).toBe(moves[2].after);
    expect(JSON.parse(localStorage.getItem('fourced-move.game.v1')!).pgn).toBe(game.pgn);
    expect(engine.analyze).not.toHaveBeenCalled();
  });

  it('keeps arrows and the played position visible when interacting with move values', () => {
    const { moves } = saveGame();
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    expect(boardFen()).toBe(moves[0].after);
    const choice = screen.getByLabelText(/e4, Good, \+0.30, played/);
    fireEvent.mouseEnter(choice);
    expect(boardFen()).toBe(moves[0].after);
    expect(screen.getByTestId('board').getAttribute('data-arrows')).toContain('e2');
    fireEvent.mouseLeave(choice);
    expect(boardFen()).toBe(moves[0].after);
    fireEvent.click(choice);
    expect(boardFen()).toBe(moves[0].after);
    fireEvent.blur(choice);
    expect(boardFen()).toBe(moves[0].after);
  });

  it('continues from the final position after reviewing an earlier move', async () => {
    const { chess } = saveGame();
    engine.analyze.mockResolvedValue(evaluations(chess.fen()));
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue from final position' }));
    await screen.findByRole('group', { name: 'Available moves' });
    expect(boardFen()).toBe(chess.fen());
    expect(engine.analyze.mock.calls[0][0]).toBe(chess.fen());
    expect(screen.queryByRole('button', { name: 'Previous move' })).not.toBeInTheDocument();
  });

  it('analyzes and caches missing history values in older saved games', async () => {
    const { game, moves } = saveGame();
    delete game.moveReviews;
    localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
    engine.analyze.mockResolvedValue(evaluations(moves[0].before));
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    await screen.findByLabelText(/e4, .*played/);
    expect(engine.analyze.mock.calls[0][0]).toBe(moves[0].before);
    expect(JSON.parse(localStorage.getItem('fourced-move.game.v1')!).moveReviews).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Go to final position' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    expect(engine.analyze).toHaveBeenCalledTimes(1);
  });

  it('includes a played move omitted from the initial engine analysis', async () => {
    const { game, moves } = saveGame();
    delete game.moveReviews;
    localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
    const playedUci = moveToUci(moves[0]);
    engine.analyze.mockResolvedValueOnce(evaluations(moves[0].before).filter((item) => item.uci !== playedUci))
      .mockResolvedValueOnce([{ uci: playedUci, score: { kind: 'cp', value: -200 }, depth: 12 }]);
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    await screen.findByLabelText(/e4, Bad, -2.00, played/);
    expect(engine.analyze.mock.calls[1][1]).toEqual([playedUci]);
  });

  it('discards stale analysis when the user steps to a different move', async () => {
    const { game, moves } = saveGame();
    delete game.moveReviews;
    localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
    let finish!: (value: EvaluatedMove[]) => void;
    engine.analyze.mockImplementation(() => new Promise<EvaluatedMove[]>((resolve) => { finish = resolve; }));
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to final position' }));
    await act(async () => finish(evaluations(moves[0].before)));
    expect(boardFen()).toBe(moves[2].after);
    expect(JSON.parse(localStorage.getItem('fourced-move.game.v1')!).moveReviews).toHaveLength(0);
  });

  it('allows retrying a historical move when its analysis fails', async () => {
    const { game, moves } = saveGame();
    delete game.moveReviews;
    localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
    engine.analyze.mockRejectedValueOnce(new Error('Engine failed'))
      .mockResolvedValueOnce(evaluations(moves[0].before));
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    await screen.findByText('Engine failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry move analysis' }));
    await screen.findByLabelText(/e4, .*played/);
    expect(engine.analyze).toHaveBeenCalledTimes(2);
  });

  it('clears review state when starting a new game', () => {
    saveGame();
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1. e4' }));
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.click(screen.getByRole('button', { name: /Standard/ }));
    expect(boardFen()).toBe(new Chess().fen());
    expect(screen.queryByRole('button', { name: 'Previous move' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('fourced-move.game.v1')!).moveReviews).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Available moves' })).toBeInTheDocument();
  });

  it('supports checkmate review with mate values', async () => {
    const { moves, game } = saveGame(['f3', 'e5', 'g4', 'Qh4#'], undefined, false);
    game.moveReviews!.at(-1)!.options[0].score = { kind: 'mate', value: 1 };
    localStorage.setItem('fourced-move.game.v1', JSON.stringify(game));
    render(<App />);
    await screen.findByRole('button', { name: 'Previous move' });
    expect(screen.getByText('Checkmate — Black wins')).toBeInTheDocument();
    expect(screen.getByLabelText(/Qh4#, Good, Mate in 1, played/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous move' }));
    expect(boardFen()).toBe(moves[2].after);
  });

  it('preserves move numbers and a Black start in custom positions', () => {
    const chess = new Chess();
    chess.move('e4');
    const fen = chess.fen().replace(/ 1$/, ' 22');
    const { moves } = saveGame(['e5', 'Nf3'], fen);
    render(<App />);
    closeResult();
    fireEvent.click(screen.getByRole('button', { name: 'Review 22... e5' }));
    expect(boardFen()).toBe(moves[0].after);
    fireEvent.click(screen.getByRole('button', { name: 'Go to starting position' }));
    expect(boardFen()).toBe(fen);
  });

  it('stores offered values when a game ends and restores them after reload', () => {
    const chess = new Chess();
    chess.move('e4');
    const choices = chess.moves({ verbose: true }).slice(0, 4).map((move, index) => option(move, -100 - index * 10, 'Bad'));
    localStorage.setItem('fourced-move.game.v1', JSON.stringify({
      version: 1, pgn: chess.pgn(), orientation: 'w', turn: { fen: chess.fen(), options: choices },
    }));
    const view = render(<App />);
    const choice = screen.getByRole('button', { name: /Option 1:/ });
    fireEvent.click(choice);
    fireEvent.click(choice);
    const stored = JSON.parse(localStorage.getItem('fourced-move.game.v1')!) as PersistedGame;
    expect(stored.moveReviews).toEqual([{ ply: 2, fen: chess.fen(), playedUci: choices[0].uci, options: choices }]);
    view.unmount();
    render(<App />);
    closeResult();
    expect(screen.getByLabelText(`${choices[0].san}, Bad, -1.00, played`)).toBeInTheDocument();
    expect(engine.analyze).not.toHaveBeenCalled();
  });
});
