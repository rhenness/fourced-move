import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard, type ChessboardOptions } from "react-chessboard";
import { Chess, type Color, type Move } from "chess.js";
import { Check } from "lucide-react";
import { StockfishAnalyzer } from "./engine/stockfish";
import {
  describeMove,
  gameStatus,
  moveToUci,
  playOfferedMove,
} from "./game/chess";
import { selectFour, shuffle } from "./game/classification";
import {
  DEFAULT_THRESHOLDS,
  type MoveStats,
  type MoveOption,
  type PersistedGame,
  type StoredFailure,
  type StoredTurn,
  type Thresholds,
} from "./game/types";
import "./styles.css";

const GAME_KEY = "fourced-move.game.v1";
const VISITED_KEY = "fourced-move.visited.v1";
const OPTION_COLORS = ["#c28b26", "#477c9e", "#a95843", "#785b96"];
const CONFIRM_COLOR = "#2f8a5c";
const QUALITY_COLORS: Record<MoveOption["quality"], string> = {
  Best: "#2f8a5c",
  Good: "#477c9e",
  Inaccurate: "#c28b26",
  Bad: "#a95843",
};
const RANDOM_POSITIONS = [
  "2r2k1r/p2q1ppp/1pNnpb2/8/1P6/P3PQ2/5PPP/1RB2RK1 w - - 7 22",
  "3q1rk1/5p1p/6p1/1Q1p1n2/8/r3PB2/5PPP/2R2RK1 w - - 0 21",
  "3r4/pp2q1kp/6p1/2P1Nb2/5P2/PQ6/1P4PP/3r1RK1 w - - 0 29",
  "r1b2rk1/pp3ppp/1q1p1n2/2p5/1PPNP3/2Q5/P3BPPP/R4RK1 w - - 0 17",
  "2rqr1k1/1b1nbpp1/p1n1p2p/1pppP2P/P4B2/3P1NP1/1PP2PBN/R2QR1K1 w - - 0 16",
  "r3r1k1/2q1bppp/p7/1pp5/3n1P2/1P1PpNP1/PB2P2P/R2QR1K1 w - - 2 21",
  "r4rk1/1p3ppp/2p1p3/qpPpPn2/2nP4/P1P2N2/5PPP/R1BQ1RK1 w - - 1 17",
  "3q1rk1/3b3p/3Qp1pP/P2pP3/3Pp3/4P3/4r1P1/R3K2R w K - 0 27",
  "2kr1b1r/ppp3pp/5q2/3p1b2/3Pn3/4P2P/PP1NBPP1/R1BQK2R w KQ - 1 12",
  "7r/1r2ppk1/p2p1bp1/8/1PP1P1q1/P5P1/6QP/1RBR2K1 w - - 3 24",
  "r3k2r/ppp2pp1/3p2qp/8/2P1P1b1/3B3P/P1P2P2/R1Q2RK1 w kq - 0 17",
  "r3k2r/ppp1bppb/1N2p2p/4P3/8/2P2NP1/PP2RPBP/2Rq2K1 w kq - 0 16",
  "2b3k1/1ppq1ppp/3p4/2br2BQ/1p5P/5N2/1PPK1PP1/r2R1B1R w - - 0 18",
  "r1b1r1k1/ppq2pbp/2p3p1/3nn3/8/2P2NP1/PPQN1PBP/R1B1R1K1 w - - 0 14",
  "r2q1rk1/1p1b1ppp/p1nppn2/8/3P4/P3PN2/1P2BPPP/R1BQ1RK1 w - - 0 11",
  "3r1r2/2pbq1bk/1p1p3p/p2P1pp1/2PNp3/PP2P1P1/3Q1PBP/3R1RK1 w - - 2 21",
  "r2q1rk1/p2n1ppp/2pbp3/2pp1b2/N7/1P2P3/PBPPBPPP/R2Q1RK1 w - - 4 11",
] as const;

type Phase = "loading" | "ready" | "revealed" | "failed" | "error" | "finished";

function readGame(): PersistedGame | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(GAME_KEY) ?? "null",
    ) as PersistedGame | null;
    return value?.version === 1 ? value : null;
  } catch {
    return null;
  }
}

function isReturningVisitor(): boolean {
  try {
    return localStorage.getItem(VISITED_KEY) === "true";
  } catch {
    return false;
  }
}

function restoreChess(pgn: string) {
  const chess = new Chess();
  if (pgn.trim()) chess.loadPgn(pgn);
  return chess;
}

