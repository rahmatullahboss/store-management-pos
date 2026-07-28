export interface ApiClientOptions { readonly baseUrl: string; readonly token: () => Promise<string>; readonly requestId: () => string }
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.options.token();
    const response = await fetch(new URL(path, this.options.baseUrl), {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-request-id": this.options.requestId(), ...init.headers },
    });
    const body = await response.json() as unknown;
    if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
    return body as T;
  }
}
