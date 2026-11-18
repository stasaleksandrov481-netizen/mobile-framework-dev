/** A verified Auth user is not a completed website registration until its
 * required preregistration record has also been persisted. */
export async function completeVerifiedAccount(
  user: {
    id?: string | null;
    email?: string | null;
    email_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
  } | null,
  persistPreregistration: () => Promise<void>,
): Promise<string> {
  if (!user?.id || !user.email || !user.email_confirmed_at) {
    throw new Error("Подтвердите электронную почту перед продолжением.");
  }
  if (user.user_metadata?.cortex_preregistration === true) {
    await persistPreregistration();
  }
  return user.email.toLowerCase();
}
