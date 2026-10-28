import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),

    /**
     * vite-plugin-pwa / Workbox
     *
     * Strategy: generateSW (auto-generate the service worker from our config).
     * WHY generateSW instead of injectManifest:
     *   We don't need custom SW logic beyond caching right now.
     *   injectManifest is for when you need to add custom fetch handlers in the
     *   SW itself (e.g. background sync hooks). For F-O1 we just need the app
     *   shell cached — generateSW is less error-prone.
     *
     * Cache strategies:
     *   - App shell (JS/CSS/HTML/icons): CacheFirst — content-hashed filenames
     *     mean a stale cache is never stale; Workbox only serves from cache
     *     when the hash still matches what was last precached.
     *   - Google Fonts: StaleWhileRevalidate — good UX tradeoff: instant load
     *     from cache while silently updating if online.
     *
     * IMPORTANT: We do NOT cache API responses (/api/*) here.
     *   F-O2 owns the data snapshot layer (IndexedDB).
     *   Workbox caching API responses leads to stale financial/status data
     *   being shown as "live" — dangerous in an equipment rental context.
     */
    VitePWA({
      registerType: 'autoUpdate',

      // Workbox options
      workbox: {
        // Precache the app shell (all Vite-built assets)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // NEVER cache API calls — data freshness is owned by F-O2 (IndexedDB)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/health/],

        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            // Google Fonts woff2 files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },

      // Web app manifest
      manifest: {
        name: 'SPACE EXSPACE Tracker',
        short_name: 'EX Tracker',
        description: 'Equipment & Materials Tracker — SPACE EXSPACE Company',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1117',
        theme_color: '#0f1117',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      // Dev mode: register SW in development so you can test offline behaviour
      // without a production build
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
