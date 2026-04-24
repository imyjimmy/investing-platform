import { useQuery } from "@tanstack/react-query";

import { marketApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";

export function useCryptoMajors() {
  return useQuery({
    queryKey: queryKeys.market.cryptoMajors,
    queryFn: marketApi.cryptoMajors,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
