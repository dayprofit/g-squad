'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useActiveSymbols } from '@deriv/core';
import type { DerivWS, ActiveSymbol } from '@deriv/core';
import { useAppTranslations } from '@/components/custom/i18n-provider';
import { useOpenPositions, type OpenPosition } from './use-open-positions';
import { useClosedPositions, type ClosedPosition } from './use-closed-positions';

export interface UseBaseTradingParams {
  /** Shared WebSocket instance from DerivWSProvider. */
  ws: DerivWS | null;
  isConnected: boolean;
  /** True when the WS has exhausted all reconnect attempts. */
  isExhausted?: boolean;
  /** True when the user is authenticated (wsUrl is set). Used to gate auth-only calls. */
  isAuthenticated: boolean;
  onAuthWSFailed?: () => void;
  /** Contract types used to filter available symbols and duration limits. */
  contractTypes: string[];
  preferredSymbol?: string;
}

export interface UseBaseTradingReturn {
  isLoading: boolean;
  error: string | null;
  symbols: ActiveSymbol[];
  selectSymbol: (symbol: string) => boolean;
  activeSymbol: ActiveSymbol | null;
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
}

/**
 * Generic trading foundation shared across all template types.
 *
 * Accepts the shared WS instance from DerivWSProvider rather than creating its
 * own, so the connection persists across page navigations.
 */
export function useBaseTrading({
  ws,
  isConnected,
  isExhausted,
  isAuthenticated,
  onAuthWSFailed,
  contractTypes,
  preferredSymbol,
}: UseBaseTradingParams): UseBaseTradingReturn {
  const { localize } = useAppTranslations();

  // When the authenticated WS exhausts all reconnect attempts, fall back to
  // the public WS by triggering logout.
  useEffect(() => {
    if (isExhausted && ws) {
      onAuthWSFailed?.();
    }
  }, [isExhausted, ws, onAuthWSFailed]);

  const { activeSymbol, symbols, selectSymbol, error, isLoading: symbolsLoading } = useActiveSymbols(ws, isConnected, contractTypes, preferredSymbol);

  // Surface errors from the live market and settlement subscriptions.
  useEffect(() => {
    if (!ws || !isConnected) return;
    return ws.onMessage(data => {
      if (!data.error) return;
      const msgType = data.msg_type as string | undefined;
      const err = data.error as Record<string, string>;
      // A duplicate subscription is an internal stream-lifecycle event that the
      // subscription layer recovers from on its own, so it is a developer
      // signal rather than an app error. Matched on the code only — the message
      // is server-localized and interpolates the symbol.
      if (err.code === 'AlreadySubscribed') {
        console.warn('[useBaseTrading] duplicate subscription reported by the API', {
          code: err.code,
          msgType,
          message: err.message,
        });
        return;
      }
      toast.error(localize('Error'), {
        // API message when present; app-authored fallback otherwise.
        description: err.message ?? localize('Unexpected error occurred. Please try again.'),
      });
    });
  }, [ws, isConnected, localize]);

  const { positions: openPositions } = useOpenPositions(ws, isConnected, isAuthenticated);
  const { positions: closedPositions, refresh: refreshClosedPositions } = useClosedPositions(
    ws,
    isConnected,
    isAuthenticated
  );
  const settledContracts = useRef(new Set<number>());

  useEffect(() => {
    for (const position of openPositions) {
      const isClosed = !!position.is_sold || !!position.is_expired || position.status !== 'open';
      if (isClosed && !settledContracts.current.has(position.contract_id)) {
        settledContracts.current.add(position.contract_id);
        void refreshClosedPositions();
      }
    }
  }, [openPositions, refreshClosedPositions]);

  return {
    isLoading: !isConnected || symbolsLoading,
    error,
    symbols,
    selectSymbol,
    activeSymbol,
    openPositions,
    closedPositions,
  };
}
