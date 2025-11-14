// server.js
import dotenv from 'dotenv';
import app from './app.js';

dotenv.config();

const PORT = process.env.PORT || 3001;

// bind em 0.0.0.0 para qualquer ambiente PaaS (Render/Heroku/etc.)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API online na porta ${PORT}`);
});

// desligamento gracioso (evita cortar conexões/queries abertas)
['SIGTERM', 'SIGINT'].forEach(sig => {
  process.on(sig, () => {
    console.log('🛑 Encerrando servidor…');
    server.close(() => process.exit(0));
  });
});
