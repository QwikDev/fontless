import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fontless } from '../../lib/vite/plugin';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), fontless()],
});
