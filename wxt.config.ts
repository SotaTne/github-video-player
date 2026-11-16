import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    default_locale: 'ja',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '1.0.0',
    web_accessible_resources: [
      {
        resources: ['video-frame.html', 'chunks/*', 'assets/*'],
        matches: ['*://github.com/*'],
      },
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
