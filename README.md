# Fourced Move

A local two-player chess game where every turn offers up to four engine-evaluated legal moves. Pick the move you think is strongest, click it again to confirm, and then reveal its quality.

The game runs entirely in the browser with React, TypeScript, `chess.js`, `react-chessboard`, and the lightweight single-threaded Stockfish WebAssembly build. Game state and settings are stored in `localStorage`.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite. To verify a production build:

```bash
npm run build
npm run preview
```

## GitHub Pages

Pushes to `main` automatically build and deploy the site through the Pages workflow in `.github/workflows/deploy-pages.yml`. The repository name must remain `fourced-move`, since that is the production base path configured in `vite.config.ts`.

Stockfish may spend up to about five seconds on positions where the strongest move or useful quality categories are not yet stable. Engine strength is intentionally lower than full desktop Stockfish because the app uses its compact browser build.
