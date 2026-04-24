// lib/core.mjs — 共用的 Monte Carlo 核心
// 此檔為 CLI 腳本（mc_*.mjs）與網頁 Worker（web/worker.mjs）的**單一來源**。
// 修改此檔的 ASSETS、CORR、PORT_* 會同時影響所有情境與前後端，不需要再多處同步。

// ================= 資產參數（年化，淨於費用率）=================
export const ASSETS = {
  '0050':   { mu: 0.08 - 0.0045, sig: 0.15 },
  '006208': { mu: 0.08 - 0.0025, sig: 0.15 },
  '00757':  { mu: 0.13 - 0.0100, sig: 0.25 },
  'QQQM':   { mu: 0.11 - 0.0015, sig: 0.20 },
  // Leveraged: R_lev = 2R - sigma^2 (underlying) + 2% backwardation - 1.1% expense
  '00631L': { mu: 2*0.08 - (0.15*0.15) + 0.02 - 0.011, sig: 2*0.15 }
};

// ================= 相關係數矩陣 =================
// 0050 ≈ 006208（皆為台灣 50）彼此 0.99，與 00631L 0.98
// 00757 (FANG+) 與 QQQM (Nasdaq100) 0.90 相關
// 台股 vs 美股科技 0.50；台股槓桿 vs 美股科技 0.48
export const CORR_ORDER = ['0050','006208','00757','QQQM','00631L'];
export const CORR = [
  //        0050   006208 00757  QQQM   00631L
  /*0050  */[1.00, 0.99,  0.50,  0.50,  0.98],
  /*06208 */[0.99, 1.00,  0.50,  0.50,  0.98],
  /*00757 */[0.50, 0.50,  1.00,  0.90,  0.48],
  /*QQQM  */[0.50, 0.50,  0.90,  1.00,  0.48],
  /*00631L*/[0.98, 0.98,  0.48,  0.48,  1.00]
];

// ================= 組合定義 =================
export const PORT_A = { name: 'Portfolio A (Original)',  legs: [['0050',0.40],['00757',0.30],['00631L',0.30]] };
export const PORT_B = { name: 'Portfolio B (Optimized)', legs: [['006208',0.50],['QQQM',0.30],['00631L',0.20]] };

