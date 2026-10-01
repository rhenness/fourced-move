import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves project sites below /<repository>/.
  base: command === 'build' ? '/fourced-move/' : '/',
  plugins: [react()],
}));
