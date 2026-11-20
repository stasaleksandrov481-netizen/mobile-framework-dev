import LandingAccountGate from "@/components/LandingAccountGate";
import LandingDetails from "@/components/LandingDetails";
import SilkHero from "@/components/SilkHero";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { registrationIsOpen } from "@/lib/registration-gate";
import "./landing-details.css";

// The registration gate is an operator switch; re-check it at most once a minute.
export const revalidate = 60;

export default function Home() {
  const registrationOpen = registrationIsOpen();
  return (
    <LandingAccountGate>
      <div className="page">
        <SiteHeader />
        <main className="landing-home">
          <SilkHero registrationOpen={registrationOpen} />
          <LandingDetails registrationOpen={registrationOpen} />
        </main>
        <SiteFooter />
      </div>
    </LandingAccountGate>
  );
}
