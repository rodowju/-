import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: 'index.html', en: 'en/index.html' },
      output: { manualChunks: { phaser: ['phaser'] } },
    },
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        // 11-23 대표 결정: 한국어는 '무궁화꽃이 피었습니다', 외국어(/en/)는 'Freeze Run'. 영문 manifest는 public/manifest-en.webmanifest
        name: '무궁화꽃이 피었습니다',
        short_name: '무궁화꽃',
        description: '술래가 돌아보면 멈춘다. 손가락 하나로 하는 무궁화꽃이 피었습니다.',
        lang: 'ko',
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
        navigateFallbackDenylist: [/^\/en(\/|$)/],
      },
      devOptions: { enabled: false },
    }),
  ],
});
