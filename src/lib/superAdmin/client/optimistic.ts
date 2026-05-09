import type { QueryClient, QueryFilters, QueryKey } from "@tanstack/react-query";

type Updater<T> = (current: T) => T;

export const updateMatchingQueries = <T>(
  queryClient: QueryClient,
  filters: QueryFilters,
  updater: Updater<T>,
) => {
  const snapshots = queryClient.getQueriesData<T>(filters);

  snapshots.forEach(([queryKey, current]) => {
    if (current === undefined) {
      return;
    }

    queryClient.setQueryData<T>(queryKey, updater(current));
  });

  return snapshots;
};

export const restoreMatchingQueries = <T>(
  queryClient: QueryClient,
  snapshots: Array<[QueryKey, T | undefined]>,
) => {
  snapshots.forEach(([queryKey, value]) => {
    queryClient.setQueryData(queryKey, value);
  });
};

export const replaceItemInPaginatedList = <TItem extends { id: string }>(
  collection: { items: TItem[] } | undefined,
  nextItem: TItem,
) => {
  if (!collection) {
    return collection;
  }

  return {
    ...collection,
    items: collection.items.map((item) => (item.id === nextItem.id ? nextItem : item)),
  };
};

export const prependItemInPaginatedList = <TItem>(
  collection: { items: TItem[] } | undefined,
  nextItem: TItem,
) => {
  if (!collection) {
    return collection;
  }

  return {
    ...collection,
    items: [nextItem, ...collection.items],
  };
};
