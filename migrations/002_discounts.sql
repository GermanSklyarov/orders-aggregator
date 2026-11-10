ALTER TABLE orders
  ADD COLUMN discount_percent NUMERIC NOT NULL DEFAULT 0
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  ADD COLUMN amount_paid_kop BIGINT;

-- Старые строки не содержат сведений об оплате. Совместимый исходный вариант:
-- без скидки. Исторические скидки требуют отдельного повторного импорта;
-- равные updatedAt по-прежнему считаются stale.
UPDATE orders SET amount_paid_kop = amount_kop;

ALTER TABLE orders
  ALTER COLUMN amount_paid_kop SET NOT NULL,
  ADD CONSTRAINT orders_amount_paid_valid
    CHECK (amount_paid_kop >= 0 AND amount_paid_kop <= amount_kop);
