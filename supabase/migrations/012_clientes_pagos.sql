-- 013_clientes_pagos.sql — Extiende la tabla clientes con soporte para pasarelas de pago.
--
-- Decisión: ARS → MercadoPago (preapproval), USD → dLocal (subscriptions).
-- El webhook de cada pasarela actualiza estado_pago. El lead pasa a 'cliente'
-- solo cuando la pasarela confirma el primer débito exitoso.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS pasarela TEXT
    CHECK (pasarela IN ('mercadopago', 'dlocal')),
  ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'pendiente'
    CHECK (estado_pago IN ('pendiente', 'activo', 'pausado', 'cancelado', 'vencido')),
  ADD COLUMN IF NOT EXISTS proximo_cobro DATE,
  ADD COLUMN IF NOT EXISTS ultimo_cobro DATE,
  -- URL de aprobación que genera la pasarela; se guarda para poder re-enviar
  ADD COLUMN IF NOT EXISTS url_aprobacion TEXT;

-- Índice para el webhook: necesita encontrar al cliente por suscripcion_id rápido
CREATE INDEX IF NOT EXISTS idx_clientes_suscripcion ON clientes (suscripcion_id)
  WHERE suscripcion_id IS NOT NULL;

-- Índice para la vista de suscripciones activas
CREATE INDEX IF NOT EXISTS idx_clientes_estado_pago ON clientes (estado_pago)
  WHERE baja_en IS NULL;
