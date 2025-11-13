// test-bcrypt.js
import bcrypt from 'bcrypt';

const senha = 'dama123';
const hash = "$2b$10$fmWHxWjdg7ggOJcJs4VtOeYPlXh9sPAovrZmyaZK.9EbiPqR/eU7e";

(async () => {
  try {
    console.log('len(hash)=', hash.length);       // deve imprimir 60
    console.log('tem espaço final?', /\s$/.test(hash)); // false
    const ok = await bcrypt.compare(senha, hash);
    console.log('confere?', ok);
  } catch (e) {
    console.error('erro compare:', e);
  }
})();
