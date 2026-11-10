import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  amountKop: number;
  amountPaidKop: number;
  discountPercent: number;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

interface Row {
  id: string;
  customer_id: string;
  amount_kop: string;
  amount_paid_kop: string;
  discount_percent: string;
  status: Order["status"];
  created_at: Date;
  updated_at: Date;
}

const fromRow = (r: Row): Order => ({
  id: r.id,
  customerId: r.customer_id,
  amountKop: Number(r.amount_kop),
  amountPaidKop: Number(r.amount_paid_kop),
  discountPercent: Number(r.discount_percent),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Order | null> {
    const { rows } = await this.db.query<Row>(`SELECT * FROM orders WHERE id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async save(o: Order): Promise<"created" | "updated" | "stale"> {
    const values = [o.id, o.customerId, o.amountKop, o.status, o.createdAt, o.updatedAt, o.amountPaidKop, o.discountPercent];
    const inserted = await this.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at, amount_paid_kop, discount_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      values,
    );
    if (inserted.rowCount) return "created";

    // Проверка версии и запись атомарны под блокировкой строки PostgreSQL.
    // Два оператора позволяют отличить created от updated без системных полей PG.
    const updated = await this.db.query(
      `UPDATE orders SET customer_id = $2, amount_kop = $3, status = $4,
         created_at = $5, updated_at = $6, amount_paid_kop = $7, discount_percent = $8
       WHERE id = $1 AND updated_at < $6 RETURNING id`,
      values,
    );
    return updated.rowCount ? "updated" : "stale";
  }

  /** Оплаченные заказы клиента, созданные в [from, to). */
  async paidCreatedBetween(customerId: string, from: Date, to: Date): Promise<Order[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [customerId, from, to],
    );
    return rows.map(fromRow);
  }
}
