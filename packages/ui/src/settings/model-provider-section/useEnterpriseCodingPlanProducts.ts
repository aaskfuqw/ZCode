import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnterpriseCodingPlanPricingResponse, ProviderFamilyDomain } from "@zcode/shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { isRemoteWorkspaceDisconnectedError } from "@/lib/remoteWorkspaceServiceError.js";
import { logger } from "@/logger.js";
import {
  buildEnterpriseCodingPlanProductList,
  type EnterpriseCodingPlanProductDisplay,
} from "./enterpriseCodingPlanProducts.js";

export interface EnterpriseCodingPlanProductsSnapshot {
  productList: EnterpriseCodingPlanProductDisplay[];
  raw: EnterpriseCodingPlanPricingResponse;
  authenticated: boolean;
  family: ProviderFamilyDomain;
}

interface EnterpriseCodingPlanProductsState {
  snapshot: EnterpriseCodingPlanProductsSnapshot | null;
  loading: boolean;
  error: string | null;
}

export function useEnterpriseCodingPlanProducts({
  enabled,
  authenticated,
  family = "bigmodel",
}: {
  enabled: boolean;
  authenticated: boolean;
  family?: ProviderFamilyDomain;
}) {
  const services = useOptionalServices();
  const service = services?.codingPlanSubscriptionService;
  const generation = useRef(0);
  const [state, setState] = useState<EnterpriseCodingPlanProductsState>({
    snapshot: null,
    loading: enabled && authenticated,
    error: null,
  });
  const refresh = useCallback(
    async (_options?: { force?: boolean }) => {
      const currentGeneration = ++generation.current;
      if (!enabled || !authenticated) {
        setState({ snapshot: null, loading: false, error: null });
        return;
      }
      if (!service) {
        setState({ snapshot: null, loading: false, error: "service_unavailable" });
        return;
      }
      setState((current) => ({
        snapshot: current.snapshot?.family === family ? current.snapshot : null,
        loading: true,
        error: null,
      }));
      try {
        const raw = await service.getTeamConnections({ family });
        if (generation.current !== currentGeneration) return;
        setState({
          snapshot: {
            raw,
            productList: buildEnterpriseCodingPlanProductList(raw.productList).map((product) => ({
              ...product,
              family,
            })),
            authenticated: true,
            family,
          },
          loading: false,
          error: null,
        });
      } catch (error) {
        if (generation.current !== currentGeneration) return;
        const message = error instanceof Error ? error.message : String(error);
        if (!isRemoteWorkspaceDisconnectedError(error)) {
          logger.warn("[useEnterpriseCodingPlanProducts] Team connection refresh failed", {
            family,
            error: message,
          });
        }
        setState((current) => ({
          snapshot: current.snapshot?.family === family ? current.snapshot : null,
          loading: false,
          error: message,
        }));
      }
    },
    [authenticated, enabled, family, service],
  );

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}
