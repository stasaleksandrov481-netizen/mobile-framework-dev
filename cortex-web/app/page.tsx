import DownloadCTA from "@/components/DownloadCTA";
import LandingAccountGate from "@/components/LandingAccountGate";
import SilkHero from "@/components/SilkHero";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import UiIcon from "@/components/UiIcon";
import { registrationIsOpen } from "@/lib/registration-gate";

// The registration gate is an operator switch; re-check it at most once a minute.
export const revalidate = 60;

const features = [
  { icon: "mic", title: "Понимает речь", text: "Говорите своими словами. Если команда неясна, CORTEX уточнит.", wide: true },
  { icon: "phone", title: "Управляет телефоном", text: "Открывает приложения, меняет яркость и ставит будильники.", wide: false },
  { icon: "layers", title: "Запускает сценарии", text: "Объедините несколько действий в одну голосовую команду.", wide: false },
  { icon: "bell", title: "Напоминает о важном", text: "Скажите, о чём и когда напомнить.", wide: false },
  { icon: "lock", title: "Спрашивает подтверждение", text: "Перед отправкой сообщения или звонком CORTEX попросит подтверждение.", wide: true },
] as const;

const steps = [
  { title: "Дайте команду", text: "Нажмите на островок и скажите, что сделать." },
  { title: "Уточните задачу", text: "CORTEX задаст вопрос, если ему не хватает деталей." },
  { title: "Проверьте результат", text: "CORTEX сообщит, что выполнено, и объяснит, если шаг не удался." },
];

const questions = [
  { q: "Что доступно бесплатно?", a: "Команды телефона, сценарии, напоминания и островок. Для облачного ИИ действует дневной лимит." },
  { q: "Когда можно скачать приложение?", a: "Дату открытия объявим в Telegram и пришлём письмом тем, кто подписался на уведомления." },
  { q: "Какие данные уходят с телефона?", a: "Локальные команды обрабатываются на устройстве. Облачные запросы проходят через сервер CORTEX. Передача текста с экрана требует отдельного согласия." },
];

export default function Home() {
  return (
    <LandingAccountGate>
      <div className="page">
        <SiteHeader />

        <main>
          <SilkHero registrationOpen={registrationIsOpen()} />

          <section className="section" id="features" aria-labelledby="features-title">
            <div className="section-head">
              <h2 id="features-title">Что умеет CORTEX</h2>
            </div>
            <div className="bento">
              {features.map(item => (
                <article key={item.title} className={`card${item.wide ? " card--wide" : ""}`}>
                  <span className="card-icon"><UiIcon name={item.icon} size={20} /></span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="section" aria-labelledby="steps-title">
            <div className="section-head">
              <h2 id="steps-title">Как это работает</h2>
            </div>
            <ol className="steps">
              {steps.map((step, index) => (
                <li key={step.title} className="card step">
                  <span className="step-index" aria-hidden="true">{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="section split" aria-label="Тарифы и приватность">
            <div className="card split-card">
              <h2>Бесплатные команды</h2>
              <p>Подписка даёт больше запросов к облачному ИИ и доступ к продвинутым моделям.</p>
              <a className="glass glass--md" href="/pricing"><span>Смотреть тарифы</span><UiIcon name="arrow-right" size={16} /></a>
            </div>
            <div className="card split-card">
              <h2>Разрешения Android</h2>
              <p>Проверьте, зачем CORTEX нужен доступ и как его отключить.</p>
              <a className="glass glass--md" href="/permissions"><span>О разрешениях</span><UiIcon name="arrow-right" size={16} /></a>
            </div>
          </section>

          <section className="section" aria-labelledby="faq-title">
            <div className="section-head">
              <h2 id="faq-title">Частые вопросы</h2>
            </div>
            <div className="faq">
              {questions.map(item => (
                <details key={item.q} className="card faq-item">
                  <summary>{item.q}<span className="faq-toggle" aria-hidden="true" /></summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
            <p className="section-more"><a href="/questions">Все вопросы <UiIcon name="arrow-right" size={15} /></a></p>
          </section>

          <section className="section" aria-labelledby="cta-title">
            <div className="card cta-card">
              <span className="card-icon"><UiIcon name="spark" size={20} /></span>
              <h2 id="cta-title">Новости запуска</h2>
              <p>Дату открытия опубликуем в Telegram. Ранним участникам после запуска начислим 5 000 ИИ-токенов.</p>
              <a className="glass glass--lg glass--light" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">
                <UiIcon name="telegram" size={17} /><span>Канал в Telegram</span>
              </a>
              <DownloadCTA />
            </div>
          </section>
        </main>

        <SiteFooter />
      </div>
    </LandingAccountGate>
  );
}
