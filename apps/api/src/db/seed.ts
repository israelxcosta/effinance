// Demo data: `pnpm --filter @effinance/api db:seed`

import { env } from '../env';
import { configureKeyring } from '../lib/crypto/keyring';
import { createKeyProvider } from '../setup';
import { createDb } from './client';
import { DEMO_EMAIL, DEMO_PARTNER_EMAIL, DEMO_PASSWORD, seedDemo } from './demo-seed';

const { db, client } = createDb();
createKeyProvider(env)
  .then((provider) => {
    configureKeyring({ provider, db });
    return seedDemo(db);
  })
  .then(({ transactions: n }) => {
    console.log(`✔ demo data ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (${n} lançamentos)`);
    console.log(`  espaço compartilhado "Família Costa" com ${DEMO_PARTNER_EMAIL} / ${DEMO_PASSWORD}`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
