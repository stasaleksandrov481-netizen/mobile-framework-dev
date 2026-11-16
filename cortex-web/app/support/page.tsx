import type { Metadata } from "next";
import Link from "next/link";
import { supportUrl, supportUsername } from "@/lib/merchant-details";

export const metadata: Metadata = {
  title: "Поддержка — CORTEX",
  description: "Как обратиться в поддержку CORTEX по работе приложения, подпискам и персональным данным.",
};

export default function SupportPage() {
  return (
    <div className="shell">
      <main className="simple-page legal-page">
        <Link className="legal-back" href="/">← На главную</Link>
        <h1>Поддержка CORTEX</h1>
        <p className="legal-lead">Поможем со входом, работой приложения, подпиской и запросами по персональным данным.</p>
        <h2>Электронная почта</h2>
        <p>Напишите на <a href="mailto:support@cortexapp.ru">support@cortexapp.ru</a>. Укажите, что произошло, версию приложения и модель телефона, если вопрос технический. Пароли и коды подтверждения отправлять не нужно.</p>
        <h2>Обращение из приложения</h2>
        <p>Откройте «Профиль» → «Помощь и поддержка» → «Написать разработчику» и создайте обращение. Ответ появится в разделе «Мои обращения».</p>
        <h2>Прямое сообщение в Telegram</h2>
        <p>Если приложение недоступно, напишите администратору CORTEX <a href={supportUrl}>@{supportUsername}</a>. Если вопрос касается оплаты, приложите номер заказа. Пароль, коды входа и реквизиты карты передавать не нужно.</p>
        <nav className="legal-links" aria-label="Документы CORTEX">
          <Link href="/pricing">Тарифы и цены</Link>
          <Link href="/terms">Пользовательское соглашение</Link>
          <Link href="/privacy">Политика конфиденциальности</Link>
        </nav>
      </main>
    </div>
  );
}
