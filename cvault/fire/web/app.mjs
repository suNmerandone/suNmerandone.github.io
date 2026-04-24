// web/app.mjs — 主 UI 邏輯
// 負責：tab 切換、表單讀寫、Worker 通訊、結果渲染、下載/複製。

import { drawTrajectory, drawProbCurve, drawLineChart, fmtTwdShort } from './charts.mjs';

// ========== 啟動時檢查 uPlot 已載入 ==========
if (typeof window.uPlot === 'undefined'){
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="background:#fef2f2;color:#991b1b;padding:14px;text-align:center;font-size:13px;">' +
    '⚠️ 偵測不到 uPlot：請確認 <code>web/vendor/uPlot.iife.min.js</code> 存在。' +
    '詳見 <a href="./README.md">web/README.md</a>。' +
    '</div>'
  );
}

// ========== Tab 切換 ==========
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.scenario;
    document.querySelectorAll('.scenario').forEach(s =>
      s.classList.toggle('active', s.id === target));
  });
});

// ========== Worker ==========
let worker = null;
function ensureWorker(){
  if (!worker){
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (err) => setStatus(currentScenario, 'Worker 錯誤：' + err.message, 'error');
  }
  return worker;
}

// ========== 執行模擬 ==========
let currentScenario = 'basic';
const lastResults = {}; // per-scenario 最後結果（供 Download / Copy CLI）

document.querySelectorAll('button.run').forEach(btn => {
  btn.addEventListener('click', () => {
    const scenario = btn.dataset.scenario;
    currentScenario = scenario;
    const params = readForm(scenario);
    persist(scenario, params);

    setStatus(scenario, '執行中…', '');
    showProgress(scenario, 0);
    btn.disabled = true;
    setButton(scenario, 'download', false);
    setButton(scenario, 'copy-cli', false);

    // 基本 Coast FIRE 為確定性計算，主執行緒直接算即可（無波動、無迭代）
    if (scenario === 'basic'){
      try {
        const results = runBasic(params);
        lastResults[scenario] = { params, results, timestamp: new Date().toISOString() };
        renderResults(scenario, params, results);
        setStatus(scenario, '計算完成（確定性公式，無波動假設）', 'ok');
        hideProgress(scenario);
        setButton(scenario, 'run', true);
        setButton(scenario, 'download', true);
      } catch (err){
        setStatus(scenario, '錯誤：' + err.message, 'error');
        hideProgress(scenario);
        setButton(scenario, 'run', true);
      }
      return;
    }

    // MC 情境：丟給 Worker
    ensureWorker().postMessage({ type: 'run', scenario, params });
  });
});

// ========== 基本 Coast FIRE 計算（確定性）==========
function runBasic(params){
  const target     = +params.target;
  const years      = +params.years;
  const rateNom    = +params.rate / 100;      // 名目
  const inflation  = +params.inflation / 100;
  const initial    = +params.initial || 0;
  const annual     = +params.annual  || 0;

  // 實質報酬（若有通膨）
  const r = inflation > 0
    ? (1 + rateNom) / (1 + inflation) - 1
    : rateNom;

  // 終值（複利 + 年金）
  const trajectory = [];
  for (let y = 0; y <= years; y++){
    const cInitial = initial * Math.pow(1 + r, y);
    const cAnnuity = Math.abs(r) < 1e-9
      ? annual * y
      : annual * (Math.pow(1 + r, y) - 1) / r;
    trajectory.push(cInitial + cAnnuity);
  }
  const finalValue = trajectory[years];

  // Coast FIRE Number: 「若今天投入這筆、之後完全不加碼」需要多少
  const coastFireNumber = Math.pow(1 + r, years) > 0
    ? target / Math.pow(1 + r, years)
    : Infinity;

  // 差距與進度
  const gap = Math.max(0, coastFireNumber - initial);
  const progress = initial > 0 && coastFireNumber > 0
    ? initial / coastFireNumber
    : 0;
  const reached = finalValue >= target;

  // 解：到達目標所需的年數
  let yearsToTarget = null;
  for (let y = 0; y <= 200; y++){
    const cI = initial * Math.pow(1 + r, y);
    const cC = Math.abs(r) < 1e-9 ? annual * y : annual * (Math.pow(1 + r, y) - 1) / r;
    if (cI + cC >= target){ yearsToTarget = y; break; }
  }

  // 不同報酬率下的 Coast FIRE Number（敏感度）
  const sensitivity = { rates: [], numbers: [] };
  for (const ratePct of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]){
    const rr = inflation > 0 ? (1 + ratePct/100) / (1 + inflation) - 1 : ratePct / 100;
    sensitivity.rates.push(ratePct);
    sensitivity.numbers.push(target / Math.pow(1 + rr, years));
  }

  return {
    theory: {
      name: '確定性計算',
      kpis: [
        { label: `今日所需本金 (Coast FIRE Number)`, value: coastFireNumber, fmt: 'twd' },
        { label: `${years} 年後預測終值`, value: finalValue, fmt: 'twd' },
        { label: '是否達標', value: reached, fmt: 'bool' },
        { label: '目前進度', value: progress, fmt: 'pct' },
        { label: '達標所需年數', value: yearsToTarget, fmt: 'years' },
        { label: '實際採用報酬率', value: r, fmt: 'pct' },
        { label: '尚缺本金', value: gap, fmt: 'twd' },
      ],
      trajectory: {
        years: Array.from({length: years + 1}, (_, i) => i),
        values: trajectory,
        target,
      },
      sensitivity,
      rawSummary: {
        scenario: 'basic',
        params,
        effective_rate: r,
        coast_fire_number: coastFireNumber,
        final_value: finalValue,
        reached,
        progress,
        gap,
        years_to_target: yearsToTarget,
      },
    }
  };
}

