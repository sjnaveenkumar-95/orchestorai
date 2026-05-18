import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { dashboardService } from "../services/dashboard.ts";

type QuerySpec = {
  result: unknown[];
  table?: unknown;
  where?: unknown;
};

class FakeQuery<T = unknown> {
  constructor(private readonly spec: QuerySpec) {}

  from(table: unknown) {
    this.spec.table = table;
    return this;
  }

  where(condition: unknown) {
    this.spec.where = condition;
    return this;
  }

  groupBy(..._columns: unknown[]) {
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.spec.result as T[]).then(onfulfilled, onrejected);
  }
}

function createFakeDb(specs: QuerySpec[]) {
  let index = 0;
  return {
    select() {
      const spec = specs[index];
      index += 1;
      if (!spec) throw new Error("Unexpected select() call");
      return new FakeQuery(spec);
    },
  };
}

function toSql(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]).sql;
}

describe("dashboardService.summary", () => {
  it("excludes hidden issues from task totals and stale-task counts", async () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    const queries: QuerySpec[] = [
      { result: [{ id: companyId, budgetMonthlyCents: 2_000 }] },
      { result: [{ status: "idle", count: 1 }] },
      {
        result: [
          { status: "todo", count: 2 },
          { status: "blocked", count: 1 },
          { status: "done", count: 1 },
        ],
      },
      { result: [{ count: 0 }] },
      { result: [{ count: 1 }] },
      { result: [{ monthSpend: 250 }] },
    ];

    const summary = await dashboardService(createFakeDb(queries) as never).summary(companyId);

    expect(toSql(queries[2].where)).toContain("\"issues\".\"hidden_at\" is null");
    expect(toSql(queries[4].where)).toContain("\"issues\".\"hidden_at\" is null");
    expect(summary.tasks).toEqual({
      open: 3,
      inProgress: 0,
      blocked: 1,
      done: 1,
    });
    expect(summary.staleTasks).toBe(1);
  });
});
