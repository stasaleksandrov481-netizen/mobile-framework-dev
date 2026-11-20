"use client";

import Link from "next/link";
import { useRef } from "react";

export default function SiteMenu({ links }: { links: ReadonlyArray<{ href: string; label: string }> }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  return (
    <details ref={menu} className="site-menu" onKeyDown={event => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.currentTarget.open = false;
      summary.current?.focus();
    }}>
      <summary ref={summary} aria-label="Меню"><span className="site-menu-icon" aria-hidden="true" /></summary>
      <nav className="site-menu-panel" aria-label="Меню сайта">
        {links.map(link => <Link key={link.href} href={link.href} onClick={() => {
          if (!menu.current) return;
          menu.current.open = false;
          summary.current?.focus({ preventScroll: true });
        }}>{link.label}</Link>)}
      </nav>
    </details>
  );
}
