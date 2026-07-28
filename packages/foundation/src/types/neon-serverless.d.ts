declare module "@neondatabase/serverless" {
  export type QueryResultRow = Record<string, unknown>;
  export type QueryResult<T extends QueryResultRow = QueryResultRow> = { rows: T[]; rowCount: number | null };
  export type QueryFunction = {
    <T extends QueryResultRow = QueryResultRow>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
    query<T extends QueryResultRow = QueryResultRow>(query: string, params?: readonly unknown[]): Promise<T[]>;
    transaction<T>(queries: readonly Promise<T>[]): Promise<T[]>;
  };
  export function neon(connectionString: string): QueryFunction;
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query<T extends QueryResultRow = QueryResultRow>(query: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
  export class Pool {
    constructor(config: { connectionString: string; max?: number; connectionTimeoutMillis?: number; idleTimeoutMillis?: number });
    connect(): Promise<{query<T extends QueryResultRow = QueryResultRow>(query: string, params?: readonly unknown[]): Promise<QueryResult<T>>; release(): void}>;
    end(): Promise<void>;
  }
}
