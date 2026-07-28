import type { RequestContext } from "./context.js";
import { PlatformError } from "./errors.js";

export interface SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface TransactionClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
}

interface NeonHttpQuery {
  <Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<Row[]>;
  transaction<Row extends Record<string, unknown> = Record<string, unknown>>(queries: readonly Promise<Row[]>[]): Promise<Row[][]>;
}

interface NeonModule {
  neon(connectionString: string): unknown;
  Client: new (config: { connectionString: string }) => {
    connect(): Promise<void>;
    query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
    end(): Promise<void>;
  };
  Pool: new (config: { connectionString: string; max?: number; connectionTimeoutMillis?: number; idleTimeoutMillis?: number }) => {
    connect(): Promise<{
      query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
      release(): void;
    }>;
    end(): Promise<void>;
  };
}

export type NeonModuleLoader = () => Promise<NeonModule>;
const defaultLoader: NeonModuleLoader = async () => await import("@neondatabase/serverless") as unknown as NeonModule;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly loader?: NeonModuleLoader;
}

function ensureConnectionString(value: string): string {
  if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) throw new PlatformError("DATABASE_UNAVAILABLE", "Database configuration is invalid", 503);
  return value;
}

export class NeonDatabase {
  private readonly loader: NeonModuleLoader;
  private readonly statementTimeoutMs: number;
  private readonly lockTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(private readonly options: DatabaseOptions) {
    ensureConnectionString(options.connectionString);
    this.loader = options.loader ?? defaultLoader;
    this.statementTimeoutMs = options.statementTimeoutMs ?? 5_000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 1_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  }

  async httpQuery<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<readonly Row[]> {
    const { neon } = await this.loader();
    const query = neon(this.options.connectionString) as NeonHttpQuery;
    return await query<Row>(text, values);
  }

  async httpTransaction<Row extends Record<string, unknown>>(queries: readonly { text: string; values?: readonly unknown[] }[]): Promise<readonly (readonly Row[])[]> {
    if (queries.length === 0) return [];
    const { neon } = await this.loader();
    const query = neon(this.options.connectionString) as NeonHttpQuery;
    const prepared = queries.map((statement) => query<Row>(statement.text, statement.values ?? []));
    return await query.transaction(prepared);
  }

  async withClientTransaction<T>(context: RequestContext, work: (client: TransactionClient) => Promise<T>): Promise<T> {
    const { Client } = await this.loader();
    const client = new Client({ connectionString: this.options.connectionString });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${this.statementTimeoutMs}ms`]);
      await client.query("SELECT set_config('lock_timeout', $1, true)", [`${this.lockTimeoutMs}ms`]);
      await client.query(
        "SELECT platform.set_request_context($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::date, $8::text, $9::text)",
        [context.tenantId, context.actorId, context.legalEntityId ?? null, context.storeId ?? null, context.warehouseId ?? null, context.registerId ?? null, context.businessDate, context.requestId, context.traceId],
      );
      const wrapped: TransactionClient = {
        query: async <Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) => {
          const result = await client.query<Row>(text, values);
          return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
        },
      };
      const result = await work(wrapped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (connected) {
        try { await client.query("ROLLBACK"); } catch { /* rollback failure is superseded by the original error */ }
      }
      throw error;
    } finally {
      if (connected) await client.end();
    }
  }

  async withPoolTransaction<T>(context: RequestContext, work: (client: TransactionClient) => Promise<T>): Promise<T> {
    const { Pool } = await this.loader();
    const pool = new Pool({ connectionString: this.options.connectionString, max: 1, connectionTimeoutMillis: this.connectTimeoutMs, idleTimeoutMillis: 1_000 });
    let client: Awaited<ReturnType<InstanceType<typeof Pool>["connect"]>> | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${this.statementTimeoutMs}ms`]);
      await client.query("SELECT set_config('lock_timeout', $1, true)", [`${this.lockTimeoutMs}ms`]);
      await client.query(
        "SELECT platform.set_request_context($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::date, $8::text, $9::text)",
        [context.tenantId, context.actorId, context.legalEntityId ?? null, context.storeId ?? null, context.warehouseId ?? null, context.registerId ?? null, context.businessDate, context.requestId, context.traceId],
      );
      const wrapped: TransactionClient = {
        query: async <Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) => {
          const result = await client!.query<Row>(text, values);
          return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
        },
      };
      const result = await work(wrapped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch { /* rollback failure is superseded by the original error */ }
      }
      throw error;
    } finally {
      client?.release();
      await pool.end();
    }
  }
}
