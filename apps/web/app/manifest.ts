import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Caracara Score",
    short_name: "Caracara",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#52a6ae",
    icons: [
      {
        src: "/caracara-logo-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/caracara-logo-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  }
}
