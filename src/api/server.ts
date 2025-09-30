import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { createUploadRoutes } from './routes/upload.routes.js';
import { createStatusRoutes } from './routes/status.routes.js';
import { createTokenOwnerRoutes } from './routes/tokenOwner.routes.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { createChallengesRoutes } from './routes/challenges.routes.js';
import { createChainsRoutes } from './routes/chains.routes.js';
import { createUsersRoutes } from './routes/users.routes.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { loggingMiddleware } from './middleware/logging.middleware.js';
import { contextMiddleware } from './middleware/context.middleware.js';
import { UploadHandler } from '../handlers/upload.handler.js';
import { StatusHandler } from '../handlers/status.handler.js';
import { TokenOwnerHandler } from '../handlers/tokenOwner.handler.js';
import { AdminHandler } from '../handlers/admin.handler.js';
import { ChallengesHandler } from '../handlers/challenges.handler.js';
import { ChainsHandler } from '../handlers/chains.handler.js';
import { UsersHandler } from '../handlers/users.handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerDependencies {
  uploadHandler: UploadHandler;
  statusHandler: StatusHandler;
  tokenOwnerHandler: TokenOwnerHandler;
  adminHandler: AdminHandler;
  challengesHandler: ChallengesHandler;
  chainsHandler: ChainsHandler;
  usersHandler: UsersHandler;
}

export function createServer(dependencies: ServerDependencies): Express {
  const app = express();

  // Security middleware
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow images from different origins
    })
  );

  // CORS configuration
  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })
  );

  // Compression middleware
  app.use(compression());

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Context middleware (must be before logging)
  app.use(contextMiddleware);

  // Logging middleware
  app.use(loggingMiddleware);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
    });
  });

  // API version endpoint
  app.get('/api/version', (req, res) => {
    res.json({
      version: '1.0.0',
      api: 'Provenance Backend API',
      zkApp: config.zkappAddress || 'not configured',
    });
  });

  const swaggerDocument = YAML.load(path.join(__dirname, '../../swagger/swagger.yaml'));
  const baseUrl =
    config.nodeEnv === 'development'
      ? `http://localhost:${config.port}`
      : `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  swaggerDocument.servers = [
    {
      url: `${baseUrl}/api`,
      description: `${config.nodeEnv} server`,
    },
  ];

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  // Mount API routes
  const uploadRoutes = createUploadRoutes(dependencies.uploadHandler);
  const statusRoutes = createStatusRoutes(dependencies.statusHandler);
  const tokenOwnerRoutes = createTokenOwnerRoutes(dependencies.tokenOwnerHandler);

  app.use('/api', uploadRoutes);
  app.use('/api', statusRoutes);
  app.use('/api', tokenOwnerRoutes);

  const adminRoutes = createAdminRoutes(dependencies.adminHandler);
  app.use('/api', adminRoutes);

  const challengesRoutes = createChallengesRoutes(dependencies.challengesHandler);
  app.use('/api/challenges', challengesRoutes);

  const chainsRoutes = createChainsRoutes(dependencies.chainsHandler);
  app.use('/api/chains', chainsRoutes);

  const usersRoutes = createUsersRoutes(dependencies.usersHandler);
  app.use('/api/users', usersRoutes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
      },
    });
  });

  // Error handling middleware (must be last)
  app.use(errorMiddleware);

  return app;
}
