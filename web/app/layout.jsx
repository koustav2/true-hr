import './globals.css';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from '@/lib/auth.jsx';

// Plus Jakarta Sans — warmer, more distinctive than Inter, across the whole UI.
// JetBrains Mono — for IDs, codes and money, where tabular data reads best.
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-mono', display: 'swap' });

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
