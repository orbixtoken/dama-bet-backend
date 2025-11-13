// src/middlewares/error.middleware.js

// Erro de aplicação controlado
export class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
  }
}

// Converte erros “estranhos” (pg, jwt, body-parser, zod, multer, rate-limit etc.) em AppError
export const errorConverter = (err, req, _res, next) => {
  // Já é AppError? segue o baile
  if (err instanceof AppError) return next(err);

  // JSON inválido no body (SyntaxError do express.json)
  if (err instanceof SyntaxError && 'body' in err) {
    return next(new AppError('JSON inválido no corpo da requisição.', 400));
  }

  // JWT (jsonwebtoken)
  if (err.name === 'TokenExpiredError') {
    return next(new AppError('Token expirado.', 401));
  }
  if (err.name === 'JsonWebTokenError') {
    return next(new AppError('Token inválido.', 401));
  }

  // Rate limit (express-rate-limit)
  // Alguns lançam err.status = 429; normalizamos a mensagem
  if (err.status === 429 || err.statusCode === 429) {
    return next(new AppError('Muitas requisições. Tente novamente mais tarde.', 429));
  }

  // CORS bloqueado (quando configurado com allowlist)
  if (err.message && err.message.includes('Not allowed by CORS')) {
    return next(new AppError('Origem não permitida por CORS.', 403));
  }

  // Upload (multer)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return next(new AppError('Arquivo excede o tamanho máximo permitido.', 413));
  }

  // Validações (ex.: Zod/Yup/Joi) – tentamos extrair detalhes
  if (Array.isArray(err.errors)) {
    const details = err.errors.map(e => e.message || e);
    return next(new AppError('Erro de validação.', 400, details));
  }

  // Postgres (pg) – mapeamento de códigos comuns
  // Referência: https://www.postgresql.org/docs/current/errcodes-appendix.html
  const pgCode = err.code;
  if (pgCode) {
    switch (pgCode) {
      case '23505': // unique_violation
        return next(new AppError('Registro já existente (violação de unicidade).', 409));
      case '23503': // foreign_key_violation
        return next(new AppError('Registro relacionado inexistente (chave estrangeira).', 409));
      case '23502': // not_null_violation
        return next(new AppError('Campo obrigatório ausente (NOT NULL).', 400));
      case '23514': // check_violation
        return next(new AppError('Restrição de CHECK violada.', 400));
      case '22P02': // invalid_text_representation (ex.: uuid inválido)
        return next(new AppError('Formato de parâmetro inválido.', 400));
      default:
        // Em dev, incluir o code ajuda bastante
        if (process.env.NODE_ENV !== 'production') {
          return next(new AppError(`Erro de banco (${pgCode}).`, 500, {
            code: pgCode,
            detail: err.detail,
            hint: err.hint,
            table: err.table,
            column: err.column,
          }));
        }
        return next(new AppError('Erro interno no banco de dados.', 500));
    }
  }

  // Fallback padrão
  const appErr = new AppError(err.message || 'Erro interno.', err.statusCode || err.status || 500);
  appErr.stack = err.stack;
  return next(appErr);
};

// Handler final
export const errorHandler = (err, _req, res, next) => {
  // Se headers já foram enviados por algum middleware/rota, delega ao default do Express
  if (res.headersSent) return next(err);

  const status = err.statusCode || 500;
  const body = {
    erro: err.isOperational ? err.message : 'Erro interno.',
  };

  // Em desenvolvimento é útil devolver detalhes
  if (process.env.NODE_ENV !== 'production') {
    if (err.details) body.details = err.details;
    if (err.stack) body.stack = err.stack;
  }

  res.status(status).json(body);
};

/**
 * (Opcional) Helper para rotas assíncronas: evita try/catch repetido e garante que
 * qualquer erro vá para o middleware de erro.
 *
 * Exemplo de uso:
 *   router.get('/coisas', asyncHandler(async (req, res) => {
 *     const data = await service.listar();
 *     res.json(data);
 *   }));
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
