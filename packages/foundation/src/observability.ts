export interface LogContext { requestId: string; traceId: string; tenantId?: string; actorId?: string; module: string }
export interface Logger { info(message: string, fields?: Readonly<Record<string, unknown>>): void; error(message: string, fields?: Readonly<Record<string, unknown>>): void }
export class JsonLogger implements Logger {
  constructor(private readonly context: LogContext) {}
  info(message: string, fields: Readonly<Record<string, unknown>> = {}): void { console.log(JSON.stringify({ level: "info", message, ...this.context, ...fields })); }
  error(message: string, fields: Readonly<Record<string, unknown>> = {}): void { console.error(JSON.stringify({ level: "error", message, ...this.context, ...fields })); }
}
export interface MetricSink { increment(name: string, value?: number, attributes?: Readonly<Record<string, string>>): void; observe(name: string, value: number, attributes?: Readonly<Record<string, string>>): void }
export class NoopMetricSink implements MetricSink { increment(): void {}; observe(): void {} }
