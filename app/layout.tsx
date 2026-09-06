import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "약속 | AI 금융 계약서 쉬운 번역",
  description: "보험·대출·카드 약관을 쉬운 말로 풀고 위험한 내용을 알려드립니다.",
  openGraph: {
    title: "약속 | AI 금융 계약서 쉬운 번역",
    description: "금융 계약서, 쉬운 말로 바꿔드려요.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "약속 | AI 금융 계약서 쉬운 번역",
    description: "금융 계약서, 쉬운 말로 바꿔드려요.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
