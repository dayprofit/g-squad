import type { Metadata, Viewport } from 'next';
import { buildFaviconUri } from '@/lib/build-favicon-uri';
import { FONT_CLASS_MAP } from '@/lib/fonts';
import { TemplateLayout } from '@/components/custom/template-layout';
import { TemplateI18nProvider } from '../lib/i18n/provider';
import '@/app/globals.css';
import './globals.css';
import './bot.css';

export function generateMetadata(): Metadata {
  const faviconUri = buildFaviconUri();
  const appName = process.env.NEXT_PUBLIC_DERIV_APP_NAME?.trim() || 'G-squad';
  return {
    title: `${appName} Trading Workspace`,
    description: 'Mobile trading workspace with separate application and Deriv accounts',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: appName,
    },
    icons: {
      ...(faviconUri ? { icon: faviconUri } : {}),
      apple: '/apple-touch-icon.png',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4c400',
};

const fontClass =
  FONT_CLASS_MAP[process.env.NEXT_PUBLIC_FONT_FAMILY ?? 'Inter'] ??
  FONT_CLASS_MAP['DM Sans'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full lg:h-auto" suppressHydrationWarning>
      <body
        className={`${fontClass} bg-background flex min-h-dvh flex-col overflow-hidden h-dvh`}
      >
        <TemplateI18nProvider>
          <TemplateLayout>{children}</TemplateLayout>
        </TemplateI18nProvider>
      </body>
    </html>
  );
}
