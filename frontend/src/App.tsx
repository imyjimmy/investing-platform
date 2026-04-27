import { useState } from "react";

import { AppShell } from "./components/shell/AppShell";
import { AppSidebarFooter, AppSidebarNavigation, type WorkspaceSurface } from "./components/shell/AppSidebarNavigation";
import { WorkspaceRouter, type WorkspaceRoute } from "./components/shell/WorkspaceRouter";
import { WorkspaceStage } from "./components/shell/WorkspaceStage";
import { type InlinePillTone } from "./components/ui/InlinePill";
import { TickerWorkspace } from "./components/TickerWorkspace";
import { useAccountData } from "./features/account/useAccountData";
import { CryptoLeverageWorkspace } from "./features/crypto/CryptoLeverageWorkspace";
import { CryptoMarketWorkspace } from "./features/crypto/CryptoMarketWorkspace";
import { DashboardWorkspace } from "./features/dashboard/DashboardWorkspace";
import { OptionsWorkspace, type OptionsWorkspaceSurface } from "./features/options/OptionsWorkspace";
import { SettingsWorkspace } from "./features/settings/SettingsWorkspace";
import { StockIntelWorkspace } from "./features/stock-intel/StockIntelWorkspace";
import { StockMarketWorkspace } from "./features/stocks/market/StockMarketWorkspace";
import type { ConnectionStatus } from "./lib/types";

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSurface>("dashboard");
  const [selectedStockSymbol, setSelectedStockSymbol] = useState("NVDA");
  const {
    connectMutation,
    connectionQuery,
    executionEnabled,
    optionPositions,
    positions,
    reconnectMutation,
    selectedAccount,
    setSelectedAccountId,
  } = useAccountData();
  const marketGatewayPill = gatewaySessionPresentation(connectionQuery.data);

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
      <TickerWorkspace
        connectionStatus={connectionQuery.data}
        controlsDisabled={connectMutation.isPending || reconnectMutation.isPending}
        executionEnabled={executionEnabled}
        onSelectedAccountChange={setSelectedAccountId}
        onSymbolChange={setSelectedStockSymbol}
        positions={positions}
        selectedSymbol={selectedStockSymbol}
        selectedAccount={selectedAccount}
      />
    );
  }

  function renderStockIntelWorkspace() {
    return <StockIntelWorkspace defaultTicker={selectedStockSymbol} />;
  }

  function renderOptionsWorkspace() {
    return (
      <OptionsWorkspace
        connectionStatus={connectionQuery.data}
        controlsDisabled={connectMutation.isPending || reconnectMutation.isPending}
        executionEnabled={executionEnabled}
        initialSymbol={selectedStockSymbol}
        onOpenChain={() => setActiveWorkspace("options")}
        onSymbolChange={setSelectedStockSymbol}
        optionPositions={optionPositions}
        selectedAccount={selectedAccount}
        workspace={activeWorkspace as OptionsWorkspaceSurface}
      />
    );
  }

  const workspaceRoutes: Array<WorkspaceRoute<WorkspaceSurface>> = [
    { key: "dashboard", render: () => <DashboardWorkspace /> },
    { key: "market", render: () => <StockMarketWorkspace gatewayPill={marketGatewayPill} onOpenSymbol={openSymbolWorkspace} /> },
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
    { key: "globalSettings", render: () => <SettingsWorkspace connectionStatus={connectionQuery.data} executionEnabled={executionEnabled} /> },
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
        <WorkspaceRouter activeWorkspace={activeWorkspace} routes={workspaceRoutes} />
      </WorkspaceStage>
    </AppShell>
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
