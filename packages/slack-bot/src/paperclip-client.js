function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function readResponseBody(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  const text = await response.text();
  return text ? { message: text } : {};
}

async function toMessageData(raw) {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw.text === "function") {
    return await raw.text();
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  return String(raw || "");
}

export class PaperclipClient {
  constructor(params) {
    this.apiUrl = trimTrailingSlash(params.apiUrl);
    this.companyId = String(params.companyId || "").trim();
    this.fetchImpl = params.fetchImpl || globalThis.fetch;
    this.WebSocketImpl = params.WebSocketImpl || globalThis.WebSocket;
    this.log = typeof params.log === "function" ? params.log : () => {};
    this.agentCache = {
      expiresAt: 0,
      value: [],
    };
    this.projectCache = {
      expiresAt: 0,
      value: [],
    };
    this.issueCache = {
      expiresAt: 0,
      key: "",
      value: [],
    };
  }

  buildUrl(pathname) {
    return `${this.apiUrl}${pathname}`;
  }

  async requestJson(method, pathname, body) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch is not available in this runtime");
    }

    const response = await this.fetchImpl(this.buildUrl(pathname), {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorBody = await readResponseBody(response);
      const detail =
        typeof errorBody?.error === "string"
          ? errorBody.error
          : typeof errorBody?.message === "string"
            ? errorBody.message
            : JSON.stringify(errorBody);
      throw new Error(`${method} ${pathname} failed (${response.status}): ${detail}`);
    }

    return await readResponseBody(response);
  }

  async listAgents(options = {}) {
    const force = Boolean(options.force);
    if (!force && this.agentCache.expiresAt > Date.now()) {
      return this.agentCache.value;
    }
    const agents = await this.requestJson("GET", `/api/companies/${this.companyId}/agents`);
    this.agentCache = {
      expiresAt: Date.now() + 60 * 1000,
      value: Array.isArray(agents) ? agents : [],
    };
    return this.agentCache.value;
  }

  async getAgentName(agentId) {
    if (!agentId) {
      return "";
    }
    const agents = await this.listAgents();
    const matched = agents.find((agent) => String(agent?.id || "") === String(agentId));
    return String(matched?.name || "");
  }

  async listProjects(options = {}) {
    const force = Boolean(options.force);
    if (!force && this.projectCache.expiresAt > Date.now()) {
      return this.projectCache.value;
    }
    const projects = await this.requestJson("GET", `/api/companies/${this.companyId}/projects`);
    this.projectCache = {
      expiresAt: Date.now() + 60 * 1000,
      value: Array.isArray(projects) ? projects : [],
    };
    return this.projectCache.value;
  }

  buildIssueQuery(options = {}) {
    const params = new URLSearchParams();
    for (const key of ["status", "assigneeAgentId", "projectId", "q"]) {
      const value = String(options[key] || "").trim();
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  invalidateIssueCache() {
    this.issueCache = {
      expiresAt: 0,
      key: "",
      value: [],
    };
  }

  async listIssues(options = {}) {
    const force = Boolean(options.force);
    const query = this.buildIssueQuery(options);
    if (!force && this.issueCache.expiresAt > Date.now() && this.issueCache.key === query) {
      return this.issueCache.value;
    }
    const issues = await this.requestJson("GET", `/api/companies/${this.companyId}/issues${query}`);
    this.issueCache = {
      expiresAt: Date.now() + 15 * 1000,
      key: query,
      value: Array.isArray(issues) ? issues : [],
    };
    return this.issueCache.value;
  }

  async getIssue(issueId) {
    if (!issueId) {
      throw new Error("issueId is required");
    }
    return await this.requestJson("GET", `/api/issues/${issueId}`);
  }

  async listIssueComments(issueId) {
    if (!issueId) {
      throw new Error("issueId is required");
    }
    const comments = await this.requestJson("GET", `/api/issues/${issueId}/comments`);
    return Array.isArray(comments) ? comments : [];
  }

  async createIssue(body) {
    const issue = await this.requestJson("POST", `/api/companies/${this.companyId}/issues`, body);
    this.invalidateIssueCache();
    return issue;
  }

  async addIssueComment(issueId, body) {
    const comment = await this.requestJson("POST", `/api/issues/${issueId}/comments`, {
      body,
    });
    this.invalidateIssueCache();
    return comment;
  }

  async getRunIssues(runId) {
    const issues = await this.requestJson("GET", `/api/heartbeat-runs/${runId}/issues`);
    return Array.isArray(issues) ? issues : [];
  }

  subscribeLiveEvents(handlers = {}) {
    if (typeof this.WebSocketImpl !== "function") {
      throw new Error("WebSocket is not available in this runtime");
    }

    let stopped = false;
    let socket = null;
    let reconnectTimer = null;
    let reconnectDelayMs = 1000;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped) {
        return;
      }
      clearReconnect();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
    };

    const connect = () => {
      clearReconnect();
      const wsUrl = this.buildUrl(`/api/companies/${this.companyId}/events/ws`).replace(/^http/i, "ws");
      socket = new this.WebSocketImpl(wsUrl);

      socket.addEventListener("open", () => {
        reconnectDelayMs = 1000;
        if (typeof handlers.onOpen === "function") {
          handlers.onOpen();
        }
      });

      socket.addEventListener("message", async (event) => {
        try {
          const data = await toMessageData(event.data);
          const parsed = JSON.parse(data);
          if (typeof handlers.onEvent === "function") {
            await handlers.onEvent(parsed);
          }
        } catch (err) {
          this.log("warn", `paperclip live event parse failed: ${String(err)}`);
        }
      });

      socket.addEventListener("error", (event) => {
        const message = event?.message || event?.error?.message || "paperclip websocket error";
        if (typeof handlers.onError === "function") {
          handlers.onError(new Error(String(message)));
        }
      });

      socket.addEventListener("close", () => {
        if (typeof handlers.onClose === "function") {
          handlers.onClose();
        }
        if (!stopped) {
          scheduleReconnect();
        }
      });
    };

    connect();

    return () => {
      stopped = true;
      clearReconnect();
      if (socket && socket.readyState === this.WebSocketImpl.OPEN) {
        socket.close();
      } else if (socket && typeof socket.close === "function") {
        socket.close();
      }
    };
  }
}
