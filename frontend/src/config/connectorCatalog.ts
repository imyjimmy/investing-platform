import rawConnectorCatalog from "./connectorCatalog.json";

export type ConnectorCatalogId = "csvFolder";
export type ConnectorCatalogProvider = "Filesystem";

export type ConnectorCatalogEntry = {
  id: ConnectorCatalogId;
  title: string;
  shortTitle: string;
  provider: ConnectorCatalogProvider;
  description: string;
  settingsDetail: string;
  dashboardTitle: string;
  dashboardEyebrow: string;
  availability: "ready" | "comingSoon";
};

export const CONNECTOR_CATALOG = rawConnectorCatalog as ConnectorCatalogEntry[];

export function getConnectorCatalogEntry(connectorId: ConnectorCatalogId) {
  return CONNECTOR_CATALOG.find((entry) => entry.id === connectorId);
}
