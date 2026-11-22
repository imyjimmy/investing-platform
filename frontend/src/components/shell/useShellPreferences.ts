import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useShellPreference<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      return validate(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Preferences are optional in restricted storage. */
    }
  }, [key, value]);
  return [value, setValue];
}

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
export const isPanelWidth = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 220 &&
  value <= 380;
