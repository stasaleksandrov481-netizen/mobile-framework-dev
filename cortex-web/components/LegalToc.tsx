"use client";

import { useEffect, useState } from "react";

type Item = { id: string; title: string };

/**
 * Sticky contents for long documents (desktop) plus a reading-progress bar.
 * Built from the page's own h2 headings, so documents keep plain markup and
 * every section gets a stable #anchor for links from support answers.
 */
export default function LegalToc() {
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const headings = [...document.querySelectorAll<HTMLHeadingElement>(".legal-page > h2")];
    const used = new Set<string>();
    const found = headings.map((heading, index) => {
      if (!heading.id) {
        const number = heading.textContent?.match(/^\s*(\d+)\./)?.[1];
        let id = number ? `section-${number}` : `section-${index + 1}`;
        while (used.has(id)) id += "-x";
        heading.id = id;
      }
      used.add(heading.id);
      return { id: heading.id, title: (heading.textContent || "").replace(/^\s*\d+\.\s*/, "").trim() };
    });
    setItems(found);
    if (found.length < 3) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-96px 0px -65% 0px" });
    headings.forEach(heading => observer.observe(heading));
    return () => observer.disconnect();
  }, []);

  if (items.length < 3) return null;
  return (
    <>
      <div className="doc-progress" aria-hidden="true" />
      <nav className="doc-toc" aria-label="Содержание документа">
        <p className="doc-toc-title">Содержание</p>
        <ol>
          {items.map(item => (
            <li key={item.id}>
              <a href={`#${item.id}`} aria-current={active === item.id ? "true" : undefined}>{item.title}</a>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
