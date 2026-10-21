// Demo data: `pnpm --filter @effinance/api db:seed`

import { env } from '../env';
import { configureKeyring } from '../lib/crypto/keyring';
import { createKeyProvider } from '../setup';
import { createDb } from './client';
import { DEMO_EMAIL, DEMO_PARTNER_EMAIL, DEMO_PASSWORD, seedDemo } from './demo-seed';

// The demo accounts have a published password and the seed deletes any user holding the demo
// e-mails: never against production data (the build ships `dist/seed.js`).
if (env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'yes') {
  console.error('✘ db:seed refuses to run with NODE_ENV=production (demo users have a public password).');
  console.error('  For a disposable staging database only, set ALLOW_DEMO_SEED=yes.');
  process.exit(1);
}

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
