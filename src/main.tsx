import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicClient, http, formatUnits, getAddress, isAddress, parseAbiItem } from 'viem';
import { bsc } from 'viem/chains';
import { RefreshCw, Search, ExternalLink, Layers, ChevronDown, ChevronRight, Coins, AlertCircle } from 'lucide-react';
import './style.css';

const robinhoodChain = {
  id: 4661,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
} as const;

const chains: Record<'bsc'|'robinhood', { chain: any; label: string; explorer: string; rpc: string }> = {
  bsc: {
    chain: bsc,
    label: 'BNB Chain',
    explorer: 'https://bscscan.com',
    rpc: 'https://bsc-dataseed.binance.org',
  },
  robinhood: {
    chain: robinhoodChain,
    label: 'Robinhood Chain',
    explorer: 'https://explorer.chain.robinhood.com',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
  },
};

const v3Managers: Record<string, { manager: string; factory: string; protocol: string; link: string }[]> = {
  bsc: [
    { 
      manager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', 
      factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', 
      protocol: 'PancakeSwap V3',
      link: 'https://pancakeswap.finance/liquidity/'
    },
    { 
      manager: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', 
      factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7', 
      protocol: 'Uniswap V3',
      link: 'https://app.uniswap.org/positions/v3/bnb/'
    },
  ],
  robinhood: [
    { 
      manager: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', 
      factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7', 
      protocol: 'Uniswap V3',
      link: 'https://app.uniswap.org/positions/v3/robinhood/'
    },
  ],
};

const positionAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [
    { name: 'nonce', type: 'uint96' }, { name: 'operator', type: 'address' },
    { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' },
    { name: 'liquidity', type: 'uint128' }, { name: 'feeGrowthInside0LastX128', type: 'uint256' }, { name: 'feeGrowthInside1LastX128', type: 'uint256' },
    { name: 'tokensOwed0', type: 'uint128' }, { name: 'tokensOwed1', type: 'uint128' }
  ]},
  { type: 'function', name: 'collect', stateMutability: 'nonpayable', inputs: [
    { name: 'params', type: 'tuple', components: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'amount0Max', type: 'uint128' },
      { name: 'amount1Max', type: 'uint128' }
    ]}
  ], outputs: [{ name: 'amount0', type: 'uint256' }, { name: 'amount1', type: 'uint256' }] }
] as const;

const tokenAbi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }
] as const;

const factoryAbi = [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] }] as const;
const poolAbi = [{ type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }] }] as const;

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

type Pos = {
  id: string; protocol: string; manager: string;
  token0: string; token1: string; symbol0: string; symbol1: string;
  fee: number; lower: number; upper: number; liquidity: bigint;
  pending0: string; pending1: string;
  inRange: boolean | null; url: string;
};

function fmt(v: bigint, d: number) {
  const s = formatUnits(v, d);
  const n = Number(s);
  return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : s;
}

