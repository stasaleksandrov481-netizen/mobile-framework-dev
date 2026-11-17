import type { Metadata } from "next";
import { AccountDashboard } from "@/components/AccountDashboard";
import "./account.css";

export const metadata: Metadata = {
  title: "Личный кабинет — CORTEX",
  description: "Профиль, статус раннего доступа и баланс ИИ-токенов CORTEX.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountDashboard />;
}
