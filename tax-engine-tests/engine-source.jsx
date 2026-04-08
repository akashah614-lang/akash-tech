// ═══════════════════════════════════════════════════════════════════════════
// TAXGRAPH v4.1 — ENGINE SOURCE (as provided)
// Saved here for reference. The test suite runs against engine.mjs, which is
// a pure-JS extraction of the computation logic below (compute1040 + helpers
// + TY constants). Keep them in sync when the engine changes.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect, useCallback } from "react";

const p = v => parseFloat(String(v).replace(/[$,]/g, "")) || 0;
const fmt = n => { const a = Math.abs(Math.round(n)); return (n < 0 ? "-$" : "$") + a.toLocaleString(); };
const pct = n => (n * 100).toFixed(1) + "%";

// ── TY2025 CONSTANTS (Rev. Proc. 2024-40 + OBBBA P.L. 119-21) ──
const TY={
  brackets:{S:[[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[Infinity,.37]],MFJ:[[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],MFS:[[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[375800,.35],[Infinity,.37]],HOH:[[17000,.10],[64850,.12],[103350,.22],[197300,.24],[250500,.32],[626350,.35],[Infinity,.37]]},
  stdDed:{S:15750,MFJ:31500,MFS:15750,HOH:23625},over65Add:{S:2000,MFJ:1600,MFS:1600,HOH:2000},
  ctc:2200,ctcRefund:1700,ctcPhase:{S:200000,MFJ:400000,MFS:200000,HOH:200000},odc:500,
  saltCap:40000,saltPhase:500000,seniorBonus:6000,seniorPhase:{S:75000,MFJ:150000,MFS:75000,HOH:75000},
  tipsCap:{S:25000,MFJ:25000,MFS:12500,HOH:25000},otCap:{S:12500,MFJ:25000,MFS:12500,HOH:12500},
  autoIntCap:10000,autoPhase:{S:100000,MFJ:200000,MFS:100000,HOH:100000},
  ssBase:176100,seRate:.153,seFactor:.9235,
  addlMedRate:.009,addlMedThr:{S:200000,MFJ:250000,MFS:125000,HOH:200000},
  niitRate:.038,niitThr:{S:200000,MFJ:250000,MFS:125000,HOH:200000},
  ltcg:{S:[[48350,0],[533400,.15],[Infinity,.20]],MFJ:[[96700,0],[600050,.15],[Infinity,.20]],MFS:[[48350,0],[300025,.15],[Infinity,.20]],HOH:[[64750,0],[566700,.15],[Infinity,.20]]},
  qbiRate:.20,
};
const FK={"Single":"S","Married Filing Jointly":"MFJ","Married Filing Separately":"MFS","Head of Household":"HOH"};

// ── ENGINE ──
function bracketTax(inc,br){let t=0,prev=0;for(const[cap,r]of br){const c=Math.min(inc,cap)-prev;if(c<=0)break;t+=c*r;prev=cap;}return Math.round(t);}
function ltcgTax(pref,ord,br){let t=0,prev=0;for(const[cap,r]of br){const s=Math.max(0,prev-ord);const e=Math.max(0,Math.min(pref,cap-ord));const c=e-s;if(c>0)t+=c*r;prev=cap;if(prev-ord>=pref)break;}return Math.round(t);}
function bracketBreakdown(inc,br){const o=[];let prev=0;for(const[cap,r]of br){const c=Math.min(inc,cap)-prev;if(c<=0)break;o.push({rate:r,tax:Math.round(c*r),width:inc>0?c/inc:0});prev=cap;}return o;}

function compute1040(d){
  const r={lines:{},d:{},notes:[]};const fs=d.filing_status||"Single";const k=FK[fs]||"S";
  const w2s=d.w2s||[];const totW=w2s.reduce((s,w)=>s+p(w.wages),0);const totF=w2s.reduce((s,w)=>s+p(w.fed),0);
  r.lines.L1=totW;r.lines.L2b=p(d.interest_amt);r.lines.L3b=p(d.ordinary_divs);
  const seN=Math.max(0,p(d.se_gross)-p(d.se_exp));const stg=p(d.st_gains);const ltg=p(d.lt_gains);
  r.lines.L7=stg+ltg;r.lines.L4b=p(d.ira_dist);r.lines.L5b=p(d.pension_dist);
  const ssA=p(d.ss_amount);
  if(ssA>0){const pv=r.lines.L1+r.lines.L2b+r.lines.L3b+ssA/2;const th=k==="MFJ"?32000:25000;r.lines.L6b=pv>th+9000?Math.round(Math.min(ssA*.85,ssA/2+(pv-th)*.85)):pv>th?Math.round(Math.min(ssA*.5,(pv-th)*.5)):0;}else r.lines.L6b=0;
  const rent=Math.max(0,p(d.rental_gross)-p(d.rental_exp));
  r.lines.L8=seN+rent+p(d.unemp_amt);
  r.lines.L9=r.lines.L1+r.lines.L2b+r.lines.L3b+r.lines.L4b+r.lines.L5b+r.lines.L6b+r.lines.L7+r.lines.L8;
  let adj=0;
  if(seN>0){const se=Math.round(seN*TY.seFactor);const seT=Math.round(se*TY.seRate);r.d.seTax=seT;adj+=Math.round(seT/2);adj+=Math.min(p(d.se_health),seN);}
  adj+=p(d.hsa_amt)+p(d.ira_ded)+Math.min(p(d.sl_interest),2500);
  adj+=Math.min(p(d.tips_amt),TY.tipsCap[k]||25000)+Math.min(p(d.ot_amt),TY.otCap[k]||12500);
  let autD=Math.min(p(d.auto_int),TY.autoIntCap);const ap=TY.autoPhase[k]||100000;
  if(r.lines.L9>ap)autD=Math.max(0,Math.round(autD*(1-(r.lines.L9-ap)/50000)));adj+=autD;
  r.lines.L10=adj;r.lines.L11=r.lines.L9-r.lines.L10;
  let std=TY.stdDed[k]||15750;const age=p(d.taxpayer_age);
  if(age>=65)std+=TY.over65Add[k]||2000;
  if(fs==="Married Filing Jointly"&&p(d.spouse_age)>=65)std+=TY.over65Add[k];
  if(age>=65){const sp=TY.seniorPhase[k]||75000;if(r.lines.L11<=sp)std+=TY.seniorBonus;else if(r.lines.L11<sp+30000)std+=Math.round(TY.seniorBonus*(1-(r.lines.L11-sp)/30000));}
  r.d.stdDed=std;
  const med=Math.max(0,p(d.medical)-r.lines.L11*0.075);
  const saltR=p(d.salt_amt)+p(d.prop_tax);const saltM=r.lines.L11<=TY.saltPhase?TY.saltCap:Math.max(10000,TY.saltCap-Math.round((r.lines.L11-TY.saltPhase)*0.30));
  const salt=Math.min(saltR,saltM);const mortI=p(d.mort_int);const charit=p(d.charity);
  const item=med+salt+mortI+charit;r.d.itemized={med,salt,mortI,charit,total:item};
  const useI=d.ded_method==="Itemized"||(d.ded_method!=="Standard"&&item>std);
  r.lines.L12=useI?item:std;r.d.dedUsed=useI?"Itemized":"Standard";
  if(item>std)r.notes.push(`Itemizing saves you ${fmt(item-std)} vs. standard deduction of ${fmt(std)}.`);
  if(!useI&&item>0)r.notes.push(`Standard deduction (${fmt(std)}) beats itemized (${fmt(item)}) by ${fmt(std-item)}.`);
  let qbi=0;if(d.has_qbi==="Yes"&&seN>0)qbi=Math.min(Math.round(seN*TY.qbiRate),Math.round(Math.max(0,r.lines.L11-r.lines.L12)*TY.qbiRate));
  r.lines.L13=qbi;r.lines.L15=Math.max(0,r.lines.L11-r.lines.L12-r.lines.L13);
  const qD=p(d.qualified_divs);const pI=qD+Math.max(0,ltg);
  if(pI>0&&r.lines.L15>0){const oI=Math.max(0,r.lines.L15-pI);r.d.ordTax=bracketTax(oI,TY.brackets[k]);r.d.prefTax=ltcgTax(Math.min(pI,r.lines.L15),oI,TY.ltcg[k]);r.lines.L16=r.d.ordTax+r.d.prefTax;}
  else r.lines.L16=bracketTax(r.lines.L15,TY.brackets[k]);
  r.d.brackets=bracketBreakdown(r.lines.L15,TY.brackets[k]);
  let creds=0;const nK=p(d.num_kids);
  if(nK>0){let ctc=nK*TY.ctc;const ctcP=TY.ctcPhase[k]||200000;if(r.lines.L11>ctcP)ctc=Math.max(0,ctc-Math.ceil((r.lines.L11-ctcP)/1000)*50);r.d.ctc=ctc;const nonref=Math.min(ctc,r.lines.L16);creds+=nonref;r.d.ctcRefund=Math.min(TY.ctcRefund*nK,ctc-nonref);r.d.ctcNonref=nonref;}
  const nO=p(d.num_other_deps);if(nO>0){r.d.odc=nO*TY.odc;creds+=r.d.odc;}
  if(p(d.childcare_amt)>0&&(nK>0||nO>0)){const ccM=nK>=2?6000:3000;const ccR=Math.max(0.20,0.35-Math.floor(Math.max(0,r.lines.L11-15000)/2000)*0.01);r.d.ccCr=Math.round(Math.min(p(d.childcare_amt),ccM)*ccR);creds+=r.d.ccCr;}
  r.lines.L21=creds;r.lines.L22=Math.max(0,r.lines.L16-r.lines.L21);
  let addl=0;if(seN>0)addl+=r.d.seTax||0;
  const amT=TY.addlMedThr[k]||200000;if(totW+seN>amT){r.d.addlMed=Math.round((totW+seN-amT)*TY.addlMedRate);addl+=r.d.addlMed;}
  const nT=TY.niitThr[k]||200000;const invI=r.lines.L2b+r.lines.L3b+Math.max(0,r.lines.L7)+rent;
  if(invI>0&&r.lines.L11>nT){r.d.niit=Math.round(Math.min(invI,r.lines.L11-nT)*TY.niitRate);addl+=r.d.niit;}
  r.lines.L23=addl;r.lines.L24=r.lines.L22+r.lines.L23;
  let pay=totF+p(d.est_pay);
  const exSS=w2s.reduce((s,w)=>{const ss=p(w.sst);return s+Math.max(0,ss-Math.round(Math.min(p(w.ssw||w.wages),TY.ssBase)*0.062));},0);
  if(exSS>0){r.d.exSS=exSS;pay+=exSS;}
  if(r.d.ctcRefund>0)pay+=r.d.ctcRefund;
  r.lines.L33=pay;r.lines.L34=pay>r.lines.L24?pay-r.lines.L24:0;r.lines.L37=r.lines.L24>pay?r.lines.L24-pay:0;
  r.lines.effRate=r.lines.L9>0?r.lines.L24/r.lines.L9:0;
  let mR=0.10;for(const[cap,rate]of TY.brackets[k])if(r.lines.L15<=cap){mR=rate;break;}
  r.lines.margRate=mR;
  if(r.lines.L34>2000)r.notes.push(`You're over-withheld by ~${fmt(r.lines.L34)}/year. Consider adjusting your W-4 to keep more per paycheck.`);
  return r;
}

// NOTE: UI components (S0..S5, Nav, Btn, Lg, etc.) and the default export
// TaxGraphV4 have been omitted here — they're not part of the computation
// surface under test. See your React app for the full file.
