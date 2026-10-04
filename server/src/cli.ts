// Maintenance commands, run inside the server container:
//
//   docker compose exec server node dist/src/cli.js reset-password <username> [new-password]
//   docker compose exec server node dist/src/cli.js create-admin <username> <password>
//   docker compose exec server node dist/src/cli.js list-users
//
// Without a password, reset-password generates one and prints it.
import crypto from 'node:crypto';
import { db, migrate } from './db/knex.js';
import { hashPassword, newUserCode, type UserRow } from './services/users.js';

const [cmd, username, password] = process.argv.slice(2);

function usage(): never {
  console.log(`Usage :
  node dist/src/cli.js reset-password <identifiant> [nouveau-mot-de-passe]
  node dist/src/cli.js create-admin <identifiant> <mot-de-passe>
  node dist/src/cli.js list-users`);
  process.exit(1);
}

async function main() {
  await migrate();
  switch (cmd) {
    case 'list-users': {
      const rows = await db<UserRow>('users').orderBy('created_at').select('username', 'role', 'auth_provider', 'disabled');
      for (const u of rows) console.log(`${u.username.padEnd(28)} ${u.role.padEnd(6)} ${u.auth_provider.padEnd(6)}${u.disabled ? ' (désactivé)' : ''}`);
      if (!rows.length) console.log('Aucun utilisateur : le compte admin sera créé au prochain démarrage.');
      return;
    }
    case 'reset-password': {
      if (!username) usage();
      const user = await db<UserRow>('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).first();
      if (!user) { console.error(`Utilisateur introuvable : ${username} (voir list-users)`); process.exitCode = 1; return; }
      if (user.auth_provider !== 'local') { console.error(`${user.username} est un compte SSO : pas de mot de passe local.`); process.exitCode = 1; return; }
      const pw = password || crypto.randomBytes(12).toString('base64url');
      if (pw.length < 8) { console.error('Le mot de passe doit faire au moins 8 caractères.'); process.exitCode = 1; return; }
      await db('users').where({ id: user.id }).update({ password_hash: await hashPassword(pw), disabled: false });
      await db('audit_log').insert({ action: 'user.password_reset_cli', target: user.username, meta: '{}' });
      console.log(`Mot de passe de « ${user.username} » réinitialisé${password ? '.' : ` : ${pw}`}`);
      return;
    }
    case 'create-admin': {
      if (!username || !password) usage();
      if (password.length < 8) { console.error('Le mot de passe doit faire au moins 8 caractères.'); process.exitCode = 1; return; }
      const name = username.toLowerCase();
      if (await db('users').where({ username: name }).first()) { console.error(`${name} existe déjà : utilisez reset-password.`); process.exitCode = 1; return; }
      await db('users').insert({
        username: name, display_name: 'Administrateur', password_hash: await hashPassword(password),
        role: 'admin', auth_provider: 'local', user_code: await newUserCode(),
      });
      await db('audit_log').insert({ action: 'user.created_cli', target: name, meta: '{}' });
      console.log(`Administrateur « ${name} » créé.`);
      return;
    }
    default:
      usage();
  }
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => db.destroy());
