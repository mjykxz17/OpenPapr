import type { Metadata } from "next";
import { headers } from "next/headers";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The page policy only runs scripts carrying this response's nonce, set by
  // the proxy (src/server/csp.ts). Reading it also renders every page per
  // request, which a nonce needs. The browser hides a nonce once it has
  // parsed it, so the attribute never matches on hydration.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
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
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* Hides a demo banner already put away, before it can paint. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: demoBannerBootScript }} />
      </head>
      <body className="min-h-full">{children}<ServiceWorker /></body>
    </html>
  );
}
