import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // RPC de Arc Testnet. Poné VITE_ARC_RPC en .env con tu URL de Alchemy
  // para no depender del RPC público (que limita las consultas).
  const target = env.VITE_ARC_RPC || "https://rpc.testnet.arc.network";
  // RPC de Ethereum Mainnet para el Price Feed Chainlink USD/ARS.
  const ethTarget = env.VITE_ETH_RPC || "https://ethereum.publicnode.com";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        // Los archivos del build llevan hash inmutable: el SW los precachea
        // para que el caparazón cargue al toque y funcione offline. Las rutas
        // de API (/rpc, /eth-rpc, /contacts, /transactions) quedan SIN caché
        // (network-only) a propósito: es una app de pagos y cachear datos
        // financieros o balances es un riesgo.
        includeAssets: ["logo-192.png", "logo-512.png", "logo-maskable-512.png", "apple-touch-icon.png"],
        manifest: {
          name: "MidatoPay × Arc",
          short_name: "MidatoPay",
          description: "Pagos USDC por voz sobre Arc Testnet",
          lang: "es",
          start_url: "/",
          scope: "/",
          display: "standalone",
          theme_color: "#E7E7EE",
          background_color: "#E7E7EE",
          icons: [
            { src: "/logo-192.png", sizes: "192x192", type: "image/png" },
            { src: "/logo-512.png", sizes: "512x512", type: "image/png" },
            { src: "/logo-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Solo JS/CSS/HTML del build + fuentes y el favicon. Las imágenes
          // grandes (slides, banner, inicio) NO se precachean: van a runtime
          // CacheFirst para no inflar la instalación del SW a ~10 MB.
          globPatterns: ["**/*.{js,css,html,ico,woff2}"],
          navigateFallback: "/index.html",
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "google-fonts",
                expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin && /\.(?:png|svg|webp|jpe?g|gif)$/i.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "images",
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^\/(?:rpc|eth-rpc|contacts|transactions)\/.*/,
              handler: "NetworkOnly",
              method: "POST",
            },
            {
              urlPattern: /^\/(?:rpc|eth-rpc|contacts|transactions)\/.*/,
              handler: "NetworkOnly",
              method: "GET",
            },
          ],
        },
      }),
    ],
    define: {
      global: "globalThis",
    },
    optimizeDeps: {
      esbuildOptions: { define: { global: "globalThis" } },
    },
    server: {
      proxy: {
        // Puente al RPC para evitar bloqueos CORS del navegador
        "/rpc": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rpc/, ""),
        },
        "/eth-rpc": {
          target: ethTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/eth-rpc/, ""),
        },
        // API de contactos (Postgres/Aiven) — a diferencia de /rpc, no hay
        // fallback público posible: hay que correr `netlify functions:serve`
        // aparte (puerto 9999 por default) para que esto responda en dev.
        "/contacts": {
          target: "http://localhost:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/contacts/, "/.netlify/functions/contacts"),
        },
        "/transactions": {
          target: "http://localhost:9999",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/transactions/, "/.netlify/functions/transactions"),
        },
      },
    },
  };
});
