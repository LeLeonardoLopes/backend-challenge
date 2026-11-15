-- Database schema initialization with strict database constraints

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL,
  currency VARCHAR(3) NOT NULL,
  balance NUMERIC(18, 2) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_wallet_balance_not_negative CHECK (balance >= 0),
  CONSTRAINT unique_player_currency UNIQUE (player_id, currency)
);
CREATE INDEX IF NOT EXISTS idx_wallets_player ON wallets (player_id);

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount NUMERIC(18, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  balance_before NUMERIC(18, 2) NOT NULL,
  balance_after NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_cursor ON wallet_ledger_entries (wallet_id, created_at, id);

CREATE TABLE IF NOT EXISTS wager_transactions (
  id UUID PRIMARY KEY,
  provider_id VARCHAR(50) NOT NULL,
  external_transaction_id VARCHAR(100) NOT NULL,
  idempotency_key VARCHAR(150) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL,
  round_id VARCHAR(100) NOT NULL,
  game_id VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  reference_external_transaction_id VARCHAR(100),
  reference_transaction_id UUID,
  status VARCHAR(30) NOT NULL,
  failure_code VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT unique_provider_external_id UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT unique_idempotency_key UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_wager_pending_ref ON wager_transactions (status, created_at) WHERE status = 'PENDING_REFERENCE';
CREATE INDEX IF NOT EXISTS idx_wager_wallet ON wager_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_wager_player ON wager_transactions (player_id);

CREATE TABLE IF NOT EXISTS inbox_messages (
  message_id VARCHAR(100) NOT NULL,
  consumer_name VARCHAR(100) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (consumer_name, message_id)
);

CREATE TABLE IF NOT EXISTS outbox_messages (
  id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_messages (published_at, next_attempt_at) WHERE published_at IS NULL;
