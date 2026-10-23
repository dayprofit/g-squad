'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bot, Link2, Pause, Play, Wallet } from 'lucide-react';
import { useTicks } from '@deriv/core';
import type { BuyResponse, ProposalResponse } from '@deriv/core';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { FIXED_TRADING_DURATION, FIXED_TRADING_SYMBOL, FIXED_TRADING_SYMBOL_NAME } from '@/lib/trading-constants';

interface ConsoleEntry {
  id: number;
  time: string;
  category: 'INFO' | 'SUCCESS' | 'WARNING' | 'TRADE' | 'MARKET';
  message: string;
}

interface BotSession {
  accountId: string;
  startingBalance: number;
  wins: number;
  losses: number;
}

interface TradingConfig {
  stake: number;
  targetProfit: number;
  targetLoss: number;
  symbol: string;
  maxTrades: number;
  maxConsecutiveLosses: number;
  cooldownMinutes: number;
}

const SUPPORTED_CONTRACT_TYPES = ['CALL', 'PUT'];

function money(value: number, currency?: string): string {
  if (!currency) return 'Unavailable';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function findCandidate(prices: number[]): 'CALL' | 'PUT' | null {
  if (prices.length < 21) return null;
  const history = prices.slice(-21, -1);
  const current = prices[prices.length - 1];
  const momentum = current - prices[prices.length - 4];
  const moves = history.slice(1).map((price, index) => Math.abs(price - history[index]));
  const volatility = moves.reduce((sum, move) => sum + move, 0) / moves.length;
  if (!Number.isFinite(volatility) || volatility <= 0) return null;
  const high = Math.max(...history);
  const low = Math.min(...history);
  const threshold = volatility * 1.5;
  if (current > high + threshold && momentum > 0) return 'CALL';
  if (current < low - threshold && momentum < 0) return 'PUT';
  return null;
}

export function HomeDashboard() {
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, activeAccount, activeAccountId, login, logout } = auth;
  const trading = useBaseTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: () => { void logout(); }, contractTypes: SUPPORTED_CONTRACT_TYPES, preferredSymbol: FIXED_TRADING_SYMBOL });
  const { prices, currentTick } = useTicks(ws, isConnected, trading.activeSymbol, 60);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [connectError, setConnectError] = useState('');
  const [accountSwitchError, setAccountSwitchError] = useState('');
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [configurationError, setConfigurationError] = useState('');
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [startingBot, setStartingBot] = useState(false);
  const [botSession, setBotSession] = useState<BotSession | null>(null);
  const [botMessage, setBotMessage] = useState('');
  const previousConnection = useRef<string | null>(null);
  const previousLatestSettlement = useRef<number | null>(null);
  const botRunningRef = useRef(false);
  const processingSignalRef = useRef(false);
  const lastCandidateRef = useRef<'CALL' | 'PUT' | null>(null);
  const tradeCountRef = useRef(0);
  const consecutiveLossesRef = useRef(0);
  const previousTradeStakeRef = useRef(0);
  const lastTradeAtRef = useRef(0);
  const activeBotContractRef = useRef<number | null>(null);
  const activeBotTradeRef = useRef<{ accountId: string } | null>(null);
  const startingBalanceRef = useRef<number | null>(null);
  const botAccountIdRef = useRef<string | null>(null);
  const botAccountTypeRef = useRef<'demo' | 'real' | null>(null);
  const currentAccountRef = useRef(activeAccount);
  const currentAccountIdRef = useRef(activeAccountId);
  const currentConnectionRef = useRef({ ws, isConnected });
  const currentPricesRef = useRef(prices);
  const currentTickRef = useRef(currentTick);
  const currentOpenPositionsRef = useRef(trading.openPositions);
  currentAccountRef.current = activeAccount;
  currentAccountIdRef.current = activeAccountId;
  currentConnectionRef.current = { ws, isConnected };
  currentPricesRef.current = prices;
  currentTickRef.current = currentTick;
  currentOpenPositionsRef.current = trading.openPositions;

  const accountConnected = !!auth.wsUrl && isConnected && !!activeAccount;
  useEffect(() => {
    let cancelled = false;
    fetch('/api/trading/config', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Could not load trading configuration.');
        if (!cancelled && payload.config) setConfig({ ...payload.config, symbol: FIXED_TRADING_SYMBOL } as TradingConfig);
      })
      .catch((error: unknown) => {
        if (!cancelled) setConfigurationError(error instanceof Error ? error.message : 'Could not load trading configuration.');
      });
    return () => { cancelled = true; };
  }, []);

  const addEntry = useCallback((category: ConsoleEntry['category'], message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setEntries((current) => [{ id: Date.now() + Math.random(), time, category, message }, ...current].slice(0, 100));
  }, []);

  useEffect(() => {
    if (!activeAccountId) {
      setBotSession(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/trading/bot-sessions?accountId=${encodeURIComponent(activeAccountId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load the saved bot session.');
        if (!cancelled) setBotSession(result.session ? {
          accountId: String(result.session.accountId),
          startingBalance: Number(result.session.startingBalance),
          wins: Number(result.session.wins),
          losses: Number(result.session.losses),
        } : null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          addEntry('WARNING', error instanceof Error ? error.message : 'Could not load the saved bot session.');
        }
      });
    return () => { cancelled = true; };
  }, [activeAccountId, addEntry]);

  const stopBot = useCallback((message: string) => {
    botRunningRef.current = false;
    setIsBotRunning(false);
    setBotMessage(message);
    addEntry('WARNING', message);
    const accountId = botAccountIdRef.current;
    if (accountId) {
      void fetch('/api/trading/bot-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', accountId }),
      }).then(async (response) => {
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error ?? 'Could not save the bot session status.');
        }
      }).catch((error: unknown) => {
        addEntry('WARNING', error instanceof Error ? error.message : 'Could not save the bot session status to Neon.');
        console.error('Could not save bot session stop:', error instanceof Error ? error.message : 'Unknown error');
      });
    }
  }, [addEntry]);

  useEffect(() => {
    const state = auth.wsUrl ? (isConnected ? 'connected' : 'connecting') : 'disconnected';
    if (previousConnection.current === state) return;
    previousConnection.current = state;
    if (state === 'connected') addEntry('SUCCESS', 'Deriv account connection established.');
    if (state === 'connecting') addEntry('INFO', 'Connecting to Deriv account.');
    if (state === 'disconnected' && authState === 'authenticated') addEntry('WARNING', 'Deriv connection is currently unavailable.');
  }, [auth.wsUrl, authState, isConnected, addEntry]);

  useEffect(() => {
    if (!isBotRunning) return;
    const interval = window.setInterval(() => {
      const tick = currentTickRef.current;
      const signal = findCandidate(currentPricesRef.current);
      const action = signal ? `signal ${signal}` : 'waiting for a signal';
      const quote = tick
        ? `${tick.symbol} ${tick.quote.toFixed(tick.pip_size)} · ${action}`
        : `Waiting for ${FIXED_TRADING_SYMBOL_NAME} market data`;
      addEntry('MARKET', `Market action: ${quote}`);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isBotRunning, addEntry]);

  useEffect(() => {
    const latestId = trading.closedPositions[0]?.contract_id ?? null;
    if (previousLatestSettlement.current !== null && latestId !== null && latestId !== previousLatestSettlement.current) {
      addEntry('TRADE', 'Deriv settlement history updated.');
    }
    if (latestId !== null) previousLatestSettlement.current = latestId;
  }, [trading.closedPositions, addEntry]);

  useEffect(() => {
    if (!isBotRunning) return;
    if (!accountConnected || activeAccount?.account_type !== botAccountTypeRef.current || activeAccountId !== botAccountIdRef.current) {
      stopBot('Bot stopped because its selected Deriv account changed.');
    }
  }, [isBotRunning, accountConnected, activeAccount?.account_type, activeAccountId, stopBot]);

  useEffect(() => {
    if (!isBotRunning || !activeAccount || startingBalanceRef.current === null) return;
    const balance = Number(activeAccount.balance);
    if (!Number.isFinite(balance)) {
      stopBot('Bot stopped because the account balance could not be verified.');
      return;
    }
    const change = balance - startingBalanceRef.current;
    if (change >= (config?.targetProfit ?? Infinity)) stopBot('Bot stopped at the configured profit limit.');
    else if (change <= -(config?.targetLoss ?? Infinity)) stopBot('Bot stopped at the configured loss limit.');
  }, [isBotRunning, activeAccount?.balance, activeAccount, config?.targetProfit, config?.targetLoss, stopBot]);

  useEffect(() => {
    const contractId = activeBotContractRef.current;
    if (contractId === null) return;
    const position = trading.closedPositions.find((candidate) => candidate.contract_id === contractId);
    if (!position) return;
    activeBotContractRef.current = null;
    const profit = position.sell_price - position.buy_price;
    if (!Number.isFinite(profit)) return;
    const trade = activeBotTradeRef.current;
    activeBotTradeRef.current = null;
    if (trade) {
      void (async () => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const response = await fetch('/api/trading/bot-trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contractId,
                accountId: trade.accountId,
                profit,
              }),
            });
            if (!response.ok) {
              const result = await response.json();
              throw new Error(result.error ?? 'Could not save this bot trade result.');
            }
            return;
          } catch (error) {
            if (attempt === 3) {
              addEntry('WARNING', 'Could not save the settled bot result to admin trading totals.');
              console.error('Could not record bot trade result:', error instanceof Error ? error.message : 'Unknown error');
              return;
            }
            await new Promise((resolve) => window.setTimeout(resolve, attempt * 1000));
          }
        }
      })();
    }
    if (profit < 0) {
      consecutiveLossesRef.current += 1;
      previousTradeStakeRef.current = Math.round(previousTradeStakeRef.current * 1.5 * 100) / 100;
      setBotSession((current) => current && current.accountId === botAccountIdRef.current
        ? { ...current, losses: current.losses + 1 }
        : current);
    } else if (profit > 0) {
      consecutiveLossesRef.current = 0;
      previousTradeStakeRef.current = config?.stake ?? previousTradeStakeRef.current;
      setBotSession((current) => current && current.accountId === botAccountIdRef.current
        ? { ...current, wins: current.wins + 1 }
        : current);
    }
    if (botRunningRef.current && consecutiveLossesRef.current >= (config?.maxConsecutiveLosses ?? Infinity)) {
      stopBot('Bot stopped after reaching the consecutive-loss limit.');
    }
  }, [isBotRunning, trading.closedPositions, config?.stake, config?.maxConsecutiveLosses, stopBot, addEntry]);

  useEffect(() => {
    if (!isBotRunning || !config || !accountConnected || !ws || !isConnected) return;
    if (activeBotContractRef.current !== null) return;
    if (trading.activeSymbol?.underlying_symbol !== config.symbol) return;
    const direction = findCandidate(prices);
    if (!direction) {
      lastCandidateRef.current = null;
      return;
    }
    if (lastCandidateRef.current === direction || processingSignalRef.current) return;
    lastCandidateRef.current = direction;

    const placeTrade = async () => {
      processingSignalRef.current = true;
      try {
        const connection = currentConnectionRef.current;
        const account = currentAccountRef.current;
        if (
          !botRunningRef.current ||
          !connection.isConnected ||
          !connection.ws ||
          !account ||
          account.account_type !== botAccountTypeRef.current ||
          account.account_id !== botAccountIdRef.current ||
          currentAccountIdRef.current !== botAccountIdRef.current ||
          findCandidate(currentPricesRef.current) !== direction
        ) return;
        if (currentOpenPositionsRef.current.some((position) => position.status === 'open' && position.underlying_symbol === FIXED_TRADING_SYMBOL)) return;
        if (tradeCountRef.current >= config.maxTrades) {
          stopBot('Bot stopped after reaching the maximum trade count.');
          return;
        }
        if (Date.now() - lastTradeAtRef.current < config.cooldownMinutes * 60_000) return;

        const balance = Number(account.balance);
        const startingBalance = startingBalanceRef.current;
        if (!Number.isFinite(balance) || startingBalance === null) {
          stopBot('Bot stopped because the selected account balance could not be verified.');
          return;
        }
        const remainingLossBudget = config.targetLoss - Math.max(0, startingBalance - balance);
        const requestedStake = previousTradeStakeRef.current || config.stake;
        const stake = Math.round(Math.min(requestedStake, balance, remainingLossBudget, 10_000) * 100) / 100;
        if (stake < 0.01) {
          stopBot('Bot stopped because the remaining loss limit cannot cover the next trade stake.');
          return;
        }
        if (stake < requestedStake) {
          stopBot('Bot stopped because the next multiplied stake would exceed the remaining loss limit or account balance.');
          return;
        }

        const proposalResponse = await connection.ws.send<ProposalResponse>({
          proposal: 1,
          amount: stake,
          basis: 'stake',
          contract_type: direction,
          currency: account.currency,
          underlying_symbol: config.symbol,
          duration: FIXED_TRADING_DURATION,
          duration_unit: 't',
        });
        const proposal = proposalResponse.proposal;
        if (!proposal?.id || !Number.isFinite(proposal.ask_price) || proposal.ask_price <= 0) {
          throw new Error('Deriv returned an invalid trade proposal.');
        }

        const latestConnection = currentConnectionRef.current;
        const latestAccount = currentAccountRef.current;
        if (
          !botRunningRef.current ||
          !latestConnection.isConnected ||
          latestConnection.ws !== connection.ws ||
          latestAccount?.account_type !== botAccountTypeRef.current ||
          latestAccount.account_id !== botAccountIdRef.current ||
          currentAccountIdRef.current !== botAccountIdRef.current ||
          findCandidate(currentPricesRef.current) !== direction ||
          currentOpenPositionsRef.current.some((position) => position.status === 'open' && position.underlying_symbol === FIXED_TRADING_SYMBOL)
        ) return;
        if (activeBotContractRef.current !== null) return;
        if (stake > Number(latestAccount.balance)) {
          stopBot('Bot stopped because the next stake exceeds the selected account balance.');
          return;
        }

        const buyResponse = await connection.ws.send<BuyResponse>({
          buy: proposal.id,
          price: String(proposal.ask_price),
        });
        if (!buyResponse.buy?.contract_id) throw new Error('Deriv did not confirm the trade.');
        activeBotContractRef.current = buyResponse.buy.contract_id;
        activeBotTradeRef.current = { accountId: account.account_id };
        previousTradeStakeRef.current = stake;
        tradeCountRef.current += 1;
        lastTradeAtRef.current = Date.now();
        addEntry('SUCCESS', `${account.account_type === 'real' ? 'Real' : 'Demo'} ${direction} trade placed at ${money(stake, account.currency)} for ${FIXED_TRADING_DURATION} ticks.`);
        if (tradeCountRef.current >= config.maxTrades) stopBot('Bot stopped after reaching the maximum trade count.');
      } catch (error) {
        console.error('Automated trading stopped:', error instanceof Error ? error.message : 'Unknown error');
        stopBot(error instanceof Error ? `Bot stopped: ${error.message}` : 'Bot stopped because the order could not be completed.');
      } finally {
        processingSignalRef.current = false;
      }
    };
    void placeTrade();
  }, [isBotRunning, config, accountConnected, ws, isConnected, trading.activeSymbol?.underlying_symbol, prices, addEntry, stopBot]);

  useEffect(() => () => {
    botRunningRef.current = false;
  }, []);

  const sessionBelongsToAccount = !!botSession && botSession.accountId === activeAccountId;
  const currentBalance = Number(activeAccount?.balance);
  const profitLoss = sessionBelongsToAccount && Number.isFinite(currentBalance)
    ? currentBalance - botSession.startingBalance
    : null;
  const wins = sessionBelongsToAccount ? botSession.wins : null;
  const losses = sessionBelongsToAccount ? botSession.losses : null;
  const resolved = wins !== null && losses !== null ? wins + losses : 0;

  async function connectDeriv() {
    setConnectError('');
    try { await login(); }
    catch (error) { setConnectError(error instanceof Error ? error.message : 'Could not connect to Deriv.'); }
  }

  async function switchAccount(accountType: 'demo' | 'real') {
    const account = auth.accounts.find((candidate) => candidate.account_type === accountType);
    if (!account || account.account_id === activeAccountId || switchingAccount) return;
    if (botRunningRef.current) stopBot('Bot stopped because the Deriv account is being switched.');
    setSwitchingAccount(true);
    setAccountSwitchError('');
    try {
      await auth.switchAccount(account.account_id);
      setBotMessage(`Switched to the ${accountType} account.`);
      addEntry('INFO', `Deriv ${accountType} account selected.`);
    } catch (error) {
      setAccountSwitchError(error instanceof Error ? error.message : 'Could not switch Deriv accounts.');
    } finally {
      setSwitchingAccount(false);
    }
  }

  const demoAccountOption = auth.accounts.find((account) => account.account_type === 'demo');
  const realAccountOption = auth.accounts.find((account) => account.account_type === 'real');

  async function startBot() {
    if (!accountConnected || !activeAccount || !config || !isConnected || !ws) return;
    if (activeAccount.account_type === 'real' && !window.confirm(
      'Real-money trading warning\n\nThe bot will place automated trades using real funds in your selected Deriv account. Losses are possible. Confirm you want to start real-account automation?'
    )) return;
    if (activeBotContractRef.current !== null) {
      setBotMessage('Wait for the bot’s open contract to settle before restarting.');
      return;
    }
    if (trading.openPositions.some((position) => position.status === 'open' && position.underlying_symbol === FIXED_TRADING_SYMBOL)) {
      setBotMessage(`Wait for the open ${FIXED_TRADING_SYMBOL_NAME} contract to settle before starting automation.`);
      return;
    }
    if (trading.activeSymbol?.underlying_symbol !== FIXED_TRADING_SYMBOL) {
      setBotMessage(`${FIXED_TRADING_SYMBOL_NAME} is not available yet. Wait for the market feed before starting.`);
      return;
    }
    if (!Number.isFinite(Number(activeAccount.balance))) {
      setBotMessage('The selected account balance is unavailable.');
      return;
    }
    setStartingBot(true);
    try {
      const response = await fetch('/api/trading/bot-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          accountId: activeAccount.account_id,
          accountType: activeAccount.account_type,
          currency: activeAccount.currency,
          startingBalance: Number(activeAccount.balance),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.session) throw new Error(result.error ?? 'Could not save the bot session to Neon.');
      setBotSession({
        accountId: String(result.session.accountId),
        startingBalance: Number(result.session.startingBalance),
        wins: Number(result.session.wins),
        losses: Number(result.session.losses),
      });
    } catch (error) {
      setBotMessage(error instanceof Error ? error.message : 'Could not save the bot session to Neon.');
      addEntry('WARNING', error instanceof Error ? error.message : 'Could not save the bot session to Neon.');
      setStartingBot(false);
      return;
    }
    processingSignalRef.current = false;
    lastCandidateRef.current = null;
    tradeCountRef.current = 0;
    consecutiveLossesRef.current = 0;
    previousTradeStakeRef.current = config.stake;
    lastTradeAtRef.current = 0;
    startingBalanceRef.current = Number(activeAccount.balance);
    botAccountIdRef.current = activeAccount.account_id;
    botAccountTypeRef.current = activeAccount.account_type;
    lastCandidateRef.current = findCandidate(prices);
    setBotSession({
      accountId: activeAccount.account_id,
      startingBalance: Number(activeAccount.balance),
      wins: 0,
      losses: 0,
    });
    botRunningRef.current = true;
    setBotMessage(`Bot is scanning the selected ${activeAccount.account_type} account. It will wait for a fresh market signal before its first trade.`);
    setIsBotRunning(true);
    addEntry('INFO', `${activeAccount.account_type === 'real' ? 'Real-money' : 'Demo'} automated trading started. Waiting for a fresh market signal.`);
    setStartingBot(false);
  }

  function stopBotManually() {
    stopBot('Automated trading stopped.');
  }

  return (
    <div className="gq-page-content gq-home-content">
      <div className="gq-page-heading"><div><p className="gq-eyebrow">OVERVIEW</p><h1>Home</h1></div><span className="gq-live-pill"><span /> LIVE DATA</span></div>
      <section className="gq-card gq-account-card">
        <div className="gq-card-heading"><div className="gq-section-icon"><Wallet size={18} /></div><div><h2>Deriv account</h2><p>{accountConnected ? `${activeAccount.account_id} · ${activeAccount.account_type === 'demo' ? 'Demo' : 'Real'}` : 'Not connected'}</p></div><span className={`gq-connection-dot ${accountConnected ? 'is-online' : ''}`} aria-label={accountConnected ? 'Connected' : 'Not connected'} /></div>
        <div className="gq-balance-block"><span>Current balance</span><strong>{accountConnected ? money(Number(activeAccount.balance), activeAccount.currency) : 'Connect Deriv'}</strong></div>
        {accountConnected && <div className="gq-account-switch" role="group" aria-label="Switch Deriv account type">
          <span>Account</span>
          <div>
            <button type="button" className={activeAccount.account_type === 'demo' ? 'is-selected' : ''} aria-pressed={activeAccount.account_type === 'demo'} disabled={switchingAccount || !demoAccountOption || activeAccount.account_type === 'demo'} onClick={() => void switchAccount('demo')}>Demo</button>
            <button type="button" className={activeAccount.account_type === 'real' ? 'is-selected' : ''} aria-pressed={activeAccount.account_type === 'real'} disabled={switchingAccount || !realAccountOption || activeAccount.account_type === 'real'} onClick={() => void switchAccount('real')}>Real</button>
          </div>
          {switchingAccount && <span className="gq-account-switch-status" role="status">Switching…</span>}
          {(!demoAccountOption || !realAccountOption) && <span className="gq-account-switch-status">Only authorized account types are available.</span>}
        </div>}
        {accountSwitchError && <p className="gq-inline-error" role="alert">{accountSwitchError}</p>}
        <div className="gq-stat-grid">
          <Stat label="Bot P/L" value={profitLoss !== null ? money(profitLoss, activeAccount?.currency) : '—'} tone={profitLoss !== null && profitLoss > 0 ? 'positive' : profitLoss !== null && profitLoss < 0 ? 'negative' : ''} icon={profitLoss !== null && profitLoss >= 0 ? <ArrowUpRight size={14} /> : profitLoss !== null ? <ArrowDownRight size={14} /> : undefined} />
          <Stat label="Wins" value={wins !== null ? String(wins) : '—'} /><Stat label="Losses" value={losses !== null ? String(losses) : '—'} />
          <Stat label="Win rate" value={wins !== null && losses !== null ? (resolved ? `${Math.round((wins / resolved) * 100)}%` : '0%') : '—'} />
        </div>
        <p className="gq-footnote">Bot P/L is the selected Deriv balance change since this session started. Wins and losses count only this bot’s settled trades. Balance currency: {activeAccount?.currency ?? 'not available'}.</p>
        {trading.closedPositionsError && <p className="gq-inline-error" role="alert">Could not refresh settled trade history: {trading.closedPositionsError}</p>}
        {!accountConnected && <p className="gq-footnote">Deriv authorization is separate from this app login. The connection requests trade access for account and trading data.</p>}
        {!accountConnected && <button className="gq-secondary-button gq-wide-button" type="button" onClick={connectDeriv} disabled={!process.env.NEXT_PUBLIC_DERIV_APP_ID}><Link2 size={17} />{process.env.NEXT_PUBLIC_DERIV_APP_ID ? 'Connect Deriv account' : 'Deriv app ID not configured'}</button>}
        {(connectError || auth.error) && <p className="gq-inline-error" role="alert">{connectError || auth.error}</p>}
      </section>
      <section className="gq-card gq-bot-card">
        <div className="gq-card-heading"><div className="gq-section-icon gq-section-icon-dark"><Bot size={18} /></div><div><h2>Automatic trading</h2><p>Fixed market · {FIXED_TRADING_SYMBOL_NAME}</p></div><span className={`gq-state-tag ${isBotRunning ? 'is-online' : 'is-unavailable'}`}>{isBotRunning ? 'RUNNING' : 'STOPPED'}</span></div>
        <div className="gq-worker-warning"><AlertTriangle size={16} /><p>Real-account trades use real funds. Confirm before starting on Real. This bot runs only while this page stays open; errors or account changes stop it.</p></div>
        <div className="gq-bot-actions">
          <button className="gq-primary-button" type="button" onClick={() => void startBot()} disabled={startingBot || isBotRunning || !accountConnected || !config || !isConnected || !ws}><Play size={16} fill="currentColor" />{startingBot ? 'Saving session…' : `Start ${activeAccount?.account_type === 'real' ? 'real' : 'demo'} bot`}</button>
          <button className="gq-secondary-button" type="button" onClick={stopBotManually} disabled={!isBotRunning}><Pause size={16} />Stop</button>
        </div>
        {(botMessage || configurationError || (!config && !configurationError)) && <p className="gq-footnote" role={configurationError ? 'alert' : 'status'}>{configurationError || botMessage || 'Save bot settings before starting.'}</p>}
        {trading.error && <p className="gq-inline-error" role="alert">{trading.error}</p>}
        {!accountConnected && <p className="gq-footnote">Connect a Deriv account to enable automation.</p>}
      </section>
      <section className="gq-card gq-console-card">
        <div className="gq-console-heading"><div><h2>Activity history</h2><p>Newest events first · market action updates every second while running</p></div><span><Activity size={14} />{entries.length} EVENTS</span></div>
        <div className="gq-console" aria-live="polite">{entries.length === 0 ? <p className="gq-console-empty">Waiting for application or account activity.</p> : entries.map((entry) => <div className="gq-console-line" key={entry.id}><time>{entry.time}</time><b className={`log-${entry.category.toLowerCase()}`}>{entry.category}</b><span>{entry.message}</span></div>)}</div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone = '', icon }: { label: string; value: string; tone?: string; icon?: React.ReactNode }) {
  return <div className="gq-stat"><span>{label}</span><strong className={tone}>{icon}{value}</strong></div>;
}
