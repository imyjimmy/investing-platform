const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencySmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const greekNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function fmtCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return currency.format(value);
}

export function fmtCurrencySmall(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return currencySmall.format(value);
}

export function fmtNumber(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${number.format(value)}${suffix}`;
}

export function fmtCompactCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return compactCurrency.format(value);
}

export function fmtCompactNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return compactNumber.format(value);
}

export function fmtSignedPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${number.format(value)}%`;
}

export function fmtParenSignedPct(value: number | null | undefined) {
  const formatted = fmtSignedPct(value);
  return formatted ? `(${formatted})` : null;
}

export function fmtDateShort(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function fmtGreek(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${greekNumber.format(value)}${suffix}`;
}

export function fmtWholeNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return wholeNumber.format(value);
}

export function fmtCoverageCount(available: number, total: number) {
  return `${wholeNumber.format(available)}/${wholeNumber.format(total)}`;
}

export function fmtBillions(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${number.format(value)}B`;
}

export function fmtMillions(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${wholeNumber.format(value)}M`;
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
