/** @type {import('next').NextConfig} */
export default {
  // El núcleo es JS puro sin dependencias: nada que transpilar.
  experimental: {
    // Las rutas de cron pueden tardar: auditar 25 perfiles son ~25 llamadas
    // a Places más otras tantas a Gemini. Hobby permite hasta 300 s.
    proxyTimeout: 300_000,
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