function App() {
  const [network, setNetwork] = useState<'bsc'|'robinhood'>('bsc');
  const [address, setAddress] = useState('');
  const [rows, setRows] = useState<Pos[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState('');

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  async function getTokenIdsViaAPI(owner: string, contract: string, chainId: number): Promise<string[]> {
    const apiKey = '747RNQW8CBCUYNVCKMAAY8TZ8R8A8DNTA2';
    try {
      const res = await fetch(`https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokennfttx&contractaddress=${contract}&address=${owner}&page=1&offset=1000&sort=asc&apikey=${apiKey}`);
      const data = await res.json();
      if (data.status === '1' && Array.isArray(data.result)) {
        const owned = new Map<string, string>();
        for (const t of data.result) owned.set(t.tokenID, t.to.toLowerCase());
        return [...owned.entries()].filter(([, to]) => to === owner.toLowerCase()).map(([id]) => id);
      }
    } catch(e) {}
    return [];
  }

  async function getTokenIdsViaLogs(client: any, owner: string, contract: `0x${string}`): Promise<bigint[]> {
    const ids = new Map<string, bigint>();
    const latest = await client.getBlockNumber();
    const CHUNK = 100000n;
    for (let from = latest > CHUNK ? latest - CHUNK : 0n; ; ) {
      const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
      try {
        const logs = await client.getLogs({
          address: contract,
          event: TRANSFER_EVENT,
          args: { to: owner },
          fromBlock: from,
          toBlock: to,
        });
        for (const l of logs) if (l.args?.tokenId !== undefined) ids.set(l.args.tokenId.toString(), l.args.tokenId as bigint);
      } catch(e) { }
      if (from === 0n) break;
      from = from > CHUNK ? from - CHUNK : 0n;
      setProgress(`Scanning events... ${Math.round((1 - Number(from)/Number(latest)) * 100)}%`);
      if (from === 0n && to === latest) break;
      if (from <= 0n) break;
      if (latest - from > 5000000n) break;
    }
    setProgress('');
    const held: bigint[] = [];
    for (const id of ids.values()) {
      try {
        const o = await client.readContract({ address: contract, abi: [{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{type:'address'}]}], functionName: 'ownerOf', args: [id] });
        if ((o as string).toLowerCase() === owner.toLowerCase()) held.push(id);
      } catch(e) {}
    }
    return held;
  }

  async function scan() {
    if (!isAddress(address)) { setError('请输入有效地址'); return; }
    setBusy(true); setRows([]); setMsg(''); setError(''); setExpanded(new Set()); setProgress('');
    const owner = getAddress(address);
    const cfg = chains[network];
    const client = createPublicClient({ chain: cfg.chain as any, transport: http(cfg.rpc, { timeout: 30000 }) });
    
    const chainId = await client.getChainId();
    
    const managers = new Map<string, {factory:string;protocol:string;link:string}>();
    v3Managers[network].forEach(k => managers.set(k.manager.toLowerCase(), {factory:k.factory, protocol:k.protocol, link:k.link}));
    
    const list: Pos[] = [];
    const errors: string[] = [];
    
    for (const [addr, info] of managers) {
      try {
        const contract = getAddress(addr);
        const count = await client.readContract({ address: contract, abi: positionAbi, functionName: 'balanceOf', args: [owner] });
        if (!count || count === 0n) continue;
        
        let tokenIds: bigint[] = [];
        
        // Method 1: Enumerable
        try {
          const ids: bigint[] = [];
          for (let i = 0n; i < count && i < 50n; i++) {
            ids.push(await client.readContract({ address: contract, abi: positionAbi, functionName: 'tokenOfOwnerByIndex', args: [owner, i] }));
          }
          tokenIds = ids;
        } catch(e) { }
        
        // Method 2: Etherscan V2 API
        if (tokenIds.length === 0) {
          const apiIds = await getTokenIdsViaAPI(owner, contract, chainId);
          tokenIds = apiIds.map(id => BigInt(id));
        }
        
        // Method 3: Transfer 事件日志扫描
        if (tokenIds.length === 0) {
          try { tokenIds = await getTokenIdsViaLogs(client, owner, contract); } catch(e) {}
        }
        
        if (tokenIds.length === 0) {
          errors.push(`${info.protocol}: 无法枚举仓位`);
          continue;
        }
        
        for (const tokenId of tokenIds.slice(0, 50)) {
          try {
            const p = await client.readContract({ address: contract, abi: positionAbi, functionName: 'positions', args: [tokenId] });
            const [, , t0, t1, fee, tl, tu, liq, , , owed0, owed1] = p as any;
            
            const [s0, s1, d0, d1] = await Promise.all([
              client.readContract({ address: t0, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TKN'),
              client.readContract({ address: t1, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TKN'),
              client.readContract({ address: t0, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18),
              client.readContract({ address: t1, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18),
            ]);
            
            let inRange = null;
            let pending0 = '0', pending1 = '0';
            
            if (info.factory && liq > 0n) {
              try {
                const pool = await client.readContract({ address: getAddress(info.factory), abi: factoryAbi, functionName: 'getPool', args: [t0, t1, fee] });
                const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' });
                const tick = Number((slot0 as any)[1]);
                inRange = tick >= tl && tick < tu;
              } catch(e) {}
              try {
                const [a0, a1] = await client.simulateContract({
                  address: contract, abi: positionAbi, functionName: 'collect',
                  args: [{ tokenId, recipient: owner, amount0Max: BigInt('0xffffffffffffffffffffffffffffffff'), amount1Max: BigInt('0xffffffffffffffffffffffffffffffff') }],
                  account: owner
                });
                pending0 = fmt(a0 as bigint, d0); pending1 = fmt(a1 as bigint, d1);
              } catch(e) { pending0 = fmt(owed0, d0); pending1 = fmt(owed1, d1); }
            } else {
              pending0 = fmt(owed0, d0); pending1 = fmt(owed1, d1);
            }
            
            list.push({
              id: tokenId.toString(), protocol: info.protocol, manager: addr,
              token0: t0, token1: t1, symbol0: String(s0), symbol1: String(s1),
              fee: Number(fee), lower: Number(tl), upper: Number(tu), liquidity: liq,
              pending0: `${pending0} ${s0}`, pending1: `${pending1} ${s1}`,
              inRange, url: `${info.link}${tokenId}`
            });
          } catch(e) {}
        }
      } catch(e) {
        errors.push(`${info.protocol}: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    
    setRows(list);
    setProgress('');
    if (list.length === 0 && errors.length > 0) setError(errors.join('; '));
    else setMsg(list.length ? `Found ${list.length} positions` : 'No positions found');
    setBusy(false);
  }

  const active = rows.filter(r => r.liquidity > 0n);
  const empty = rows.filter(r => r.liquidity === 0n);
  const inRange = active.filter(r => r.inRange).length;
  const outRange = active.filter(r => r.inRange === false).length;

  const renderPos = (r: Pos, isCollapsed: boolean) => (
    <div key={r.manager+r.id} className={`position-card ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="pos-header" onClick={()=>toggle(r.manager+r.id)} style={{cursor: isCollapsed ? 'pointer' : 'default'}}>
        <div className="pair-name">
          {isCollapsed && <ChevronRight size={16} className="chevron"/>}
          {r.symbol0} / {r.symbol1} 
          <span className="fee">{(r.fee/10000).toFixed(2)}%</span>
          {isCollapsed && <span className="empty-badge">Closed</span>}
        </div>
        <div className="pos-meta">
          {!isCollapsed && r.inRange !== null && (
            <span className={`range-badge ${r.inRange ? 'in' : 'out'}`}>
              {r.inRange ? 'IN RANGE' : 'OUT OF RANGE'}
            </span>
          )}
          <a href={r.url} target="_blank" rel="noreferrer" className="ext-link" onClick={e=>e.stopPropagation()}><ExternalLink size={14}/></a>
          {!isCollapsed && <ChevronDown size={16} className="chevron"/>}
        </div>
      </div>
      {!isCollapsed && (
        <div className="pos-body">
          <div className="pos-row"><span>Protocol</span><span>{r.protocol}</span></div>
          <div className="pos-row"><span>Position ID</span><span>#{r.id}</span></div>
          <div className="pos-row"><span>Tick Range</span><span>{r.lower} — {r.upper}</span></div>
          <div className="pos-row"><span>Liquidity</span><span>{r.liquidity.toString()}</span></div>
          <div className="pos-row fees"><Coins size={14}/> <span>Fees</span><span>{r.pending0} + {r.pending1}</span></div>
        </div>
      )}
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand"><Layers className="icon"/><span>LP Manager</span></div>
        <div className="networks">
          <button className={network==='bsc'?'active':''} onClick={()=>setNetwork('bsc')}>BSC</button>
          <button className={network==='robinhood'?'active':''} onClick={()=>setNetwork('robinhood')}>Robinhood</button>
        </div>
      </header>

      <main className="main">
        <div className="search-box">
          <input 
            placeholder="Enter wallet address (0x...)" 
            value={address} 
            onChange={e=>setAddress(e.target.value)}
            className="addr-input"
          />
          <button onClick={scan} disabled={busy} className="scan-btn">
            {busy ? <RefreshCw className="spin"/> : <Search/>} Scan
          </button>
        </div>

        {progress && <div className="msg">{progress}</div>}
        {error && <div className="msg error"><AlertCircle size={14}/> {error}</div>}
        {msg && <div className="msg">{msg}</div>}

        {rows.length > 0 && (
          <>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value">{active.length}</div></div>
              <div className="stat-card in"><div className="stat-label">In Range</div><div className="stat-value">{inRange}</div></div>
              <div className="stat-card out"><div className="stat-label">Out of Range</div><div className="stat-value">{outRange}</div></div>
              <div className="stat-card"><div className="stat-label">Closed</div><div className="stat-value">{empty.length}</div></div>
            </div>

            <div className="positions-list">
              {active.map(r => renderPos(r, false))}
            </div>

            {empty.length > 0 && (
              <div className="empty-section">
                <button className="empty-toggle" onClick={()=>setShowEmpty(!showEmpty)}>
                  {showEmpty ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                  {empty.length} closed positions
                </button>
                {showEmpty && <div className="positions-list">{empty.map(r => renderPos(r, true))}</div>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
