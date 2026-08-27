import { computeFnf, completedYears, daysBetweenInclusive } from '../src/services/fnf.js';
let p=0,f=0; const ok=(l,c)=>{c?(p++,console.log('  ok  '+l)):(f++,console.error('FAIL  '+l));};
ok('completedYears 5.5y', completedYears('2019-01-01','2024-07-01')===5);
ok('completedYears just under', completedYears('2020-06-01','2025-05-30')===4);
ok('daysBetweenInclusive', daysBetweenInclusive('2026-06-01','2026-06-15')===15);

// CTC 60000/mo, basic 30000, gross 60000, LWD 15 June (30-day month) → salary 30000
const a=computeFnf({monthlyCtc:60000,basic:30000,grossMonthly:60000,lastWorkingDate:'2026-06-15',
  dateOfJoining:'2018-01-01',leaveBalanceDays:10,noticeShortfallDays:0});
ok('final-month salary prorated', a.breakup.finalMonthSalary===30000);
ok('leave encashment 10d', a.breakup.leaveEncashment===Math.round(30000/26*10*100)/100);
ok('gratuity eligible (>=5y)', a.breakup.gratuity>0 && a.breakup.completedYears===8);
ok('gratuity formula', a.breakup.gratuity===Math.round(15/26*30000*8*100)/100);
ok('net positive → company pays', a.net>0 && a.payableBy==='company');

// Not gratuity-eligible (<5y), with notice shortfall making net negative
const b=computeFnf({monthlyCtc:30000,basic:15000,grossMonthly:30000,lastWorkingDate:'2026-06-05',
  dateOfJoining:'2024-01-01',leaveBalanceDays:0,noticeShortfallDays:20,advances:5000});
ok('no gratuity under 5y', b.breakup.gratuity===0);
ok('notice recovery applied', b.breakup.noticeRecovery>0);
ok('net negative → employee owes', b.net<0 && b.payableBy==='employee');
console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
