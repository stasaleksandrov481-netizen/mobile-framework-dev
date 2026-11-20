import Link from "next/link";
import UiIcon from "@/components/UiIcon";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <Link className="brand" href="/" aria-label="CORTEX — на главную">
          <img src="/cortex-mark.svg" alt="" width="26" height="26" />
          <span>CORTEX</span>
        </Link>
        <p>Голосовой ассистент для Android. Меньше нажатий — больше свободы.</p>
      </div>
      <div className="site-footer-grid">
        <nav aria-label="Продукт">
          <span>Продукт</span>
          <Link href="/#features">Возможности</Link>
          <Link href="/pricing">Тарифы</Link>
          <Link href="/questions">Вопросы</Link>
          <Link href="/permissions">Разрешения</Link>
        </nav>
        <nav aria-label="Документы">
          <span>Документы</span>
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/terms">Условия</Link>
          <Link href="/offer">Оферта</Link>
          <Link href="/consent">Согласие</Link>
        </nav>
        <nav aria-label="Связь">
          <span>Связь</span>
          <Link href="/support">Поддержка</Link>
          <a href="mailto:support@cortexapp.ru"><UiIcon name="mail" size={14} />support@cortexapp.ru</a>
          <a href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer"><UiIcon name="telegram" size={14} />Telegram</a>
        </nav>
      </div>
      <div className="site-footer-bottom"><span>© 2026 CORTEX</span><span>Сделано для Android</span></div>
    </footer>
  );
}
