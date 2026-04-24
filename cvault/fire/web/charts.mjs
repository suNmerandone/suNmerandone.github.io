// web/charts.mjs — uPlot 封裝：分位帶 + CDF 曲線
// uPlot 由 index.html 以 <script> 預先載入，此處以全域 window.uPlot 存取。

const COLOR_A = '#3b82f6';
const COLOR_A_FILL = 'rgba(59,130,246,0.12)';
const COLOR_B = '#f59e0b';
const COLOR_B_FILL = 'rgba(245,158,11,0.12)';
const COLOR_TARGET = '#ef4444';

// 儲存 uPlot 實例 + 對應 ResizeObserver，重跑時銷毀舊的避免記憶體洩漏
const charts = new WeakMap();

function destroyIn(container){
  const existing = charts.get(container);
  if (existing){
    try { existing.observer?.disconnect(); } catch {}
    try { existing.u.destroy(); } catch {}
    charts.delete(container);
  }
  container.innerHTML = '';
}

// 註冊一個 uPlot 實例 + ResizeObserver，讓 canvas 寬度跟隨 container
// （uPlot 是 canvas，不會自動 responsive，必須手動 setSize）
function register(container, u, height){
  const observer = new ResizeObserver(entries => {
    for (const e of entries){
      const w = Math.max(1, Math.floor(e.contentRect.width));
      // uPlot 在 width 變動時才需重設（避免無謂重繪）
      if (u.width !== w) u.setSize({ width: w, height });
    }
  });
  observer.observe(container);
  charts.set(container, { u, observer });
}

// 取得目前 container 的可用寬度（無 min 下限，手機上才能自然縮）
function containerWidth(container){
  const w = container.getBoundingClientRect().width;
  return Math.max(1, Math.floor(w || 500));
}

// 共用：hover 時的數值格式化（把長數字縮成 萬/億），null/undefined 時顯示 —
const twdVal = (u, v) => (v == null ? '—' : fmtTwdShort(v));
const yearVal = (u, v) => (v == null ? '—' : v.toFixed(0) + 'y');

// ========== 軌跡分位帶（支援 A/B 疊加）==========
// data: { years[], A?: {p5,p50,p95,scale}, B?: {p5,p50,p95,scale}, target? }
export function drawTrajectory(container, data){
  destroyIn(container);
  const width = containerWidth(container);
  const height = 340;  // 留出 legend 空間避免溢出

  const { years } = data;
  const seriesData = [years];
  const series = [{ value: yearVal }];
  const bands = [];

  if (data.A){
    const scale = data.A.scale || 1;
    seriesData.push(data.A.p5.map(v => v * scale));
    series.push({ label: 'A p5', stroke: 'transparent', width: 0, points: { show: false }, value: twdVal });
    seriesData.push(data.A.p50.map(v => v * scale));
    series.push({ label: 'A 中位', stroke: COLOR_A, width: 2, points: { show: false }, value: twdVal });
    seriesData.push(data.A.p95.map(v => v * scale));
    series.push({ label: 'A p95', stroke: 'transparent', width: 0, points: { show: false }, value: twdVal });
    // Band: top=95, bottom=5 (in 1-based series index; x is idx 0)
    const base = seriesData.length - 3; // index of A p5
    bands.push({ series: [base + 2, base], fill: COLOR_A_FILL });
  }

  if (data.B){
    const scale = data.B.scale || 1;
    seriesData.push(data.B.p5.map(v => v * scale));
    series.push({ label: 'B p5', stroke: 'transparent', width: 0, points: { show: false }, value: twdVal });
    seriesData.push(data.B.p50.map(v => v * scale));
    series.push({ label: 'B 中位', stroke: COLOR_B, width: 2, points: { show: false }, value: twdVal });
    seriesData.push(data.B.p95.map(v => v * scale));
    series.push({ label: 'B p95', stroke: 'transparent', width: 0, points: { show: false }, value: twdVal });
    const base = seriesData.length - 3;
    bands.push({ series: [base + 2, base], fill: COLOR_B_FILL });
  }

  const opts = {
    width, height,
    scales: {
      x: { time: false },
      y: { distr: 3 /* log */, log: 10 },
    },
    axes: [
      { label: '年', values: (u, vals) => vals.map(v => v.toFixed(0)) },
      {
        label: '淨值 (TWD)',
        size: 80,
        values: (u, vals) => vals.map(fmtTwdShort),
      }
    ],
    series,
    bands,
    legend: { show: true },
    cursor: { sync: { key: 'trajectory' }, drag: { setScale: false } },
  };

  // Add target line as a horizontal series if provided
  if (data.target){
    seriesData.push(years.map(() => data.target));
    series.push({
      label: `目標 ${fmtTwdShort(data.target)}`,
      stroke: COLOR_TARGET,
      width: 1,
      dash: [6, 4],
      points: { show: false },
      value: twdVal,
    });
  }

  const u = new window.uPlot(opts, seriesData, container);
  register(container, u, height);
}

