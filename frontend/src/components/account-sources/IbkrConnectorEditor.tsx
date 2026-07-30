import { useState } from "react";

import type { IbkrConnectorConfigRequest, IbkrConnectorStatus } from "../../lib/types";

type IbkrConnectorEditorProps = {
  accountName: string;
  status: IbkrConnectorStatus;
  saving: boolean;
  testing: boolean;
  syncingFlex: boolean;
  removing: boolean;
  onCancel: () => void;
  onRemove: () => Promise<void>;
  onSave: (request: IbkrConnectorConfigRequest) => Promise<void>;
  onSyncFlex: () => Promise<void>;
  onTest: () => Promise<void>;
};

export function IbkrConnectorEditor({
  accountName,
  status,
  saving,
  testing,
  syncingFlex,
  removing,
  onCancel,
  onRemove,
  onSave,
  onSyncFlex,
  onTest,
}: IbkrConnectorEditorProps) {
  const [draft, setDraft] = useState<IbkrConnectorConfigRequest>(() => connectorDraft(status));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || testing || syncingFlex || removing;

  async function save() {
    setError(null);
    setFeedback(null);
    if (!draft.accountId) {
      setError(`Choose the IBKR account that belongs to ${accountName}.`);
      return;
    }
    try {
      await onSave(draft);
      setDraft((current) => ({ ...current, flexToken: null, clearFlexToken: false }));
      setFeedback(`Saved Interactive Brokers for ${accountName}. Gateway balances refresh every 30 seconds; Flex history refreshes daily.`);
    } catch (reason) {
      setError(errorMessage(reason, "Could not save the IBKR connector."));
    }
  }

  async function syncFlex() {
    setError(null);
    setFeedback(null);
    try {
      await onSyncFlex();
      setFeedback("Flex contribution history synced successfully.");
    } catch (reason) {
      setError(errorMessage(reason, "Could not sync the IBKR Flex statement."));
    }
  }

  async function test() {
    setError(null);
    setFeedback(null);
    try {
      await onTest();
      setFeedback("Gateway connection and saved account assignment are working.");
    } catch (reason) {
      setError(errorMessage(reason, "Could not test the IBKR connector."));
    }
  }

  async function remove() {
    setError(null);
    setFeedback(null);
    try {
      await onRemove();
      onCancel();
    } catch (reason) {
      setError(errorMessage(reason, "Could not remove the IBKR connector."));
    }
  }

  return (
    <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-text">Interactive Brokers</div>
          <div className="mt-1 text-sm text-muted">Assign a Gateway-discovered account to {accountName}. The assignment is stored locally, outside Git.</div>
        </div>
        <button
          className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Account assigned to {accountName}</span>
          <select
            className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
            onChange={(event) => setDraft((current) => ({ ...current, accountId: event.target.value || null }))}
            value={draft.accountId ?? ""}
          >
            <option value="">Choose a Gateway account</option>
            {status.discoveredAccounts.map((accountId) => (
              <option key={accountId} value={accountId}>
                {accountId}
              </option>
            ))}
          </select>
        </label>

        {status.discoveredAccounts.length === 0 ? (
          <div className="rounded-xl border border-caution/25 bg-caution/8 px-4 py-3 text-sm text-caution">
            No accounts have been discovered. Confirm Gateway is connected, then use Test Gateway.
          </div>
        ) : null}

        <label className="grid gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Connector name</span>
          <input
            className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
            onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
            spellCheck={false}
            type="text"
            value={draft.displayName}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem]">
          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Gateway host</span>
            <input
              className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
              onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
              spellCheck={false}
              type="text"
              value={draft.host}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Port</span>
            <input
              className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
              min={1}
              max={65535}
              onChange={(event) => setDraft((current) => ({ ...current, port: Number(event.target.value) }))}
              type="number"
              value={draft.port}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Client ID</span>
            <input
              className="w-full rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
              min={0}
              onChange={(event) => setDraft((current) => ({ ...current, clientId: Number(event.target.value) }))}
              type="number"
              value={draft.clientId}
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text">
            <input
              checked={draft.enabled}
              className="h-4 w-4 accent-accent"
              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
              type="checkbox"
            />
            <span>Use this source on {accountName}</span>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-text">
            <input
              checked={draft.readonly}
              className="h-4 w-4 accent-accent"
              onChange={(event) => setDraft((current) => ({ ...current, readonly: event.target.checked }))}
              type="checkbox"
            />
            <span>Read-only connection</span>
          </label>
        </div>

        <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-text">Historical reporting</div>
              <div className="mt-1 text-sm text-muted">
                Use one Activity Flex Query to satisfy the same total, daily, and monthly metric contract as every account source.
              </div>
            </div>
            <span className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
              {flexStatusLabel(status.flexStatus)}
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            <label className="flex items-center gap-3 rounded-xl border border-line/80 bg-panel px-4 py-3 text-sm text-text">
              <input
                checked={draft.flexEnabled}
                className="h-4 w-4 accent-accent"
                onChange={(event) => setDraft((current) => ({ ...current, flexEnabled: event.target.checked }))}
                type="checkbox"
              />
              <span>Use Flex history for IBKR total and monthly PnL</span>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Activity Flex Query ID</span>
                <input
                  className="w-full rounded-xl border border-line/80 bg-panel px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  inputMode="numeric"
                  onChange={(event) => setDraft((current) => ({ ...current, flexQueryId: event.target.value || null }))}
                  placeholder="Numeric query ID"
                  spellCheck={false}
                  type="text"
                  value={draft.flexQueryId ?? ""}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted">Flex Web Service token</span>
                <input
                  autoComplete="off"
                  className="w-full rounded-xl border border-line/80 bg-panel px-4 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                  onChange={(event) => setDraft((current) => ({ ...current, flexToken: event.target.value || null, clearFlexToken: false }))}
                  placeholder={status.flexTokenConfigured ? "Saved locally - leave blank to keep" : "Paste token"}
                  spellCheck={false}
                  type="password"
                  value={draft.flexToken ?? ""}
                />
              </label>
            </div>

            <div className="rounded-xl border border-line/80 bg-panel px-4 py-3 text-xs leading-5 text-muted">
              In IBKR Client Portal, enable Flex Web Service and create an <span className="text-text">Activity Flex Query</span> with XML output,
              a period covering the account's full contribution history, Cash Transactions fields: Account ID, Currency, FX Rate to Base, Amount, Type,
              Date/Time, and Transaction ID, plus Equity Summary by Report Date in Base fields: Report Date and Net Liquidation.
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className={`text-xs ${status.flexStatus === "error" ? "text-danger" : "text-muted"}`}>{status.flexDetail}</div>
              <button
                className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || !status.flexConfigured || !status.flexEnabled}
                onClick={() => void syncFlex()}
                type="button"
              >
                {syncingFlex ? "Syncing..." : "Sync Statement"}
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger">{error}</div> : null}
        {feedback ? <div className="rounded-xl border border-safe/25 bg-safe/8 px-4 py-3 text-sm text-safe">{feedback}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted">{status.detail}</div>
          <div className="flex flex-wrap gap-2">
            {status.configured ? (
              <button
                className="rounded-full border border-danger/25 bg-danger/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-danger transition hover:border-danger/45 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={() => void remove()}
                type="button"
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            ) : null}
            <button
              className="rounded-full border border-line/80 bg-panel px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted transition hover:border-accent/35 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => void test()}
              type="button"
            >
              {testing ? "Testing..." : "Test Gateway"}
            </button>
            <button
              className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || !draft.displayName.trim() || !draft.host.trim() || !draft.accountId}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving..." : status.configured ? "Save Assignment" : `Assign to ${accountName}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function connectorDraft(status: IbkrConnectorStatus): IbkrConnectorConfigRequest {
  return {
    displayName: status.displayName || "Interactive Brokers",
    enabled: status.configured ? status.enabled : true,
    host: status.host,
    port: status.port,
    clientId: status.clientId,
    readonly: status.readonly,
    accountId: status.accountId ?? (status.discoveredAccounts.length === 1 ? status.discoveredAccounts[0] : null),
    flexEnabled: status.flexEnabled,
    flexToken: null,
    clearFlexToken: false,
    flexQueryId: status.flexQueryId,
  };
}

function flexStatusLabel(status: IbkrConnectorStatus["flexStatus"]) {
  if (status === "ready") {
    return "Synced";
  }
  if (status === "error") {
    return "Needs attention";
  }
  if (status === "partial") {
    return "Partial metrics";
  }
  if (status === "disabled") {
    return "Disabled";
  }
  return "Needs setup";
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
