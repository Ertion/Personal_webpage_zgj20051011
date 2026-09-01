PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ledger_transactions (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL CHECK (account IN ('微信', '支付宝', '银行卡')),
    subcategory TEXT NOT NULL CHECK (
        subcategory IN (
            '餐饮食品', '日用购物', '交通出行', '数码学习',
            '生活健康', '娱乐订阅', '人情往来', '资金流转'
        )
    ),
    note TEXT NOT NULL DEFAULT '',
    source_detail TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL CHECK (direction IN ('income', 'expense', 'neutral')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    occurred_at TEXT NOT NULL,
    source_key TEXT NOT NULL UNIQUE,
    source_status TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_account_occurred
ON ledger_transactions(account, occurred_at DESC);

CREATE TABLE IF NOT EXISTS ledger_balances (
    account TEXT NOT NULL CHECK (account IN ('微信', '支付宝', '银行卡')),
    month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    balance_cents INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account, month)
);

CREATE INDEX IF NOT EXISTS idx_ledger_balances_month
ON ledger_balances(month, account);

PRAGMA optimize;
