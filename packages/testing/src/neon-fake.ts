import type { NeonModuleLoader } from "../../foundation/src/db.js";

export interface QueryCall { readonly text: string; readonly values: readonly unknown[] }
export function createFakeNeonLoader(calls: QueryCall[], rows: readonly Record<string, unknown>[] = []): NeonModuleLoader {
  class FakeClient {
    async connect(): Promise<void> { calls.push({ text: "<connect>", values: [] }); }
    async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
      calls.push({ text, values });
      return { rows: rows as Row[], rowCount: rows.length };
    }
    async end(): Promise<void> { calls.push({ text: "<end>", values: [] }); }
  }
  class FakePool {
    async connect(): Promise<{ query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }>; release(): void }> {
      const client = new FakeClient();
      return { query: async <Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) => await client.query<Row>(text, values), release: () => { calls.push({ text: "<release>", values: [] }); } };
    }
    async end(): Promise<void> { calls.push({ text: "<pool-end>", values: [] }); }
  }
  return async () => ({
    neon: () => {
      const query = async <Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<Row[]> => { calls.push({ text, values }); return rows as Row[]; };
      Object.assign(query, { transaction: async <Row extends Record<string, unknown>>(queries: readonly Promise<Row[]>[]): Promise<Row[][]> => await Promise.all(queries) });
      return query;
    },
    Client: FakeClient,
    Pool: FakePool,
  });
}
