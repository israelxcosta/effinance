// The desktop app has no subscription: every workspace is treated as a paid one, so it never drops to
// read-only. A trigger rewrites whatever the billing services write to `subscriptions`.

import type { PgliteClient } from './snapshot';

export const LOCAL_PLAN = 'business_monthly';

export async function installLocalLicense(client: Pick<PgliteClient, 'exec'>): Promise<void> {
  await client.exec(`
    create or replace function desktop_local_license() returns trigger language plpgsql as $$
    begin
      new.status := 'active';
      new.plan_code := '${LOCAL_PLAN}';
      new.provider := null;
      new.provider_subscription_id := null;
      new.trial_ends_at := null;
      new.current_period_end := null;
      new.past_due_since := null;
      new.cancel_at_period_end := false;
      return new;
    end $$;
    drop trigger if exists desktop_local_license on subscriptions;
    create trigger desktop_local_license before insert or update on subscriptions
      for each row execute function desktop_local_license();
    update subscriptions set status = 'active';
  `);
}
