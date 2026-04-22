import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const bodyFont = localFont({
  src: "./fonts/NotoSansKR-Variable.ttf",
  variable: "--font-body",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const displayFont = localFont({
  src: "./fonts/SpaceGrotesk-Variable.ttf",
  variable: "--font-display",
  weight: "300 700",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "펠라지아-9 탈출 협상",
  description: "침수 중인 해저연구소에서 편향된 생존자들을 설득하고 고립시키는 협상 시뮬레이터",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
