import bcrypt from 'bcrypt';

const senha = 'dama123';

const run = async () => {
  const hash = await bcrypt.hash(senha, 10);
  console.log('hash=', hash, 'len=', hash.length);   // len deve ser 60
  const ok = await bcrypt.compare(senha, hash);
  console.log('compare mesmo processo ->', ok);       // TEM que dar true
};
run();
