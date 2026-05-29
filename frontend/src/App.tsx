import { lazy, Suspense, useState, type Dispatch, type SetStateAction } from "react";

import { AppShell } from "./components/shell/AppShell";
import { AppSidebarFooter, AppSidebarNavigation, type WorkspaceSurface } from "./components/shell/AppSidebarNavigation";
import { WorkspaceRouter, type WorkspaceRoute } from "./components/shell/WorkspaceRouter";
import { WorkspaceStage } from "./components/shell/WorkspaceStage";
import { type InlinePillTone } from "./components/ui/InlinePill";
import { useAccountData, useConnectionStatusQuery } from "./features/account/useAccountData";
import type { OptionsWorkspaceSurface } from "./features/options/OptionsWorkspace";
import type { ConnectionStatus } from "./lib/types";

const CryptoLeverageWorkspace = lazy(() =>
  import("./features/crypto/CryptoLeverageWorkspace").then((module) => ({ default: module.CryptoLeverageWorkspace })),
);
const CryptoMarketWorkspace = lazy(() =>
  import("./features/crypto/CryptoMarketWorkspace").then((module) => ({ default: module.CryptoMarketWorkspace })),
);
const DashboardWorkspace = lazy(() =>
  import("./features/dashboard/DashboardWorkspace").then((module) => ({ default: module.DashboardWorkspace })),
);
const OptionsWorkspace = lazy(() =>
  import("./features/options/OptionsWorkspace").then((module) => ({ default: module.OptionsWorkspace })),
);
const SettingsWorkspace = lazy(() =>
  import("./features/settings/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })),
);
const StockIntelWorkspace = lazy(() =>
  import("./features/stock-intel/StockIntelWorkspace").then((module) => ({ default: module.StockIntelWorkspace })),
);
const StockMarketWorkspace = lazy(() =>
  import("./features/stocks/market/StockMarketWorkspace").then((module) => ({ default: module.StockMarketWorkspace })),
);
const TickerWorkspace = lazy(() => import("./components/TickerWorkspace").then((module) => ({ default: module.TickerWorkspace })));

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSurface>("dashboard");
  const [selectedStockSymbol, setSelectedStockSymbol] = useState("NVDA");

  function openSymbolWorkspace(nextSymbol: string, nextWorkspace: "ticker" | "options") {
    const normalizedSymbol = nextSymbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }
    setSelectedStockSymbol(normalizedSymbol);
    setActiveWorkspace(nextWorkspace);
  }

  function renderTickerWorkspace() {
    return (
      <TickerWorkspaceRoute
        onSymbolChange={setSelectedStockSymbol}
        selectedSymbol={selectedStockSymbol}
      />
    );
  }

  function renderStockIntelWorkspace() {
    return <StockIntelWorkspace defaultTicker={selectedStockSymbol} />;
  }

  function renderOptionsWorkspace() {
    return (
      <OptionsWorkspaceRoute
        activeWorkspace={activeWorkspace}
        initialSymbol={selectedStockSymbol}
        onOpenChain={() => setActiveWorkspace("options")}
        onSymbolChange={setSelectedStockSymbol}
      />
    );
  }

  const workspaceRoutes: Array<WorkspaceRoute<WorkspaceSurface>> = [
    { key: "dashboard", render: () => <DashboardWorkspace /> },
    { key: "market", render: () => <StockMarketWorkspaceRoute onOpenSymbol={openSymbolWorkspace} /> },
    { key: "ticker", render: renderTickerWorkspace },
    { key: "options", render: renderOptionsWorkspace },
    { key: "optionsValuation", render: renderOptionsWorkspace },
    { key: "optionsBuilder", render: renderOptionsWorkspace },
    { key: "optionsStructures", render: renderOptionsWorkspace },
    { key: "optionsVolatility", render: renderOptionsWorkspace },
    { key: "optionsScanner", render: renderOptionsWorkspace },
    { key: "crypto", render: () => <CryptoMarketWorkspace /> },
    { key: "cryptoLeverage", render: () => <CryptoLeverageWorkspace /> },
    { key: "stockIntel", render: renderStockIntelWorkspace },
    { key: "globalSettings", render: () => <SettingsWorkspaceRoute /> },
  ];

  return (
    <AppShell
      activeIsHome={activeWorkspace === "dashboard"}
      footer={<AppSidebarFooter activeWorkspace={activeWorkspace} onSelectWorkspace={setActiveWorkspace} />}
      onHome={() => {
        setActiveWorkspace("dashboard");
      }}
      sidebar={<AppSidebarNavigation activeWorkspace={activeWorkspace} onSelectWorkspace={setActiveWorkspace} />}
    >
      <WorkspaceStage>
        <Suspense fallback={<WorkspaceLoadingFallback />}>
          <WorkspaceRouter activeWorkspace={activeWorkspace} routes={workspaceRoutes} />
        </Suspense>
      </WorkspaceStage>
    </AppShell>
  );
}

