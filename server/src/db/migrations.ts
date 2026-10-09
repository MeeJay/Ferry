import type { Knex } from 'knex';

// Migrations live in code (not loaded from a directory) so the same list works
// under tsx in dev and from the compiled ESM build in the image.
// Append only — never edit a migration that has shipped.

interface Migration { name: string; up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> }

const migrations: Migration[] = [
  {
    name: '001_initial',
    async up(knex) {
      await knex.schema.createTable('quota_profiles', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.text('name').notNullable();
        t.text('description').notNullable().defaultTo('');
        t.integer('max_file_size_mb');
        t.integer('max_share_size_mb');
        t.integer('storage_quota_mb');
        t.integer('default_expiry_hours');
        t.integer('max_expiry_hours');
        t.boolean('allow_never_expire');
        t.boolean('allow_public');
        t.jsonb('link_policy').notNullable().defaultTo('{}');
        t.specificType('oidc_groups', 'text[]').notNullable().defaultTo('{}');
        t.boolean('is_default').notNullable().defaultTo(false);
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('users', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.text('username').notNullable().unique();
        t.text('display_name').notNullable();
        t.text('email');
        t.text('password_hash');
        t.text('role').notNullable().defaultTo('user');
        t.text('auth_provider').notNullable().defaultTo('local');
        t.text('oidc_sub').unique();
        t.text('user_code').notNullable().unique();
        t.text('vanity').unique();
        t.uuid('quota_profile_id').references('quota_profiles.id').onDelete('SET NULL');
        t.jsonb('link_prefs').notNullable().defaultTo('{}');
        t.boolean('disabled').notNullable().defaultTo(false);
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('last_login_at', { useTz: true });
      });

      await knex.schema.createTable('settings', (t) => {
        t.text('key').primary();
        t.jsonb('value').notNullable();
        t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });

      await knex.schema.createTable('requests', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('owner_id').notNullable().references('users.id').onDelete('CASCADE');
        t.text('prefix').notNullable();
        t.text('slug').notNullable();
        t.text('title').notNullable();
        t.text('message');
        t.text('password_hash');
        t.timestamp('expires_at', { useTz: true });
        t.integer('max_files');
        t.integer('max_size_mb');
        t.boolean('active').notNullable().defaultTo(true);
        t.boolean('notify').notNullable().defaultTo(true);
        t.integer('uploads_count').notNullable().defaultTo(0);
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.index(['owner_id']);
      });

      await knex.schema.createTable('shares', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('owner_id').notNullable().references('users.id').onDelete('CASCADE');
        t.text('kind').notNullable().defaultTo('files');
        t.text('prefix');
        t.text('slug');
        t.text('title');
        t.text('message');
        t.text('visibility').notNullable().defaultTo('private');
        t.text('password_hash');
        t.timestamp('expires_at', { useTz: true });
        t.integer('max_downloads');
        t.integer('download_count').notNullable().defaultTo(0);
        t.text('source').notNullable().defaultTo('web');
        t.text('status').notNullable().defaultTo('pending');
        t.uuid('request_id').references('requests.id').onDelete('SET NULL');
        t.text('upload_token').unique();
        t.text('delete_token').notNullable();
        t.bigInteger('total_size').notNullable().defaultTo(0);
        t.integer('file_count').notNullable().defaultTo(0);
        t.integer('expected_files');
        t.text('target_url');
        t.boolean('notify_on_download').notNullable().defaultTo(false);
        t.boolean('download_notified').notNullable().defaultTo(false);
        t.jsonb('link_override');
        t.text('uploader_name');
        t.text('uploader_email');
        t.text('uploader_ip');
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('finalized_at', { useTz: true });
        t.timestamp('purged_at', { useTz: true });
        t.index(['owner_id', 'status']);
        t.index(['status', 'expires_at']);
      });

      await knex.schema.createTable('files', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('share_id').notNullable().references('shares.id').onDelete('CASCADE');
        t.text('name').notNullable();
        t.text('slug').notNullable();
        t.text('mime').notNullable();
        t.bigInteger('size').notNullable();
        t.text('storage_driver').notNullable();
        t.text('storage_key').notNullable();
        t.boolean('has_thumb').notNullable().defaultTo(false);
        t.integer('download_count').notNullable().defaultTo(0);
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.unique(['share_id', 'slug']);
      });

      // One namespace for everything reachable at /{prefix}/{slug}.
      await knex.schema.createTable('links', (t) => {
        t.text('prefix').notNullable();
        t.text('slug').notNullable();
        t.text('kind').notNullable(); // share | request
        t.uuid('target_id').notNullable();
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.primary(['prefix', 'slug']);
        t.index(['target_id']);
      });

      await knex.schema.createTable('api_tokens', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.text('name').notNullable();
        t.text('token_hash').notNullable().unique();
        t.text('token_hint').notNullable();
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('last_used_at', { useTz: true });
      });

      await knex.schema.createTable('audit_log', (t) => {
        t.bigIncrements('id');
        t.uuid('user_id').references('users.id').onDelete('SET NULL');
        t.text('action').notNullable();
        t.text('target');
        t.text('ip');
        t.jsonb('meta').notNullable().defaultTo('{}');
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.index(['created_at']);
      });
    },
    async down(knex) {
      for (const t of ['audit_log', 'api_tokens', 'links', 'files', 'shares', 'requests', 'settings', 'users', 'quota_profiles']) {
        await knex.schema.dropTableIfExists(t);
      }
    },
  },
  {
    name: '002_profile_sharex',
    async up(knex) {
      await knex.schema.alterTable('quota_profiles', (t) => { t.boolean('sharex_enabled'); });
    },
    async down(knex) {
      await knex.schema.alterTable('quota_profiles', (t) => { t.dropColumn('sharex_enabled'); });
    },
  },
  {
    name: '003_registration',
    async up(knex) {
      await knex.schema.alterTable('users', (t) => {
        t.boolean('email_verified').notNullable().defaultTo(true);
        t.boolean('pending_approval').notNullable().defaultTo(false);
      });
      await knex.schema.createTable('invites', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.text('token_hash').notNullable().unique();
        t.text('email');
        t.text('display_name');
        t.text('role').notNullable().defaultTo('user');
        t.uuid('profile_id').references('quota_profiles.id').onDelete('SET NULL');
        t.text('note');
        t.timestamp('expires_at', { useTz: true }).notNullable();
        t.timestamp('used_at', { useTz: true });
        t.uuid('used_by').references('users.id').onDelete('SET NULL');
        t.uuid('created_by').references('users.id').onDelete('SET NULL');
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });
      await knex.schema.createTable('email_tokens', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        t.uuid('user_id').notNullable().references('users.id').onDelete('CASCADE');
        t.text('token_hash').notNullable().unique();
        t.text('purpose').notNullable();
        t.timestamp('expires_at', { useTz: true }).notNullable();
        t.timestamp('used_at', { useTz: true });
        t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      });
    },
    async down(knex) {
      await knex.schema.dropTableIfExists('email_tokens');
      await knex.schema.dropTableIfExists('invites');
      await knex.schema.alterTable('users', (t) => { t.dropColumn('email_verified'); t.dropColumn('pending_approval'); });
    },
  },
  {
    name: '004_user_upload_parallel',
    async up(knex) {
      await knex.schema.alterTable('users', (t) => { t.smallint('upload_parallel'); });
    },
    async down(knex) {
      await knex.schema.alterTable('users', (t) => { t.dropColumn('upload_parallel'); });
    },
  },
];

export const migrationSource: Knex.MigrationSource<Migration> = {
  getMigrations: async () => migrations,
  getMigrationName: (m) => m.name,
  getMigration: async (m) => ({ up: m.up, down: m.down }),
};