function handleWorkerMessage(ev){
  const { type } = ev.data;
  if (type === 'progress'){
    showProgress(currentScenario, ev.data.pct);
  } else if (type === 'done'){
    const { scenario, params, results } = ev.data;
    lastResults[scenario] = { params, results, timestamp: new Date().toISOString() };
    renderResults(scenario, params, results);
    setStatus(scenario, `完成（${Object.keys(results).length} 組）`, 'ok');
    hideProgress(scenario);
    setButton(scenario, 'run', true);
    setButton(scenario, 'download', true);
    setButton(scenario, 'copy-cli', true);
  } else if (type === 'error'){
    setStatus(currentScenario, '錯誤：' + ev.data.message, 'error');
    hideProgress(currentScenario);
    setButton(currentScenario, 'run', true);
  }
}

// ========== 讀 / 寫表單 ==========
function readForm(scenario){
  const section = document.getElementById(scenario);
  const params = {};
  section.querySelectorAll('[data-field]').forEach(el => {
    const field = el.dataset.field;
    const val = el.value;
    if (el.type === 'number' || /^-?\d+(\.\d+)?$/.test(val)){
      // 用 Number() 保留小數（rate / inflation 可能是 7.5、2.5 等）
      params[field] = Number(val);
    } else {
      params[field] = val;
    }
  });
  return params;
}

function persist(scenario, params){
  try { localStorage.setItem('cfmc.' + scenario, JSON.stringify(params)); } catch {}
}

function restore(scenario){
  try {
    const raw = localStorage.getItem('cfmc.' + scenario);
    if (!raw) return;
    const params = JSON.parse(raw);
    const section = document.getElementById(scenario);
    for (const [k, v] of Object.entries(params)){
      const el = section.querySelector(`[data-field="${k}"]`);
      if (el) el.value = v;
    }
  } catch {}
}
['basic', 'coast', 'fixed', 'dca'].forEach(restore);

// ========== 渲染結果 ==========
function renderResults(scenario, params, results){
  const section = document.getElementById(scenario);
  renderKPIs(section, results);
  renderCharts(section, scenario, params, results);
  renderSummaryText(section, scenario, params, results);
}

function renderKPIs(section, results){
  const wrap = section.querySelector('.kpis');
  const cards = [];
  const keys = Object.keys(results);
  const showSuffix = keys.length > 1 && (keys.includes('A') || keys.includes('B'));
  for (const [key, r] of Object.entries(results)){
    const cls = (key === 'A' || key === 'B') ? `port-${key.toLowerCase()}` : 'port-single';
    const suffix = showSuffix ? ` <span style="opacity:0.6">· ${key}</span>` : '';
    for (const kpi of r.kpis){
      cards.push(`
        <div class="kpi ${cls}">
          <div class="label">${escapeHtml(kpi.label)}${suffix}</div>
          <div class="value">${fmtKpi(kpi.value, kpi.fmt)}</div>
        </div>
      `);
    }
  }
  wrap.innerHTML = cards.join('');
}

function fmtKpi(value, fmt){
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? '✓ 達標' : '✗ 未達標';
  if (!Number.isFinite(value)) return String(value);
  switch (fmt){
    case 'twd':   return fmtTwdShort(value);
    case 'pct':   return (value * 100).toFixed(1) + '%';
    case 'x':     return value.toFixed(2) + 'x';
    case 'years': return value.toFixed(0) + ' 年';
    case 'bool':  return value ? '✓ 達標' : '✗ 未達標';
    default:      return String(value);
  }
}

