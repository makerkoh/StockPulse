import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockPulse — Intelligence Platform",
  description: "Premium stock and IPO intelligence with quantile forecasting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface-0 text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
