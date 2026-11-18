type Lookup = { data: { user_id: string } | null; error: unknown };
type Insert = { error: unknown };

/** An email callback must never overwrite a preference changed after signup. */
export async function insertPreregistrationIfMissing(
  findExisting: () => PromiseLike<Lookup>,
  insertNew: () => PromiseLike<Insert>,
): Promise<void> {
  const { data: existing, error: lookupError } = await findExisting();
  if (lookupError) throw new Error("Не удалось проверить регистрацию. Попробуйте позже.");
  if (existing) return;

  const { error: insertError } = await insertNew();
  if (insertError) {
    // Two tabs confirming one email can race on a unique user_id.
    const { data: concurrent, error: retryError } = await findExisting();
    if (retryError || !concurrent) {
      throw new Error("Не удалось сохранить регистрацию. Попробуйте позже.");
    }
  }
}
