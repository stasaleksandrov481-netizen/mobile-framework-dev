export type RegistrationMode = "signup" | "verify" | "signin" | "signin_code" | "signin_code_verify" | "recovery";

/** Only messages created by local validation may be displayed verbatim. */
export class RegistrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationValidationError";
  }
}

type RegistrationFields = {
  mode: RegistrationMode;
  email: string;
  password: string;
  accepted: boolean;
  acceptedTerms: boolean;
};

/** Explicit validation keeps the form usable where native mobile tooltips are hidden. */
export function registrationValidationError(fields: RegistrationFields): string | null {
  const address = fields.email.trim();
  if (!address) return "Введите адрес электронной почты.";
  if (address.length > 254 || /\s/.test(address) || !/^[^@]+@[^@]+\.[^@.]{2,}$/.test(address)) {
    return "Введите корректный адрес почты, например name@example.com. Номер телефона здесь не подходит.";
  }
  if (fields.mode === "signup" || fields.mode === "signin") {
    if (!fields.password) return "Введите пароль.";
    if (fields.mode === "signup" && fields.password.length < 10) {
      return "Пароль должен содержать минимум 10 символов.";
    }
  }
  if (fields.mode === "signup") {
    if (!fields.accepted) return "Подтвердите согласие на обработку данных.";
    if (!fields.acceptedTerms) return "Примите условия использования.";
  }
  return null;
}
