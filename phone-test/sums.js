// The Options Trade Logger's own sums, copied unchanged from
// logger_src/options_logger1.html so a trade logged on the phone shows the
// same numbers the computer will save. Re-copy if those lines ever change.
(function (root) {
"use strict";
const calcSells=(sb,p,q)=>sb==="S"&&p&&q?parseFloat(p)*parseInt(q)*100-(0.67*parseInt(q)):0;
const calcBuys=(sb,p,q)=>sb==="B"&&p&&q?-(parseFloat(p)*parseInt(q)*100+(0.67*parseInt(q))):0;
const isOpen=t=>!t.action||t.action==="Open";
const calcMOH=t=>{if(t.cp!=="P"||t.sb!=="S"||!isOpen(t)||!t.strike||!t.contracts)return 0;return parseFloat(t.strike)*parseInt(t.contracts)*100;};
const calcNetPL=(total,cp,action)=>{
  // Called away like expired and assigned: there is no buy-back, so the whole
  // premium is kept. The gain on the shares is recorded on the stock row.
  if(action==="Expired"||action==="Assigned"||action==="Called Away")return total;
  const c=(cp+"").replace(/[^0-9.\-]/g,"");
  const amt=(cp===null||cp===undefined||cp==="")?0:parseFloat(c);
  return isNaN(amt)?total:total+amt;
};
root.OptionIQSums = { calcSells: calcSells, calcBuys: calcBuys, calcMOH: calcMOH, calcNetPL: calcNetPL, isOpen: isOpen };
})(typeof window !== "undefined" ? window : globalThis);
