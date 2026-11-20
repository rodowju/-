import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        // 가칭: 출시명은 상표 검색 후 확정 (docs/GDD.md §14)
        name: 'FREEZE',
        short_name: 'FREEZE',
        description: 'Stop when the guardian turns. A one-thumb rhythm runner.',
        lang: 'en',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#111418',
        theme_color: '#111418',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Phaser 청크(약 1.5MB)를 프리캐시에 포함
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
});
