// src/routes/financeiroAdmin.routes.js
import { Router } from "express";
import { autenticarToken } from "../middlewares/auth.middleware.js";
import { listarMovimentosAdmin } from "../controllers/financeiroAdmin.controller.js";

const router = Router();

// Aqui futuramente você pode adicionar mais rotas financeiras do admin
router.get("/movimentos", autenticarToken, listarMovimentosAdmin);

export default router;