function renderCharts(section, scenario, params, results){
  const trajEl = section.querySelector('[data-chart="trajectory"]');
  const probEl = section.querySelector('[data-chart="prob"]');

  // === 基本 Coast FIRE（單線確定性）===
  if (scenario === 'basic'){
    const t = results.theory.trajectory;
    drawLineChart(trajEl, {
      years: t.years,
      lines: [{ label: '淨值', values: t.values, color: '#007aff', width: 2 }],
      target: t.target,
      logScale: false,
      yLabel: '淨值 (TWD)',
    });
    // 敏感度：不同報酬率下的今日所需本金
    const s = results.theory.sensitivity;
    drawLineChart(probEl, {
      years: s.rates, // x 軸改為報酬率 %
      lines: [{ label: '今日所需本金', values: s.numbers, color: '#ff9500', width: 2 }],
      logScale: false,
      yLabel: 'Coast FIRE Number',
    });
    return;
  }

  // === MC 情境 ===
  const first = Object.values(results)[0];
  const trajData = { years: first.trajectory.years };
  if (results.A) trajData.A = results.A.trajectory;
  if (results.B) trajData.B = results.B.trajectory;
  if (results.A?.trajectory.target) trajData.target = results.A.trajectory.target;
  drawTrajectory(trajEl, trajData);

  const probData = {
    xLabel: scenario === 'coast' ? '初始本金 (TWD)' : '年數',
    xFmt:   scenario === 'coast' ? 'twd'            : 'year',
  };
  if (results.A) probData.A = results.A.probCurve;
  if (results.B) probData.B = results.B.probCurve;
  drawProbCurve(probEl, probData);
}

function renderSummaryText(section, scenario, params, results){
  const el = section.querySelector('.summary-text');
  const lines = [];
  lines.push(`Scenario: ${scenario}`);
  lines.push(`Params:   ${JSON.stringify(params)}`);
  lines.push('');
  for (const [key, r] of Object.entries(results)){
    lines.push(`=== ${r.name} ===`);
    for (const kpi of r.kpis){
      lines.push(`  ${kpi.label.padEnd(28)}: ${fmtKpi(kpi.value, kpi.fmt)}`);
    }
    lines.push('');
  }
  el.textContent = lines.join('\n');
}

// ========== 狀態 / 進度 ==========
function setStatus(scenario, text, cls){
  const el = document.querySelector(`#${scenario} .status`);
  if (!el) return;
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}
function showProgress(scenario, pct){
  const wrap = document.querySelector(`#${scenario} .progress-wrap`);
  const bar  = document.querySelector(`#${scenario} .progress-bar`);
  if (wrap) wrap.classList.add('active');
  if (bar)  bar.style.width = (pct * 100).toFixed(1) + '%';
}
function hideProgress(scenario){
  const wrap = document.querySelector(`#${scenario} .progress-wrap`);
  if (wrap) wrap.classList.remove('active');
}
function setButton(scenario, cls, enabled){
  const btn = document.querySelector(`#${scenario} button.${cls}`);
  if (btn) btn.disabled = !enabled;
}

// ========== 下載 / Copy CLI ==========
document.querySelectorAll('button.download').forEach(btn => {
  btn.addEventListener('click', () => {
    const scenario = btn.dataset.scenario;
    const data = lastResults[scenario];
    if (!data) return;

    const stamp = data.timestamp.replace(/[:.]/g, '-').slice(0, 16);
    const slug = scenario + '_' + Object.values(data.params).filter(v => typeof v === 'number' || typeof v === 'string').join('_');

    // params.json
    downloadText(`${stamp}_${slug}.params.json`, JSON.stringify({
      scenario,
      source: 'web',
      params: data.params,
      timestamp: data.timestamp,
    }, null, 2), 'application/json');

    // summary.json
    const summary = {};
    for (const [key, r] of Object.entries(data.results)) summary[key] = r.rawSummary;
    downloadText(`${stamp}_${slug}.summary.json`, JSON.stringify(summary, null, 2), 'application/json');

    // output.txt (from .summary-text)
    const text = document.querySelector(`#${scenario} .summary-text`).textContent;
    downloadText(`${stamp}_${slug}.output.txt`, text, 'text/plain');
  });
});

function downloadText(filename, text, mime){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

document.querySelectorAll('button.copy-cli').forEach(btn => {
  btn.addEventListener('click', async () => {
    const scenario = btn.dataset.scenario;
    const data = lastResults[scenario];
    if (!data) return;
    const cmd = buildCliCommand(scenario, data.params);
    try {
      await navigator.clipboard.writeText(cmd);
      setStatus(scenario, `已複製 CLI 命令：${cmd}`, 'ok');
    } catch {
      setStatus(scenario, 'Clipboard 失敗，請手動複製：' + cmd, 'error');
    }
  });
});

function buildCliCommand(scenario, params){
  // 對應 tools/archive.js 的三個情境
  if (scenario === 'coast'){
    return `node tools/archive.js coast --note="from web UI"`;
  }
  if (scenario === 'fixed'){
    return `node tools/archive.js fixed ${params.initial} --note="from web UI"`;
  }
  if (scenario === 'dca'){
    return `node tools/archive.js dca ${params.initial} ${params.annual} ${params.contribYears} --note="from web UI"`;
  }
  return '';
}

// ========== helpers ==========
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
