"use client";

import SiteErrorView from "@/components/SiteErrorView";

/** Root layout failures also get a standalone response without global CSS. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0 }}>
        <SiteErrorView retry={reset} />
      </body>
    </html>
  );
}