type TickerWorkspaceRouteProps = {
  onSymbolChange: Dispatch<SetStateAction<string>>;
  selectedSymbol: string;
};

function TickerWorkspaceRoute({ onSymbolChange, selectedSymbol }: TickerWorkspaceRouteProps) {
  const {
    connectMutation,
    connectionQuery,
    executionEnabled,
    positions,
    reconnectMutation,
    selectedAccount,
    setSelectedAccountId,
  } = useAccountData();

  return (
    <TickerWorkspace
      connectionStatus={connectionQuery.data}
      controlsDisabled={connectMutation.isPending || reconnectMutation.isPending}
      executionEnabled={executionEnabled}
      onSelectedAccountChange={setSelectedAccountId}
      onSymbolChange={onSymbolChange}
      positions={positions}
      selectedAccount={selectedAccount}
      selectedSymbol={selectedSymbol}
    />
  );
}

type OptionsWorkspaceRouteProps = {
  activeWorkspace: WorkspaceSurface;
  initialSymbol: string;
  onOpenChain: () => void;
  onSymbolChange: Dispatch<SetStateAction<string>>;
};

function OptionsWorkspaceRoute({ activeWorkspace, initialSymbol, onOpenChain, onSymbolChange }: OptionsWorkspaceRouteProps) {
  const {
    connectMutation,
    connectionQuery,
    executionEnabled,
    optionPositions,
    reconnectMutation,
    selectedAccount,
  } = useAccountData();

  return (
    <OptionsWorkspace
      connectionStatus={connectionQuery.data}
      controlsDisabled={connectMutation.isPending || reconnectMutation.isPending}
      executionEnabled={executionEnabled}
      initialSymbol={initialSymbol}
      onOpenChain={onOpenChain}
      onSymbolChange={onSymbolChange}
      optionPositions={optionPositions}
      selectedAccount={selectedAccount}
      workspace={activeWorkspace as OptionsWorkspaceSurface}
    />
  );
}

type StockMarketWorkspaceRouteProps = {
  onOpenSymbol: (symbol: string, workspace: "ticker" | "options") => void;
};

function StockMarketWorkspaceRoute({ onOpenSymbol }: StockMarketWorkspaceRouteProps) {
  const connectionQuery = useConnectionStatusQuery();
  return <StockMarketWorkspace gatewayPill={gatewaySessionPresentation(connectionQuery.data)} onOpenSymbol={onOpenSymbol} />;
}

function SettingsWorkspaceRoute() {
  const connectionQuery = useConnectionStatusQuery();
  return <SettingsWorkspace connectionStatus={connectionQuery.data} executionEnabled={connectionQuery.data?.executionMode === "enabled"} />;
}

function WorkspaceLoadingFallback() {
  return (
    <div className="grid min-h-[420px] place-items-center px-6 py-16 text-sm text-muted">
      Loading workspace...
    </div>
  );
}

function gatewaySessionPresentation(status: ConnectionStatus | undefined): { label: string; tone: InlinePillTone } {
  if (!status) {
    return { label: "Gateway checking", tone: "neutral" };
  }
  if (!status.connected) {
    return { label: "Gateway offline", tone: "danger" };
  }
  if (status.marketDataMode === "LIVE") {
    return { label: "Gateway connected", tone: "safe" };
  }
  if (status.marketDataMode === "DELAYED" || status.marketDataMode === "DELAYED_FROZEN") {
    return { label: "Gateway delayed", tone: "caution" };
  }
  if (status.marketDataMode === "FROZEN") {
    return { label: "Gateway frozen", tone: "caution" };
  }
  return { label: `Gateway ${status.marketDataMode.toLowerCase()}`, tone: "neutral" };
}

export default App;
