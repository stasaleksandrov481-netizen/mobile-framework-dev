import Image from "next/image";

export default function LandingPhone({ className, screen, alt }: {
  className: string;
  screen: string;
  alt: string;
}) {
  return (
    <div className={`landing-phone ${className}`}>
      <Image className="landing-phone-frame" src="/landing/phone-frame.webp" width={720} height={1440} alt="" unoptimized />
      <Image className="landing-phone-screen" key={screen} src={screen} width={640} height={1434} alt={alt} unoptimized />
    </div>
  );
}
