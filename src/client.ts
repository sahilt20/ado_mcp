import { AdoConfig } from './config.js';

export class AdoClient {
  private baseUrl: string;
  private vsrmUrl: string;
  private searchUrl: string;
  private authHeader: string;
  public defaultProject: string;

  constructor(config: AdoConfig) {
    this.baseUrl = config.orgUrl;
    this.defaultProject = config.defaultProject;
    this.authHeader = `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`;

    // Derive org name for alternate base URLs
    const orgName = this.extractOrgName(config.orgUrl);
    this.vsrmUrl = config.orgUrl.includes('.visualstudio.com')
      ? config.orgUrl.replace('.visualstudio.com', '.vsrm.visualstudio.com')
      : `https://vsrm.dev.azure.com/${orgName}`;
    this.searchUrl = `https://almsearch.dev.azure.com/${orgName}`;
  }

  private extractOrgName(url: string): string {
    // https://dev.azure.com/myorg → myorg
    const devMatch = url.match(/dev\.azure\.com\/([^/]+)/);
    if (devMatch) return devMatch[1];
    // https://myorg.visualstudio.com → myorg
    const vsMatch = url.match(/https?:\/\/([^.]+)\.visualstudio\.com/);
    if (vsMatch) return vsMatch[1];
    return url.split('/').pop() || '';
  }

  private buildUrl(base: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith('http') ? path : `${base}/${path.replace(/^\//, '')}`);
    if (!url.searchParams.has('api-version')) {
      url.searchParams.set('api-version', '7.1');
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }

  async get<T = any>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(this.baseUrl, path, params);
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Azure DevOps API error ${res.status}: ${res.statusText}\n${body}`);
    }
    return res.json() as Promise<T>;
  }

  async post<T = any>(path: string, body: any, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(this.baseUrl, path, params);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Azure DevOps API error ${res.status}: ${res.statusText}\n${errBody}`);
    }
    return res.json() as Promise<T>;
  }

  async getText(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<string> {
    const url = this.buildUrl(this.baseUrl, path, params);
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Azure DevOps API error ${res.status}: ${res.statusText}\n${body}`);
    }
    return res.text();
  }

  // Release API uses a different host
  async getReleaseApi<T = any>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(this.vsrmUrl, path, params);
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Azure DevOps Release API error ${res.status}: ${res.statusText}\n${body}`);
    }
    return res.json() as Promise<T>;
  }

  // Search API uses a different host
  async searchCode<T = any>(path: string, body: any): Promise<T> {
    const url = this.buildUrl(this.searchUrl, path);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Azure DevOps Search API error ${res.status}: ${res.statusText}\n${errBody}`);
    }
    return res.json() as Promise<T>;
  }

  resolveProject(project?: string): string {
    const p = project || this.defaultProject;
    if (!p) throw new Error('Project name is required. Either provide it as a parameter or set ADO_DEFAULT_PROJECT environment variable.');
    return p;
  }
}
