import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicClient, http, formatUnits, getAddress, isAddress } from 'viem';
import { bsc } from 'viem/chains';
import { RefreshCw, Wallet, ShieldCheck, ExternalLink, CircleAlert, Layers3 } from 'lucide-react';
import './style.css';

const chains = {
  bsc: { chain: bsc, label: 'BNB Smart Chain', explorer: 'https://bscscan.com', rpc: import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.binance.org' },
  robinhood: { chain: { id: 4661, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Robinhood', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } } }, label: 'Robinhood Chain (测试网)', explorer: 'https://explorer.testnet.chain.robinhood.com', rpc: import.meta.env.VITE_ROBINHOOD_RPC_URL || 'https://rpc.testnet.chain.robinhood.com' }
} as const;
const positionAbi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'nonce', type: 'uint96' }, { name: 'operator', type: 'address' }, { name: 'token0', type: 'address' }, { name: 'token1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint128' }, { name: 'feeGrowth0', type: 'uint256' }, { name: 'feeGrowth1', type: 'uint256' }, { name: 'owed0', type: 'uint128' }, { name: 'owed1', type: 'uint128' }] }
] as const;
const tokenAbi = [{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }, { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const;

type Row = { id: string; token0: string; token1: string; symbol0: string; symbol1: string; fee: number; lower: number; upper: number; liquidity: string; owed0: string; owed1: string; url: string };
function App() {
  const [network, setNetwork] = React.useState<'bsc'|'robinhood'>('bsc');
  const [protocol, setProtocol] = React.useState<'uniswap'|'pancake'>('pancake');
  const [address, setAddress] = React.useState(localStorage.getItem('lp-address') || '');
  const [manager, setManager] = React.useState('');
  const [rows, setRows] = React.useState<Row[]>([]);
  const [status, setStatus] = React.useState('输入钱包地址和官方 Position Manager 合约地址后开始查询。');
  const [busy, setBusy] = React.useState(false);
  const cfg = chains[network];

  async function load() {
    if (!isAddress(address) || !isAddress(manager)) { setStatus('请检查钱包地址和 Position Manager 合约地址是否有效。'); return; }
    setBusy(true); setRows([]); localStorage.setItem('lp-address', address);
    try {
      const client = createPublicClient({ chain: cfg.chain as any, transport: http(cfg.rpc, { timeout: 15000, retryCount: 2 }) });
      const owner = getAddress(address), contract = getAddress(manager);
      const count = await client.readContract({ address: contract, abi: positionAbi, functionName: 'balanceOf', args: [owner] });
      if (count > 300n) throw new Error('该地址仓位数量超过安全查询上限 300。');
      const list: Row[] = [];
      for (let i = 0n; i < count; i++) {
        const id = await client.readContract({ address: contract, abi: positionAbi, functionName: 'tokenOfOwnerByIndex', args: [owner, i] });
        const p = await client.readContract({ address: contract, abi: positionAbi, functionName: 'positions', args: [id] });
        const [sym0, sym1, dec0, dec1] = await Promise.all([
          client.readContract({ address: p.token0, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TOKEN'),
          client.readContract({ address: p.token1, abi: tokenAbi, functionName: 'symbol' }).catch(() => 'TOKEN'),
          client.readContract({ address: p.token0, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18),
          client.readContract({ address: p.token1, abi: tokenAbi, functionName: 'decimals' }).catch(() => 18)
        ]);
        list.push({ id: id.toString(), token0: p.token0, token1: p.token1, symbol0: String(sym0), symbol1: String(sym1), fee: Number(p.fee), lower: Number(p.tickLower), upper: Number(p.tickUpper), liquidity: p.liquidity.toString(), owed0: `${formatUnits(p.tokensOwed0, Number(dec0))} ${sym0}`, owed1: `${formatUnits(p.tokensOwed1, Number(dec1))} ${sym1}`, url: `${cfg.explorer}/token/${contract}?a=${id}` });
      }
      setRows(list); setStatus(list.length ? `查询完成：找到 ${list.length} 个 NFT 仓位。` : '查询完成：该地址没有此 Position Manager 下的仓位。');
    } catch (e) { setStatus(`查询失败：${e instanceof Error ? e.message : String(e)}。请核对网络、RPC 和合约地址。`); }
    finally { setBusy(false); }
  }
  return <main>
    <header><div className="brand"><div className="logo"><Layers3 size={22}/></div><div><strong>LP 管理台</strong><small>个人流动性仓位 · 只读模式</small></div></div><span className="secure"><ShieldCheck size={16}/> 不接触私钥</span></header>
    <section className="hero"><div className="eyebrow">LIQUIDITY OVERVIEW</div><h1>你的流动性，<em>一目了然。</em></h1><p>连接公开链上数据，查看集中流动性 NFT 仓位与待领取手续费。</p></section>
    <section className="panel"><div className="panel-title"><div><h2>查询仓位</h2><p>只读查询，不会发起任何链上交易</p></div><Wallet size={20}/></div>
      <div className="fields"><label>区块链<select value={network} onChange={e=>setNetwork(e.target.value as any)}><option value="bsc">BNB Smart Chain</option><option value="robinhood">Robinhood Chain 测试网</option></select></label><label>协议<select value={protocol} onChange={e=>setProtocol(e.target.value as any)}><option value="pancake">PancakeSwap V3</option><option value="uniswap">Uniswap V3</option></select></label></div>
      <label>钱包地址<input value={address} onChange={e=>setAddress(e.target.value)} placeholder="0x…" spellCheck={false}/></label>
      <label>Position Manager 合约地址<input value={manager} onChange={e=>setManager(e.target.value)} placeholder="粘贴所选链与协议的官方合约地址" spellCheck={false}/></label>
      <div className="notice"><CircleAlert size={17}/><span>合约地址需从协议官方文档核实。不同链部署可能不同；不要使用来源不明的地址。Robinhood 当前按测试网配置。</span></div>
      <button onClick={load} disabled={busy}>{busy ? <><RefreshCw className="spin" size={17}/>正在读取链上数据…</> : <><RefreshCw size={17}/>查询我的仓位</>}</button>
      <div className="status">{status}</div>
    </section>
    {rows.length > 0 && <section className="results"><div className="result-head"><div><h2>仓位列表</h2><p>{cfg.label} · {protocol === 'uniswap' ? 'Uniswap V3' : 'PancakeSwap V3'}</p></div><span>{rows.length} POSITIONS</span></div>{rows.map(r=><article className="position" key={r.id}><div className="pos-top"><div className="pair">{r.symbol0} <i>/</i> {r.symbol1}</div><a href={r.url} target="_blank" rel="noreferrer">NFT #{r.id} <ExternalLink size={14}/></a></div><div className="metrics"><div><small>手续费档位</small><b>{(r.fee/10000).toFixed(2)}%</b></div><div><small>下限 tick</small><b>{r.lower}</b></div><div><small>上限 tick</small><b>{r.upper}</b></div><div><small>流动性单位</small><b>{r.liquidity}</b></div></div><div className="owed"><span>当前记录的待领取手续费</span><b>{r.owed0} <i>+</i> {r.owed1}</b></div><div className="token-address">{r.token0} · {r.token1}</div></article>)}</section>}
    <footer>数据来自公开 RPC · 手续费数值为合约记录值，不含未结算的实时增长 · 请独立核实合约地址</footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
