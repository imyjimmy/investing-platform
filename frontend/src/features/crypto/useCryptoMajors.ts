import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export function useCryptoMajors() {
  return useQuery({
    queryKey: ["crypto-majors"],
    queryFn: api.cryptoMajors,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
