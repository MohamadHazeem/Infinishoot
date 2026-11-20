// A classic script so the dashboard can open directly from disk as well as over HTTP.
(() => {
  const median = values => {
    if (!values.length) return null;
    const ordered = [...values].sort((a,b) => a-b), i = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[i] : (ordered[i-1] + ordered[i]) / 2;
  };
  function aggregate(runs) {
    const days = new Map(), stages = new Map(), difficulties = new Map(), deaths = new Map();
    const bosses = new Map(), heroes = new Map(), loadouts = new Map(), items = new Map(), frames = new Map();
    const bump = (map,id) => map.set(id,(map.get(id) ?? 0) + 1);
    const stat = (map,id,blank) => { if (!map.has(id)) map.set(id,blank); return map.get(id); };
    for (const r of runs) {
      const won = Number(r.outcome === 'victory' || r.clears > 0);
      bump(days,r.day); bump(stages,r.stage); bump(difficulties,r.difficulty);
      if (r.outcome === 'death') bump(stat(deaths,r.stage,new Map()),r.fatal?.[0] ?? 'unknown');
      for (const [map,id] of [[heroes,r.hero],[loadouts,r.loadout.join(' / ')]]) {
        const row = stat(map,id,{picked:0,wins:0}); row.picked++; row.wins += won;
      }
      const held = new Set();
      for (const [,values,pick] of r.offers) {
        const choices = r.offerIds ? values.map(i => r.offerIds[i]) : values;
        for (const id of new Set(choices)) stat(items,id,{offers:0,picks:0,runs:0,wins:0}).offers++;
        if (pick >= 0 && choices[pick]) { items.get(choices[pick]).picks++; held.add(choices[pick]); }
      }
      for (const id of held) { const row = items.get(id); row.runs++; row.wins += won; }
      for (const [,id,result,seconds] of r.bosses) {
        const row = stat(bosses,id,{kills:[],deaths:0,quits:0});
        if (result === 'kill') row.kills.push(seconds);
        else if (result === 'death') row.deaths++; else row.quits++;
      }
      const group = r.platform + (r.mobile ? ' / mobile' : ' / desktop');
      if (r.worstMs > 0) stat(frames,group,[]).push(r.worstMs);
    }
    const desc = (a,b) => b[1]-a[1], countRows = m => [...m].sort(desc);
    const buildRows = m => [...m].map(([id,v]) => [id,v.picked,v.picked/runs.length,v.wins/v.picked]).sort(desc);
    return { count:runs.length, median:median(runs.map(r => r.seconds)), days:[...days].sort(), stages:[...stages].sort((a,b)=>a[0]-b[0]),
      difficulties:countRows(difficulties), deaths:[...deaths].sort((a,b)=>a[0]-b[0]).flatMap(([stage,m])=>countRows(m).slice(0,10).map(([id,n])=>[stage,id,n])),
      heroes:buildRows(heroes), loadouts:buildRows(loadouts), items:[...items].map(([id,v])=>[id,v.offers,v.picks,v.picks/v.offers,v.runs ? v.wins/v.runs : null]).sort(desc),
      bosses:[...bosses].map(([id,v])=>[id,v.kills.length,v.deaths,v.quits,median(v.kills),v.kills.length+v.deaths ? v.deaths/(v.kills.length+v.deaths) : null]),
      frames:[...frames].map(([id,v])=>[id,v.length,median(v),v.reduce((a,b)=>Math.max(a,b),0)]).sort((a,b)=>b[3]-a[3]) };
  }
  globalThis.playtestStats = {aggregate,median};
})();
