import knexFactory from 'knex';
import { config } from '../config.js';
import { migrationSource } from './migrations.js';

export const db = knexFactory({
  client: 'pg',
  connection: config.databaseUrl,
  pool: { min: 2, max: 20 },
  acquireConnectionTimeout: 20_000,
});

export async function migrate() {
  await db.migrate.latest({ migrationSource, disableMigrationsListValidation: true });
}
