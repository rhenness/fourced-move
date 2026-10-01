import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { Chess, type Color, type Move } from 'chess.js';
import { Check } from 'lucide-react';
import { StockfishAnalyzer } from './engine/stockfish';
import { describeMove, gameStatus, moveToUci, playOfferedMove } from './game/chess';
import { selectFour, shuffle } from './game/classification';
import {
  DEFAULT_THRESHOLDS,
  type MoveOption,
  type PersistedGame,
  type StoredFailure,
  type StoredTurn,
  type Thresholds,
} from './game/types';
import './styles.css';

const GAME_KEY = 'fourced-move.game.v1';
const SETTINGS_KEY = 'fourced-move.settings.v1';
const VISITED_KEY = 'fourced-move.visited.v1';
const OPTION_COLORS = ['#c28b26', '#477c9e', '#a95843', '#785b96'];
const CONFIRM_COLOR = '#2f8a5c';

type Phase = 'loading' | 'ready' | 'revealed' | 'failed' | 'error' | 'finished';

function readGame(): PersistedGame | null {
  try {
    const value = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as PersistedGame | null;
    return value?.version === 1 ? value : null;
  } catch {
    return null;
  }
}

function readSettings(): Thresholds {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Thresholds> | null;
    const goodMax = Number(value?.goodMax);
    const inaccurateMax = Number(value?.inaccurateMax);
    if (goodMax >= 0 && inaccurateMax > goodMax) return { goodMax, inaccurateMax };
  } catch {
    // Fall through to defaults.
  }
  return DEFAULT_THRESHOLDS;
}

function isReturningVisitor(): boolean {
  try {
    return localStorage.getItem(VISITED_KEY) === 'true';
  } catch {
    return false;
  }
}

function restoreChess(pgn: string) {
  const chess = new Chess();
  if (pgn.trim()) chess.loadPgn(pgn);
  return chess;
}

function initialSession() {
  const saved = readGame();
  if (!saved) return { chess: new Chess(), orientation: 'w' as Color, turn: null, failure: null };
  try {
    return {
      chess: restoreChess(saved.pgn),
      orientation: saved.orientation === 'b' ? ('b' as Color) : ('w' as Color),
      turn: saved.turn,
      failure: saved.failure ?? null,
    };
  } catch {
    return { chess: new Chess(), orientation: 'w' as Color, turn: null, failure: null };
  }
}

function isStoredTurnValid(turn: StoredTurn | null, fen: string, legalMoves: Move[]): turn is StoredTurn {
  if (!turn || turn.fen !== fen || turn.options.length === 0) return false;
  const legal = new Set(legalMoves.map(moveToUci));
  return turn.options.every((option) => legal.has(option.uci));
}

function buildOptions(
  legalMoves: Move[],
  evaluated: Awaited<ReturnType<StockfishAnalyzer['analyze']>>,
  thresholds: Thresholds,
): MoveOption[] {
  const byUci = new Map(legalMoves.map((move) => [moveToUci(move), move]));
  return shuffle(selectFour(evaluated, thresholds).flatMap((result) => {
    const move = byUci.get(result.uci);
    if (!move) return [];
    return [{
      id: result.uci,
      uci: result.uci,
      san: move.san,
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
      piece: move.piece,
      ...(move.captured ? { captured: move.captured } : {}),
      description: describeMove(move),
      quality: result.quality,
      score: result.score,
    }];
  }));
}

function historyRows(moves: string[]): Array<{ number: number; white: string; black?: string }> {
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ number: i / 2 + 1, white: moves[i], ...(moves[i + 1] ? { black: moves[i + 1] } : {}) });
  }
  return rows;
}

