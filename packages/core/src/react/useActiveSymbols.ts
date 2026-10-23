'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DerivWS } from '../ws';
import type { ActiveSymbol, ContractsForResponse, ContractInfo, DurationLimits } from '../types';
import { pickDefaultSymbol } from '../utils/pick-default-symbol';

const SYMBOL_PARAM = 'symbol';

function readSymbolFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get(SYMBOL_PARAM) ?? undefined;
}

function writeSymbolToUrl(symbol: string): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set(SYMBOL_PARAM, symbol);
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}

interface UseActiveSymbolsReturn {
  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;
  selectSymbol: (symbol: string) => boolean;
  contracts: ContractInfo[];
  contractsAvailable: boolean;
  durationLimits: DurationLimits;
  defaultStake: number;
  isLoading: boolean;
  error: string | null;
}

export function useActiveSymbols(
  ws: DerivWS | null,
  isConnected: boolean,
  contractTypes: string[],
  preferredSymbol?: string
): UseActiveSymbolsReturn {
  const [symbols, setSymbols] = useState<ActiveSymbol[]>([]);
  const [activeSymbol, setActiveSymbol] = useState<ActiveSymbol | null>(null);
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [contractsAvailable, setContractsAvailable] = useState(false);
  const [durationLimits, setDurationLimits] = useState<DurationLimits>({ min: 1, max: 10, unit: 't' });
  const [defaultStake, setDefaultStake] = useState<number>(10);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContractsFor = useCallback(async (wsInstance: DerivWS, symbol: ActiveSymbol) => {
    const response = await wsInstance.send<ContractsForResponse>({ contracts_for: symbol.underlying_symbol });
    const filtered = response.contracts_for?.available?.filter((c) => contractTypes.includes(c.contract_type)) ?? [];
    setContracts(filtered);
    setContractsAvailable(filtered.length > 0);
    if (!filtered.length) {
      setError(`No supported CALL/PUT contracts are currently available for ${symbol.underlying_symbol}.`);
      return;
    }
    const contract = filtered[0];
    const minMatch = contract.min_contract_duration.match(/^(\d+)/);
    const maxMatch = contract.max_contract_duration.match(/^(\d+)/);
    const unit = contract.min_contract_duration.replace(/^\d+/, '');
    const min = minMatch ? parseInt(minMatch[1], 10) : 1;
    const max = maxMatch ? parseInt(maxMatch[1], 10) : 10;
    setDurationLimits({ min, max, unit });
    setDefaultStake(contract.default_stake);
    setError(null);
  }, [contractTypes]);

  const selectSymbol = useCallback((underlyingSymbol: string) => {
    if (!ws || !isConnected) {
      setError('Connect to Deriv before selecting a market.');
      return false;
    }

    const symbol = symbols.find((s) => s.underlying_symbol === underlyingSymbol);
    if (!symbol) {
      setError(`Market ${underlyingSymbol} is not available for this Deriv account.`);
      return false;
    }
    setError(null);
    if (symbol.underlying_symbol === activeSymbol?.underlying_symbol) return true;

    setActiveSymbol(symbol);
    writeSymbolToUrl(symbol.underlying_symbol);
    loadContractsFor(ws, symbol).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : `Could not load contracts for ${symbol.underlying_symbol}.`);
    });
    return true;
  }, [ws, isConnected, symbols, activeSymbol, loadContractsFor]);

  useEffect(() => {
    if (!ws || !isConnected) return;
    let disposed = false;

    async function fetchSymbols() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await ws!.send<{ active_symbols: ActiveSymbol[] }>({
          active_symbols: 'full',
          contract_type: contractTypes,
        });
        if (disposed) return;

        const allSymbols = response.active_symbols;
        if (!allSymbols || allSymbols.length === 0) {
          throw new Error('No symbols available');
        }

        setSymbols(allSymbols);
        const chosen = preferredSymbol
          ? allSymbols.find((symbol) => symbol.underlying_symbol === preferredSymbol)
          : pickDefaultSymbol(allSymbols, readSymbolFromUrl());
        if (!chosen) throw new Error(`Required market ${preferredSymbol} is unavailable for CALL/PUT trading on this account.`);
        setActiveSymbol(chosen);
        writeSymbolToUrl(chosen.underlying_symbol);

        await loadContractsFor(ws!, chosen);
        if (disposed) return;

        setIsLoading(false);
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : 'Could not load Deriv markets.');
          setIsLoading(false);
        }
      }
    }

    fetchSymbols();
    return () => { disposed = true; };
  }, [ws, isConnected, contractTypes, loadContractsFor, preferredSymbol]);

  return {
    symbols,
    activeSymbol,
    selectSymbol,
    contracts,
    contractsAvailable,
    durationLimits,
    defaultStake,
    isLoading,
    error,
  };
}
