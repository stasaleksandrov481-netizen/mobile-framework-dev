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
        <HeaderAccount />
      </div>
    </header>
  );
}
