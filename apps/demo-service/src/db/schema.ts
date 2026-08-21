import { pgTable, text, timestamp, integer, boolean, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  plan: text('plan').default('starter').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  uniqueIndex('idx_org_slug').on(table.slug)
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role').default('member').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  uniqueIndex('idx_user_email').on(table.email),
  index('idx_user_org').on(table.orgId)
]);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  keyHash: text('key_hash').notNull(),
  label: text('label').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  uniqueIndex('idx_api_key_hash').on(table.keyHash)
  // Note: intentionally missing index on orgId to test Drizzle Sentinel's unindexed foreign key detection!
]);

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').default('USD').notNull(),
  status: text('status').default('pending').notNull(),
  dueDate: timestamp('due_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  index('idx_invoice_org_status').on(table.orgId, table.status)
]);
