import type { ReactNode } from "react";

import { getConnectorCatalogEntry, type ConnectorCatalogId } from "../../config/connectorCatalog";
import { AccountSource, AccountSourcePill, type AccountSourceTone } from "./AccountSource";

export type FilesystemAccountSourceListItem = {
  id: string;
  title: string;
  status: string;
  tone: AccountSourceTone;
  connectorId: ConnectorCatalogId;
};

interface FilesystemAccountSourceListProps {
  sources: FilesystemAccountSourceListItem[];
  collapsedBySourceId: Record<string, boolean>;
  onToggleSource: (sourceId: string) => void;
  renderSourceContent: (sourceId: string) => ReactNode;
}

export function FilesystemAccountSourceList({
  sources,
  collapsedBySourceId,
  onToggleSource,
  renderSourceContent,
}: FilesystemAccountSourceListProps) {
  return (
    <>
      {sources.map((source) => {
        const connectorCatalogEntry = getConnectorCatalogEntry(source.connectorId);

        return (
          <AccountSource
            key={source.id}
            collapsed={collapsedBySourceId[source.id] ?? false}
            details={
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <AccountSourcePill label={source.status} tone={source.tone} />
              </div>
            }
            eyebrow={connectorCatalogEntry?.dashboardEyebrow ?? "Filesystem source"}
            onToggle={() => onToggleSource(source.id)}
            title={source.title}
          >
            {renderSourceContent(source.id)}
          </AccountSource>
        );
      })}
    </>
  );
}
