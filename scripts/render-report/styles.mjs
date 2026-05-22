// styles.mjs — single source of truth for the new report CSS.
// Returns the full <style>…</style> block as a string.

export function reportStyles() {
  return `<style>
:root{
  --paper:#f5f3ec;
  --paper-2:#ebe8de;
  --panel:#ffffff;
  --ink:#0e1410;
  --ink-2:#1c241f;
  --muted:#6a7068;
  --muted-2:#8a8f87;
  --rule:#0e1410;
  --rule-soft:#cdcfc6;
  --accent:#0f5e3e;
  --accent-2:#7a3a12;
  --up:#0d8a5a;
  --down:#c43d2e;
  --amber:#a86a18;
  --flat:#606b66;
  --grid:#e3e1d6;
  --hi:#fff7d6;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--paper);
  color:var(--ink);
  font-family:"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif;
  font-size:15px;line-height:1.7;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
a{color:inherit;text-decoration:none}
.mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.serif{font-family:"Source Serif 4","Noto Serif KR",Georgia,serif}

.shell{max-width:1360px;margin:0 auto;padding:0 28px}

/* tape */
.tape{border-bottom:1px solid var(--rule);background:var(--ink);color:var(--paper);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase}
.tape .row{max-width:1360px;margin:0 auto;padding:8px 28px;display:flex;gap:28px;align-items:center;justify-content:space-between}
.tape .ticks{display:flex;gap:24px;overflow:hidden;white-space:nowrap}
.tape .tick{display:inline-flex;gap:8px;align-items:baseline}
.tape .tick b{font-weight:700;color:var(--paper)}
.tape .tick .v{color:#cfd5cb}
.tape .tick .up{color:#7be0a8}
.tape .tick .down{color:#ff8478}
.tape .right{display:flex;gap:18px;align-items:center;color:#aab2a8}
.tape .live{display:inline-flex;align-items:center;gap:6px;color:#ff8478}
.tape .live::before{content:"";width:6px;height:6px;background:#ff5d4a;border-radius:50%;display:inline-block;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

/* masthead */
.masthead{padding:36px 0 24px;border-bottom:2px solid var(--rule)}
.masthead .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:1px solid var(--rule-soft);margin-bottom:22px}
.masthead .brand{display:flex;align-items:baseline;gap:14px}
.masthead .brand .logo{width:34px;height:34px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-family:"JetBrains Mono",monospace;font-weight:700;font-size:13px;letter-spacing:-.02em;transform:translateY(4px)}
.masthead .brand h1.wordmark{font-family:"Source Serif 4",serif;font-weight:900;font-size:22px;letter-spacing:-.01em;margin:0}
.masthead .brand .sub{color:var(--muted);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-left:6px}
.masthead .meta{display:flex;gap:22px;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.masthead .meta b{color:var(--ink);font-weight:700}
.kicker{display:inline-flex;gap:12px;align-items:center;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:18px}
.kicker .dot{width:6px;height:6px;background:var(--accent);border-radius:50%;display:inline-block}
.kicker .sep{color:var(--rule-soft)}
.hero-grid{display:grid;grid-template-columns:1fr 420px;gap:48px;align-items:end}
h1.hero{font-family:"Source Serif 4",serif;font-weight:800;font-size:clamp(2.6rem,5.4vw,4.8rem);line-height:1;letter-spacing:-.025em;margin:0 0 18px;word-break:keep-all;text-wrap:balance}
h1.hero em{font-style:normal;color:var(--accent)}
.deck{font-size:1.1rem;line-height:1.65;color:var(--ink-2);max-width:780px;border-left:3px solid var(--accent);padding:4px 0 4px 18px;margin:18px 0 0}
.hero-side{border:1px solid var(--rule);background:var(--panel);padding:20px 22px;font-family:"JetBrains Mono",monospace;font-size:12px}
.hero-side h4{margin:0 0 14px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:700;display:flex;justify-content:space-between}
.hero-side h4 span:last-child{color:var(--accent)}
.hero-side .row{display:flex;justify-content:space-between;padding:6px 0;border-top:1px dotted var(--rule-soft);align-items:baseline}
.hero-side .row:first-of-type{border-top:none}
.hero-side .row .lbl{color:var(--muted)}
.hero-side .row .val{font-weight:600;color:var(--ink)}
.hero-side .row .chg{font-size:11px;margin-left:8px}
.hero-side .note{margin-top:14px;padding-top:12px;border-top:1px dotted var(--rule-soft);font-family:"Noto Sans KR";font-size:11px;color:var(--muted);line-height:1.55;letter-spacing:0;text-transform:none}
.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--flat)}

/* sections */
.section{padding:56px 0;border-bottom:1px solid var(--rule-soft)}
.section:last-of-type{border-bottom:none}
.section-head{display:grid;grid-template-columns:120px 1fr;gap:32px;align-items:start;margin-bottom:32px;padding-bottom:14px;border-bottom:1px solid var(--rule)}
.section-head .num{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.18em;color:var(--accent);font-weight:700;padding-top:8px}
.section-head .num .bar{display:block;width:48px;height:2px;background:var(--accent);margin-bottom:10px}
.section-head h2{margin:0;font-family:"Source Serif 4",serif;font-weight:800;font-size:clamp(1.6rem,2.4vw,2.1rem);line-height:1.15;letter-spacing:-.015em}
.section-head .lede{color:var(--muted);font-size:.96rem;margin:8px 0 0;max-width:760px}

/* ─── multi-period strip used in matrix cells ─── */
.periods{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:12px;padding-top:10px;border-top:1px dashed var(--rule-soft);font-family:"JetBrains Mono",monospace}
.periods .p{display:flex;flex-direction:column;gap:2px;padding:0 6px;border-left:1px solid var(--rule-soft)}
.periods .p:first-child{padding-left:0;border-left:none}
.periods .p .key{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:700}
.periods .p .v{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}

/* INDEX MATRIX */
.matrix{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--rule);background:var(--panel)}
.matrix .cell{padding:22px 22px 18px;border-right:1px solid var(--rule-soft);position:relative}
.matrix .cell:last-child{border-right:none}
.matrix .cell .lbl{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:700;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.matrix .cell .ticker{color:var(--ink);font-weight:600}
.matrix .cell .val{font-family:"Source Serif 4",serif;font-weight:700;font-size:2.4rem;line-height:1.05;letter-spacing:-.015em;font-variant-numeric:tabular-nums}
.matrix .cell .val .frac{font-size:1.4rem;color:var(--muted)}
.matrix .cell .chg{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:baseline;margin-top:4px}
.matrix .cell .spark{margin-top:14px;height:42px}
.matrix .cell .foot{display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--muted);letter-spacing:.06em;margin-top:10px;padding-top:10px;border-top:1px dashed var(--rule-soft)}
.matrix .cell .arrow{position:absolute;top:22px;right:22px;font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700}

.lede3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px;padding:0;list-style:none;counter-reset:l3}
.lede3 li{background:var(--panel);border:1px solid var(--rule-soft);border-top:3px solid var(--ink);padding:18px 20px;font-size:1rem;line-height:1.7;counter-increment:l3}
.lede3 li::before{content:"0" counter(l3);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.2em;color:var(--accent);font-weight:700;display:block;margin-bottom:8px}

/* verdicts */
.verdicts{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:24px}
.verdict{background:var(--panel);border:1px solid var(--rule-soft);padding:18px;border-top:3px solid var(--accent)}
.verdict.warn{border-top-color:var(--amber)}
.verdict.bear{border-top-color:var(--down)}
.verdict h4{margin:0 0 6px;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;font-family:"JetBrains Mono",monospace;color:var(--muted)}
.verdict .v{font-family:"Source Serif 4",serif;font-size:1.2rem;font-weight:700;margin:0 0 10px}
.verdict p{margin:0;color:var(--ink-2);font-size:.92rem;line-height:1.65}
.verdict .ev{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);margin-top:10px;padding-top:10px;border-top:1px dotted var(--rule-soft)}

/* data + curve */
.data-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:32px}
.data-table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-family:"JetBrains Mono",monospace;font-size:13px}
.data-table caption{caption-side:top;text-align:left;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:700;padding:0 0 8px}
.data-table th,.data-table td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--rule-soft)}
.data-table th{background:var(--paper-2);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink);font-weight:700;border-bottom:1px solid var(--rule)}
.data-table tbody tr:last-child td{border-bottom:none}
.data-table tbody tr:hover{background:var(--hi)}
.data-table .num{text-align:right;font-variant-numeric:tabular-nums}
.data-table .lbl-ko{font-family:"Noto Sans KR";font-weight:500;color:var(--ink)}
.data-table .obs{color:var(--muted);font-size:11px}

.chip{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;padding:2px 6px;border:1px solid var(--rule-soft);color:var(--muted);text-transform:uppercase}
.chip.fresh{color:var(--up);border-color:rgba(13,138,90,.4);background:rgba(13,138,90,.06)}
.chip.delayed{color:var(--amber);border-color:rgba(168,106,24,.4);background:rgba(168,106,24,.06)}
.chip.stale{color:var(--down);border-color:rgba(196,61,46,.4);background:rgba(196,61,46,.06)}

.curve-card{background:var(--panel);border:1px solid var(--rule);padding:22px}
.curve-card h3{margin:0 0 4px;font-family:"Source Serif 4",serif;font-size:1.15rem;font-weight:700}
.curve-card .sub{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px}

/* sectors */
.sectors{background:var(--panel);border:1px solid var(--rule);padding:22px 24px}
.sector-row{display:grid;grid-template-columns:170px 1fr 90px;gap:16px;align-items:center;padding:8px 0;border-top:1px dotted var(--rule-soft)}
.sector-row:first-child{border-top:none}
.sector-row .name{font-family:"JetBrains Mono",monospace;font-size:12px}
.sector-row .name .ticker{font-weight:700;letter-spacing:.05em;margin-right:8px}
.sector-row .name .ko{color:var(--muted)}
.sector-row .pct{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;text-align:right}
.bar-track{height:14px;position:relative;background:linear-gradient(to right,transparent calc(50% - .5px),var(--rule-soft) calc(50% - .5px),var(--rule-soft) calc(50% + .5px),transparent calc(50% + .5px))}
.bar-fill{position:absolute;top:1px;bottom:1px;background:var(--up)}
.bar-fill.neg{background:var(--down)}

/* key issues */
.issues{display:grid;gap:0}
.issue{display:grid;grid-template-columns:90px 1fr;gap:32px;padding:24px 0;border-top:1px solid var(--rule-soft)}
.issue:first-child{border-top:1px solid var(--rule)}
.issue:last-child{border-bottom:1px solid var(--rule)}
.issue .idx{font-family:"Source Serif 4",serif;font-style:italic;font-size:3.6rem;font-weight:800;color:var(--accent);line-height:.9;letter-spacing:-.03em}
.issue h3{margin:0 0 14px;font-family:"Source Serif 4",serif;font-size:1.45rem;font-weight:700;letter-spacing:-.01em;line-height:1.3;word-break:keep-all}
.issue dl{margin:0;display:grid;grid-template-columns:120px 1fr;gap:8px 18px;border-top:1px solid var(--rule-soft);padding-top:12px}
.issue dt{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;padding-top:3px}
.issue dd{margin:0;color:var(--ink-2);line-height:1.7;font-size:.96rem}

/* timeline */
.timeline-card{background:var(--panel);border:1px solid var(--rule);padding:24px 28px}
.timeline-card h3{margin:0 0 4px;font-family:"Source Serif 4",serif;font-size:1.2rem}
.timeline-card .sub{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:18px}
.tl-list{display:grid;gap:0;margin-top:18px}
.tl-event{display:grid;grid-template-columns:110px 1fr 100px;gap:18px;align-items:baseline;padding:10px 0;border-top:1px dotted var(--rule-soft)}
.tl-event:first-child{border-top:1px solid var(--rule-soft)}
.tl-event .when{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.06em;color:var(--ink);font-weight:600}
.tl-event .when .day{display:block;font-size:10px;color:var(--muted);letter-spacing:.16em;text-transform:uppercase;font-weight:500}
.tl-event .name{font-size:.95rem;line-height:1.5}
.tl-event .name .ko{color:var(--muted);font-size:.85rem;display:block;margin-top:2px}
.tl-event .imp{justify-self:end;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.tl-event.high .imp{color:var(--down)}
.tl-event.high .when{color:var(--down)}

/* checkpoints */
.checkpoints{display:grid;gap:14px}
.checkpoint{display:grid;grid-template-columns:auto 1fr;gap:18px;background:var(--panel);border:1px solid var(--rule-soft);padding:18px 22px;border-left:3px solid var(--amber)}
.checkpoint .marker{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber);font-weight:700;width:80px;padding-top:3px}
.checkpoint p{margin:0;line-height:1.7;color:var(--ink-2)}

/* positioning */
.pos-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:18px}
.pos-card{background:var(--panel);border:1px solid var(--rule);padding:24px 26px}
.pos-card.alt{background:var(--paper-2);border-style:dashed}
.pos-card .top{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;font-weight:700}
.pos-card.alt .top{color:var(--accent-2)}
.pos-card h3{margin:0 0 16px;font-family:"Source Serif 4",serif;font-size:1.3rem;font-weight:700;line-height:1.35;letter-spacing:-.01em}
.pos-card dl{margin:0;display:grid;grid-template-columns:110px 1fr;gap:6px 18px;font-size:.92rem;line-height:1.7}
.pos-card dt{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700;padding-top:3px}
.pos-card dd{margin:0}
.pos-card ul{margin:6px 0 0;padding-left:18px}
.pos-card ul li{margin-bottom:4px}
.compliance{margin-top:14px;padding:10px 12px;background:rgba(168,106,24,.08);border-left:2px solid var(--amber);font-size:.84rem;color:var(--muted)}

/* essay */
.essay{columns:2;column-gap:48px;column-rule:1px solid var(--rule-soft);font-family:"Noto Sans KR";font-size:1.02rem;line-height:1.85;color:var(--ink-2)}
.essay p{margin:0 0 16px;break-inside:avoid-column}
.essay p:first-child::first-letter{font-family:"Source Serif 4",serif;font-weight:800;font-size:4.2rem;line-height:.85;float:left;padding:8px 12px 0 0;color:var(--accent)}

/* freshness */
.fresh-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--rule);background:var(--panel)}
.fresh-cell{padding:16px 18px;border-right:1px solid var(--rule-soft);border-bottom:1px solid var(--rule-soft)}
.fresh-cell:nth-child(4n){border-right:none}
.fresh-cell .top{display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.fresh-cell .lbl{font-size:.92rem;font-weight:600;margin-bottom:4px}
.fresh-cell .obs{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted)}

/* ───── §03 spread history ───── */
.spread-card{margin-top:20px;border:1px solid var(--rule);background:var(--panel);padding:22px 24px}
.spread-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--rule-soft);flex-wrap:wrap}
.spread-head h3{margin:0;font-family:"Source Serif 4",serif;font-size:1.2rem;font-weight:700;letter-spacing:-.01em}
.spread-head .sub{margin:4px 0 0;font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.spread-stats{display:flex;gap:0;align-items:stretch}
.spread-stats .stat{display:flex;flex-direction:column;gap:2px;padding:0 16px;border-left:1px solid var(--rule-soft);min-width:88px}
.spread-stats .stat:first-child{padding-left:0;border-left:none}
.spread-stats .stat .key{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:700}
.spread-stats .stat strong{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.spread-card .explain{margin:14px 0 0;font-size:.88rem;line-height:1.65;color:var(--ink-2);max-width:none}

/* ───── §09 WATCHLIST ───── */
.wl-backdrop{border:1px solid var(--rule);background:var(--panel);padding:20px 22px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1.4fr;gap:24px}
.wl-backdrop-head{border-right:1px solid var(--rule-soft);padding-right:24px}
.wl-bd-kicker{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:6px}
.wl-backdrop-head h3{margin:0 0 10px;font-family:"Source Serif 4",serif;font-size:1.2rem;font-weight:700;letter-spacing:-.01em;line-height:1.3}
.wl-backdrop-head p{margin:0;color:var(--ink-2);line-height:1.65;font-size:.92rem}
.wl-bd-signals{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 18px;align-content:start}
.wl-bd-sig{display:grid;grid-template-columns:90px auto 70px;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px dotted var(--rule-soft);column-gap:10px}
.wl-bd-sig:nth-last-child(-n+2){border-bottom:none}
.wl-bd-sig .key{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
.wl-bd-sig strong{font-size:13px;font-weight:700}
.wl-bd-sig .chg{font-size:11px;font-weight:600;justify-self:end}
.wl-bd-sig .note{grid-column:1/-1;font-size:11px;color:var(--muted);font-family:"Noto Sans KR";line-height:1.5;margin-top:2px}

.wl-stack{display:flex;flex-direction:column;gap:18px}
.wl-card{border:1px solid var(--rule);background:var(--panel);padding:22px 24px;display:flex;flex-direction:column;gap:14px}
.wl-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:14px;border-bottom:1px solid var(--rule-soft)}
.wl-head-left{display:flex;gap:14px;align-items:flex-start}
.wl-idx{font-size:1.6rem;font-weight:700;color:var(--accent);line-height:1;padding-top:2px}
.wl-head h3{margin:0;font-family:"Source Serif 4",serif;font-size:1.4rem;font-weight:700;letter-spacing:-.01em;line-height:1.2}
.wl-sub{margin:5px 0 0;font-size:11px;letter-spacing:.06em;color:var(--muted);font-weight:600}
.wl-price{text-align:right}
.wl-price-val{font-family:"Source Serif 4",serif;font-size:1.9rem;font-weight:700;line-height:1;letter-spacing:-.015em;font-variant-numeric:tabular-nums}
.wl-cur{font-size:.7rem;color:var(--muted);font-weight:500;margin-left:4px}
.wl-price-chg{margin-top:6px;font-size:13px;font-weight:600}

.wl-tone-row{display:flex;gap:8px;flex-wrap:wrap;margin:0}
.wl-tone-chip{display:inline-flex;align-items:center;font-size:11px;letter-spacing:.04em;padding:5px 10px;border:1px solid var(--rule-soft);background:var(--paper);color:var(--ink);font-weight:600}
.wl-tone-chip .sep{display:inline-block;margin:0 6px;color:var(--rule-soft)}
.wl-tone-chip.up{color:var(--up);border-color:rgba(13,138,90,.4);background:rgba(13,138,90,.06)}
.wl-tone-chip.down{color:var(--down);border-color:rgba(196,61,46,.4);background:rgba(196,61,46,.06)}
.wl-tone-chip.warn{color:var(--amber);border-color:rgba(168,106,24,.4);background:rgba(168,106,24,.06)}

.wl-thesis{margin:0;padding:14px 16px;background:var(--paper);border-left:3px solid var(--accent);font-size:.94rem;line-height:1.7;color:var(--ink-2)}

.wl-chart{border:1px solid var(--rule-soft);background:var(--paper);padding:10px 14px 6px;overflow:hidden}

.wl-tech-summary{margin:0;font-size:.9rem;line-height:1.65;color:var(--ink-2)}
.wl-tech-label{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-right:4px}

.tech-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--rule-soft);background:var(--paper)}
.tech-cell{padding:10px 12px;border-right:1px solid var(--rule-soft);border-bottom:1px solid var(--rule-soft);display:flex;flex-direction:column;gap:4px}
.tech-cell:nth-child(4n){border-right:none}
.tech-cell:nth-last-child(-n+4){border-bottom:none}
.tech-cell .tk{font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700}
.tech-cell strong{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.tech-cell strong.warn{color:var(--amber)}

.drivers-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.drv-col{padding:12px 14px;border:1px solid var(--rule-soft);background:var(--paper)}
.drv-col.up{border-left:3px solid var(--up)}
.drv-col.down{border-left:3px solid var(--down)}
.drv-head{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:6px}
.drv-col.up .drv-head{color:var(--up)}
.drv-col.down .drv-head{color:var(--down)}
.drv-col ul{margin:0;padding-left:18px;font-size:.88rem;line-height:1.65;color:var(--ink-2)}
.drv-col li{margin-bottom:4px}

.mf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.mf{padding:12px 14px;border:1px solid var(--rule-soft);background:var(--paper)}
.mf-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.mf-label{font-size:.86rem;font-weight:600}
.mf-score{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.mf-bar{height:6px;background:var(--rule-soft);position:relative;overflow:hidden}
.mf-fill{height:100%;background:var(--up);transition:width .4s ease}
.mf-note{margin:8px 0 0;font-size:.8rem;line-height:1.55;color:var(--muted)}

.wl-bottom-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.wl-list{padding:12px 14px;border:1px solid var(--rule-soft);background:var(--paper)}
.wl-list-head{display:block;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:8px}
.wl-list ul{margin:0;padding-left:18px;font-size:.85rem;line-height:1.65;color:var(--ink-2)}
.wl-list li{margin-bottom:4px}

/* colophon */
.colophon{padding:32px 0 56px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.06em;line-height:1.8}
.colophon .row{display:flex;justify-content:space-between;border-top:1px solid var(--rule);padding-top:18px;margin-top:18px;gap:16px;flex-wrap:wrap}
.colophon b{color:var(--ink)}

/* responsive */
@media (max-width:1100px){
  .hero-grid{grid-template-columns:1fr}
  .matrix{grid-template-columns:repeat(2,1fr)}
  .matrix .cell:nth-child(2){border-right:none}
  .matrix .cell:nth-child(1),.matrix .cell:nth-child(2){border-bottom:1px solid var(--rule-soft)}
  .data-grid,.pos-grid{grid-template-columns:1fr}
  .essay{columns:1}
  .verdicts,.lede3,.fresh-grid{grid-template-columns:repeat(2,1fr)}
  .section-head{grid-template-columns:1fr}
  .issue{grid-template-columns:60px 1fr;gap:18px}
  .issue .idx{font-size:2.4rem}
  .wl-backdrop{grid-template-columns:1fr}
  .wl-backdrop-head{border-right:none;border-bottom:1px solid var(--rule-soft);padding-right:0;padding-bottom:16px}
  .wl-bd-signals{grid-template-columns:1fr}
  .tech-grid{grid-template-columns:repeat(2,1fr)}
  .tech-cell:nth-child(4n){border-right:1px solid var(--rule-soft)}
  .tech-cell:nth-child(2n){border-right:none}
  .tech-cell:nth-last-child(-n+2){border-bottom:none}
  .wl-bottom-grid,.mf-grid,.drivers-grid{grid-template-columns:1fr}
}
@media (max-width:680px){
  .matrix,.verdicts,.lede3,.fresh-grid{grid-template-columns:1fr}
  .matrix .cell{border-right:none;border-bottom:1px solid var(--rule-soft)}
  .tape .ticks{display:none}
  .shell{padding:0 18px}
}
@media print{
  body{background:#fff}
  .tape{display:none}
  .section{break-inside:avoid;page-break-inside:avoid}
  .shell{max-width:none;padding:0 12mm}
}
</style>`;
}
