import { useMemo } from "react";
import { useUserRole } from "./useUserRole";

export const useCurrentLibraryId = () => {
  const { data: roles, isLoading } = useUserRole();

  const libraryId = useMemo(() => {
    return (
      roles?.find((r) => r.role === "library_owner")?.library_id ??
      roles?.find((r) => r.role === "staff")?.library_id ??
      null
    );
  }, [roles]);

  return { libraryId, isLoading };
};
