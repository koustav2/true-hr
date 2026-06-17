import dotenv from 'dotenv';
dotenv.config();

const required = ['JWT_SECRET', 'DATABASE_URL', 'PII_ENCRYPTION_KEY'];
for (const k of required) {
  if (!process.env[k]) console.warn(`[config] Warning: ${k} is not set`);
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
