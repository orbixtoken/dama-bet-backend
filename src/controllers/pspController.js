// src/controllers/pspController.js
import crypto from 'crypto';
import db from '../models/db.js';

function verifySignature(req, secret, headerName = 'x-psp-signature') {
  const sig = req.headers[headerName] || req.headers[headerName.toLowerCase()];
  if (!sig || !secret) return false;
  const payload = JSON.stringify(req.body || {});
  const h = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(String(sig)));
}

/** Webhook idempotente (exemplo genérico) */
export async function pspWebhook(req, res) {
  const valid = verifySignature(req, process.env.PSP_WEBHOOK_SECRET);
  if (!valid) return res.status(400).json({ erro: 'Assinatura inválida' });

  // Exemplo de payload esperado (adapte ao PSP real):
  // { ext_id, user_id, type, amount, status, raw }
  const { ext_id, user_id, type, amount, status } = req.body || {};
  if (!ext_id || !user_id || !type || amount === undefined || !status) {
    return res.status(400).json({ erro: 'Payload incompleto' });
  }

  const valor = Number(amount);
  const tipo = String(type);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // upsert idempotente
    const up = await client.query(
      `INSERT INTO psp_transactions (external_id, usuario_id, tipo, valor, status, raw)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (external_id) DO UPDATE
         SET status = EXCLUDED.status,
             raw = EXCLUDED.raw,
             updated_at = NOW()
       RETURNING *`,
      [ext_id, user_id, tipo, valor, status, JSON.stringify(req.body)]
    );

    const row = up.rows[0];

    // se pago/approved -> creditar ou marcar que saque foi pago
    if (row.status === 'paid' || row.status === 'approved') {
      if (row.tipo === 'pix_in' || row.tipo === 'card_in') {
        // depósito: credita
        const s = await client.query('SELECT saldo_disponivel FROM saldos WHERE usuario_id = $1 FOR UPDATE', [row.usuario_id]);
        if (!s.rows.length) throw new Error('Saldo inexistente para usuário');
        const before = Number(s.rows[0].saldo_disponivel);
        const after = before + valor;

        await client.query('UPDATE saldos SET saldo_disponivel = $1 WHERE usuario_id = $2', [after, row.usuario_id]);
        await client.query(
          `INSERT INTO financeiro_movimentos (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
           VALUES ($1,'deposito_externo',$2,$3,$4,$5)`,
          [row.usuario_id, valor, `PSP ${row.external_id}`, before, after]
        );
      } else if (row.tipo === 'pix_out' || row.tipo === 'card_out') {
        // pagamento de saque: apenas registra baixa (bloqueio já ocorreu no fluxo de saque)
        await client.query(
          `INSERT INTO financeiro_movimentos (usuario_id, tipo, valor, descricao, saldo_antes, saldo_depois)
           VALUES ($1,'pagamento_saque',$2,$3,NULL,NULL)`,
          [row.usuario_id, valor, `PSP ${row.external_id}`]
        );
      }
    }

    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ erro: err.message });
  } finally {
    client.release();
  }
}
