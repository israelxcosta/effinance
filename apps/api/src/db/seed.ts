// Demo data: `pnpm --filter @effinance/api db:seed`

import { createDb } from './client';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from './demo-seed';

const { db, client } = createDb();
seedDemo(db)
  .then(({ transactions: n }) => {
    console.log(`✔ demo data ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (${n} lançamentos)`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
