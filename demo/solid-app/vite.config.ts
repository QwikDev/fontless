import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fontless } from '../../lib/vite/plugin';

export default defineConfig({
  plugins: [solid(), fontless()],
});
