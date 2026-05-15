import type { Metadata } from 'next';
import { Providers } from './providers';
import '@/styles/globals.css';
import { Inter, JetBrains_Mono, Manrope } from 'next/font/google';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' });
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-manrope' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: {
    default: 'Bag1V-Bucks — Купить V-Bucks дёшево | Автоматическая выдача за 5-15 минут',
    template: '%s | Bag1V-Bucks',
  },
  description: 'Купить V-Bucks для Fortnite по выгодной цене. Автоматическая выдача через Epic Games за 5-15 минут. Безопасная авторизация Device Auth, без пароля. Оплата СБП, картой.',
  keywords: ['V-Bucks', 'купить V-Bucks', 'В-Баксы', 'Fortnite', 'вбаксы дёшево', 'V-Bucks дёшево', 'купить вбаксы', 'Fortnite V-Bucks', 'пополнение V-Bucks'],
  authors: [{ name: 'Bag1V-Bucks' }],
  creator: 'Bag1V-Bucks',
  metadataBase: new URL('https://bag1v-bucks.shop'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: 'https://bag1v-bucks.shop',
    siteName: 'Bag1V-Bucks',
    title: 'Bag1V-Bucks — Купить V-Bucks дёшево за 5-15 минут',
    description: 'Автоматическая выдача V-Bucks через Epic Games. Безопасно, быстро, без пароля. Оплата СБП и картой.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Bag1V-Bucks — Купить V-Bucks',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bag1V-Bucks — V-Bucks за 5-15 минут',
    description: 'Купить V-Bucks дёшево с автоматической выдачей. Безопасная авторизация через Epic Games.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/favicon.svg',
  },
  verification: {
    // Добавь сюда коды верификации после регистрации в вебмастерах:
    // google: 'код-из-google-search-console',
    // yandex: 'код-из-яндекс-вебмастер',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${inter.variable} ${manrope.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>
          {/* Background Effects */}
          <div className="grid-bg">
            <div className="grid-pattern" />
            <div className="grid-glow" />
            <div className="grid-overlay" />
            <div className="particles">
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
              <div className="particle" />
            </div>
          </div>

          {/* Main Content */}
          <div className="page-wrapper">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
