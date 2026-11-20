import Link from "next/link";

export default function PricingBuyButton({ plan }: { plan: string }) {
  if (plan !== "start" && plan !== "pro" && plan !== "ultra") return null;
  return <Link className="glass glass--md glass--block" href={`/payment?plan=${plan}`}>
    Выбрать оплату
  </Link>;
}
