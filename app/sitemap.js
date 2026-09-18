export default function sitemap() {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app').replace(/\/$/, '');
  return [
    {
      url: `${baseUrl}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/informe/ejemplo`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
