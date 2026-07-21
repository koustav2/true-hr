import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export const signToken = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
export const verifyToken = (token) => jwt.verify(token, config.jwtSecret);

// Short-lived handoff token for app → web SSO (the "My ESS" tile opens the web
// portal already signed in). 60s validity keeps the exposure window tiny.
export const signSsoToken = (payload) => jwt.sign({ ...payload, purpose: 'web_sso' }, config.jwtSecret, { expiresIn: '60s' });
