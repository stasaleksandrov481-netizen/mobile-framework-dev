"use client";

import SiteErrorView from "@/components/SiteErrorView";

/** Avoid a blank route after a client-side navigation/rendering failure. */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SiteErrorView retry={reset} />;
}
