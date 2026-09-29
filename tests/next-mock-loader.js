/**
 * tests/next-mock-loader.js — Loader de ESM que stub-ea módulos de Next.js.
 *
 * Intercepta cualquier import que empiece con `next/` y devuelve un módulo
 * vacío con los exports mínimos que necesita el código bajo test para no
 * explotar. Las funciones son no-ops: los tests que usan este loader analizan
 * el código fuente con readFileSync y nunca ejecutan las funciones de Next.
 */

const STUBS = {
  'next/headers': `
    export async function cookies() {
      return { get: () => undefined, set: () => {}, delete: () => {} };
    }
    export async function headers() {
      return { get: () => null };
    }
  `,
  'next/navigation': `
    export function redirect(url) {
      throw Object.assign(new Error('REDIRECT:' + url), { digest: 'NEXT_REDIRECT' });
    }
    export function notFound() {
      throw Object.assign(new Error('NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });
    }
  `,
  'next/cache': `
    export function revalidatePath() {}
    export function revalidateTag() {}
    export function unstable_cache(fn) { return fn; }
    export function unstable_noStore() {}
  `,
  'next/server': `
    export class NextResponse {
      static json(data, init) {
        return { ok: true, data, status: init?.status || 200 };
      }
      static redirect(url) { return { ok: true, url }; }
    }
    export class NextRequest {}
  `,
};

export async function resolve(specifier, context, nextResolve) {
  // Solo interceptar imports de next/* — dejar pasar todo lo demás.
  if (specifier.startsWith('next/') && STUBS[specifier]) {
    return { shortCircuit: true, url: `node:next-stub:${specifier}` };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('node:next-stub:')) {
    const specifier = url.replace('node:next-stub:', '');
    const source = STUBS[specifier] || 'export default {}';
    return { shortCircuit: true, format: 'module', source };
  }
  return nextLoad(url, context);
}
