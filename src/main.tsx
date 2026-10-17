import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicClient, http, formatUnits, getAddress, isAddress } from 'viem';
import { bsc } from 'viem/chains';
import { RefreshCw, Wallet, Search, ExternalLink, Layers, TrendingUp, AlertCircle } from 'lucide-react';
import './style.css';

const robinhoodChain = {
  id: 4661,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
} as const;

const chains = {
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
} as const;

const knownManagers: Record<string, { manager: string; factory: string; protocol: string }[]> = {
  bsc: [
    { manager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', protocol: 'PancakeSwap V3' },
    { manager: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7', protocol: 'Uniswap V3' },
  ],
  robinhood: [],
};

const positionAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [
    { name: 'nonce', type: 'uint96' }, { name: 'operator', type: 'address' },
    { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' },
    { name: 'liquidity', type: 'uint128' }, { name: 'feeGrowth0', type: 'uint256' }, { name: 'feeGrowth1', type: 'uint256' },
    { name: 'owed0', type: 'uint128' }, { name: 'owed1', type: 'uint128' }
  ]}
] as const;

const tokenAbi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }
] as const;

const factoryAbi = [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] }] as const;
const poolAbi = [{ type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }] }] as const;

type Pos = {
  id: string; protocol: string; manager: string;
  token0: string; token1: string; symbol0: string; symbol1: string;
  fee: number; lower: number; upper: number; liquidity: bigint;
  owed0: string; owed1: string; inRange: boolean | null; url: string;
};

function fmt(v: bigint, d: number) {
  const s = formatUnits(v, d);
  const n = Number(s);
  return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : s;
}

function App() {
  const [network, setNetwork] = useState<'bsc'|'robinhood'>('bsc');
  const [address, setAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [rows, setRows] = useState<Pos[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function scan() {
    if (!isAddress(address)) { setMsg('请输入有效地址'); return; }
    setBusy(true); setRows([]); setMsg('');
    const owner = getAddress(address);
    const client = createPublicClient({ chain: chains[network].chain as any, transport: http(chains[network].rpc) });
    
    const managers = new Map<string, {factory:string;protocol:string}>();
    knownManagers[network].forEach(k => managers.set(k.manager.toLowerCase(), {factory:k.factory, protocol:k.protocol}));
    
    if (apiKey.trim() && network === 'bsc') {
      try {
        const res = await fetch(`https://api.etherscan.io/v2/api?chainid=56&module=account&action=tokennfttx&address=${owner}&page=1&offset=100&sort=desc&apikey=${apiKey}`);
        const data = await res.json();
        if (data.status === '1') {
          data.result.forEach((t:any) => {
            if (t.to.toLowerCase() === owner.toLowerCase()) {
              const c = t.contractAddress.toLowerCase();
              if (!managers.has(c)) managers.set(c, {factory:'', protocol:'Unknown V3'});
            }
          });
        }
      } catch(e) {}
    }

    const list: Pos[] = [];
    for (const [addr, info] of managers) {
      try {
        const contract = getAddress(addr);
        const count = await client.readContract({ address: contract, abi: positionAbi, functionName: 'balanceOf', args: [owner] });
        if (!count) continue;
        
        for (let i = 0n; i < count && i < 20n; i++) {
          const id = await client.readContract({ address: contract, abi: positionAbi, functionName: 'tokenOfOwnerByIndex', args: [owner, i] });
          const p = await client.readContract({ address: contract, abi: positionAbi, functionName: 'positions', args: [id] });
          const [, , t0, t1, fee, tl, tu, liq, , , o0, o1] = p as any;
          
          const [s0, s1, d0, d1] = await Promise.all([
            client.readContract({ address: t0, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TKN'),
            client.readContract({ address: t1, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TKN'),
            client.readContract({ address: t0, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18),
            client.readContract({ address: t1, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18),
          ]);
          
          let inRange = null;
          if (info.factory) {
            try {
              const pool = await client.readContract({ address: getAddress(info.factory), abi: factoryAbi, functionName: 'getPool', args: [t0, t1, fee] });
              const s = await client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' });
              const tick = Number((s as any)[1]);
              inRange = tick >= tl && tick < tu;
            } catch(e) {}
          }
          
          list.push({
            id: id.toString(), protocol: info.protocol, manager: addr,
            token0: t0, token1: t1, symbol0: String(s0), symbol1: String(s1),
            fee: Number(fee), lower: Number(tl), upper: Number(tu), liquidity: liq,
            owed0: `${fmt(o0, d0)} ${s0}`, owed1: `${fmt(o1, d1)} ${s1}`,
            inRange, url: `${chains[network].explorer}/nft/${contract}/${id}`
          });
        }
      } catch(e) {}
    }
    
    setRows(list);
    setMsg(list.length ? `Found ${list.length} positions` : 'No V3 positions found');
    setBusy(false);
  }

  const inRange = rows.filter(r => r.inRange).length;
  const outRange = rows.filter(r => r.inRange === false).length;
  const totalOwed = rows.reduce((acc, r) => acc + r.owed0 + r.owed1, 0);

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
          <input 
            placeholder="Etherscan API Key (optional)" 
            value={apiKey} 
            onChange={e=>setApiKey(e.target.value)}
            className="api-input"
          />
          <button onClick={scan} disabled={busy} className="scan-btn">
            {busy ? <RefreshCw className="spin"/> : <Search/>} Scan Positions
          </button>
        </div>

        {msg && <div className="msg">{msg}</div>}

        {rows.length > 0 && (
          <>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">Total Positions</div><div className="stat-value">{rows.length}</div></div>
              <div className="stat-card in"><div className="stat-label">In Range</div><div className="stat-value">{inRange}</div></div>
              <div className="stat-card out"><div className="stat-label">Out of Range</div><div className="stat-value">{outRange}</div></div>
              <div className="stat-card"><div className="stat-label">Uncollected Fees</div><div className="stat-value">--</div></div>
            </div>

            <div className="positions-list">
              {rows.map(r => (
                <div key={r.manager+r.id} className="position-card">
                  <div className="pos-header">
                    <div className="pair-name">{r.symbol0} / {r.symbol1} <span className="fee">{(r.fee/10000).toFixed(2)}%</span></div>
                    <div className="pos-meta">
                      {r.inRange !== null && (
                        <span className={`range-badge ${r.inRange ? 'in' : 'out'}`}>
                          {r.inRange ? 'IN RANGE' : 'OUT OF RANGE'}
                        </span>
                      )}
                      <a href={r.url} target="_blank" rel="noreferrer" className="ext-link"><ExternalLink size={14}/></a>
                    </div>
                  </div>
                  <div className="pos-body">
                    <div className="pos-row"><span>Protocol</span><span>{r.protocol}</span></div>
                    <div className="pos-row"><span>Position ID</span><span>#{r.id}</span></div>
                    <div className="pos-row"><span>Tick Range</span><span>{r.lower} — {r.upper}</span></div>
                    <div className="pos-row"><span>Liquidity</span><span>{r.liquidity.toString()}</span></div>
                    <div className="pos-row fees"><span>Fees to Collect</span><span>{r.owed0} + {r.owed1}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
