-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN v3.40 — Persistir fecha_compra y fecha_agregado en MSI
-- ═══════════════════════════════════════════════════════════════
-- Estas columnas son necesarias para que el cálculo del plazo y las
-- quincenas sea correcto al recargar la sesión.
-- Sin esto, los MSI pierden información al recargar y muestran valores
-- incorrectos (ej: "Quincena 1 de 27" en lugar de "Q1/1").
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE msis
  ADD COLUMN IF NOT EXISTS fecha_compra DATE,
  ADD COLUMN IF NOT EXISTS fecha_agregado DATE;

-- VERIFICACIÓN:
-- SELECT id, concepto, fecha_compra, fecha_agregado, pago_actual FROM msis;
