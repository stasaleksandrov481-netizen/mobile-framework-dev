import type { Metadata } from "next";
import DocGlow from "@/components/DocGlow";
import LegalToc from "@/components/LegalToc";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Вопросы о CORTEX — данные, безопасность и тарифы",
  description: "Кратко о безопасности, обработке данных и бесплатных возможностях CORTEX.",
};

export default function QuestionsPage() {
  return (
    <div className="page">
      <DocGlow />
      <SiteHeader />
      <div className="doc-layout"><main className="simple-page legal-page questions-page">
        <Link className="legal-back" href="/">← На главную</Link>
        <p className="legal-eyebrow">CORTEX / ВОПРОСЫ</p>
        <h1>Коротко о главном.</h1>
        <p className="legal-lead">Отвечаем на вопросы перед запуском открытой беты. Точная дата выхода пока не объявлена.</p>

        <h2>Что будет бесплатным?</h2>
        <p>Локальное управление телефоном, сценарии, напоминания и настройка островка. Облачный ИИ тоже доступен бесплатно, но с дневным лимитом токенов.</p>

        <h2>Что даёт подписка?</h2>
        <p>Увеличенные лимиты ИИ и доступ к более мощным моделям. Базовые локальные функции не требуют подписки. Цены и лимиты указаны в <Link href="/pricing">тарифах</Link>.</p>

        <h2>Как обрабатываются данные?</h2>
        <p>Локальные действия выполняются на телефоне. Запросы к облачному ИИ передаются внешнему провайдеру через сервер CORTEX. Передача текста с экрана для сложных задач требует отдельного согласия. Подробности — в <Link href="/privacy">политике конфиденциальности</Link> и <Link href="/permissions">разделе разрешений</Link>.</p>

        <h2>Можно проверить исходный код?</h2>
        <p>Да, <a href="https://github.com/stasaleksandrov481-netizen/mobile-framework-dev" target="_blank" rel="noopener noreferrer">репозиторий проекта на GitHub</a> открыт для просмотра. Публикация кода сама по себе не гарантирует отсутствия ошибок или вредоносных компонентов. APK лучше скачивать только из официальных источников и проверять его подпись.</p>

        <h2>Когда можно скачать APK?</h2>
        <p>Дата открытой беты пока не определена. О начале скачивания приложения сообщим в <a href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">канале CORTEX</a>.</p>

        <nav className="legal-links" aria-label="Подробнее о CORTEX">
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/pricing">Тарифы</Link>
          <Link href="/support">Поддержка</Link>
        </nav>
      </main><LegalToc /></div>
    <SiteFooter />
    </div>
  );
}