// ========== 通用多線圖（確定性情境用）==========
// data: {
//   years[],
//   lines: [{ label, values, color, width?, dash? }],
//   target?: 數值（畫水平虛線）,
//   logScale?: boolean（預設 false）,
//   yLabel?: string,
// }
export function drawLineChart(container, data){
  destroyIn(container);
  const width = containerWidth(container);
  const height = 340;

  const seriesData = [data.years];
  const series = [{ value: yearVal }];

  for (const ln of data.lines){
    seriesData.push(ln.values);
    series.push({
      label: ln.label,
      stroke: ln.color || COLOR_A,
      width: ln.width || 2,
      dash: ln.dash || undefined,
      points: { show: false },
      value: twdVal,
    });
  }

  if (data.target){
    seriesData.push(data.years.map(() => data.target));
    series.push({
      label: `目標 ${fmtTwdShort(data.target)}`,
      stroke: COLOR_TARGET,
      width: 1,
      dash: [6, 4],
      points: { show: false },
      value: twdVal,
    });
  }

  const opts = {
    width, height,
    scales: {
      x: { time: false },
      y: data.logScale ? { distr: 3, log: 10 } : { auto: true },
    },
    axes: [
      { label: '年', values: (u, vals) => vals.map(v => v.toFixed(0)) },
      {
        label: data.yLabel || '淨值 (TWD)',
        size: 80,
        values: (u, vals) => vals.map(fmtTwdShort),
      }
    ],
    series,
    legend: { show: true },
  };

  const u = new window.uPlot(opts, seriesData, container);
  register(container, u, height);
}

// ========== 機率曲線（CDF / probAt）==========
// data: { xLabel, A?: {x[], y[]}, B?: {x[], y[]}, xFmt?: 'twd' | 'year' }
export function drawProbCurve(container, data){
  destroyIn(container);
  const width = containerWidth(container);
  const height = 340;  // 與軌跡圖對齊高度

  // 合併 x (假設 A/B 的 x 相同，否則取 A 為主)
  const x = (data.A || data.B).x;
  const seriesData = [x];
  const xIsTwd = data.xFmt === 'twd';
  const probVal = (u, v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  const xLabelVal = xIsTwd ? twdVal : yearVal;
  const series = [{ value: xLabelVal }];

  if (data.A){
    seriesData.push(data.A.y);
    series.push({
      label: 'Portfolio A',
      stroke: COLOR_A,
      width: 2,
      points: { show: true, size: 4, fill: COLOR_A },
      value: probVal,
    });
  }
  if (data.B){
    seriesData.push(data.B.y);
    series.push({
      label: 'Portfolio B',
      stroke: COLOR_B,
      width: 2,
      points: { show: true, size: 4, fill: COLOR_B },
      value: probVal,
    });
  }

  const xValFmt = data.xFmt === 'twd'
    ? (u, vals) => vals.map(fmtTwdShort)
    : (u, vals) => vals.map(v => v.toFixed(0) + 'y');

  const opts = {
    width, height,
    scales: {
      x: { time: false },
      y: { range: [0, 1] },
    },
    axes: [
      { label: data.xLabel || '', values: xValFmt },
      { label: '累積機率', values: (u, vals) => vals.map(v => (v*100).toFixed(0) + '%') }
    ],
    series,
    legend: { show: true },
  };

  const u = new window.uPlot(opts, seriesData, container);
  register(container, u, height);
}

// 輔助格式化
export function fmtTwdShort(x){
  if (x === null || x === undefined) return '';
  const n = +x;
  if (!Number.isFinite(n)) return '';
  if (n >= 1e8) return (n/1e8).toFixed(2) + '億';
  if (n >= 1e4) return (n/1e4).toFixed(0) + '萬';
  if (n < 100) return n.toFixed(2) + 'x'; // 倍數
  return Math.round(n).toLocaleString();
}

