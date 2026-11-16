"use client";

import { useEffect, useState } from "react";
import UiIcon from "@/components/UiIcon";

/** Keep the landing's client bundle independent of Supabase Auth and the signup form. */
export default function DownloadCTA({ url }: { url?: string }) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(Boolean(url) && Date.now() >= Date.parse("2026-11-20T00:00:00+03:00"));
  }, [url]);

  return available && url ? (
    <a className="button button--secondary" href={url} rel="noopener noreferrer">
      Установить <span className="button-icon"><UiIcon name="download" size={18} /></span>
    </a>
  ) : (
    <span className="button button--secondary button--disabled" aria-label="Установка станет доступна 20 ноября">
      <UiIcon name="clock" size={17} /> Установить <span className="button-soon">20.11</span>
    </span>
  );
}
