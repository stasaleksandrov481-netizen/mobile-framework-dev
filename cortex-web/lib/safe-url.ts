/** The public install CTA must download an APK directly, never reveal a source repository. */
export function safeHttpsDownloadUrl(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    const trustedHost = url.hostname === "cortexapp.ru" || url.hostname === "www.cortexapp.ru" ||
      url.hostname.endsWith(".public.blob.vercel-storage.com");
    if (url.protocol !== "https:" || !trustedHost || url.username || url.password ||
        url.search || url.hash || !/\.apk$/i.test(url.pathname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
