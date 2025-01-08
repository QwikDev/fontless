import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { fontless } from '../../lib/vite/plugin';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), fontless()],
});
