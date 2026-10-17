import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicClient, http, formatUnits, getAddress, isAddress } from 'viem';
import { bsc } from 'viem/chains';
import { RefreshCw, Wallet, ShieldCheck, ExternalLink, CircleAlert, Layers3, Search, KeyRound, CheckCircle2, XCircle } from 'lucide-react';
import './style.css';

const chains = {
  bsc: { chain: bsc, label: 'BNB Smart Chain', explorer: 'https://bscscan.com', rpc: import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.binance.org' },
  robinhood: { chain: { id: 4661, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } } }, label: 'Robinhood Chain (测试网)', explorer: 'https://explorer.testnet.chain.robinhood.com', rpc: import.meta.env.VITE_ROBINHOOD_RPC_URL || 'https://rpc.testnet.chain.robinhood.com' }
} as const;

const knownManagers: Record<'bsc'|'robinhood', { manager: string; factory: string; protocol: string }[]> = {
  bsc: [
    { manager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364', factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', protocol: 'PancakeSwap V3' },
    { manager: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7', protocol: 'Uniswap V3' }
  ],
  robinhood: []
};

const positionAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'nonce', type: 'uint96' }, { name: 'operator', type: 'address' }, { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint128' }, { name: 'feeGrowth0', type: 'uint256' }, { name: 'feeGrowth1', type: 'uint256' }, { name: 'owed0', type: 'uint128' }, { name: 'owed1', type: 'uint128' }] }
] as const;

const tokenAbi = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }, { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const;
const factoryAbi = [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }, { name: 'fee', type: 'uint24' }], outputs: [{ type: 'address' }] }] as const;
const poolAbi = [{ type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }] }] as const;

type Pos = {
  id: string; protocol: string; manager: string; token0: string; token1: string;
  symbol0: string; symbol1: string; fee: number; lower: number; upper: number; liquidity: bigint;
  owed0: string; owed1: string; inRange: boolean | null; url: string;
};

