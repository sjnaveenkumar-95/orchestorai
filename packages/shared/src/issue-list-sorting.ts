import { ISSUE_LIST_SORTS, ISSUE_PRIORITIES, type IssueListSort, type IssuePriority } from "./constants.js";

export type IssueListSortable = {
  status: string;
  priority: string;
  etaAt: Date | string | null;
  updatedAt: Date | string;
};

export const DEFAULT_ISSUE_LIST_SORT: IssueListSort = "eta_urgency";

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);
const ISSUE_LIST_SORT_SET = new Set<string>(ISSUE_LIST_SORTS);
const PRIORITY_RANK = new Map<IssuePriority, number>(ISSUE_PRIORITIES.map((value, index) => [value, index]));

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function comparePriority(left: string, right: string): number {
  const leftRank = PRIORITY_RANK.get(left as IssuePriority) ?? ISSUE_PRIORITIES.length;
  const rightRank = PRIORITY_RANK.get(right as IssuePriority) ?? ISSUE_PRIORITIES.length;
  return leftRank - rightRank;
}

function compareUpdatedDesc(left: IssueListSortable, right: IssueListSortable): number {
  const leftTime = toTimestamp(left.updatedAt) ?? Number.NEGATIVE_INFINITY;
  const rightTime = toTimestamp(right.updatedAt) ?? Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

export function isIssueListSort(value: string | null | undefined): value is IssueListSort {
  return ISSUE_LIST_SORT_SET.has(String(value ?? ""));
}

export function compareIssuesByListSort<T extends IssueListSortable>(
  left: T,
  right: T,
  sort: IssueListSort,
): number {
  if (sort === "priority") {
    return comparePriority(left.priority, right.priority) || compareUpdatedDesc(left, right);
  }

  const leftTerminal = TERMINAL_ISSUE_STATUSES.has(left.status);
  const rightTerminal = TERMINAL_ISSUE_STATUSES.has(right.status);
  if (leftTerminal !== rightTerminal) {
    return leftTerminal ? 1 : -1;
  }
  if (leftTerminal && rightTerminal) {
    return compareUpdatedDesc(left, right);
  }

  const leftEta = toTimestamp(left.etaAt);
  const rightEta = toTimestamp(right.etaAt);
  const leftHasEta = leftEta !== null;
  const rightHasEta = rightEta !== null;

  if (leftHasEta !== rightHasEta) {
    return leftHasEta ? -1 : 1;
  }

  if (leftHasEta && rightHasEta) {
    return (leftEta - rightEta) || comparePriority(left.priority, right.priority) || compareUpdatedDesc(left, right);
  }

  return comparePriority(left.priority, right.priority) || compareUpdatedDesc(left, right);
}

export function sortIssuesByListSort<T extends IssueListSortable>(issues: T[], sort: IssueListSort): T[] {
  return [...issues].sort((left, right) => compareIssuesByListSort(left, right, sort));
}
