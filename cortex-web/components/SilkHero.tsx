import RegistrationCta from "@/components/RegistrationCta";
import SilkBackground from "@/components/SilkBackground";

export default function SilkHero({ registrationOpen }: { registrationOpen: boolean }) {
  return (
    <section className="silk-hero" aria-labelledby="hero-title">
      <SilkBackground intensity={1} shade={.66} className="silk--hero" />
      <div className="silk-hero-inner">
        <p className="silk-badge rise" style={{ "--d": "80ms" } as React.CSSProperties}>
          <span className="silk-badge-dot" aria-hidden="true" />Бета · скачивание закрыто
        </p>
        <h1 id="hero-title" className="silk-title rise" style={{ "--d": "160ms" } as React.CSSProperties}>
          Управляйте Android голосом
        </h1>
        <p className="silk-lead rise" style={{ "--d": "260ms" } as React.CSSProperties}>
          CORTEX откроет приложение, поставит будильник или напомнит о важном.
        </p>
        <div className="silk-actions rise" style={{ "--d": "320ms" } as React.CSSProperties}>
          <RegistrationCta isOpen={registrationOpen} />
          <a className="glass glass--lg" href="#features"><span>Возможности</span></a>
        </div>
      </div>
    </section>
  );
}