function fmtNum(v: bigint, dec: number) {
  const s = formatUnits(v, dec);
  const n = Number(s);
  if (!isFinite(n)) return s;
  if (n !== 0 && Math.abs(n) < 0.0001) return '<0.0001';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function App() {
  const [network, setNetwork] = React.useState<'bsc'|'robinhood'>('bsc');
  const [address, setAddress] = React.useState(localStorage.getItem('lp-address') || '');
  const [apiKey, setApiKey] = React.useState(localStorage.getItem('lp-apikey') || '');
  const [customManager, setCustomManager] = React.useState('');
  const [customFactory, setCustomFactory] = React.useState('');
  const [rows, setRows] = React.useState<Pos[]>([]);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [scanned, setScanned] = React.useState(false);
  const cfg = chains[network];

  const log = (msg: string) => setLogs(prev => [...prev, msg]);

  async function discoverManagers(owner: string): Promise<string[]> {
    if (!apiKey.trim() || network !== 'bsc') return [];
    const url = `https://api.etherscan.io/v2/api?chainid=56&module=account&action=tokennfttx&address=${owner}&startblock=0&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${apiKey.trim()}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== '1' || !Array.isArray(data.result)) { log(`索引查询: ${data.message || '无结果'}`); return []; }
    const contracts = new Set<string>();
    for (const t of data.result) {
      if (t.to.toLowerCase() === owner.toLowerCase()) contracts.add(t.contractAddress.toLowerCase());
    }
    log(`索引发现 ${contracts.size} 种 NFT 合约`);
    return [...contracts];
  }

  async function scan() {
    if (!isAddress(address)) { log('请输入有效钱包地址'); setScanned(true); setRows([]); return; }
    setBusy(true); setRows([]); setLogs([]); setScanned(false);
    localStorage.setItem('lp-address', address); localStorage.setItem('lp-apikey', apiKey);
    const owner = getAddress(address);
    try {
      const client = createPublicClient({ chain: cfg.chain as any, transport: http(cfg.rpc, { timeout: 20000, retryCount: 2 }) });

      const managers = new Map<string, { factory: string; protocol: string }>();
      for (const k of knownManagers[network]) managers.set(k.manager.toLowerCase(), { factory: k.factory, protocol: k.protocol });
      try {
        const found = await discoverManagers(owner);
        for (const c of found) if (!managers.has(c)) managers.set(c, { factory: '', protocol: '未知协议' });
      } catch (e: any) { log(`索引查询失败,仅使用内置合约: ${e?.message || e}`); }
      if (isAddress(customManager)) {
        managers.set(customManager.toLowerCase(), { factory: isAddress(customFactory) ? customFactory : '', protocol: '自定义合约' });
      }
      log(`将检查 ${managers.size} 个候选 Position Manager`);

      const list: Pos[] = [];
      for (const [mAddr, info] of managers) {
        const contract = getAddress(mAddr);
        let count: bigint;
        try { count = await client.readContract({ address: contract, abi: positionAbi, functionName: 'balanceOf', args: [owner] }); }
        catch { continue; }
        if (count === 0n) continue;
        if (count > 300n) { log(`${info.protocol}: 仓位数超过 300,已跳过`); continue; }

        for (let i = 0n; i < count; i++) {
          try {
            const id = await client.readContract({ address: contract, abi: positionAbi, functionName: 'tokenOfOwnerByIndex', args: [owner, i] });
            const p = await client.readContract({ address: contract, abi: positionAbi, functionName: 'positions', args: [id] });
            const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , owed0, owed1] = p as any;
            if (liquidity === 0n && owed0 === 0n && owed1 === 0n) continue;

            const [sym0, sym1, dec0, dec1] = await Promise.all([
              client.readContract({ address: token0, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TOKEN'),
              client.readContract({ address: token1, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TOKEN'),
              client.readContract({ address: token0, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18),
              client.readContract({ address: token1, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18)
            ]);

            let inRange: boolean | null = null;
            if (info.factory) {
              try {
                const pool = await client.readContract({ address: getAddress(info.factory), abi: factoryAbi, functionName: 'getPool', args: [token0, token1, fee] });
                const s0 = await client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' });
                const tick = Number((s0 as any)[1]);
                inRange = tick >= Number(tickLower) && tick < Number(tickUpper);
              } catch { inRange = null; }
            }

            list.push({
              id: id.toString(), protocol: info.protocol, manager: mAddr,
              token0, token1, symbol0: String(sym0), symbol1: String(sym1),
              fee: Number(fee), lower: Number(tickLower), upper: Number(tickUpper), liquidity,
              owed0: `${fmtNum(owed0, Number(dec0))} ${sym0}`, owed1: `${fmtNum(owed1, Number(dec1))} ${sym1}`,
              inRange, url: `${cfg.explorer}/nft/${contract}/${id}`
            });
          } catch { }
        }
      }
      setRows(list);
      log(list.length ? `扫描完成:找到 ${list.length} 个仓位` : '扫描完成:未发现仓位');
      if (!apiKey.trim() && network === 'bsc') log('提示:填 Etherscan API Key 可发现更多协议的仓位');
    } catch (e: any) { log(`扫描失败:${e?.message || e}`); }
    finally { setBusy(false); setScanned(true); }
  }

  const inRangeCount = rows.filter(r => r.inRange === true).length;
  const outRangeCount = rows.filter(r => r.inRange === false).length;

  return <main>
    <header>
      <div className="brand"><div className="logo"><Layers3 size={22}/></div><div><strong>LP 管理台</strong><small>个人流动性仓位 · 只读模式</small></div></div>
      <span className="secure"><ShieldCheck size={16}/> 不接触私钥</span>
    </header>
    <section className="hero"><div className="eyebrow">LIQUIDITY OVERVIEW</div><h1>输入地址，<em>自动扫描仓位。</em></h1><p>自动发现 BSC 上 PancakeSwap V3 / Uniswap V3 的集中流动性仓位,读取区间状态与待领手续费。</p></section>
    <section className="panel">
      <div className="panel-title"><div><h2>扫描仓位</h2><p>只读查询,不会发起任何链上交易</p></div><Search size={20}/></div>
      <div className="fields">
        <label>区块链<select value={network} onChange={e=>setNetwork(e.target.value as 'bsc'|'robinhood')}><option value="bsc">BNB Smart Chain</option><option value="robinhood">Robinhood Chain 测试网</option></select></label>
        <label>Etherscan API Key(可选)<input value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="扩大扫描范围" spellCheck={false}/></label>
      </div>
      <label>钱包地址<input value={address} onChange={e=>setAddress(e.target.value)} placeholder="0x…" spellCheck={false}/></label>
      <details className="advanced"><summary>手动添加 Position Manager(可选)</summary>
        <div className="fields">
          <label>Manager 合约<input value={customManager} onChange={e=>setCustomManager(e.target.value)} placeholder="0x…" spellCheck={false}/></label>
          <label>Factory 合约(可选)<input value={customFactory} onChange={e=>setCustomFactory(e.target.value)} placeholder="0x…" spellCheck={false}/></label>
        </div>
      </details>
      <div className="notice"><KeyRound size={17}/><span>API Key 在 <a href="https://etherscan.io/apis" target="_blank" rel="noreferrer">etherscan.io/apis</a> 免费申请,保存在你自己的浏览器。不填也能查内置的 PancakeSwap V3 / Uniswap V3 仓位。</span></div>
      <button onClick={scan} disabled={busy}>{busy ? <><RefreshCw className="spin" size={17}/>正在扫描链上仓位…</> : <><Search size={17}/>扫描我的仓位</>}</button>
      {logs.length > 0 && <div className="status">{logs.map((l,i)=><div key={i}>{l}</div>)}</div>}
    </section>
    {scanned && rows.length > 0 && <section className="dash"><div className="stat"><small>仓位总数</small><b>{rows.length}</b></div><div className="stat good"><small>区间内</small><b>{inRangeCount}</b></div><div className="stat warn"><small>区间外</small><b>{outRangeCount}</b></div><div className="stat"><small>网络</small><b>{cfg.label}</b></div></section>}
    {rows.length > 0 && <section className="results"><div className="result-head"><div><h2>仓位列表</h2><p>{cfg.label}</p></div><span>{rows.length} POSITIONS</span></div>{rows.map(r=><article className="position" key={r.manager+r.id}><div className="pos-top"><div className="pair">{r.symbol0} <i>/</i> {r.symbol1} <em className="fee-tag">{(r.fee/10000).toFixed(2)}%</em></div><div className="pos-right">{r.inRange === true && <span className="badge in"><CheckCircle2 size={13}/>区间内</span>}{r.inRange === false && <span className="badge out"><XCircle size={13}/>区间外</span>}<a href={r.url} target="_blank" rel="noreferrer">#{r.id} <ExternalLink size={14}/></a></div></div><div className="metrics"><div><small>协议</small><b>{r.protocol}</b></div><div><small>下限 tick</small><b>{r.lower}</b></div><div><small>上限 tick</small><b>{r.upper}</b></div><div><small>流动性</small><b>{r.liquidity.toString()}</b></div></div><div className="owed"><span>待领取手续费</span><b>{r.owed0} <i>+</i> {r.owed1}</b></div><div className="token-address">{r.manager}</div></article>)}</section>}
    <footer>数据来自公开 RPC 与 Etherscan API · 手续费为合约记录值 · 仅供个人参考</footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