function createChess(fen?: string) {
  const chess = fen ? new Chess(fen) : new Chess();
  if (fen) {
    chess.setHeader("SetUp", "1");
    chess.setHeader("FEN", fen);
  }
  return chess;
}

function initialSession() {
  const saved = readGame();
  if (!saved)
    return {
      chess: new Chess(),
      orientation: "w" as Color,
      turn: null,
      failure: null,
      stats: { best: 0, good: 0 },
    };
  try {
    return {
      chess: restoreChess(saved.pgn),
      orientation: saved.orientation === "b" ? ("b" as Color) : ("w" as Color),
      turn: saved.turn,
      failure: saved.failure ?? null,
      stats: saved.stats ?? { best: 0, good: 0 },
    };
  } catch {
    return {
      chess: new Chess(),
      orientation: "w" as Color,
      turn: null,
      failure: null,
      stats: { best: 0, good: 0 },
    };
  }
}

function isStoredTurnValid(
  turn: StoredTurn | null,
  fen: string,
  legalMoves: Move[],
): turn is StoredTurn {
  if (!turn || turn.fen !== fen || turn.options.length === 0) return false;
  const legal = new Set(legalMoves.map(moveToUci));
  return turn.options.every((option) => legal.has(option.uci));
}

function buildOptions(
  legalMoves: Move[],
  evaluated: Awaited<ReturnType<StockfishAnalyzer["analyze"]>>,
  thresholds: Thresholds,
): MoveOption[] {
  const byUci = new Map(legalMoves.map((move) => [moveToUci(move), move]));
  return shuffle(
    selectFour(evaluated, thresholds).flatMap((result) => {
      const move = byUci.get(result.uci);
      if (!move) return [];
      return [
        {
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
        },
      ];
    }),
  );
}

function historyRows(
  moves: string[],
): Array<{ number: number; white: string; black?: string }> {
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      number: i / 2 + 1,
      white: moves[i],
      ...(moves[i + 1] ? { black: moves[i + 1] } : {}),
    });
  }
  return rows;
}

