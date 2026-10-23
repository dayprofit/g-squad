import type { MetadataRoute } from 'next';

const appName = process.env.NEXT_PUBLIC_DERIV_APP_NAME?.trim() || 'G-squad';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${appName} Trading Workspace`,
    short_name: appName,
    description: 'Trading workspace for your app and Deriv accounts.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f7f3',
    theme_color: '#f4c400',
    icons: [
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
