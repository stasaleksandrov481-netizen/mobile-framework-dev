"use client";

import { useEffect, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { EMAIL_OTP_LENGTH } from "@/lib/email-otp";

type Props = { value: string; onChange: (value: string) => void; disabled?: boolean };
const CODE_LENGTH = EMAIL_OTP_LENGTH;

export default function OtpCodeInput({ value, onChange, disabled = false }: Props) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { inputs.current[Math.min(value.length, CODE_LENGTH - 1)]?.focus(); }, []);

  function insert(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    const position = Math.min(index, value.length);
    onChange((value.slice(0, position) + digits + value.slice(position + digits.length)).slice(0, CODE_LENGTH));
    inputs.current[Math.min(position + digits.length, CODE_LENGTH - 1)]?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      const pos = event.key === "Backspace" && !value[index] ? index - 1 : index;
      if (pos >= 0 && pos < value.length) onChange(value.slice(0, pos) + value.slice(pos + 1));
      inputs.current[Math.max(0, pos)]?.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      inputs.current[Math.max(0, Math.min(CODE_LENGTH - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))]?.focus();
    }
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!digits) return;
    event.preventDefault();
    onChange(digits);
    inputs.current[Math.min(digits.length, CODE_LENGTH - 1)]?.focus();
  }

  return (
    <div className="otp-code" role="group" aria-label="Код подтверждения из 6 или 8 цифр" onPaste={paste}>
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <input key={index} id={index === 0 ? "registration-code" : undefined}
          ref={(element) => { inputs.current[index] = element; }} className="otp-digit"
          type="text" inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Цифра ${index + 1} из ${CODE_LENGTH}`} maxLength={CODE_LENGTH} disabled={disabled}
          value={value[index] || ""} onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => insert(index, event.target.value)}
          onKeyDown={(event) => keyDown(event, index)} />
      ))}
    </div>
  );
}
