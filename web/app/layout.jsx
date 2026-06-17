import './globals.css';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth.jsx';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'TRUE HR',
  description: 'TRUE HR — onboarding & people operations',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
