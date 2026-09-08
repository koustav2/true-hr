import './globals.css';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { AuthProvider } from '@/lib/auth.jsx';

// Enterprise console typography: IBM Plex Sans for UI, Plex Mono for data
// (IDs, codes, money) where tabular precision matters.
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'TRUE HR',
  description: 'TRUE HR — onboarding & people operations',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
