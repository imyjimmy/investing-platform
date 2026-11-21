import { createContext, useContext, useState, type ReactNode } from "react";

import type { StockIntelTab } from "./stockIntelTabs";
import { useEdgarQuestion } from "./useEdgarQuestion";
import { useEdgarSync } from "./useEdgarSync";

type FilingDraft = {
  issuerQuery: string;
  question: string;
  allowStale: boolean;
};

function useSessionState() {
  const [activeStockIntelTab, setActiveStockIntelTab] = useState<StockIntelTab>("sec");
  const [draft, setDraft] = useState<FilingDraft | null>(null);
  const filingQuestion = useEdgarQuestion();
  const filingSync = useEdgarSync();
  return { activeStockIntelTab, setActiveStockIntelTab, draft, setDraft, filingQuestion, filingSync };
}

const StockIntelSession = createContext<ReturnType<typeof useSessionState> | null>(null);

export function StockIntelSessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionState();
  return <StockIntelSession.Provider value={session}>{children}</StockIntelSession.Provider>;
}

export function useStockIntelSession() {
  const session = useContext(StockIntelSession);
  if (!session) throw new Error("Stock Intel requires a session provider.");
  return session;
}
