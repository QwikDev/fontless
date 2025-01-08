import { defineConfig } from 'vite';
import { fontless } from '../../lib/vite/plugin';

// https://vite.dev/config/
export default defineConfig({
  plugins: [fontless()],
});
