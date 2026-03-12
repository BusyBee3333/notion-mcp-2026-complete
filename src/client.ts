// Notion API Client
// Handles auth, request timeouts, circuit breaker, retry, and rate limiting
// Notion API v1 — https://api.notion.com/v1
// Header: Authorization: Bearer TOKEN, Notion-Version: 2022-06-28

import { logger } from "./logger.js";

export const NOTION_BASE_URL = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================
// CIRCUIT BREAKER
// ============================================
type CircuitState = "closed" | "open" | "half-open";

class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenLock = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        if (!this.halfOpenLock) {
          this.halfOpenLock = true;
          this.state = "half-open";
          logger.info("circuit_breaker.half_open");
          return true;
        }
        return false;
      }
      return false;
    }
    return false;
  }

  recordSuccess(): void {
    this.halfOpenLock = false;
    if (this.state !== "closed") {
      logger.info("circuit_breaker.closed", { previousFailures: this.failureCount });
    }
    this.failureCount = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.halfOpenLock = false;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold || this.state === "half-open") {
      this.state = "open";
      logger.warn("circuit_breaker.open", {
        failureCount: this.failureCount,
        resetAfterMs: this.resetTimeoutMs,
      });
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// ============================================
// NOTION API CLIENT
// ============================================
export class NotionClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private circuitBreaker: CircuitBreaker;

  constructor(apiKey: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.apiKey = apiKey;
    this.baseUrl = NOTION_BASE_URL;
    this.timeoutMs = timeoutMs;
    this.circuitBreaker = new CircuitBreaker();
  }

  private getHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...extra,
    };
  }

  async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error("Circuit breaker is open — Notion API unavailable. Retry after 60 seconds.");
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      const requestId = logger.requestId();
      const start = performance.now();

      try {
        logger.debug("api_request.start", {
          requestId,
          method: options.method || "GET",
          endpoint,
          attempt: attempt + 1,
        });

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          signal: controller.signal,
          headers: this.getHeaders(options.headers as Record<string, string> || {}),
        });

        const durationMs = Math.round(performance.now() - start);

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") || "5", 10);
          logger.warn("api_request.rate_limited", { requestId, retryAfter, endpoint });
          await this.delay(retryAfter * 1000);
          continue;
        }

        if (response.status >= 500) {
          this.circuitBreaker.recordFailure();
          lastError = new Error(`Server error: ${response.status} ${response.statusText}`);
          logger.warn("api_request.server_error", { requestId, durationMs, status: response.status, endpoint, attempt: attempt + 1 });
          const baseDelay = RETRY_BASE_DELAY * Math.pow(2, attempt);
          const jitter = Math.random() * baseDelay * 0.5;
          await this.delay(baseDelay + jitter);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = errorBody;
          try {
            const parsed = JSON.parse(errorBody);
            errorMessage = parsed.message || parsed.error || errorBody;
          } catch {}
          logger.error("api_request.client_error", { requestId, durationMs, status: response.status, endpoint, body: errorBody.slice(0, 500) });
          throw new Error(`Notion API error ${response.status}: ${errorMessage}`);
        }

        this.circuitBreaker.recordSuccess();
        logger.debug("api_request.done", { requestId, durationMs, status: response.status, endpoint });

        if (response.status === 204) {
          return { success: true } as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          this.circuitBreaker.recordFailure();
          lastError = new Error(`Request timeout after ${this.timeoutMs}ms: ${endpoint}`);
          logger.error("api_request.timeout", { endpoint, timeoutMs: this.timeoutMs });
          continue;
        }
        if (error instanceof Error && !error.message.startsWith("Server error")) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T = unknown>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async delete<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  async healthCheck(): Promise<{ reachable: boolean; authenticated: boolean; latencyMs: number; error?: string; integrationInfo?: unknown }> {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`${this.baseUrl}/users/me`, {
          signal: controller.signal,
          headers: this.getHeaders(),
        });
        const latencyMs = Math.round(performance.now() - start);
        if (response.ok) {
          const info = await response.json();
          return { reachable: true, authenticated: true, latencyMs, integrationInfo: info };
        }
        return {
          reachable: true,
          authenticated: false,
          latencyMs,
          error: `Status ${response.status}`,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return {
        reachable: false,
        authenticated: false,
        latencyMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