// ================= RNG：Mulberry32 + Box-Muller =================
export function mulberry32(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function makeGauss(rand){
  let spare = null;
  return function(){
    if (spare !== null){ const v = spare; spare = null; return v; }
    let u1, u2;
    do { u1 = rand(); } while (u1 <= 1e-12);
    u2 = rand();
    const r = Math.sqrt(-2*Math.log(u1));
    const th = 2*Math.PI*u2;
    spare = r*Math.sin(th);
    return r*Math.cos(th);
  };
}

// ================= Cholesky 分解（下三角）=================
export function cholesky(A){
  const n = A.length;
  const L = Array.from({length:n}, () => new Array(n).fill(0));
  for (let i=0;i<n;i++){
    for (let j=0;j<=i;j++){
      let s = A[i][j];
      for (let k=0;k<j;k++) s -= L[i][k]*L[j][k];
      if (i===j){
        if (s <= 0) throw new Error('Matrix not PD at '+i);
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

export function pickSubCorr(names){
  const idx = names.map(n => CORR_ORDER.indexOf(n));
  return idx.map(i => idx.map(j => CORR[i][j]));
}

// ================= 百分位（線性內插）=================
export function percentile(sortedAsc, p){
  const n = sortedAsc.length;
  const rank = (p/100)*(n-1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const w = rank - lo;
  return sortedAsc[lo]*(1-w) + sortedAsc[hi]*w;
}

// ================= 統一 simulate =================
// 三個情境都走此入口。scenarios-specific 邏輯由 caller 的 analyze() 處理。
//
// opts:
//   initial        初始本金（scenario 1 傳 1.0 視為 per-unit 模擬）
//   annual         年加碼金額（0 = lump-sum；> 0 = DCA）
//   contribYears   加碼年數（0 = 無 DCA；加碼發生於第 1..contribYears 年之年初）
//   years          模擬總年數
//   iters          迭代次數
//   seed           RNG seed
//   target         用於計算 year_reached；scenario 1 可傳 Infinity 跳過
//   storeFullPaths 是否保留完整 (iters × years+1) paths（scenario 1 要畫軌跡帶；web 亦要）
//   onProgress     fn(pct: 0..1)，若提供則每 500 iter 回報一次
//
// 回傳：
//   finals              (Float64Array) 各路徑最終淨值
//   finalsSorted        (number[])     已排序副本
//   mdds                (Float64Array) 各路徑最大回撤
//   mddsSorted          (number[])     已排序
//   yearReached         (Int32Array)   首次達 target 的年份；-1 = 從未達標
//   pathsFlat           (Float64Array|null) 若 storeFullPaths；shape = iters*(years+1)
//   p5Path/p50Path/p95Path/meanPath  (number[]|null) 若 storeFullPaths，per-year 百分位
//   elapsedMs           (number)       計算耗時
export function simulate(portfolio, opts){
  const {
    initial,
    annual = 0,
    contribYears = 0,
    years,
    iters,
    seed,
    target = Infinity,
    storeFullPaths = false,
    onProgress = null,
  } = opts;

  const legs = portfolio.legs;
  const names = legs.map(l => l[0]);
  const weights = legs.map(l => l[1]);
  const mus  = names.map(n => ASSETS[n].mu);
  const sigs = names.map(n => ASSETS[n].sig);
  const L = cholesky(pickSubCorr(names));
  const k = names.length;

  const rand = mulberry32(seed);
  const gauss = makeGauss(rand);

  const finals       = new Float64Array(iters);
  const mdds         = new Float64Array(iters);
  const yearReached  = new Int32Array(iters);
  const pathsFlat    = storeFullPaths ? new Float64Array(iters * (years + 1)) : null;

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  for (let it = 0; it < iters; it++){
    let V = initial;
    let peak = V;
    let maxDD = 0.0;
    let reached = V >= target ? 0 : -1;
    if (pathsFlat) pathsFlat[it * (years + 1)] = V;

    for (let y = 1; y <= years; y++){
      // 年初加碼（DCA 期內）
      if (y <= contribYears) V = V + annual;

      // 相關常態變量 → 組合報酬
      const z = new Array(k);
      for (let i = 0; i < k; i++) z[i] = gauss();
      let rp = 0;
      for (let i = 0; i < k; i++){
        let eps = 0;
        for (let j = 0; j <= i; j++) eps += L[i][j] * z[j];
        rp += weights[i] * (mus[i] + sigs[i] * eps);
      }
      if (rp < -0.95) rp = -0.95;

      V = V * (1 + rp);
      if (pathsFlat) pathsFlat[it * (years + 1) + y] = V;
      if (V > peak) peak = V;
      const dd = (peak - V) / peak;
      if (dd > maxDD) maxDD = dd;
      if (V >= target && reached === -1) reached = y;
    }

    finals[it]      = V;
    mdds[it]        = maxDD;
    yearReached[it] = reached;

    if (onProgress && (it + 1) % 500 === 0){
      onProgress((it + 1) / iters);
    }
  }
  if (onProgress) onProgress(1);

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // 排序副本供後續百分位 / 機率計算
  const finalsSorted = Array.from(finals).sort((a,b) => a-b);
  const mddsSorted   = Array.from(mdds).sort((a,b) => a-b);

  // per-year 百分位（只有 storeFullPaths 才算）
  let p5Path = null, p50Path = null, p95Path = null, meanPath = null;
  if (pathsFlat){
    p5Path  = new Array(years + 1);
    p50Path = new Array(years + 1);
    p95Path = new Array(years + 1);
    meanPath = new Array(years + 1).fill(0);
    for (let y = 0; y <= years; y++){
      const col = new Array(iters);
      for (let it = 0; it < iters; it++) col[it] = pathsFlat[it * (years + 1) + y];
      col.sort((a,b) => a-b);
      p5Path[y]  = percentile(col, 5);
      p50Path[y] = percentile(col, 50);
      p95Path[y] = percentile(col, 95);
      let s = 0; for (const v of col) s += v;
      meanPath[y] = s / iters;
    }
  }

  return {
    name: portfolio.name,
    finals, finalsSorted,
    mdds, mddsSorted,
    yearReached,
    pathsFlat,
    p5Path, p50Path, p95Path, meanPath,
    elapsedMs: t1 - t0,
  };
}

// ================= 通用輔助函式 =================
// 依初始本金取某年的淨值分佈
export function valuesAtYear(sim, year){
  const { pathsFlat, finals } = sim;
  const iters = finals.length;
  if (pathsFlat){
    const years = pathsFlat.length / iters - 1;
    const col = new Array(iters);
    for (let it = 0; it < iters; it++) col[it] = pathsFlat[it * (years + 1) + year];
    return col;
  }
  if (year * 1 === Math.round(year) /* year == horizon */){
    return Array.from(finals);
  }
  throw new Error('valuesAtYear requires storeFullPaths=true for intermediate years');
}

// 依排序後 finals 計算 P(final >= threshold) — O(log n)
export function probAtLeast(sortedFinals, threshold){
  const n = sortedFinals.length;
  let lo = 0, hi = n;
  while (lo < hi){
    const mid = (lo + hi) >> 1;
    if (sortedFinals[mid] < threshold) lo = mid + 1;
    else hi = mid;
  }
  return 1 - lo / n;
}

// 格式化輔助：TWD 轉成「萬 / 億」顯示
export function fmtTWD(x){
  if (x === null || x === undefined) return 'N/A';
  if (!Number.isFinite(x)) return String(x);
  if (x >= 1e8) return (x/1e8).toFixed(2) + '億';
  if (x >= 1e4) return Math.round(x/1e4) + '萬';
  return Math.round(x).toLocaleString();
}

export function pct(x){ return (100*x).toFixed(1) + '%'; }
