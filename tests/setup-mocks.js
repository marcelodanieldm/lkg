/**
 * tests/setup-mocks.js — Mocks de módulos de Next.js para el runner de Node.
 *
 * `next/headers` y `next/navigation` solo existen dentro del runtime de Next.
 * El runner de Node los carga cuando algún test importa un Server Action o
 * cualquier módulo que a su vez importe `lib/auth.js`. Este archivo registra
 * stubs mínimos antes de que eso pase, usando el mecanismo de loaders de Node.
 *
 * Se inyecta con --import en el script de test del package.json.
 * No simula ningún comportamiento de sesión: los tests que importan acciones
 * no llegan a llamar a requerirSesion() porque prueban la lógica interna
 * del archivo mediante análisis de texto (readFileSync), no invocando las
 * funciones.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Registrar un loader que intercepta los imports de next/* y devuelve stubs.
register('./tests/next-mock-loader.js', pathToFileURL('./'));
