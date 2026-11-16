import type { MetadataRoute } from "next";

// This is guidance for cooperative crawlers, not a security boundary.
// Firewall rules and server-side authorization protect the actual endpoints.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: "https://cortexapp.ru/sitemap.xml",
  };
}
