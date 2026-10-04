import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from './knex.js';
import { hashPassword, newUserCode } from '../services/users.js';

/** First boot: create the initial local administrator. */
export async function bootstrap() {
  const any = await db('users').first('id');
  if (any) {
    // Created on first boot only: later changes to DEFAULT_ADMIN_* have no effect.
    logger.info('users already exist: DEFAULT_ADMIN_* ignored (reset: node dist/src/cli.js reset-password <user>)');
    return;
  }
  const { username, password } = config.defaultAdmin;
  await db('users').insert({
    username: username.toLowerCase(),
    display_name: 'Administrateur',
    password_hash: await hashPassword(password),
    role: 'admin',
    auth_provider: 'local',
    user_code: await newUserCode(),
  });
  logger.warn({ username }, 'initial admin account created — change its password');
}
