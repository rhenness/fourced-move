import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockfishAnalyzer } from './stockfish';

afterEach(() => vi.unstubAllGlobals());

describe('Stockfish move restrictions', () => {
  it('passes the requested moves to the engine for a played move analysis', async () => {
    const commands: string[] = [];
    class FakeWorker {
      onMessage: ((event: MessageEvent) => void) | undefined;
      addEventListener(event: string, listener: (event: MessageEvent) => void) {
        if (event === 'message') this.onMessage = listener;
      }
      postMessage(command: string) {
        commands.push(command);
        if (command === 'uci') this.onMessage?.({ data: 'uciok' } as MessageEvent);
        if (command.startsWith('go ')) {
          this.onMessage?.({ data: 'info depth 10 score cp -200 pv e2e4\nbestmove e2e4' } as MessageEvent);
        }
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const analyzer = new StockfishAnalyzer();
    const result = await analyzer.analyze('test-fen', ['e2e4']);
    expect(commands).toContain('go movetime 1900 searchmoves e2e4');
    expect(result).toEqual([{ uci: 'e2e4', score: { kind: 'cp', value: -200 }, depth: 10 }]);
    analyzer.dispose();
  });
});
