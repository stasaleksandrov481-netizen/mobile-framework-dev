import DownloadCTA from "@/components/DownloadCTA";
import LandingAccountGate from "@/components/LandingAccountGate";
import RegistrationCta from "@/components/RegistrationCta";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import UiIcon from "@/components/UiIcon";
import { registrationIsOpen } from "@/lib/registration-gate";

// The registration gate is an operator switch; re-check it at most once a minute.
export const revalidate = 60;

const features = [
  { icon: "mic", title: "Понимает речь", text: "Говорите как обычно, без заученных фраз. CORTEX разбирает команду и уточняет, если что-то неясно.", wide: true },
  { icon: "phone", title: "Управляет телефоном", text: "Открывает приложения, меняет яркость, ставит будильники и находит нужные настройки.", wide: false },
  { icon: "layers", title: "Сценарии", text: "Несколько действий одной фразой: «режим дороги», «утро», «тишина на встрече».", wide: false },
  { icon: "bell", title: "Напоминания", text: "Скажите, о чём и когда напомнить, — остальное CORTEX возьмёт на себя.", wide: false },
  { icon: "lock", title: "Под вашим контролем", text: "Локальные команды выполняются на телефоне. Звонки, отправку и другие важные действия CORTEX сначала подтверждает.", wide: true },
] as const;

const steps = [
  { title: "Скажите", text: "Нажмите на островок или кнопку и произнесите задачу своими словами." },
  { title: "CORTEX поймёт", text: "Простые команды разбираются на телефоне, сложные запросы — облачным ИИ." },
  { title: "Готово", text: "Действие выполнено, результат виден сразу — без лишних экранов." },
];

const questions = [
  { q: "Что будет бесплатным?", a: "Локальное управление телефоном, сценарии, напоминания и островок. Облачный ИИ тоже доступен бесплатно, но с дневным лимитом." },
  { q: "Когда можно скачать приложение?", a: "Скачивание сейчас закрыто. Дату открытия объявим в Telegram-канале CORTEX и письмом тем, кто согласился получать уведомления." },
  { q: "Куда уходят мои данные?", a: "Локальные действия не покидают телефон. Запросы к облачному ИИ проходят через сервер CORTEX, а текст с экрана передаётся только с отдельного согласия." },
];

export default function Home() {
  return (
    <LandingAccountGate>
      <div className="page">
        <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
        <SiteHeader />

        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="status-chip"><span className="status-dot" /> Бета для Android · скачивание закрыто</p>
              <h1 id="hero-title">Телефон,<br />который <em>слышит.</em></h1>
              <p className="hero-lead">CORTEX управляет Android по вашей команде. Скажите — и приложение откроется, будильник встанет, а напоминание не потеряется.</p>
              <div className="hero-actions">
                <RegistrationCta isOpen={registrationIsOpen()} />
                <DownloadCTA />
              </div>
              <p className="hero-note">Ранним участникам — <strong>+5 000 ИИ-токенов</strong> после запуска.</p>
            </div>

            <div className="voice-orb" aria-hidden="true">
              <div className="orb-ring orb-ring--3" />
              <div className="orb-ring orb-ring--2" />
              <div className="orb-ring orb-ring--1" />
              <div className="orb-core">
                <div className="wave">{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ animationDelay: `${(i % 5) * -0.18}s` }} />)}</div>
              </div>
              <div className="orb-bubble orb-bubble--a">«Поставь будильник на 7:30»</div>
              <div className="orb-bubble orb-bubble--b"><UiIcon name="check" size={14} /> Будильник на 7:30</div>
            </div>
          </section>

          <section className="section" id="features" aria-labelledby="features-title">
            <div className="section-head">
              <p className="eyebrow">Возможности</p>
              <h2 id="features-title">Всё, что вы делаете пальцами, — голосом.</h2>
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
              <p className="eyebrow">Как это работает</p>
              <h2 id="steps-title">Три шага — и задача решена.</h2>
            </div>
            <ol className="steps">
              {steps.map((step, index) => (
                <li key={step.title} className="card step">
                  <span className="step-index">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="section split" aria-label="Тарифы и приватность">
            <div className="card split-card">
              <p className="eyebrow">Тарифы</p>
              <h2>Основное — бесплатно.</h2>
              <p>Подписка увеличивает дневной лимит облачного ИИ и открывает более мощные модели. Без автоматических списаний.</p>
              <a className="glass glass--md" href="/pricing"><span>Смотреть тарифы</span><UiIcon name="arrow-right" size={16} /></a>
            </div>
            <div className="card split-card">
              <p className="eyebrow">Приватность</p>
              <h2>Ваш телефон — ваши правила.</h2>
              <p>Каждое разрешение объясняется заранее и отключается в любой момент. Подробно — в разделе о разрешениях.</p>
              <a className="glass glass--md" href="/permissions"><span>О разрешениях</span><UiIcon name="arrow-right" size={16} /></a>
            </div>
          </section>

          <section className="section" aria-labelledby="faq-title">
            <div className="section-head">
              <p className="eyebrow">Вопросы</p>
              <h2 id="faq-title">Коротко о главном.</h2>
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
              <h2 id="cta-title">Следите за запуском.</h2>
              <p>Новости, обновления и дата открытия скачивания — первыми в канале CORTEX.</p>
              <a className="glass glass--lg glass--light" href="https://t.me/cortexdevlog" target="_blank" rel="noopener noreferrer">
                <UiIcon name="telegram" size={17} /><span>Канал в Telegram</span>
              </a>
            </div>
          </section>
        </main>

        <SiteFooter />
      </div>
    </LandingAccountGate>
  );
}
