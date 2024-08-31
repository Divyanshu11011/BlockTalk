import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BlockTalk",
  description: "A Solana-based chatbot application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logo.png" type="image/png" />
        <meta name="description" content="A Solana-based chatbot application" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>BlockTalk</title>
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
