import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研知雷达 Research Radar AI",
  description: "AI 科研情报、知识管理与课题推进平台",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
