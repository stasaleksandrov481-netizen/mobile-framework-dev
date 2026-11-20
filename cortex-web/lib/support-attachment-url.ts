/** Only render signed object links from this deployment's private support bucket. */
export function supportAttachmentUrl(raw: unknown, projectUrl: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const url = new URL(raw);
    const project = new URL(projectUrl);
    if (url.protocol !== "https:" || url.origin !== project.origin || url.username || url.password ||
        !url.pathname.startsWith("/storage/v1/object/sign/cortex-support/") || !url.searchParams.get("token")) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}
