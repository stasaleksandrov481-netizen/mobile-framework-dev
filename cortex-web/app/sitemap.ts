import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/pricing", "/questions", "/support", "/privacy", "/terms", "/permissions"];
  return pages.map((page) => ({
    url: `https://cortexapp.ru${page || "/"}`,
    changeFrequency: "monthly",
    priority: page ? 0.4 : 1,
  }));
}
