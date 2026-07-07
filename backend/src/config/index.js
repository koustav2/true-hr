import dotenv from 'dotenv';
dotenv.config();

const required = ['JWT_SECRET', 'DATABASE_URL', 'PII_ENCRYPTION_KEY'];
for (const k of required) {
  if (!process.env[k]) console.warn(`[config] Warning: ${k} is not set`);
}

// In production, refuse to boot with missing/default secrets — a silently
// weak JWT secret or PII key is a data breach waiting to happen.
if (process.env.NODE_ENV === 'production') {
  const fatal = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret') fatal.push('JWT_SECRET');
  if (!process.env.PII_ENCRYPTION_KEY || /^0+$/.test(process.env.PII_ENCRYPTION_KEY)) fatal.push('PII_ENCRYPTION_KEY');
  if (!process.env.DATABASE_URL) fatal.push('DATABASE_URL');
  if (fatal.length) {
    console.error(`[config] FATAL: production requires real values for: ${fatal.join(', ')}`);
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  piiKey: process.env.PII_ENCRYPTION_KEY || '0'.repeat(64),
  databaseUrl: process.env.DATABASE_URL,
  companyName: process.env.COMPANY_NAME || 'True HR Pvt Ltd',
  supportPhone: process.env.SUPPORT_PHONE || '+91-7370067005',
  companyAddress: process.env.COMPANY_ADDRESS || 'A-11, Sector-67, Noida, U.P. 201301',
  companyWebsite: process.env.COMPANY_WEBSITE || 'www.truekindfoundation.org',
  appLoginUrl: process.env.APP_LOGIN_URL || '',
  appDownloadUrl: process.env.APP_DOWNLOAD_URL || 'https://play.google.com/store/apps/details?id=com.truehr.app',
  offerExpiryDays: parseFloat(process.env.OFFER_EXPIRY_DAYS || '3'), // offer link validity (days)
  mail: {
    from: process.env.MAIL_FROM || 'TRUE HR <no-reply@truehr.example>',
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
};
