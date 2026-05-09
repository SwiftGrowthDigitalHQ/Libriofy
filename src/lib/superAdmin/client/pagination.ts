import type { AdminListQuery, AdminPaginatedItems, AdminPagination } from "./types";

export const DEFAULT_ADMIN_PAGE = 1;
export const DEFAULT_ADMIN_PAGE_SIZE = 20;

export const normalizeAdminPagination = (
  value?: Partial<AdminPagination> | null,
): AdminPagination => ({
  page: value?.page && value.page > 0 ? value.page : DEFAULT_ADMIN_PAGE,
  pageCount: value?.pageCount && value.pageCount > 0 ? value.pageCount : 1,
  pageSize: value?.pageSize && value.pageSize > 0 ? value.pageSize : DEFAULT_ADMIN_PAGE_SIZE,
  totalCount: value?.totalCount && value.totalCount >= 0 ? value.totalCount : 0,
});

export const createEmptyPaginatedItems = <T>(
  overrides?: Partial<AdminPagination>,
): AdminPaginatedItems<T> => ({
  items: [],
  pagination: normalizeAdminPagination(overrides),
});

export const withAdminPaginationDefaults = <T extends AdminListQuery>(query?: T): T & Required<Pick<AdminListQuery, "page" | "pageSize">> => ({
  ...(query ?? ({} as T)),
  page: query?.page ?? DEFAULT_ADMIN_PAGE,
  pageSize: query?.pageSize ?? DEFAULT_ADMIN_PAGE_SIZE,
});

export const createAdminSearchParams = (query?: AdminListQuery) => {
  const params = new URLSearchParams();

  if (!query) {
    return params;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") {
      continue;
    }

    params.set(key, String(value));
  }

  return params;
};