function scoreLabel(option: MoveOption): string {
  if (option.score.kind === "mate") {
    return option.score.value > 0
      ? `Mate in ${option.score.value}`
      : `Mated in ${Math.abs(option.score.value)}`;
  }
  const pawns = option.score.value / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export default function App() {
  const session = useMemo(initialSession, []);
  const chessRef = useRef(session.chess);
  const analyzerRef = useRef(new StockfishAnalyzer());
  const activeAnalysisRef = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const [orientation, setOrientation] = useState<Color>(session.orientation);
  const [turn, setTurn] = useState<StoredTurn | null>(session.turn);
  const [phase, setPhase] = useState<Phase>(
    session.failure ? "failed" : "loading",
  );
  const [failure, setFailure] = useState<StoredFailure | null>(session.failure);
  const [showFailureModal, setShowFailureModal] = useState(
    Boolean(session.failure),
  );
  const [showNewGamePicker, setShowNewGamePicker] = useState(false);
  const [moveStats, setMoveStats] = useState<MoveStats>(session.stats);
  const [showHowToPlay, setShowHowToPlay] = useState(
    () => !isReturningVisitor(),
  );
  const [preview, setPreview] = useState<MoveOption | null>(null);
  const [selected, setSelected] = useState<MoveOption | null>(null);
  const [pendingChoice, setPendingChoice] = useState<MoveOption | null>(null);
  const [error, setError] = useState("");
  const chess = chessRef.current;
  const fen = chess.fen();
  const terminal = gameStatus(chess);
  const moves = chess.history();
  const rows = historyRows(moves);
  const lastMove = chess.history({ verbose: true }).at(-1);

  const dismissHowToPlay = () => {
    try {
      localStorage.setItem(VISITED_KEY, "true");
    } catch {
      // The guide can still be dismissed when storage is unavailable.
    }
    setShowHowToPlay(false);
  };

  useEffect(
    () => () => {
      activeAnalysisRef.current?.abort();
      analyzerRef.current.dispose();
    },
    [],
  );

  useEffect(() => {
    const game: PersistedGame = {
      version: 1,
      pgn: chessRef.current.pgn(),
      orientation,
      turn,
      failure,
      stats: moveStats,
    };
    localStorage.setItem(GAME_KEY, JSON.stringify(game));
  }, [failure, moveStats, orientation, revision, turn]);

  useEffect(() => {
    if (!pendingChoice) return;

    const clearPendingChoice = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".move-option.pending"))
        return;
      setPendingChoice(null);
      setPreview(null);
    };

    document.addEventListener("pointerdown", clearPendingChoice);
    return () =>
      document.removeEventListener("pointerdown", clearPendingChoice);
  }, [pendingChoice]);

  useEffect(() => {
    if (phase === "revealed" || phase === "failed") return;
    if (terminal) {
      setPhase("finished");
      setTurn(null);
      return;
    }

    const legalMoves = chessRef.current.moves({ verbose: true });
    if (isStoredTurnValid(turn, fen, legalMoves)) {
      setPhase("ready");
      return;
    }

    const controller = new AbortController();
    activeAnalysisRef.current?.abort();
    activeAnalysisRef.current = controller;
    setTurn(null);
    setSelected(null);
    setPendingChoice(null);
    setPreview(null);
    setError("");
    setPhase("loading");

    analyzerRef.current
      .analyze(fen, legalMoves.map(moveToUci), controller.signal)
      .then((evaluated) => {
        if (controller.signal.aborted || chessRef.current.fen() !== fen) return;
        const options = buildOptions(legalMoves, evaluated, DEFAULT_THRESHOLDS);
        if (!options.length)
          throw new Error("No legal move choices were returned.");
        setTurn({ fen, options });
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The chess engine could not analyze this position.",
        );
        setPhase("error");
      });

    return () => controller.abort();
    // revision is the deliberate trigger after a move or reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const playMove = (option: MoveOption) => {
    if (phase !== "ready" || !turn) return;
    try {
      const score = chessRef.current.history().length;
      playOfferedMove(chessRef.current, option, turn.options, turn.fen);
      activeAnalysisRef.current?.abort();
      setSelected(option);
      setPendingChoice(null);
      setPreview(null);
      setTurn(null);
      setRevision((value) => value + 1);

      if (option.quality === "Inaccurate" || option.quality === "Bad") {
        setFailure({ option, score, options: turn.options });
        setShowFailureModal(true);
        setPhase("failed");
        return;
      }

      setMoveStats((current) =>
        option.quality === "Best"
          ? { ...current, best: current.best + 1 }
          : { ...current, good: current.good + 1 },
      );

      setPhase("revealed");
      window.setTimeout(() => {
        setPhase((current) => (current === "revealed" ? "loading" : current));
        setRevision((value) => value + 1);
      }, 1_550);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That move could not be played.",
      );
      setPhase("error");
    }
  };

  const chooseMove = (option: MoveOption) => {
    if (phase !== "ready") return;
    if (pendingChoice?.uci === option.uci) {
      playMove(option);
      return;
    }
    setPendingChoice(option);
    setPreview(null);
  };

  const startNewGame = (fen?: string) => {
    activeAnalysisRef.current?.abort();
    chessRef.current = createChess(fen);
    setTurn(null);
    setSelected(null);
    setFailure(null);
    setShowFailureModal(false);
    setMoveStats({ best: 0, good: 0 });
    setPendingChoice(null);
    setPreview(null);
    setError("");
    setShowNewGamePicker(false);
    setPhase("loading");
    setRevision((value) => value + 1);
  };

  const openNewGamePicker = () => {
    setShowFailureModal(false);
    setShowNewGamePicker(true);
  };

  useEffect(() => {
    if (!showFailureModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFailureModal(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showFailureModal]);

  useEffect(() => {
    if (!showHowToPlay) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissHowToPlay();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showHowToPlay]);

  useEffect(() => {
    if (!showNewGamePicker) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowNewGamePicker(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showNewGamePicker]);

  const retry = () => {
    analyzerRef.current.dispose();
    setError("");
    setPhase("loading");
    setRevision((value) => value + 1);
  };

  const previewMove =
    pendingChoice ?? preview ?? (phase === "revealed" ? selected : null);
  const reviewOptions = failure?.options?.length
    ? failure.options
    : failure
      ? [failure.option]
      : [];
  const previewIndex =
    turn?.options.findIndex((option) => option.uci === previewMove?.uci) ?? -1;
  const previewColor =
    pendingChoice?.uci === previewMove?.uci
      ? CONFIRM_COLOR
      : OPTION_COLORS[Math.max(0, previewIndex) % OPTION_COLORS.length];
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: "rgba(209, 184, 116, 0.34)" };
    squareStyles[lastMove.to] = { background: "rgba(209, 184, 116, 0.48)" };
  }
  if (previewMove) {
    squareStyles[previewMove.from] = {
      boxShadow: `inset 0 0 0 5px ${previewColor}`,
    };
    squareStyles[previewMove.to] = {
      boxShadow: `inset 0 0 0 5px ${previewColor}`,
    };
  }

  const boardOptions: ChessboardOptions = {
    id: "fourced-move-board",
    position: fen,
    boardOrientation: orientation === "w" ? "white" : "black",
    allowDragging: false,
    allowDrawingArrows: false,
    showNotation: true,
    animationDurationInMs: 220,
    darkSquareStyle: { backgroundColor: "#41665b" },
    lightSquareStyle: { backgroundColor: "#e9e3d4" },
    boardStyle: {
      borderRadius: "6px",
      boxShadow: "0 22px 55px rgba(4, 12, 10, .28)",
    },
    squareStyles,
    arrows:
      phase === "ready" && turn
        ? turn.options.map((option, index) => ({
            startSquare: option.from,
            endSquare: option.to,
            color:
              pendingChoice?.uci === option.uci
                ? CONFIRM_COLOR
                : OPTION_COLORS[index % OPTION_COLORS.length],
          }))
        : phase === "failed"
          ? reviewOptions.map((option) => ({
              startSquare: option.from,
              endSquare: option.to,
              color: QUALITY_COLORS[option.quality],
            }))
          : [],
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#game" aria-label="Fourced Move home">
          <span className="brand-mark" aria-hidden="true">
            4
          </span>
          <span>
            <strong>Fourced</strong> Move
          </span>
        </a>
        <div className="top-actions">
          <button
            className="text-button"
            type="button"
            onClick={() =>
              setOrientation((color) => (color === "w" ? "b" : "w"))
            }
          >
            <span aria-hidden="true">↻</span> Flip board
          </button>
          <button
            className="primary-small"
            type="button"
            onClick={openNewGamePicker}
          >
            New game
          </button>
        </div>
      </header>

      <section id="game" className="game-layout">
        <div className="board-column">
          <div className="player-strip opponent">
            <span
              className={`color-dot ${orientation === "w" ? "black" : "white"}`}
            />
            {orientation === "w" ? "Black" : "White"}
          </div>
          <div className="board-wrap">
            <Chessboard options={boardOptions} />
          </div>
          <div className="player-strip">
            <span
              className={`color-dot ${orientation === "w" ? "white" : "black"}`}
            />
            {orientation === "w" ? "White" : "Black"}
            <span
              className="move-count"
              role="status"
              aria-live="polite"
              aria-label={`Score: ${failure?.score ?? moves.length} ${(failure?.score ?? moves.length) === 1 ? "move" : "moves"} made`}
            >
              <span>Score</span>
              <strong>{failure?.score ?? moves.length}</strong>
            </span>
          </div>
        </div>

        <aside className="play-panel">
          <div
            className="options-area"
            aria-live="polite"
            aria-busy={phase === "loading"}
          >
            {phase === "loading" && (
              <div className="thinking">
                <span className="thinking-icon" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <strong>Finding your four moves…</strong>
                  <span>Stockfish is weighing the position.</span>
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="engine-error" role="alert">
                <strong>Engine unavailable</strong>
                <p>{error}</p>
                <button className="primary-small" type="button" onClick={retry}>
                  Retry analysis
                </button>
              </div>
            )}

            {phase === "finished" && (
              <div className="finished-card">
                <span aria-hidden="true">♟</span>
                <p>{terminal}</p>
                <button
                  className="primary-small"
                  type="button"
                  onClick={openNewGamePicker}
                >
                  Play again
                </button>
              </div>
            )}

            {phase === "revealed" && selected && (
              <div
                className={`reveal-card quality-${selected.quality.toLowerCase()}`}
              >
                <span className="reveal-kicker">You played {selected.san}</span>
                <strong>{selected.quality}</strong>
                <span>{scoreLabel(selected)} · Next choices incoming…</span>
              </div>
            )}

            {phase === "ready" && turn && (
              <div className="move-picker">
                <div
                  className="move-options"
                  role="group"
                  aria-label="Available moves"
                >
                  {turn.options.map((option, index) => (
                    <button
                      className={`move-option${pendingChoice?.uci === option.uci ? " pending" : ""}`}
                      type="button"
                      key={option.id}
                      onClick={() => chooseMove(option)}
                      onMouseEnter={() => setPreview(option)}
                      onMouseLeave={() => setPreview(null)}
                      onFocus={() => setPreview(option)}
                      onBlur={() => setPreview(null)}
                      aria-pressed={pendingChoice?.uci === option.uci}
                      aria-label={
                        pendingChoice?.uci === option.uci
                          ? `Confirm ${option.san}. Tap again to play this move.`
                          : `Option ${index + 1}: ${option.san}, ${option.description}. Tap twice to play.`
                      }
                      style={
                        {
                          "--option-color":
                            OPTION_COLORS[index % OPTION_COLORS.length],
                        } as React.CSSProperties
                      }
                    >
                      {pendingChoice?.uci === option.uci && (
                        <Check
                          className="selection-check"
                          aria-hidden="true"
                          strokeWidth={3}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {phase === "failed" && failure && (
              <div className="move-review" aria-label="Move quality review">
                <div className="review-options">
                  {reviewOptions.map((option) => {
                    const wasPlayed = option.uci === failure.option.uci;
                    return (
                      <div
                        className={`review-option${wasPlayed ? " played" : ""}`}
                        key={option.id}
                        style={
                          {
                            "--quality-color": QUALITY_COLORS[option.quality],
                          } as React.CSSProperties
                        }
                      >
                        <span className="review-swatch" aria-hidden="true" />
                        <span className="review-move">
                          <strong>{option.san}</strong>
                          <small>{option.description}</small>
                        </span>
                        <span className="review-quality">{option.quality}</span>
                        {wasPlayed && (
                          <Check
                            className="review-check"
                            aria-label="Move played"
                            strokeWidth={3}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="history-section">
            <div className="section-title">
              <span>Move history</span>
              <small>
                {moves.length} {moves.length === 1 ? "ply" : "plies"}
              </small>
            </div>
            <div
              className="history-list"
              tabIndex={0}
              aria-label="Move history"
            >
              {rows.length === 0 ? (
                <p className="empty-history">Your game starts here.</p>
              ) : (
                rows.map((row) => (
                  <div className="history-row" key={row.number}>
                    <span>{row.number}.</span>
                    <strong>{row.white}</strong>
                    <strong>{row.black ?? ""}</strong>
                  </div>
                ))
              )}
            </div>
          </div>

          <p className="rules-note">
            <span aria-hidden="true">◇</span> Four legal moves. One decision.
            Qualities stay hidden until you commit.
          </p>
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
          <section
            className="score-modal how-to-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-to-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={dismissHowToPlay}
              aria-label="Close how to play"
            >
              ×
            </button>
            <span className="modal-kicker">Welcome to Fourced Move</span>
            <h2 id="how-to-title">How to play</h2>
            <ol className="how-to-steps">
              <li>Match a colored square to its arrow on the board.</li>
              <li>
                Tap once to select it, then tap the green square to confirm.
              </li>
              <li>
                Best and Good moves add to your score. Inaccurate or Bad moves
                end the game.
              </li>
            </ol>
            <button
              className="primary-small"
              type="button"
              onClick={dismissHowToPlay}
              autoFocus
            >
              Start playing
            </button>
          </section>
        </div>
      )}
      {failure && showFailureModal && !showHowToPlay && !showNewGamePicker && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget)
              setShowFailureModal(false);
          }}
        >
          <section
            className="score-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-modal-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setShowFailureModal(false)}
              aria-label="Close and review the final position"
            >
              ×
            </button>
            <span className="modal-kicker">Game over</span>
            <h2 id="score-modal-title">{failure.option.quality} move</h2>
            <span className="modal-score-label">Your score</span>
            <strong className="modal-score">{failure.score}</strong>
            <p className="modal-breakdown">
              {moveStats.best} Best <span>·</span> {moveStats.good} Good
            </p>
            <div className="modal-actions">
              <button
                className="modal-secondary"
                type="button"
                onClick={() => setShowFailureModal(false)}
              >
                Review position
              </button>
              <button
                className="primary-small"
                type="button"
                onClick={openNewGamePicker}
              >
                New game
              </button>
            </div>
          </section>
        </div>
      )}
      {showNewGamePicker && !showHowToPlay && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget)
              setShowNewGamePicker(false);
          }}
        >
          <section
            className="score-modal new-game-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-game-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setShowNewGamePicker(false)}
              aria-label="Close new game options"
            >
              ×
            </button>
            <span className="modal-kicker">New game</span>
            <h2 id="new-game-title">Choose a starting position</h2>
            <div className="new-game-choices">
              <button type="button" onClick={() => startNewGame()}>
                <strong>Standard</strong>
                <span>Start from the opening position</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  startNewGame(
                    RANDOM_POSITIONS[
                      Math.floor(Math.random() * RANDOM_POSITIONS.length)
                    ],
                  )
                }
              >
                <strong>Random</strong>
                <span>Jump into an even middlegame position</span>
              </button>
            </div>
          </section>
        </div>
      )}
      <footer>
        Analysis runs privately in your browser. Games save automatically.
      </footer>
    </main>
  );
}
