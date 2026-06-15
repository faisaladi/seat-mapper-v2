import './globals.css';
import { Open_Sans } from 'next/font/google';

// UI font: Open Sans. Weights: 400 body, 500 medium, 600 SemiBold
// headings/titles, 700 bold. (Canvas text is drawn in Arial by the renderer
// and is unaffected by this.)
const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-open-sans',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={openSans.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
