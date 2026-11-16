// The operator and the contracting party may be different.
export function legalParty(role: "OPERATOR" | "SELLER") {
  const prefix = `CORTEX_LEGAL_${role}_`;
  const name = process.env[prefix + "NAME"]?.trim();
  const registration = process.env[prefix + "DETAILS"]?.trim();
  const address = process.env[prefix + "ADDRESS"]?.trim();
  return name && registration && address ? { name, registration, address } : null;
}

export const supportUsername = "onetheblather";
export const supportUrl = "https://t.me/" + supportUsername;
