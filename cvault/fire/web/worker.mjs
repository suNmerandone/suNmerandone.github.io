// web/worker.mjs — 在 Web Worker 中執行 Monte Carlo 模擬
// 由 app.mjs 用 new Worker('./worker.mjs', { type: 'module' }) 啟動。
// 使用跟 CLI 相同的 lib/core.mjs 模組，確保結果一致。

import {
  ASSETS, CORR_ORDER, CORR, PORT_A, PORT_B,
  simulate, percentile, probAtLeast,
} from '../lib/core.mjs';

const SEED_A = 42, SEED_B = 43;

self.onmessage = (ev) => {
  const { type, scenario, params } = ev.data;
  if (type !== 'run') return;

  try {
    const which = params.portfolio || 'both';
    const portfolios = which === 'both' ? ['A', 'B']
                     : which === 'A'    ? ['A']
                     : ['B'];

    const results = {};
    let finishedCount = 0;
    const totalRuns = portfolios.length;

    for (const key of portfolios){
      const portfolio = key === 'A' ? PORT_A : PORT_B;
      const seed = key === 'A' ? SEED_A : SEED_B;

      const onProgress = (pct) => {
        const overall = (finishedCount + pct) / totalRuns;
        self.postMessage({ type: 'progress', pct: overall, portfolio: key });
      };

      const sim = runScenario(scenario, portfolio, seed, params, onProgress);
      const analyzed = analyzeScenario(scenario, sim, params);
      results[key] = analyzed;
      finishedCount++;
    }

    self.postMessage({ type: 'done', scenario, params, results });
  } catch (err){
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};

// ========== 依情境 dispatch simulate ==========
function runScenario(scenario, portfolio, seed, params, onProgress){
  const iters = params.iters || 10000;

  if (scenario === 'coast'){
    // 情境 1: per-unit 模擬，事後 scale
    return simulate(portfolio, {
      initial: 1.0,
      years: params.years || 25,
      iters, seed,
      target: Infinity,
      storeFullPaths: true,
      onProgress,
    });
  }

  if (scenario === 'fixed'){
    return simulate(portfolio, {
      initial: params.initial,
      years: params.maxYears || 70,
      iters, seed,
      target: params.target,
      storeFullPaths: true,
      onProgress,
    });
  }

  if (scenario === 'dca'){
    return simulate(portfolio, {
      initial: params.initial,
      annual: params.annual,
      contribYears: params.contribYears,
      years: params.maxYears || 70,
      iters, seed,
      target: params.target,
      storeFullPaths: true,
      onProgress,
    });
  }

  throw new Error('Unknown scenario: ' + scenario);
}

// ========== 依情境 analyze ==========
function analyzeScenario(scenario, sim, params){
  const { finalsSorted, mddsSorted, yearReached, pathsFlat, p5Path, p50Path, p95Path } = sim;
  const iters = sim.finals.length;

  const p5  = percentile(finalsSorted, 5);
  const p50 = percentile(finalsSorted, 50);
  const p95 = percentile(finalsSorted, 95);
  const medMDD = percentile(mddsSorted, 50);
  const p95MDD = percentile(mddsSorted, 95);

  if (scenario === 'coast'){
    const target = params.target || 10_000_000;
    const conf   = (params.confidence || 70) / 100;
    // 找 70% 信心對應的 percentile （= 100 - 70*100 = 30th percentile of per-unit final）
    const pAtConf = percentile(finalsSorted, (1 - conf) * 100);
    const requiredInitial = target / pAtConf;

    const refInitials = [1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000];
    const probCurve = {
      x: refInitials,
      y: refInitials.map(k => probAtLeast(finalsSorted, target / k)),
    };

    return {
      name: sim.name,
      kpis: [
        { label: `達 ${conf*100}% 信心所需本金`, value: requiredInitial, fmt: 'twd' },
        { label: '中位倍數 (每 1 TWD)', value: p50, fmt: 'x' },
        { label: '5 pct (最差)', value: p5, fmt: 'x' },
        { label: '95 pct (最佳)', value: p95, fmt: 'x' },
        { label: 'MDD 中位', value: medMDD, fmt: 'pct' },
        { label: 'MDD 95 pct (尾端)', value: p95MDD, fmt: 'pct' },
      ],
      trajectory: {
        years: Array.from({length: (params.years||25) + 1}, (_, i) => i),
        p5: p5Path, p50: p50Path, p95: p95Path,
        scale: requiredInitial, // 畫圖時乘上這個
      },
      probCurve,
      rawSummary: {
        scenario: 'coast',
        name: sim.name,
        required_initial: requiredInitial,
        median_multiple: p50,
        p5_multiple: p5,
        p95_multiple: p95,
        mdd_median: medMDD,
        mdd_p95: p95MDD,
        prob_by_initial: Object.fromEntries(refInitials.map((k, i) => [k, probCurve.y[i]])),
      },
    };
  }

  if (scenario === 'fixed' || scenario === 'dca'){
    const target = params.target || 10_000_000;
    const refYear = params.refYear || 25;
    const maxYears = params.maxYears || 70;

    // 第 refYear 年淨值分佈
    const vRefArr = new Array(iters);
    for (let it = 0; it < iters; it++) vRefArr[it] = pathsFlat[it * (maxYears + 1) + refYear];
    const vRefSorted = vRefArr.slice().sort((a,b) => a-b);
    const vRef5  = percentile(vRefSorted, 5);
    const vRef50 = percentile(vRefSorted, 50);
    const vRef95 = percentile(vRefSorted, 95);
    let atRef = 0;
    for (const v of vRefArr) if (v >= target) atRef++;
    const probTargetAtRef = atRef / iters;

    // 達標年數分佈
    const reached = [];
    for (const y of yearReached) if (y >= 0) reached.push(y);
    reached.sort((a,b) => a-b);
    const probReachEver = reached.length / iters;
    const medYears = reached.length ? percentile(reached, 50) : null;

    // Prob-by-year CDF
    const probByYearX = [];
    const probByYearY = [];
    for (let y = 0; y <= maxYears; y++){
      probByYearX.push(y);
      let cnt = 0;
      for (const yr of yearReached) if (yr >= 0 && yr <= y) cnt++;
      probByYearY.push(cnt / iters);
    }

    const kpis = [
      { label: `第 ${refYear} 年中位淨值`, value: vRef50, fmt: 'twd' },
      { label: `第 ${refYear} 年 5 pct`, value: vRef5, fmt: 'twd' },
      { label: `第 ${refYear} 年 95 pct`, value: vRef95, fmt: 'twd' },
      { label: `第 ${refYear} 年達標機率`, value: probTargetAtRef, fmt: 'pct' },
      { label: `${maxYears} 年內達標機率`, value: probReachEver, fmt: 'pct' },
      { label: '達標者中位用時', value: medYears, fmt: 'years' },
      { label: 'MDD 中位', value: medMDD, fmt: 'pct' },
      { label: 'MDD 95 pct (尾端)', value: p95MDD, fmt: 'pct' },
    ];

    return {
      name: sim.name,
      kpis,
      trajectory: {
        years: Array.from({length: maxYears + 1}, (_, i) => i),
        p5: p5Path, p50: p50Path, p95: p95Path,
        scale: 1, // 已是實際金額
        target,
      },
      probCurve: {
        x: probByYearX,
        y: probByYearY,
      },
      rawSummary: {
        scenario,
        name: sim.name,
        initial: params.initial,
        annual: params.annual || 0,
        contrib_years: params.contribYears || 0,
        target,
        ref_year: refYear,
        max_years: maxYears,
        v_ref_5: vRef5,
        v_ref_50: vRef50,
        v_ref_95: vRef95,
        prob_target_at_ref: probTargetAtRef,
        prob_reach_ever: probReachEver,
        median_years_to_target: medYears,
        mdd_median: medMDD,
        mdd_p95: p95MDD,
      },
    };
  }

  throw new Error('Unknown scenario: ' + scenario);
}
