import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from './knex.js';
import { hashPassword, newUserCode } from '../services/users.js';

/** First boot: create the initial local administrator. */
export async function bootstrap() {
  const any = await db('users').first('id');
  if (any) return;
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
