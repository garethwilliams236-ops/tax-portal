import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tax Portal',
  description: 'Multi-entity UK tax management',
};

// Tax data must never be statically rendered or cached at the edge.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="font-sans text-[14.5px] leading-normal antialiased">{children}</body>
    </html>
  );
}
