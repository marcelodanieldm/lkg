import { entrar } from './accion.js';

export const dynamic = 'force-dynamic';

export default async function Acceso({ searchParams }) {
  const p = await searchParams;
  return (
    <main>
      <div className="acceso">
        <h1>Lokigi</h1>
        <p className="sub" style={{ margin: '0 auto' }}>Panel privado.</p>
        <form action={entrar}>
          <input type="password" name="clave" placeholder="Contraseña" autoFocus required
                 autoComplete="current-password" />
          <button type="submit">Entrar</button>
        </form>
        {p?.error && <p className="error">Contraseña incorrecta.</p>}
      </div>
    </main>
  );
}
