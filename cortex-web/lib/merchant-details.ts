// Public legal identities are supplied only through server-side deployment
// configuration. Never commit real people’s names or INNs into a public repo.
type OperatorSlot = "OPERATOR_A" | "OPERATOR_B";
type LegalPerson = { name: string; registration: string; address: string | null };

function validPersonalInn(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = (weights: number[]) => weights.reduce((sum, weight, i) => sum + weight * digits[i], 0) % 11 % 10;
  return checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0]) === digits[10] &&
    checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11];
}

function legalPerson(slot: OperatorSlot): LegalPerson | null {
  const prefix = `CORTEX_LEGAL_${slot}_`;
  const name = process.env[prefix + "NAME"]?.trim();
  const inn = process.env[prefix + "INN"]?.trim();
  const address = process.env[prefix + "ADDRESS"]?.trim() || null;
  if (!name || !inn || !validPersonalInn(inn)) return null;
  return { name, registration: `Самозанятый (плательщик НПД), ИНН ${inn}`, address };
}

/** Both co-operators jointly determine how CORTEX handles personal data. */
export function dataOperators(): LegalPerson[] {
  return [legalPerson("OPERATOR_A"), legalPerson("OPERATOR_B")]
    .filter((person): person is LegalPerson => person !== null);
}

/** The second co-operator is the sole merchant of paid subscriptions. */
export function paymentMerchant() {
  return legalPerson("OPERATOR_B");
}

export function operatorDetailsComplete() {
  const operators = dataOperators();
  return operators.length === 2 && operators.every(operator => operator.address !== null);
}

export const supportUsername = "onetheblather";
export const supportUrl = "https://t.me/" + supportUsername;
