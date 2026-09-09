import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'Vector | War Thunder companion',
  description: 'Live battle map, combat activity and session results for War Thunder.',
  icons: {
    icon: [
      { url: '/vector.ico', sizes: '16x16 20x20 24x24 32x32 48x48 64x64 128x128 256x256', type: 'image/x-icon' },
      { url: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  },
  openGraph: {
    title: 'Vector | War Thunder companion',
    description: 'Live battle map, combat activity and session results for War Thunder.',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'Vector tactical map interface' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vector | War Thunder companion',
    description: 'Live battle map, combat activity and session results for War Thunder.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
