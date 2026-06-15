import './globals.css';
import { Poppins } from 'next/font/google';

// SatuSatu brand font (Color/Typography/CTAs guideline). Weights: 400 body,
// 500 medium, 600 SemiBold headings/titles, 700 bold.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={poppins.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
