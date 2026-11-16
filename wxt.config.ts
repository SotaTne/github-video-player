import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'GitHub Video Player',
    description:
      'Play video files (.mp4, .webm, .mov, etc.) directly on GitHub blob pages and PR/Commit diffs.',
    version: '1.0.0',
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
