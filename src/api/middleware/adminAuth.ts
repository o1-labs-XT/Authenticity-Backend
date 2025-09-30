import basicAuth from 'express-basic-auth';
import { config } from '../../config/index.js';

export const requireAdmin = basicAuth({
  users: {
    admin: config.ADMIN_PASSWORD,
  },
  challenge: true,
  unauthorizedResponse: 'Admin access required',
});