function scoreLabel(option: MoveOption): string {
  if (option.score.kind === 'mate') {
    return option.score.value > 0 ? `Mate in ${option.score.value}` : `Mated in ${Math.abs(option.score.value)}`;
  }
  const pawns = option.score.value / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export default function App() {
  const session = useMemo(initialSession, []);
  const chessRef = useRef(session.chess);
  const analyzerRef = useRef(new StockfishAnalyzer());
  const activeAnalysisRef = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const [orientation, setOrientation] = useState<Color>(session.orientation);
  const [turn, setTurn] = useState<StoredTurn | null>(session.turn);
  const [phase, setPhase] = useState<Phase>(session.failure ? 'failed' : 'loading');
  const [failure, setFailure] = useState<StoredFailure | null>(session.failure);
  const [showHowToPlay, setShowHowToPlay] = useState(() => !isReturningVisitor());
  const [preview, setPreview] = useState<MoveOption | null>(null);
  const [selected, setSelected] = useState<MoveOption | null>(null);
  const [pendingChoice, setPendingChoice] = useState<MoveOption | null>(null);
  const [error, setError] = useState('');
  const [thresholds, setThresholds] = useState<Thresholds>(readSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chess = chessRef.current;
  const fen = chess.fen();
  const terminal = gameStatus(chess);
  const moves = chess.history();
  const rows = historyRows(moves);
  const lastMove = chess.history({ verbose: true }).at(-1);

  const dismissHowToPlay = () => {
    try {
      localStorage.setItem(VISITED_KEY, 'true');
    } catch {
      // The guide can still be dismissed when storage is unavailable.
    }
    setShowHowToPlay(false);
  };

  useEffect(() => () => {
    activeAnalysisRef.current?.abort();
    analyzerRef.current.dispose();
  }, []);

  useEffect(() => {
    const game: PersistedGame = {
      version: 1,
      pgn: chessRef.current.pgn(),
      orientation,
      turn,
      failure,
    };
    localStorage.setItem(GAME_KEY, JSON.stringify(game));
  }, [failure, orientation, revision, turn]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(thresholds));
  }, [thresholds]);

  useEffect(() => {
    if (!pendingChoice) return;

    const clearPendingChoice = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.move-option.pending')) return;
      setPendingChoice(null);
      setPreview(null);
    };

    document.addEventListener('pointerdown', clearPendingChoice);
    return () => document.removeEventListener('pointerdown', clearPendingChoice);
  }, [pendingChoice]);

  useEffect(() => {
    if (phase === 'revealed' || phase === 'failed') return;
    if (terminal) {
      setPhase('finished');
      setTurn(null);
      return;
    }

    const legalMoves = chessRef.current.moves({ verbose: true });
    if (isStoredTurnValid(turn, fen, legalMoves)) {
      setPhase('ready');
      return;
    }

    const controller = new AbortController();
    activeAnalysisRef.current?.abort();
    activeAnalysisRef.current = controller;
    setTurn(null);
    setSelected(null);
    setPendingChoice(null);
    setPreview(null);
    setError('');
    setPhase('loading');

    analyzerRef.current
      .analyze(fen, legalMoves.map(moveToUci), controller.signal)
      .then((evaluated) => {
        if (controller.signal.aborted || chessRef.current.fen() !== fen) return;
        const options = buildOptions(legalMoves, evaluated, thresholds);
        if (!options.length) throw new Error('No legal move choices were returned.');
        setTurn({ fen, options });
        setPhase('ready');
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'The chess engine could not analyze this position.');
        setPhase('error');
      });

    return () => controller.abort();
    // revision is the deliberate trigger after a move or reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, thresholds]);

  const playMove = (option: MoveOption) => {
    if (phase !== 'ready' || !turn) return;
    try {
      const score = chessRef.current.history().length;
      playOfferedMove(chessRef.current, option, turn.options, turn.fen);
      activeAnalysisRef.current?.abort();
      setSelected(option);
      setPendingChoice(null);
      setPreview(null);
      setTurn(null);
      setRevision((value) => value + 1);

      if (option.quality === 'Inaccurate' || option.quality === 'Bad') {
        setFailure({ option, score });
        setPhase('failed');
        return;
      }

      setPhase('revealed');
      window.setTimeout(() => {
        setPhase((current) => current === 'revealed' ? 'loading' : current);
        setRevision((value) => value + 1);
      }, 1_550);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That move could not be played.');
      setPhase('error');
    }
  };

  const chooseMove = (option: MoveOption) => {
    if (phase !== 'ready') return;
    if (pendingChoice?.uci === option.uci) {
      playMove(option);
      return;
    }
    setPendingChoice(option);
    setPreview(null);
  };

  const newGame = () => {
    activeAnalysisRef.current?.abort();
    chessRef.current = new Chess();
    setTurn(null);
    setSelected(null);
    setFailure(null);
    setPendingChoice(null);
    setPreview(null);
    setError('');
    setPhase('loading');
    setRevision((value) => value + 1);
  };

  useEffect(() => {
    if (!failure) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') newGame();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [failure]);

  useEffect(() => {
    if (!showHowToPlay) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissHowToPlay();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [showHowToPlay]);

  const retry = () => {
    analyzerRef.current.dispose();
    setError('');
    setPhase('loading');
    setRevision((value) => value + 1);
  };

  const previewMove = pendingChoice ?? preview ?? (phase === 'revealed' ? selected : null);
  const previewIndex = turn?.options.findIndex((option) => option.uci === previewMove?.uci) ?? -1;
  const previewColor = pendingChoice?.uci === previewMove?.uci
    ? CONFIRM_COLOR
    : OPTION_COLORS[Math.max(0, previewIndex) % OPTION_COLORS.length];
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: 'rgba(209, 184, 116, 0.34)' };
    squareStyles[lastMove.to] = { background: 'rgba(209, 184, 116, 0.48)' };
  }
  if (previewMove) {
    squareStyles[previewMove.from] = { boxShadow: `inset 0 0 0 5px ${previewColor}` };
    squareStyles[previewMove.to] = { boxShadow: `inset 0 0 0 5px ${previewColor}` };
  }

  const boardOptions: ChessboardOptions = {
    id: 'fourced-move-board',
    position: fen,
    boardOrientation: orientation === 'w' ? 'white' : 'black',
    allowDragging: false,
    allowDrawingArrows: false,
    showNotation: true,
    animationDurationInMs: 220,
    darkSquareStyle: { backgroundColor: '#41665b' },
    lightSquareStyle: { backgroundColor: '#e9e3d4' },
    boardStyle: { borderRadius: '6px', boxShadow: '0 22px 55px rgba(4, 12, 10, .28)' },
    squareStyles,
    arrows: phase === 'ready' && turn
      ? turn.options.map((option, index) => ({
          startSquare: option.from,
          endSquare: option.to,
          color: pendingChoice?.uci === option.uci ? CONFIRM_COLOR : OPTION_COLORS[index % OPTION_COLORS.length],
        }))
      : [],
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#game" aria-label="Fourced Move home">
          <span className="brand-mark" aria-hidden="true">4</span>
          <span><strong>Fourced</strong> Move</span>
        </a>
        <div className="top-actions">
          <button className="text-button" type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>
            Tuning
          </button>
          <button className="text-button" type="button" onClick={() => setOrientation((color) => color === 'w' ? 'b' : 'w')}>
            <span aria-hidden="true">↻</span> Flip board
          </button>
          <button className="primary-small" type="button" onClick={newGame}>New game</button>
        </div>
      </header>

      {settingsOpen && (
        <section className="settings-panel" aria-label="Classification tuning">
          <div>
            <strong>Classification thresholds</strong>
            <p>Centipawns lost compared with the engine’s best move.</p>
          </div>
          <label>
            Good, up to
            <input type="number" min="0" max={thresholds.inaccurateMax - 1} value={thresholds.goodMax}
              onChange={(event) => setThresholds((current) => ({ ...current, goodMax: Number(event.target.value) }))} />
          </label>
          <label>
            Inaccurate, up to
            <input type="number" min={thresholds.goodMax + 1} value={thresholds.inaccurateMax}
              onChange={(event) => setThresholds((current) => ({ ...current, inaccurateMax: Number(event.target.value) }))} />
          </label>
        </section>
      )}

      <section id="game" className="game-layout">
        <div className="board-column">
          <div className="player-strip opponent">
            <span className={`color-dot ${orientation === 'w' ? 'black' : 'white'}`} />
            {orientation === 'w' ? 'Black' : 'White'}
          </div>
          <div className="board-wrap"><Chessboard options={boardOptions} /></div>
          <div className="player-strip">
            <span className={`color-dot ${orientation === 'w' ? 'white' : 'black'}`} />
            {orientation === 'w' ? 'White' : 'Black'}
            <span
              className="move-count"
              role="status"
              aria-live="polite"
              aria-label={`Score: ${failure?.score ?? moves.length} ${(failure?.score ?? moves.length) === 1 ? 'move' : 'moves'} made`}
            >
              <span>Score</span>
              <strong>{failure?.score ?? moves.length}</strong>
            </span>
          </div>
        </div>

        <aside className="play-panel">
          <div className="options-area" aria-live="polite" aria-busy={phase === 'loading'}>
            {phase === 'loading' && (
              <div className="thinking">
                <span className="thinking-icon" aria-hidden="true"><i /><i /><i /></span>
                <div><strong>Finding your four moves…</strong><span>Stockfish is weighing the position.</span></div>
              </div>
            )}

            {phase === 'error' && (
              <div className="engine-error" role="alert">
                <strong>Engine unavailable</strong>
                <p>{error}</p>
                <button className="primary-small" type="button" onClick={retry}>Retry analysis</button>
              </div>
            )}

            {phase === 'finished' && (
              <div className="finished-card">
                <span aria-hidden="true">♟</span>
                <p>{terminal}</p>
                <button className="primary-small" type="button" onClick={newGame}>Play again</button>
              </div>
            )}

            {phase === 'revealed' && selected && (
              <div className={`reveal-card quality-${selected.quality.toLowerCase()}`}>
                <span className="reveal-kicker">You played {selected.san}</span>
                <strong>{selected.quality}</strong>
                <span>{scoreLabel(selected)} · Next choices incoming…</span>
              </div>
            )}

            {phase === 'ready' && turn && (
              <div className="move-picker">
                <div className="move-options" role="group" aria-label="Available moves">
                  {turn.options.map((option, index) => (
                    <button
                      className={`move-option${pendingChoice?.uci === option.uci ? ' pending' : ''}`}
                      type="button"
                      key={option.id}
                      onClick={() => chooseMove(option)}
                      onMouseEnter={() => setPreview(option)}
                      onMouseLeave={() => setPreview(null)}
                      onFocus={() => setPreview(option)}
                      onBlur={() => setPreview(null)}
                      aria-pressed={pendingChoice?.uci === option.uci}
                      aria-label={pendingChoice?.uci === option.uci
                        ? `Confirm ${option.san}. Tap again to play this move.`
                        : `Option ${index + 1}: ${option.san}, ${option.description}. Tap twice to play.`}
                      style={{ '--option-color': OPTION_COLORS[index % OPTION_COLORS.length] } as React.CSSProperties}
                    >
                      {pendingChoice?.uci === option.uci && <Check className="selection-check" aria-hidden="true" strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="history-section">
            <div className="section-title"><span>Move history</span><small>{moves.length} {moves.length === 1 ? 'ply' : 'plies'}</small></div>
            <div className="history-list" tabIndex={0} aria-label="Move history">
              {rows.length === 0 ? (
                <p className="empty-history">Your game starts here.</p>
              ) : rows.map((row) => (
                <div className="history-row" key={row.number}>
                  <span>{row.number}.</span><strong>{row.white}</strong><strong>{row.black ?? ''}</strong>
                </div>
              ))}
            </div>
          </div>

          <p className="rules-note"><span aria-hidden="true">◇</span> Four legal moves. One decision. Qualities stay hidden until you commit.</p>
        </aside>
      </section>
      {showHowToPlay && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) dismissHowToPlay();
          }}
        >
          <section className="score-modal how-to-modal" role="dialog" aria-modal="true" aria-labelledby="how-to-title">
            <button className="modal-close" type="button" onClick={dismissHowToPlay} aria-label="Close how to play">×</button>
            <span className="modal-kicker">Welcome to Fourced Move</span>
            <h2 id="how-to-title">How to play</h2>
            <ol className="how-to-steps">
              <li>Match a colored square to its arrow on the board.</li>
              <li>Tap once to select it, then tap the green square to confirm.</li>
              <li>Best and Good moves add to your score. Inaccurate or Bad moves end the game.</li>
            </ol>
            <button className="primary-small" type="button" onClick={dismissHowToPlay} autoFocus>Start playing</button>
          </section>
        </div>
      )}
      {failure && !showHowToPlay && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) newGame();
          }}
        >
          <section className="score-modal" role="dialog" aria-modal="true" aria-labelledby="score-modal-title">
            <button className="modal-close" type="button" onClick={newGame} aria-label="Close and start a new game">×</button>
            <span className="modal-kicker">Game over</span>
            <h2 id="score-modal-title">{failure.option.quality} move</h2>
            <span className="modal-score-label">Your score</span>
            <strong className="modal-score">{failure.score}</strong>
            <button className="primary-small" type="button" onClick={newGame}>Start a new game</button>
          </section>
        </div>
      )}
      <footer>Analysis runs privately in your browser. Games save automatically.</footer>
    </main>
  );
}
