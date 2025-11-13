// src/docs/swagger.js
import swaggerJSDoc from 'swagger-jsdoc';

const PORT = process.env.PORT || 3001;
// Permite definir a URL do servidor via env (útil em staging/prod)
const SERVER_URL =
  process.env.SWAGGER_SERVER_URL || `http://localhost:${PORT}`;

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Arguz Bets API',
      version: '1.0.0',
      description:
        'API de autenticação, apostas, financeiro, saques e rotas administrativas do Arguz Bets.',
    },
    servers: [{ url: SERVER_URL }],
    // Aplica Bearer globalmente (rotas públicas podem sobrescrever e remover)
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Login, refresh, logout' },
      { name: 'Usuários', description: 'Cadastro, perfil e gestão de usuários' },
      { name: 'Apostas', description: 'Criação e gestão de apostas' },
      { name: 'Financeiro', description: 'Depósitos, saldos e movimentos' },
      { name: 'Saques', description: 'Solicitações e processamento de saques' },
      { name: 'Admin', description: 'Operações administrativas (roles elevadas)' },
      { name: 'Health', description: 'Monitoração da API' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        // ===== Auth =====
        LoginRequest: {
          type: 'object',
          required: ['usuario', 'senha'],
          properties: {
            usuario: { type: 'string', example: 'admin@arguz.com' },
            senha: { type: 'string', example: 'nova123' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            usuario: {
              type: 'object',
              properties: {
                id: { type: 'integer', example: 1 },
                usuario: { type: 'string', example: 'admin@arguz.com' },
                funcao: { type: 'string', example: 'ADMIN' },
                nome: { type: 'string', example: 'Admin Arguz' },
              },
            },
          },
        },
        RefreshRequest: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
        LogoutRequest: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },

        // ===== Apostas =====
        ApostaCreateRequest: {
          type: 'object',
          required: ['tipo_jogo', 'valor_apostado'],
          properties: {
            tipo_jogo: { type: 'string', example: 'futebol' },
            valor_apostado: { type: 'number', example: 25.0 },
            retorno_esperado: { type: 'number', example: 45.5 },
          },
        },
        Aposta: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 101 },
            usuario_id: { type: 'integer', example: 1 },
            tipo_jogo: { type: 'string', example: 'futebol' },
            valor_apostado: { type: 'number', example: 25.0 },
            retorno_esperado: { type: 'number', example: 45.5 },
            retorno_real: { type: 'number', example: 0 },
            status: { type: 'string', example: 'pendente' },
            criado_em: { type: 'string', format: 'date-time' },
          },
        },

        // ===== Saques =====
        SaqueCreateRequest: {
          type: 'object',
          required: ['valor'],
          properties: {
            valor: { type: 'number', example: 50.0 },
          },
        },
        Saque: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 12 },
            usuario_id: { type: 'integer', example: 1 },
            valor: { type: 'number', example: 50.0 },
            status: {
              type: 'string',
              enum: ['pendente', 'aprovado', 'pago', 'recusado', 'cancelado'],
              example: 'pendente',
            },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },

        // ===== Financeiro =====
        Saldo: {
          type: 'object',
          properties: {
            saldo: { type: 'number', example: 125.5 },
            saldo_disponivel: { type: 'number', example: 100.0 },
            saldo_bloqueado: { type: 'number', example: 25.5 },
          },
        },
        MovimentoFinanceiro: {
          type: 'object',
          properties: {
            tipo: {
              type: 'string',
              example: 'deposito',
              description: 'deposito | saque | aposta | credito | etc.',
            },
            valor: { type: 'number', example: 100.0 },
            descricao: { type: 'string', example: 'Depósito manual' },
            criado_em: { type: 'string', format: 'date-time' },
            saldo_antes: { type: 'number', example: 50.0 },
            saldo_depois: { type: 'number', example: 150.0 },
          },
        },

        // ===== Erro Padrão =====
        ErrorResponse: {
          type: 'object',
          properties: {
            erro: { type: 'string', example: 'Mensagem do erro.' },
            details: {
              type: 'object',
              additionalProperties: true,
              nullable: true,
            },
            stack: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  apis: [
    './src/routes/*.js',        // anotações nas rotas
    './src/controllers/*.js',   // se quiser documentar direto nos controllers
  ],
};

export const swaggerSpec = swaggerJSDoc(options);
