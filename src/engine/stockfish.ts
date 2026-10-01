import type { EngineScore, EvaluatedMove } from '../game/types';

type SearchResult = {
  evaluations: EvaluatedMove[];
  stable: boolean;
};

type PendingSearch = {
  expected: number;
  byDepth: Map<number, Map<string, EvaluatedMove>>;
  resolve: (result: SearchResult) => void;
  reject: (error: Error) => void;
  token: number;
};

const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;

export class StockfishAnalyzer {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private pending: PendingSearch | null = null;
  private token = 0;

  initialize(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      try {
        this.worker = new Worker(ENGINE_URL);
        this.worker.addEventListener('message', this.handleMessage);
        this.worker.addEventListener('error', (event) => {
          const error = new Error(event.message || 'Stockfish failed to load.');
          this.readyReject?.(error);
          this.pending?.reject(error);
          this.pending = null;
        });
        this.worker.postMessage('uci');
        window.setTimeout(() => {
          if (this.readyResolve) {
            const error = new Error('Stockfish took too long to start.');
            this.readyReject?.(error);
            this.readyResolve = null;
          }
        }, 12_000);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Stockfish failed to load.'));
      }
    });
    return this.readyPromise;
  }

  cancel(): void {
    this.token += 1;
    this.worker?.postMessage('stop');
    this.pending?.reject(new DOMException('Analysis cancelled', 'AbortError'));
    this.pending = null;
  }

  async analyze(fen: string, legalMoves: string[], signal?: AbortSignal): Promise<EvaluatedMove[]> {
    await this.initialize();
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

    const abort = () => this.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const initialCount = Math.min(legalMoves.length, 16);
      const first = await this.search(fen, initialCount, 1_900);
      const qualitiesAvailable = this.hasUsefulSpread(first.evaluations);
      if ((qualitiesAvailable && first.stable) || legalMoves.length <= initialCount) {
        return first.evaluations;
      }

      const broadCount = Math.min(legalMoves.length, 64);
      const second = await this.search(fen, broadCount, 2_800);
      return second.evaluations.length ? second.evaluations : first.evaluations;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  retry(): void {
    this.dispose();
    void this.initialize();
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  private hasUsefulSpread(evaluations: EvaluatedMove[]): boolean {
    if (evaluations.length < 4) return true;
    const cp = evaluations.filter((item) => item.score.kind === 'cp');
    if (cp.length < 2) return evaluations.some((item) => item.score.kind === 'mate');
    const values = cp.map((item) => item.score.value);
    return Math.max(...values) - Math.min(...values) > 150;
  }

  private search(fen: string, multiPv: number, movetime: number): Promise<SearchResult> {
    if (!this.worker) return Promise.reject(new Error('Stockfish is not available.'));
    const token = ++this.token;
    this.worker.postMessage('stop');
    return new Promise((resolve, reject) => {
      this.pending = { expected: multiPv, byDepth: new Map(), resolve, reject, token };
      this.worker?.postMessage(`setoption name MultiPV value ${multiPv}`);
      this.worker?.postMessage(`position fen ${fen}`);
      this.worker?.postMessage(`go movetime ${movetime}`);
    });
  }

  private handleMessage = (event: MessageEvent<unknown>): void => {
    const text = typeof event.data === 'string' ? event.data : String(event.data);
    for (const line of text.split(/\r?\n/)) this.handleLine(line.trim());
  };

  private handleLine(line: string): void {
    if (line === 'uciok') {
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    const pending = this.pending;
    if (!pending) return;
    if (line.startsWith('info ') && line.includes(' score ') && line.includes(' pv ')) {
      const depth = Number(line.match(/\bdepth (\d+)/)?.[1]);
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      const move = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/)?.[1];
      if (!Number.isFinite(depth) || !scoreMatch || !move) return;
      const score: EngineScore = {
        kind: scoreMatch[1] as EngineScore['kind'],
        value: Number(scoreMatch[2]),
      };
      const atDepth = pending.byDepth.get(depth) ?? new Map<string, EvaluatedMove>();
      atDepth.set(move, { uci: move, score, depth });
      pending.byDepth.set(depth, atDepth);
      return;
    }

    if (line.startsWith('bestmove')) {
      if (pending.token !== this.token) return;
      const snapshots = [...pending.byDepth.entries()];
      const fullest = snapshots.sort((a, b) => {
        const countDifference = b[1].size - a[1].size;
        return countDifference || b[0] - a[0];
      })[0];
      const evaluations = fullest ? [...fullest[1].values()] : [];
      const completeDepths = snapshots
        .filter(([, moves]) => moves.size >= Math.max(2, Math.floor(pending.expected * 0.6)))
        .sort((a, b) => b[0] - a[0])
        .slice(0, 3);
      const leaders = completeDepths.map(([, moves]) => [...moves.values()][0]?.uci);
      const stable = leaders.length >= 3 && leaders.every((move) => move === leaders[0]);
      this.pending = null;
      if (!evaluations.length) pending.reject(new Error('Stockfish returned no move evaluations.'));
      else pending.resolve({ evaluations, stable });
    }
  }
}
