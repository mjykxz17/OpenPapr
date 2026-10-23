import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeBootScript } from "@/lib/theme";
import { ServiceWorker } from "@/components/ServiceWorker";
import { demoBannerBootScript } from "@/components/demo-banner-state";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OpenPapr",
  description: "Canvas + NUS Outlook dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The boot scripts set data-theme/data-accent (and data-demo-banner)
    // before paint, so the attributes differ from the server render by design.
    <html
      lang="en"
      data-theme="light"
      data-accent="teal"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* Hides a demo banner already put away, before it can paint. */}
        <script dangerouslySetInnerHTML={{ __html: demoBannerBootScript }} />
      </head>
      <body className="min-h-full">{children}<ServiceWorker /></body>
    </html>
  );
}
