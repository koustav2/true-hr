import { aggregateDeductions, slabTax, computeRegimeTax, estimateTax } from '../src/services/incomeTax.js';
let p=0,f=0; const ok=(l,c,x='')=>{c?(p++,console.log('  ok  '+l)):(f++,console.error('FAIL  '+l+' '+x));};
const d=aggregateDeductions([{section:'80C',amount:200000},{section:'80D',amount:20000},{section:'80CCD1B',amount:60000}]);
ok('80C capped at 150k', d.capped['80C']===150000);
ok('80CCD1B capped at 50k', d.capped['80CCD1B']===50000);
ok('80D under cap kept', d.capped['80D']===20000);
ok('total capped sum', d.total===220000);
// New regime 12L: taxable 12L-75k std = 1125000; tax = 5%*(700k-300k)+10%*(1000k-700k)+15%*(1125k-1000k)=20000+30000+18750=68750; +4% cess=71500
const nr=computeRegimeTax({grossAnnual:1200000,regime:'new'});
ok('new-regime taxable', nr.taxable===1125000, nr.taxable);
ok('new-regime tax+cess', nr.totalTax===71500, nr.totalTax);
// Rebate: new regime 7L gross → taxable 625000 ≤ 700000 → tax 0
ok('87A rebate new', computeRegimeTax({grossAnnual:700000,regime:'new'}).totalTax===0);
// Old regime low income rebate
ok('87A rebate old', computeRegimeTax({grossAnnual:500000,regime:'old',deductions:{capped:{},total:60000}}).totalTax===0);
const e=estimateTax({grossAnnual:1500000,items:[{section:'80C',amount:150000},{section:'80D',amount:25000}]});
ok('estimate returns both + recommendation', e.old.totalTax>0 && e.new.totalTax>0 && ['old','new'].includes(e.recommended));
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
