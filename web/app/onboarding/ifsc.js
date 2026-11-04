// IFSC → bank name (H34). Mirror of backend/src/services/peopleRules.js
// IFSC_BANKS: the first four letters of an IFSC are the bank code.
export const IFSC_BANKS = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India', IDIB: 'Indian Bank', BKID: 'Bank of India',
  KKBK: 'Kotak Mahindra Bank', YESB: 'Yes Bank', IDFB: 'IDFC First Bank', INDB: 'IndusInd Bank', FDRL: 'Federal Bank',
  IOBA: 'Indian Overseas Bank', MAHB: 'Bank of Maharashtra', UCBA: 'UCO Bank', CBIN: 'Central Bank of India',
  PSIB: 'Punjab & Sind Bank', KARB: 'Karnataka Bank', SIBL: 'South Indian Bank', CIUB: 'City Union Bank',
  KVBL: 'Karur Vysya Bank', TMBL: 'Tamilnad Mercantile Bank', RATN: 'RBL Bank', DCBL: 'DCB Bank', AUBL: 'AU Small Finance Bank',
  ESFB: 'Equitas Small Finance Bank', UJVN: 'Ujjivan Small Finance Bank', BDBL: 'Bandhan Bank', JAKA: 'Jammu & Kashmir Bank',
  DLXB: 'Dhanlaxmi Bank', CSBK: 'CSB Bank', IBKL: 'IDBI Bank', AIRP: 'Airtel Payments Bank', PYTM: 'Paytm Payments Bank',
  IPOS: 'India Post Payments Bank', FINO: 'Fino Payments Bank', SCBL: 'Standard Chartered Bank', HSBC: 'HSBC', CITI: 'Citibank',
  DBSS: 'DBS Bank', DEUT: 'Deutsche Bank', ORBC: 'Punjab National Bank', SYNB: 'Canara Bank', ALLA: 'Indian Bank',
  ANDB: 'Union Bank of India', CORP: 'Union Bank of India', VIJB: 'Bank of Baroda', UTBI: 'Punjab National Bank',
};
export const bankForIfsc = (ifsc) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || '').toUpperCase())
  ? IFSC_BANKS[String(ifsc).toUpperCase().slice(0, 4)] || null : null);
