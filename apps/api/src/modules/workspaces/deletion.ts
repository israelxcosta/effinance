// Everything that must happen outside our database before workspaces are deleted (alone, or with
// the account that owns them). Runs after the confirmation checks and before any row is deleted; a
// failure aborts the deletion so the user can retry (nothing is left half-revoked silently).

import type { DbExecutor } from '../../db/client';
import type { Platform } from '../../lib/platform';
import { cancelForDeletion } from '../billing/service';
import { revokeForDeletion, type LogLike } from '../open-finance/service';

export async function prepareWorkspaceDeletion(
  db: DbExecutor,
  platform: Platform,
  workspaceIds: string[],
  log?: LogLike,
): Promise<void> {
  // Bank data access first: the aggregator deletes the item and everything it collected.
  await revokeForDeletion({ db, of: platform.openFinance, log }, workspaceIds);
  await cancelForDeletion(db, platform, workspaceIds);
}
