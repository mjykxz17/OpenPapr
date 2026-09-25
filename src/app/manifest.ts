import type { MetadataRoute } from "next";

// Lets the app be added to a phone's home screen with Papi as its icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenPapr",
    short_name: "OpenPapr",
    description: "Your Canvas, planned.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#0f766e",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
