export interface OrchestorAIIssue {
  id: string;
  identifier: string | null;
  title: string;
  companyId: string;
  status: string;
  priority: string;
}

export interface OrchestorAIIssueComment {
  id: string;
  issueId: string;
  body: string;
}

export class OrchestorAIApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "OrchestorAIApiError";
  }
}

export class OrchestorAIClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
  ) {}

  private async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const headers = new Headers();
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new OrchestorAIApiError(
        `OrchestorAI API request failed: ${method} ${route} -> ${response.status}`,
        response.status,
        responseBody,
      );
    }

    return (await response.json()) as T;
  }

  getIssue(issueRef: string): Promise<OrchestorAIIssue> {
    return this.request<OrchestorAIIssue>("GET", `/issues/${encodeURIComponent(issueRef)}`);
  }

  createIssue(input: {
    companyId: string;
    title: string;
    description: string | null;
  }): Promise<OrchestorAIIssue> {
    return this.request<OrchestorAIIssue>("POST", `/companies/${input.companyId}/issues`, {
      title: input.title,
      description: input.description,
    });
  }

  addIssueComment(issueId: string, body: string): Promise<OrchestorAIIssueComment> {
    return this.request<OrchestorAIIssueComment>("POST", `/issues/${encodeURIComponent(issueId)}/comments`, {
      body,
    });
  }
}
