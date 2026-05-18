import { DEFAULT_ISSUE_LIST_SORT, ISSUE_LIST_SORTS, sortIssuesByListSort, type IssueListSort } from "@orchestorai/shared";

export const statusOrder = ["in_progress", "todo", "backlog", "in_review", "blocked", "done", "cancelled"];
export const priorityOrder = ["critical", "high", "medium", "low"];

export type IssueViewSortField = IssueListSort | "status" | "title" | "created" | "updated";
export type IssueViewSortDirection = "asc" | "desc";

export type IssueViewSortable = {
  id: string;
  title: string;
  status: string;
  priority: string;
  etaAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export const defaultIssueListViewState = {
  sortField: DEFAULT_ISSUE_LIST_SORT as IssueViewSortField,
  sortDir: "asc" as IssueViewSortDirection,
};

function toTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function getIssueApiSortField(sortField: IssueViewSortField): IssueListSort | undefined {
  return (ISSUE_LIST_SORTS as readonly string[]).includes(sortField) ? (sortField as IssueListSort) : undefined;
}

export function sortIssuesForView<T extends IssueViewSortable>(
  issues: T[],
  state: { sortField: IssueViewSortField; sortDir: IssueViewSortDirection },
): T[] {
  const dir = state.sortDir === "asc" ? 1 : -1;
  const apiSort = getIssueApiSortField(state.sortField);
  if (apiSort) {
    const sorted = sortIssuesByListSort(issues, apiSort);
    return dir === 1 ? sorted : [...sorted].reverse();
  }

  const sorted = [...issues];
  sorted.sort((a, b) => {
    switch (state.sortField) {
      case "status":
        return dir * (statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "created":
        return dir * (toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
      case "updated":
        return dir * (toTimestamp(a.updatedAt) - toTimestamp(b.updatedAt));
      default:
        return 0;
    }
  });
  return sorted;
}
