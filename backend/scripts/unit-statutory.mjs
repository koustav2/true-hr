import { professionalTax, minimumWage, complianceCheck } from '../src/services/statutoryRates.js';
let p=0,f=0; const ok=(l,c)=>{c?(p++,console.log('  ok  '+l)):(f++,console.error('FAIL  '+l));};

// Professional tax
ok('MH 5000 → 0', professionalTax('Maharashtra',5000)===0);
ok('MH 8000 → 175', professionalTax('Maharashtra',8000)===175);
ok('MH 30000 → 200', professionalTax('Maharashtra',30000)===200);
ok('MH 30000 Feb → 300', professionalTax('Maharashtra',30000,{month:2})===300);
ok('Karnataka 30000 → 200', professionalTax('Karnataka',30000)===200);
ok('Karnataka 20000 → 0', professionalTax('Karnataka',20000)===0);
ok('WB 30000 → 150', professionalTax('West Bengal',30000)===150);
ok('Delhi (no PT) → 0', professionalTax('Delhi',99999)===0);
ok('UP (no PT) → 0', professionalTax('Uttar Pradesh',50000)===0);
ok('unknown state → 0', professionalTax('Atlantis',50000)===0);
ok('overrides respected', professionalTax('X',26000,{overrides:[{upto:25000,amount:0},{upto:1e9,amount:250}]})===250);

// Minimum wage
ok('Delhi skilled floor', minimumWage('Delhi','skilled')===21215);
ok('unknown state falls back', minimumWage('Atlantis','unskilled')===12000);
ok('MH highly skilled', minimumWage('Maharashtra','highly skilled')===17000);

// Compliance
const c1=complianceCheck({state:'Delhi',category:'skilled',monthlyGross:18000});
ok('below-min-wage warns', c1.ok===false && c1.warnings.length===1);
const c2=complianceCheck({state:'Delhi',category:'skilled',monthlyGross:25000});
ok('above-min-wage clean', c2.ok===true && c2.pt===0);
const c3=complianceCheck({state:'Maharashtra',category:'skilled',monthlyGross:30000,month:2});
ok('MH feb pt in check', c3.pt===300);

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
