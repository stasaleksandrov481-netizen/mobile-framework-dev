import Link from "next/link";
import HeaderAccount from "@/components/HeaderAccount";

const links = [
  { href: "/#features", label: "Возможности" },
  { href: "/pricing", label: "Тарифы" },
  { href: "/questions", label: "Вопросы" },
  { href: "/support", label: "Поддержка" },
];

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-bar">
        <Link className="brand" href="/" aria-label="CORTEX — на главную">
          <img src="/cortex-mark.svg" alt="" width="30" height="30" />
          <span>CORTEX</span>
        </Link>
        <nav className="site-nav" aria-label="Навигация по сайту">
          {links.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
        <div className="site-header-end">
          <HeaderAccount />
          {/* Phones: the same links in a disclosure menu (no JavaScript needed). */}
          <details className="site-menu">
            <summary aria-label="Меню"><span className="site-menu-icon" aria-hidden="true" /></summary>
            <nav className="site-menu-panel" aria-label="Меню сайта">
              {links.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}
              <Link href="/privacy">Документы</Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
