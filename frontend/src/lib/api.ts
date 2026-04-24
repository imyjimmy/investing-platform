import { accountApi } from "./api/account";
import { executionApi } from "./api/execution";
import { marketApi } from "./api/market";
import { sourceApi } from "./api/sources";
export { accountApi, executionApi, marketApi, sourceApi };
export { fetchJson, postJson } from "./api/transport";

export const api = {
  ...accountApi,
  ...executionApi,
  ...marketApi,
  ...sourceApi,
};
