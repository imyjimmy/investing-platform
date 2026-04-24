import { useQuery } from "@tanstack/react-query";

import { marketApi } from "../../../lib/api";
import { queryKeys } from "../../../lib/queryKeys";

export function useMarketUniverse() {
  return useQuery({
    queryKey: queryKeys.market.universe,
    queryFn: marketApi.marketUniverse,
    staleTime: 60_000,
  });
}
