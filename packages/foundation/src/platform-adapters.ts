export interface ObjectStore { put(key: string, value: ArrayBuffer | ReadableStream, metadata: { contentType: string; checksum: string }): Promise<void>; get(key: string): Promise<Response | null> }
export interface QueuePublisher<T> { send(message: T): Promise<void> }
export interface WorkflowStarter<T> { start(instanceId: string, payload: T): Promise<void> }
export interface CoordinationLock { runExclusive<T>(key: string, work: () => Promise<T>): Promise<T> }
export interface ConfigurationCache { get<T>(key: string): Promise<T | null>; set<T>(key: string, value: T, ttlSeconds: number): Promise<void>; delete(key: string): Promise<void> }
export interface FeatureDecision { enabled: boolean; reason: "plan" | "flag" | "default" | "override" }
export interface FeatureFlagService { evaluate(key: string, context: Readonly<Record<string, string>>): Promise<FeatureDecision> }
