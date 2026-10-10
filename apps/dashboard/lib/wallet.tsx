'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getAddress, type Address, type EIP1193Provider, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { PactClient } from '@pact/tempo'

import { api } from './api'
import { ADD_CHAIN_PARAMS, agentIdOf, browserPayer, tempoChain, type PayStep, type Signer } from './tempo'
import type { RailInfo } from './types'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

/** An agent wallet created in this browser. Testnet only: the key never leaves localStorage. */
export type AgentKey = { address: Address; key: Hex; owner: Address; createdAt: string }

type Status = 'unavailable' | 'disconnected' | 'connecting' | 'connected'

type WalletContext = {
  status: Status
  address: Address | null
  agentId: string | null
  onTempo: boolean
  balance: string | null
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchToTempo: () => Promise<void>
  refreshBalance: () => Promise<void>
  signer: Signer | null
  /** A PACT client that pays through the connected wallet, reporting each wallet prompt. */
  client: (onStep?: (s: PayStep) => void) => Promise<PactClient>
  agents: AgentKey[]
  createAgent: () => AgentKey
  removeAgent: (address: Address) => void
  /** A PACT client that pays autonomously with one of this browser's agent keys — no wallet prompts. */
  agentClient: (agent: AgentKey, onStep?: (s: PayStep) => void) => Promise<PactClient>
  progress: Record<string, boolean>
  markDone: (step: string) => void
}

const Ctx = createContext<WalletContext | null>(null)
const CONNECTED_KEY = 'pact-wallet-connected'
const AGENTS_KEY = 'pact-agents'
const PROGRESS_KEY = 'pact-onboarding'

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage blocked: state lives for this tab only */
  }
}

let operatorPromise: Promise<Address> | null = null
const trustedOperator = () => (operatorPromise ??= api<RailInfo>('/v1/rail').then((r) => r.operator as Address))

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('disconnected')
  const [address, setAddress] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentKey[]>([])
  const [progress, setProgress] = useState<Record<string, boolean>>({})
  const [provider, setProvider] = useState<EIP1193Provider | undefined>(undefined)

  useEffect(() => {
    setAgents(read<AgentKey[]>(AGENTS_KEY, []))
    setProgress(read<Record<string, boolean>>(PROGRESS_KEY, {}))
    const eth = window.ethereum
    if (!eth) {
      setStatus('unavailable')
      return
    }
    setProvider(eth)
    const onAccounts = (accounts: string[]) => {
      if (!accounts[0]) {
        setAddress(null)
        setStatus('disconnected')
        return
      }
      setAddress(getAddress(accounts[0]))
      setStatus('connected')
    }
    const onChain = (id: string) => setChainId(Number(id))
    eth.on('accountsChanged', onAccounts as never)
    eth.on('chainChanged', onChain as never)
    if (read<boolean>(CONNECTED_KEY, false)) {
      void eth.request({ method: 'eth_accounts' }).then((a) => onAccounts(a as string[]))
      void eth.request({ method: 'eth_chainId' }).then((id) => onChain(id as string))
    }
    return () => {
      eth.removeListener('accountsChanged', onAccounts as never)
      eth.removeListener('chainChanged', onChain as never)
    }
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalance(null)
      return
    }
    const res = await api<{ agent: { balance: string | null } }>(`/v1/agents/${agentIdOf(address)}`).catch(() => null)
    setBalance(res?.agent.balance ?? null)
  }, [address])

  useEffect(() => {
    void refreshBalance()
    if (!address) return
    const t = setInterval(() => void refreshBalance(), 20_000)
    return () => clearInterval(t)
  }, [address, refreshBalance])

  const switchToTempo = useCallback(async () => {
    if (!provider) return
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ADD_CHAIN_PARAMS.chainId }] })
    } catch (e) {
      if ((e as { code?: number }).code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String((e as Error).message))) throw e
      await provider.request({ method: 'wallet_addEthereumChain', params: [ADD_CHAIN_PARAMS] })
    }
    setChainId(tempoChain.id)
  }, [provider])

  const connect = useCallback(async () => {
    if (!provider) {
      setStatus('unavailable')
      return
    }
    setError(null)
    setStatus('connecting')
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
      if (!accounts[0]) throw new Error('No account was selected.')
      setAddress(getAddress(accounts[0]))
      setChainId(Number(await provider.request({ method: 'eth_chainId' })))
      write(CONNECTED_KEY, true)
      setStatus('connected')
      await switchToTempo().catch(() => undefined)
    } catch (e) {
      setError((e as { code?: number }).code === 4001 ? 'Connection cancelled in your wallet.' : (e as Error).message)
      setStatus('disconnected')
    }
  }, [provider, switchToTempo])

  const disconnect = useCallback(() => {
    write(CONNECTED_KEY, false)
    setAddress(null)
    setBalance(null)
    setStatus(provider ? 'disconnected' : 'unavailable')
    void provider?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] } as never).catch(() => undefined)
  }, [provider])

  const signer: Signer | null = useMemo(() => (address && provider ? { kind: 'extension', address, provider } : null), [address, provider])

  const client = useCallback(
    async (onStep?: (s: PayStep) => void) => {
      if (!signer || !address) throw new Error('Connect a wallet first.')
      if (chainId !== tempoChain.id) await switchToTempo()
      return new PactClient({
        gateway: '/api',
        agentId: agentIdOf(address),
        wallet: browserPayer(signer, onStep),
        trustedOperator: await trustedOperator(),
      })
    },
    [signer, address, chainId, switchToTempo],
  )

  const createAgent = useCallback(() => {
    if (!address) throw new Error('Connect a wallet first.')
    const key = generatePrivateKey()
    const agent: AgentKey = { address: privateKeyToAccount(key).address, key, owner: address, createdAt: new Date().toISOString() }
    setAgents((prev) => {
      const next = [agent, ...prev]
      write(AGENTS_KEY, next)
      return next
    })
    return agent
  }, [address])

  const removeAgent = useCallback((agentAddress: Address) => {
    setAgents((prev) => {
      const next = prev.filter((a) => a.address !== agentAddress)
      write(AGENTS_KEY, next)
      return next
    })
  }, [])

  const agentClient = useCallback(async (agent: AgentKey, onStep?: (s: PayStep) => void) => {
    const agentSigner: Signer = { kind: 'key', account: privateKeyToAccount(agent.key) }
    return new PactClient({
      gateway: '/api',
      agentId: agentIdOf(agent.address),
      wallet: browserPayer(agentSigner, onStep),
      trustedOperator: await trustedOperator(),
    })
  }, [])

  const markDone = useCallback((step: string) => {
    setProgress((prev) => {
      if (prev[step]) return prev
      const next = { ...prev, [step]: true }
      write(PROGRESS_KEY, next)
      return next
    })
  }, [])

  const value: WalletContext = {
    status,
    address,
    agentId: address ? agentIdOf(address) : null,
    onTempo: chainId === tempoChain.id,
    balance,
    error,
    connect,
    disconnect,
    switchToTempo,
    refreshBalance,
    signer,
    client,
    agents: address ? agents.filter((a) => a.owner === address) : [],
    createAgent,
    removeAgent,
    agentClient,
    progress,
    markDone,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWallet() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
